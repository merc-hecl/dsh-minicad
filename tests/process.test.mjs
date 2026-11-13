import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { createWorker } from "../src/host/worker.js";
import { decodePreview } from "../src/shared/preview.js";
import { unzipSync } from "fflate";

test("real checkpoints stream before commit, persist on failure/cancel, and retain the saved head", { timeout: 90000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "minicad-process-"));
  let worker = createWorker({ dataDir: root });
  try {
    const project = await worker.call("create", { title: "process" });
    const args = { projectId: project.id, modelFile: "model.smp" };
    const slowSource = `async function build(p,cad) {
      let part=cad.Box(10,20,30).named('孔板'); cad.checkpoint(part,'blank');
      await new Promise(resolve=>setTimeout(resolve,1800));
      part=part.cut(cad.Cylinder(2,40)); cad.checkpoint(part,'hole');
      return part;
    }`;
    const pending = worker.call("build", { ...args, source: slowSource, expectedRevision: 0 });
    let live;
    const until = Date.now() + 15000;
    while (!(live = worker.processState(args))?.steps.length && Date.now() < until) await delay(30);
    assert.equal(live.phase, "working");
    assert.equal(live.baseRevision, 0);
    assert.ok(Math.abs(live.steps[0].metrics.volume - 6000) < 1e-6);
    assert.equal(live.committedRevision, undefined);
    const checkpoint = await worker.call("checkpoint_file", { ...args, runId: live.id, sequence: 1 });
    const mesh = decodePreview(await readFile(checkpoint.path));
    assert.ok(mesh.positions.length);
    const saved = await pending;
    assert.equal(saved.head, 1);
    const completed = await worker.call("process_state", args);
    assert.equal(completed.phase, "done");
    assert.equal(completed.steps.length, 2);
    assert.ok(completed.steps[1].metrics.volume < 6000);
    assert.equal(completed.committedRevision, 1);
    const edited = await worker.call("edit", { ...args, expectedRevision: 1, operations: [{ op: "translate", by: [2,0,0] }, { op: "rotate", axis: [0,0,1], angle: 45 }] });
    assert.equal(edited.head, 2);
    const structured = await worker.call("process_state", args);
    assert.equal(structured.steps.at(-1).operation, "rotate");
    assert.ok(Math.abs(structured.steps.at(-1).metrics.volume - saved.design.metrics.volume) < 1e-5);
    await assert.rejects(worker.call("build", { ...args, expectedRevision: 2, source: `function build(p,cad){cad.checkpoint(cad.Box(3,4,5),'valid'); throw new Error('after-preview');}` }), /after-preview/);
    const failed = await worker.call("process_state", args);
    assert.equal(failed.phase, "error");
    assert.ok(Math.abs(failed.steps[0].metrics.volume - 60) < 1e-6);
    assert.equal((await worker.call("get", args)).head, 2);
    const controller = new AbortController();
    const canceled = worker.call("build", { ...args, expectedRevision: 2, source: slowSource.replace("1800", "60000") }, controller.signal);
    let cancellation;
    while (!(cancellation = worker.processState(args))?.steps.length || cancellation.id === failed.id) await delay(30);
    controller.abort();
    await assert.rejects(canceled, /取消/);
    assert.equal((await worker.call("process_state", args)).phase, "stopped");
    assert.equal((await worker.call("get", args)).head, 2);
    await worker.dispose();
    worker = createWorker({ dataDir: root });
    const history = await worker.call("process_history", args);
    assert.equal(history.length, 4);
    assert.equal(history[0].phase, "stopped");
    const old = await worker.call("checkpoint_file", { ...args, runId: completed.id, sequence: 2 });
    assert.ok((await readFile(old.path)).length);
    await assert.rejects(worker.call("build", { ...args, expectedRevision: 1, source: slowSource }), /版本/);
    assert.equal((await worker.call("process_history", args)).length, 4);
    await assert.rejects(worker.call("checkpoint_file", { ...args, runId: "../elsewhere", sequence: 1 }), /不存在/);
  } finally {
    await worker.dispose();
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});

