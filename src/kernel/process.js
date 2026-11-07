import { localizedError } from "../shared/errors.js";
import fs from "node:fs";
import { join, relative, sep, extname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { atomicWrite, jsonBytes, readJson, inside } from "./files.js";
import { encodePreview, previewInfo } from "../shared/preview.js";

// Process previews are immutable checkpoints, separate from committed revisions.
// Only one modeling writer runs at a time; readers never import the WASM kernel.
export class ProcessJournal {
  constructor(directory, modelFile) {
    this.directory = directory;
    this.root = join(directory, ".cad-process", modelFile.slice(0, -extname(modelFile).length));
    this.index = join(this.root, "latest.json");
  }
  runs() {
    return fs.existsSync(this.root) ? fs.readdirSync(this.root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && fs.existsSync(join(this.root, entry.name, "run.json")))
      .map(entry => this.run(entry.name)).sort((a, b) => a.created - b.created) : [];
  }
  latest() { return fs.existsSync(this.index) ? this.run(readJson(this.index).id) : null; }
  manifest(runId) { return join(this.root, runId, "run.json"); }
  run(runId) {
    if (typeof runId !== "string" || !/^[\da-f-]{36}$/i.test(runId))
      throw localizedError("过程记录不存在", "process run does not exist");
    return readJson(this.manifest(runId));
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
      .filter(name => name === "operations.json" || name.startsWith("build/") || name.startsWith("inputs/"))
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
    this.finish(run, "preview");
  }
  candidate(runId) {
    const run = this.run(runId), folder = join(this.root, run.id, "candidate");
    const state = readJson(join(folder, "state.json"));
    const { inputs } = readJson(join(folder, "transaction.json"));
    return { run, state, folder,
      inputs: new Map(inputs.map(([path, bytes]) => [inside(this.directory, path), bytes === null ? null : Buffer.from(bytes, "base64")])),
      materials: this.materials(run),
    };
  }
  save(run) { atomicWrite(this.manifest(run.id), jsonBytes(run)); }
  begin(modelFile, baseRevision, candidateRevision, summary, geometryIds) {
    const run = { id: randomUUID(), modelFile, baseRevision, candidateRevision, summary: summary || "", geometryIds,
      phase: "working", created: Date.now() / 1000, updated: Date.now() / 1000, steps: [] };
    fs.mkdirSync(join(this.root, run.id), { recursive: true });
    this.save(run);
    atomicWrite(this.index, jsonBytes({ id: run.id }));
    return run;
  }
  capture(run, description, label, operation) {
    const bytes = encodePreview(description.preview);
    const digest = createHash("sha256").update(bytes).update(JSON.stringify(description.entities)).digest("hex");
    if (run.steps.at(-1)?.digest === digest) return;
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
    const file = typeof runId === "string" && /^[\da-f-]{36}$/i.test(runId) ? this.manifest(runId) : null;
    const run = file && fs.existsSync(file) ? this.run(runId) : null;
    const step = run?.steps.find(item => item.sequence === Number(sequence));
    if (!step) throw localizedError("过程步骤不存在", "process checkpoint does not exist");
    return { path: join(this.root, run.id, `${step.sequence}.bin`), byteLength: step.byteLength,
      design: { metrics: step.metrics, parts: step.parts, entities: step.entities, geometryIds: run.geometryIds, modelFile: run.modelFile,
        revision: run.baseRevision, checkpoint: { runId: run.id, sequence: step.sequence } } };
  }
}
