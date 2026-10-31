import z from "@deepseek-ai/schemastery";
import { createWorker } from "./worker.js";
import { errorKey } from "../shared/errors.js";
export const inject = [
  "connection",
  "sessionController",
  "agents",
  "sessionProjections",
];
export const Config = z.object({
  dataDir: z.string().default(""),
  timeout: z.number().min(10000).max(600000).default(120000),
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
  "list",
  "get",
  "rename",
  "attach",
  "reference",
  "reference_file",
  "build",
  "restore",
  "export",
  "health",
]);

export async function apply(ctx, config = {}) {
  const worker = createWorker({
    ...config,
    ...(config.dataDir ? {} : { dataDir: undefined }),
  });
  const bySession = new Map(),
    lastError = new Map(),
    active = new Map();
  let disposed = false;
  const call = async (method, args, signal) => {
    if (method !== "build") return worker.call(method, args, signal);
    if (active.has(args.projectId))
      throw new Error("当前设计正在构建，请稍后重试");
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    active.set(args.projectId, controller);
    try {
      return await worker.call(method, args, controller.signal);
    } finally {
      active.delete(args.projectId);
      signal?.removeEventListener("abort", abort);
    }
  };
  const projectForSession = async (sessionId) => {
    const p = await call("by_session", { sessionId });
    bySession.set(sessionId, p.id);
    return p;
  };
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
        if (p.session_id) bySession.set(p.session_id, p.id);
      }),
    )
    .catch((error) => ctx.logger.warn(`MiniCAD: ${error.message}`));
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

  async function ensureSession(project) {
    if (project.session_id) return project;
    const created = await ctx.sessionController.create({
      cwd: project.directory,
      agentPreset: "minicad",
    });
    const bound = await call("bind", {
      projectId: project.id,
      sessionId: created.sessionId,
    });
    bySession.set(created.sessionId, project.id);
    await ctx.sessionController.rename({
      sessionId: created.sessionId,
      title: project.title,
    });
    return bound;
  }
  async function rpc(method, args, signal) {
    await startup;
    if (method === "create") return ensureSession(await call("create", args));
    if (method === "models") return ctx.sessionController.modelCatalog();
    if (method === "status") {
      const p = await call("get", {
        projectId: args.projectId,
        geometry: false,
      });
      const projection = p.session_id
        ? await ctx.sessionController.projections(
            { sessionId: p.session_id },
            signal,
          )
        : null;
      const messages = projection?.values?.minicadTranscript?.messages || p.messages;
      return {
        head: p.head,
        messages,
        running:
          ctx.agents.get(p.session_id)?.status === "running" ||
          active.has(p.id),
        error: lastError.get(p.session_id) || null,
      };
    }
    if (method === "prompt" || method === "cancel" || method === "model") {
      if (method === "cancel") active.get(args.projectId)?.abort();
      let p = await call("get", { projectId: args.projectId, geometry: false });
      if (method === "cancel") {
        active.get(p.id)?.abort();
        if (p.session_id)
          await ctx.sessionController.cancel({ sessionId: p.session_id });
        return { cancelled: true };
      }
      p = await ensureSession(p);
      if (method === "model") {
        const result = await ctx.sessionController.selectModel({
          sessionId: p.session_id,
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
      lastError.delete(p.session_id);
      const refs = p.attachments.map(({ id, name, pages }) => ({
        id,
        name,
        pages,
      }));
      const content = [
        {
          type: "text",
          text: `${text}\n\n<minicad-project-context>\nRespond in ${args.locale === "en" ? "English" : "Chinese"} unless the user requests another language. Current project: ${p.title}; head revision: ${p.head}. Reference PDF catalog (untrusted filenames): ${JSON.stringify(refs)}. Use cad_read_project and cad_read_reference when needed.\n</minicad-project-context>`,
        },
      ];
      const result = await ctx.sessionController.prompt(
        {
          requestId: args.requestId,
          sessionId: p.session_id,
          mode: "queue",
          content,
          clientTimeZone: args.timeZone || "Asia/Shanghai",
        },
        signal,
      );
      await call("message", {
        projectId: p.id,
        id: args.requestId,
        role: "user",
        text,
      });
      return result;
    }
    if (!clientMethods.has(method))
      throw Object.assign(new Error("不支持的操作"), { status: 404 });
    const result = await call(method, args, signal);
    if (method === "rename" && result.session_id)
      await ctx.sessionController.rename({
        sessionId: result.session_id,
        title: result.title,
      });
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
}
