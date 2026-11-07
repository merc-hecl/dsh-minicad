# Modeling API

[Back to README](../README.en.md) · [简体中文](modeling-api.md)

For both new models and incremental edits, assess the existing `cad_edit` operations first. Prefer `cad_edit` when a coherent operation batch expresses the result clearly and reliably. Combinations of standard solids, booleans, profiles, holes, fillets, patterns, naming and colors usually fit this path; coordinate calculations or repeated features alone do not call for code-based modeling. Choose `cad_build` when a needed geometry or operation is missing, or a specialized algorithm offers a clear reliability or efficiency advantage. Base the choice on the specific gap or benefit; there is no need to attempt an unsuitable `cad_edit` call first. Both tools can still be combined as the task requires and share exact solids, trials, dimensional checks, revisions, failure preservation and exports.

| Tool | Purpose |
| --- | --- |
| `cad_read_project` | Read SMP model metadata, models, revisions and geometry summaries; optional `modelFile` does not change the UI selection |
| `cad_build` | Execute explicitly supplied source; access the saved exact shape through `cad.current` |
| `cad_import` | Import an exact file as a model snapshot; optional `metadataFile` restores part IDs and names |
| `cad_edit` | Create from an empty model or edit the saved solid incrementally; execute 1–100 sequential operations and commit one revision only if all succeed |
| `cad_query` | Inspect faces, edges, solids, bore segments or vertex coordinates; edges include endpoints and optional arc-length samples, bores include axes and through clearance; supports trial candidates |
| `cad_set_geometry_id_format` | Change face and edge display numbering and save a new revision |
| `cad_commit` | Atomically publish an evaluated candidate after checking its base revision, unchanged working files and supplied dimensions |
| `cad_measure` | Measure geometry in batches without changing the model |
| `cad_check` | Check measured values against targets and tolerances or limits without changing the model |
| `cad_api` | Locate installed declarations by symbol or `Class.member`, with `offset` / `limit` paging |
| `cad_fit` | Check clearance and interference between named parts without changing geometry |
| `cad_variants` | Copy the current SMP and apply explicit operations for independent variants |
| `cad_export` | Export a saved revision of a specified model file, optionally one part |
| `cad_restore` | Make an existing revision current without creating a revision |

Read model file names and revisions with `cad_read_project` first. All model tools except reading and API lookup require an explicit design-relative SMP `modelFile`; mutations, queries, measurements and checks also require that file's `expectedRevision`. Explicit agent targets do not change the UI selection. Revisions are independent per file; new files start at revision 0.

### Face and edge numbering

Call `cad_set_geometry_id_format` on a saved model with `modelFile`, `expectedRevision`, `summary`, and at least one of `faceFormat` and `edgeFormat`. A template must contain exactly one numbering placeholder. `{n}` starts numbering at 1. `{n:1}` through `{n:9}` set the minimum width and pad with leading zeros. For example, `Face-{n:3}` produces `Face-001`. Omitted formats retain their current values. Use `F-{n}` and `E-{n}` to reset the defaults.

A changed format commits a revision immediately. The workbench and `cad_query` use it for the display ID. Later builds inherit the current revision's formats. Restoring a revision also restores its formats. Queries, measurements and edits continue to use full revision-scoped `id` references.

### Trials, checks and publication

`head` identifies the current revision. Use `cad_restore` to switch it. Each commit records the current revision as its `parent` and takes the next number across all saved revisions of that file. Save or import pending model changes before switching revisions.

`cad_build`, `cad_edit` and `cad_import` retain direct commits by default. Set `commit: false` to save a candidate and process checkpoints without replacing the saved solid, metadata or revision. The result supplies `runId` and current `head`. Pass the same `modelFile`, `expectedRevision: head` and `runId` to query, measure and check that candidate. Candidate references belong to that candidate, not the saved model.

Publish once with `cad_commit`, supplying `runId`, the original `expectedRevision`, `summary` and complete `checks`. Publication uses the exact candidate without rerunning model code. Candidates persist under `.cad-process/` across restarts; a changed saved revision or working model files requires another trial. Trial mode isolates CAD publication; it does not undo arbitrary filesystem writes made by custom JavaScript.

