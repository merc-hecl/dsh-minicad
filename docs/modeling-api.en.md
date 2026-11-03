# Modeling API

[Back to README](../README.en.md) · [简体中文](modeling-api.md)

Agents are encouraged to use `cad_edit` first when existing operations express the geometry directly, batching related changes. Use `cad_build` for algorithms, custom geometry or work the operations cannot express conveniently, and mix both when useful. This is guidance, not a restriction. Both paths share exact solids, parameters, trials, dimensional checks, revisions, failure preservation and exports.

| Tool | Purpose |
| --- | --- |
| `cad_read_project` | Read source, parameters, models, revisions and geometry summaries; optional `sourceFile` does not change the UI selection |
| `cad_build` | Execute custom source; omit `source` to rebuild working files from disk |
| `cad_edit` | Execute 1–100 sequential operations and commit one revision only if all succeed |
| `cad_query` | Inspect faces, edges, solids or cylindrical bore segments (`kind: "holes"`), including axes and through clearance; supports trial candidates |
| `cad_commit` | Atomically publish an evaluated candidate after checking its base revision, unchanged working files and supplied dimensions |
| `cad_measure` | Measure geometry in batches without changing the model |
| `cad_check` | Check measured values against targets and tolerances or limits without changing the model |
| `cad_update_parameters` | Merge top-level parameters and rebuild by default; `mode: "replace"` replaces the entire parameter object |
| `cad_api` | Locate installed declarations by symbol or `Class.member`, with `offset` / `limit` paging |
| `cad_export` | Export a saved revision of a specified model file |
| `cad_restore` | Restore a file's historical revision as a new increasing revision |

Read model file names and revisions with `cad_read_project` first. All model tools except reading and API lookup require an explicit task-relative `sourceFile`; mutations, queries, measurements and checks also require that file's `expectedRevision`. Explicit agent targets do not change the UI selection. Revisions are independent per file; new files start at revision 0.

### Trials, checks and publication

`cad_build`, `cad_edit` and `cad_update_parameters` retain direct commits by default. Set `commit: false` to save a candidate and process checkpoints without replacing the saved source, parameters, solid or revision. The result supplies `runId` and current `head`. Pass the same `sourceFile`, `expectedRevision: head` and `runId` to query, measure and check that candidate. Candidate references belong to that candidate, not the saved model.

Publish once with `cad_commit`, supplying `runId`, the original `expectedRevision`, `summary` and complete `checks`. Publication uses the exact candidate without rerunning model code. Candidates persist under `.cad-process/` across restarts; a changed saved revision or working model files requires another trial. Trial mode isolates CAD publication; it does not undo arbitrary filesystem writes made by custom JavaScript.

All modeling commits accept `checks`; failed checks preserve the previous revision. `cad_commit` retains trial checks and adds new ones; an empty list cannot discard failed candidate checks. Correct a check definition by evaluating a new trial. Each check can include `name` and `basis` to record the dimension and its drawing view, annotation and units. Definitions and results persist with the revision and in ZIP `project.json`. `cad_check` is read-only, so supply the complete check list when publishing. A successful build without checks establishes valid geometry, not drawing compliance. Never change a drawing target to the measured value merely to pass a check.

Use `cad.log(...)` or `console.log(...)` for diagnostics. Tool results include logs and checkpoint labels; failures include their phase, operation and source stack. Do not publish test boxes or deliberately throw exceptions to obtain diagnostics.

### Bores and dimensional inspection

`cad_query(kind: "holes")` reports inward cylindrical bore wall segments with axis, diameter, axial span, `closedWall` and `through`. Through clearance requires a complete cylindrical wall and no material intersecting a slightly smaller cylinder along the entire model; `clearanceTolerance` records that margin. Counterbores and stepped bores can contain multiple segments, so segment count is not necessarily independent hole count. Open side cutouts are not complete walls.

