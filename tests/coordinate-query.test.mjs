import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as cad from "@classcad/smlibwasm";
import { queryShape, modelScope } from "../src/kernel/model.js";
import { createWorker } from "../src/host/worker.js";

const scope = modelScope("coordinate-test", "model.js");
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const nearPoint = (actual, expected) => actual.forEach((value, i) => near(value, expected[i]));
const pointKey = point => point.map(value => Math.round(value * 1e6)).join(",");

test("vertices and edge endpoints use actual world geometry and support scoped ID queries", () => cad.scope(() => {
  // A rotated box has bounding-box corners that are not its vertices.
  const part = cad.Box(10, 20, 6).rotate(new cad.Axis([0, 0, 0], [0, 0, 1]), 30).translate(4, 5, 6);
  const vertices = queryShape(part, 1, "vertices", {}, scope);
  assert.equal(vertices.length, 8);
  const angle = Math.PI / 6, expected = [];
  for (const x of [-5, 5]) for (const y of [-10, 10]) for (const z of [-3, 3])
    expected.push([4 + x * Math.cos(angle) - y * Math.sin(angle), 5 + x * Math.sin(angle) + y * Math.cos(angle), 6 + z]);
  assert.deepEqual(vertices.map(vertex => pointKey(vertex.point)).sort(), expected.map(pointKey).sort());
  assert.deepEqual(queryShape(part, 1, "vertices", vertices[0].id, scope), [vertices[0]]);
  const nearest = queryShape(part, 1, "vertices", { nearest: vertices[0].point, one: true }, scope);
  assert.equal(nearest[0].id, vertices[0].id);
  for (const vertex of vertices) {
    nearPoint(vertex.center, vertex.point); nearPoint(vertex.bounds.min, vertex.point); nearPoint(vertex.bounds.max, vertex.point);
    assert.equal(vertex.centerMeaning, "point");
  }
  const vertexSet = new Set(vertices.map(vertex => pointKey(vertex.point)));
  const edges = queryShape(part, 1, "edges", {}, scope, undefined, [0, 0.25, 0.5, 1]);
  assert.equal(edges.length, 12);
  for (const edge of edges) {
    assert.equal(edge.isClosed, false);
    assert.ok(vertexSet.has(pointKey(edge.start))); assert.ok(vertexSet.has(pointKey(edge.end)));
    for (const sample of edge.samples)
      nearPoint(sample.point, edge.start.map((value, i) => value + sample.t * (edge.end[i] - value)));
    nearPoint(edge.center, edge.samples[2].point);
  }
  assert.deepEqual(queryShape(part, 1, "edges", edges[0].id, scope, undefined, [0, 1])[0].samples.map(sample => sample.point), [edges[0].start, edges[0].end]);
  assert.throws(() => queryShape(part, 2, "vertices", vertices[0].id, scope), /stale or foreign/);
  assert.throws(() => queryShape(part, 1, "edges", vertices[0].id, scope), /stale or foreign/);
  assert.throws(() => queryShape(part, 1, "vertices", vertices[0].id, modelScope("other", "model.js")), /stale or foreign/);
}));

test("curve samples follow arc length on arcs, closed circles, reversed curves and splines", () => cad.scope(() => {
  const arc = cad.ThreePointArc([2, 0, 0], [Math.SQRT2, Math.SQRT2, 0], [0, 2, 0]);
  const record = queryShape(arc, 1, "edges", {}, scope, undefined, [0, 0.25, 0.5, 1])[0];
  nearPoint(record.start, [2, 0, 0]); nearPoint(record.end, [0, 2, 0]);
  for (const { t, point } of record.samples) nearPoint(point, [2 * Math.cos(t * Math.PI / 2), 2 * Math.sin(t * Math.PI / 2), 0]);
  assert.equal(record.isClosed, false);
  assert.equal(record.centerMeaning, "arc_length_midpoint");
  const reversed = queryShape(arc.reversed(), 1, "edges", {}, scope, undefined, [0, 0.25, 1])[0];
  nearPoint(reversed.start, record.end); nearPoint(reversed.end, record.start);
  nearPoint(reversed.samples[1].point, [2 * Math.cos(0.75 * Math.PI / 2), 2 * Math.sin(0.75 * Math.PI / 2), 0]);
  const cylinder = cad.Cylinder(3, 5).translate(4, -2, 1);
  const circles = queryShape(cylinder, 1, "edges", { geomType: "circle" }, scope, undefined, [0, 0.25, 0.5, 0.75, 1]);
  assert.equal(circles.length, 2);
  for (const circle of circles) {
    assert.equal(circle.isClosed, true); nearPoint(circle.start, circle.end);
    for (const { point } of circle.samples) near(Math.hypot(point[0] - 4, point[1] + 2), 3);
    nearPoint(circle.samples[0].point, circle.samples[4].point);
    near(Math.hypot(...circle.samples[0].point.map((v, i) => v - circle.samples[2].point[i])), 6);
    nearPoint(circle.geometricCenter.slice(0, 2), [4, -2]);
  }
  const seams = queryShape(cylinder, 1, "edges", { geomType: "line" }, scope, undefined, [0, 0.5, 1]);
  assert.ok(seams.length);
  for (const seam of seams) {
    near(Math.abs(seam.end[2] - seam.start[2]), 5);
    nearPoint(seam.samples[1].point, seam.start.map((value, i) => (value + seam.end[i]) / 2));
  }
  const spline = cad.Spline([[0, 0, 0], [1, 4, 0], [5, 2, 0], [10, 0, 0]]);
  const samples = queryShape(spline, 1, "edges", {}, scope, undefined, [0, 0.2, 0.5, 0.8, 1])[0];
  nearPoint(samples.start, [0, 0, 0]); nearPoint(samples.end, [10, 0, 0]);
  for (const sample of samples.samples.slice(1, -1)) near(spline.distanceTo(sample.point), 0);
  for (const edgeParameters of [[], [-0.1], [1.1], [NaN], ["0.5"], Array(101).fill(0)])
    assert.throws(() => queryShape(cylinder, 1, "edges", {}, scope, undefined, edgeParameters), /edgeParameters/);
  assert.throws(() => queryShape(cylinder, 1, "vertices", {}, scope, undefined, [0.5]), /requires an edges query/);
}));