All modeling commits accept `checks`; failed checks preserve the previous revision. `cad_commit` retains trial checks and adds new ones; an empty list cannot discard failed candidate checks. Correct a check definition by evaluating a new trial. Each check can include `name` and `basis` to record the dimension and its drawing view, annotation and units. Definitions and results persist with the revision and in ZIP `state.json`. `cad_check` is read-only, so supply the complete check list when publishing. A successful build without checks establishes valid geometry, not drawing compliance. Never change a drawing target to the measured value merely to pass a check.

Give every trial and saved change a concise `summary` in the user's language, such as "Create the plate outline and mounting holes" or "Adjust the center hole diameter". The making record displays this title directly. Keep full dimensions in source, parameters and checks; avoid placeholders such as `probe`, `probe2` and `test`.

When `cad_build` has multiple modeling stages worth reviewing, record the actual intermediate solids with `cad.checkpoint(part, "Stage description")`. Step cards prioritize these labels. Simple changes need no artificial extra stages; an unlabeled final checkpoint displays the run summary. For example:

```javascript
function build(parameters, cad) {
  let plate = cad.Box(80, 50, 6).named("Base plate");
  cad.checkpoint(plate, "Create the plate blank");
  plate = plate.cut(cad.Cylinder(3, 10));
  cad.checkpoint(plate, "Cut the center through-hole");
  return plate;
}
```

Use `cad_api` to inspect the kernel API and `cad.log(...)` or `console.log(...)` for diagnostics during actual modeling. Tool results include logs and checkpoint labels; failures include their phase, operation and source stack. Do not create dummy geometry or deliberately throw exceptions just to inspect the API or read logs.

### Bores and dimensional inspection

`cad_query(kind: "vertices")` returns actual topological vertices with `point: [x,y,z]` and revision-scoped IDs. Edge queries return `start`, `end` and `isClosed`; a closed edge can have coincident endpoints. All coordinates are world-space mm. Vertices are not bounding-box corners. An edge's `center` is its arc-length midpoint (`centerMeaning: "arc_length_midpoint"`), which need not be its curve centroid or circle center.

For edges, optional `edgeParameters: [0,0.5,1]` adds `samples: [{t,point}]` to each result. Each `t` is a fraction of arc length in [0,1], not a raw curve parameter: 0 is the start, 1 the end and 0.5 halfway along the edge. `selector` accepts a filter object or a full current query ID from the same file and saved revision or specified candidate. Foreign, stale and other-candidate references are rejected. For example:

```json
{
  "modelFile": "model.smp",
  "expectedRevision": 1,
  "kind": "edges",
  "selector": { "geomType": "circle" },
  "edgeParameters": [0, 0.25, 0.5, 0.75, 1]
}
```

`cad_query(kind: "holes")` reports inward cylindrical bore wall segments with axis, diameter, axial span, `closedWall` and `through`. Through clearance requires a complete cylindrical wall and no material intersecting a slightly smaller cylinder along the entire model; `clearanceTolerance` records that margin. Counterbores and stepped bores can contain multiple segments, so segment count is not necessarily independent hole count. Open side cutouts are not complete walls.

Selectors support `radius`, optional `tolerance`, `axisDirection`, `through` and `closedWall`. Queries return `geometricCenter: [x,y,z]` for circular edges, spherical faces and cylindrical faces. It gives the circle center, sphere center or midpoint of the cylindrical face's axial extent on its axis. A face's `center` gives its area centroid. Bore segments also expose the axial midpoint in `hole.center`.

- `distance` measures minimum surface separation; `center_distance` measures geometric circle/sphere/cylinder centers or explicit points; `axis_distance` measures the minimum separation of infinite axes. Hole spacing usually calls for axis distance, not wall gap.
- `coordinate` reads the selected X, Y or Z component of `geometricCenter` for dimensional checks. `span` reads an entity's world-axis bounding size.
- `count` counts matching `entityKind: "faces" | "edges" | "solids" | "holes"` with an optional selector. Combine diameter, through clearance, axis position and local thickness checks to detect missing bores, side openings and half-depth steps.

`cad_api` accepts `Part.volume`, `Face.axis`, `Sketch.extrude`, etc. Pages default to 6000 characters with a maximum `limit` of 12000; follow `nextOffset` for the same topic/symbol. Primitives are centered by default, whereas an XY profile extrusion extends from its plane. `center` translates geometry; it is not a common alignment rule.

The MiniCAD preset includes the standard DSH filesystem, search, shell, skill and dependency tools. A file @mention is a path reference, not an uploaded PDF page. Read the actual file, render its pages using an available PDF renderer, and read the images with an image-capable model. Do not assume a parser is installed. `cad_read_project.referenceFiles` lists task resources/references; `attachments` represents only MiniCAD's reference catalog, not DSH session attachments.

