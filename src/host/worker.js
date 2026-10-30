import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";

/** One serialized Python worker owns the design state; browser and tools share it. */
export function createWorker({
  dataDir = join(
    process.env.DSH_HOME?.trim() || join(homedir(), ".dsh"),
    "storages",
    "minicad",
  ),
  timeout = 120_000,
} = {}) {
  let child;
  let sequence = 0;
  let queue = Promise.resolve();
  let stopped = false;
  const pending = new Map();
  const project = fileURLToPath(new URL("../../python/", import.meta.url));
  const script = join(project, "worker.py");
  function start() {
    if (stopped) throw new Error("MiniCAD 已关闭");
    if (child) return;
    const process = spawn(
      "uv",
      [
        "run",
        "--project",
        project,
        "--frozen",
        "python",
        "-u",
        script,
        "--data-dir",
        dataDir,
      ],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...globalThis.process.env, PYTHONIOENCODING: "utf-8" },
      },
    );
    child = process;
    let stderr = "";
    process.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    const fail = (error) => {
      if (child === process) child = undefined;
      for (const [id, request] of pending) {
        if (request.process !== process) continue;
        pending.delete(id);
        request.cleanup();
        request.reject(error);
      }
    };
    createInterface({ input: process.stdout }).on("line", (line) => {
      let result;
      try {
        result = JSON.parse(line);
      } catch {
        return;
      }
      const request = pending.get(result.id);
      if (!request) return;
      pending.delete(result.id);
      request.cleanup();
      if (result.error)
        request.reject(
          Object.assign(new Error(result.error), {
            status: result.status || 400,
          }),
        );
      else request.resolve(result.result);
    });
    process.on("error", (error) =>
      fail(
        new Error(
          `无法启动 Python 建模服务：${error.message}。请安装 uv 并运行 npm run setup。`,
        ),
      ),
    );
    process.on("exit", (code) =>
      fail(new Error(`Python 建模服务已退出 (${code})。${stderr}`)),
    );
  }
  function call(method, params = {}, signal) {
    const run = () =>
      new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("操作已取消"));
          return;
        }
        try {
          start();
        } catch (error) {
          reject(error);
          return;
        }
        const process = child;
        const id = ++sequence;
        const abort = () => stopProcess(process);
        const timer = setTimeout(abort, timeout);
        signal?.addEventListener("abort", abort, { once: true });
        const cleanup = () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
        };
        pending.set(id, { resolve, reject, cleanup, process });
        process.stdin.write(
          JSON.stringify({ id, method, params }) + "\n",
          (error) => {
            if (error) {
              cleanup();
              pending.delete(id);
              reject(error);
            }
          },
        );
      });
    const result = queue.then(run);
    queue = result.catch(() => {});
    return result;
  }
  function stopProcess(target) {
    if (!target?.pid || target.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      if (process.platform === "win32") {
        const killer = spawn(
          "taskkill",
          ["/PID", String(target.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.once("close", resolve);
        killer.once("error", () => {
          target.kill();
          resolve();
        });
      } else {
        target.once("close", resolve);
        target.kill("SIGTERM");
      }
    });
  }
  function dispose() {
    stopped = true;
    return stopProcess(child);
  }
  return { call, dispose };
}
