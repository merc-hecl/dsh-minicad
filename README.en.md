# MiniCAD for DeepSeek Harness

[简体中文](README.md)

An agent-first parametric CAD workbench for DSH. Natural-language requests and reference PDFs belong to the same design project; the user and the agent share source code, parameters, exact solids, and revision history.

## Features

- Natural-language modeling: create, query and edit parametric 3D models through ready-made operations or custom JavaScript with the DSH agent.
- Geometry measurement and dimensional checks: measure distances, angles, local directional wall thickness and dimensions, and check targets, tolerances or limits.
- Drawing references: provide reference drawings as task files or DSH attachments.
- Parameter and source editing: adjust model parameters or modify modeling source code through the agent.
- Model interaction: view models and drawings, annotate selected faces and edges for the agent, or edit local geometry and save revisions.
- Making record: review modeling steps, compare saved versions, and read the complete native conversation and tool records.
- Designs and conversations: each design has its own workspace, with multiple conversations sharing modeling resources and revision history.
- Export: STEP, STL, and editable project ZIP files.

## Local installation

The current development compatibility target is DSH **0.2.1-rc.5**. DSH plugin APIs are changing rapidly; other versions require verification.

### Install the prebuilt package

Extract `dsh-minicad-<version>.tgz` and use its `package` directory containing `package.json`. The archive includes the prebuilt client, SMLib WebAssembly kernel and other runtime dependencies. No manual `npm install` or build is needed. Keep the bundled `node_modules` directory.

Desktop plugins are exclusively managed by the Electron application. In DSH's **Plugins** page, install the extracted directory, for example `link:F:/MiniCAD/package`, review the preview and enable it. Restart if requested, then open MiniCAD from the sidebar. Do not modify the `desktop` profile through the CLI.

A Web profile requires Node.js 22.19+ and pnpm (`npm install -g pnpm` if needed). Install the extracted directory with:

```powershell
npx @deepseek-ai/dsh@0.2.1-rc.5 plugin --profile web add link:F:/MiniCAD/package -w
```

If dsh is installed globally, use `dsh plugin --profile web add link:F:/MiniCAD/package -w`. Restart the Web host after installation and open MiniCAD from the sidebar. This repository has not been published to npm; use the local path instead of a package name.

For a Web profile without pnpm, place the extracted `package` directory in the profile's `node_modules/dsh-minicad`, then merge the complete entries from this repository's `cordis.patch.yml` into the profile's patch array. Do not append YAML after an existing `[]`. This manual method does not apply to the Desktop profile.

### Develop and package from source

Source development requires Node.js 22.19+. In the repository directory, run:

```powershell
npm install
npm run setup
```

`setup` builds the client; npm installs runtime dependencies. Install `link:F:/Projects/dsh-minicad` through Desktop plugin management or the Web CLI. The SMLib kernel runs in a separate Node process and needs no Python environment.

To create a distributable prebuilt package:

```powershell
New-Item -ItemType Directory -Force dist | Out-Null
npm pack --pack-destination dist
```

`npm pack` builds the client automatically and includes declared runtime dependencies and their transitive dependencies. Development dependencies, design data and local configuration are excluded.

## Usage

1. Click **Open or create design** in the design header and select or create a workspace through DSH's folder picker. That folder is the design root. Opening it for the first time uses its name for the design and creates the first DSH conversation. Describe dimensions, units, features and constraints, and add files through DSH's native composer.
2. Select a model already configured in DSH. MiniCAD does not store separate model credentials.
3. The sidebar follows Folder → Conversation, with each folder representing one design workspace. Use the new-conversation button beside a folder to start another modification, and click its conversation rows to switch. Conversations in the same design share its workspace, models, parameters and revision history; each has its own chat context. The agent reads design files and the current revision, then calls modeling tools. The canvas updates from valid geometry checkpoints during construction and displays the saved model after a successful build.
4. Edit values in the parameter panel or modify modeling source code through the agent. Saving rebuilds the model and validates solid geometry.
5. Export the current revision or restore a previous one. Restoring creates a new revision with an increasing number, preventing stale requests from overwriting newer state.

When idle, the input folds below the canvas with half the official plugin icon visible. Click it or press Enter on the canvas to expand; Escape folds it while preserving the draft. Sending folds it automatically. Clicking the canvas also folds the input when it contains no text, attachments or geometry references. The state island uses purple for understanding/planning, blue for modeling and teal for checking/saving. Green briefly settles after saving, amber indicates input needed or failure, and slate stays still after stopping. Hover or click it to inspect the step, add input or stop work. Theme, language and reduced motion follow the host or system.

