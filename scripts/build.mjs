import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const external = [
  "react",
  "react/jsx-runtime",
  "@deepseek-ai/dsh-client-ui-primitives",
];
// A real second network module. DSH supplies its existing require function so
// the lazy module shares the host's React and UI primitives, without globals,
// eval, duplicate React runtimes or depending on private ModuleLoader methods.
const lazy = await build({
  entryPoints: ["src/client/workbench.jsx"],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  minify: true,
  external,
});
const workbench = `export function createModule(require) { var module = {exports:{}}; var exports = module.exports;\n${lazy.outputFiles[0].text}\nreturn module.exports;\n}`;
const version = createHash("sha256")
  .update(workbench)
  .digest("hex")
  .slice(0, 16);
await mkdir("lib", { recursive: true });
await writeFile("lib/workbench.mjs", workbench);
await build({
  entryPoints: ["src/client/index.jsx"],
  outfile: "lib/client.js",
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  minify: true,
  external: [...external, "/api/minicad/*"],
  define: {
    __MINICAD_WORKBENCH_URL__: JSON.stringify(
      `/api/minicad/workbench.js?v=${version}`,
    ),
    __MINICAD_REQUIRE__: "require",
  },
  loader: { ".css": "text" },
  banner: {
    js: 'window.__ModuleLoader__.load({id:"dsh-minicad",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
  },
  footer: { js: "return module.exports;}});" },
});
