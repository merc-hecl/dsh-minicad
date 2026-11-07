import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as cad from "@classcad/smlibwasm";
import { editShape } from "../src/kernel/model.js";
import { createWorker } from "../src/host/worker.js";
import { decodePreview } from "../src/shared/preview.js";
import {
  nextGeometryAnnotation,
  serializeGeometryAnnotation,
} from "../src/shared/geometry-annotations.js";

const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);

test("local face and edge operations heal exact solids", () => {
  const shapes = [];
  const keep = (shape) => (shapes.push(shape), shape);
  try {
    const box = keep(cad.Box(10, 20, 30));
    const rounded = keep(
      editShape(box, [
        { op: "fillet", edges: { parallelTo: [0, 0, 1] }, radius: 1 },
      ]),
    );
    near(rounded.volume, 6000 - (4 - Math.PI) * 30);
    const unrounded = keep(
      editShape(rounded, [
        { op: "remove_fillets", faces: { geomType: "cylinder" } },
      ]),
    );
    assert.ok(unrounded.isValid());
    near(unrounded.volume, 6000);
    const bevelled = keep(
      editShape(box, [
        { op: "chamfer", edges: { parallelTo: [0, 0, 1] }, distance: 1 },
      ]),
    );
    assert.ok(bevelled.isValid());
    near(bevelled.volume, 5940);
    const cylinder = keep(cad.Cylinder(1, 40));
    const drilled = keep(box.cut(cylinder));
    const healed = keep(
      editShape(drilled, [
        { op: "remove_faces", faces: { geomType: "cylinder" } },
      ]),
    );
    assert.ok(healed.isValid());
    near(healed.volume, 6000);
  } finally {
    for (const shape of shapes) shape.dispose();
  }
});

test(
  "geometry annotations round trip and identify the exact face for an agent edit",
  { timeout: 90000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "minicad-editing-"));
    const worker = createWorker({ dataDir: root });
    try {
      const task = await worker.call("create");
      const args = {
        projectId: task.id,
        sourceFile: "model.js",
        preserveSelection: true,
        geometry: false,
      };
      await worker.call("build", {
        ...args,
        expectedRevision: 0,
        source: "function build(p,cad){return cad.Box(p.width,20,30).named('参数块');}",
        parameters: { width: 10 },
      });
      const top = (
        await worker.call("query", {
          ...args,
          expectedRevision: 1,
          kind: "faces",
          selector: { position: "top" },
        })
      ).items[0];
      const annotation = await worker.call("geometry_annotation", {
        ...args,
        expectedRevision: 1,
        reference: top.id,
        note: '抬高 2 mm\n保留孔；<minicad-geometry-reference>"',
      });
      assert.equal(annotation.projectId, task.id);
      assert.equal(annotation.label, top.displayId);
      assert.equal(annotation.kind, "faces");
      assert.deepEqual(annotation.geometry, top);
      assert.equal(annotation.expectedRevision, 1);
      const edge = (
        await worker.call("query", {
          ...args,
          expectedRevision: 1,
          kind: "edges",
        })
      ).items[0];
      const batch = await worker.call("geometry_annotation", {
        ...args, expectedRevision: 1, references: [top.id, edge.id], note: "检查加工余量",
      });
      assert.deepEqual(batch.items.map(item => item.reference), [top.id, edge.id]);
      assert.deepEqual(batch.items.map(item => item.geometry), [top, edge]);
      assert.ok(batch.items.every(item => item.note === "检查加工余量" && item.expectedRevision === 1));
      const edgeAnnotation = batch.items[1];
      assert.equal(edgeAnnotation.kind, "edges");
      const message = `修改 ${serializeGeometryAnnotation(annotation)} 和 ${serializeGeometryAnnotation(edgeAnnotation)}`;
      const first = nextGeometryAnnotation(message);
      const second = nextGeometryAnnotation(message, first.end);
      assert.deepEqual(first.data, annotation);
      assert.deepEqual(second.data, edgeAnnotation);
      assert.equal(nextGeometryAnnotation(message, second.end), undefined);
      assert.equal(
        (await worker.call("get", args)).head,
        1,
        "annotations must not create revisions",
      );

      const summary = `Agent edit ${top.displayId}: move face`;
      const edited = await worker.call("edit", {
        ...args,
        expectedRevision: 1,
        summary,
        operations: [{ op: "move_faces", faces: first.data.reference, by: [0, 0, 2] }],
      });
      assert.equal(edited.head, 2);
      near(edited.design.metrics.volume, 6400);
      assert.deepEqual(edited.parameters, { width: 10 });
      assert.equal(edited.revisions[0].summary, summary);
      assert.equal(edited.revisions[0].parent, 1);
      const previewFile = await worker.call("preview_file", {
        ...args,
        revision: 2,
      });
      const preview = decodePreview(await readFile(previewFile.path));
      let maxZ = -Infinity;
      for (let i = 2; i < preview.positions.length; i += 3)
        maxZ = Math.max(maxZ, preview.positions[i]);
      near(maxZ, top.center[2] + 2);
      await assert.rejects(
        worker.call("geometry_annotation", {
          ...args,
          expectedRevision: 2,
          reference: top.id,
        }),
        /stale/,
      );
    } finally {
      await worker.dispose();
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 200,
      });
    }
  },
);