Selectors support `radius`, optional `tolerance`, `axisDirection`, `through` and `closedWall`. A face's ordinary `center` is its area centroid; use `axis` or `hole.center` to locate a bore.

- `distance` measures minimum surface separation; `center_distance` measures geometric circle/sphere/cylinder centers or explicit points; `axis_distance` measures the minimum separation of infinite axes. Hole spacing usually calls for axis distance, not wall gap.
- `coordinate` reads a geometric center's X/Y/Z coordinate; a cylinder center is the midpoint of its wall's axial extent. `span` reads an entity's world-axis bounding size.
- `count` counts matching `entityKind: "faces" | "edges" | "solids" | "holes"` with an optional selector. Combine diameter, through clearance, axis position and local thickness checks to detect missing bores, side openings and half-depth steps.

`cad_api` accepts `Part.volume`, `Face.axis`, `Sketch.extrude`, etc. Pages default to 6000 characters with a maximum `limit` of 12000; follow `nextOffset` for the same topic/symbol. Primitives are centered by default, whereas an XY profile extrusion extends from its plane. `center` translates geometry; it is not a common alignment rule.

The MiniCAD preset includes the standard DSH filesystem, search, shell, skill and dependency tools. A file @mention is a path reference, not an uploaded PDF page. Read the actual file, render its pages using an available PDF renderer, and read the images with an image-capable model. Do not assume a parser is installed. `cad_read_project.referenceFiles` lists task resources/references; `attachments` represents only MiniCAD's reference catalog, not DSH session attachments.

### Ready-made operations and custom code

`cad_edit` supports primitive solids, extrusion, booleans, fillets, chamfers, shells, offsets, face edits and transforms, plus:

| Operation | Main parameters and semantics |
| --- | --- |
| `revolve` | `profile`, world-space `axis`, `angle`, optional `origin`; nonzero angle from -360 to 360 degrees |
| `loft` | Two or more ordered `sections`; optional `ruled`, `smooth`, `closed` |
| `sweep` | `profile` and `path` (line, polyline, spline, arc or helix); optional `orient`, `translational`, `twist` |
| `linear_pattern` | `step`, `count`; repeat a body or `tool` at the translation step |
| `circular_pattern` | `axis`, per-copy `angle`, `count`, optional `origin`; angle is the increment, not the total span |
| `rotate_faces` | `faces`, world `axis`, `angle`, optional `origin`; rotate selected faces and rebuild their neighbors |
| `scale` | A positive `factor` or three positive XYZ factors; optional scale center `origin` |
| `import` | Read a task-relative `file`, such as `resources/input.step`, `.brep` or `.smb`; resources travel with snapshots and ZIP exports |

A `profile` is a rectangle, circle or polygon on XY by default; use `plane: "XZ"` / `"YZ"`, `rotate` and `center` to place it. The generated solid also accepts `rotate` and `center`. Pattern `count` includes the original, from 2 to 100. With a `tool`, combine its copies using `mode: "fuse" | "cut" | "intersect"`; without one, copy the target body.

For example, create a plate and cut three holes in one batch:

```json
{
  "sourceFile": "model.js",
  "expectedRevision": 0,
  "parameters": { "length": 40 },
  "summary": "Create a three-hole plate",
  "operations": [
    { "op": "box", "size": [{ "parameter": "length" }, 20, 8] },
    { "op": "linear_pattern", "step": [8, 0, 0], "count": 3, "mode": "cut",
      "tool": { "shape": "cylinder", "radius": 1, "height": 10 } }
  ]
}
```

Each operation can select one independent solid with `target`, such as `{ nearest: [10, 0, 0], one: true }` or a current solid query ID. Only that solid is edited, then unioned with untouched solids; bodies that touch or overlap after editing may merge. Without `target`, the operation acts on the entire Part. The kernel enforces required fields, numeric bounds, vector lengths and unknown-field rejection. Failures include a zero-based `operationIndex`; a failed batch preserves the previous revision.

