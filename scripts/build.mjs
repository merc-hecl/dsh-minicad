import { build } from "esbuild";
await build({
  entryPoints: ["src/client/index.jsx"],
  outfile: "lib/client.js",
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  minify: true,
  external: [
    "react",
    "react/jsx-runtime",
    "@deepseek-ai/dsh-client-ui-primitives",
  ],
  loader: { ".css": "text" },
  banner: {
    js: 'window.__ModuleLoader__.load({id:"dsh-minicad",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
  },
  footer: { js: "return module.exports;}});" },
});