test("selected face and edge batches measure and edit the same saved geometry in one revision", { timeout: 90000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "minicad-multi-selection-"));
  let worker = createWorker({ dataDir: root });
  try {
    const task = await worker.call("create");
    const args = { projectId: task.id, sourceFile: "model.js", geometry: false };
    const built = await worker.call("build", { ...args, expectedRevision: 0, source: "function build(p,cad){return cad.Box(20,10,4).named('底板');}" });
    const faces = (await worker.call("query", { ...args, expectedRevision: 1, kind: "faces" })).items;
    const top = faces.find(face => face.normal[2] > .9), bottom = faces.find(face => face.normal[2] < -.9);
    const edge = (await worker.call("query", { ...args, expectedRevision: 1, kind: "edges", selector: { parallelTo: [1, 0, 0] } })).items[0];
    const measured = await worker.call("measure", { ...args, expectedRevision: 1, measurements: [
      { kind: "length", entity: { kind: "edges", selector: edge.id } },
      { kind: "area", entity: { kind: "faces", selector: top.id } },
    ] });
    near(measured.items[0].value, 20); assert.equal(measured.items[0].unit, "mm");
    near(measured.items[1].value, 200); assert.equal(measured.items[1].unit, "mm2");
    const offset = await worker.call("edit", { ...args, expectedRevision: 1, operations: [{ op: "offset_faces", faces: [top.id, bottom.id], distance: 1 }] });
    assert.equal(offset.head, 2); near(offset.design.metrics.volume, 1200);
    const edges = (await worker.call("query", { ...args, expectedRevision: 2, kind: "edges", selector: { parallelTo: [0, 0, 1] } })).items;
    assert.equal(edges.length, 4);
    const rounded = await worker.call("edit", { ...args, expectedRevision: 2, operations: [{ op: "fillet", edges: edges.map(item => item.id), radius: 1 }] });
    assert.equal(rounded.head, 3); near(rounded.design.metrics.volume, 1200 - (4 - Math.PI) * 6);
    const solidFile = join(built.workspaceDirectory, "model.smp"), before = await readFile(solidFile);
    await assert.rejects(worker.call("geometry_annotation", { ...args, expectedRevision: 3, references: [edges[0].id, top.id] }), /stale/);
    await assert.rejects(worker.call("edit", { ...args, expectedRevision: 3, operations: [{ op: "fillet", edges: edges.map(item => item.id), radius: 1 }] }), /stale/);
    assert.deepEqual(await readFile(solidFile), before); assert.equal((await worker.call("get", args)).head, 3);
    await worker.dispose(); worker = createWorker({ dataDir: root });
    const resumed = await worker.call("get", args);
    assert.equal(resumed.head, 3); near(resumed.design.metrics.volume, rounded.design.metrics.volume);
    const exported = await worker.call("export", { ...args, revision: 3, format: "smb" });
    const readback = cad.fromSmb(await readFile(exported.path));
    try { near(readback.volume, rounded.design.metrics.volume); } finally { readback.dispose(); }
  } finally { await worker.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("agent edit trials preserve saved files and commit a checked replayable batch as one version", { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "minicad-agent-trial-"));
  const worker = createWorker({ dataDir: root });
  try {
    const task = await worker.call("create");
    const args = { projectId: task.id, sourceFile: "model.js", geometry: false, expectedRevision: 1 };
    const built = await worker.call("build", { ...args, expectedRevision: 0,
      source: "function build(p,cad){return cad.Box(20,10,p.thickness).named('底板');}", parameters: { thickness: 4 } });
    const before = await readFile(join(built.workspaceDirectory, "model.smp"));
    const sourceBefore = await readFile(join(built.workspaceDirectory, "model.js"));
    const top = (await worker.call("query", { ...args, kind: "faces", selector: { position: "top" } })).items[0];
    const operations = [{ op: "offset_faces", faces: top.id, distance: 3 },
      { op: "scale", factor: [2, 1, 1] }, { op: "rotate", axis: [0, 0, 1], angle: 90 }];
    const trial = await worker.call("edit", { ...args, commit: false, operations,
      checks: [{ measurement: { kind: "size", axis: "z" }, expected: 7, tolerance: 1e-6 }] });
    near(trial.metrics.volume, 2800); near(trial.metrics.sizeX, 10); near(trial.metrics.sizeY, 40);
    assert.equal(trial.validation.passed, true);
    const candidate = await worker.call("query", { ...args, runId: trial.runId, kind: "faces", selector: { position: "top" } });
    near(candidate.items[0].center[2], 5);
    assert.equal((await worker.call("get", args)).head, 1);
    assert.deepEqual(await readFile(join(built.workspaceDirectory, "model.js")), sourceBefore);
    assert.deepEqual(await readFile(join(built.workspaceDirectory, "model.smp")), before);
    const committed = await worker.call("commit", { ...args, runId: trial.runId, summary: "Agent face offset, scale and rotation" });
    assert.equal(committed.head, 2); assert.equal(committed.revisions.length, 2);
    near(committed.design.metrics.volume, 2800);
    assert.equal(committed.design.validation.passed, true);
    const replayed = await worker.call("update_parameters", { ...args, expectedRevision: 2, parameters: { thickness: 6 } });
    near(replayed.design.metrics.volume, 3600);
  } finally { await worker.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("rotating a face about an explicit center and scaling preserve exact valid solids", () => {
  const base = cad.Box(10, 20, 30);
  const tilted = editShape(base, [{ op: "rotate_faces", faces: { position: "top" }, axis: [1, 0, 0], angle: 5, origin: [0, 0, 15] }]);
  const scaled = editShape(base, [{ op: "scale", factor: 2, origin: [3, 0, 0] }]);
  try {
    assert.ok(tilted.isValid()); near(tilted.volume, 6000);
    near(tilted.bbox().max.z, 15 + 10 * Math.tan(5 * Math.PI / 180));
    assert.ok(scaled.isValid()); near(scaled.volume, 48000);
    near(scaled.bbox().min.x, -13); near(scaled.bbox().max.x, 7);
  } finally { tilted.dispose(); scaled.dispose(); base.dispose(); }
});
