import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as cad from "@classcad/smlibwasm";
import { createWorker } from "../src/host/worker.js";

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);

test("initial structured modeling records all operations; an incremental chamfer records only the new operation and survives exact export", { timeout: 120000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "minicad-incremental-"));
  let worker = createWorker({ dataDir });
  try {
    const project = await worker.call("create");
    const args = { projectId: project.id, modelFile: "model.smp" };
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
    const files = ["model.smp", "model.state.json", ".cad-design.json"];
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
    const exported = await worker.call("export", { ...args, revision: 2, format: "step" });
    const readback = cad.fromStep(await readFile(exported.path, "utf8"));
    try { assert.ok(readback.isValid()); near(readback.volume, committed.design.metrics.volume); }
    finally { readback.dispose(); }
  } finally { await worker.dispose(); await rm(dataDir, { recursive: true, force: true }); }
});
