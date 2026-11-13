import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as cad from "@classcad/smlibwasm";
import { unzipSync } from "fflate";
import { createWorker } from "../src/host/worker.js";

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);
const label = (zh, en = zh) => ({ zh, en });
const sizeCheck = (axis, expected) => ({ measurement: { kind: "size", axis }, expected, tolerance: 1e-6 });

test("direct panel adjustments preserve holes, use a fixed baseline across restarts, retain failures and branch with their version", { timeout: 120000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "minicad-panel-"));
  let worker = createWorker({ dataDir });
  try {
    const project = await worker.call("create");
    const target = { projectId: project.id, modelFile: "model.smp" };
    await worker.call("edit", { ...target, expectedRevision: 0, summary: "双孔底板", operations: [
      { op: "box", size: [40, 30, 6], name: "安装底板" },
      ...[-10, 10].map(x => ({ op: "cut", tool: { shape: "cylinder", radius: 2.5, height: 20, center: [x, 0, 0] } })),
      { op: "color", color: "#528BCC" },
    ] });
    const definition = {
      title: label("调整底板厚度", "Adjust plate thickness"),
      fields: [{ key: "thickness", type: "number", label: label("厚度", "Thickness"), value: 6, min: 3, max: 12, step: 0.5, unit: "mm" }],
      source: `function build(p, cad) {
        if (p.thickness === 6) return cad.current;
        return cad.edit(cad.current, [{op:"offset_faces", faces:{position:"top",one:true}, distance:p.thickness-6}]);
      }`,
      checks: [sizeCheck("z", { parameter: "thickness" }), sizeCheck("x", 40), sizeCheck("y", 30),
        { measurement: { kind: "size", axis: "z" }, min: 5 },
        { measurement: { kind: "count", entityKind: "holes" }, expected: 2 }],
    };
    const published = await worker.call("publish_panel", { ...target, expectedRevision: 1, panel: definition });
    const panelId = published.parameterPanel.id;
    assert.equal(published.head, 1);
    const current = await worker.call("get", target);
    assert.equal(current.revisions.length, 1);
    assert.equal(current.revisions[0].actor, "agent");
    assert.equal((await worker.call("process_state", target)).actor, "agent");
    assert.equal((await worker.call("process_state", target)).purpose, "panel_validation");
    assert.equal((await worker.call("process_state", target)).phase, "done");
    assert.equal((await worker.call("process_history", { ...target, revision: 1 })).length, 1);
    assert.equal(current.workingTreeChanged, false);
    const applied = await worker.call("apply_panel", { ...target, expectedRevision: 1, panelId, values: { thickness: 8 } });
    assert.equal(applied.head, 2);
    assert.equal(applied.revisions[0].actor, "user");
    const recorded = JSON.parse(await readFile(join(project.directory, ".cad-design.json"), "utf8"));
    assert.equal(recorded.models["model.smp"].revisions.at(-1).actor, "user");
    near(applied.design.metrics.volume, (40 * 30 - 2 * Math.PI * 2.5 ** 2) * 8);
    assert.equal(applied.design.validation.passed, true);
    await worker.dispose(); worker = createWorker({ dataDir });
    assert.equal((await worker.call("get", target)).revisions[0].actor, "user");
    const second = await worker.call("apply_panel", { ...target, expectedRevision: 2, panelId, values: { thickness: 9 }, language: "en" });
    assert.equal(second.head, 3);
    assert.equal((await worker.call("process_state", target)).actor, "user");
    near(second.design.metrics.volume, (40 * 30 - 2 * Math.PI * 2.5 ** 2) * 9);
    assert.equal(second.parameterPanel.fields[0].value, 9);
    const process = await worker.call("process_history", { ...target, revision: 3 });
    assert.equal(process.length, 1);
    assert.equal(process[0].inputRevision, 1);
    assert.equal(process[0].baseRevision, 2);
    assert.equal(process[0].steps.length, 1);
    assert.deepEqual(process[0].changes.map(({ key, from, to }) => ({ key, from, to })), [{ key: "thickness", from: 8, to: 9 }]);
    const holes = (await worker.call("query", { ...target, expectedRevision: 3, kind: "holes" })).items;
    assert.equal(holes.length, 2);
    for (const hole of holes) { near(hole.hole.diameter, 5); near(Math.abs(hole.hole.center[0]), 10); assert.equal(hole.hole.through, true); }
    const solids = (await worker.call("query", { ...target, expectedRevision: 3, kind: "solids" })).items;
    assert.equal(solids[0].name, "安装底板");
    assert.equal(solids[0].color, "#528BCC");
    const files = ["model.smp", "model.state.json", ".cad-design.json"];
    const before = await Promise.all(files.map(file => readFile(join(project.directory, file))));
    for (const values of [{ thickness: 4 }, { thickness: 20 }, { thickness: 8, extra: 1 }])
      await assert.rejects(worker.call("apply_panel", { ...target, expectedRevision: 3, panelId, values }));
    await assert.rejects(worker.call("apply_panel", { ...target, expectedRevision: 1, panelId, values: { thickness: 7 } }), error => error.status === 409);
    const unchanged = await worker.call("apply_panel", { ...target, expectedRevision: 3, panelId, values: { thickness: 9 } });
    assert.equal(unchanged.committed, false);
    for (let i = 0; i < files.length; i++) assert.deepEqual(await readFile(join(project.directory, files[i])), before[i]);
    const restored = await worker.call("restore", { ...target, expectedRevision: 3, revision: 1 });
    assert.equal(restored.parameterPanel.fields[0].value, 6);
    const branch = await worker.call("apply_panel", { ...target, expectedRevision: 1, panelId, values: { thickness: 7 } });
    assert.equal(branch.head, 4);
    assert.equal(branch.revisions[0].parent, 1);
    assert.equal(branch.revisions[0].actor, "user");
    near(branch.design.metrics.volume, (40 * 30 - 2 * Math.PI * 2.5 ** 2) * 7);
    const exported = await worker.call("export", { ...target, revision: 4, format: "step" });
    const readback = cad.fromStep(await readFile(exported.path, "utf8"));
    try { assert.ok(readback.isValid()); near(readback.volume, branch.design.metrics.volume); } finally { readback.dispose(); }
    const zip = await worker.call("export", { ...target, revision: 4, format: "zip" });
    const archive = unzipSync(await readFile(zip.path));
    assert.ok(archive["panel.json"] && archive["panel/model.smp"] && archive["panel/state.json"]);
    const statePath = join(project.directory, "model.state.json");
    const state = await readFile(statePath);
    await writeFile(statePath, Buffer.concat([state, Buffer.from(" ")]));
    await assert.rejects(worker.call("apply_panel", { ...target, expectedRevision: 4, panelId, values: { thickness: 8 } }), error => error.status === 409);
    await writeFile(statePath, state);
    const agentEdit = await worker.call("edit", { ...target, expectedRevision: 4, summary: "新增边孔", operations: [
      { op: "cut", tool: { shape: "cylinder", radius: 1, height: 20, center: [0, 10, 0] } },
    ] });
    assert.equal(agentEdit.revisions[0].actor, "agent");
    assert.equal((await worker.call("get", target)).parameterPanel, null);
    const legacy = JSON.parse(await readFile(join(project.directory, ".cad-design.json"), "utf8"));
    for (const entry of legacy.models["model.smp"].revisions) delete entry.actor;
    await writeFile(join(project.directory, ".cad-design.json"), JSON.stringify(legacy));
    const recovered = (await worker.call("get", target)).revisions;
    assert.equal(recovered.find(entry => entry.revision === 1).actor, "agent");
    assert.equal(recovered.find(entry => entry.revision === 4).actor, "user");
  } finally { await worker.dispose(); await rm(dataDir, { recursive: true, force: true }); }
});

