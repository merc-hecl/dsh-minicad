# MiniCAD for DeepSeek Harness

[简体中文](README.md)

An agent-first parametric CAD workbench for DSH. Natural-language requests and reference PDFs belong to the same design project; the user and the agent share source code, parameters, exact solids, and revision history.

## Features

- Natural-language modeling: create, query and edit parametric 3D models through ready-made operations or custom JavaScript with the DSH agent.
- Geometry measurement and dimensional checks: measure distances, angles, local directional wall thickness and dimensions, and check targets, tolerances or limits.
- Drawing references: provide PDFs through DSH attachments for the agent to read using host capabilities.
- Parameter and source editing: adjust model parameters or modify modeling source code through the agent.
- Model interaction: view models and drawings, annotate selected faces and edges for the agent, or edit local geometry and save revisions.
- Making record: review modeling steps, compare saved versions, and read the complete native conversation and tool records.
- Library and task management: organize part-design tasks in libraries, each with its own conversation, modeling resources, and revision history.
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

1. Click the folder button in the library header and choose a design directory through DSH's folder picker. The library takes the directory's name. Create part-design tasks in it and describe dimensions, units, features, and constraints. Add files through DSH's native composer. Each task has its own DSH session; the host generates its title from the initial intent, and you can rename it manually. When no designs exist, the workbench prepares a blank task in the default library and its DSH session on first open.
2. Select a model already configured in DSH. MiniCAD does not store separate model credentials.
3. Each task uses its own subfolder in the library as its working directory and starts empty. The agent reads the task's modeling file and current revision, then calls modeling tools. The canvas updates from valid geometry checkpoints during construction and displays the saved model after a successful build.
4. Edit values in the parameter panel or modify modeling source code through the agent. Saving rebuilds the model and validates solid geometry.
5. Export the current revision or restore a previous one. Restoring creates a new revision with an increasing number, preventing stale requests from overwriting newer state.

When idle, the input folds below the canvas with half the official plugin icon visible. Click it or press Enter on the canvas to expand; Escape folds it while preserving the draft. Sending folds it automatically. Clicking the canvas also folds the input when it contains no text, attachments or geometry references. The state island uses purple for understanding/planning, blue for modeling and teal for checking/saving. Green briefly settles after saving, amber indicates input needed or failure, and slate stays still after stopping. Hover or click it to inspect the step, add input or stop work. Theme, language and reduced motion follow the host or system.

Open **Making record** in the header to review the model in an independently framed viewport. The bottom filmstrip selects saved versions and process checkpoints; an older version can be overlaid as a dashed outline. DSH's complete native conversation and tool records have an independent reading area on the right. In a narrow workspace, switch between Model review and Conversation. Close the record to return to the workbench. Process geometry is read-only; face/edge references and manual edits target saved revisions. Failure and cancellation retain valid checkpoints for review.

`cad_edit` automatically records checkpoints after valid solid operations. Custom `cad_build` code can call `cad.checkpoint(part, "step label")` at meaningful stages; it returns the same part. Without explicit calls, only the final result is checkpointed. Checkpoints require valid closed solids with positive volume and do not commit revisions. Final validation and saving create a new revision. Fast consecutive operations may appear together at the next canvas refresh; recorded checkpoints remain selectable for review.

The sidebar follows Library → Part-design task. Create or rename libraries, use a task's menu to rename it, move it to another library, or view the current task's reference drawings, and find tasks through search and sorting.

The agent should ask for clarification when dimensions are incomplete or multiple views do not uniquely determine the geometry. Geometric validity checks do not establish structural strength, manufacturability, or complete dimensional correctness.

PDF parsing and scanned drawing interpretation use DSH attachments, scripting, or multimodal input, depending on the host tools and selected model.

The current implementation supports parametric single-part and multi-solid modeling, without assembly constraint solving or CAM toolpaths.

Use the inspect icon in the right toolbar to enter selection mode. Faces and edges are both selectable by default, with edges taking priority near a line; filters restrict selection to faces or edges. Clicking highlights the geometry and shows its label. Expand “Full reference” for the model- and revision-scoped ID used by agent tools. Click empty space to clear, or press Esc or the toolbar button again to exit. Dragging still rotates the model.

