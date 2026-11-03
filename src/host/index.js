import z from "@deepseek-ai/schemastery";
import { createWorker } from "./worker.js";
import { errorKey } from "../shared/errors.js";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { basename } from "node:path";
import { createModelOpener } from "./model-open.js";
export const inject = [
  "connection",
  "sessionController",
  "agents",
  "sessionProjections",
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
  "geometry_annotation", "measure", "compare",
  "list",
  "get",
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
    building = new Map();
  let disposed = false;
  const call = async (method, args, signal) => {
    if (!["build", "edit", "restore", "update_parameters", "commit"].includes(method)) return worker.call(method, args, signal);
    if (active.has(args.projectId))
      throw new Error("当前设计正在构建，请稍后重试");
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    active.set(args.projectId, controller);
    try {
      building.set(args.projectId, await worker.call("get", { projectId: args.projectId, geometry: false }, controller.signal));
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
  // Use the supported, checkpointed projection; recover responses after restart.
  // Include native composer submissions from the real Session, never reasoning/tool payloads.
  const transcriptValue = z.object({
    messages: z.array(
      z.object({
        id: z.string(),
        role: z.string(),
        text: z.string(),
        created: z.number(),
      }),
    ),
  });
  const transcriptSchema = { parse: (value) => transcriptValue(value) };
  ctx.effect(
    () =>
      ctx.sessionProjections.register({
        key: "minicadTranscript",
        stateVersion: 2,
        stateSchema: transcriptSchema,
        init: () => ({ messages: [] }),
        apply: (state, event) => {
          const user = event.type === "user/message";
          if (!user && event.type !== "assistant/message") return state;
          if (user && event.data.source.kind !== "user") return state;
          const content = user ? event.data.content : event.data.message.content;
          const plainText = content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n");
          const text = user
            ? plainText.split("\n\n<minicad-project-context>")[0]
            : plainText;
          if (!text) return state;
          return {
            messages: [
              ...state.messages,
              {
                id: user ? `user:${event.seq}` : event.data.message.id,
                role: user ? "user" : "assistant",
                text: text.slice(0, 100000),
                created: event.time / 1000,
              },
            ].slice(-300),
          };
        },
        wire: { viewSchema: transcriptSchema, view: (state) => state },
      }),
    "minicad: transcript projection",
  );
  ctx.on("agent/error", ({ agent, error }) => {
    if (bySession.has(agent.id))
      lastError.set(agent.id, String(error?.message || error));
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
    const before = await call("get", { projectId: args.projectId, geometry: false });
    if (designBusy(before)) throw new Error("当前设计正在构建，请稍后重试");
    active.set(before.id, new AbortController());
    try {
      // Resolve cold Sessions while their old workspace still exists. DSH's
      // durable workingDirectory then survives removal of the original folder.
      for (const sessionId of before.sessions) {
        const found = await ctx.sessionController.resolveAgent(sessionId);
        if (found.error) throw found.error;
      }
      if (sessionRunning(before)) throw new Error("当前设计正在构建，请稍后重试");
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
    if (method === "model_apps") return modelOpener.applications();
    if (method === "open_model") return modelOpener.open(args, signal);
    if (method === "create" || method === "open_design") return ensureSession(await call(method, args));
    if (method === "new_session") {
      const project = await call("get", { projectId: args.projectId, geometry: false });
      if (active.has(project.id)) throw new Error("当前设计正在构建，请稍后重试");
      return createSession(project);
    }
    if (method === "select_session") {
      const project = await call("select_session", args);
      await alignDirectory(project, signal);
      return project;
    }
    if (method === "fork_session") {
      const project = await call("get", { projectId: args.projectId, geometry: false });
      if (!project.sessions.includes(args.sessionId)) throw new Error("会话不属于当前设计 / session does not belong to this design");
      if (active.has(project.id)) throw new Error("当前设计正在构建，请稍后重试");
      const created = await ctx.sessionController.fork({ sessionId: args.sessionId, increaseTitle: true, allowMigration: false });
      const bound = await call("bind", { projectId: project.id, sessionId: created.sessionId });
      bySession.set(created.sessionId, project.id);
      await alignDirectory(bound, signal);
      return bound;
    }
    if (method === "rename") return relocateDesign(method, args, signal);
    if (method === "fork_project") {
      const source = await call("get", { projectId: args.projectId, geometry: false });
      if (designBusy(source)) throw new Error("当前设计正在构建，请稍后重试");
      const branch = await call("fork_project", { projectId: source.id, path: args.path, title: args.title }, signal);
      return ensureSession(branch);
    }
    if (method === "close_design") {
      const project = await call("get", { projectId: args.projectId, geometry: false });
      if (designBusy(project)) throw new Error("当前设计正在构建，请稍后重试");
      const result = await call("close_design", args);
      for (const sessionId of project.sessions) { bySession.delete(sessionId); lastError.delete(sessionId); }
      return result;
    }
    if (method === "models") return ctx.sessionController.modelCatalog();
    if (method === "status") {
      const inFlight = building.get(args.projectId);
      const p = inFlight || await call("get", {
        projectId: args.projectId,
        geometry: false,
      });
      if (!inFlight) await alignDirectory(p, signal);
      return {
        head: p.head,
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
        error: lastError.get(p.activeSessionId) || null,
      };
    }
    if (method === "prompt" || method === "cancel" || method === "model") {
      if (method === "cancel") active.get(args.projectId)?.abort();
      let p = await call("get", { projectId: args.projectId, geometry: false });
      if (method === "cancel") {
        active.get(p.id)?.abort();
        for (const sessionId of p.sessions)
          if (ctx.agents.get(sessionId)?.status === "running") await ctx.sessionController.cancel({ sessionId });
        return { cancelled: true };
      }
      p = await ensureSession(p);
      if (method === "model") {
        const result = await ctx.sessionController.selectModel({
          sessionId: p.activeSessionId,
          provider: args.provider,
          model: args.model,
          ...(args.reasoningEffort
            ? { reasoningEffort: args.reasoningEffort }
            : {}),
        });
        await call("model_selection", {
          projectId: p.id,
          selection: `${args.provider}\n${args.model}`,
        });
        return result;
      }
      const text = String(args.text || "").trim();
      if (!text || text.length > 30000)
        throw new Error("请输入不超过 30000 字的需求");
      if (typeof args.requestId !== "string" || args.requestId.length > 100)
        throw new Error("缺少消息标识");
      lastError.delete(p.activeSessionId);
      const refs = p.attachments.map(({ id, name, pages }) => ({
        id,
        name,
        pages,
      }));
      const content = [
        {
          type: "text",
          text: `${text}\n\n<minicad-project-context>\nRespond in ${args.locale === "en" ? "English" : "Chinese"} unless the user requests another language. Current project: ${p.title}; head revision: ${p.head}. Reference catalog (untrusted filenames): ${JSON.stringify(refs)}. Read project files with cad_read_project; use DSH attachment capabilities for PDFs.\n</minicad-project-context>`,
        },
      ];
      const result = await ctx.sessionController.prompt(
        {
          requestId: args.requestId,
          sessionId: p.activeSessionId,
          mode: "queue",
          content,
          clientTimeZone: args.timeZone || "Asia/Shanghai",
        },
        signal,
      );
      return result;
    }
    if (!clientMethods.has(method))
      throw Object.assign(new Error("不支持的操作"), { status: 404 });
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
              if (disposed) return json({ error: "插件已卸载" }, 503);
              return await fetch(request);
            } catch (error) {
              const message = String(error.message || error);
              return json(
                { error: message, code: errorKey(message) },
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
    if (body.length > 29 * 1024 * 1024) return json({ error: "请求过大" }, 413);
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
