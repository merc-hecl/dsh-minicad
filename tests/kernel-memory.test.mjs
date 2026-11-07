import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createWorker } from "../src/host/worker.js";
import { hashFile } from "../src/kernel/files.js";
import { decodePreview } from "../src/shared/preview.js";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
async function setup(fn, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "minicad-memory-"));
  const worker = createWorker({ dataDir: root, ...options });
  try {
    await fn(worker, root);
  } finally {
    await worker.dispose();
    assert.ok(
      resolve(root).startsWith(resolve(tmpdir()) + sep) &&
        basename(root).startsWith("minicad-memory-"),
    );
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 200,
    });
  }
}

test(
  "idle reads start no processes and retain isolated serialized builds",
  { timeout: 60000 },
  async () => {
    let starts = 0,
      active = 0,
      peak = 0;
    await setup(
      async (worker) => {
        const task = await worker.call("create");
        await worker.call("bind", {
          projectId: task.id,
          sessionId: "memory-session",
        });
        const target = {
          projectId: task.id,
          modelFile: "model.smp",
        };
        assert.equal(starts, 0);
        const source =
          "function build(p,cad){ globalThis.__minicadMemoryProbe = true; return cad.Box(p.width,20,30).named('参数块'); }";
        const built = await worker.call("build", {
          ...target,
          expectedRevision: 0,
          source,
          parameters: { width: 10 },
        });
        assert.equal(starts, 1);
        assert.equal(
          globalThis.__minicadMemoryProbe,
          undefined,
          "model source must never run inside the caller",
        );
        for (let i = 0; i < 10; i++) {
          await worker.call("list");
          const state = await worker.call("get", target);
          near(state.design.metrics.volume, 6000);
          assert.equal(state.design.mesh, undefined);
          await worker.call("by_session", { sessionId: "memory-session" });
        }
        const preview = await worker.call("preview_file", {
          ...target,
          revision: 1,
        });
        assert.ok(decodePreview(await readFile(preview.path)).indices.length);
        assert.equal(
          starts,
          1,
          "idle metadata calls and opening a saved preview start no process",
        );
        const metadataFile = join(task.directory, "model.state.json");
        const originalMetadata = await readFile(metadataFile);
        await writeFile(metadataFile, JSON.stringify({ changed: true }));
        const external = await worker.call("get", target);
        assert.equal(external.workingTreeChanged, true);
        assert.notEqual(external.modelVersion, built.modelVersion);
        await writeFile(metadataFile, originalMetadata);
        const [updated, queued] = await Promise.all([
          worker.call("build", { ...target, expectedRevision: 1, source, parameters: { width: 12 } }),
          worker.call("get", target),
        ]);
        assert.equal(updated.head, 2);
        assert.equal(
          queued.head,
          2,
          "local reads must wait for the same transaction queue",
        );
        near(queued.design.metrics.volume, 7200);
        assert.equal(peak, 1);
        assert.equal(starts, 2);
      },
      {
        spawnProcess: (...args) => {
          starts++;
          active++;
          peak = Math.max(peak, active);
          const child = spawn(...args);
          child.once("close", () => active--);
          return child;
        },
      },
    );
  },
);

test(
  "missing previews regenerate only in an isolated process without changing committed geometry",
  { timeout: 60000 },
  async () => {
    let starts = 0;
    await setup(
      async (worker) => {
        const task = await worker.call("create");
        const args = { projectId: task.id };
        const built = await worker.call("build", {
          ...args,
          expectedRevision: 0,
          source: "function build(p,cad){return cad.Box(10,20,30).named('长方体')}",
          parameters: {},
        });
        const binary = await readFile(join(task.directory, "model.smp"));
        const preview = await worker.call("preview_file", { ...args, revision: 1 });
        await rm(preview.path);
        const metadata = await worker.call("get", args);
        assert.equal(metadata.head, 1);
        assert.equal(starts, 1);
        const regenerated = await worker.call("preview_file", { ...args, revision: 1 });
        const refreshed = await worker.call("get", args);
        assert.equal(starts, 2);
        assert.ok(decodePreview(await readFile(regenerated.path)).indices.length > 0);
        assert.equal(refreshed.head, 1);
        assert.equal(refreshed.revisions.length, 1);
        await worker.call("get", { projectId: task.id });
        assert.equal(starts, 2);
        assert.deepEqual(
          await readFile(join(task.directory, "model.smp")),
          binary,
        );
      },
      {
        spawnProcess: (...args) => {
          starts++;
          return spawn(...args);
        },
      },
    );
  },
);

