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
  "geometry annotations and manual edits share exact targets, preview, replay and revision persistence",
  { timeout: 90000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "minicad-editing-"));
    let worker = createWorker({ dataDir: root });
    try {
      const task = await worker.call("create");
      const args = {
        projectId: task.id,
        sourceFile: "model.js",
        preserveSelection: true,
        geometry: false,
      };
      const built = await worker.call("build", {
        ...args,
        expectedRevision: 0,
        source: "function build(p,cad){return cad.Box(p.width,20,30);}",
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
      const edgeAnnotation = await worker.call("geometry_annotation", {
        ...args,
        expectedRevision: 1,
        reference: edge.id,
      });
      assert.equal(edgeAnnotation.kind, "edges");
      near(edgeAnnotation.geometry.length, edge.length);
      const batch = await worker.call("geometry_annotation", {
        ...args, expectedRevision: 1, references: [top.id, edge.id], note: "检查加工余量",
      });
      assert.deepEqual(batch.items.map(item => item.reference), [top.id, edge.id]);
      assert.deepEqual(batch.items.map(item => item.geometry), [top, edge]);
      assert.ok(batch.items.every(item => item.note === "检查加工余量" && item.expectedRevision === 1));
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

      await worker.call("build", {
        ...args,
        sourceFile: "other.js",
        expectedRevision: 0,
        source: built.source,
        parameters: built.parameters,
      });
      await assert.rejects(
        worker.call("geometry_annotation", {
          ...args,
          sourceFile: "other.js",
          expectedRevision: 1,
          reference: top.id,
        }),
        /foreign/,
      );

      const summary = `Manual edit ${top.displayId}: move face`;
      const edited = await worker.call("edit", {
        ...args,
        expectedRevision: 1,
        summary,
        operations: [{ op: "move_faces", faces: top.id, by: [0, 0, 2] }],
      });
      assert.equal(edited.head, 2);
      near(edited.design.metrics.volume, 6400);
      assert.deepEqual(edited.parameters, { width: 10 });
      assert.equal(edited.revisions[0].summary, summary);
      assert.equal(edited.revisions[0].parent, 1);
      assert.match(edited.source, /cad\.edit/);
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
          expectedRevision: 1,
          reference: top.id,
        }),
        /设计已更新/,
      );
      await assert.rejects(
        worker.call("geometry_annotation", {
          ...args,
          expectedRevision: 2,
          reference: top.id,
        }),
        /stale/,
      );
      const currentEdge = (
        await worker.call("query", {
          ...args,
          expectedRevision: 2,
          kind: "edges",
        })
      ).items[0];
      const solidBefore = await readFile(join(task.directory, "model.smb"));
      await assert.rejects(
        worker.call("edit", {
          ...args,
          expectedRevision: 2,
          operations: [{ op: "fillet", edges: currentEdge.id, radius: 1e6 }],
        }),
      );
      await assert.rejects(
        worker.call("edit", {
          ...args,
          expectedRevision: 1,
          operations: [{ op: "chamfer", edges: currentEdge.id, distance: 1 }],
        }),
        /设计已更新/,
      );
      assert.equal((await worker.call("get", args)).head, 2);
      assert.deepEqual(
        await readFile(join(task.directory, "model.smb")),
        solidBefore,
      );

      const replayed = await worker.call("update_parameters", {
        ...args,
        expectedRevision: 2,
        parameters: { width: 12 },
      });
      assert.equal(replayed.head, 3);
      near(replayed.design.metrics.volume, 7680);
      await worker.dispose();
      worker = createWorker({ dataDir: root });
      const reopened = await worker.call("get", args);
      assert.equal(reopened.head, 3);
      assert.equal(reopened.revisions[1].summary, summary);
      near(reopened.design.metrics.volume, 7680);
      const exported = await worker.call("export", {
        ...args,
        revision: 2,
        format: "step",
      });
      const readback = cad.fromStep(await readFile(exported.path, "utf8"));
      try {
        near(readback.volume, 6400);
      } finally {
        readback.dispose();
      }
      const restored = await worker.call("restore", {
        ...args,
        expectedRevision: 3,
        revision: 1,
      });
      assert.equal(restored.head, 4);
      near(restored.design.metrics.volume, 6000);
      assert.equal(restored.revisions.length, 4);
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
    const built = await worker.call("build", { ...args, expectedRevision: 0, source: "function build(p,cad){return cad.Box(20,10,4);}" });
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
    const solidFile = join(built.workspaceDirectory, "model.smb"), before = await readFile(solidFile);
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
