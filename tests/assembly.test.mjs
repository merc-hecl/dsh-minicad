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
  const target = { projectId: project.id, sourceFile: "model.js" };
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
  // Parameter replay applies the saved move once, while preserving both parts.
  const rebuilt = await worker.call("update_parameters", { ...target, expectedRevision: 3, parameters: { length: 60 } });
  assert.equal(rebuilt.design.parts.length, 2); near(rebuilt.design.parts[1].center[2], 5);
}));

test("parameter variants generate independent checked files and exports without changing the original", { timeout: 90000 }, () => workspace(async (worker, project) => {
  const target = { projectId: project.id, sourceFile: "model.js" };
  await worker.call("build", { ...target, expectedRevision: 0, source, parameters: { length: 40 } });
  const before = await readFile(join(project.directory, "model.smp"));
  const result = await worker.call("variants", { ...target, expectedRevision: 1, formats: ["step"],
    variants: [60, 80, 100].map(length => ({ name: `${length} mm`, sourceFile: `sizes/box-${length}.js`, parameters: { length },
      checks: [{ measurement: { kind: "size", axis: "x" }, expected: length, tolerance: 0.001 }] })) });
  assert.equal(result.items.length, 3);
  for (const [i, item] of result.items.entries()) {
    const length = [60, 80, 100][i];
    const saved = await worker.call("get", { projectId: project.id, sourceFile: item.sourceFile });
    assert.equal(saved.design.parts.length, 2); assert.equal(saved.design.validation.passed, true);
    near(saved.design.metrics.sizeX, length);
    const bodies = cad.fromStep(await readFile(item.exports[0].path));
    assert.equal(bodies.length, 2); near(bodies[0].volume + bodies[1].volume, length * 20 * 12);
    bodies.forEach(b => b.dispose());
  }
  assert.deepEqual(await readFile(join(project.directory, "model.smp")), before);
  const original = await worker.call("get", target);
  assert.equal(original.head, 1); assert.equal(original.selectedSourceFile, "model.js");
  await assert.rejects(worker.call("variants", { ...target, expectedRevision: 1,
    variants: [{ sourceFile: "valid.js", parameters: { length: 50 } }, { sourceFile: "bad.js", parameters: { length: 30 },
      checks: [{ measurement: { kind: "size", axis: "x" }, expected: 99 }] }] }));
  assert.equal((await worker.call("get", { ...target, sourceFile: "valid.js" })).head, 0);
}));

test("assembly bore queries and face edits retain component ownership; STEP accepts disconnected solids", { timeout: 90000 }, () => workspace(async (worker, project) => {
  const target = { projectId: project.id, sourceFile: "model.js" };
  await worker.call("build", { ...target, expectedRevision: 0, source: `function build(p,cad) {
    const base = cad.Box(40,30,10).cut(cad.Cylinder(2,6).translate(0,0,3));
    const lid = cad.Box(40,30,2).cut(cad.Cylinder(2,4)).translate(0,0,6);
    return cad.assembly([{id:'base',shape:base},{id:'lid',shape:lid}]);
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
