# MiniCAD for DeepSeek Harness

[简体中文](README.md)

An agent-first parametric CAD workbench for DSH. Natural-language requests and reference PDFs belong to the same design project; the user and the agent share source code, parameters, exact solids, and revision history.

## Features

- DSH sidebar entry and an immersive Three.js canvas with orthographic views, unrestricted 360° rotation, right-drag panning, and cursor-centered wheel zoom. Wireframe mode displays solid geometry edges without tessellation diagonals.
- A separate directory and DSH conversation for each design, with real tool calls through models configured in DSH.
- The input area uses DSH's native conversation composer; DSH owns model names, reasoning effort, send/stop controls, and drafts.
- Parametric solid modeling with build123d / OCCT, with editable source code and parameters.
- PDF text extraction, page rendering, previews, and agent access. Scanned drawings require a model that supports image input; text-only models can use only extracted text.
- Solid validity, volume, bounding-box, and specified dimension checks before saving. Failed builds preserve the previous revision; stale writes are rejected.
- Dimension expressions tied to parameters, revision restoration, and recovery after restarting.
- STEP export with read-back validation, STL, SVG, PDF, and editable project ZIP exports.
- Chinese / English, light / dark appearance, and text/code fonts and sizes follow DSH global settings.
- Entering the workbench collapses DSH's left sidebar. The top-left back arrow expands it and opens DSH's new-conversation home.
- Use the panel icon to collapse or expand design projects. The top-right `+` creates a design; clicking a design name toggles its contents.
- Camera menus, Model / Drawing segmented controls, action buttons, and hover tooltips use native DSH components and sizing.
- A single-cell millimetre scale bar and major/minor grid adapt to zoom, with grid spacing following 1, 2, and 5 increments. The background grid is rendered separately to avoid model-camera clipping when zoomed out.

## Local installation

Requires Node.js 22.19+, [uv](https://docs.astral.sh/uv/getting-started/installation/), pnpm, and DSH. The current development compatibility target is DSH **0.2.1-rc.5**. DSH plugin APIs are changing rapidly; other versions require verification.

```powershell
npm install
npm run setup
```

`setup` installs the locked Python environment with `uv sync --project python --frozen`, then builds the client. The runtime uses `uv run --project python --frozen python`. Do not modify the environment manually with pip or `python -m venv`.

If pnpm is not installed, run `npm install -g pnpm`.

The Electron application exclusively manages Desktop plugins. In DSH's **Plugins** page, choose to install a local plugin and enter `link:F:/Projects/dsh-minicad`, replacing the path with your repository's absolute path. Review the installation preview and enable the plugin. Restart if requested, then open MiniCAD from the sidebar. Do not modify the `desktop` profile through the CLI.

For a Web profile, use the CLI:

```powershell
npx @deepseek-ai/dsh@0.2.1-rc.5 plugin --profile web add link:F:/Projects/dsh-minicad -w
```

If dsh is installed globally, use `dsh plugin --profile web add link:F:/Projects/dsh-minicad -w`. Restart the Web host after installation and open MiniCAD from the sidebar. This repository has not been published to npm; use the local path instead of a package name.

For a Web profile without pnpm, place the repository in the target profile's `node_modules/dsh-minicad`, install dependencies, and build it. Merge the complete entries from this repository's `cordis.patch.yml` into the profile's patch array; do not append YAML after an existing `[]`. This manual method does not apply to the Desktop profile.

## Usage

1. Create a design and describe its dimensions, units, features, and constraints. Add files through DSH's native composer; the workbench has no separate Add PDF or Design conversation controls. When no designs exist, the workbench prepares a blank design and its DSH session on first open.
2. Select a model already configured in DSH. MiniCAD does not store separate model credentials.
3. The agent reads the current revision and calls modeling tools. The canvas displays the actual model after a successful build.
4. Edit values in the parameter panel or edit `build(parameters)` in the source panel. Saving rebuilds and validates the model.
5. Export the current revision or restore a previous one. Restoring creates a new revision with an increasing number, preventing stale requests from overwriting newer state.

The agent should ask for clarification when dimensions are incomplete or multiple views do not uniquely determine the geometry. Geometric validity checks do not establish structural strength, manufacturability, or complete dimensional correctness.

SVG / PDF exports currently provide three-view reference sheets with overall dimensions. They do not include complete hole-location dimension chains, geometric tolerances, surface roughness, or manufacturing annotations. Production drawings still require engineering review and additional annotations. The current implementation supports parametric single-part and multi-solid modeling, without assembly constraint solving or CAM toolpaths.

## Storage and runtime boundaries

Data is stored in `$DSH_HOME/storages/minicad`, or `~/.dsh/storages/minicad` when DSH_HOME is unset. SQLite stores the project catalog and revision heads. Each successful build preserves its source, parameters, BREP, and preview state. PDFs belong to their design projects; cross-project attachment access is rejected. DSH's native sessions store model conversations.

Modeling code runs with the current user's privileges in a separate Python service process. **Process isolation is not a security sandbox.** Run only trusted design code. The agent instructions explicitly treat PDFs and documents as reference data. The default operation timeout is 120 seconds. Stopping a running build terminates its worker process while preserving committed revisions.

Override settings through a profile patch:

```yaml
- id: minicad
  config:
    dataDir: F:/CAD/MiniCAD
    timeout: 120000
```

Configuration overrides replace the entire configuration row. Do not let multiple DSH processes write to the same MiniCAD data directory.

## Development and verification

```powershell
npm run dev
npm run check
npm test
```

`dev` uses a real DSH `minicad-dev` profile on port 3079 and stores project data in `.local/designs`. It reuses credentials and settings from the current DSH_HOME. Set `DSH_ELECTRON` and `DSH_CLI` to the installed Desktop executable and its bundled `dsh/lib/bin.js` to use that host instead of installing another one. Set `PORT` to override the port.

Write automated tests only for the modeling kernel. Verify the UI through actual use and screenshots; see [AGENTS.md](AGENTS.md). `check` checks host syntax and builds the client; it is not a UI test.

Source layout: `src/client` contains the workbench, `src/host` contains the DSH service and agent tools, and `python/worker.py` contains persistence and modeling. The UI and the agent share the same service interface, and all design changes include `expectedRevision`.

## Troubleshooting and removal

| Symptom | Check |
|---|---|
| MiniCAD is missing from the sidebar | Confirm installation in the correct profile and restart DSH |
| Python service fails to start | Ensure uv is on DSH's PATH and run `npm run setup` |
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
