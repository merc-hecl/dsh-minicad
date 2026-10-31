# Third-party components

MiniCAD uses the DSH host's React runtime, UI primitives, locale and theme services.

The design-library navigation adapts the workspace/session row presentation, styles and dictionaries from DeepSeek Harness 0.2.1-rc.5 (`packages/client/ui-workspace/src/client/rows/Rows` and `WorkspaceBrowser`). Scoped copies are in `src/client/design-navigation-rows.jsx` and `src/client/design-navigator.css`; MiniCAD supplies its own library/task data and menu actions. The original MIT license is preserved in [docs/licenses/dsh-workspace-MIT.txt](docs/licenses/dsh-workspace-MIT.txt).

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
