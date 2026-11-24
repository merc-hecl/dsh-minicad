import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const external = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "@deepseek-ai/dsh-client-ui-primitives",
];
const photoWorker = await build({
  entryPoints: ["src/client/render-worker.js"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
});
const workerSource = photoWorker.outputFiles[0].text;
const workerVersion = createHash("sha256").update(workerSource).digest("hex").slice(0, 16);
const lazy = await build({
  entryPoints: ["src/client/workbench.jsx"],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  minify: true,
  external,
  define: {
    __MINICAD_RENDER_WORKER_URL__: JSON.stringify(`/api/minicad/render-worker.js?v=${workerVersion}`),
  },
});
const workbench = `export function createModule(require) { var module = {exports:{}}; var exports = module.exports;\n${lazy.outputFiles[0].text}\nreturn module.exports;\n}`;
const version = createHash("sha256")
  .update(workbench)
  .digest("hex")
  .slice(0, 16);
await mkdir("lib", { recursive: true });
await writeFile("lib/render-worker.js", workerSource);
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
  loader: { ".css": "text", ".svg": "dataurl", ".png": "dataurl" },
  banner: {
    js: 'window.__ModuleLoader__.load({id:"dsh-minicad",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
  },
  footer: { js: "return module.exports;}});" },
});
