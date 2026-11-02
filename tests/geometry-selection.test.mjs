import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
      assert.equal(restored.head, 3);
      assert.deepEqual(restored.design.geometryIds, defaultIdFormats);
      assert.equal(
        (
          await worker.call("query", {
            ...args,
            expectedRevision: 3,
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
