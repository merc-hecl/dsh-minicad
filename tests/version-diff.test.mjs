import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorker } from "../src/host/worker.js";
import { decodePreview } from "../src/shared/preview.js";

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test("base-relative revision diff: added and removed hole volumes, overlap, identical and disjoint solids", async () => {
  const cad = await import("@classcad/smlibwasm");
  const { compareShapes } = await import("../src/kernel/model.js");
  const base = cad.Box(20, 20, 8), tool = cad.Cylinder(2, 12), target = base.cut(tool);
  try {
    const diff = compareShapes(base, target), inverse = compareShapes(target, base);
    near(diff.added.metrics.volume, Math.PI * 4 * 8);
    assert.equal(diff.removed, null);
    near(diff.unchanged.metrics.volume, 3200 - Math.PI * 4 * 8);
    assert.equal(inverse.added, null);
    near(inverse.removed.metrics.volume, diff.added.metrics.volume);
    near(base.volume, 3200);
    near(target.volume, diff.unchanged.metrics.volume);
    for (const distance of [0, 5, 20]) {
      const a = cad.Box(10, 10, 10), b = a.translate(distance, 0, 0);
      try {
        const result = compareShapes(a, b);
        if (!distance) {
          assert.equal(result.added, null); assert.equal(result.removed, null);
          near(result.unchanged.metrics.volume, 1000);
        } else {
          const changed = distance === 5 ? 500 : 1000;
          near(result.added.metrics.volume, changed); near(result.removed.metrics.volume, changed);
          if (distance === 5) near(result.unchanged.metrics.volume, 500);
          else assert.equal(result.unchanged, null);
        }
        for (const part of Object.values(result).filter(Boolean)) {
          assert.equal(part.metrics.valid, true);
          assert.ok(part.preview.indices.length > 0);
        }
      } finally { a.dispose(); b.dispose(); }
    }
  } finally { base.dispose(); tool.dispose(); target.dispose(); }
});

test("revision diff reads saved solids and preserves working files, head and process history", { timeout: 90000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "minicad-diff-"));
  const worker = createWorker({ dataDir });
  try {
    const project = await worker.call("create", { title: "Diff" });
    const source = "function build(p,cad) { const block=cad.Box(20,20,8); return p.hole ? block.cut(cad.Cylinder(2,12)) : block; }";
    await worker.call("build", { projectId: project.id, expectedRevision: 0, source, parameters: { hole: false } });
    const built = await worker.call("build", { projectId: project.id, expectedRevision: 1, parameters: { hole: true } });
    await writeFile(join(project.directory, "model.js"), `${source}\n// unsaved working changes\n`);
    const files = ["model.js", "model.parameters.json", "model.smb", ".cad-design.json"];
    const before = await Promise.all(files.map(file => readFile(join(project.directory, file))));
    const history = await worker.call("process_history", { projectId: project.id });
    const args = { projectId: project.id, sourceFile: "model.js", baseRevision: 2, targetRevision: 1 };
    const diff = await worker.call("compare", args);
    assert.equal(diff.projectId, project.id); assert.equal(diff.sourceFile, "model.js");
    assert.equal(diff.baseRevision, 2); assert.equal(diff.targetRevision, 1);
    assert.equal(diff.added, null);
    near(diff.removed.volume, Math.PI * 4 * 8);
    near(diff.unchanged.volume, built.design.metrics.volume);
    for (const part of [diff.removed, diff.unchanged]) {
      const preview = decodePreview(Buffer.from(part.preview, "base64"));
      assert.ok(preview.indices.length > 0); assert.ok(preview.edges.length > 0);
    }
    const inverse = await worker.call("compare", { ...args, baseRevision: 1, targetRevision: 2 });
    near(inverse.added.volume, diff.removed.volume); assert.equal(inverse.removed, null);
    const same = await worker.call("compare", { ...args, targetRevision: 2 });
    assert.equal(same.added, null); assert.equal(same.removed, null);
    near(same.unchanged.volume, built.design.metrics.volume);
    await assert.rejects(worker.call("compare", { ...args, targetRevision: 99 }), /版本不存在/);
    const after = await worker.call("get", { projectId: project.id });
    assert.equal(after.head, 2); assert.deepEqual(after.revisions, built.revisions);
    assert.deepEqual(await worker.call("process_history", { projectId: project.id }), history);
    for (let i = 0; i < files.length; i++) assert.deepEqual(await readFile(join(project.directory, files[i])), before[i]);
  } finally {
    await worker.dispose();
    await rm(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});