### Ready-made operations and custom code

`cad_edit` groups operations by solid creation and combination, local edits, transforms and patterns, and appearance. A single call can mix operations from any group and runs them in array order.

| Operation | Main parameters and semantics |
| --- | --- |
| `add_part` | `id`, `name`, `tool`; add an independent part or start an assembly from an empty model |
| `copy_part` | `part`, new `id`, `name`, optional translation `center` and `rotate`; retain the original and add an independent copy |
| `remove_part` | `part`; remove a member; a published model must still contain a valid solid |
| `revolve` | `profile`, world-space `axis`, `angle`, optional `origin`; nonzero angle from -360 to 360 degrees |
| `loft` | Two or more ordered `sections`; optional `ruled`, `smooth`, `closed` |
| `sweep` | `profile` and `path` (line, polyline, spline, arc or helix); optional `orient`, `translational`, `twist` |
| `linear_pattern` | `step`, `count`; repeat a body or `tool` at the translation step |
| `circular_pattern` | `axis`, per-copy `angle`, `count`, optional `origin`; angle is the increment, not the total span |
| `rotate_faces` | `faces`, world `axis`, `angle`, optional `origin`; rotate selected faces and rebuild their neighbors |
| `scale` | A positive `factor` or three positive XYZ factors; optional scale center `origin` |
| `color` | `color` accepts `"#RRGGBB"` or `null`. Omit `faces` to color the whole part, or supply `faces` to change the selected face overrides. In an assembly, use `part` to specify the part ID |
| `rename` | `name` is a nonempty purpose-based solid name. Name a standalone solid directly, use `part` for an assembly member, or `target` for one solid in a multi-solid Part. Geometry and IDs are unchanged |
| `import` | Read a task-relative `file`, such as `resources/input.step`, `.brep` or `.smb`; resources travel with snapshots and ZIP exports |

A `profile` can be a `rectangle`, `circle`, `polygon` or `wire`. It starts on XY. Use `plane: "XZ"` / `"YZ"`, `rotate` and `center` to place it. The generated solid also accepts `rotate` and `center`.

A `wire` lists its `segments` in order, with points in local profile coordinates `[x,y]`. Each segment ends where the next begins, and the last returns to the first start. A wire can mix the following segment types.

| `shape` | Parameters |
| --- | --- |
| `line` | `start`, `end` |
| `arc` | `start`, a point on the arc `through`, and `end` |
| `center_arc` | `center`, `radius`, `startAngle`, `arcSize`. Angles are in degrees from the local +X axis. Negative spans run clockwise. The span is between -360 and 360 degrees and must be nonzero |

This operation extrudes a D-shaped profile.

```json
{
  "op": "extrude",
  "name": "D-shaped bracket",
  "amount": 8,
  "profile": {
    "shape": "wire",
    "segments": [
      { "shape": "line", "start": [-5, 0], "end": [5, 0] },
      { "shape": "arc", "start": [5, 0], "through": [0, 5], "end": [-5, 0] }
    ]
  }
}
```

A three-point arc in `sweep.path` takes world coordinates `[x,y,z]`. Pattern `count` includes the original, from 2 to 100. With a `tool`, combine its copies using `mode: "fuse" | "cut" | "intersect"`. Omit the tool to copy the target body.

Initial modeling starts without a solid: create or import one before applying cuts, chamfers or other modifications. Ordinary edits to an existing revision load its saved exact solid and execute only the new operations. Do not resubmit earlier operations; process checkpoints record only the current operations. Only this call creates the initial geometry; files on disk are never executed implicitly.

Edits modify the saved SMP directly and never append or replay source. Optional `parameters` resolve numeric `{parameter:"name"}` references in this call only. Omitted parameters are an empty object. Later changes to scripts or reference resources do not alter the saved geometry.

For example, `{"op":"color","part":"lid","color":"#4682B4"}` colors the lid. Follow it with `{"op":"color","part":"lid","faces":{"position":"top"},"color":"#FF8000"}` to make the top face orange. Use `null` to clear the color at the selected scope. A face with its override cleared inherits the part color. Colors are saved with the revision and can be exported in SMP and STEP.

For example, create a plate and cut three holes in one batch:

