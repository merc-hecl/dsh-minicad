import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { createWorker } from "../src/host/worker.js";
import { decodePreview } from "../src/shared/preview.js";

const near = (a, b, tolerance = 1e-6) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test("structured operations: exact primitive volumes, shell, offsets and transforms", async () => {
  const { editShape } = await import("../src/kernel/model.js");
  for (const [operation, volume] of [
    [{ op: "sphere", radius: 2 }, (4 / 3) * Math.PI * 8],
    [{ op: "cone", bottomRadius: 2, topRadius: 1, height: 3 }, 7 * Math.PI],
    [{ op: "torus", majorRadius: 8, minorRadius: 2 }, 64 * Math.PI ** 2],
    [
      {
        op: "extrude",
        profile: { shape: "rectangle", size: [10, 20] },
        amount: 5,
      },
      1000,
    ],
    [
      {
        op: "extrude",
        profile: {
          shape: "polygon",
          points: [
            [0, 0],
            [10, 0],
            [0, 20],
          ],
        },
        amount: 5,
      },
      500,
    ],
  ]) {
    const shape = editShape(null, [operation]);
    assert.ok(shape.isValid());
    near(shape.volume, volume);
    shape.dispose();
  }
  const box = { op: "box", size: [10, 20, 30] };
  const shell = editShape(null, [
    box,
    { op: "shell", thickness: 1, faces: { position: "top" } },
  ]);
  assert.ok(shell.isValid());
  near(shell.volume, 6000 - 8 * 18 * 29);
  const offset = editShape(null, [
    box,
    { op: "offset_faces", faces: { position: "top" }, distance: 2 },
  ]);
  assert.ok(offset.isValid());
  near(offset.volume, 6400);
  const moved = editShape(null, [
    box,
    { op: "translate", by: [15, 0, 0] },
    { op: "mirror", normal: [1, 0, 0] },
  ]);
  near(moved.volume, 6000);
  near(moved.center().x, -15);
});
async function setup(fn, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "minicad-smlib-"));
  const worker = createWorker({ dataDir, ...options });
  try {
    await fn(worker, dataDir);
  } finally {
    await worker.dispose();
    await rm(dataDir, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 200,
    });
  }
}

