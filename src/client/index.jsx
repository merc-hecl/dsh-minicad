import React from "react";
import { registerGeometryReferences } from "./geometry-reference.jsx";
import { Composer } from "./composer.jsx";
import { StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import { decodePreview } from "../shared/preview.js";
const Workbench = React.lazy(() => import(__MINICAD_WORKBENCH_URL__).then((asset) => ({ default: asset.createModule(__MINICAD_REQUIRE__).Workbench })));
import { ForgeIcon } from "./forge-icon.jsx";
import { zh, en } from "./locale.js";
import css from "./styles.css";
import workspaceCss from "./design-navigator.css";
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
    style.textContent = `${workspaceCss}\n${css}`;
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
    if (method === "preview") {
      const response = await fetch("/api/minicad/preview?" + new URLSearchParams(params), { signal: combined });
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
    return data;
  };
  const addGeometryReference = registerGeometryReferences(ctx, request);
  const setSidebarCollapsed = (workbench, collapsed) => {
    // DSH rc.5 exposes toggleSidebar but no state getter or explicit setter.
    // Read AppFrame's published state marker; leave all layout writes to DSH.
    const current = workbench.closest("[data-sidebar-collapsed]") !== null;
    if (current !== collapsed) ctx.layout.toggleSidebar();
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
          "minicad.task.menu": { kind: "list", scope: "root", inject: { hooks: {
            menuOpenState: (_standard, state) => () => state,
            shortcuts: ctx.shortcuts.catalog,
          } } },
          "minicad.task.rowActions": { kind: "list", scope: "root" },
          "minicad.task.renameDialog": { kind: "single", scope: "root" },
        },
      },
      ({ SessionProvider, renderSlot }) => (
        <React.Suspense fallback={<div className="mc-workbench"><div className="mc-empty"><span role="status" className="mc-loading"><StateDot state="ongoing" />{t("loading")}</span></div></div>}>
        <Workbench
          t={t}
          locale={locale}
          enter={(element) => setSidebarCollapsed(element, true)}
          back={(element) => {
            setSidebarCollapsed(element, false);
            ctx.uiWorkspace.startSession();
          }}
          request={request}
          addGeometryReference={addGeometryReference}
          SessionProvider={SessionProvider}
          renderSlot={renderSlot}
          retainSession={(id) => ctx.sessions.retain(id, { source: "minicad" })}
          workspaceCatalog={{ subscribe: (listener) => ctx.workspaces.list.subscribe(listener), getSnapshot: () => ctx.workspaces.list.getSnapshot() }}
          forkTask={(project) => new Promise((resolve, reject) => {
            if (project.running) { reject(new Error(t("buildBusy"))); return; }
            ctx.uiWorkspace.forkSession(project.session_id, (childId) => {
              request("fork_project", { projectId: project.id, sessionId: childId }).then(resolve, reject);
            }, { allowMigration: false }).catch(reject);
          })}
        />
        </React.Suspense>
      ),
    ),
  );
  ctx.slots.inject("minicad.composer", () =>
    ctx.slots.register({ name: "minicad.composer" }, Composer),
  );
  // Reuse the installed action components, their injected behavior, shortcuts and dialogs.
  // Only fork and rename bridge back to MiniCAD's task selection and independent files.
  const mirror = (target, source, select, adapt) => ctx.slots.inject(target, () => {
    let entries = [], disposers = [];
    const sync = () => {
      const next = ctx.slots.entriesOfSlot(source).filter(select);
      if (next.length === entries.length && next.every((entry, index) => entry === entries[index])) return;
      disposers.forEach((dispose) => dispose());
      entries = next;
      disposers = next.map((entry, index) => {
        const Component = entry.component;
        return ctx.slots.register({ name: target, id: `action-${index}`, order: index, inject: entry.inject, locale: entry.locale },
          (props) => <Component {...props} {...adapt(props)} />);
      });
    };
    const unsubscribe = ctx.slots.subscribe(source, sync);
    sync();
    return () => { unsubscribe(); disposers.forEach((dispose) => dispose()); };
  });
  mirror("minicad.task.menu", "sidebar.workspaces.session.menu.item", () => true, (props) => ({
    forkSession: props.onForkTask,
    requestSessionRename: props.onRenameTask,
  }));
  mirror("minicad.task.rowActions", "sidebar.workspaces.session.row.action", () => true, () => ({}));
  mirror("minicad.task.renameDialog", "shell.overlay", (entry) => entry.component.name === "SessionRenameDialog", (props) => ({
    useRenameRequest: (select) => select(props.renameTarget),
    settleSessionRename: props.onSettleRename,
    renameSession: props.onRenameTask,
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
      ForgeIcon,
    ),
  );
}
