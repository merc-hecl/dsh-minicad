import fs from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { atomicWrite, jsonBytes, readJson } from "./files.js";
import { encodePreview } from "../shared/preview.js";

// Process previews are immutable checkpoints, separate from committed revisions.
// Only one modeling writer runs at a time; readers never import the WASM kernel.
export class ProcessJournal {
  constructor(directory, sourceFile) {
    this.root = join(directory, ".cad-process", sourceFile.slice(0, -3));
    this.index = join(this.root, "latest.json");
  }
  runs() {
    return fs.existsSync(this.root) ? fs.readdirSync(this.root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && fs.existsSync(join(this.root, entry.name, "run.json")))
      .map(entry => readJson(join(this.root, entry.name, "run.json"))).sort((a, b) => a.created - b.created) : [];
  }
  latest() { return fs.existsSync(this.index) ? readJson(this.manifest(readJson(this.index).id)) : null; }
  manifest(runId) { return join(this.root, runId, "run.json"); }
  save(run) { atomicWrite(this.manifest(run.id), jsonBytes(run)); }
  begin(sourceFile, baseRevision, summary, geometryIds) {
    const run = { id: randomUUID(), sourceFile, baseRevision, summary: summary || "", geometryIds,
      phase: "working", created: Date.now() / 1000, updated: Date.now() / 1000, steps: [] };
    fs.mkdirSync(join(this.root, run.id), { recursive: true });
    this.save(run);
    atomicWrite(this.index, jsonBytes({ id: run.id }));
    return run;
  }
  capture(run, description, label, operation) {
    const bytes = encodePreview(description.preview);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (run.steps.at(-1)?.digest === digest) return;
    const step = { sequence: run.steps.length + 1, label: String(label || "").slice(0, 200),
      operation: operation || null, created: Date.now() / 1000,
      metrics: description.metrics, digest, byteLength: bytes.length };
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
    const run = file && fs.existsSync(file) ? readJson(file) : null;
    const step = run?.steps.find(item => item.sequence === Number(sequence));
    if (!step) throw new Error("过程步骤不存在 / process checkpoint does not exist");
    return { path: join(this.root, run.id, `${step.sequence}.bin`), byteLength: step.byteLength,
      design: { metrics: step.metrics, geometryIds: run.geometryIds, sourceFile: run.sourceFile,
        revision: run.baseRevision, checkpoint: { runId: run.id, sequence: step.sequence } } };
  }
}