test("structured recipes resolve pinned geometry references and reject a mismatched default without replacing the usable panel", { timeout: 120000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "minicad-panel-recipe-"));
  const worker = createWorker({ dataDir });
  try {
    const project = await worker.call("create");
    const target = { projectId: project.id, modelFile: "model.smp" };
    await worker.call("edit", { ...target, expectedRevision: 0, operations: [{ op: "box", size: [10, 20, 6], name: "基块" }] });
    const faces = await worker.call("query", { ...target, expectedRevision: 1, kind: "faces", selector: { position: "top", one: true } });
    const definition = { title: label("顶部增量", "Top offset"), fields: [
      { key: "offset", type: "number", label: label("偏移", "Offset"), value: 0, min: 0, max: 5, unit: "mm" },
    ], operations: [{ op: "offset_faces", faces: faces.items[0].id, distance: { parameter: "offset" } }],
    checks: [sizeCheck("x", 10), sizeCheck("y", 20), { measurement: { kind: "size", axis: "z" }, min: 6 }] };
    const { parameterPanel } = await worker.call("publish_panel", { ...target, expectedRevision: 1, panel: definition });
    await assert.rejects(worker.call("publish_panel", { ...target, expectedRevision: 1,
      panel: { ...definition, operations: [{ op: "translate", by: [20, 0, 0] }] } }), /初始值/);
    const current = await worker.call("get", target);
    assert.equal(current.parameterPanel.id, parameterPanel.id);
    const failedValidation = await worker.call("process_state", target);
    assert.equal(failedValidation.phase, "error");
    assert.equal(failedValidation.purpose, "panel_validation");
    assert.ok(failedValidation.error);
    assert.equal((await worker.call("process_history", { ...target, revision: 1 })).length, 1);
    for (const [expectedRevision, offset] of [[1, 1], [2, 2]]) {
      const result = await worker.call("apply_panel", { ...target, expectedRevision, panelId: parameterPanel.id, values: { offset } });
      near(result.design.metrics.volume, 10 * 20 * (6 + offset));
    }
  } finally { await worker.dispose(); await rm(dataDir, { recursive: true, force: true }); }
});