Custom source defines `build(parameters, cad)` and returns a valid `cad.Part` with positive volume. `cad` exposes SMLib functions, the same `cad.edit(part, operations, parameters)`, and task-local resource loading:

```javascript
function build(parameters, cad) {
  return cad.Box(parameters.length, 40, 8).cut(cad.Cylinder(4, 10));
}
```

`cad.readModel("resources/input.step")` also imports exact resources. Local edits are stored in source and replayed when parameters change. `cad_update_parameters` merges top-level keys by default; nested values replace as a whole. Use `mode: "replace"` to replace the full object or remove parameters. For `cad_build` / `cad_edit`, supplied `parameters` are the complete object; omitting them retains working parameters.

### Measurements, checks and geometry references

Workbench measurement and the agent’s `cad_measure` call the same kernel service with the same model revision, geometry references, units and results. `distance` returns minimum distance `value`, nearest points `point` / `otherPoint`, and world-axis `projections: { x, y, z }`; the workbench displays these returned projections directly. `projected_distance` supports individual axes and dimensional checks without selecting a separate pair. Numerical `accuracy` describes solving/tessellation accuracy; `cad_check.tolerance` describes the allowed deviation from a target. They are independent.

`cad_measure.measurements` and `cad_check.checks` each accept 1–100 items. Measurements support:

- `max_distance`: the farthest pair of points on the bounded geometry, using the same `from` and `to`. Curved surfaces use a dedicated fine tessellation; numerical results carry `approximate`, `method` and `accuracy` (mm).
- `projected_distance`: `from`, `to` and `axis: "x" | "y" | "z"`. Returns the absolute world-axis component of one nearest-point pair. Components may vary when the minimum pair is not unique; requests in one batch share the same nearest-point pair as `distance`.
- `distance`: `from` and `to` accept query IDs, `{ kind, selector }`, or `{ point: [x,y,z] }`. Returns the minimum distance between bounded geometry. Points, faces, solids and edge pairs are supported. Curved edge pairs use analytic or numerical solutions. A point inside a solid measures clearance to its surface; nested solids measure wall clearance, while touching or overlapping solids return 0.
- `angle`: 0–180 degrees between plane normals, line directions, rotation axes of circles/cylinders, or explicit `{ direction: [x,y,z] }` vectors.
- `thickness`: a `point` in/on a solid and a nonzero `direction` identify one continuous material segment. Returns its thickness and entry/exit points. This is local directional thickness, not the global minimum wall thickness. Cavity points, tangencies and indeterminate measurements are rejected.
- `size`: bounding-box extent along `axis: "x" | "y" | "z"`; `volume`, `area`, `length`, `radius` and `diameter` return the corresponding property. Size, volume and thickness accept a single-solid `target`; face/edge properties use `entity: { kind, selector }`.

Example dimensional checks:

```json
{
  "sourceFile": "model.js",
  "expectedRevision": 1,
  "checks": [
    { "measurement": { "kind": "size", "axis": "x" }, "expected": 40, "tolerance": 0.01 },
    { "measurement": { "kind": "thickness", "point": [-10, 5, 4], "direction": [0, 0, -1] }, "min": 2 }
  ]
}
```

Checks return overall `passed` and each measured value, unit and result. Use `expected` +/- `tolerance` (default 1e-6), or inclusive `min` / `max` bounds (either can be omitted). Length, area, volume and angle use mm, mm², mm³ and degrees; tolerances use the measurement's unit.

Geometry IDs bind the task, model file and revision. Stale and foreign references are rejected. `faces` / `edges` accept arrays of IDs. IDs resolve through topology positions and kernel derivation, never nearest-center guessing. A reference removed, split or no longer traceable after an earlier operation fails explicitly. Query again after edits; use geometry selectors for later steps in a batch. Replaying stored references requires unchanged topology, so prefer geometric selectors for parametric edits expected to change topology.

Exports are written to the task's `exports/<model path without .js>/`, preventing equal revision numbers in different files from overwriting one another. Existing export files remain available.
