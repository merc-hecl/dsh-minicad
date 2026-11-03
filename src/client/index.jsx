import React from "react";
import { registerGeometryReferences } from "./geometry-reference.jsx";
import { Composer } from "./composer.jsx";
import { createDesignCatalog, registerMainWorkspaces, mirrorNativeSlot } from "./main-workspaces.jsx";
import { DirectoryOpenAction } from "./directory-open-action.jsx";
import { StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import { decodePreview } from "../shared/preview.js";
const Workbench = React.lazy(() => import(__MINICAD_WORKBENCH_URL__).then((asset) => ({ default: asset.createModule(__MINICAD_REQUIRE__).Workbench })));
import { PluginIcon } from "./plugin-icon.jsx";
import { zh, en } from "./locale.js";
import workbenchCss from "./workbench.css";
import workbenchPanelsCss from "./workbench-panels.css";
import designNavigatorCss from "./design-navigator.css";
import directoryOpenCss from "./directory-open-action.css";
export const inject = [
  "slots", "layout", "locale", "sessions", "conversation", "uiWorkspace", "workspaces", "shortcuts", "inputTriggers", "uiConversation",
];
export function apply(ctx) {
  ctx.effect(
    () => ctx.locale.register("minicad", { zh, en }),
    "minicad: locale",
  );
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "dsh-minicad";
    style.textContent = `${designNavigatorCss}\n${workbenchCss}\n${workbenchPanelsCss}\n${directoryOpenCss}`;
    document.head.append(style);
    return () => style.remove();
  }, "minicad: styles");
  const t = ctx.locale.bind("minicad");
  const locale = {
    subscribe: (fn) => ctx.locale.subscribe(fn),
    getSnapshot: () => ctx.locale.getSnapshot(),
  };
  const controller = new AbortController();
  ctx.effect(() => () => controller.abort(), "minicad: requests");
  const request = async (method, params, signal) => {
    const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    if (method === "preview" || method === "checkpoint") {
      const response = await fetch(`/api/minicad/${method}?` + new URLSearchParams(params), { signal: combined });
      if (!response.ok) {
        const data = await response.json();
        throw Object.assign(new Error(data.error || response.statusText), { uiKey: data.code });
      }
      return decodePreview(await response.arrayBuffer());
    }
    const response = await fetch("/api/minicad/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, params }),
      signal: combined,
    });
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(data.error || response.statusText), {
        uiKey: data.code,
      });
    if (method === "compare") {
      for (const name of ["added", "removed", "unchanged"]) {
        if (data[name]) {
          data[name].previewData = decodePreview(Uint8Array.from(atob(data[name].preview), char => char.charCodeAt(0)));
          delete data[name].preview;
        }
      }
    }
    if (method === "list") designCatalog.update(data);
    else if (method === "status" && data.projects) designCatalog.update(data.projects);
    return data;
  };
  const designCatalog = createDesignCatalog(() => request("list"));
  registerMainWorkspaces(ctx, designCatalog, request);
  const addGeometryReference = registerGeometryReferences(ctx, request);
  const setSidebarCollapsed = (workbench, collapsed) => {
    // DSH rc.5 exposes toggleSidebar but no state getter or explicit setter.
    // Read AppFrame's published state marker; leave all layout writes to DSH.
    const current = workbench.closest("[data-sidebar-collapsed]") !== null;
    if (current !== collapsed) ctx.layout.toggleSidebar();
  };
  let returnContext;
  const enterWorkbench = element => {
    const selection = { ...ctx.uiWorkspace.selection.getSnapshot() };
    const workspace = ctx.workspaces.list.getSnapshot().items.find(item => item.sessionIds.includes(selection.sessionId));
    const design = designCatalog.getSnapshot().find(item => item.sessions.includes(selection.sessionId)
      || item.directory === workspace?.path);
    returnContext = { selection, workspaceId: workspace?.workspaceId, designId: design?.id };
    setSidebarCollapsed(element, true);
  };
  const leaveWorkbench = async element => {
    setSidebarCollapsed(element, false);
    const { selection = {}, workspaceId, designId } = returnContext || {};
    const workspaces = ctx.workspaces.list.getSnapshot();
    if (ctx.sessions.list.getSnapshot().byId[selection.sessionId] && !workspaces.archivedSessionIds.includes(selection.sessionId)) {
      ctx.uiWorkspace.openSession(selection.subagentAddress ?? selection.sessionId);
      return;
    }
    // Design folders use the same new-conversation route as the main sidebar.
    if (designId && designCatalog.getSnapshot().some(item => item.id === designId)) {
      const project = await request("new_session", { projectId: designId });
      ctx.uiWorkspace.openSession(project.activeSessionId);
      return;
    }
    if (workspaceId && workspaces.items.some(item => item.workspaceId === workspaceId)) {
      await ctx.uiWorkspace.openWorkspace(workspaceId);
      return;
    }
    const workspace = await ctx.workspaces.initializeDefault(controller.signal);
    if (workspace) await ctx.uiWorkspace.openWorkspace(workspace.workspaceId);
    else ctx.uiWorkspace.clearMain(); // Respect DSH's policy when its default workspace is unavailable.
  };
  ctx.slots.inject("main", () =>
    ctx.slots.register(
      {
        name: "main",
        key: "minicad",
        locale: "minicad",
        children: {
          "minicad.composer": { kind: "single", scope: "session" },
          "minicad.directoryFlow": { kind: "single", scope: "root" },
          "minicad.directoryActions": { kind: "list", scope: "root" },
          "minicad.session.menu": { kind: "list", scope: "root", inject: { hooks: {
            menuOpenState: (_standard, state) => () => state,
            shortcuts: ctx.shortcuts.catalog,
          } } },
          "minicad.session.rowActions": { kind: "list", scope: "root" },
          "minicad.session.leading": { kind: "list", scope: "root" },
          "minicad.session.hover": { kind: "list", scope: "root" },
          "minicad.session.renameDialog": { kind: "single", scope: "root" },
        },
      },
      ({ SessionProvider, renderSlot }) => (
        <React.Suspense fallback={<div className="mc-workbench"><div className="mc-empty"><span role="status" className="mc-loading"><StateDot state="ongoing" />{t("loading")}</span></div></div>}>
        <Workbench
          t={t}
          locale={locale}
          enter={enterWorkbench}
          back={leaveWorkbench}
          request={request}
          addGeometryReference={addGeometryReference}
          SessionProvider={SessionProvider}
          renderSlot={renderSlot}
          retainSession={(id) => ctx.sessions.retain(id, { source: "minicad" })}
          sessionCatalog={{ subscribe: listener => ctx.sessions.list.subscribe(listener), getSnapshot: () => ctx.sessions.list.getSnapshot() }}
          workspaceCatalog={{ subscribe: listener => ctx.workspaces.list.subscribe(listener), getSnapshot: () => ctx.workspaces.list.getSnapshot() }}
          renameConversation={async (sessionId, title) => {
            const result = await ctx.sessions.using(sessionId, { source: "workspaceOperation" }, reference => reference.binding.session.rename(title));
            if (!result.ok) throw new Error(result.error.message);
          }}
        />
        </React.Suspense>
      ),
    ),
  );
  ctx.slots.inject("minicad.composer", () =>
    ctx.slots.register({ name: "minicad.composer" }, Composer),
  );
  // Native session actions keep their own pin/archive behavior and dialogs.
  // MiniCAD redirects only rename requests and fork placement into this workspace.
  const mirror = (...args) => mirrorNativeSlot(ctx, ...args);
  // This is the same directory control used by the Session header, with an
  // explicit design path so renamed workspaces never use an old Session cwd.
  mirror("minicad.directoryActions", "sidebar.right.tab.files.actions", entry => entry.options.id === "open-in-app",
    () => ({ request, minicadT: t }), DirectoryOpenAction);
  mirror("minicad.session.menu", "sidebar.workspaces.session.menu.item", undefined, props => ({
    requestSessionRename: props.onRenameSession, forkSession: props.onForkSession,
  }));
  mirror("minicad.session.rowActions", "sidebar.workspaces.session.row.action");
  mirror("minicad.session.leading", "sidebar.session.row.leading");
  mirror("minicad.session.hover", "sidebar.session.row.hover");
  mirror("minicad.session.renameDialog", "shell.overlay", entry => entry.component.name === "SessionRenameDialog", props => ({
    useRenameRequest: select => select(props.renameTarget), settleSessionRename: props.onSettleRename,
    renameSession: props.onRenameSession,
  }));
  // Reuse the active native/browse occupant without redeclaring the host's hole.
  // DSH 0.2.1-rc.5 exposes component/inject on its public slot-entry records.
  ctx.slots.inject("minicad.directoryFlow", () => {
    let current, dispose;
    const sync = () => {
      const entry = ctx.slots.entriesOfSlot("sidebar.workspaces.directoryFlow")[0];
      if (entry === current) return;
      dispose?.();
      current = entry;
      dispose = entry ? ctx.slots.register({
        name: "minicad.directoryFlow",
        inject: entry.inject,
        locale: entry.locale,
      }, entry.component) : undefined;
    };
    const unsubscribe = ctx.slots.subscribe("sidebar.workspaces.directoryFlow", sync);
    sync();
    return () => { unsubscribe(); dispose?.(); };
  });
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: "minicad",
        order: 10,
        label: () => "MiniCAD",
        locale: "minicad",
      },
      PluginIcon,
    ),
  );
}
