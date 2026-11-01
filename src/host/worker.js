import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";

/** Serialize file transactions; disposable Node processes own kernel calls. */
export function createWorker({
  dataDir = join(
    process.env.DSH_HOME?.trim() || join(homedir(), ".dsh"),
    "storages",
    "minicad",
  ),
  timeout = 120000,
} = {}) {
  let queue = Promise.resolve(),
    stopped = false,
    current,
    sequence = 0;
  const script = fileURLToPath(
    new URL("../kernel/service.js", import.meta.url),
  );
  function stop(target) {
    if (!target || target.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      target.once("close", resolve);
      if (process.platform === "win32") {
        const killer = spawn(
          "taskkill",
          ["/PID", String(target.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.once("error", () => target.kill());
      } else target.kill("SIGTERM");
    });
  }
  function call(method, params = {}, signal) {
    const run = () =>
      new Promise((resolve, reject) => {
        if (stopped) return reject(new Error("MiniCAD 已关闭"));
        if (signal?.aborted) return reject(new Error("操作已取消"));
        const id = ++sequence;
        const child = spawn(process.execPath, [script, "--data-dir", dataDir], {
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        });
        current = child;
        let stderr = "",
          response,
          aborted = false,
          timedOut = false;
        child.stderr.on("data", (chunk) => {
          stderr = (stderr + chunk).slice(-4000);
        });
        const abort = () => {
          aborted = true;
          void stop(child);
        };
        const timer = setTimeout(() => {
          timedOut = true;
          void stop(child);
        }, timeout);
        signal?.addEventListener("abort", abort, { once: true });
        const cleanup = () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          if (current === child) current = undefined;
        };
        createInterface({ input: child.stdout }).on("line", (line) => {
          try {
            const parsed = JSON.parse(line);
            if (parsed.id === id) response = parsed;
          } catch {
            /* Diagnostics go to stderr. */
          }
        });
        child.on("error", (error) => {
          cleanup();
          reject(new Error(`无法启动建模服务：${error.message}`));
        });
        child.on("close", (code) => {
          cleanup();
          if (response) {
            if (response.error)
              reject(
                Object.assign(new Error(response.error), {
                  status: response.status,
                  operationIndex: response.operationIndex,
                  operation: response.operation,
                }),
              );
            else resolve(response.result);
          } else
            reject(
              new Error(
                aborted
                  ? "操作已取消"
                  : timedOut
                    ? "建模服务已退出：操作超时"
                    : `建模服务已退出 (${code})。${stderr}`,
              ),
            );
        });
        child.stdin.on("error", () => {});
        child.stdin.end(JSON.stringify({ id, method, params }) + "\n");
      });
    const result = queue.then(run);
    queue = result.catch(() => {});
    return result;
  }
  return {
    call,
    dispose: () => {
      stopped = true;
      return stop(current);
    },
  };
}
