import { localizedError } from "../shared/errors.js";
import fs from "node:fs";
import { join, relative, sep, extname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { atomicWrite, jsonBytes, readJson, inside } from "./files.js";
import { encodePreview, previewInfo } from "../shared/preview.js";
import { panelChanges } from "../shared/parameter-panel.js";

// Process previews are immutable checkpoints, separate from committed revisions.
// Only one modeling writer runs at a time; readers never import the WASM kernel.
export class ProcessJournal {
  constructor(directory, modelFile) {
    this.directory = directory;
    this.modelFile = modelFile;
    this.root = join(directory, ".cad-process", modelFile.slice(0, -extname(modelFile).length));
    this.index = join(this.root, "latest.json");
  }
  runs() {
    const archived = this.model().revisions.flatMap(entry => {
      const file = inside(this.directory, `${entry.folder}/process/run.json`);
      return fs.existsSync(file) ? [readJson(file)] : [];
    });
    const active = fs.existsSync(this.root) ? fs.readdirSync(this.root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && fs.existsSync(join(this.root, entry.name, "run.json")))
      .map(entry => this.run(entry.name)) : [];
    return [...new Map([...archived, ...active].map(run => [run.id, run])).values()].sort((a, b) => a.created - b.created);
  }
  latest() { return fs.existsSync(this.index) ? this.run(readJson(this.index).id)
    : this.runs().reduce((latest, run) => !latest || run.updated >= latest.updated ? run : latest, null); }
  model() { return readJson(join(this.directory, ".cad-design.json")).models[this.modelFile] || { head: 0, revisions: [] }; }
  optional(file) { return fs.existsSync(file) ? readJson(file) : null; }
  describe(run, model = this.model()) {
    if (!run) return null;
    const entry = model.revisions.find(entry => entry.processRunId === run.id)
      || model.revisions.find(entry => !entry.processRunId && entry.revision === run.committedRevision && (entry.parent || 0) === run.baseRevision);
    const folder = this.recordFolder(run.id);
    const operation = this.optional(join(folder, "operations.json"))
      || (entry && this.optional(inside(this.directory, `${entry.folder}/operations.json`)));
    const actor = run.actor || (operation?.tool === "cad_apply_panel" ? "user" : "agent");
    const purpose = run.purpose || (actor === "user" ? "panel_apply"
      : fs.existsSync(join(folder, "panel.json")) ? "panel_validation" : "modeling");
    let changes = run.changes;
    if (purpose === "panel_apply" && !changes) {
      const panel = this.optional(join(folder, "panel.json"))
        || (entry && this.optional(inside(this.directory, `${entry.folder}/panel.json`)));
      const parent = model.revisions.find(item => item.revision === run.baseRevision);
      const previous = parent && this.optional(inside(this.directory, `${parent.folder}/panel.json`));
      changes = panel && previous?.id === panel.id ? panelChanges(panel, previous.values, panel.values) : [];
    }
    const candidateState = run.phase === "preview" && !run.validation ? this.optional(join(folder, "candidate/state.json")) : null;
    const validation = run.validation || candidateState?.validation
      || (entry && this.optional(inside(this.directory, `${entry.folder}/state.json`))?.validation);
    return { ...run, actor, purpose, inputModel: run.inputModel ?? operation?.inputModel ?? run.modelFile,
      inputRevision: run.inputRevision ?? operation?.inputRevision ?? run.baseRevision,
      committedRevision: entry?.revision, ...(changes ? { changes } : {}),
      ...(validation ? { validation } : {}),
      // Old panel applications retain their raw trace on disk; only their result belongs in the user's revision process.
      steps: purpose === "panel_apply" ? run.steps.slice(-1).map(step => ({ ...step, operation: "panel_apply", label: "" })) : run.steps };
  }
  history(revision) {
    const model = this.model();
    if (revision !== undefined && revision !== 0 && !model.revisions.some(entry => entry.revision === revision))
      throw localizedError("版本不存在", "Version not found");
    return this.runs().map(run => this.describe(run, model)).filter(run => revision === undefined
      || run.purpose !== "panel_validation" && (run.committedRevision === revision
        || revision === model.head && !run.committedRevision && run.phase !== "done" && run.baseRevision === revision))
      .toReversed();
  }
  manifest(runId) { return join(this.root, runId, "run.json"); }
  recordFolder(runId) {
    if (typeof runId !== "string" || !/^[\da-f-]{36}$/i.test(runId))
      throw localizedError("过程记录不存在", "process run does not exist");
    const active = join(this.root, runId);
    if (fs.existsSync(join(active, "run.json"))) return active;
    for (const entry of this.model().revisions) {
      const folder = inside(this.directory, `${entry.folder}/process`);
      if (this.optional(join(folder, "run.json"))?.id === runId) return folder;
    }
    return active;
  }
  run(runId) {
    return readJson(join(this.recordFolder(runId), "run.json"));
  }
  committed(entry, runs = this.runs()) {
    return runs.find(run => entry.processRunId ? entry.processRunId === run.id
      : run.committedRevision === entry.revision && (entry.parent || 0) === run.baseRevision);
  }
  archive(run) {
    const folder = this.recordFolder(run.id);
    return new Map([["process/run.json", jsonBytes(run)],
      ...run.steps.map(step => [`process/${step.sequence}.bin`, fs.readFileSync(join(folder, `${step.sequence}.bin`))])]);
  }
  log(run, text) {
    run.logs = [...(run.logs || []), String(text)].join("\n").slice(-16000).split("\n");
    this.save(run);
  }
  saveMaterials(run, materials) {
    for (const [name, bytes] of materials) atomicWrite(inside(join(this.root, run.id), name), bytes);
  }
  materials(run) {
    const root = join(this.root, run.id);
    return new Map(fs.readdirSync(root, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"))
      .filter(name => name === "operations.json" || name === "panel.json" || name.startsWith("panel/") || name.startsWith("build/") || name.startsWith("inputs/"))
      .map(name => [name, fs.readFileSync(inside(root, name))]));
  }
  saveCandidate(run, state, binary, inputs) {
    const folder = join(this.root, run.id, "candidate"), preview = encodePreview(state.preview);
    atomicWrite(join(folder, "preview.bin"), preview);
    atomicWrite(join(folder, "model.smp"), binary);
    atomicWrite(join(folder, "state.json"), jsonBytes({ ...state, preview: previewInfo(preview) }));
    atomicWrite(join(folder, "transaction.json"), jsonBytes({
      inputs: [...inputs].map(([path, bytes]) => [relative(this.directory, path).split(sep).join("/"), bytes?.toString("base64") ?? null]),
    }));
    this.finish(run, "preview", { validation: state.validation });
  }
  candidate(runId) {
    const run = this.run(runId), folder = join(this.root, run.id, "candidate");
    if (run.phase !== "preview")
      throw Object.assign(localizedError("此试算已不再是待保存版本", "This trial is no longer pending publication"), { status: 409 });
    const state = readJson(join(folder, "state.json"));
    const { inputs } = readJson(join(folder, "transaction.json"));
    return { run, state, folder,
      inputs: new Map(inputs.map(([path, bytes]) => [inside(this.directory, path), bytes === null ? null : Buffer.from(bytes, "base64")])),
      materials: this.materials(run),
    };
  }
  save(run) { atomicWrite(this.manifest(run.id), jsonBytes(run)); }
  begin(modelFile, baseRevision, candidateRevision, summary, geometryIds, { actor = "agent", purpose = "modeling", inputRevision = baseRevision, changes } = {}) {
    const run = { id: randomUUID(), modelFile, baseRevision, candidateRevision, summary: summary || "", geometryIds, actor, purpose, inputRevision,
      ...(changes ? { changes } : {}),
      phase: "working", created: Date.now() / 1000, updated: Date.now() / 1000, steps: [] };
    fs.mkdirSync(join(this.root, run.id), { recursive: true });
    this.save(run);
    atomicWrite(this.index, jsonBytes({ id: run.id }));
    return run;
  }
  capture(run, description, label, operation) {
    const bytes = encodePreview(description.preview);
    const digest = createHash("sha256").update(bytes).update(JSON.stringify({ entities: description.entities, parts: description.parts })).digest("hex");
    const previous = run.steps.at(-1);
    if (previous?.digest === digest) {
      if (label && previous.label !== String(label)) {
        previous.label = String(label).slice(0, 200);
        run.updated = Date.now() / 1000;
        this.save(run);
      }
      return;
    }
    const step = { sequence: run.steps.length + 1, label: String(label || "").slice(0, 200),
      operation: operation || null, created: Date.now() / 1000,
      metrics: description.metrics, parts: description.parts, entities: description.entities, digest, byteLength: bytes.length };
    atomicWrite(join(this.root, run.id, `${step.sequence}.bin`), bytes);
    run.steps.push(step);
    run.updated = step.created;
    this.save(run);
  }
  finish(run, phase, extra = {}) {
    Object.assign(run, extra, { phase, updated: Date.now() / 1000 });
    this.save(run);
  }
  preview(runId, sequence) {
    // The client chooses a recorded UUID, never a filesystem path.
    const folder = typeof runId === "string" && /^[\da-f-]{36}$/i.test(runId) ? this.recordFolder(runId) : null;
    const file = folder && join(folder, "run.json");
    const run = file && fs.existsSync(file) ? this.run(runId) : null;
    const step = run?.steps.find(item => item.sequence === Number(sequence));
    if (!step) throw localizedError("过程步骤不存在", "process checkpoint does not exist");
    const record = this.describe(run);
    return { path: join(folder, `${step.sequence}.bin`), byteLength: step.byteLength,
      design: { metrics: step.metrics, parts: step.parts, entities: step.entities, geometryIds: run.geometryIds, modelFile: run.modelFile,
        revision: record.committedRevision ?? run.baseRevision, baseRevision: run.baseRevision,
        inputModel: record.inputModel, inputRevision: record.inputRevision,
        checkpoint: { runId: run.id, sequence: step.sequence } } };
  }
}
