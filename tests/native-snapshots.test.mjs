import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import * as cad from "@classcad/smlibwasm";
import { createWorker } from "../src/host/worker.js";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
const json = async path => JSON.parse(await readFile(path, "utf8"));
async function workspace(fn) {
  const root = await mkdtemp(join(tmpdir(), "minicad-native-")), dataDir = join(root, "settings");
  let worker = createWorker({ dataDir });
  const restart = async () => { await worker.dispose(); return worker = createWorker({ dataDir }); };
  try { await fn(worker, root, restart); }
  finally {
    await worker.dispose();
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

test("SMP snapshots remain editable without code, parameters, resources or preview; build materials describe only their execution", { timeout: 90000 }, () => workspace(async (worker, root, restart) => {
  const project = await worker.call("create"), target = { projectId: project.id, modelFile: "model.smp" };
  const directory = project.directory;
  await mkdir(join(directory, "resources"));
  await writeFile(join(directory, "helper.cjs"), "module.exports = 3;");
  await writeFile(join(directory, "resources/label.txt"), "first execution");
  const source = `function build(p,cad) {
    const radius=require('./helper.cjs');
    return cad.Box(p.width,30,8).cut(cad.Cylinder(radius,20)).named('安装底板').colored('#4682b4');
  }`;
  const built = await worker.call("build", { ...target, expectedRevision: 0, source,
    parameters: { width: 40 }, inputs: ["resources/label.txt"] });
  const first = join(directory, built.revisions[0].folder);
  assert.equal(await readFile(join(first, "build/source.js"), "utf8"), source);
  assert.deepEqual(await json(join(first, "build/parameters.json")), { width: 40 });
  assert.equal(await readFile(join(first, "build/inputs/helper.cjs"), "utf8"), "module.exports = 3;");
  assert.equal(await readFile(join(first, "build/inputs/resources/label.txt"), "utf8"), "first execution");
  const hole = (await worker.call("query", { ...target, expectedRevision: 1, kind: "holes" })).items[0];
  const edited = await worker.call("edit", { ...target, expectedRevision: 1, parameters: { width: 999 },
    operations: [{ op: "offset_faces", faces: hole.id, distance: -1 }],
    checks: [{ measurement: { kind: "diameter", entity: { kind: "faces", selector: { geomType: "cylinder", one: true } } }, expected: 8 }] });
  near(edited.design.metrics.sizeX, 40);
  const second = join(directory, edited.revisions[0].folder);
  assert.equal((await json(join(second, "operations.json"))).tool, "cad_edit");
  assert.equal(await readFile(join(first, "build/source.js"), "utf8"), source);
  await rm(join(directory, "helper.cjs"));
  await rm(join(directory, "resources/label.txt"));
  await rm(join(second, "preview.bin"));
  worker = await restart();
  const preview = await worker.call("preview_file", { ...target, revision: 2 });
  assert.ok((await readFile(preview.path)).length > 0);
  assert.equal((await worker.call("get", target)).workingTreeChanged, false);
  const next = await worker.call("edit", { ...target, expectedRevision: 2, operations: [{ op: "translate", by: [10, 0, 0] }] });
  near(next.design.metrics.volume, 40 * 30 * 8 - Math.PI * 4 ** 2 * 8);
  const exported = await worker.call("export", { ...target, revision: 3, format: "step" });
  const readback = cad.fromStep(await readFile(exported.path));
  try { assert.ok(readback.isValid()); near(readback.volume, next.design.metrics.volume); near(readback.bbox().center.x, 10); }
  finally { readback.dispose(); }

  const other = await worker.call("create"), snapshot = join(directory, next.revisions[0].folder);
  await copyFile(join(snapshot, "model.smp"), join(other.directory, "input.smp"));
  await copyFile(join(snapshot, "state.json"), join(other.directory, "input.state.json"));
  const imported = await worker.call("import", { projectId: other.id, modelFile: "model.smp", expectedRevision: 0,
    file: "input.smp", metadataFile: "input.state.json" });
  near(imported.design.metrics.volume, next.design.metrics.volume);
  assert.equal(imported.design.entities[0].name, "安装底板");
  await rm(join(other.directory, "input.smp"));
  await rm(join(other.directory, "input.state.json"));
  worker = await restart();
  const importedTarget = { projectId: other.id, modelFile: "model.smp" };
  const continued = await worker.call("edit", { ...importedTarget, expectedRevision: 1,
    operations: [{ op: "translate", by: [1, 0, 0] }] });
  near(continued.design.metrics.volume, next.design.metrics.volume);
  // A changed working SMP is adopted only through an explicit import.
  const external = cad.Box(15, 20, 4).named("外部修改").colored("#4682b4");
  try { await writeFile(join(other.directory, "model.smp"), cad.toSmp(external)); }
  finally { external.dispose(); }
  const adopted = await worker.call("import", { ...importedTarget, expectedRevision: 2, file: "model.smp" });
  near(adopted.design.metrics.volume, 1200);
  const smp = cad.fromSmp(await readFile(join(other.directory, "model.smp")));
  try { assert.deepEqual(smp.color.map(channel => Math.round(channel * 255)), [70, 130, 180]); }
  finally { smp.dispose(); }
}));

test("explicit builds edit the current SMP part; failed and conflicting trials retain geometry and archive code", { timeout: 90000 }, () => workspace(async (worker, root, restart) => {
  const project = await worker.call("create"), target = { projectId: project.id, modelFile: "model.smp" };
  await worker.call("edit", { ...target, expectedRevision: 0, operations: [
    { op: "add_part", id: "base", name: "底座", tool: { shape: "box", size: [40, 30, 8] } },
    { op: "add_part", id: "lid", name: "盖板", tool: { shape: "box", size: [40, 30, 2], center: [0, 0, 5] } },
  ] });
  await worker.call("edit", { ...target, expectedRevision: 1, operations: [{ op: "translate", part: "lid", by: [0, 0, 10] }] });
  const built = await worker.call("build", { ...target, expectedRevision: 2, part: "lid",
    source: "function build(p,cad){return cad.current.cut(cad.Cylinder(2,40));}" });
  near(built.design.parts.find(p => p.id === "lid").center[2], 15);
  near(built.design.parts.find(p => p.id === "lid").volume, 2400 - 8 * Math.PI);
  assert.equal(built.design.parts.find(p => p.id === "lid").name, "盖板");
  near(built.design.parts.find(p => p.id === "base").volume, 9600);
  const materials = join(project.directory, built.revisions[0].folder, "build");
  const base = cad.fromSmp(await readFile(join(materials, "base.smp")));
  try { assert.equal(base.length, 2); near(base[1].volume, 2400); near(base[1].bbox().center.z, 15); }
  finally { base.forEach(shape => shape.dispose()); }
  const before = await readFile(join(project.directory, "model.smp"));
  const badSource = "function build(){throw new Error('script failure');}";
  const failure = await worker.call("build", { ...target, expectedRevision: 3, source: badSource }).then(() => assert.fail("expected failure"), error => error);
  const log = await worker.call("process_state", target);
  assert.equal(log.id, failure.runId);
  assert.equal(await readFile(join(project.directory, ".cad-process/model", log.id, "build/source.js"), "utf8"), badSource);
  assert.deepEqual(await readFile(join(project.directory, "model.smp")), before);
  await writeFile(join(project.directory, "dimensions.json"), '{"height":2}');
  const source = "function build(p,cad){return cad.current.translate(0,0,require('./dimensions.json').height);}";
  const trial = await worker.call("build", { ...target, expectedRevision: 3, source, commit: false });
  worker = await restart();
  await writeFile(join(project.directory, "dimensions.json"), '{"height":5}');
  await assert.rejects(worker.call("commit", { ...target, expectedRevision: 3, runId: trial.runId }), { status: 409 });
  assert.equal((await worker.call("get", target)).head, 3);
  assert.deepEqual(await readFile(join(project.directory, "model.smp")), before);
  const copied = await worker.call("edit", { ...target, expectedRevision: 3, operations: [
    { op: "copy_part", part: "lid", id: "spare", name: "备用盖板", center: [60, 0, 0] },
    { op: "remove_part", part: "lid" },
  ] });
  assert.deepEqual(copied.design.parts.map(p => p.id), ["base", "spare"]);
  near(copied.design.parts[1].center[0], 60);
}));