```json
{
  "modelFile": "model.smp",
  "expectedRevision": 0,
  "parameters": { "length": 40 },
  "summary": "Create a three-hole plate",
  "operations": [
    { "op": "box", "size": [{ "parameter": "length" }, 20, 8], "name": "Drilled plate" },
    { "op": "linear_pattern", "step": [8, 0, 0], "count": 3, "mode": "cut",
      "tool": { "shape": "cylinder", "radius": 1, "height": 10 } }
  ]
}
```

Each operation can select one independent solid with `target`, such as `{ nearest: [10, 0, 0], one: true }` or a current solid query ID. Only that solid is edited, then unioned with untouched solids; bodies that touch or overlap after editing may merge. Without `target`, the operation acts on the entire Part. The kernel enforces required fields, numeric bounds, vector lengths and unknown-field rejection. Failures include a zero-based `operationIndex`; a failed batch preserves the previous revision.

Custom source defines `build(parameters, cad)` and returns a valid `cad.Part` with positive volume. `cad` exposes SMLib functions, the same `cad.edit(part, operations, parameters)`, and task-local resource loading:

```javascript
function build(parameters, cad) {
  return cad.Box(parameters.length, 40, 8).cut(cad.Cylinder(4, 10)).named("Drilled plate");
}
```

`cad.readModel("resources/input.step")` imports and archives exact resources. Every `cad_build` call requires explicit `source`. `cad.current` is the current exact saved model, or `null` for a new model. With `part:"lid"`, it is that member only and the return value replaces only that member. Parameters belong to this execution. Relative `require` and `__dirname` resolve from the design root. Local CommonJS modules and files read through `cad.readModel` are archived automatically; declare other file inputs with `inputs:["resources/table.json"]`.

Every final independent solid must have a meaningful purpose-based name. The assembly collection needs no overall name. Set `name` on an initial creation operation or finish the batch with `rename`; rename an existing assembly member with `{op:"rename",part:"lid",name:"Inspection cover"}`. Intermediate construction and `commit:false` trials may be unnamed, but publishing through `cad_build`, `cad_edit` or `cad_commit` rejects unnamed solids and preserves the saved revision. Edits retain unambiguous inherited names; split or merged solids with ambiguous ownership require explicit names. Names persist with revisions, queries and workbench previews. STEP and SMP exports retain solid names; SMB and STL do not store these names.


Cut the current exact part without rebuilding earlier features:

```javascript
function build(parameters, cad) {
  return cad.current.cut(cad.Cylinder(4, 100));
}
```

### Measurements, checks and geometry references

