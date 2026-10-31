# MiniCAD for DeepSeek Harness

[简体中文](README.md)

An agent-first parametric CAD workbench for DSH. Natural-language requests and reference PDFs belong to the same design project; the user and the agent share source code, parameters, exact solids, and revision history.

## Features

- Natural-language modeling: create and modify parametric 3D models through the DSH agent.
- Drawing references: provide PDFs through DSH attachments for the agent to read using host capabilities.
- Parameter and source editing: adjust model parameters or modify modeling source code through the agent.
- Model viewing: view 3D models and reference drawings.
- Library and task management: organize part-design tasks in libraries, each with its own conversation, modeling resources, and revision history.
- Export: STEP, STL, SVG, PDF, and editable project ZIP files.

## Local installation

Requires Node.js 22.19+, pnpm, and DSH. The current development compatibility target is DSH **0.2.1-rc.5**. DSH plugin APIs are changing rapidly; other versions require verification.

```powershell
npm install
npm run setup
```

`setup` builds the client. The SMLib WebAssembly kernel is installed with npm dependencies and runs in a separate Node process.

If pnpm is not installed, run `npm install -g pnpm`.

The Electron application exclusively manages Desktop plugins. In DSH's **Plugins** page, choose to install a local plugin and enter `link:F:/Projects/dsh-minicad`, replacing the path with your repository's absolute path. Review the installation preview and enable the plugin. Restart if requested, then open MiniCAD from the sidebar. Do not modify the `desktop` profile through the CLI.

For a Web profile, use the CLI:

```powershell
npx @deepseek-ai/dsh@0.2.1-rc.5 plugin --profile web add link:F:/Projects/dsh-minicad -w
```

If dsh is installed globally, use `dsh plugin --profile web add link:F:/Projects/dsh-minicad -w`. Restart the Web host after installation and open MiniCAD from the sidebar. This repository has not been published to npm; use the local path instead of a package name.

For a Web profile without pnpm, place the repository in the target profile's `node_modules/dsh-minicad`, install dependencies, and build it. Merge the complete entries from this repository's `cordis.patch.yml` into the profile's patch array; do not append YAML after an existing `[]`. This manual method does not apply to the Desktop profile.

## Usage

1. Click the folder button in the library header and choose a design directory through DSH's folder picker. The library takes the directory's name. Create part-design tasks in it and describe dimensions, units, features, and constraints. Add files through DSH's native composer. Each task has its own DSH session; the host generates its title from the initial intent, and you can rename it manually. When no designs exist, the workbench prepares a blank task in the default library and its DSH session on first open.
2. Select a model already configured in DSH. MiniCAD does not store separate model credentials.
3. Each task uses its own subfolder in the library as its working directory and starts empty. The agent reads the task's modeling file and current revision, then calls modeling tools. The canvas displays the actual model after a successful build.
4. Edit values in the parameter panel or modify modeling source code through the agent. Saving rebuilds the model and validates solid geometry.
5. Export the current revision or restore a previous one. Restoring creates a new revision with an increasing number, preventing stale requests from overwriting newer state.

The sidebar follows Library → Part-design task. Create or rename libraries, use a task's menu to rename it, move it to another library, or view the current task's reference drawings, and find tasks through search and sorting.

The agent should ask for clarification when dimensions are incomplete or multiple views do not uniquely determine the geometry. Geometric validity checks do not establish structural strength, manufacturability, or complete dimensional correctness.

PDF parsing and scanned drawing interpretation use DSH attachments, scripting, or multimodal input, depending on the host tools and selected model.

SVG / PDF exports currently provide three-view reference sheets with overall dimensions. They do not include complete hole-location dimension chains, geometric tolerances, surface roughness, or manufacturing annotations. Production drawings still require engineering review and additional annotations. The current implementation supports parametric single-part and multi-solid modeling, without assembly constraint solving or CAM toolpaths.

## Storage and runtime boundaries

Files follow Library / Design task / Modeling resources. Each task uses an ordinary subfolder named after its initial title, adding a number when the name already exists. Later title changes leave the folder name unchanged. Source, parameters, and solids live inside the task, for example `plate/model.js`, `plate/model.parameters.json`, and `plate/model.smb`. Task-relative paths such as `parts/plate.js` are also supported. Edit source and parameters in an external editor; the next read or build uses the files on disk. Models and revisions are independent between tasks.

The library's `minicad.json` stores task folders, session bindings, selected modeling files, and revision records. Each task's `.cad-history/<source path without extension>/v0001/` folders preserve successful builds with source, parameters, SMLib solids, and preview snapshots. Reference PDFs live in that task's `references/` folder. Copy the entire library to take models and history with you, then reopen it through the folder picker. DSH's native sessions store conversations. The frontend list shows Library → Part-design task.

Moving a task to another library moves its entire folder, including source files, references, and history. If the destination already has a folder with that name, a number is appended to avoid overwriting it. Renaming a library changes its display name and leaves the disk folder name unchanged.

Paths of opened directories are stored in `$DSH_HOME/storages/minicad/libraries.json`, or `~/.dsh/storages/minicad/libraries.json` when DSH_HOME is unset. The default library uses the adjacent `default/` directory. Set `dataDir` to override this settings directory.

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

Agents use `cad_query` to inspect geometry and `cad_edit` to create or edit solids. `cad_build` accepts JavaScript parametric source, and `cad_api` reads the installed API declarations. Define `build(parameters, cad)`; `cad` provides SMLib modeling functions and task-local resource loading:

```javascript
function build(parameters, cad) {
  return cad.Box(parameters.length, 40, 8).cut(cad.Cylinder(4, 10));
}
```

Local edits are recorded in source and replayed when parameters change. Face and edge references belong to the queried revision; query again after an edit. `cad.readModel("resources/input.step")` imports task-local STEP, BREP, or SMLib resources, which are included in snapshots and editable ZIP exports. Exported files are written to the task's `exports/` directory.

## Development and verification

```powershell
npm run dev
npm run check
npm test
```

`dev` uses a real DSH `minicad-dev` profile on port 3079 and stores project data in `.local/designs`. It reuses credentials and settings from the current DSH_HOME. Set `DSH_ELECTRON` and `DSH_CLI` to the installed Desktop executable and its bundled `dsh/lib/bin.js` to use that host instead of installing another one. Set `PORT` to override the port.

Write automated tests only for the modeling kernel service, which the agent verifies. All other changes are accepted by the user; see [AGENTS.md](AGENTS.md). `check` checks host syntax and builds the client; it is not a UI test.

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