test(
  "SMLib: real parametric geometry, exports and immutable restore",
  { timeout: 90000 },
  async () =>
    setup(async (worker) => {
      assert.match((await worker.call("health")).kernel, /SMLib.*0\.6\.2/);
      const p = await worker.call("create", { title: "参数化底板" });
      const source =
        "function build(p,cad) { return cad.Box(p.width,40,8).cut(cad.Cylinder(4,10)).translate(70,-20,30).named('孔板'); }";
      const built = await worker.call("build", {
        projectId: p.id,
        expectedRevision: 0,
        source,
        parameters: { width: 60 },
      });
      near(built.design.metrics.volume, 60 * 40 * 8 - Math.PI * 16 * 8);
      assert.equal(built.design.metrics.solidCount, 1);
      assert.equal(built.design.metrics.valid, true);
      assert.equal(built.design.mesh, undefined);
      const previewFile = await worker.call("preview_file", {
        projectId: p.id,
        revision: 1,
      });
      assert.ok(
        decodePreview(await readFile(previewFile.path)).indices.length > 60,
      );
      const original = await readFile(join(p.directory, "model.smp"));
      await assert.rejects(
        worker.call("build", {
          projectId: p.id,
          expectedRevision: 0,
          parameters: { width: 80 },
        }),
        /已更新/,
      );
      await assert.rejects(
        worker.call("build", {
          projectId: p.id,
          expectedRevision: 1,
          source: "function build(){return null;}",
        }),
        /封闭实体/,
      );
      assert.deepEqual(
        await readFile(join(p.directory, "model.smp")),
        original,
      );
      await rm(join(p.directory, "model.js"));
      await assert.rejects(
        worker.call("edit", {
          projectId: p.id,
          expectedRevision: 1,
          operations: [{ op: "box", size: [1, 1, 1] }],
        }),
        /源码或参数已修改/,
      );
      assert.equal((await worker.call("get", { projectId: p.id })).head, 1);
      await writeFile(join(p.directory, "model.js"), source);
      for (const format of ["step", "stl", "smb", "zip"]) {
        const exported = await worker.call("export", {
          projectId: p.id,
          revision: 1,
          format,
          locale: "zh",
        });
        const bytes = Buffer.from(exported.data, "base64");
        assert.ok(bytes.length > 100);
        assert.deepEqual(await readFile(exported.path), bytes);
        if (format === "step") {
          const cad = await import("@classcad/smlibwasm");
          const back = cad.fromStep(bytes.toString());
          near(back.volume, built.design.metrics.volume);
          assert.ok(back.isValid());
          back.dispose();
        }
        if (format === "zip") {
          const files = unzipSync(bytes);
          assert.equal(strFromU8(files["model.js"]), source);
          assert.ok(files["model.smp"].length);
        }
      }
      const second = await worker.call("build", {
        projectId: p.id,
        expectedRevision: 1,
        parameters: { width: 80 },
      });
      near(second.design.metrics.sizeX, 80);
      near(second.design.metrics.volume, 80 * 40 * 8 - Math.PI * 16 * 8);
      const restored = await worker.call("restore", {
        projectId: p.id,
        expectedRevision: 2,
        revision: 1,
      });
      assert.equal(restored.head, 1);
      assert.deepEqual(restored.revisions.map(entry => entry.revision), [2, 1]);
      near(restored.design.metrics.volume, built.design.metrics.volume);
      assert.equal(restored.design.parameters.width, 60);
      const persisted = await worker.call("get", { projectId: p.id });
      assert.equal(persisted.head, 1);
      assert.equal(persisted.design.checks, undefined);
      const cad = await import("@classcad/smlibwasm");
      near(
        cad.fromSmp(await readFile(join(p.directory, "model.smp"))).volume,
        built.design.metrics.volume,
      );
      const base = { projectId: p.id, sourceFile: "model.js", expectedRevision: 1 };
      await assert.rejects(worker.call("restore", { ...base, expectedRevision: 2, revision: 2 }), /设计已更新/);
      const trial = await worker.call("edit", { ...base, commit: false,
        operations: [{ op: "scale", factor: [0.5, 1, 1] }] });
      const candidate = await worker.call("query", { ...base, runId: trial.runId, kind: "faces" });
      assert.equal(candidate.revision, 3);
      const branch = await worker.call("commit", { ...base, runId: trial.runId });
      assert.deepEqual(branch.revisions.map(entry => [entry.revision, entry.parent]), [[3, 1], [2, 1], [1, null]]);
      near(branch.design.metrics.sizeX, 30);
      const run = await worker.call("process_state", base);
      assert.equal(run.committedRevision, 3);
      assert.deepEqual(run.steps.map(step => step.operation), ["scale"]);
      const other = await worker.call("restore", { ...base, expectedRevision: 3, revision: 2 });
      assert.equal(other.head, 2);
      near(other.design.metrics.sizeX, 80);
      const again = await worker.call("restore", { ...base, expectedRevision: 2, revision: 3 });
      assert.equal(again.head, 3);
      near(again.design.metrics.sizeX, 30);
    }),
);

test(
  "query/edit: fillet, through hole, blind hole, stale ids and parameter replay",
  { timeout: 90000 },
  async () =>
    setup(async (worker) => {
      const p = await worker.call("create");
      const base = await worker.call("edit", {
        projectId: p.id,
        expectedRevision: 0,
        parameters: { length: 30 },
        operations: [
          { op: "box", size: [{ parameter: "length" }, 10, 5], name: "底板" },
          { op: "fillet", edges: { parallelTo: [0, 0, 1] }, radius: 0.5 },
          { op: "cut", tool: { shape: "cylinder", radius: 1, height: 7 } },
        ],
      });
      near(base.design.metrics.volume, 1483.2190275490384);
      const query = await worker.call("query", {
        projectId: p.id,
        expectedRevision: 1,
        kind: "faces",
        selector: { position: "front", geomType: "plane" },
      });
      assert.equal(query.items.length, 1);
      assert.deepEqual(
        query.items[0].normal.map((n) => Math.round(n)),
        [0, -1, 0],
      );
      const blind = await worker.call("edit", {
        projectId: p.id,
        expectedRevision: 1,
        operations: [
          {
            op: "cut",
            tool: {
              shape: "cylinder",
              radius: 1,
              height: 3,
              rotate: { axis: [1, 0, 0], angle: 90 },
              center: [0, -5.5, 0],
            },
          },
        ],
      });
      near(blind.design.metrics.volume, 1480.0774348954483);
      assert.equal(blind.design.metrics.faceCount, 13);
      await assert.rejects(
        worker.call("edit", {
          projectId: p.id,
          expectedRevision: 2,
          operations: [
            { op: "move_faces", faces: query.items[0].id, by: [0, -1, 0] },
          ],
        }),
        /过期/,
      );
      const rebuilt = await worker.call("build", {
        projectId: p.id,
        expectedRevision: 2,
        parameters: { length: 40 },
      });
      near(rebuilt.design.metrics.volume, blind.design.metrics.volume + 500);
      const cylinder = await worker.call("query", {
        projectId: p.id,
        expectedRevision: 3,
        kind: "faces",
        selector: { geomType: "cylinder" },
      });
      assert.ok(cylinder.items.length >= 2);
    }),
);

