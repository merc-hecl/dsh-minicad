import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as cad from "@classcad/smlibwasm";
import { createWorker } from "../src/host/worker.js";

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);

test("initial structured modeling records all operations; an incremental chamfer records only the new operation and replays exactly", { timeout: 120000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "minicad-incremental-"));
  let worker = createWorker({ dataDir });
  try {
    const project = await worker.call("create");
    const args = { projectId: project.id, sourceFile: "model.js" };
    const trial = await worker.call("edit", { ...args, expectedRevision: 0, commit: false,
      parameters: { length: 80, thickness: 6 }, operations: [
        { op: "box", size: [{ parameter: "length" }, 50, { parameter: "thickness" }], name: "四孔底板" },
        ...[[-32, -17], [32, -17], [-32, 17], [32, 17]].map(([x, y]) => ({
          op: "cut", tool: { shape: "cylinder", radius: 2.5, height: 10, center: [x, y, 0] },
        })),
      ] });
    near(trial.metrics.volume, 80 * 50 * 6 - 4 * Math.PI * 2.5 ** 2 * 6);
    assert.equal((await worker.call("get", args)).head, 0);
    assert.deepEqual((await worker.call("process_state", args)).steps.map(step => step.operation), ["box", "cut", "cut", "cut", "cut"]);
    const built = await worker.call("commit", { ...args, expectedRevision: 0, runId: trial.runId });
    assert.equal(built.head, 1);
    const edges = (await worker.call("query", { ...args, expectedRevision: 1, kind: "edges" })).items
      .filter(edge => edge.type === "line" && Math.abs(edge.bounds.max[2] - edge.bounds.min[2]) < 1e-6);
    assert.equal(edges.length, 8);
    const files = ["model.js", "model.parameters.json", "model.smp", ".cad-design.json"];
    const before = await Promise.all(files.map(file => readFile(join(project.directory, file))));
    const bevel = await worker.call("edit", { ...args, expectedRevision: 1, commit: false,
      operations: [{ op: "chamfer", edges: edges.map(edge => edge.id), distance: 0.5 }],
      checks: [{ measurement: { kind: "size", axis: "z" }, expected: 6, tolerance: 1e-6 }],
    });
    assert.equal(bevel.validation.passed, true);
    const process = await worker.call("process_state", args);
    assert.equal(process.baseRevision, 1);
    assert.deepEqual(process.steps.map(step => step.operation), ["chamfer"]);
    for (let i = 0; i < files.length; i++) assert.deepEqual(await readFile(join(project.directory, files[i])), before[i]);
    await worker.dispose(); worker = createWorker({ dataDir });
    const committed = await worker.call("commit", { ...args, expectedRevision: 1, runId: bevel.runId });
    assert.equal(committed.head, 2);
    assert.equal(committed.revisions[0].parent, 1);
    const holes = (await worker.call("query", { ...args, expectedRevision: 2, kind: "holes" })).items;
    assert.equal(holes.length, 4);
    for (const hole of holes) {
      near(hole.hole.diameter, 5);
      assert.equal(hole.hole.through, true);
      near(Math.abs(hole.hole.center[0]), 32); near(Math.abs(hole.hole.center[1]), 17);
    }
    await worker.call("build", { ...args, expectedRevision: 2 });
    const difference = await worker.call("compare", { ...args, baseRevision: 3, targetRevision: 2 });
    assert.equal(difference.added, null); assert.equal(difference.removed, null);
    near(difference.unchanged.volume, committed.design.metrics.volume);
    const resized = await worker.call("update_parameters", { ...args, expectedRevision: 3, parameters: { length: 90 } });
    near(resized.design.metrics.sizeX, 90);
    near(resized.design.metrics.volume, 90 * 50 * 6 - 4 * Math.PI * 2.5 ** 2 * 6 - 2 * (90 + 50) * 0.5 ** 2 + 8 * 0.5 ** 3 / 3);
    const exported = await worker.call("export", { ...args, revision: 4, format: "step" });
    const readback = cad.fromStep(await readFile(exported.path, "utf8"));
    try { assert.ok(readback.isValid()); near(readback.volume, resized.design.metrics.volume); }
    finally { readback.dispose(); }
  } finally { await worker.dispose(); await rm(dataDir, { recursive: true, force: true }); }
});

