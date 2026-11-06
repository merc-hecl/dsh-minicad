import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as cad from "@classcad/smlibwasm";
import { previewShape } from "../src/kernel/model.js";
import { topologyItems } from "../src/kernel/inspection.js";
import { createWorker } from "../src/host/worker.js";
import { decodePreview, encodePreview } from "../src/shared/preview.js";
import {
  defaultIdFormats,
  geometryLabel,
  geometryReference,
} from "../src/shared/geometry-ids.js";

test("preview owners match exact faces and all BREP edges, including appended seams", () => {
  const shape = cad.Box(30, 20, 8).cut(cad.Cylinder(3, 10));
  try {
    const preview = decodePreview(encodePreview(previewShape(shape)));
    const faces = shape.faces(),
      edges = topologyItems(shape, "edges");
    assert.equal(preview.faceIndices.length, preview.indices.length / 3);
    assert.equal(preview.edgeIndices.length, preview.edges.length / 6);
    assert.equal(new Set(preview.faceIndices).size, faces.length);
    assert.equal(new Set(preview.edgeIndices).size, edges.length);
    for (let i = 0; i < preview.faceIndices.length; i++) {
      const face = faces[preview.faceIndices[i]],
        box = face.bbox();
      for (let corner = 0; corner < 3; corner++) {
        const at = preview.indices[i * 3 + corner] * 3;
        const point = Array.from(preview.positions.subarray(at, at + 3));
        for (const [axis, name] of ["x", "y", "z"].entries()) {
          assert.ok(
            point[axis] >= box.min[name] - 1e-5 &&
              point[axis] <= box.max[name] + 1e-5,
          );
        }
        if (face.geomType === "cylinder")
          assert.ok(Math.abs(Math.hypot(point[0], point[1]) - 3) < 1e-5);
        if (face.geomType === "plane") {
          const center = face.center(),
            normal = face.normalAt();
          assert.ok(
            Math.abs(
              (point[0] - center.x) * normal.x +
                (point[1] - center.y) * normal.y +
                (point[2] - center.z) * normal.z,
            ) < 1e-5,
          );
        }
      }
    }
    for (let i = 0; i < edges.length; i++) {
      const segments = [];
      for (let j = 0; j < preview.edgeIndices.length; j++)
        if (preview.edgeIndices[j] === i) segments.push(j);
      const first = segments[0] * 6,
        last = segments.at(-1) * 6 + 3;
      for (const [offset, parameter] of [
        [first, 0],
        [last, 1],
      ]) {
        const point = edges[i].pointAt(parameter);
        assert.ok(
          Math.hypot(
            ...["x", "y", "z"].map(
              (axis, j) => preview.edges[offset + j] - point[axis],
            ),
          ) < 1e-5,
        );
      }
    }
    const standard = shape.edges();
    for (let i = 0; i < standard.length; i++)
      assert.ok(edges[i].equals(standard[i]));
    assert.ok(
      edges.length > standard.length,
      "cylinder seam must also be selectable",
    );
  } finally {
    shape.dispose();
  }
});

