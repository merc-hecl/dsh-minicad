import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as cad from "@classcad/smlibwasm";
import { previewShape } from "../src/kernel/model.js";
import { encodePreview, decodePreview } from "../src/shared/preview.js";
import { createWorker } from "../src/host/worker.js";

test("binary previews retain indexed normals and BREP lines with shared array-buffer views", () => {
  const shape = cad.Box(20, 10, 4).cut(cad.Cylinder(1, 6));
  const raw = previewShape(shape),
    bytes = encodePreview(raw),
    decoded = decodePreview(bytes);
  for (const name of ["positions", "normals", "indices", "edges"]) {
    assert.equal(
      decoded[name].buffer,
      bytes.buffer,
      "decoding must not duplicate geometry buffers",
    );
    assert.deepEqual(decoded[name], raw[name]);
  }
  assert.ok(decoded.indices instanceof Uint32Array);
  assert.ok(decoded.positions instanceof Float32Array);
  const bounds = [Infinity, -Infinity];
  for (let i = 0; i < decoded.positions.length; i += 3) {
    bounds[0] = Math.min(bounds[0], decoded.positions[i]);
    bounds[1] = Math.max(bounds[1], decoded.positions[i]);
  }
  assert.deepEqual(bounds, [-10, 10]);
  const legacy = JSON.stringify({
    vertices: Array.from(raw.positions),
    normals: Array.from(raw.normals),
    triangles: Array.from(raw.indices),
    edges: Array.from(raw.edges),
  });
  assert.ok(bytes.length < Buffer.byteLength(legacy));
  shape.dispose();
});

test("preview decoding rejects truncation, invalid numeric values and out-of-range indices", () => {
  const shape = cad.Box(1, 2, 3),
    raw = previewShape(shape),
    bytes = encodePreview(raw);
  assert.throws(
    () => decodePreview(bytes.subarray(0, bytes.length - 4)),
    /预览数据无效/,
  );
  const invalidFloat = bytes.slice();
  new DataView(invalidFloat.buffer).setFloat32(36, NaN, true);
  assert.throws(() => decodePreview(invalidFloat), /预览数据无效/);
  const invalidIndex = bytes.slice();
  new DataView(invalidIndex.buffer).setUint32(
    36 + (raw.positions.length + raw.normals.length) * 4,
    raw.positions.length,
    true,
  );
  assert.throws(() => decodePreview(invalidIndex), /预览数据无效/);
  shape.dispose();
});

test(
  "previews repair from historical solids without changing working files or revisions",
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "minicad-binary-preview-"));
    const worker = createWorker({ dataDir: root });
    try {
      const task = await worker.call("create");
      const args = { projectId: task.id, sourceFile: "model.js" };
      const built = await worker.call("build", {
        ...args,
        expectedRevision: 0,
        parameters: { width: 60 },
        source:
          "function build(p,cad){return cad.Box(p.width,40,8).cut(cad.Cylinder(4,10)).named('孔板')}",
      });
      const folder = join(task.directory, built.revisions[0].folder);
      const saved = JSON.parse(
        await readFile(join(folder, "state.json"), "utf8"),
      );
      for (const name of ["mesh", "edges"])
        assert.equal(saved[name], undefined);
      const solid = await readFile(join(task.directory, "model.smp"));
      const sourceFile = join(task.directory, args.sourceFile);
      const draft = "// Unbuilt source";
      await writeFile(sourceFile, draft);
      await writeFile(
        join(task.directory, "model.parameters.json"),
        '{"width":90}',
      );
      const preview = await worker.call("preview_file", {
        ...args,
        revision: 1,
      });
      await writeFile(preview.path, "corrupt cache");
      const repaired = await worker.call("preview_file", {
        ...args,
        revision: 1,
      });
      const data = decodePreview(await readFile(repaired.path));
      let min = Infinity,
        max = -Infinity;
      for (let i = 0; i < data.positions.length; i += 3) {
        min = Math.min(min, data.positions[i]);
        max = Math.max(max, data.positions[i]);
      }
      assert.ok(
        Math.abs(max - min - 60) < 1e-5,
        "repair must use the saved solid, not unbuilt working parameters",
      );
      const state = await worker.call("get", args);
      assert.equal(state.head, 1);
      assert.equal(state.revisions.length, 1);
      assert.equal(state.parameters.width, 90);
      assert.equal(state.workingTreeChanged, true);
      assert.equal(await readFile(sourceFile, "utf8"), draft);
      assert.deepEqual(
        await readFile(join(task.directory, "model.smp")),
        solid,
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