The workbench uses the same geometry query as `cad_query` for one selected target and the same distance calculation as `cad_measure` for two. `distance` returns minimum distance `value`, nearest points `point` / `otherPoint`, and world-axis `projections: { x, y, z }`; the workbench displays these returned projections directly. `projected_distance` supports individual axes and dimensional checks without selecting a separate pair. Numerical `accuracy` describes solving/tessellation accuracy; `cad_check.tolerance` describes the allowed deviation from a target. They are independent.

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
  "modelFile": "model.smp",
  "expectedRevision": 1,
  "checks": [
    { "measurement": { "kind": "size", "axis": "x" }, "expected": 40, "tolerance": 0.01 },
    { "measurement": { "kind": "thickness", "point": [-10, 5, 4], "direction": [0, 0, -1] }, "min": 2 }
  ]
}
```

Checks return overall `passed` and each measured value, unit and result. Use `expected` +/- `tolerance` (default 1e-6), or inclusive `min` / `max` bounds (either can be omitted). Length, area, volume and angle use mm, mm², mm³ and degrees; tolerances use the measurement's unit.

Geometry IDs bind the task, model file and revision. Stale and foreign references are rejected. `faces` / `edges` accept arrays of IDs. IDs resolve through topology positions and kernel derivation, never nearest-center guessing. A reference removed, split or no longer traceable after an earlier operation fails explicitly. Query again after edits; use geometry selectors for later steps in a batch. Face and edge IDs are revision-local, not permanent cross-version identities.

Exports are written to the task's `exports/<model path without .smp>/`, preventing equal revision numbers in different files from overwriting one another. Existing export files remain available.


## Multipart models

`cad_build` may return `cad.assembly([{id,name,shape}])`. Each ID is stable and unique within the model; name is the display label and shape is a valid `cad.Part` placed in world coordinates. Contact and overlap never fuse components. Assembly volume sums member volumes, including overlapping material. Repeated instances may share construction code but each placed instance needs its own ID.

```javascript
function build(p, cad) {
  return cad.assembly([
    { id: "base", name: "Base", shape: cad.Box(p.length, 40, 8) },
    { id: "lid", name: "Lid", shape: cad.Box(p.length, 40, 2).translate(0, 0, 5) }
  ]);
}
```

- `cad_query(kind:"parts")` lists IDs, labels, dimensions, volumes and preview ranges. Geometry selectors accept `part:"lid"`; geometry results include `part` and `partName`. Geometry IDs remain scoped to the model file and revision.
- Each `cad_edit` operation specifies `part:"lid"`, e.g. `{op:"translate",part:"lid",by:[0,0,10]}`. Existing operations edit that member without merging other parts. Use `add_part`, `copy_part` and `remove_part` to manage members, or explicitly script a complex change through `cad.current`.
- Measurements can target `{part:"lid",one:true}`. Thickness requires a single solid target.
- `cad_fit` takes `modelFile`, `expectedRevision`, `pairs:[{from:"base",to:"lid"}]` and optional `tolerance` (default 0.001 mm). It reports minimum surface distance, interference volume and `contact`, `separated` or `interference`; it neither solves constraints nor changes geometry.
- `cad_export` optionally takes `part:"lid"`. Omit it for the whole model. Whole models support STEP, STL, SMP and project ZIP; SMB is a single-body exchange format. Individual exports retain world placement. STEP round trips check solid count, volume and bounding dimensions/placement, without claiming to retain assembly constraints or a hierarchy tree.
- Revision comparison compares occupied material volume; renaming, ID changes and regrouping alone have no volume difference.

The plugin's `cad.assembly` supports whole-model `translate` and `rotate`, plus `parts` and `part(id)` member access. It is not a SMLib `cad.Part`. Apply custom Boolean operations to member shapes and compose a new assembly.

## Model variants

`cad_variants` copies the saved exact SMP and applies each variant's explicit `operations`. It does not execute historical scripts. Outputs are new design-relative `.smp` files; the original model and UI selection remain unchanged.

```json
{
  "modelFile": "model.smp",
  "expectedRevision": 1,
  "variants": [
    { "name": "Long", "modelFile": "sizes/long.smp", "operations": [{ "op": "scale", "factor": [1.5, 1, 1] }] },
    { "name": "Thick", "modelFile": "sizes/thick.smp", "operations": [{ "op": "offset_faces", "faces": { "position": "top" }, "distance": 2 }] }
  ],
  "formats": ["step"]
}
```

A batch contains 1–20 variants with optional call-local `parameters` and `checks`; old checks are not inherited. Every variant is evaluated before publication. Commits and exports are individually durable; failures report already saved variants. Outputs are independent and do not track later model changes.

## Native snapshots and build archives

Revisions live under `.cad-history/<model path without .smp>/vNNNN/`. Only `model.smp` and `state.json` are required to restore, query or continue editing geometry.

| File | Role |
| --- | --- |
| `model.smp` | Required: exact geometry, topology and colors |
| `state.json` | Required: format version, units, part IDs/names and entity mapping, plus geometry summaries and checks for this revision |
| `preview.bin` | Regenerable workbench mesh cache |
| `operations.json` | Tool call, input model/revision, kernel version, operations and checks; an audit record, never a geometry replay dependency |
| `build/source.js` | Required archive of the actual source whenever this revision used cad_build |
| `build/base.smp`, `build/base.state.json` | Archived input snapshot when building on an existing model; the operation record identifies the selected part |
| `build/parameters.json` | Parameters supplied to this build, when present |
| `build/inputs/` | Build resources, local helper modules and declared file inputs, when used |
| `inputs/` | Files read by imports or structured operations, when used |

Working models are `<name>.smp` and `<name>.state.json`. `.cad-design.json` manages model lists, revision relationships and current pointers. ZIP exports contain the revision snapshot and its execution materials. Import the SMP as `file` and metadata as `metadataFile` to restore part identity without the original workspace. Checks record this revision's verification, not persistent constraints.

Subsequent cad_edit calls never rewrite or copy earlier source. Explicit script execution creates a new candidate; use `cad.current` to edit the current exact geometry. Failed and uncommitted source, parameters and inputs remain in their `.cad-process/` run.

External SMB remains supported as a single-body exchange format.