test(
  "preview IDs and scoped queries survive restart and restore saved geometry",
  { timeout: 60000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "minicad-selection-"));
    let worker = createWorker({ dataDir: root });
    try {
      const task = await worker.call("create");
      const args = { projectId: task.id, sourceFile: "model.js" };
      const source =
        "function build(p,cad){return cad.Box(p.width,20,8).cut(cad.Cylinder(3,10));}";
      const built = await worker.call("build", {
        ...args,
        source,
        parameters: { width: 30 },
        expectedRevision: 0,
      });
      const previewFile = await worker.call("preview_file", {
        ...args,
        revision: 1,
      });
      const preview = decodePreview(await readFile(previewFile.path));
      for (const [kind, owners] of [
        ["faces", preview.faceIndices],
        ["edges", preview.edgeIndices],
      ]) {
        const items = (
          await worker.call("query", { ...args, expectedRevision: 1, kind })
        ).items;
        for (const index of new Set(owners)) {
          assert.equal(
            items[index].id,
            geometryReference(built.design.geometryScope, 1, kind, index),
          );
          assert.equal(
            items[index].displayId,
            geometryLabel(kind, index, built.design.geometryIds),
          );
        }
        // Query reads the serialized solid in a fresh process. Its ordering must
        // still agree with the ownership saved during the original build.
        for (let i = 0; i < owners.length; i++) {
          const bounds = items[owners[i]].bounds;
          const points =
            kind === "faces"
              ? Array.from(
                  preview.indices.subarray(i * 3, i * 3 + 3),
                  (index) =>
                    preview.positions.subarray(index * 3, index * 3 + 3),
                )
              : [
                  preview.edges.subarray(i * 6, i * 6 + 3),
                  preview.edges.subarray(i * 6 + 3, i * 6 + 6),
                ];
          for (const point of points)
            for (let axis = 0; axis < 3; axis++)
              assert.ok(
                point[axis] >= bounds.min[axis] - 1e-5 &&
                  point[axis] <= bounds.max[axis] + 1e-5,
              );
        }
        assert.equal(items[0].displayId, kind === "faces" ? "F-1" : "E-1");
      }
      await worker.dispose();
      worker = createWorker({ dataDir: root });
      const second = await worker.call("build", {
        ...args,
        expectedRevision: 1,
        parameters: { width: 40 },
      });
      assert.deepEqual(second.design.geometryIds, defaultIdFormats);
      assert.equal(
        (
          await worker.call("query", {
            ...args,
            expectedRevision: 2,
            kind: "faces",
          })
        ).items[0].displayId,
        "F-1",
      );
      assert.equal(
        (
          await worker.call("query", {
            ...args,
            expectedRevision: 2,
            kind: "edges",
          })
        ).items[9].displayId,
        "E-10",
      );
      const restored = await worker.call("restore", {
        ...args,
        expectedRevision: 2,
        revision: 1,
      });
      assert.equal(restored.head, 1);
      assert.deepEqual(restored.design.geometryIds, defaultIdFormats);
      assert.equal(
        (
          await worker.call("query", {
            ...args,
            expectedRevision: 1,
            kind: "faces",
          })
        ).items[0].displayId,
        "F-1",
      );
      assert.ok(
        Math.abs(restored.design.metrics.volume - built.design.metrics.volume) <
          1e-6,
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

test("numbering changes commit a restorable revision without rebuilding the model", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "minicad-numbering-"));
  const worker = createWorker({ dataDir: root });
  t.after(async () => {
    await worker.dispose();
    await rm(root, { recursive: true, force: true });
  });
  const task = await worker.call("create");
  const args = { projectId: task.id, sourceFile: "model.js" };
  const source = "function build(p,cad){return cad.Box(p.width,20,8);}";
  const built = await worker.call("build", { ...args, source, parameters: { width: 30 }, expectedRevision: 0 });
  const workingFile = join(built.directory, args.sourceFile);
  const draft = "// Unfinished draft";
  await writeFile(workingFile, draft);
  const setFormats = (expectedRevision, formats) => worker.call("set_geometry_id_format", {
    ...args, expectedRevision, summary: "Change face and edge numbering", ...formats,
  });
  const query = async (expectedRevision, kind) => (
    await worker.call("query", { ...args, expectedRevision, kind })
  ).items;

  await assert.rejects(setFormats(1, { faceFormat: "Face-{n}-{n}" }), /numbering placeholder/);
  const changed = await setFormats(1, { faceFormat: "Face-{n:3}", edgeFormat: "Edge-{n:3}" });
  assert.equal(changed.head, 2);
  assert.equal(changed.committed, true);
  assert.equal(await readFile(workingFile, "utf8"), draft);
  assert.equal((await query(2, "faces"))[0].displayId, "Face-001");
  assert.equal((await query(2, "edges"))[9].displayId, "Edge-010");
  const previousPreview = await worker.call("preview_file", { ...args, revision: 1 });
  const changedPreview = await worker.call("preview_file", { ...args, revision: 2 });
  assert.deepEqual(await readFile(changedPreview.path), await readFile(previousPreview.path));
  await assert.rejects(setFormats(1, { edgeFormat: "Line-{n}" }), { status: 409 });
  assert.equal((await setFormats(2, { edgeFormat: "Edge-{n:3}" })).committed, false);

  await writeFile(workingFile, source);
  const rebuilt = await worker.call("update_parameters", { ...args, expectedRevision: 2, parameters: { width: 40 } });
  assert.equal(rebuilt.head, 3);
  assert.equal((await query(3, "faces"))[0].displayId, "Face-001");
  const restored = await worker.call("restore", { ...args, expectedRevision: 3, revision: 1 });
  assert.equal((await query(restored.head, "faces"))[0].displayId, "F-1");
  assert.equal((await query(restored.head, "edges"))[0].displayId, "E-1");
  const branch = await worker.call("set_geometry_id_format", { ...args, expectedRevision: 1, faceFormat: "Branch-{n}" });
  assert.equal(branch.head, 4);
  assert.equal((await query(4, "faces"))[0].displayId, "Branch-1");
});
