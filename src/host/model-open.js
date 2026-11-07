import { localizedError } from "../shared/errors.js";
import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const windowsApplications = `
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$paths = @()
foreach ($hive in @('HKCU:', 'HKLM:')) {
  $app = Get-ItemProperty -LiteralPath "$hive\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\FreeCAD.exe" -ErrorAction SilentlyContinue
  if ($app) { $paths += $app.'(default)' }
}
$roots = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')
Get-ItemProperty -Path $roots -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'FreeCAD*' } | ForEach-Object {
  if ($_.InstallLocation) { $paths += Join-Path $_.InstallLocation 'bin\\FreeCAD.exe' }
  if ($_.DisplayIcon) { $paths += $_.DisplayIcon }
}
ConvertTo-Json -InputObject @($paths)
`;

export function createModelOpener(ctx, config, call) {
  const resolve = async command => {
    try { return await ctx.subprocess.resolveExecutable(command); }
    catch { return null; }
  };
  async function freecad() {
    if (config.freecadExecutable?.trim()) return resolve(config.freecadExecutable.trim());
    for (const name of ["FreeCAD", "freecad"]) {
      const executable = await resolve(name);
      if (executable) return executable;
    }
    if (process.platform === "win32") {
      const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windowsApplications],
        { windowsHide: true, timeout: 5000 });
      for (const value of JSON.parse(stdout)) {
        if (typeof value !== "string") continue;
        const candidate = value.replace(/,\s*-?\d+$/, "").replace(/^"(.*)"$/, "$1");
        if (!/[\\/]FreeCAD(?:Gui)?\.exe$/i.test(candidate)) continue;
        const executable = await resolve(candidate);
        if (executable) return executable;
      }
    } else if (process.platform === "darwin") {
      try {
        const { stdout } = await execute("mdfind", ["-0", 'kMDItemFSName == "FreeCAD.app" && kMDItemContentType == "com.apple.application-bundle"'], { timeout: 5000 });
        const bundle = stdout.split("\0").find(Boolean);
        return bundle ? resolve(join(bundle, "Contents", "MacOS", "FreeCAD")) : null;
      } catch { return null; }
    }
    return null;
  }
  return {
    async applications() {
      return [{ id: "freecad", name: "FreeCAD", available: !!await freecad() }];
    },
    async open(args, signal) {
      if (args.application !== "freecad") throw localizedError("不支持的模型应用", "unsupported model application");
      const executable = await freecad();
      if (!executable) throw localizedError("未检测到 FreeCAD，请安装或配置应用路径", "FreeCAD not found; install it or configure its executable");
      const project = await call("get", { projectId: args.projectId, sourceFile: args.sourceFile, geometry: false }, signal);
      if (!project.head) throw localizedError("请先完成建模", "Build a model first");
      const model = await call("export", { projectId: project.id, sourceFile: project.sourceFile,
        revision: project.head, format: "step" }, signal);
      signal?.throwIfAborted();
      await launch(executable, model.path);
      return { application: "freecad", sourceFile: model.sourceFile, revision: model.revision, path: model.path };
    },
  };
}

function launch(executable, file) {
  return new Promise((resolve, reject) => {
    // Do not forward agent credentials to an external CAD application.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/KEY|PASSWORD|SECRET|TOKEN/i.test(key) && !key.toUpperCase().startsWith("DSH_")));
    const child = spawn(executable, [file], { detached: true, stdio: "ignore", windowsHide: false, env });
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.unref();
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(), 500);
    child.once("error", error => finish(localizedError("FreeCAD 启动失败", "could not launch FreeCAD", `: ${error.message}`)));
    child.once("exit", (code, signal) => finish(code === 0 ? null
      : localizedError("FreeCAD 启动失败", "could not launch FreeCAD", ` (${code ?? signal})`)));
  });
}
