import { test } from "node:test";
import assert from "node:assert/strict";
import * as cad from "@classcad/smlibwasm";
import { previewShape } from "../src/kernel/model.js";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
test("BREP preview preserves hard-face normals, smooth bore normals and complete CAD edges", () => {
  const shape = cad.Box(30, 10, 5).cut(cad.Cylinder(1, 7));
  const mesh = previewShape(shape);
  assert.equal(mesh.normals.length, mesh.positions.length);
  const point = (array, index) =>
    Array.from(array.subarray(index * 3, index * 3 + 3));
  let top = 0,
    bore = 0;
  for (let triangle = 0; triangle < mesh.indices.length; triangle += 3) {
    const indices = Array.from(mesh.indices.subarray(triangle, triangle + 3));
    const points = indices.map((i) => point(mesh.positions, i));
    if (points.every((p) => Math.abs(p[2] - 2.5) < 1e-6)) {
      top++;
      for (const i of indices) {
        const n = point(mesh.normals, i);
        near(n[0], 0);
        near(n[1], 0);
        near(n[2], 1);
      }
    }
    if (points.every((p) => Math.abs(Math.hypot(p[0], p[1]) - 1) < 1e-6)) {
      bore++;
      for (const i of indices) {
        const n = point(mesh.normals, i),
          p = point(mesh.positions, i);
        near(n[0], -p[0]);
        near(n[1], -p[1]);
        near(n[2], 0);
      }
    }
  }
  assert.ok(top > 0 && bore > 0);
  const corners = new Map();
  for (let i = 0; i < mesh.positions.length / 3; i++) {
    const p = point(mesh.positions, i),
      n = point(mesh.normals, i);
    near(Math.hypot(...n), 1);
    const key = p.join(",");
    if (!corners.has(key)) corners.set(key, new Set());
    corners.get(key).add(n.join(","));
  }
  assert.ok(
    [...corners.values()].some((normals) => normals.size > 1),
    "hard boundaries must retain separate normals",
  );
  const cylinder = cad.Cylinder(1, 5),
    { edges } = previewShape(cylinder);
  let seams = 0;
  const circles = new Map();
  for (let i = 0; i < edges.length; i += 6) {
    const a = Array.from(edges.subarray(i, i + 3)),
      b = Array.from(edges.subarray(i + 3, i + 6));
    if (Math.abs(a[2] - b[2]) > 1) {
      seams++;
      near(Math.abs(a[2] - b[2]), 5);
    } else {
      near(Math.hypot(a[0], a[1]), 1);
      near(Math.hypot(b[0], b[1]), 1);
      const key = Math.round(a[2] * 2);
      if (!circles.has(key)) circles.set(key, []);
      circles.get(key).push([a, b]);
    }
  }
  assert.equal(seams, 1);
  assert.equal(circles.size, 2);
  for (const segments of circles.values()) {
    segments[0][0].forEach((v, i) => near(v, segments.at(-1)[1][i]));
  }
});