test("editing a saved custom model skips its source, imports new resources and rebuilds existing features only when parameters change", { timeout: 120000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "minicad-edit-base-"));
  const worker = createWorker({ dataDir });
  try {
    const project = await worker.call("create");
    const args = { projectId: project.id, sourceFile: "model.js" };
    const counter = join(project.directory, "base-runs.txt");
    const source = `function build(p,cad) {
      const fs=require('node:fs'), path=require('node:path').join(__dirname,'base-runs.txt');
      fs.writeFileSync(path,String((fs.existsSync(path)?Number(fs.readFileSync(path,'utf8')):0)+1));
      const part=cad.Box(p.width,10,p.thickness).named('参数底板'); cad.checkpoint(part,'base'); return part;
    }`;
    await worker.call("build", { ...args, expectedRevision: 0, source, parameters: { width: 20, thickness: 6 } });
    assert.equal(await readFile(counter, "utf8"), "1");
    await mkdir(join(project.directory, "resources"));
    const tool = cad.Cylinder(1, 12);
    try { await writeFile(join(project.directory, "resources/tool.smb"), cad.toSmb(tool)); }
    finally { tool.dispose(); }
    const cut = await worker.call("edit", { ...args, expectedRevision: 1,
      parameters: { thickness: 6, width: 20 },
      operations: [{ op: "cut", tool: { shape: "import", file: "resources/tool.smb" } }],
    });
    assert.equal(await readFile(counter, "utf8"), "1", "ordinary edits must not execute previous custom source");
    near(cut.design.metrics.volume, 1200 - 6 * Math.PI);
    assert.deepEqual((await worker.call("process_state", args)).steps.map(step => step.operation), ["cut"]);
    assert.deepEqual(cut.design.assets, ["resources/tool.smb"]);
    const resized = await worker.call("edit", { ...args, expectedRevision: 2,
      parameters: { width: 24, thickness: 8 }, operations: [{ op: "translate", by: [2, 0, 0] }],
    });
    assert.equal(await readFile(counter, "utf8"), "2");
    near(resized.design.metrics.sizeX, 24); near(resized.design.metrics.sizeZ, 8);
    near(resized.design.metrics.volume, 1920 - 8 * Math.PI);
    assert.deepEqual((await worker.call("process_state", args)).steps.map(step => step.operation), ["translate"]);
    await worker.call("build", { ...args, expectedRevision: 3 });
    assert.equal(await readFile(counter, "utf8"), "3");
    const difference = await worker.call("compare", { ...args, baseRevision: 4, targetRevision: 3 });
    assert.equal(difference.added, null); assert.equal(difference.removed, null);
    near(difference.unchanged.volume, resized.design.metrics.volume);
  } finally { await worker.dispose(); await rm(dataDir, { recursive: true, force: true }); }
});

test("first edit uses unbuilt working source when present and treats a blank file as an empty model", { timeout: 60000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "minicad-initial-source-"));
  const worker = createWorker({ dataDir });
  try {
    const project = await worker.call("create");
    for (const [sourceFile, source, operations, volume] of [
      ["blank.js", " \n", [{ op: "box", size: [10, 20, 6], name: "底板" }], 1200],
      ["custom.js", "function build(p,cad){return cad.Box(10,20,6).named('底板');}",
        [{ op: "cut", tool: { shape: "cylinder", radius: 1, height: 10 } }], 1200 - 6 * Math.PI],
    ]) {
      await writeFile(join(project.directory, sourceFile), source);
      const args = { projectId: project.id, sourceFile };
      const built = await worker.call("edit", { ...args, expectedRevision: 0, operations });
      assert.equal(built.head, 1); near(built.design.metrics.volume, volume);
      await worker.call("build", { ...args, expectedRevision: 1 });
      const difference = await worker.call("compare", { ...args, baseRevision: 2, targetRevision: 1 });
      assert.equal(difference.added, null); assert.equal(difference.removed, null);
      near(difference.unchanged.volume, volume);
    }
  } finally { await worker.dispose(); await rm(dataDir, { recursive: true, force: true }); }
});
