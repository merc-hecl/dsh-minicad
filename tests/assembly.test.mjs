import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorker } from "../src/host/worker.js";
import * as cad from "@classcad/smlibwasm";
import { exportShape } from "../src/kernel/model.js";

const source = `function build(p,cad) {
  const base = cad.Box(p.length,20,10);
  const lid = cad.Box(p.length,20,2).translate(0,0,6);
  return cad.assembly([{id:"base",name:"底座",shape:base},{id:"lid",name:"盖板",shape:lid}]);
}`;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
async function workspace(fn) {
  const dataDir = await mkdtemp(join(tmpdir(), "minicad-assembly-"));
  const worker = createWorker({ dataDir });
  try {
    const project = await worker.call("create", { title: "零件验收" });
    await fn(worker, project);
  } finally { await worker.dispose(); await rm(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
}

test("touching parts retain identity across edit, candidate commit, restore and exact exports", { timeout: 90000 }, () => workspace(async (worker, project) => {
  const target = { projectId: project.id, modelFile: "model.smp" };
  const built = await worker.call("build", { ...target, expectedRevision: 0, source, parameters: { length: 40 } });
  assert.equal(built.design.metrics.solidCount, 2);
  assert.deepEqual(built.design.parts.map(p => [p.id, p.name]), [["base", "底座"], ["lid", "盖板"]]);
  const pairs = [{ from: "base", to: "lid" }];
  const contact = await worker.call("fit", { ...target, expectedRevision: 1, pairs });
  assert.equal(contact.items[0].relation, "contact"); near(contact.items[0].interferenceVolume, 0);
  const candidate = await worker.call("edit", { ...target, expectedRevision: 1, commit: false,
    operations: [{ op: "translate", part: "lid", by: [0, 0, 5] }] });
  assert.equal((await worker.call("get", target)).head, 1);
  await worker.call("commit", { ...target, expectedRevision: 1, runId: candidate.runId });
  const separated = await worker.call("fit", { ...target, expectedRevision: 2, pairs });
  near(separated.items[0].distance, 5);
  const lidFace = await worker.call("query", { ...target, expectedRevision: 2, kind: "faces", selector: { part: "lid", position: "top", one: true } });
  assert.equal(lidFace.items[0].part, "lid"); near(lidFace.items[0].center[2], 12);
  const thickness = await worker.call("measure", { ...target, expectedRevision: 2,
    measurements: [{ kind: "thickness", target: { part: "lid", one: true }, point: [0, 0, 11], direction: [0, 0, 1] }] });
  near(thickness.items[0].value, 2);
  const ids = await worker.call("query", { ...target, expectedRevision: 2, kind: "parts" });
  assert.deepEqual(ids.items.map(p => p.id), ["base", "lid"]);
  near(ids.items[0].volume, 8000); near(ids.items[1].volume, 1600);
  await assert.rejects(worker.call("edit", { ...target, expectedRevision: 1, operations: [{ op: "translate", part: "lid", by: [0, 0, 1] }] }));
  await assert.rejects(worker.call("edit", { ...target, expectedRevision: 2, operations: [{ op: "shell", part: "lid", thickness: 100 }] }));
  assert.equal((await worker.call("get", target)).head, 2);
  const whole = await worker.call("export", { ...target, revision: 2, format: "step" });
  const bodies = cad.fromStep(Buffer.from(whole.data, "base64"));
  assert.equal(bodies.length, 2); near(bodies[0].volume + bodies[1].volume, 9600);
  near(bodies[1].bbox().center.z, 11); bodies.forEach(b => b.dispose());
  const one = await worker.call("export", { ...target, revision: 2, format: "step", part: "lid" });
  const lid = cad.fromStep(Buffer.from(one.data, "base64"));
  near(lid.volume, 1600); near(lid.bbox().center.z, 11); lid.dispose();
  assert.notEqual(one.path, whole.path);
  await worker.call("restore", { ...target, expectedRevision: 2, revision: 1 });
  const restored = await worker.call("fit", { ...target, expectedRevision: 1, pairs });
  assert.equal(restored.items[0].relation, "contact");
  await worker.call("edit", { ...target, expectedRevision: 1, operations: [{ op: "translate", part: "lid", by: [0, 0, -1] }] });
  const interference = await worker.call("fit", { ...target, expectedRevision: 3, pairs });
  assert.equal(interference.items[0].relation, "interference"); near(interference.items[0].interferenceVolume, 800);
  // An explicit script edits the current exact lid and preserves the base.
  const rebuilt = await worker.call("build", { ...target, expectedRevision: 3, part: "lid", source: "function build(p,cad){return cad.current.translate(1,0,0);}" });
  assert.equal(rebuilt.design.parts.length, 2); near(rebuilt.design.parts[1].center[2], 5);
}));

test("SMP operation variants generate independent checked files and exports without changing the original", { timeout: 90000 }, () => workspace(async (worker, project) => {
  const target = { projectId: project.id, modelFile: "model.smp" };
  await worker.call("build", { ...target, expectedRevision: 0, source, parameters: { length: 40 } });
  const before = await readFile(join(project.directory, "model.smp"));
  const result = await worker.call("variants", { ...target, expectedRevision: 1, formats: ["step"],
    variants: [60, 80, 100].map(length => ({ name: `${length} mm`, modelFile: `sizes/box-${length}.smp`, operations: [{ op: "scale", part: "base", factor: [length / 40, 1, 1] }, { op: "scale", part: "lid", factor: [length / 40, 1, 1] }],
      checks: [{ measurement: { kind: "size", axis: "x" }, expected: length, tolerance: 0.001 }] })) });
  assert.equal(result.items.length, 3);
  for (const [i, item] of result.items.entries()) {
    const length = [60, 80, 100][i];
    const saved = await worker.call("get", { projectId: project.id, modelFile: item.modelFile });
    assert.equal(saved.design.parts.length, 2); assert.equal(saved.design.validation.passed, true);
    near(saved.design.metrics.sizeX, length);
    const bodies = cad.fromStep(await readFile(item.exports[0].path));
    assert.equal(bodies.length, 2); near(bodies[0].volume + bodies[1].volume, length * 20 * 12);
    bodies.forEach(b => b.dispose());
  }
  assert.deepEqual(await readFile(join(project.directory, "model.smp")), before);
  const original = await worker.call("get", target);
  assert.equal(original.head, 1); assert.equal(original.selectedModelFile, "model.smp");
  await assert.rejects(worker.call("variants", { ...target, expectedRevision: 1,
    variants: [{ modelFile: "valid.smp", operations: [{ op: "scale", part: "base", factor: [1.25, 1, 1] }] }, { modelFile: "bad.smp", operations: [{ op: "scale", part: "base", factor: [0.75, 1, 1] }],
      checks: [{ measurement: { kind: "size", axis: "x" }, expected: 99 }] }] }));
  assert.equal((await worker.call("get", { ...target, modelFile: "valid.smp" })).head, 0);
}));

test("assembly bore queries and face edits retain component ownership; STEP accepts disconnected solids", { timeout: 90000 }, () => workspace(async (worker, project) => {
  const target = { projectId: project.id, modelFile: "model.smp" };
  await worker.call("build", { ...target, expectedRevision: 0, source: `function build(p,cad) {
    const base = cad.Box(40,30,10).cut(cad.Cylinder(2,6).translate(0,0,3));
    const lid = cad.Box(40,30,2).cut(cad.Cylinder(2,4)).translate(0,0,6);
    return cad.assembly([{id:'base',name:'底座',shape:base},{id:'lid',name:'盖板',shape:lid}]);
  }` });
  const holes = await worker.call("query", { ...target, expectedRevision: 1, kind: "holes" });
  assert.equal(holes.items.length, 2);
  assert.equal(holes.items.find(p => p.part === "base").hole.through, false);
  assert.equal(holes.items.find(p => p.part === "lid").hole.through, true);
  const face = await worker.call("query", { ...target, expectedRevision: 1, kind: "faces", selector: { part: "lid", position: "top", one: true } });
  const changed = await worker.call("edit", { ...target, expectedRevision: 1,
    operations: [{ op: "offset_faces", part: "lid", faces: face.items[0].id, distance: 1 }] });
  near(changed.design.parts.find(p => p.id === "lid").size[2], 3);
  near(changed.design.parts.find(p => p.id === "base").volume, 12000 - 20 * Math.PI);
  const twoSolids = cad.Box(10,10,10).fuse(cad.Box(5,5,5).translate(20,0,0));
  const back = cad.fromStep(exportShape(twoSolids, "step"));
  assert.equal(back.length, 2); near(back.reduce((sum, p) => sum + p.volume, 0), 1125);
  back.forEach(p => p.dispose()); twoSolids.dispose();
}));

test("copying a standalone plate creates independent named colored parts with a checked gap", { timeout: 90000 }, () => workspace(async (worker, project) => {
  const target = { projectId: project.id, modelFile: "model.smp" };
  const built = await worker.call("edit", { ...target, expectedRevision: 0, operations: [
    { op: "box", size: [40, 20, 5], name: "孔阵列底板" },
    { op: "cut", tool: { shape: "cylinder", radius: 2, height: 10 } },
    { op: "color", color: "#CD7F32" },
    { op: "color", faces: { position: "top" }, color: "#FF8000" },
  ] });
  const before = await readFile(join(project.directory, "model.smp"));
  const trial = await worker.call("edit", { ...target, expectedRevision: 1, commit: false,
    operations: [
      { op: "copy_part", part: "base", id: "copy", name: "孔阵列底板CP", center: [0, 25, 0] },
      { op: "color", part: "copy", color: "#DC143C" },
      { op: "color", part: "copy", faces: { position: "top" }, color: null },
    ] });
  const candidate = { ...target, expectedRevision: 1, runId: trial.runId };
  assert.equal((await worker.call("get", target)).head, 1);
  const parts = (await worker.call("query", { ...candidate, kind: "parts" })).items;
  assert.deepEqual(parts.map(p => [p.id, p.name, p.color]), [
    ["base", "孔阵列底板", "#CD7F32"], ["copy", "孔阵列底板CP", "#DC143C"],
  ]);
  near(parts[0].volume, 4000 - 20 * Math.PI); near(parts[1].volume, parts[0].volume);
  near(parts[0].center[1], 0); near(parts[1].center[1], 25);
  const faces = (await worker.call("query", { ...candidate, kind: "faces" })).items;
  const top = faces.find(f => f.part === "base" && f.normal?.[2] === 1);
  assert.equal(top.color, "#FF8000"); assert.equal(top.effectiveColor, "#FF8000");
  for (const face of faces.filter(f => f.part === "copy")) {
    assert.equal(face.color, null); assert.equal(face.effectiveColor, "#DC143C");
  }
  const checks = [{ measurement: { kind: "distance",
    from: { kind: "solids", selector: { part: "base" } },
    to: { kind: "solids", selector: { part: "copy" } } }, expected: 5, tolerance: 0.001 }];
  await assert.rejects(worker.call("commit", { ...candidate,
    checks: [{ ...checks[0], expected: 6 }] }), /检查|check/i);
  assert.deepEqual(await readFile(join(project.directory, "model.smp")), before);
  const saved = await worker.call("commit", { ...candidate, checks });
  assert.equal(saved.head, 2); assert.equal(saved.design.validation.passed, true);
  near(saved.design.metrics.volume, 2 * built.design.metrics.volume);
  // Every worker geometry request reloads the saved SMP in a fresh process.
  const solids = (await worker.call("query", { ...target, expectedRevision: 2, kind: "solids" })).items;
  assert.deepEqual(solids.map(s => [s.entityName, s.color]), [["孔阵列底板", "#CD7F32"], ["孔阵列底板CP", "#DC143C"]]);
  const original = (await worker.call("query", { ...target, expectedRevision: 2, kind: "faces",
    selector: { part: "base", position: "top", one: true } })).items[0];
  assert.equal(original.effectiveColor, "#FF8000");
  for (const format of ["smp", "step"]) {
    const exported = await worker.call("export", { ...target, revision: 2, format });
    const bodies = cad.fromFile(Buffer.from(exported.data, "base64"), `plates.${format}`);
    try {
      assert.equal(bodies.length, 2);
      assert.deepEqual(bodies.map(b => b.name), ["孔阵列底板", "孔阵列底板CP"]);
      near(bodies[1].bbox().min.y - bodies[0].bbox().max.y, 5);
      for (const [i, rgb] of [[0, [205, 127, 50]], [1, [220, 20, 60]]])
        assert.deepEqual(bodies[i].color.map(c => Math.round(c * 255)), rgb);
    } finally { bodies.forEach(b => b.dispose()); }
  }
  const third = await worker.call("edit", { ...target, expectedRevision: 2, operations: [
    { op: "copy_part", part: "copy", id: "spare", name: "备用孔板", center: [0, 25, 0] },
  ] });
  assert.deepEqual(third.design.parts.map(p => p.id), ["base", "copy", "spare"]);
  near(third.design.parts[2].center[1], 50);
}));
