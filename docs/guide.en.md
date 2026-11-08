# User guide

[Back to README](../README.en.md) · [简体中文](guide.md) · [Modeling API](modeling-api.en.md)

## Install and update

Compatibility target: DSH **0.2.2-rc.1**. Prebuilt packages include the client, SMLib WebAssembly kernel and runtime dependencies. No manual dependency installation, build or Python environment is needed.

Desktop: open DSH **Plugins → Add plugin**, enter the npm package name `dsh-minicad`, click **Install**, enable it and restart if prompted. The application manages its own profile; do not modify it through the CLI.

Local installation: extract the release package, keep its bundled `node_modules` and enter the extracted `package` directory in **Add plugin** (for example, `link:C:/MiniCAD/package`).

### Web installation

Requires Node.js 22.19+ and pnpm. If pnpm is missing, install it first:

```sh
npm install -g pnpm
npx @deepseek-ai/dsh@0.2.2-rc.1 plugin --profile web add dsh-minicad -w
```

For a local package, replace `dsh-minicad` with its extracted directory, such as `link:C:/MiniCAD/package`; use `link:/absolute/path/to/package` on macOS/Linux. If dsh is installed globally, `dsh` can replace `npx @deepseek-ai/dsh@0.2.2-rc.1`. Restart the Web host after installation.

For a Web profile without pnpm, put the extracted `package` directory in the profile's `node_modules/dsh-minicad` and merge the complete entries from [cordis.patch.yml](../cordis.patch.yml) into its patch array. Do not append YAML after an existing `[]`. This method does not apply to Desktop.

To update an npm installation on Desktop, uninstall it through **Plugins**, then install it again by package name. For Web, run `npx @deepseek-ai/dsh@0.2.2-rc.1 plugin --profile web update dsh-minicad -w`, then restart. To update a local package, extract it into a separate directory, switch to that directory in plugin management and restart. Keep design folders separate from the installation.

## Model, inspect and export

- Each design is an ordinary workspace folder. Its conversations share models and history but have separate chat contexts. **Save as** creates an independent design.
- Describe requests and changes in chat. The agent must read actual PDF pages; this requires available PDF tools and an image-capable model in the host. Clarify ambiguous dimensions or views first.
- Double-click the canvas to open the composer. Drag or pin it with the top handle. Theme and language follow DSH.
- The composer expands when its text wraps. Pinning it does not prevent Escape from exiting selection or closing revision comparison.
- Successful completion updates the top status without automatically opening its details. Click the status to inspect them; details do not close on a timer.
- Narrow workbenches start with design navigation collapsed, giving the revision library and comparison the content area. Use the navigation button at the top left to return to the design list. The list supports Tab to focus, arrow keys to navigate, Enter to open and Shift+F10 for its action menu.
- Move the mouse over the canvas to see world X/Y/Z coordinates in mm in the lower-right corner. The readout uses the model preview surface under the pointer or the intersection with the XY plane over empty space.
- **Select targets** enables face and edge selection. It also opens the model inspection panel for assemblies with multiple solids; single-solid models have no panel. Click the toolbar button again or close the panel to exit. Click to replace, Ctrl+click to toggle, or click blank space/press Esc to clear. Measure the selection or add a **Reference** with your request to the conversation.
- Hover over a solid to see its name. After selecting faces or edges, the selection toolbar shows the names of their owning solids. The agent must name every final solid by purpose; the assembly collection needs no overall name.
- A single face shows its area and area centroid. A single edge shows its length and endpoints. Circular edges, spherical faces and cylindrical faces also show their geometric center and radius. Coordinates use world X/Y/Z in mm. Two targets give minimum and maximum distances and the absolute world-axis components of one nearest-point line. Three or more targets disable measurement. `≈` marks approximations. Areas use mm².
- Click the branch icon at the top left of the workbench to open the revision library for the current model file, with the current version previewed by default. Select saved versions in the tree; **Modeling process** shows the selected version's incremental steps and related trials before publication. The current version also shows unsaved trials based on it. Steps remain available in the library before the first version is saved. Failed or stopped builds preserve the saved model.
- Previewing a historical version does not change the current model. Click **Switch to** to make it current. The next edit branches from that version and uses the next available version number. Ask the agent to import or save externally modified model working files before switching.
- **Conversation history** opens directly as a flat panel on the right side of the workbench. Scroll through native messages, copy content and expand tool records. The turn slider and previous/next controls at the bottom navigate to the corresponding messages; **Latest** returns to the last turn, and **Earlier history** loads older messages. The composer and session statistics are hidden while reading. Closing history restores the workbench composer and draft; **Open input** also returns to the composer. When space is limited, the design panel temporarily folds away and returns to its previous layout when history closes. DSH continues to own drafts and pending interactions, including native approvals and questions.
- **Revision comparison** shows exact volume differences of the base relative to the target: green for added, red for removed, gray for shared volume. It does not change the model; selection and measurement pause during comparison.
- Ask the agent to export STEP, STL or a project ZIP. The native navigation menu at the top right opens the design directory or the current saved model in FreeCAD. External edits are not written back automatically.

- Click the display-mode icon to cycle through solid, wireframe and transparent display. The icon and tooltip reflect the current mode. Revision comparison cycles only between solid and wireframe. In the inspection panel for assemblies with multiple solids, the eye button on the left toggles each part's visibility and **Show all** restores every part. Display changes do not affect geometry, revisions or exports.
- The workbench displays saved part colors, with face colors taking precedence. Ask the agent to color a part or selected faces.
- When a design contains multiple model files or variants, select them in **Select targets**. Single-solid models show only a compact model picker; assemblies with multiple solids also show part visibility controls. Measurement and reference surfaces temporarily hide while the model/variant or external-application menu is open, then return when it closes. Ask the agent to generate independent model variants and export a whole model or an individual part.
- The agent creates and names independent parts. Contact does not fuse components; ask the agent to check clearance and interference.

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

Native solids use `.smp`; external SMB is supported as a single-body exchange format.

- Working models are `<name>.smp` and `<name>.state.json`. `.cad-design.json` manages models and revisions; `.cad-history/` contains complete snapshots and execution materials. Restoring and continuing edits require only SMP and metadata. Copy the whole folder to preserve models and history. DSH stores conversations separately.
- `.cad-process/` stores modeling steps, `references/` stores drawings and `exports/` stores exports. **Save as** excludes uncommitted trials.
- The open-design index is `$DSH_HOME/storages/minicad/designs.json`. DSH_HOME defaults to `~/.dsh`; `dataDir` can override the index directory.
- Catalog reads skip unreadable entries while preserving their registration and files. Opening a folder without `.cad-design.json` initializes a new design even if the path was previously registered. Existing damaged metadata or invalid formats report the underlying error.
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
npx @deepseek-ai/dsh@0.2.2-rc.1 plugin --profile web remove dsh-minicad -w
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

Maintainers: see the [release instructions in AGENTS.md](../AGENTS.md#发布).