test("agent trials bind to the published run across conflicts, branches, failures, save-as and archive-only replay", { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "minicad-process-bindings-"));
  let worker = createWorker({ dataDir: root });
  try {
    const project = await worker.call("create"), target = { projectId: project.id, modelFile: "model.smp" };
    await worker.call("edit", { ...target, expectedRevision: 0, operations: [{ op: "box", size: [10, 20, 30], name: "底座" }] });
    const trials = [];
    for (const x of [1, 2]) trials.push(await worker.call("edit", { ...target, expectedRevision: 1,
      commit: false, summary: `平移 ${x}`, operations: [{ op: "translate", by: [x, 0, 0] }] }));
    const bad = await worker.call("edit", { ...target, expectedRevision: 1, commit: false,
      operations: [{ op: "translate", by: [3, 0, 0] }],
      checks: [{ measurement: { kind: "size", axis: "x" }, expected: 11, tolerance: 1e-6 }] });
    assert.equal(bad.validation.passed, false);
    await assert.rejects(worker.call("commit", { ...target, expectedRevision: 1, runId: bad.runId }), /检查/);
    const rejected = await worker.call("process_state", target);
    assert.equal(rejected.id, bad.runId);
    assert.equal(rejected.phase, "preview");
    assert.equal(rejected.publicationValidation.passed, false);
    assert.ok(rejected.publicationError);
    const saved = await worker.call("commit", { ...target, expectedRevision: 1, runId: trials[1].runId, summary: "采用第二个方案" });
    assert.equal(saved.head, 2);
    const atTwo = await worker.call("process_history", { ...target, revision: 2 });
    assert.deepEqual(atTwo.map(run => run.id), [trials[1].runId]);
    assert.equal(atTwo[0].summary, "采用第二个方案");
    await assert.rejects(worker.call("commit", { ...target, expectedRevision: 2, runId: trials[0].runId }), { status: 409 });
    assert.ok((await worker.call("process_state", target)).publicationError);
    assert.equal((await worker.call("get", target)).head, 2);
    await worker.call("restore", { ...target, expectedRevision: 2, revision: 1 });
    const branch = await worker.call("commit", { ...target, expectedRevision: 1, runId: trials[0].runId, summary: "从原版分支" });
    assert.equal(branch.head, 3);
    const atThree = await worker.call("process_history", { ...target, revision: 3 });
    assert.equal(atThree.length, 1);
    assert.equal(atThree[0].id, trials[0].runId);
    assert.equal(atThree[0].candidateRevision, 2);
    assert.equal(atThree[0].committedRevision, 3);
    assert.equal(atThree[0].baseRevision, 1);
    assert.equal(atThree[0].publicationError, undefined);
    await assert.rejects(worker.call("build", { ...target, expectedRevision: 3,
      source: "function build(){throw new Error('failure before first checkpoint');}" }), /before first/);
    const failed = (await worker.call("process_history", { ...target, revision: 3 })).find(run => run.phase === "error");
    assert.equal(failed.steps.length, 0);
    assert.match(failed.error, /before first/);
    assert.equal((await worker.call("get", target)).head, 3);

    const copy = join(root, "saved-copy"); await mkdir(copy);
    const fork = await worker.call("fork_project", { projectId: project.id, path: copy });
    const forkTarget = { ...target, projectId: fork.id };
    const copied = await worker.call("process_history", forkTarget);
    assert.equal(copied.length, 3);
    assert.ok(copied.every(run => run.phase === "done" && run.committedRevision));
    assert.equal((await worker.call("checkpoint_file", { ...forkTarget, runId: trials[0].runId, sequence: 1 })).design.revision, 3);
    const processDir = join(project.directory, ".cad-process");
    assert.ok(resolve(processDir).startsWith(resolve(root) + sep));
    await rm(processDir, { recursive: true });
    await worker.dispose(); worker = createWorker({ dataDir: root });
    assert.equal((await worker.call("process_history", target)).length, 3);
    assert.equal((await worker.call("process_state", target)).committedRevision, 3);
    const checkpoint = await worker.call("checkpoint_file", { ...target, runId: trials[0].runId, sequence: 1 });
    assert.equal(checkpoint.design.revision, 3);
    assert.ok(Math.abs(checkpoint.design.metrics.volume - 6000) < 1e-6);
    assert.ok(decodePreview(await readFile(checkpoint.path)).positions.length);
    const zip = await worker.call("export", { ...target, revision: 3, format: "zip" });
    const archive = unzipSync(await readFile(zip.path));
    assert.equal(JSON.parse(Buffer.from(archive["process/run.json"])).id, trials[0].runId);
    assert.ok(decodePreview(archive["process/1.bin"]).positions.length);
  } finally {
    await worker.dispose();
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});
