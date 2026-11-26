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
  "revision_state",
  "relationships",
  "read_building",
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
  "compare_geometry",
  "inspect_sheet_metal",
]);
const allocationFailure =
  /VirtualAlloc failed|low_level_alloc|out of memory|cannot allocate memory|could not allocate memory|not enough memory/i;
const previewIdleTime = 8000, previewMemoryGrowthLimit = 128 * 1024 ** 2;

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
    previewProcess,
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
  function closePreview() {
    if (!previewProcess) return;
    clearTimeout(previewProcess.timer);
    return previewProcess.closing ??= stop(previewProcess.child);
  }
  async function launch(method, params, signal, directory) {
    const preview = method === "preview_panel";
    if (previewProcess && (!preview || previewProcess.directory !== directory || previewProcess.closing))
      await closePreview();
    return new Promise((resolve, reject) => {
      if (stopped) return reject(localizedError("MiniCAD 已关闭", "MiniCAD is closed"));
      if (signal?.aborted) return reject(localizedError("操作已取消", "Operation cancelled"));
      const id = ++sequence;
      let session = preview && !previewProcess?.closing && previewProcess?.child.exitCode === null ? previewProcess : undefined;
      const child = session?.child ?? spawnProcess(
        process.execPath,
        [script, "--data-dir", dataDir, ...(preview ? ["--preview-session"] : [])],
        {
          windowsHide: true,
          ...(directory ? { cwd: directory } : {}),
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        },
      );
      if (!session) child.stdin.on("error", () => {});
      if (preview && !session) {
        const active = session = previewProcess = { child, directory };
        child.once("close", () => {
          clearTimeout(active.timer);
          if (previewProcess === active) previewProcess = undefined;
        });
      }
      clearTimeout(session?.timer);
      current = child;
      let stderr = "",
        response,
        aborted = false,
        timedOut = false;
      const log = (chunk) => {
        stderr = (stderr + chunk).slice(-4000);
      };
      child.stderr.on("data", log);
      const lines = createInterface({ input: child.stdout });
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
        child.stderr.off("data", log);
        child.off("close", finish);
        child.off("error", fail);
        lines.close();
        if (current === child) current = undefined;
      };
      lines.on("line", (line) => {
        try {
          const parsed = JSON.parse(line);
          if (parsed.id === id) response = parsed;
        } catch {
        }
        if (session && response && !aborted && !timedOut) {
          session.initialResidentBytes ??= response.residentBytes;
          const memoryGrowth = response.residentBytes - session.initialResidentBytes;
          if (memoryGrowth >= previewMemoryGrowthLimit || allocationFailure.test(response.error ?? "")) closePreview();
          else session.timer = setTimeout(closePreview, previewIdleTime).unref();
          finish(0);
        }
      });
      function fail(error) {
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
      }
      function finish(code) {
        cleanup();
        if (response && !(session && (aborted || timedOut))) {
          if (response.error)
            reject(
              Object.assign(new Error(response.error), {
                localized: response.localized,
                status: response.status,
                operationIndex: response.operationIndex,
                operation: response.operation,
                code: response.code,
                details: response.details,
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
      }
      child.once("close", finish);
      child.once("error", fail);
      const request = JSON.stringify({ id, method, params }) + "\n";
      if (session) child.stdin.write(request);
      else child.stdin.end(request);
    });
  }
  function call(method, params = {}, signal) {
    const journal = activeJournal(params);
    if (journal && method === "process_state") return Promise.resolve(journal.describe(journal.latest()));
    if (journal && method === "process_history") return Promise.resolve(journal.history(params.revision));
    if (journal && method === "checkpoint_file") return Promise.resolve(journal.preview(params.runId, params.sequence));
    const run = async () => {
      if (stopped) throw localizedError("MiniCAD 已关闭", "MiniCAD is closed");
      if (signal?.aborted) throw localizedError("操作已取消", "Operation cancelled");
      if (localMethods.has(method)) {
        try {
          return await new Store(dataDir, { allowKernel: false }).dispatch(
            method,
            params,
          );
        } catch (error) {
          if (!(error instanceof KernelRequired)) throw error;
        }
      }
      const constructs = ["build", "import", "edit", "edit_relationships", "edit_building", "commit", "publish_panel", "apply_panel"].includes(method);
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
        if (constructs && run && ["working", "validating"].includes(run.phase)) {
          const detail = error.localized || error.message;
          if (method === "commit") modeling.journal.finish(run, "preview", { publicationError: detail });
          else modeling.journal.finish(run, signal?.aborted ? "stopped" : "error", { error: detail });
        }
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
    processState: (params) => { const journal = activeJournal(params); return journal ? journal.describe(journal.latest()) : null; },
    dispose: () => {
      stopped = true;
      return closePreview() ?? stop(current);
    },
  };
}
