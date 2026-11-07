import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as cad from "@classcad/smlibwasm";
import { queryShape, measureShape, checkShape, modelScope } from "../src/kernel/inspection.js";
import { nearestPair, farthestPair } from "../src/kernel/distances.js";
import { createWorker } from "../src/host/worker.js";

const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const scope = modelScope("measurement", "model.js");
const verifyPair = item => near(Math.hypot(...item.point.map((n, i) => n - item.otherPoint[i])), item.value);

test("bounded face-face, face-edge and edge-edge distances and shortest-line projections", () => cad.scope(() => {
  const box = cad.Box(20, 10, 4);
  const faces = queryShape(box, 1, "faces", {}, scope);
  const top = faces.find(f => f.normal[2] > .9), bottom = faces.find(f => f.normal[2] < -.9);
  const edges = queryShape(box, 1, "edges", { parallelTo: [0, 1, 0] }, scope);
  const low = edges.find(e => e.bounds.min[2] < -1), high = edges.find(e => e.bounds.min[2] > 1 && e.center[0] === low.center[0]);
  for (const [from, to, minimum, maximum] of [
    [top.id, bottom.id, 4, Math.hypot(20, 10, 4)],
    [top.id, low.id, 4, Math.hypot(20, 10, 4)],
    [low.id, high.id, 4, Math.hypot(10, 4)],
  ]) {
    const result = measureShape(box, ["distance", "max_distance"].map(kind => ({ kind, from, to })), scope, 1);
    near(result[0].value, minimum); near(result[1].value, maximum);
    result.forEach(verifyPair);
    const projections = measureShape(box, ["x", "y", "z"].map(axis => ({ kind: "projected_distance", from, to, axis })), scope, 1);
    near(Math.hypot(...projections.map(p => p.value)), minimum);
    near(projections[2].value, 4);
    near(Math.hypot(...Object.values(result[0].projections)), minimum);
  }
  near(nearestPair(box.faces().top()[0], [0, 0, 0]).value, 2);
}));

test("a distance batch returns consistent projections for one nonunique nearest-point pair", () => cad.scope(() => {
  const ring = cad.Cylinder(5, 4).cut(cad.Cylinder(2, 6));
  const circles = queryShape(ring, 1, "edges", { geomType: "circle" }, scope);
  const from = circles.find(e => e.radius === 5 && e.center[2] < 0).id;
  const to = circles.find(e => e.radius === 2 && e.center[2] < 0).id;
  const result = measureShape(ring, [
    ...["x", "y", "z"].map(axis => ({ kind: "projected_distance", from, to, axis })),
    { kind: "distance", from, to },
  ], scope, 1);
  const minimum = result[3];
  near(minimum.value, 3); near(Math.hypot(...Object.values(minimum.projections)), 3);
  for (const projected of result.slice(0, 3)) {
    assert.deepEqual(projected.point, minimum.point);
    assert.deepEqual(projected.otherPoint, minimum.otherPoint);
    assert.deepEqual(projected.projections, minimum.projections);
    near(projected.value, minimum.projections[projected.axis]);
  }
  const explicit = measureShape(ring, [{ kind: "distance", from: { point: [0, 0, 0] }, to: { point: [3, 4, 0] } }], scope, 1)[0];
  near(explicit.value, 5); assert.deepEqual(explicit.projections, { x: 3, y: 4, z: 0 });
}));

test("numerical measurement accuracy and dimensional acceptance tolerance remain distinct", () => cad.scope(() => {
  const cylinder = cad.Cylinder(3, 5), edges = queryShape(cylinder, 1, "edges", {}, scope);
  const from = edges.find(e => e.type === "circle").id;
  const to = queryShape(cylinder, 1, "edges", { geomType: "line" }, scope)[0].id;
  const checked = checkShape(cylinder, [{
    measurement: { kind: "max_distance", from, to }, expected: Math.sqrt(61), tolerance: .01,
  }], scope, 1);
  assert.equal(checked.passed, true);
  assert.equal(checked.results[0].approximate, true);
  assert.equal(checked.results[0].accuracy, .001);
  assert.equal(checked.results[0].tolerance, .01);
}));

test("straight skew segments use their interior closest points", () => cad.scope(() => {
  const a = cad.Line([-2, 0, 0], [2, 0, 0]), b = cad.Line([0, -3, 5], [0, 3, 5]);
  const result = nearestPair(a, b);
  near(result.value, 5); assert.deepEqual(result.point, [0, 0, 0]); assert.deepEqual(result.otherPoint, [0, 0, 5]);
  near(farthestPair(a, b).value, Math.sqrt(38));
}));

