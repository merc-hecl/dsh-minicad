import { localizedError } from "../shared/errors.js";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Store, KernelRequired } from "../kernel/store.js";
import { ProcessJournal } from "../kernel/process.js";

const localMethods = new Set([
  "list",
  "get",
  "preview_file",
  "create",
  "by_session",
  "bind",
  "select_session",
  "rename",
  "open_design", "close_design",
  "select_model",
  "restore",
  "message",
  "api",
  "process_state", "process_history", "checkpoint_file",
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
  dataDir = resolve(dataDir);
  let queue = Promise.resolve(),
    stopped = false,
    current,
    modeling,
    sequence = 0;
  const activeJournal = (params) => modeling && modeling.projectId === params.projectId
    && (!params.modelFile || params.modelFile === modeling.modelFile) ? modeling.journal : null;
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
  function launch(method, params, signal, directory) {
    return new Promise((resolve, reject) => {
      if (stopped) return reject(localizedError("MiniCAD 已关闭", "MiniCAD is closed"));
      if (signal?.aborted) return reject(localizedError("操作已取消", "Operation cancelled"));
      const id = ++sequence;
      const child = spawnProcess(
        process.execPath,
        [script, "--data-dir", dataDir],
        {
          windowsHide: true,
          ...(directory ? { cwd: directory } : {}),
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
            localizedError("无法启动建模服务", "Could not start the modeling process", `: ${error.message}`),
            {
              cause: error,
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
                localized: response.localized,
                status: response.status,
                operationIndex: response.operationIndex,
                operation: response.operation,
                code: response.code,
                phase: response.phase,
                runId: response.runId,
                validation: response.validation,
                diagnostics: { ...response.diagnostics, stderr: stderr.trim() },
              }),
            );
          else resolve(response.result);
        } else
          reject(
            Object.assign(
              aborted ? localizedError("操作已取消", "Operation cancelled")
                : timedOut ? localizedError("建模服务已退出：操作超时", "The modeling process stopped after a timeout")
                  : localizedError("建模服务已退出", "The modeling process stopped", ` (${code}). ${stderr}`),
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
    const journal = activeJournal(params);
    if (journal && method === "process_state") return Promise.resolve(journal.latest());
    if (journal && method === "process_history") return Promise.resolve(journal.runs().toReversed());
    if (journal && method === "checkpoint_file") return Promise.resolve(journal.preview(params.runId, params.sequence));
    const run = async () => {
      if (stopped) throw localizedError("MiniCAD 已关闭", "MiniCAD is closed");
      if (signal?.aborted) throw localizedError("操作已取消", "Operation cancelled");
      if (localMethods.has(method)) {
        try {
          // No model code or WASM can run here. Preview regeneration runs
          // in the isolated process instead of loading the kernel in DSH.
          return await new Store(dataDir, { allowKernel: false }).dispatch(
            method,
            params,
          );
        } catch (error) {
          if (!(error instanceof KernelRequired)) throw error;
        }
      }
      const constructs = ["build", "import", "edit", "commit", "publish_panel", "apply_panel"].includes(method);
      const location = params.projectId ? await new Store(dataDir, { allowKernel: false }).dispatch("process_location", params) : null;
      if (constructs) {
        modeling = { projectId: params.projectId, modelFile: location.modelFile,
          journal: new ProcessJournal(location.directory, location.modelFile) };
      }
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            return await launch(method, params, signal, location?.directory);
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
              throw localizedError("操作已取消", "Operation cancelled");
            }
          }
        }
      } catch (error) {
        const run = modeling?.journal.latest();
        if (constructs && run && ["working", "validating"].includes(run.phase))
          modeling.journal.finish(run, signal?.aborted ? "stopped" : "error", { error: error.message });
        throw error;
      } finally {
        if (constructs) modeling = undefined;
      }
    };
    const result = queue.then(run);
    queue = result.catch(() => {});
    return result;
  }
  return {
    call,
    processState: (params) => activeJournal(params)?.latest() || null,
    dispose: () => {
      stopped = true;
      return stop(current);
    },
  };
}