Open **Making record** in the header to review the model in an independently framed viewport. The bottom filmstrip selects saved versions and process checkpoints; an older version can be overlaid as a dashed outline. DSH's complete native conversation and tool records have an independent reading area on the right. In a narrow workspace, switch between Model review and Conversation. Close the record to return to the workbench. Process geometry is read-only; face/edge references and manual edits target saved revisions. Failure and cancellation retain valid checkpoints for review.

`cad_edit` automatically records checkpoints after valid solid operations. Custom `cad_build` code can call `cad.checkpoint(part, "step label")` at meaningful stages; it returns the same part. Without explicit calls, only the final result is checkpointed. Checkpoints require valid closed solids with positive volume and do not commit revisions. Final validation and saving create a new revision. Fast consecutive operations may appear together at the next canvas refresh; recorded checkpoints remain selectable for review.

Like DSH's main interface, the sidebar groups conversations under collapsible workspace folders. DSH's main workspace list also groups these conversations by the same design folders. New and forked conversations retain design ownership. The main interface keeps its native list, search, ordering, pins and archive controls; workbench grouping stays unchanged. Groups are derived from MiniCAD's design index without rewriting Session headers or creating extra directories. Design names are independent of DSH conversation titles; generated or edited conversation titles never rename a design. The folder menu offers design rename, save as, references and removal. Conversation rows reuse DSH rename, pin, archive and fork actions; a forked conversation continues to share the same design files. Removing a design closes its list entry and keeps files and conversations; reopen its workspace to restore it.

The agent should ask for clarification when dimensions are incomplete or multiple views do not uniquely determine the geometry. Geometric validity checks do not establish structural strength, manufacturability, or complete dimensional correctness.

PDF parsing and scanned drawing interpretation use DSH attachments, scripting, or multimodal input, depending on the host tools and selected model.

The current implementation supports parametric single-part and multi-solid modeling, without assembly constraint solving or CAM toolpaths.

Use the inspect icon in the right toolbar to enter selection mode. Faces and edges are both selectable by default, with edges taking priority near a line; filters restrict selection to faces or edges. Clicking highlights the geometry and shows its label. Expand “Full reference” for the model- and revision-scoped ID used by agent tools. Click empty space to clear, or press Esc or the toolbar button again to exit. Dragging still rotates the model.

After selecting a face or edge, click “Reference” to add it to the native DSH composer with an optional requested change. A message can contain multiple references. References persist with drafts and appear as chips with comments in sent messages. The agent receives the model file, revision, full geometry reference, and element geometry. References belong to their original revision; reselect after a model update to avoid targeting a different element.

Click “Edit” to modify the selected geometry without predefined model parameters. Faces support offset, XYZ movement, removal with healing, and fillet removal; edges support fillets and chamfers. Dimensions use mm. “Save changes” validates the exact solid, creates a revision, and updates the canvas with the successful result. History can restore earlier versions. Failed edits preserve the previous version. Manual edits are unavailable while the agent is modeling.

The settings icon in the header edits face and edge ID formats. Defaults are `F-{n}` and `E-{n}`, shown as `F-1`, `E-1`, etc.; `{n}` starts at 1 without zero padding. Formats are stored in `settings.json` in the plugin data directory and saved with future successful modeling revisions. Existing revisions retain their formats; older models use the defaults. Short IDs apply within one model revision; use full references across models or revisions. Restoring a historical revision preserves its formats.

## Storage and runtime boundaries

Each design directly owns an ordinary workspace folder, for example `plate/model.js`, `plate/model.parameters.json` and `plate/model.smb`; no parent library is required. Design-relative paths such as `parts/plate.js` are also supported. Edit source and parameters in an external editor; the next read or build uses the files on disk. Models and revisions are independent between designs, while conversations in one design share those files with revision checks protecting newer state.

The workspace's `.cad-design.json` stores its name, conversation bindings, selected model file and revision records. Its `.cad-history/<source path without extension>/v0001/` folders preserve successful builds with source, parameters, SMLib solids and preview snapshots. Reference PDFs live in `references/`. Copy the complete design folder to take models and history with you; DSH still stores native chats. **Save as design** copies working files and revision history into a selected empty folder and starts an independent conversation. Uncommitted trials are not copied.

Renaming a design renames its workspace folder and updates the working directory of every associated conversation. Existing destination names receive a numeric suffix instead of being overwritten. Renaming is unavailable while a conversation or build is running; existing processes are not forcibly moved. Failed moves or directory updates roll back to the original location.

