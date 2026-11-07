import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as cad from "@classcad/smlibwasm";
import {
  editShape,
  normalizeOperations,
  queryShape,
  measureShape,
  checkShape,
  modelScope,
} from "../src/kernel/model.js";
import { createWorker } from "../src/host/worker.js";

const near = (a, b, tolerance = 1e-5) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
async function setup(fn) {
  const directory = await mkdtemp(join(tmpdir(), "minicad-agent-modeling-"));
  const worker = createWorker({ dataDir: directory });
  try {
    await fn(worker, directory);
  } finally {
    await worker.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}

test("structured revolve, loft, sweep and patterns produce exact solids and isolate a target solid", () => {
  const revolved = editShape(null, [
    {
      op: "revolve",
      profile: { shape: "rectangle", size: [2, 4], center: [4, 0, 0] },
      axis: [0, 1, 0],
      angle: 360,
    },
  ]);
  near(revolved.volume, 64 * Math.PI);
  const loft = editShape(null, [
    {
      op: "loft",
      sections: [
        { shape: "circle", radius: 2 },
        { shape: "circle", radius: 4, center: [0, 0, 6] },
      ],
      ruled: true,
    },
  ]);
  near(loft.volume, 56 * Math.PI);
  const swept = editShape(null, [
    {
      op: "sweep",
      profile: { shape: "circle", radius: 2 },
      path: { shape: "line", start: [0, 0, 0], end: [0, 0, 10] },
    },
  ]);
  near(swept.volume, 40 * Math.PI);
  const linear = editShape(null, [
    { op: "box", size: [2, 2, 2] },
    { op: "linear_pattern", step: [5, 0, 0], count: 3 },
  ]);
  assert.equal(linear.solids().length, 3);
  near(linear.volume, 24);
  const scope = modelScope("target-task", "parts.js");
  const solids = queryShape(linear, 1, "solids", {}, scope);
  const target = solids.find((item) => Math.abs(item.center[0] - 5) < 1e-6).id;
  const moved = editShape(
    linear,
    normalizeOperations(
      [{ op: "translate", target, by: [0, 10, 0] }],
      linear,
      1,
      scope,
    ),
  );
  assert.deepEqual(
    moved
      .solids()
      .map((solid) =>
        solid
          .center()
          .toArray()
          .map((v) => Math.round(v) || 0),
      )
      .sort((a, b) => a[0] - b[0]),
    [
      [0, 0, 0],
      [5, 10, 0],
      [10, 0, 0],
    ],
  );
  const circular = editShape(null, [
    { op: "box", size: [2, 2, 2], center: [10, 0, 0] },
    { op: "circular_pattern", axis: [0, 0, 1], angle: 90, count: 4 },
  ]);
  assert.equal(circular.solids().length, 4);
  near(circular.volume, 32);
  const drilled = editShape(null, [
    { op: "box", size: [40, 20, 8] },
    {
      op: "linear_pattern",
      step: [8, 0, 0],
      count: 3,
      mode: "cut",
      tool: { shape: "cylinder", radius: 1, height: 10 },
    },
  ]);
  near(drilled.volume, 6400 - 24 * Math.PI);
  for (const shape of [
    revolved,
    loft,
    swept,
    linear,
    moved,
    circular,
    drilled,
  ]) {
    assert.ok(shape.isValid());
    shape.dispose();
  }
});

test("sweep paths, profile placement and circular tool patterns preserve expected geometry", () => {
  const paths = [
    {
      shape: "polyline",
      points: [
        [0, 0, 0],
        [0, 0, 10],
        [10, 0, 10],
      ],
    },
    {
      shape: "spline",
      points: [
        [0, 0, 0],
        [2, 0, 5],
        [3, 0, 10],
      ],
    },
    { shape: "arc", start: [5, 0, 0], through: [0, 5, 0], end: [-5, 0, 0] },
    { shape: "helix", pitch: 4, height: 8, radius: 5 },
  ];
  for (const path of paths) {
    const part = editShape(null, [
      { op: "sweep", profile: { shape: "circle", radius: 0.25 }, path },
    ]);
    assert.ok(part.isValid(), path.shape);
    let length;
    if (path.shape === "arc") length = 5 * Math.PI;
    if (path.shape === "helix") length = 2 * Math.hypot(10 * Math.PI, 4);
    if (path.shape === "polyline") length = 20;
    if (path.shape === "spline") {
      const curve = cad.Spline(...path.points);
      length = curve.length;
    }
    near(part.volume, Math.PI * 0.25 ** 2 * length, 1e-3);
    part.dispose();
  }
  const profilePart = editShape(null, [
    {
      op: "extrude",
      profile: {
        shape: "rectangle",
        size: [4, 6],
        plane: "XZ",
        center: [2, 3, 4],
      },
      amount: 2,
    },
  ]);
  near(profilePart.volume, 48);
  near(profilePart.bbox().size.y, 2);
  const circular = editShape(null, [
    { op: "box", size: [30, 30, 5] },
    {
      op: "circular_pattern",
      axis: [0, 0, 1],
      angle: 90,
      count: 4,
      mode: "cut",
      tool: { shape: "cylinder", radius: 1, height: 7, center: [10, 0, 0] },
    },
  ]);
  near(circular.volume, 4500 - 20 * Math.PI);
  profilePart.dispose();
  circular.dispose();
});

test("exact measurements and dimensional checks distinguish wall material from cavities and gaps", () => {
  const scope = modelScope("task", "model.js");
  const plate = cad.Box(20, 10, 4).cut(cad.Cylinder(2, 6));
  const top = queryShape(
    plate,
    1,
    "faces",
    { position: "top", one: true },
    scope,
  )[0];
  const bottom = queryShape(
    plate,
    1,
    "faces",
    { position: "bottom", one: true },
    scope,
  )[0];
  const bore = queryShape(
    plate,
    1,
    "faces",
    { geomType: "cylinder", one: true },
    scope,
  )[0];
  const measured = measureShape(
    plate,
    [
      { kind: "distance", from: top.id, to: bottom.id },
      {
        kind: "distance",
        from: { point: [0, 0, 0] },
        to: { point: [3, 4, 0] },
      },
      { kind: "angle", from: top.id, to: bottom.id },
      {
        kind: "angle",
        from: { direction: [2, 0, 0] },
        to: { direction: [0, 4, 0] },
      },
      { kind: "diameter", entity: { kind: "faces", selector: bore.id } },
      { kind: "thickness", point: [6, 0, 2], direction: [0, 0, -2] },
      { kind: "size", axis: "x" },
    ],
    scope,
    1,
  );
  [4, 5, 180, 90, 4, 4, 20].forEach((expected, i) =>
    near(measured[i].value, expected),
  );
  const shell = cad.Box(20, 10, 8).shell(1);
  near(
    measureShape(
      shell,
      [{ kind: "thickness", point: [10, 0, 0], direction: [-1, 0, 0] }],
      scope,
      1,
    )[0].value,
    1,
  );
  assert.throws(
    () =>
      measureShape(
        shell,
        [{ kind: "thickness", point: [0, 0, 0], direction: [1, 0, 0] }],
        scope,
        1,
      ),
    /测厚点/,
  );
  assert.throws(
    () =>
      measureShape(
        plate,
        [{ kind: "thickness", point: [6, 0, 0], direction: [0, 0, 0] }],
        scope,
        1,
      ),
    /不能为零/,
  );
  const box = cad.Box(10, 20, 30);
  const edges = queryShape(
    box,
    1,
    "edges",
    { parallelTo: [0, 0, 1] },
    scope,
  ).map((item) => item.id);
  const rounded = editShape(
    box,
    normalizeOperations([{ op: "fillet", edges, radius: 0.5 }], box, 1, scope),
  );
  near(rounded.volume, 6000 - (4 - Math.PI) * 0.25 * 30);
  const lines = queryShape(box, 1, "edges", { parallelTo: [0, 0, 1] }, scope);
  const distance = measureShape(
    box,
    [{ kind: "distance", from: lines[0].id, to: lines[1].id }],
    scope,
    1,
  )[0].value;
  assert.ok(
    [10, 20, Math.hypot(10, 20)].some(
      (expected) => Math.abs(distance - expected) < 1e-6,
    ),
  );
  box.dispose();
  rounded.dispose();
  assert.equal(
    checkShape(
      plate,
      [{ measurement: { kind: "size", axis: "x" }, min: 19 }],
      scope,
      1,
    ).passed,
    true,
  );
  const checked = checkShape(
    plate,
    [
      {
        measurement: { kind: "size", axis: "x" },
        expected: 20,
        tolerance: 1e-6,
      },
      {
        measurement: { kind: "distance", from: top.id, to: bottom.id },
        min: 3.9,
        max: 4.1,
      },
      { measurement: { kind: "size", axis: "z" }, expected: 5 },
    ],
    scope,
    1,
  );
  assert.equal(checked.passed, false);
  assert.deepEqual(
    checked.results.map((item) => item.passed),
    [true, true, false],
  );
  plate.dispose();
  shell.dispose();
});

test(
  "model targets, scoped references, parameter merge/replace and historical exports stay independent",
  { timeout: 90000 },
  () =>
    setup(async (worker) => {
      const task = await worker.call("create");
      const projectId = task.id;
      const a = {
        projectId,
        sourceFile: "a.js",
        preserveSelection: true,
        geometry: false,
      };
      const b = { ...a, sourceFile: "b.js" };
      const source =
        "function build(p,cad){return cad.Box(p.length,p.width,p.height).named('参数块');}";
      await worker.call("build", {
        ...a,
        expectedRevision: 0,
        source,
        parameters: { length: 10, width: 20, height: 30, unused: 1 },
      });
      await worker.call("build", {
        ...b,
        expectedRevision: 0,
        source,
        parameters: { length: 6, width: 8, height: 10 },
      });
      assert.equal(
        (await worker.call("get", { projectId })).sourceFile,
        "model.js",
      );
      const readA = await worker.call("get", a);
      assert.equal(readA.head, 1);
      assert.equal(
        (await worker.call("get", { projectId })).sourceFile,
        "model.js",
      );
      const topA = (
        await worker.call("query", {
          ...a,
          expectedRevision: 1,
          kind: "faces",
          selector: { position: "top" },
        })
      ).items[0].id;
      await assert.rejects(
        worker.call("edit", {
          ...b,
          expectedRevision: 1,
          operations: [{ op: "move_faces", faces: topA, by: [0, 0, 1] }],
        }),
        /其他模型/,
      );
      const otherTask = await worker.call("create");
      await worker.call("build", {
        projectId: otherTask.id,
        sourceFile: "a.js",
        expectedRevision: 0,
        source,
        parameters: readA.parameters,
      });
      await assert.rejects(
        worker.call("edit", {
          projectId: otherTask.id,
          sourceFile: "a.js",
          expectedRevision: 1,
          operations: [{ op: "move_faces", faces: topA, by: [0, 0, 1] }],
        }),
        /其他模型/,
      );
      await assert.rejects(
        worker.call("edit", {
          ...a,
          expectedRevision: 1,
          operations: [
            { op: "translate", by: [20, 0, 0] },
            { op: "move_faces", faces: topA, by: [0, 0, 2] },
          ],
        }),
        /重新查询/,
      );
      const edited = await worker.call("edit", {
        ...a,
        expectedRevision: 1,
        operations: [
          { op: "move_faces", faces: topA, by: [0, 0, 2] },
          { op: "translate", by: [20, 0, 0] },
        ],
      });
      assert.equal(edited.head, 2);
      near(edited.design.metrics.volume, 6400);
      await assert.rejects(
        worker.call("edit", {
          ...a,
          expectedRevision: 2,
          operations: [{ op: "move_faces", faces: topA, by: [0, 0, 1] }],
        }),
        /过期/,
      );
      const replayed = await worker.call("update_parameters", {
        ...a,
        expectedRevision: 2,
        parameters: { length: 12 },
      });
      near(replayed.design.metrics.volume, 12 * 20 * 32);
      const merged = await worker.call("update_parameters", {
        ...b,
        expectedRevision: 1,
        parameters: { length: 12 },
      });
      assert.deepEqual(merged.parameters, { length: 12, width: 8, height: 10 });
      near(merged.design.metrics.volume, 960);
      const replaced = await worker.call("update_parameters", {
        ...b,
        expectedRevision: 2,
        mode: "replace",
        parameters: { length: 5, width: 6, height: 7 },
      });
      assert.deepEqual(replaced.parameters, { length: 5, width: 6, height: 7 });
      await assert.rejects(
        worker.call("update_parameters", {
          ...b,
          expectedRevision: 3,
          mode: "replace",
          parameters: { length: 2 },
        }),
      );
      assert.equal((await worker.call("get", b)).head, 3);
      const exportA = await worker.call("export", {
        ...a,
        revision: 1,
        format: "smb",
      });
      const exportB = await worker.call("export", {
        ...b,
        revision: 1,
        format: "smb",
      });
      assert.notEqual(exportA.path, exportB.path);
      near(cad.fromSmb(await readFile(exportA.path)).volume, 6000);
      near(cad.fromSmb(await readFile(exportB.path)).volume, 480);
      const restored = await worker.call("restore", {
        ...a,
        expectedRevision: 3,
        revision: 1,
      });
      assert.equal(restored.head, 1);
      near(restored.design.metrics.volume, 6000);
      assert.equal(
        (await worker.call("get", { projectId })).sourceFile,
        "model.js",
      );
      const checked = await worker.call("check", {
        ...b,
        expectedRevision: 3,
        checks: [{ measurement: { kind: "size", axis: "y" }, expected: 6 }],
      });
      assert.equal(checked.passed, true);
      const measured = await worker.call("measure", {
        ...b,
        expectedRevision: 3,
        measurements: [{ kind: "volume" }, { kind: "size", axis: "z" }],
      });
      near(measured.items[0].value, 210);
      near(measured.items[1].value, 7);
      assert.equal((await worker.call("get", b)).head, 3);
    }),
);

test(
  "structured imports snapshot resources; invalid operations and failed batches keep the committed files",
  { timeout: 90000 },
  () =>
    setup(async (worker) => {
      const task = await worker.call("create");
      const args = {
        projectId: task.id,
        sourceFile: "model.js",
        geometry: false,
      };
      await mkdir(join(task.directory, "resources"));
      const imported = cad.Box(10, 20, 30);
      await writeFile(
        join(task.directory, "resources", "part.smb"),
        cad.toSmb(imported),
      );
      const built = await worker.call("edit", {
        ...args,
        expectedRevision: 0,
        operations: [{ op: "import", file: "resources/part.smb", name: "导入零件" }],
      });
      near(built.design.metrics.volume, 6000);
      const original = await readFile(join(task.directory, "model.smp"));
      const invalidOperations = [
        { op: "box", size: [1, 2] },
        { op: "box", size: [-1, 2, 3] },
        { op: "cylinder", radius: 1 },
        { op: "sphere", radius: 1, typo: 1 },
        { op: "rotate", axis: [0, 0, 0], angle: 90 },
        { op: "sphere", radius: { parameter: "missing" } },
      ];
      for (const operation of invalidOperations) {
        assert.throws(
          () => editShape(imported, normalizeOperations([operation], imported)),
          { operationIndex: 0, operation: operation.op },
        );
      }
      await assert.rejects(
        worker.call("edit", { ...args, expectedRevision: 1, operations: [invalidOperations[0]] }),
        { operationIndex: 0, operation: "box" },
      );
      await assert.rejects(
        worker.call("edit", {
          ...args,
          expectedRevision: 1,
          operations: [
            { op: "translate", by: [5, 0, 0] },
            { op: "fillet", edges: { parallelTo: [0, 0, 1] }, radius: 100 },
          ],
        }),
        (error) => error.operationIndex === 1 && error.operation === "fillet",
      );
      assert.equal((await worker.call("get", args)).head, 1);
      assert.deepEqual(
        await readFile(join(task.directory, "model.smp")),
        original,
      );
      const step = await worker.call("export", {
        ...args,
        revision: 1,
        format: "step",
      });
      near(cad.fromStep(await readFile(step.path, "utf8")).volume, 6000);
      const changed = cad.Box(1, 2, 3);
      await writeFile(
        join(task.directory, "resources", "part.smb"),
        cad.toSmb(changed),
      );
      const old = await worker.call("export", {
        ...args,
        revision: 1,
        format: "smb",
      });
      near(cad.fromSmb(await readFile(old.path)).volume, 6000);
      const restored = await worker.call("restore", {
        ...args,
        expectedRevision: 1,
        revision: 1,
      });
      assert.equal(restored.head, 1);
      near(restored.design.metrics.volume, 6000);
      near(
        cad.fromSmb(
          await readFile(join(task.directory, "resources", "part.smb")),
        ).volume,
        6,
      );
      imported.dispose();
      changed.dispose();
    }),
);
