import z from "@deepseek-ai/schemastery";
import { createWorker } from "./worker.js";
import { errorKey, localizedError } from "../shared/errors.js";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { basename } from "node:path";
import { createModelOpener } from "./model-open.js";
export const inject = [
  "connection",
  "sessionController",
  "agents",
  "workingDirectory",
  "subprocess",
];
export const Config = z.object({
  dataDir: z.string().default(""),
  timeout: z.number().min(10000).max(600000).default(120000),
  freecadExecutable: z.string().default(""),
});
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
const clientMethods = new Set([
  "process_state", "process_history",
  "geometry_annotation", "query", "measure", "compare",
  "list",
  "get", "select_model",
  "rename",
  "attach",
  "reference_file",
  "restore",
  "health",
  "open_design",
  "close_design",
]);

export async function apply(ctx, config = {}) {
  const worker = createWorker({
    ...config,
    ...(config.dataDir ? {} : { dataDir: undefined }),
  });
  const bySession = new Map(),
    lastError = new Map(),
    active = new Map(),
    building = new Map(),
    measurements = new Map();
  let disposed = false;
  const call = async (method, args, signal) => {
    if (!["build", "edit", "restore", "update_parameters", "commit", "variants", "set_geometry_id_format"].includes(method)) return worker.call(method, args, signal);
    if (active.has(args.projectId))
      throw localizedError("当前设计正在构建，请稍后重试", "This design is being built. Try again when it finishes.");
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    active.set(args.projectId, controller);
    try {
      building.set(args.projectId, await worker.call("get", { projectId: args.projectId }, controller.signal));
      return await worker.call(method, args, controller.signal);
    } finally {
      active.delete(args.projectId);
      building.delete(args.projectId);
      signal?.removeEventListener("abort", abort);
    }
  };
  const modelOpener = createModelOpener(ctx, config, call);
  const projectForSession = async (sessionId) => {
    const p = await call("by_session", { sessionId });
    bySession.set(sessionId, p.id);
    await alignDirectory(p, undefined, [sessionId]);
    return p;
  };
  async function alignDirectory(project, signal, sessionIds = [project.activeSessionId]) {
    for (const sessionId of sessionIds.filter(Boolean)) {
      const agent = ctx.agents.get(sessionId);
      if (agent && ctx.workingDirectory.get(agent.session) !== project.workspaceDirectory)
        await ctx.workingDirectory.set(agent, project.workspaceDirectory, signal);
    }
  }
  const sessionRunning = project => project.sessions.some(id => ctx.agents.get(id)?.status === "running");
  const designBusy = project => active.has(project.id) || sessionRunning(project);
  ctx.provide("minicad", { call, projectForSession });
  ctx.effect(
    () => () => {
      disposed = true;
      return worker.dispose();
    },
    "minicad: worker",
  );
  const startup = call("list")
    .then((projects) =>
      projects.forEach((p) => {
        for (const sessionId of p.sessions) bySession.set(sessionId, p.id);
      }),
    )
    .catch((error) => ctx.logger.warn(`MiniCAD: ${error.message}`));
  // Native main-window forks must inherit the same design ownership as forks
  // created in the workbench. Session headers identify seeded forks explicitly.
  ctx.on("session/created", (session) => {
    if (!session.header.isSeeded || !session.header.parentSession || session.header.origin === "subagent") return;
    startup.then(async () => {
      const projectId = bySession.get(session.header.parentSession);
      if (!projectId || disposed || bySession.has(session.id)) return;
      const project = await call("bind", { projectId, sessionId: session.id });
      bySession.set(session.id, projectId);
      await alignDirectory(project, undefined, [session.id]);
    }).catch(error => ctx.logger.warn(`MiniCAD fork binding: ${error.message}`));
  });
  // Conversation titles belong to DSH; they never rename the design document.
  ctx.on("session/event", (session, event) => {
    if (event.type !== "user/message" || event.data.source.kind !== "user") return;
    startup.then(async () => {
      const projectId = bySession.get(session.id);
      if (!projectId || disposed) return;
      await call("message", { projectId, role: "user" });
    }).catch(error => ctx.logger.warn(`MiniCAD message: ${error.message}`));
  });
  ctx.on("agent/error", ({ agent, error }) => {
    if (bySession.has(agent.id))
      lastError.set(agent.id, { message: String(error?.message || error), localized: error?.localized });
  });
  ctx.on("agent/status", ({ agent, status }) => {
    if (status === "running" && bySession.has(agent.id)) lastError.delete(agent.id);
  });

  async function createSession(project) {
    const created = await ctx.sessionController.create({ cwd: project.workspaceDirectory, agentPreset: "minicad" });
    const bound = await call("bind", { projectId: project.id, sessionId: created.sessionId });
    bySession.set(created.sessionId, project.id);
    return bound;
  }
  async function ensureSession(project) {
    for (const sessionId of project.sessions) bySession.set(sessionId, project.id);
    return project.activeSessionId ? project : createSession(project);
  }
  async function relocateDesign(method, args, signal) {
    const before = await call("get", { projectId: args.projectId });
    if (designBusy(before)) throw localizedError("当前设计正在构建，请稍后重试", "This design is being built. Try again when it finishes.");
    active.set(before.id, new AbortController());
    try {
      // Resolve cold Sessions while their old workspace still exists. DSH's
      // durable workingDirectory then survives removal of the original folder.
      for (const sessionId of before.sessions) {
        const found = await ctx.sessionController.resolveAgent(sessionId);
        if (found.error) throw found.error;
      }
      if (sessionRunning(before)) throw localizedError("当前设计正在构建，请稍后重试", "This design is being built. Try again when it finishes.");
      signal?.throwIfAborted();
      const result = await call(method, { ...args, directoryName: undefined });
      try { await alignDirectory(result, undefined, before.sessions); }
      catch (error) {
        const restored = await call(method, { projectId: before.id, title: before.title,
          directoryName: basename(before.directory) });
        await alignDirectory(restored, undefined, before.sessions);
        throw error;
      }
      return result;
    } finally { active.delete(before.id); }
  }
  async function rpc(method, args, signal) {
    await startup;
    const { measurementId } = args;
    if (typeof measurementId === "string") {
      const existing = measurements.get(measurementId);
      if (method === "cancel_measurement") {
        if (existing) existing.abort();
        else {
          // The cancel request can reach the host before the original request.
          const canceled = new AbortController();
          canceled.abort();
          measurements.set(measurementId, canceled);
          setTimeout(() => {
            if (measurements.get(measurementId) === canceled) measurements.delete(measurementId);
          }, config.timeout ?? 120000).unref();
        }
        return { canceled: true };
      }
      if (method === "query" || method === "measure") {
        const controller = existing ?? new AbortController();
        measurements.set(measurementId, controller);
        try {
          return await call(method, args, AbortSignal.any([signal, controller.signal]));
        } finally {
          measurements.delete(measurementId);
        }
      }
    }
    if (method === "model_apps") return modelOpener.applications();
    if (method === "open_model") return modelOpener.open(args, signal);
    if (method === "create" || method === "open_design") return ensureSession(await call(method, args));
    if (method === "new_session") {
      const project = await call("get", { projectId: args.projectId });
      if (active.has(project.id)) throw localizedError("当前设计正在构建，请稍后重试", "This design is being built. Try again when it finishes.");
      return createSession(project);
    }
    if (method === "select_session") {
      const project = await call("select_session", args);
      await alignDirectory(project, signal);
      return project;
    }
    if (method === "fork_session") {
      const project = await call("get", { projectId: args.projectId });
      if (!project.sessions.includes(args.sessionId)) throw localizedError("会话不属于当前设计", "session does not belong to this design");
      if (active.has(project.id)) throw localizedError("当前设计正在构建，请稍后重试", "This design is being built. Try again when it finishes.");
      const created = await ctx.sessionController.fork({ sessionId: args.sessionId, increaseTitle: true, allowMigration: false });
      const bound = await call("bind", { projectId: project.id, sessionId: created.sessionId });
      bySession.set(created.sessionId, project.id);
      await alignDirectory(bound, signal);
      return bound;
    }
    if (method === "rename") return relocateDesign(method, args, signal);
    if (method === "fork_project") {
      const source = await call("get", { projectId: args.projectId });
      if (designBusy(source)) throw localizedError("当前设计正在构建，请稍后重试", "This design is being built. Try again when it finishes.");
      const branch = await call("fork_project", { projectId: source.id, path: args.path, title: args.title }, signal);
      return ensureSession(branch);
    }
    if (method === "close_design") {
      const project = await call("get", { projectId: args.projectId });
      if (designBusy(project)) throw localizedError("当前设计正在构建，请稍后重试", "This design is being built. Try again when it finishes.");
      const result = await call("close_design", args);
      for (const sessionId of project.sessions) { bySession.delete(sessionId); lastError.delete(sessionId); }
      return result;
    }
    if (method === "status") {
      const inFlight = building.get(args.projectId);
      const p = inFlight || await call("get", {
        projectId: args.projectId,
      });
      if (!inFlight) await alignDirectory(p, signal);
      const error = lastError.get(p.activeSessionId);
      return {
        head: p.head,
        models: p.models,
        sourceVersion: p.sourceVersion,
        workspaceDirectory: p.workspaceDirectory,
        sourceFile: p.sourceFile,
        title: p.title,
        activeSessionId: p.activeSessionId,
        progress: inFlight ? worker.processState({ projectId: p.id, sourceFile: p.sourceFile })
          : await call("process_state", { projectId: p.id, sourceFile: p.sourceFile }),
        projects: inFlight ? undefined : (await call("list")).map((project) => ({
          ...project,
          running: designBusy(project),
        })),
        running:
          designBusy(p),
        error: error?.message || null,
        errorDetail: error?.localized,
      };
    }
    if (method === "cancel") {
      active.get(args.projectId)?.abort();
      const project = await call("get", { projectId: args.projectId });
      for (const sessionId of project.sessions)
        if (ctx.agents.get(sessionId)?.status === "running") await ctx.sessionController.cancel({ sessionId });
      return { cancelled: true };
    }
    if (!clientMethods.has(method))
      throw Object.assign(localizedError("不支持的操作", "Unsupported operation"), { status: 404 });
    if (method === "restore" || method === "select_model") {
      const project = building.get(args.projectId) || await call("get", { projectId: args.projectId }, signal);
      if (designBusy(project)) throw localizedError("当前设计正在构建，请稍后重试", "This design is being built. Try again when it finishes.");
    }
    const result = await call(method, args, signal);
    if (method === "get") { const project = await ensureSession(result); await alignDirectory(project, signal); return project; }
    return result;
  }
  function route(path, methods, fetch) {
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path,
          methods,
          requestBody: "buffered",
          fetch: async (request) => {
            try {
              if (disposed) throw Object.assign(localizedError("插件已卸载", "The plugin has been unloaded"), { status: 503 });
              return await fetch(request);
            } catch (error) {
              const message = String(error.message || error);
              return json(
                { error: message, code: errorKey(message), localized: error.localized },
                error.status || 400,
              );
            }
          },
        }),
      `minicad: ${path}`,
    );
  }
  route("/api/minicad/rpc", ["POST"], async (request) => {
    const body = await request.text();
    if (body.length > 29 * 1024 * 1024)
      throw Object.assign(localizedError("请求过大", "The request exceeds the size limit"), { status: 413 });
    const { method, params = {} } = JSON.parse(body);
    return json(await rpc(method, params, request.signal));
  });
  // Same authenticated channel as the workbench. No arbitrary file paths.
  route("/api/minicad/workbench.js", ["GET"], async () => new Response(
    await readFile(new URL("../../lib/workbench.mjs", import.meta.url)),
    { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } },
  ));
  route("/api/minicad/preview", ["GET"], async (request) => {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const preview = await call("preview_file", { ...params, revision: Number(params.revision) }, request.signal);
    return new Response(Readable.toWeb(createReadStream(preview.path, { signal: request.signal })), { headers: {
      "content-type": "application/octet-stream", "content-length": String(preview.byteLength), "cache-control": "no-store",
    } });
  });
  route("/api/minicad/checkpoint", ["GET"], async (request) => {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const preview = await call("checkpoint_file", params, request.signal);
    return new Response(Readable.toWeb(createReadStream(preview.path, { signal: request.signal })), { headers: {
      "content-type": "application/octet-stream", "content-length": String(preview.byteLength), "cache-control": "no-store",
    } });
  });
  route("/api/minicad/download", ["GET"], async (request) => {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const result = await call(
      "export",
      { ...params, revision: Number(params.revision) },
      request.signal,
    );
    return new Response(Buffer.from(result.data, "base64"), {
      headers: {
        "content-type": result.mediaType,
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.name)}`,
        "cache-control": "no-store",
      },
    });
  });
  route("/api/minicad/reference", ["GET"], async (request) => {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const result = await call("reference_file", params, request.signal);
    return new Response(Buffer.from(result.data, "base64"), { headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(result.name)}`,
      "cache-control": "no-store",
    } });
  });
}
