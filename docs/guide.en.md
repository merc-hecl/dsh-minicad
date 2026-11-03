# User guide

[Back to README](../README.en.md) · [简体中文](guide.md) · [Modeling API](modeling-api.en.md)

## Install and update

Compatibility target: DSH **0.2.1-rc.5**. Prebuilt packages include the client, SMLib WebAssembly kernel and runtime dependencies. No manual dependency installation, build or Python environment is needed.

Desktop: in DSH **Plugins**, install the extracted `package` directory (for example, `link:C:/MiniCAD/package`), review the installation preview, enable it and restart if prompted. The application manages its own profile; do not modify it through the CLI.

### Web installation

Requires Node.js 22.19+ and pnpm. If pnpm is missing, install it first:

```sh
npm install -g pnpm
npx @deepseek-ai/dsh@0.2.1-rc.5 plugin --profile web add link:C:/MiniCAD/package -w
```

Replace the path with your installation directory; use `link:/absolute/path/to/package` on macOS/Linux. If dsh is installed globally, `dsh` can replace `npx @deepseek-ai/dsh@0.2.1-rc.5`. Restart the Web host after installation.

For a Web profile without pnpm, put the extracted `package` directory in the profile's `node_modules/dsh-minicad` and merge the complete entries from [cordis.patch.yml](../cordis.patch.yml) into its patch array. Do not append YAML after an existing `[]`. This method does not apply to Desktop.

To update a local package, extract it into a separate directory, switch to that directory in plugin management and restart. Keep design folders separate from the installation. An npm package has not been published yet.

## Model, inspect and export

- Each design is an ordinary workspace folder. Its conversations share models and history but have separate chat contexts. **Save as** creates an independent design.
- Describe requests and changes in chat. The agent must read actual PDF pages; this requires available PDF tools and an image-capable model in the host. Clarify ambiguous dimensions or views first.
- Double-click the canvas to open the composer. Drag or pin it with the top handle. Theme and language follow DSH.
- **Select targets** selects faces and edges by default. Click to replace, Ctrl+click to toggle, or click blank space/press Esc to clear. Measure the selection or add a **Reference** with your request to the conversation.
- One edge gives length; one face gives area. Two targets give minimum/maximum distances and the absolute world X/Y/Z components of one nearest-point line. Three or more targets disable measurement. `≈` marks approximations. Lengths use mm; areas use mm².
- **Making record** shows saved versions, modeling steps and the full conversation. Restoring creates a new version. Failed or stopped builds preserve the saved model.
- **Revision comparison** shows exact volume differences of the base relative to the target: green for added, red for removed, gray for shared volume. It does not change the model; selection and measurement pause during comparison.
- Ask the agent to export STEP, STL or a project ZIP. The native navigation menu at the top right opens the design directory or the current saved model in FreeCAD. External edits are not written back automatically.

Valid geometry and dimensional checks do not establish structural strength or manufacturability.

### FreeCAD path

MiniCAD detects FreeCAD through PATH, Windows app registration or the macOS app index. If detection fails, specify your executable in DSH's `minicad` configuration:

```yaml
- id: minicad
  config:
    freecadExecutable: C:/Program Files/FreeCAD/bin/FreeCAD.exe
```

An empty string enables automatic detection. Non-PATH Linux installations such as AppImage can use an absolute path. A patch replaces the whole row configuration; preserve any other settings you already use.

## Data and runtime boundaries

- Design folders contain source, parameters, exact solids, `.cad-design.json` and `.cad-history/`. Copy the whole folder to preserve models and versions. DSH stores conversations separately.
- `.cad-process/` stores modeling steps, `references/` stores drawings and `exports/` stores exports. **Save as** excludes uncommitted trials.
- The open-design index is `$DSH_HOME/storages/minicad/designs.json`. DSH_HOME defaults to `~/.dsh`; `dataDir` can override the index directory.
- Renaming a design renames its folder and updates associated conversation working directories. **Remove** only removes its catalog entry; files and conversations remain.
- The kernel runs in a separate Node process with a default 120-second task timeout. Stopping terminates modeling while preserving committed versions. Process isolation is not a security sandbox; only run trusted design code.
- Do not let multiple DSH processes write to the same MiniCAD data directory.

## Troubleshooting and removal

| Problem | Action |
| --- | --- |
| No MiniCAD entry | Check the profile, enable the plugin and restart DSH |
| Prebuilt kernel fails to start | Check that the archive was fully extracted with its `node_modules`; extract it again if needed |
| Source installation fails to start | Install dependencies and build as shown below |
| Model authentication fails | Check DSH's model configuration or login state |
| Model is invisible | Check graphics acceleration/WebGL and that a model was saved successfully |
| Revision conflict | Ask the agent to read the current version before editing |
| HTTP 401 / 404 | Check host login, or the profile and plugin activation, respectively; 401 does not prove route registration |

Remove through Desktop **Plugins**, or for Web:

```sh
npx @deepseek-ai/dsh@0.2.1-rc.5 plugin --profile web remove dsh-minicad -w
```

Restart to remove the entry. Uninstalling does not delete design data.

## Run from source

Use Node.js 22.19+ in the repository directory:

```sh
npm ci
npm run setup
```

Install `link:/absolute/path/to/repository` through Desktop plugin management or the Web CLI. Rebuilt client changes support DSH HMR; host changes require a restart.

```sh
npm run dev
npm run check
npm test
npm pack --pack-destination dist
```

Create `dist` before packing. `npm pack` builds automatically and includes runtime dependencies. GitHub source ZIPs do not include these prebuilt files.

`dev` uses the real DSH `minicad-dev` profile (port 3079, data in `.local/designs`), reusing DSH_HOME settings and credentials. `PORT` overrides the port. `DSH_ELECTRON` and `DSH_CLI` can point to the installed Desktop executable and its bundled CLI.

`check` validates syntax and builds; `test` runs kernel tests serially. UI and live agent interactions are accepted by the user. See [AGENTS.md](../AGENTS.md).
