import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import "./build.mjs";

// A real DSH development profile. No simulated model or chat endpoint.
const root = resolve(".");
const profile = "minicad-dev";
const home = process.env.DSH_HOME?.trim() || join(homedir(), ".dsh");
const electron = process.env.DSH_ELECTRON;
const cli = process.env.DSH_CLI;
const command = electron || (process.platform === "win32" ? "npx.cmd" : "npx");
const prefix = electron ? [cli] : ["--yes", "@deepseek-ai/dsh@0.2.1-rc.3"];
if (electron && !cli)
  throw new Error(
    "DSH_CLI must point to the installed dsh/lib/bin.js when DSH_ELECTRON is set.",
  );
const env = {
  ...process.env,
  ...(electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
};
const run = (args, stdio = "inherit") =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...prefix, ...args], {
      env,
      stdio,
      windowsHide: true,
      shell: !electron && process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code ? reject(new Error(`DSH exited: ${code}`)) : resolve(),
    );
  });
if (!existsSync(join(home, "profiles", profile, "package.json")))
  await run(["--profile", profile, "--from-default-profile", "web", "--help"]);
await run([
  "plugin",
  "--profile",
  profile,
  "add",
  `link:${root.replaceAll("\\", "/")}`,
  "-w",
]);
await mkdir(".local", { recursive: true });
const patch = resolve(".local/dev.patch.yml");
await writeFile(
  patch,
  `- id: minicad\n  config:\n    dataDir: ${JSON.stringify(resolve(".local/designs").replaceAll("\\", "/"))}\n`,
);
await run([
  "--profile",
  profile,
  "--patch",
  patch,
  "--port",
  process.env.PORT || "3079",
  "--no-open",
]);
