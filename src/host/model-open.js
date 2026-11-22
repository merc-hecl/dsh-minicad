import { localizedError } from "../shared/errors.js";
import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const applications = [
  {
    id: "freecad", name: "FreeCAD", setting: "freecadExecutable",
    executables: ["FreeCAD.exe", "FreeCADGui.exe"], displayName: "FreeCAD*",
    relativePath: "bin/FreeCAD.exe", programPath: "FreeCAD*/bin/FreeCAD.exe",
  },
  {
    id: "cad-assistant", name: "CAD Assistant", setting: "cadAssistantExecutable",
    executables: ["CADAssistant.exe"], displayName: "CAD Assistant*",
    relativePath: "CADAssistant.exe", programPath: "CAD Assistant*/CADAssistant.exe",
  },
  {
    id: "rhino", name: "Rhino", setting: "rhinoExecutable",
    executables: ["Rhino.exe"], displayName: "Rhino [0-9]*",
    relativePath: "System/Rhino.exe", programPath: "Rhino */System/Rhino.exe",
  },
  {
    id: "solidworks", name: "SOLIDWORKS", setting: "solidworksExecutable",
    executables: ["SLDWORKS.exe"], displayName: "SOLIDWORKS [0-9]*",
    relativePath: "SLDWORKS.exe", programPath: "SOLIDWORKS Corp*/SOLIDWORKS/SLDWORKS.exe",
  },
  {
    id: "inventor", name: "Autodesk Inventor", setting: "inventorExecutable",
    executables: ["Inventor.exe"], displayName: "Autodesk Inventor*",
    relativePath: "Bin/Inventor.exe", programPath: "Autodesk/Inventor */Bin/Inventor.exe",
  },
];

const windowsApplications = String.raw`
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$apps = ConvertFrom-Json -InputObject $env:MINICAD_MODEL_APPS
$appPaths = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths'
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths'
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths'
)
$uninstall = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$records = Get-ItemProperty -Path $uninstall -ErrorAction SilentlyContinue
$folders = @($env:ProgramW6432, $env:ProgramFiles, [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) |
  Where-Object { $_ } | Select-Object -Unique
$result = @{}
foreach ($app in $apps) {
  $executable = $null
  $candidates = @(
    foreach ($root in $appPaths) {
      foreach ($name in $app.executables) {
        $key = Get-Item -LiteralPath (Join-Path $root $name) -ErrorAction SilentlyContinue
        if ($key) { $key.GetValue('') }
      }
    }
    foreach ($record in $records) {
      if ($record.DisplayName -notlike $app.displayName) { continue }
      if ($record.InstallLocation) {
        [IO.Path]::Combine($record.InstallLocation.Trim('"'), $app.relativePath)
      }
      $record.DisplayIcon
    }
  )
  foreach ($candidate in $candidates) {
    if (!$candidate) { continue }
    $path = [Environment]::ExpandEnvironmentVariables(($candidate -replace ',\s*-?\d+$', '').Trim().Trim('"'))
    if ([IO.Path]::IsPathRooted($path) -and
        [IO.Path]::GetFileName($path) -in $app.executables -and
        [IO.File]::Exists($path)) {
      $executable = $path
      break
    }
  }
  if (!$executable) {
    $executable = $folders | ForEach-Object {
      Get-Item -Path (Join-Path $_ $app.programPath) -ErrorAction SilentlyContinue |
        Where-Object { !$_.PSIsContainer } | Sort-Object FullName -Descending
    } | Select-Object -First 1 -ExpandProperty FullName
  }
  $result[$app.id] = $executable
}
ConvertTo-Json -InputObject $result -Compress
`;
const windowsCommand = Buffer.from(windowsApplications, "utf16le").toString("base64");

export function createModelOpener(ctx, config, call) {
  const resolve = async command => {
    try { return await ctx.subprocess.resolveExecutable(command); }
    catch { return null; }
  };
  const supported = process.platform === "win32" ? applications : applications.slice(0, 1);
  async function locate(app, configured) {
    if (configured) return resolve(configured);
    const names = process.platform === "win32" ? app.executables : ["FreeCAD", "freecad"];
    for (const name of names) {
      const executable = await resolve(name);
      if (executable) return executable;
    }
    if (process.platform === "darwin") {
      try {
        const { stdout } = await execute("mdfind", ["-0", 'kMDItemFSName == "FreeCAD.app" && kMDItemContentType == "com.apple.application-bundle"'], { timeout: 5000 });
        const bundle = stdout.split("\0").find(Boolean);
        return bundle ? resolve(join(bundle, "Contents", "MacOS", "FreeCAD")) : null;
      } catch { return null; }
    }
    return null;
  }

  async function detect(apps) {
    const entries = await Promise.all(apps.map(async app => {
      const configured = config[app.setting]?.trim();
      return { ...app, configured: !!configured, executable: await locate(app, configured) };
    }));
    if (process.platform !== "win32") return entries;
    const missing = entries.filter(app => !app.configured && !app.executable);
    if (!missing.length) return entries;
    try {
      const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", windowsCommand], {
        windowsHide: true, timeout: 5000,
        env: { ...process.env, MINICAD_MODEL_APPS: JSON.stringify(missing) },
      });
      const matches = JSON.parse(stdout);
      return entries.map(app => ({ ...app, executable: app.executable ?? matches[app.id] }));
    } catch {
      return entries;
    }
  }

  return {
    async applications() {
      return (await detect(supported)).map(({ id, name, executable }) => ({
        id, name, available: !!executable,
      }));
    },
    async open(args, signal) {
      const app = supported.find(({ id }) => id === args.application);
      if (!app) throw localizedError("不支持的模型应用", "unsupported model application");
      const [{ executable }] = await detect([app]);
      if (!executable) throw localizedError(`未检测到 ${app.name}，请安装或配置应用路径`,
        `${app.name} not found; install it or configure its executable`);
      const project = await call("get", { projectId: args.projectId, modelFile: args.modelFile }, signal);
      if (!project.head) throw localizedError("请先完成建模", "Build a model first");
      const model = await call("export", { projectId: project.id, modelFile: project.modelFile,
        revision: project.head, format: "step" }, signal);
      signal?.throwIfAborted();
      await launch(app.name, executable, model.path);
      return { application: app.id, modelFile: model.modelFile, revision: model.revision, path: model.path };
    },
  };
}

function launch(name, executable, file) {
  return new Promise((resolve, reject) => {
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
    child.once("error", error => finish(localizedError(`${name} 启动失败`, `Could not launch ${name}`, `: ${error.message}`)));
    child.once("exit", (code, signal) => finish(code === 0 ? null
      : localizedError(`${name} 启动失败`, `Could not launch ${name}`, ` (${code ?? signal})`)));
  });
}
