import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorker } from "../src/host/worker.js";

const upsert = element => ({ op: "upsert", element });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.01, `${actual} != ${expected}`);
const part = (project, id) => project.design.parts.find(element => element.id === id);

test("building edits recut the host wall and preserve the other parts and saved versions", { timeout: 120000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "minicad-building-"));
  const worker = createWorker({ dataDir });
  try {
    const project = await worker.call("create");
    const target = { projectId: project.id, modelFile: "model.smp" };
    const exterior = { kind: "wall", id: "south-wall", name: "南外墙", start: [0, 0], end: [4000, 0], thickness: 200 };
    const partition = { kind: "wall", id: "west-wall", name: "西墙", start: [0, 100], end: [0, 3100], thickness: 180, height: 2500 };
    const window = { kind: "opening", id: "window-1", name: "南窗", wallId: exterior.id, offset: 900, width: 1000, height: 1200, sill: 850, filling: "window" };
    const doorway = { kind: "opening", id: "doorway-1", name: "西墙门洞", wallId: partition.id, offset: 350, width: 850, height: 2100, sill: 0, filling: "none" };
    const slab = { kind: "slab", id: "slab-1", name: "楼板", outline: [[-90, -100], [4000, -100], [4000, 3100], [-90, 3100]], thickness: 150 };
    const trial = await worker.call("edit_building", { ...target, expectedRevision: 0, summary: "创建单层建筑", commit: false, operations: [
      { op: "set_level", level: { elevation: 150, height: 2700 } }, upsert(exterior), upsert(partition), upsert(window), upsert(doorway), upsert(slab),
    ] });
    assert.equal((await worker.call("get", target)).head, 0);
    const details = await worker.call("read_building", { ...target, runId: trial.runId, kind: "opening" });
    assert.deepEqual(details.building.elements, [window, doorway]);
    const initial = await worker.call("commit", { ...target, expectedRevision: 0, runId: trial.runId, summary: "保存单层建筑" });
    assert.equal(initial.head, 1);
    near(part(initial, exterior.id).volume, 4000 * 200 * 2700 - 1000 * 200 * 1200);
    near(part(initial, window.id).center[0], 1400);
    near(part(initial, window.id).center[2], 1600);
    near(part(initial, partition.id).volume, 3000 * 180 * 2500 - 850 * 180 * 2100);
    near(part(initial, slab.id).center[2], 75);
    assert.equal(part(initial, doorway.id), undefined);

    const shifted = { ...window, offset: 1750 };
    const edited = await worker.call("edit_building", { ...target, expectedRevision: 1, summary: "移动南窗", operations: [upsert(shifted)] });
    assert.equal(edited.head, 2);
    assert.deepEqual(edited.diagnostics.buildingChanges.rebuiltPartIds, [exterior.id, window.id]);
    near(part(edited, window.id).center[0], 2250);
    near(part(edited, exterior.id).volume, part(initial, exterior.id).volume);
    for (const id of [partition.id, slab.id]) {
      const before = part(initial, id), after = part(edited, id);
      near(after.volume, before.volume);
      after.center.forEach((value, axis) => near(value, before.center[axis]));
    }
    const fit = await worker.call("fit", { ...target, expectedRevision: 2, pairs: [{ from: exterior.id, to: window.id }] });
    near(fit.items[0].interferenceVolume, 0);

    const taller = await worker.call("edit_building", { ...target, expectedRevision: 2, summary: "抬高默认墙高", operations: [
      { op: "set_level", level: { elevation: 150, height: 2950 } },
    ] });
    assert.deepEqual(taller.diagnostics.buildingChanges.rebuiltPartIds, [exterior.id]);
    near(part(taller, exterior.id).size[2], 2950);
    near(part(taller, partition.id).size[2], 2500);

    const beforeFailure = await readFile(join(project.directory, "model.smp"));
    await assert.rejects(worker.call("edit_building", { ...target, expectedRevision: 3, summary: "缩短南墙", operations: [
      upsert({ ...exterior, end: [2000, 0] }),
    ] }), { code: "OPENING_OUTSIDE_WALL" });
    assert.deepEqual(await readFile(join(project.directory, "model.smp")), beforeFailure);
    assert.equal((await worker.call("get", target)).head, 3);

    const direct = await worker.call("read_building", { ...target, elementId: window.id });
    assert.deepEqual(direct.building.elements, [shifted]);
    const restored = await worker.call("restore", { ...target, expectedRevision: 3, revision: 1 });
    near(part(restored, window.id).center[0], 1400);
    assert.deepEqual((await worker.call("read_building", { ...target, elementId: window.id })).building.elements, [window]);
  } finally {
    await worker.dispose();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("building panels advertise their recipe and save geometric and semantic edits together", { timeout: 120000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "minicad-building-panel-"));
  const worker = createWorker({ dataDir });
  try {
    const project = await worker.call("create");
    const target = { projectId: project.id, modelFile: "model.smp" };
    assert.deepEqual(project.parameterPanelRecipes, []);
    const wall = { kind: "wall", id: "front-wall", name: "外墙", start: [0, 0], end: [4000, 0], thickness: 200 };
    const opening = { kind: "opening", id: "window-1", name: "外窗", wallId: wall.id, offset: 1000, width: 900, height: 1100, sill: 800, filling: "window" };
    const initial = await worker.call("edit_building", { ...target, expectedRevision: 0, summary: "创建外墙与窗", operations: [
      { op: "set_level", level: { elevation: 0, height: 2600 } }, upsert(wall), upsert(opening),
    ] });
    assert.deepEqual(initial.parameterPanelRecipes, ["buildingOperations"]);
    const priorProcess = (await worker.call("process_state", target)).id;
    const fields = [
      { key: "wallHeight", type: "number", label: { zh: "墙高", en: "Wall height" }, value: 2600, min: 1800, max: 3200, unit: "mm" },
      { key: "sill", type: "number", label: { zh: "窗台高", en: "Sill height" }, value: 800, min: 600, max: 1500, unit: "mm" },
    ];
    const panel = { title: { zh: "建筑尺寸", en: "Building dimensions" }, fields,
      checks: [
        { measurement: { kind: "size", axis: "z", target: { part: wall.id, one: true } }, expected: { parameter: "wallHeight" }, tolerance: 0.001 },
        { measurement: { kind: "coordinate", entity: { kind: "solids", selector: { part: opening.id, one: true } },
          axis: "z", at: "min" }, expected: { parameter: "sill" }, tolerance: 0.001 },
      ],
    };
    const base = { ...target, expectedRevision: 1 };
    await assert.rejects(worker.call("publish_panel", { ...base, panel: { ...panel, source: "function build(p,cad){return cad.current;}" } }),
      error => error.code === "PANEL_RECIPE_UNSUPPORTED" && error.details.parameterPanelRecipes.join() === "buildingOperations");
    assert.equal((await worker.call("process_state", target)).id, priorProcess);

    panel.buildingOperations = [
      { op: "set_level", level: { elevation: 0, height: { parameter: "wallHeight" } } },
      upsert({ ...opening, sill: { parameter: "sill" } }),
    ];
    const { parameterPanel } = await worker.call("publish_panel", { ...base, panel });
    await assert.rejects(worker.call("publish_panel", { ...base, panel: { ...panel, buildingOperations: [
      ...panel.buildingOperations, upsert({ ...wall, height: 2600 }),
    ] } }), /面板初始值未保持当前模型/);
    assert.equal((await worker.call("get", target)).parameterPanel.id, parameterPanel.id);

    const params = { ...base, panelId: parameterPanel.id, values: { wallHeight: 2800, sill: 950 } };
    const preview = await worker.call("preview_panel", params);
    near(preview.parts.find(item => item.id === wall.id).size[2], 2800);
    near(preview.parts.find(item => item.id === opening.id).center[2], 1500);
    assert.deepEqual((await worker.call("read_building", target)).building, initial.design.building);

    await assert.rejects(worker.call("apply_panel", { ...params, values: { wallHeight: 1800, sill: 950 } }), { code: "OPENING_OUTSIDE_WALL" });
    assert.equal((await worker.call("get", target)).head, 1);
    const saved = await worker.call("apply_panel", params);
    assert.equal(saved.head, 2);
    assert.equal(saved.revisions[0].actor, "user");
    assert.equal(saved.design.validation.passed, true);
    assert.equal(saved.design.building.level.height, 2800);
    assert.equal(saved.design.building.elements.find(item => item.id === opening.id).sill, 950);
    assert.deepEqual(saved.parameterPanel.fields.map(field => field.value), [2800, 950]);
    near(part(saved, wall.id).volume, 4000 * 200 * 2800 - 900 * 200 * 1100);
    near(part(saved, opening.id).center[2], 1500);
    const original = await worker.call("read_building", { ...target, revision: 1 });
    assert.deepEqual(original.building, initial.design.building);
    const restored = await worker.call("restore", { ...target, expectedRevision: 2, revision: 1 });
    assert.deepEqual(restored.parameterPanel.fields.map(field => field.value), [2600, 800]);
  } finally {
    await worker.dispose();
    await rm(dataDir, { recursive: true, force: true });
  }
});
