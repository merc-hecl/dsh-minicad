import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorker } from "../src/host/worker.js";

test(
  "real kernel: revisions, invalid build rollback, PDF and exports survive restart",
  { timeout: 120000 },
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "minicad-test-"));
    let worker = createWorker({ dataDir });
    try {
      const project = await worker.call("create", { title: "参数化底板" });
      const projectId = project.id;
      const source =
        'from build123d import Box, Cylinder, Pos\ndef build(p):\n    return Pos(70,-20,30) * (Box(p["width"],40,8) - Cylinder(4,8))\n';
      const result = await worker.call("build", {
        projectId,
        expectedRevision: 0,
        source,
        parameters: { width: 60 },
        checks: [{ metric: "sizeX", expression: "width" }],
      });
      assert.equal(result.head, 1);
      assert.ok(
        Math.abs(
          result.design.metrics.volume - (60 * 40 * 8 - Math.PI * 16 * 8),
        ) < 1e-6,
      );
      assert.ok(result.design.mesh.triangles.length > 20);
      for (const [index, expected] of [
        [0, [60, 40]],
        [1, [60, 8]],
        [2, [40, 8]],
      ]) {
        const points = result.design.views[index].paths.flatMap(
          (p) => p.points,
        );
        for (const axis of [0, 1])
          assert.ok(
            Math.abs(
              Math.max(...points.map((p) => p[axis])) -
                Math.min(...points.map((p) => p[axis])) -
                expected[axis],
            ) < 1e-6,
            "orthographic dimensions must be independent of model position",
          );
      }
      await assert.rejects(
        worker.call("build", {
          projectId,
          expectedRevision: 0,
          parameters: { width: 80 },
        }),
        /已更新/,
      );
      await assert.rejects(
        worker.call("build", {
          projectId,
          expectedRevision: 1,
          source: "def build(p):\n return None",
        }),
        /封闭实体/,
      );
      assert.equal((await worker.call("get", { projectId })).head, 1);
      for (const format of ["step", "stl", "svg", "pdf", "zip"]) {
        const file = await worker.call("export", {
          projectId,
          revision: 1,
          format,
        });
        assert.ok(Buffer.from(file.data, "base64").length > 100);
        if (format === "pdf") {
          const attached = await worker.call("attach", {
            projectId,
            name: file.name,
            data: file.data,
          });
          const page = await worker.call("reference", {
            projectId,
            attachmentId: attached.attachments[0].id,
            page: 1,
          });
          assert.match(page.text, /60.000/);
          assert.ok(page.image.length > 1000);
        }
      }
      await assert.rejects(
        worker.call("build", {
          projectId,
          expectedRevision: 1,
          checks: [{ metric: "sizeX", expression: '__import__("os")' }],
        }),
        /尺寸表达式/,
      );
      const second = await worker.call("build", {
        projectId,
        expectedRevision: 1,
        parameters: { width: 80 },
      });
      assert.equal(second.head, 2);
      assert.equal(second.design.checks[0].expected, 80);
      const restored = await worker.call("restore", {
        projectId,
        expectedRevision: 2,
        revision: 1,
      });
      assert.equal(restored.head, 3);
      assert.equal(restored.design.parameters.width, 60);
      await worker.dispose();
      worker = createWorker({ dataDir });
      assert.equal((await worker.call("get", { projectId })).head, 3);
      await assert.rejects(
        worker.call("reference", {
          projectId,
          attachmentId: "../../anything",
          page: 1,
        }),
        /不存在/,
      );
    } finally {
      await worker.dispose();
      await rm(dataDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 200,
      });
    }
  },
);

test(
  "cancelling a running model preserves its committed revision and allows recovery",
  { timeout: 60000 },
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "minicad-cancel-"));
    const worker = createWorker({ dataDir });
    try {
      const p = await worker.call("create");
      await worker.call("build", {
        projectId: p.id,
        expectedRevision: 0,
        source:
          "from build123d import Box\ndef build(p):\n return Box(10,20,30)",
        parameters: {},
      });
      const controller = new AbortController();
      const job = worker.call(
        "build",
        {
          projectId: p.id,
          expectedRevision: 1,
          source: "def build(p):\n while True: pass",
        },
        controller.signal,
      );
      const timeout = setTimeout(() => controller.abort(), 500);
      try {
        await assert.rejects(job, /退出|取消/);
      } finally {
        clearTimeout(timeout);
      }
      const recovered = await worker.call("get", { projectId: p.id });
      assert.equal(recovered.head, 1);
      assert.equal(recovered.design.metrics.volume, 6000);
    } finally {
      await worker.dispose();
      await rm(dataDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 200,
      });
    }
  },
);