Opened design paths are stored in `$DSH_HOME/storages/minicad/designs.json`, or `~/.dsh/storages/minicad/designs.json` when DSH_HOME is unset. Set `dataDir` to override this settings directory. On first startup, legacy `libraries.json` and library `minicad.json` records migrate to independent designs without moving existing folders or changing models, history or conversation bindings. Legacy indexes remain untouched; each migrated design appears as a workspace folder with its associated conversations underneath.

Directory, status and saved-preview reads run in the host without starting a modeling process or loading SMLib. An isolated process is started only for real geometry calculations or legacy-preview refresh. Modeling writes share one serial queue; published process status and previews can be read during construction. Each revision's `summary.json` is a rebuildable read cache without meshes or views; deleting or corrupting it does not delete models or change revisions. Imported-resource fingerprints are computed in chunks instead of loading entire files into memory.

Process checkpoints are stored per model in `.cad-process/`, separately from committed revisions in `.cad-history/`. Polling reads current process metadata; binary previews load on demand, with at most six cached by the record page. The completion marker and final model commit in the same transaction.

Read-only geometry requests retry once after a short delay for transient allocation failures. Cancellation, timeouts, invalid arguments and modeling writes are never automatically retried.

Preview meshes and BREP lines are stored separately as `preview.bin` in each revision and fetched as binary data on demand; model summaries contain no large arrays. Legacy or damaged previews are rebuilt from that revision's exact solid without changing source, parameters or revision records. Solid validity checks, exact-model persistence and revision commits still run on every successful build.

Larger frontend modules, including the 3D viewport, load when entering the workbench. The frontend reuses the current model's preview buffer and cancels old preview reads when switching tasks. The viewport redraws only when the model, camera or display state changes, and pauses drawing while hidden.

Modeling code runs with the current user's privileges in a separate Node service process. **Process isolation is not a security sandbox.** Run only trusted design code. The agent instructions explicitly treat PDFs and documents as reference data. The default operation timeout is 120 seconds. Stopping a running build terminates its worker process while preserving committed revisions.

Override settings through a profile patch:

```yaml
- id: minicad
  config:
    dataDir: F:/CAD/MiniCAD
    timeout: 120000
```

Configuration overrides replace the entire configuration row. Do not let multiple DSH processes write to the same MiniCAD data directory.

## Modeling interfaces

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

`cad_measure.measurements` and `cad_check.checks` each accept 1–100 items. Measurements support:

- `distance`: `from` and `to` accept query IDs, `{ kind, selector }`, or `{ point: [x,y,z] }`. Returns the minimum distance between bounded geometry. Points, faces, solids and pairs of straight edges are supported; pairs of curved edges currently return an explicit unsupported-distance error. A point inside a solid measures clearance to its surface; nested solids measure wall clearance, while touching or overlapping solids return 0.
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

## Development and verification

```powershell
npm run dev
npm run check
npm test
```

`dev` uses a real DSH `minicad-dev` profile on port 3079 and stores project data in `.local/designs`. It reuses credentials and settings from the current DSH_HOME. Set `DSH_ELECTRON` and `DSH_CLI` to the installed Desktop executable and its bundled `dsh/lib/bin.js` to use that host instead of installing another one. Set `PORT` to override the port.

Kernel test files run sequentially to avoid loading several WebAssembly kernels at once. Write automated tests only for the modeling kernel service, which the agent verifies. All other changes are accepted by the user; see [AGENTS.md](AGENTS.md). `check` checks host syntax and builds the client; it is not a UI test.

Source layout: `src/client` contains the workbench, `src/host` contains the DSH service and agent tools, and `src/kernel` contains SMLib modeling and file persistence. The UI and the agent share the same service interface, and all design changes include `expectedRevision`.

## Troubleshooting and removal

| Symptom | Check |
|---|---|
| MiniCAD is missing from the sidebar | Confirm installation in the correct profile and restart DSH |
| Modeling service fails to start | Run `npm install` and `npm run setup` |
| Model authentication fails | Configure a model in DSH or select one provided by a signed-in account |
| HTTP 401 | Sign in through the host's launch URL first; a 401 does not prove that the plugin route is registered |
| HTTP 404 | Check the bundle, host service, and port |
| Revision conflict | Read the current revision again before making changes |
| Model is not visible | Check WebGL / graphics acceleration and confirm that a successful model revision exists |

After editing local code, run `npm run build`. The client supports DSH HMR; host code changes require a restart.

```powershell
npx @deepseek-ai/dsh@0.2.1-rc.5 plugin --profile web remove dsh-minicad -w
```

For Desktop, remove the plugin through the application's **Plugins** page. Its sidebar entry disappears when the host finishes removal or restarts. Removing the plugin does not delete design data.

## License

Licensed under the [MIT License](LICENSE). Third-party dependencies retain their own licenses; see [NOTICE.md](NOTICE.md).