test("choice, toggle and integer controls drive one checked assembly revision while preserving the other part", { timeout: 120000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "minicad-panel-assembly-"));
  const worker = createWorker({ dataDir });
  try {
    const project = await worker.call("create");
    const target = { projectId: project.id, modelFile: "assembly.smp" };
    await worker.call("build", { ...target, expectedRevision: 0, source: `function build(p,cad) {
      return cad.assembly([{id:"base",name:"底座",shape:cad.Box(10,10,4)}, {id:"cover",name:"盖板",shape:cad.Box(10,10,2).translate(0,0,12).colored("#0000FF")}]);
    }` });
    const panel = { title: label("盖板规格", "Cover options"), part: "cover", fields: [
      { key: "layers", type: "integer", label: label("层数", "Layers"), value: 1, min: 1, max: 3 },
      { key: "wide", type: "toggle", label: label("加宽", "Wider"), value: false },
      { key: "finish", type: "choice", label: label("颜色", "Color"), value: "blue", options: [
        { value: "blue", label: label("蓝", "Blue") }, { value: "red", label: label("红", "Red") },
      ] },
    ], source: `function build(p,cad) {
      let shape = cad.current;
      if(p.layers!==1 || p.wide) shape = cad.edit(shape,[{op:"scale",factor:[p.wide ? 1.2 : 1,1,p.layers]}]);
      return shape.colored(p.finish==="red" ? "#FF0000" : "#0000FF");
    }`, checks: [{ measurement: { kind: "size", axis: "z", target: { part: "cover", one: true } }, min: 2, max: 6 }] };
    const published = await worker.call("publish_panel", { ...target, expectedRevision: 1, panel });
    for (const values of [{ layers: 1.5, wide: false, finish: "blue" }, { layers: 1, wide: false, finish: "green" }])
      await assert.rejects(worker.call("apply_panel", { ...target, expectedRevision: 1, panelId: published.parameterPanel.id, values }));
    const result = await worker.call("apply_panel", { ...target, expectedRevision: 1, panelId: published.parameterPanel.id,
      values: { layers: 2, wide: true, finish: "red" } });
    assert.equal(result.head, 2);
    const parts = (await worker.call("query", { ...target, expectedRevision: 2, kind: "parts" })).items;
    near(parts.find(part => part.id === "base").volume, 400);
    near(parts.find(part => part.id === "cover").volume, 480);
    assert.equal(parts.find(part => part.id === "cover").color, "#FF0000");
    const recolored = await worker.call("apply_panel", { ...target, expectedRevision: 2, panelId: published.parameterPanel.id,
      values: { layers: 2, wide: true, finish: "blue" } });
    const process = (await worker.call("process_history", { ...target, revision: recolored.head }))[0];
    assert.equal(process.steps.length, 1);
    assert.equal(process.steps[0].parts.length, 2);
    assert.deepEqual(process.changes.map(({ key, from, to }) => ({ key, from, to })), [{ key: "finish", from: "red", to: "blue" }]);
  } finally { await worker.dispose(); await rm(dataDir, { recursive: true, force: true }); }
});
