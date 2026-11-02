# Third-party components

MiniCAD uses the DSH host's React runtime, UI primitives, locale and theme services.

The MiniCAD navigation menu adapts the compact directory button presentation from DeepSeek Harness 0.2.1-rc.5 (`packages/client/ui-open-in-app/src/client/OpenTargetButton` and `OpenInAppAction`). It retains native catalog, locale, preference and directory-launch injections, and adds the plugin's FreeCAD model action. Scoped presentation copies are in `src/client/directory-open-action.jsx` and `directory-open-action.css`; the DSH MIT license is preserved in [docs/licenses/dsh-workspace-MIT.txt](docs/licenses/dsh-workspace-MIT.txt).

The unmodified FreeCAD icon in `src/client/assets/freecad.svg` comes from [selfh.st/icons](https://cdn.jsdelivr.net/gh/selfhst/icons@main/svg/freecad.svg). Attribution: selfh.st/icons and its contributors. The collection's [CC BY 4.0 license](https://github.com/selfhst/icons/blob/main/LICENSE) is preserved in [docs/licenses/selfhst-icons-CC-BY-4.0.txt](docs/licenses/selfhst-icons-CC-BY-4.0.txt). Product names and trademarks belong to their respective owners.

The MiniCAD agent preset's standard tool composition in `cordis.patch.yml` is adapted from DeepSeek Harness 0.2.1-rc.5 (`packages/bundle/web-app/presets/standard.patch.yml`). It retains the official platform conditions and isolation groups, with MiniCAD tools added. The same DSH MIT license is preserved in [docs/licenses/dsh-workspace-MIT.txt](docs/licenses/dsh-workspace-MIT.txt).

The design navigation adapts the workspace/session row presentation, styles and dictionaries from DeepSeek Harness 0.2.1-rc.5 (`packages/client/ui-workspace/src/client/rows/Rows` and `WorkspaceBrowser`). Scoped copies are in `src/client/design-navigation-rows.jsx` and `src/client/design-navigator.css`; MiniCAD supplies its own design workspace bindings and folder actions, and reuses the installed native workspace browser, session menu and rename dialog components. The original MIT license is preserved in [docs/licenses/dsh-workspace-MIT.txt](docs/licenses/dsh-workspace-MIT.txt).

Runtime and build dependencies retain their own licenses, distributed with their packages:

- DeepSeek Harness and schemastery: MIT.
- Three.js and React: MIT.
- esbuild: MIT.
- SMLib / NVIDIA USD BRep: Apache-2.0.
- @classcad/smlibwasm bindings and JavaScript API: MIT; bundled font resources: OFL-1.1. Its distribution includes the kernel license and third-party notices.
- fflate: MIT.

## Pinhead — Anvil and mallet

The MiniCAD plugin mark is adapted from [Pinhead v12.0.0's anvil_and_mallet icon](https://github.com/waysidemapping/pinhead/blob/v12.0.0/icons/hand_tools/anvil_and_mallet.svg), by Quincy Morgan and Temaki contributors, released under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).

Changes: redrawn as a four-stroke outline on a 16 px canvas, with a raised hammer head, a handle extending toward the operator on the right, and a simplified anvil contour. Strokes use the DSH icon weights and inherit the host theme through `currentColor`.
