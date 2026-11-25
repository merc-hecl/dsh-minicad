import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorker } from "../src/host/worker.js";
import { readEditOperations, validate } from "../src/shared/cad-schema.js";
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

test("member differences detect an insert moving inside an unchanged material union", async () => {
  const cad = await import("@classcad/smlibwasm");
  const { assembly } = await import("../src/kernel/assembly.js");
  const { compareGeometry } = await import("../src/kernel/model.js");
  cad.scope(() => {
    const housing = cad.Box(10, 10, 10), insert = cad.Box(2, 2, 2);
    const model = shape => assembly([{ id: "housing", name: "Housing", shape: housing }, { id: "insert", name: "Insert", shape }]);
    const diff = compareGeometry(model(insert), model(insert.translate(1, 0, 0)));
    assert.equal(diff.added, null);
    assert.equal(diff.removed, null);
    assert.deepEqual(diff.changedParts.map(part => [part.id, part.change]), [["insert", "modified"]]);
    near(diff.changedParts[0].added.volume, 4);
    near(diff.changedParts[0].removed.volume, 4);
  });
});

test("revision diff reads saved solids and preserves working files, head and process history", { timeout: 90000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "minicad-diff-"));
  const worker = createWorker({ dataDir });
  try {
    const project = await worker.call("create", { title: "Diff" });
    const source = "function build(p,cad) { const block=cad.Box(20,20,8).named('底板'); return p.hole ? block.cut(cad.Cylinder(2,12)) : block; }";
    await worker.call("build", { projectId: project.id, expectedRevision: 0, source, parameters: { hole: false } });
    const built = await worker.call("build", { projectId: project.id, expectedRevision: 1, source, parameters: { hole: true } });
    await writeFile(join(project.directory, "model.smp"), `${source}\n// unsaved working changes\n`);
    const files = ["model.smp", "model.state.json", ".cad-design.json"];
    const before = await Promise.all(files.map(file => readFile(join(project.directory, file))));
    const history = await worker.call("process_history", { projectId: project.id });
    const args = { projectId: project.id, modelFile: "model.smp", baseRevision: 2, targetRevision: 1 };
    const diff = await worker.call("compare", args);
    assert.equal(diff.projectId, project.id); assert.equal(diff.modelFile, "model.smp");
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

test("an enlarged hole pair is checked against its exact base before and after publication", { timeout: 90000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "minicad-candidate-diff-"));
  const worker = createWorker({ dataDir });
  try {
    const project = await worker.call("create", { title: "Mounting plate" });
    const model = { projectId: project.id, modelFile: project.modelFile };
    const holePair = radius => ({ op: "linear_pattern", part: "plate", count: 2, step: [16, 0, 0], mode: "cut",
      tool: { shape: "cylinder", radius, height: 12, center: [-8, 0, 0] } });
    await worker.call("edit", { ...model, expectedRevision: 0, operations: [
      { op: "add_part", id: "plate", name: "Plate", tool: { shape: "box", size: [40, 24, 8] } },
      { op: "add_part", id: "cover", name: "Cover", tool: { shape: "box", size: [40, 24, 2], center: [0, 0, 8] } },
      holePair(2),
    ] });
    const target = { ...model, expectedRevision: 1 };
    const file = join(project.directory, project.modelFile);
    const original = await readFile(file);
    const selector = { geomType: "cylinder", one: true };
    await assert.rejects(worker.call("edit", { ...target, operations: [
      { op: "offset_faces", part: "plate", faces: selector, distance: -1 },
    ] }), error => {
      assert.equal(error.code, "GEOMETRY_SELECTION_AMBIGUOUS");
      assert.equal(error.operationIndex, 0);
      assert.equal(error.operation, "offset_faces");
      assert.ok(error.runId);
      assert.deepEqual(error.details.selector, selector);
      assert.equal(error.details.matchCount, 2);
      assert.deepEqual(error.details.candidates.map(item => item.geometricCenter[0]).sort((a, b) => a - b), [-8, 8]);
      return true;
    });
    const op = holePair(3);
    const { inputSchema } = readEditOperations({ op: "linear_pattern" });
    validate(op, JSON.parse(JSON.stringify(inputSchema)));
    const trial = await worker.call("edit", { ...target, operations: [op], commit: false });
    const candidate = { ...target, runId: trial.runId };
    const { items: holes } = await worker.call("query", { ...candidate, kind: "holes", selector: { part: "plate" } });
    assert.equal(holes.length, 2);
    const checks = [...holes.map(hole => ({ expected: 6, measurement: { kind: "diameter", entity: { kind: "faces", selector: hole.id } } })),
      { expected: 16, measurement: { kind: "axis_distance", from: holes[0].id, to: holes[1].id } },
      { expected: 8, measurement: { kind: "size", axis: "z", target: { part: "plate" } } },
    ];
    assert.equal((await worker.call("check", { ...candidate, checks })).passed, true);
    const comparison = { ...model, baseRevision: 1 };
    const diff = await worker.call("compare_geometry", { ...comparison, runId: trial.runId });
    assert.equal(diff.committed, false);
    assert.equal(diff.candidateBaseRevision, 1);
    assert.equal(diff.added, null);
    near(diff.removed.volume, 2 * Math.PI * (9 - 4) * 8);
    [-11, -3, -4].forEach((value, i) => near(diff.removed.bounds.min[i], value));
    [11, 3, 4].forEach((value, i) => near(diff.removed.bounds.max[i], value));
    assert.deepEqual(diff.changedParts.map(part => [part.id, part.change]), [["plate", "modified"]]);
    near(diff.changedParts[0].removed.volume, diff.removed.volume);
    assert.deepEqual(await readFile(file), original);
    assert.equal((await worker.call("get", model)).head, 1);

    await worker.call("commit", { ...candidate, checks });
    const saved = await worker.call("compare_geometry", { ...comparison, targetRevision: 2 });
    assert.equal(saved.committed, true);
    near(saved.removed.volume, diff.removed.volume);
    for (const side of ["min", "max"])
      saved.removed.bounds[side].forEach((value, i) => near(value, diff.removed.bounds[side][i]));
    await assert.rejects(worker.call("compare_geometry", { ...comparison, runId: trial.runId }), { code: "CANDIDATE_NOT_PENDING" });
    await assert.rejects(worker.call("edit", { ...target, operations: [op] }), {
      code: "REVISION_CONFLICT", details: { expectedRevision: 1, actualRevision: 2 },
    });
  } finally {
    await worker.dispose();
    await rm(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});
