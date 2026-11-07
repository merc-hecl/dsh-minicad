import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as cad from "@classcad/smlibwasm";
import { createWorker } from "../src/host/worker.js";
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test("solid names are mandatory at publication and survive rename, restart, direct edits and exact exports", { timeout: 90000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "minicad-names-"));
  let worker = createWorker({ dataDir });
  try {
    const project = await worker.call("create", { title: "命名" });
    const target = { projectId: project.id, modelFile: "model.smp" };
    const source = "function build(p,cad){return cad.Box(p.width,10,4).named('底板');}";
    const built = await worker.call("build", { ...target, expectedRevision: 0, source, parameters: { width: 20 } });
    assert.deepEqual(built.design.entities.map(entity => entity.name), ["底板"]);
    near(built.design.metrics.volume, 800);
    const face = await worker.call("query", { ...target, expectedRevision: 1, kind: "faces", selector: { position: "top", one: true } });
    assert.equal(face.items[0].entityName, "底板");
    const renamed = await worker.call("edit", { ...target, expectedRevision: 1, operations: [{ op: "rename", name: "安装底板" }] });
    near(renamed.design.metrics.volume, 800);
    assert.equal(renamed.design.entities[0].name, "安装底板");
    const trial = await worker.call("build", { ...target, expectedRevision: 2, commit: false,
      source: "function build(p,cad){return cad.Box(3,4,5);}" });
    await worker.dispose(); worker = createWorker({ dataDir });
    await assert.rejects(worker.call("commit", { ...target, expectedRevision: 2, runId: trial.runId }), /Every solid must be named/);
    await assert.rejects(worker.call("build", { ...target, expectedRevision: 2,
      source: "function build(p,cad){return cad.Box(3,4,5).named('  ');}" }), /Every solid must be named/);
    assert.equal((await worker.call("get", target)).head, 2);
    const resized = await worker.call("build", { ...target, expectedRevision: 2, source: "function build(p,cad){return cad.current.scale([1.5,1,1]);}" });
    assert.equal(resized.design.entities[0].name, "安装底板");
    near(resized.design.metrics.volume, 1200);
    for (const format of ["step", "smp"]) {
      const exported = await worker.call("export", { ...target, revision: 3, format });
      const shape = cad.fromFile(Buffer.from(exported.data, "base64"), `model.${format}`);
      assert.equal(shape.name, "安装底板");
      near(shape.volume, 1200);
      shape.dispose();
    }
    const restored = await worker.call("restore", { ...target, expectedRevision: 3, revision: 1 });
    assert.equal(restored.design.entities[0].name, "底板");
  } finally { await worker.dispose(); await rm(dataDir, { recursive: true, force: true }); }
});

test("independent solids keep individual names; assembly renames do not rename the collection or other members", { timeout: 90000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "minicad-independent-names-"));
  const worker = createWorker({ dataDir });
  try {
    const project = await worker.call("create", { title: "独立实体" });
    const target = { projectId: project.id, modelFile: "model.smp" };
    const built = await worker.call("edit", { ...target, expectedRevision: 0, operations: [
      { op: "box", size: [10, 10, 4], name: "板坯" }, { op: "box", size: [5, 5, 5], center: [20, 0, 0], name: "支柱" },
      { op: "rename", target: { nearest: [0, 0, 0], one: true }, name: "底板" },
    ] });
    near(built.design.metrics.volume, 525);
    assert.deepEqual(built.design.entities.map(entity => entity.name), ["底板", "支柱"]);
    const moved = await worker.call("edit", { ...target, expectedRevision: 1, operations: [
      { op: "translate", target: { name: "支柱", one: true }, by: [0, 0, 10] },
    ] });
    assert.deepEqual(new Set(moved.design.entities.map(entity => entity.name)), new Set(["底板", "支柱"]));
    const queried = await worker.call("query", { ...target, expectedRevision: 2, kind: "solids", selector: { name: "支柱", one: true } });
    near(queried.items[0].center[2], 10);
    const exported = await worker.call("export", { ...target, revision: 2, format: "step" });
    const bodies = cad.fromStep(Buffer.from(exported.data, "base64"));
    assert.deepEqual(new Set(bodies.map(body => body.name)), new Set(["底板", "支柱"]));
    near(bodies.reduce((sum, body) => sum + body.volume, 0), 525);
    bodies.forEach(body => body.dispose());
    const assembly = await worker.call("build", { ...target, expectedRevision: 2, source: `function build(p,cad){
      return cad.assembly([{id:'base',name:'底座',shape:cad.Box(10,10,4)},
        {id:'lid',name:'盖板',shape:cad.Box(10,10,1).translate(0,0,8)}]);
    }` });
    assert.equal(assembly.design.entities.length, 2);
    const rename = await worker.call("edit", { ...target, expectedRevision: 3,
      operations: [{ op: "rename", part: "lid", target: { name: "盖板", one: true }, name: "检修盖板" }] });
    assert.deepEqual(rename.design.parts.map(part => [part.id, part.name]), [["base", "底座"], ["lid", "检修盖板"]]);
    near(rename.design.metrics.volume, 500);
  } finally { await worker.dispose(); await rm(dataDir, { recursive: true, force: true }); }
});
