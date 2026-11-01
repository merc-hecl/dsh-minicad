import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Store, KernelRequired } from "../kernel/store.js";

const localMethods = new Set([
  "get_settings", "update_settings",
  "list",
  "libraries",
  "get",
  "preview_file",
  "create",
  "by_session",
  "bind",
  "rename",
  "create_library",
  "rename_library",
  "remove_library",
  "discard_empty",
  "model_selection",
  "select_model",
  "message",
  "api",
]);
const retryableReads = new Set([
  "geometry_annotation",
  "get",
  "preview_file",
  "health",
  "query",
  "measure",
  "check",
]);
const allocationFailure =
  /VirtualAlloc failed|low_level_alloc|out of memory|cannot allocate memory|could not allocate memory|not enough memory/i;

/** One transaction queue; ordinary reads stay local, geometry runs in disposable processes. */
export function createWorker({
  dataDir = join(
    process.env.DSH_HOME?.trim() || join(homedir(), ".dsh"),
    "storages",
    "minicad",
  ),
  timeout = 120000,
  spawnProcess = spawn,
} = {}) {
  let queue = Promise.resolve(),
    stopped = false,
    current,
    sequence = 0;
  const script = fileURLToPath(
    new URL("../kernel/service.js", import.meta.url),
  );
  function stop(target) {
    if (!target || target.exitCode !== null || target.signalCode)
      return Promise.resolve();
    return new Promise((resolve) => {
      let fallback, killer;
      target.once("close", () => {
        clearTimeout(fallback);
        killer?.kill();
        resolve();
      });
      if (process.platform === "win32") {
        // Windows process-tree enumeration can stall (for example when WMI is
        // unresponsive). Never leave the actual kernel alive waiting for it.
        fallback = setTimeout(() => {
          killer?.kill();
          target.kill();
        }, 500);
        try {
          killer = spawnProcess(
            "taskkill",
            ["/PID", String(target.pid), "/T", "/F"],
            {
              windowsHide: true,
              stdio: "ignore",
            },
          );
          killer.once("error", () => target.kill());
        } catch {
          target.kill();
        }
      } else target.kill("SIGTERM");
    });
  }
  function launch(method, params, signal) {
    return new Promise((resolve, reject) => {
      if (stopped) return reject(new Error("MiniCAD 已关闭"));
      if (signal?.aborted) return reject(new Error("操作已取消"));
      const id = ++sequence;
      const child = spawnProcess(
        process.execPath,
        [script, "--data-dir", dataDir],
        {
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        },
      );
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
        reject(
          Object.assign(
            new Error(`无法启动建模服务：${error.message}`, { cause: error }),
            {
              retryable: ["ENOMEM", "EAGAIN"].includes(error.code),
            },
          ),
        );
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
            Object.assign(
              new Error(
                aborted
                  ? "操作已取消"
                  : timedOut
                    ? "建模服务已退出：操作超时"
                    : `建模服务已退出 (${code})。${stderr}`,
              ),
              {
                retryable:
                  !aborted && !timedOut && allocationFailure.test(stderr),
              },
            ),
          );
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  function call(method, params = {}, signal) {
    const run = async () => {
      if (stopped) throw new Error("MiniCAD 已关闭");
      if (signal?.aborted) throw new Error("操作已取消");
      if (localMethods.has(method)) {
        try {
          // No model code or WASM can run here. Old previews explicitly fall
          // back to the isolated process instead of loading the kernel in DSH.
          return await new Store(dataDir, { allowKernel: false }).dispatch(
            method,
            params,
          );
        } catch (error) {
          if (!(error instanceof KernelRequired)) throw error;
        }
      }
      for (let attempt = 0; ; attempt++) {
        try {
          return await launch(method, params, signal);
        } catch (error) {
          if (
            attempt ||
            !retryableReads.has(method) ||
            !(error.retryable || ["ENOMEM", "EAGAIN"].includes(error.code)) ||
            stopped ||
            signal?.aborted
          )
            throw error;
          try {
            await delay(250, undefined, { signal });
          } catch {
            throw new Error("操作已取消");
          }
        }
      }
    };
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