After selecting a face or edge, click “Reference” to add it to the native DSH composer with an optional requested change. A message can contain multiple references. References persist with drafts and appear as chips with comments in sent messages. The agent receives the model file, revision, full geometry reference, and element geometry. References belong to their original revision; reselect after a model update to avoid targeting a different element.

Click “Edit” to modify the selected geometry without predefined model parameters. Faces support offset, XYZ movement, removal with healing, and fillet removal; edges support fillets and chamfers. Dimensions use mm. “Save changes” validates the exact solid, creates a revision, and updates the canvas with the successful result. History can restore earlier versions. Failed edits preserve the previous version. Manual edits are unavailable while the agent is modeling.

The settings icon in the header edits face and edge ID formats. Defaults are `F-{n}` and `E-{n}`, shown as `F-1`, `E-1`, etc.; `{n}` starts at 1 without zero padding. Formats are stored in `settings.json` in the plugin data directory and saved with future successful modeling revisions. Existing revisions retain their formats; older models use the defaults. Short IDs apply within one model revision; use full references across models or revisions. Restoring a historical revision preserves its formats.

## Storage and runtime boundaries

Files follow Library / Design task / Modeling resources. Each task uses an ordinary subfolder named after its initial title, adding a number when the name already exists. Later title changes leave the folder name unchanged. Source, parameters, and solids live inside the task, for example `plate/model.js`, `plate/model.parameters.json`, and `plate/model.smb`. Task-relative paths such as `parts/plate.js` are also supported. Edit source and parameters in an external editor; the next read or build uses the files on disk. Models and revisions are independent between tasks.

The library's `minicad.json` stores task folders, session bindings, selected modeling files, and revision records. Each task's `.cad-history/<source path without extension>/v0001/` folders preserve successful builds with source, parameters, SMLib solids, and preview snapshots. Reference PDFs live in that task's `references/` folder. Copy the entire library to take models and history with you, then reopen it through the folder picker. DSH's native sessions store conversations. The frontend list shows Library → Part-design task.

Moving a task to another library moves its entire folder, including source files, references, and history. If the destination already has a folder with that name, a number is appended to avoid overwriting it. Renaming a library changes its display name and leaves the disk folder name unchanged.

Paths of opened directories are stored in `$DSH_HOME/storages/minicad/libraries.json`, or `~/.dsh/storages/minicad/libraries.json` when DSH_HOME is unset. The default library uses the adjacent `default/` directory. Set `dataDir` to override this settings directory.

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

Agents can choose ready-made structured operations, write custom JavaScript with `cad_build`, or combine both. `cad_build` is a user-defined function (UDF) entry point. Both paths share exact solids, parameters, revisions, failure preservation and exports.

| Tool | Purpose |
| --- | --- |
| `cad_read_project` | Read source, parameters, models, revisions and geometry summaries; optional `sourceFile` does not change the UI selection |
| `cad_build` | Execute custom source; omit `source` to rebuild working files from disk |
| `cad_edit` | Execute 1–100 sequential operations and commit one revision only if all succeed |
| `cad_query` | Inspect faces, edges or independent solids and their scoped references |
| `cad_measure` | Measure geometry in batches without changing the model |
| `cad_check` | Check measured values against targets and tolerances or limits without changing the model |
| `cad_update_parameters` | Merge top-level parameters and rebuild by default; `mode: "replace"` replaces the entire parameter object |
| `cad_api` | Read installed SMLib JavaScript API declarations |
| `cad_export` | Export a saved revision of a specified model file |
| `cad_restore` | Restore a file's historical revision as a new increasing revision |

Read model file names and revisions with `cad_read_project` first. All model tools except reading and API lookup require an explicit task-relative `sourceFile`; mutations, queries, measurements and checks also require that file's `expectedRevision`. Explicit agent targets do not change the UI selection. Revisions are independent per file; new files start at revision 0.

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