test(
  "imported exact resources stay portable and historical exports retain original geometry",
  { timeout: 60000 },
  async () =>
    setup(async (worker) => {
      const p = await worker.call("create"),
        cad = await import("@classcad/smlibwasm");
      await mkdir(join(p.directory, "resources"));
      await writeFile(
        join(p.directory, "resources", "input.step"),
        cad.toStep(cad.Box(12, 15, 7)),
      );
      const result = await worker.call("build", {
        projectId: p.id,
        expectedRevision: 0,
        sourceFile: "parts/plate.js",
        source:
          'function build(p,cad) { return cad.readModel("resources/input.step").named("导入零件"); }',
        parameters: {},
      });
      near(result.design.metrics.volume, 1260);
      const archive = unzipSync(
        Buffer.from(
          (
            await worker.call("export", {
              projectId: p.id,
              revision: 1,
              format: "zip",
            })
          ).data,
          "base64",
        ),
      );
      assert.ok(archive["resources/input.step"]);
      await writeFile(
        join(p.directory, "resources", "input.step"),
        cad.toStep(cad.Box(2, 3, 4)),
      );
      assert.equal(
        (await worker.call("get", { projectId: p.id })).workingTreeChanged,
        true,
      );
      await assert.rejects(
        worker.call("edit", {
          projectId: p.id,
          expectedRevision: 1,
          operations: [{ op: "translate", by: [1, 0, 0] }],
        }),
        /源码或参数已修改/,
      );
      const rebuilt = await worker.call("build", {
        projectId: p.id,
        expectedRevision: 1,
      });
      near(rebuilt.design.metrics.volume, 24);
      const old = await worker.call("export", {
        projectId: p.id,
        revision: 1,
        format: "step",
      });
      near(
        cad.fromStep(Buffer.from(old.data, "base64").toString()).volume,
        1260,
      );
      const restored = await worker.call("restore", {
        projectId: p.id,
        expectedRevision: 2,
        revision: 1,
      });
      near(restored.design.metrics.volume, 1260);
      const after = await worker.call("build", {
        projectId: p.id,
        expectedRevision: 1,
      });
      assert.equal(after.head, 3);
      near(after.design.metrics.volume, 1260);
    }),
);

test(
  "cancellation and timeout preserve committed geometry and recover in a fresh kernel",
  { timeout: 60000 },
  async () =>
    setup(
      async (worker) => {
        const p = await worker.call("create");
        await worker.call("build", {
          projectId: p.id,
          expectedRevision: 0,
          source: "function build(p,cad){ return cad.Box(10,20,30).named('长方体'); }",
          parameters: {},
        });
        const controller = new AbortController(),
          job = worker.call(
            "build",
            {
              projectId: p.id,
              expectedRevision: 1,
              source: "function build(){ while(true){} }",
            },
            controller.signal,
          );
        const timer = setTimeout(() => controller.abort(), 600);
        try {
          await assert.rejects(job, /取消/);
        } finally {
          clearTimeout(timer);
        }
        const result = await worker.call("get", { projectId: p.id });
        assert.equal(result.head, 1);
        near(result.design.metrics.volume, 6000);
        await assert.rejects(
          worker.call("build", {
            projectId: p.id,
            expectedRevision: 1,
            source: "function build(){ while(true){} }",
          }),
          /超时/,
        );
        assert.equal((await worker.call("get", { projectId: p.id })).head, 1);
      },
      { timeout: 1800 },
    ),
);
