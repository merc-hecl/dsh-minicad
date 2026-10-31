import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as cad from "@classcad/smlibwasm";
import { previewShape } from "../src/kernel/model.js";
import { createWorker } from "../src/host/worker.js";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
test("BREP preview preserves hard-face normals, smooth bore normals and complete CAD edges", () => {
  const shape = cad.Box(30, 10, 5).cut(cad.Cylinder(1, 7));
  const { mesh } = previewShape(shape);
  assert.equal(mesh.normals.length, mesh.vertices.length);
  let top = 0,
    bore = 0;
  for (const triangle of mesh.triangles) {
    const points = triangle.map((i) => mesh.vertices[i]);
    if (points.every((p) => Math.abs(p[2] - 2.5) < 1e-8)) {
      top++;
      for (const i of triangle) {
        near(mesh.normals[i][0], 0);
        near(mesh.normals[i][1], 0);
        near(mesh.normals[i][2], 1);
      }
    }
    if (points.every((p) => Math.abs(Math.hypot(p[0], p[1]) - 1) < 1e-8)) {
      bore++;
      for (const i of triangle) {
        near(mesh.normals[i][0], -mesh.vertices[i][0]);
        near(mesh.normals[i][1], -mesh.vertices[i][1]);
        near(mesh.normals[i][2], 0);
      }
    }
  }
  assert.ok(top > 0 && bore > 0);
  for (const normal of mesh.normals) near(Math.hypot(...normal), 1);
  const corners = new Map();
  mesh.vertices.forEach((p, i) => {
    const key = p.join(",");
    if (!corners.has(key)) corners.set(key, new Set());
    corners.get(key).add(mesh.normals[i].join(","));
  });
  assert.ok(
    [...corners.values()].some((normals) => normals.size > 1),
    "hard boundaries must not share a single averaged normal",
  );
  const cylinder = cad.Cylinder(1, 5),
    { edges } = previewShape(cylinder);
  assert.equal(
    edges.length,
    3,
    "two circular rims and the periodic surface seam",
  );
  const seam = edges.filter((edge) => edge.length === 2),
    circles = edges.filter((edge) => edge.length === 33);
  assert.equal(seam.length, 1);
  assert.equal(circles.length, 2);
  near(Math.abs(seam[0][1][2] - seam[0][0][2]), 5);
  for (const edge of circles) {
    for (const point of edge) near(Math.hypot(point[0], point[1]), 1);
    edge[0].forEach((v, i) => near(v, edge.at(-1)[i]));
  }
});

test(
  "saved previews refresh without modifying source, geometry, revisions or external edits",
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "minicad-preview-")),
      worker = createWorker({ dataDir: root });
    try {
      const project = await worker.call("create"),
        source =
          "function build(p,cad){ return cad.Box(30,10,5).cut(cad.Cylinder(1,7)); }";
      const built = await worker.call("build", {
        projectId: project.id,
        expectedRevision: 0,
        source,
        parameters: {},
      });
      const file = join(
        project.directory,
        built.revisions[0].folder,
        "state.json",
      );
      const saved = JSON.parse(await readFile(file, "utf8")),
        raw = cad.Box(30, 10, 5).cut(cad.Cylinder(1, 7)).mesh(0.01);
      const triples = (values) =>
        Array.from({ length: values.length / 3 }, (_, i) =>
          Array.from(values.slice(i * 3, i * 3 + 3)),
        );
      saved.mesh = {
        vertices: triples(raw.vertices),
        triangles: triples(raw.triangles),
      };
      delete saved.previewVersion;
      await writeFile(file, JSON.stringify(saved));
      const binary = await readFile(join(project.directory, "model.smb"));
      const externalSource = source + "\n// external editor";
      await writeFile(join(project.directory, "model.js"), externalSource);
      await worker.call("get", { projectId: project.id, geometry: false });
      assert.equal(
        JSON.parse(await readFile(file, "utf8")).previewVersion,
        undefined,
      );
      const refreshed = await worker.call("get", { projectId: project.id });
      assert.equal(refreshed.head, 1);
      assert.equal(refreshed.revisions.length, 1);
      assert.equal(refreshed.design.previewVersion, 1);
      assert.ok(refreshed.design.mesh.normals.length);
      assert.equal(refreshed.source, externalSource);
      assert.equal(refreshed.workingTreeChanged, true);
      assert.deepEqual(refreshed.design.metrics, built.design.metrics);
      assert.deepEqual(
        await readFile(join(project.directory, "model.smb")),
        binary,
      );
      assert.equal(JSON.parse(await readFile(file, "utf8")).source, source);
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