test("coordinate queries preserve saved state, isolate candidates and survive restart and STEP readback", { timeout: 90000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "minicad-coordinate-query-"));
  let worker = createWorker({ dataDir });
  try {
    const project = await worker.call("create");
    const args = { projectId: project.id, sourceFile: "model.js" };
    await worker.call("edit", { ...args, expectedRevision: 0, operations: [{ op: "box", size: [10, 20, 6], name: "坐标校验块" }] });
    const files = ["model.js", "model.parameters.json", "model.smp", ".cad-design.json"];
    const before = await Promise.all(files.map(file => readFile(join(project.directory, file))));
    const history = await worker.call("process_history", args);
    const vertices = await worker.call("query", { ...args, expectedRevision: 1, kind: "vertices" });
    const edges = await worker.call("query", { ...args, expectedRevision: 1, kind: "edges", edgeParameters: [0, 0.5, 1] });
    assert.equal(vertices.items.length, 8); assert.equal(edges.items.length, 12);
    nearPoint(edges.items[0].samples[1].point, edges.items[0].center);
    for (let i = 0; i < files.length; i++) assert.deepEqual(await readFile(join(project.directory, files[i])), before[i]);
    assert.deepEqual(await worker.call("process_history", args), history);
    const trial = await worker.call("edit", { ...args, expectedRevision: 1, commit: false, operations: [{ op: "translate", by: [7, 0, 0] }] });
    const candidateArgs = { ...args, expectedRevision: 1, runId: trial.runId };
    const candidate = await worker.call("query", { ...candidateArgs, kind: "vertices" });
    assert.deepEqual(candidate.items.map(item => pointKey(item.point)).sort(), vertices.items.map(item => pointKey([item.point[0] + 7, item.point[1], item.point[2]])).sort());
    await assert.rejects(worker.call("query", { ...candidateArgs, kind: "vertices", selector: vertices.items[0].id }), /stale or foreign/);
    await assert.rejects(worker.call("query", { ...args, expectedRevision: 1, kind: "vertices", selector: candidate.items[0].id }), /stale or foreign/);
    await worker.dispose(); worker = createWorker({ dataDir });
    assert.deepEqual((await worker.call("query", { ...args, expectedRevision: 1, kind: "vertices" })).items, vertices.items);
    const resumed = await worker.call("query", { ...candidateArgs, kind: "vertices", selector: candidate.items[0].id });
    assert.deepEqual(resumed.items, [candidate.items[0]]);
    await worker.call("commit", { ...candidateArgs });
    await assert.rejects(worker.call("query", { ...args, expectedRevision: 2, kind: "vertices", selector: vertices.items[0].id }), /stale or foreign/);
    const exported = await worker.call("export", { ...args, revision: 2, format: "step" });
    const part = cad.fromStep(await readFile(exported.path, "utf8"));
    try { assert.deepEqual(queryShape(part, 2, "vertices", {}, scope).map(item => pointKey(item.point)).sort(), candidate.items.map(item => pointKey(item.point)).sort()); }
    finally { part.dispose(); }
  } finally { await worker.dispose(); await rm(dataDir, { recursive: true, force: true }); }
});
