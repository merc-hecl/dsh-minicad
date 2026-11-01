import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import * as cad from "@classcad/smlibwasm";
import { createWorker } from "../src/host/worker.js";
import { queryShape, measureShape } from "../src/kernel/inspection.js";
import { readApi } from "../src/kernel/api.js";

const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
async function setup(fn) {
  const root = await mkdtemp(join(tmpdir(), "minicad-drawing-"));
  const worker = createWorker({ dataDir: root });
  try { await fn(worker, root); }
  finally {
    await worker.dispose();
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}
const operations = [
  { op: "box", size: [88.9, 88.9, 12.7] },
  { op: "intersect", tool: { shape: "cylinder", radius: 50.8, height: 14.7 } },
  { op: "circular_pattern", axis: [0, 0, 1], angle: 45, count: 8, mode: "cut",
    tool: { shape: "cylinder", radius: 4.7625, height: 14.7, center: [34.925, 0, 0] } },
  { op: "cut", tool: { shape: "cylinder", radius: 19.05, height: 14.7 } },
];
const check = (name, measurement, expected, basis) => ({ name, measurement, expected, tolerance: 1e-5, basis });

test("PM-03: four structured operations preserve arc outline, all through holes and thickness; inspect candidate then publish once", { timeout: 90000 }, () => setup(async worker => {
  const task = await worker.call("create");
  const target = { projectId: task.id, sourceFile: "model.js", geometry: false, expectedRevision: 0 };
  const radius = 50.8, half = 44.45;
  const area = Math.PI * radius ** 2 - 4 * (radius ** 2 * Math.acos(half / radius) - half * Math.sqrt(radius ** 2 - half ** 2));
  const volume = (area - Math.PI * 19.05 ** 2 - 8 * Math.PI * 4.7625 ** 2) * 12.7;
  const checks = [
    ...["x", "y", "z"].map((axis, i) => check(`size ${axis}`, { kind: "size", axis }, [88.9, 88.9, 12.7][i], "front and side views, inches converted to mm")),
    check("four R50.8 arcs", { kind: "count", entityKind: "faces", selector: { geomType: "cylinder", radius: 50.8 } }, 4, "front view: outer diameter 4.000 inch"),
    check("eight complete through bores", { kind: "count", entityKind: "holes", selector: { radius: 4.7625, through: true } }, 8, "8X diameter .375, side view"),
    check("central through bore", { kind: "count", entityKind: "holes", selector: { radius: 19.05, through: true } }, 1, "diameter 1.500 inch"),
    check("analytic volume", { kind: "volume" }, volume, "circle-square intersection minus nine cylindrical bores"),
    check("constant plate thickness", { kind: "thickness", point: [40, 0, 0], direction: [0, 0, 1] }, 12.7, "side view: .500 inch"),
  ];
  const trial = await worker.call("edit", { ...target, operations, commit: false, checks, summary: "PM-03 trial" });
  assert.equal(trial.committed, false);
  assert.equal(trial.validation.passed, true);
  assert.equal((await worker.call("get", target)).head, 0);
  const candidate = { ...target, runId: trial.runId };
  const holes = (await worker.call("query", { ...candidate, kind: "holes" })).items;
  assert.equal(holes.length, 9);
  assert.ok(holes.every(item => item.hole.closedWall && item.hole.through));
  const small = holes.filter(item => Math.abs(item.radius - 4.7625) < 1e-6);
  const bore = holes.find(item => Math.abs(item.radius - 19.05) < 1e-6);
  for (const hole of small) {
    checks.push(check("bolt circle radius", { kind: "axis_distance", from: hole.id, to: bore.id }, 34.925, "diameter 2.750 bolt circle"));
    const angle = Math.round(Math.atan2(hole.hole.center[1], hole.hole.center[0]) / (Math.PI / 4)) * Math.PI / 4;
    for (const [i, axis] of ["x", "y", "z"].entries()) checks.push(check(`hole coordinate ${axis}`,
      { kind: "coordinate", entity: { kind: "faces", selector: hole.id }, axis },
      [34.925 * Math.cos(angle), 34.925 * Math.sin(angle), 0][i], "equally spaced 45 degrees, front view coordinate dimensions"));
    checks.push(check("full hole wall span", { kind: "span", entity: { kind: "faces", selector: hole.id }, axis: "z" }, 12.7, "constant thickness, no half-depth step"));
  }
  const right = small.find(item => item.hole.center[0] > 34), left = small.find(item => item.hole.center[0] < -34);
  checks.push(check("opposite centers", { kind: "center_distance", from: right.id, to: left.id }, 69.85, "diameter 2.750 bolt circle"));
  checks.push(check("opposite wall gap", { kind: "distance", from: right.id, to: left.id }, 60.325, "derived wall gap; distinct from center distance"));
  const checked = await worker.call("check", { ...candidate, checks });
  assert.equal(checked.passed, true);
  await worker.call("edit", { ...target, commit: false, operations: [{ op: "box", size: [1, 2, 3] }] });
  const published = await worker.call("commit", { ...candidate, checks, summary: "PM-03 checked geometry" });
  assert.equal(published.head, 1);
  assert.equal(published.revisions.length, 1);
  assert.equal(published.design.validation.passed, true);
  assert.equal(published.design.validation.results.length, checks.length);
  assert.equal((await worker.call("process_state", target)).id, candidate.runId);
  assert.ok(published.design.validation.results.every(item => item.basis && item.name && item.measurement));
  await assert.rejects(worker.call("commit", { ...candidate, checks }), /更新|版本/);
  for (const format of ["smb", "step"]) {
    const output = await worker.call("export", { ...target, revision: 1, format });
    const bytes = await readFile(output.path), back = format === "step" ? cad.fromStep(bytes.toString()) : cad.fromSmb(bytes);
    assert.ok(back.isValid({ strict: true }));
    assert.equal(back.solids().length, 1);
    near(back.volume, volume);
    const exportedHoles = queryShape(back, 1, "holes", { through: true });
    assert.equal(exportedHoles.length, 9);
    back.dispose();
  }
}));

test("trial diagnostics use the task cwd; failed checks and changed working files cannot replace the saved model", { timeout: 90000 }, () => setup(async worker => {
  const task = await worker.call("create");
  const target = { projectId: task.id, sourceFile: "parts/model.js", geometry: false };
  await mkdir(join(task.directory, "resources"));
  await writeFile(join(task.directory, "resources", "note.txt"), "drawing resource");
  const source = `function build(p,cad){
    const fs=require('node:fs');
    console.log(fs.readFileSync('resources/note.txt','utf8'));
    cad.log('cwd=%s dirname=%s',process.cwd(),__dirname);
    const part=cad.Box(20,20,10);
    return cad.checkpoint(part,'diagnostic label');
  }`;
  const first = await worker.call("build", { ...target, expectedRevision: 0, source });
  const original = await readFile(join(task.directory, "parts/model.smb"));
  assert.ok(first.diagnostics.logs.includes("drawing resource"));
  assert.ok(first.diagnostics.logs.some(line => line.includes(task.directory) && line.includes(join(task.directory, "parts"))));
  assert.ok(first.diagnostics.checkpoints.includes("diagnostic label"));
  const checks = [check("plate thickness", { kind: "size", axis: "z" }, 12.7, "side view .500 inch")];
  const bad = await worker.call("build", { ...target, expectedRevision: 1, source, commit: false, checks });
  assert.equal(bad.validation.passed, false);
  await assert.rejects(worker.call("commit", { ...target, expectedRevision: 1, runId: bad.runId }), error => error.validation.passed === false);
  await assert.rejects(worker.call("commit", { ...target, expectedRevision: 1, runId: bad.runId, checks: [] }), error => error.validation.passed === false);
  await assert.rejects(worker.call("build", { ...target, expectedRevision: 1, source, checks }), error =>
    error.validation.passed === false && error.diagnostics.logs.includes("drawing resource"));
  assert.equal((await worker.call("get", target)).head, 1);
  assert.deepEqual(await readFile(join(task.directory, "parts/model.smb")), original);
  const fresh = await worker.call("build", { ...target, expectedRevision: 1, source, commit: false });
  await writeFile(join(task.directory, "parts/model.parameters.json"), '{"changed":true}');
  await assert.rejects(worker.call("commit", { ...target, expectedRevision: 1, runId: fresh.runId }), /更新|版本/);
  assert.equal((await worker.call("get", target)).head, 1);
}));

test("bore inspection separates blind holes, open side cuts and external cylindrical bosses", () => {
  let part = cad.Box(24, 24, 10).cut(cad.Cylinder(1, 14).translate(-5, 0, 0));
  part = part.cut(cad.Cylinder(1, 6).translate(5, 0, 4));
  part = part.cut(cad.Cylinder(2, 14).translate(12, 5, 0));
  part = part.fuse(cad.Cylinder(2, 4).translate(0, -6, 6));
  const holes = queryShape(part, 1, "holes");
  assert.equal(holes.length, 3);
  assert.equal(holes.filter(item => item.hole.through).length, 1);
  assert.equal(holes.filter(item => !item.hole.closedWall).length, 1);
  const blind = holes.find(item => item.hole.center[0] > 4 && item.hole.center[0] < 6);
  assert.equal(blind.hole.through, false);
  near(blind.hole.axialSpan, 4);
  const zero = measureShape(part, [{ kind: "count", entityKind: "holes", selector: { radius: 99 } }]);
  assert.equal(zero[0].value, 0);
  part.dispose();
  const counterbore = cad.Box(20, 20, 10).cut(cad.Cylinder(1, 14)).cut(cad.Cylinder(3, 4).translate(0, 0, 5));
  const segments = queryShape(counterbore, 1, "holes");
  assert.equal(segments.length, 2);
  assert.equal(segments.find(item => item.radius > 2).hole.through, false);
  assert.equal(segments.find(item => item.radius < 2).hole.through, true);
  const tilted = counterbore.rotate(new cad.Axis([0, 0, 0], [1, 1, 0]), 37).translate(12, 15, -7);
  const tiltedSegments = queryShape(tilted, 1, "holes");
  assert.equal(tiltedSegments.find(item => item.radius > 2).hole.through, false);
  assert.equal(tiltedSegments.find(item => item.radius < 2).hole.through, true);
  near(tiltedSegments.find(item => item.radius < 2).hole.axialSpan, 8);
  tilted.dispose();
  counterbore.dispose();
});

test("candidate resources remain portable across restart and workspace move, and changed inputs block publication", { timeout: 60000 }, () => setup(async (worker, root) => {
  const task = await worker.call("create");
  await mkdir(join(task.directory, "resources"));
  const resource = cad.toSmb(cad.Box(2, 3, 4));
  await writeFile(join(task.directory, "resources", "input.smb"), resource);
  const target = { projectId: task.id, sourceFile: "model.js", geometry: false, expectedRevision: 0 };
  const trial = await worker.call("edit", { ...target, commit: false,
    operations: [{ op: "import", file: "resources/input.smb" }],
    checks: [check("resource volume", { kind: "volume" }, 24, "input resource")],
  });
  await worker.dispose();
  const resumed = createWorker({ dataDir: root });
  try {
    const destination = join(root, "moved-library");
    await mkdir(destination);
    const library = await resumed.call("create_library", { path: destination });
    const moved = await resumed.call("move_project", { projectId: task.id, libraryId: library.id });
    const candidate = { ...target, runId: trial.runId };
    near((await resumed.call("measure", { ...candidate, measurements: [{ kind: "volume" }] })).items[0].value, 24);
    await writeFile(join(moved.directory, "resources", "input.smb"), cad.toSmb(cad.Box(5, 6, 7)));
    await assert.rejects(resumed.call("commit", candidate), /更新|版本/);
    await writeFile(join(moved.directory, "resources", "input.smb"), resource);
    const committed = await resumed.call("commit", candidate);
    assert.equal(committed.head, 1);
    near(committed.design.metrics.volume, 24);
    const exported = await resumed.call("export", { ...target, revision: 1, format: "smb" });
    near(cad.fromSmb(await readFile(exported.path)).volume, 24);
  } finally { await resumed.dispose(); }
}));

test("installed API lookup locates class members and pages complete declarations", () => {
  assert.match(readApi({ topic: "shapes", symbol: "Part.volume" }).declarations, /get volume\(\): number/);
  assert.match(readApi({ topic: "shapes", symbol: "Face.axis" }).declarations, /get axis\(\): Axis/);
  assert.match(readApi({ topic: "shapes", symbol: "Sketch.extrude" }).declarations, /extrude\(/);
  const first = readApi({ topic: "shapes", symbol: "Part", limit: 100 });
  const second = readApi({ topic: "shapes", symbol: "Part", offset: first.nextOffset, limit: 100 });
  assert.equal(second.offset, 100);
  assert.notEqual(first.declarations, second.declarations);
  assert.ok(first.symbols.includes("Part"));
});