test("circular edges include full circles, arcs, projected crossings and reversed normals", () => cad.scope(() => {
  const cylinder = cad.Cylinder(3, 5), circles = cylinder.edges().filter(e => e.geomType === "circle");
  for (const [a, b, min, max] of [
    [circles[0], circles[1], 5, Math.sqrt(61)],
    [circles[0].trim(0, .25), circles[1].trim(.5, .75), Math.sqrt(43), Math.sqrt(61)],
    [circles[0], circles[1].translate(4, 0, 0), 5, Math.sqrt(125)],
    [circles[0], circles[1].rotate(new cad.Axis([0, 0, 0], [1, 0, 0]), 180), 0, 6],
  ]) {
    const nearest = nearestPair(a, b), farthest = farthestPair(a, b);
    near(nearest.value, min); near(farthest.value, max);
    for (const result of [nearest, farthest]) {
      verifyPair(result); near(a.distanceTo(result.point), 0); near(b.distanceTo(result.otherPoint), 0);
      assert.equal(result.method, "analytic_circles");
    }
  }
}));

test("general curves retain trimmed extents and report numerical accuracy", () => cad.scope(() => {
  const c = cad.Cylinder(3, 5), circle = c.edges().find(e => e.geomType === "circle");
  const arc = circle.trim(0, .25), line = cad.Line([5, 0, -2.5], [5, 0, 2.5]);
  const min = nearestPair(arc, line), max = farthestPair(arc, line);
  near(min.value, 2, .001); near(max.value, Math.sqrt(59), .001);
  assert.equal(min.approximate, true); assert.equal(min.accuracy, .001);
  assert.equal(max.approximate, true); verifyPair(min); verifyPair(max);
  const spline = cad.Bezier([-2, 0, 0], [0, 4, 0], [2, 0, 0]);
  const above = cad.Line([-2, 3, 5], [2, 3, 5]);
  const interior = nearestPair(spline, above);
  near(interior.value, Math.sqrt(26), .001); near(interior.point[0], 0, .05);
  near(farthestPair(spline, above).value, Math.sqrt(50), .001);
}));

test("curved face maximum is separate from display geometry and carries approximation metadata", () => cad.scope(() => {
  const cylinder = cad.Cylinder(3, 5), top = cylinder.faces().top()[0], side = cylinder.faces().find(f => f.geomType === "cylinder");
  near(nearestPair(top, side).value, 0);
  const result = farthestPair(top, side);
  near(result.value, Math.sqrt(61), .001); verifyPair(result);
  assert.equal(result.approximate, true); assert.equal(result.method, "tessellated_extrema"); assert.equal(result.accuracy, .001);
}));

test("worker measurements preserve saved files and revisions and reject stale references", { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "minicad-measurement-"));
  const worker = createWorker({ dataDir: directory });
  try {
    const task = await worker.call("create"), args = { projectId: task.id, sourceFile: "model.js" };
    const built = await worker.call("build", { ...args, expectedRevision: 0, source: "function build(p, cad) { return cad.Box(20, 10, 4).named('底板'); }" });
    const file = join(built.workspaceDirectory, "model.smp"), before = await readFile(file);
    const { items } = await worker.call("query", { ...args, expectedRevision: 1, kind: "faces" });
    const from = items.find(f => f.normal[2] > .9).id, to = items.find(f => f.normal[2] < -.9).id;
    const result = await worker.call("measure", { ...args, expectedRevision: 1, measurements: [
      { kind: "distance", from, to }, { kind: "max_distance", from, to }, { kind: "projected_distance", from, to, axis: "z" },
    ] });
    near(result.items[0].value, 4); near(result.items[1].value, Math.sqrt(516)); near(result.items[2].value, 4);
    assert.deepEqual(result.items[0].projections, { x: 0, y: 0, z: 4 });
    assert.deepEqual(result.items[2].projections, result.items[0].projections);
    assert.deepEqual(result.items[2].point, result.items[0].point);
    assert.equal((await worker.call("get", args)).head, 1); assert.deepEqual(await readFile(file), before);
    await worker.call("build", { ...args, expectedRevision: 1, source: "function build(p, cad) { return cad.Box(20, 10, 6).named('底板'); }" });
    await assert.rejects(worker.call("measure", { ...args, expectedRevision: 1, measurements: [{ kind: "distance", from, to }] }), /设计已更新/);
    await assert.rejects(worker.call("measure", { ...args, expectedRevision: 2, measurements: [{ kind: "max_distance", from, to }] }), /几何引用已过期/);
    assert.equal((await worker.call("get", args)).head, 2);
  } finally { await worker.dispose(); await rm(directory, { recursive: true, force: true }); }
});