// Fault injection at the process boundary; all successful geometry requests use
// the real service. No attempt is made to exhaust the user's system memory.
function failedAllocation() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  setImmediate(() => {
    child.stderr.end(
      "[low_level_alloc.cc : 590] RAW: Check new_pages != nullptr failed: VirtualAlloc failed",
    );
    child.stdout.end();
    child.exitCode = 3221226505;
    child.emit("close", child.exitCode);
  });
  return child;
}
test(
  "transient allocation failures retry reads once, never replay writes and honor cancellation",
  { timeout: 30000 },
  async () => {
    let starts = 0,
      mode = "once";
    await setup(
      async (worker) => {
        assert.match((await worker.call("health")).kernel, /SMLib/);
        assert.equal(starts, 2);
        const task = await worker.call("create");
        mode = "fail";
        const beforeWrite = starts;
        await assert.rejects(
          worker.call("build", {
            projectId: task.id,
            expectedRevision: 0,
            source: "function build(p,cad){return cad.Box(1,2,3).named('长方体')}",
            parameters: {},
          }),
          /VirtualAlloc/,
        );
        assert.equal(starts, beforeWrite + 1);
        assert.equal(
          (await worker.call("get", { projectId: task.id })).head,
          0,
        );
        const beforeRead = starts;
        await assert.rejects(worker.call("health"), /VirtualAlloc/);
        assert.equal(starts, beforeRead + 2);
        const controller = new AbortController(),
          beforeCancel = starts;
        const cancelled = worker.call("health", {}, controller.signal);
        const timer = setTimeout(() => controller.abort(), 30);
        try {
          await assert.rejects(cancelled, /取消/);
        } finally {
          clearTimeout(timer);
        }
        assert.equal(starts, beforeCancel + 1);
        mode = "normal";
        const beforeDomainError = starts;
        await assert.rejects(
          worker.call("measure", {
            projectId: task.id,
            expectedRevision: 0,
            measurements: [{ kind: "volume" }],
          }),
          /请先完成建模/,
        );
        assert.equal(
          starts,
          beforeDomainError + 1,
          "domain errors must not be retried",
        );
      },
      {
        spawnProcess: (...args) => {
          starts++;
          return mode === "fail" || (mode === "once" && starts === 1)
            ? failedAllocation()
            : spawn(...args);
        },
      },
    );
  },
);

test(
  "Windows cancellation frees the kernel even when process-tree termination hangs",
  { skip: process.platform !== "win32", timeout: 10000 },
  async () => {
    let helper;
    await setup(
      async (worker) => {
        const task = await worker.call("create");
        await worker.call("build", {
          projectId: task.id,
          expectedRevision: 0,
          source: "function build(p,cad){return cad.Box(1,2,3).named('长方体')}",
          parameters: {},
        });
        const controller = new AbortController();
        const pending = worker.call(
          "build",
          {
            projectId: task.id,
            expectedRevision: 1,
            source: "function build(){while(true){}}",
          },
          controller.signal,
        );
        const timer = setTimeout(() => controller.abort(), 600);
        try {
          await assert.rejects(pending, /取消/);
        } finally {
          clearTimeout(timer);
        }
        assert.ok(helper.killed);
        const saved = await worker.call("get", {
          projectId: task.id,
        });
        assert.equal(saved.head, 1);
        near(saved.design.metrics.volume, 6);
      },
      {
        spawnProcess: (command, ...args) => {
          if (command !== "taskkill") return spawn(command, ...args);
          helper = new EventEmitter();
          helper.kill = () => {
            helper.killed = true;
            return true;
          };
          return helper;
        },
      },
    );
  },
);

test("large resource fingerprints use bounded buffers and distinguish missing files", async () => {
  await setup(async (_worker, root) => {
    const file = join(root, "large-resource.bin");
    const bytes = Buffer.alloc(2 * 1024 * 1024, 0x61);
    await writeFile(file, bytes);
    const expected = createHash("sha256").update(bytes).digest("hex");
    let maxRead = 0;
    const original = fs.readSync;
    const reads = mock.method(
      fs,
      "readSync",
      function (fd, buffer, offset, length, position) {
        maxRead = Math.max(maxRead, length);
        return original.call(this, fd, buffer, offset, length, position);
      },
    );
    try {
      assert.equal(hashFile(file), expected);
    } finally {
      reads.mock.restore();
    }
    assert.ok(maxRead <= 64 * 1024);
    assert.equal(hashFile(join(root, "missing.bin")), null);
  });
});
