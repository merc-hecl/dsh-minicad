import React from "react";
import { Workbench, Cube, NativeComposer } from "./workbench.jsx";
import { zh, en } from "./locale.js";
import css from "./styles.css";
export const inject = [
  "slots", "layout", "locale", "sessions", "conversation", "uiWorkspace",
];
export function apply(ctx) {
  ctx.effect(
    () => ctx.locale.register("minicad", { zh, en }),
    "minicad: locale",
  );
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "dsh-minicad";
    style.textContent = css;
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
  const request = async (method, params) => {
    const response = await fetch("/api/minicad/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, params }),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(data.error || response.statusText), {
        uiKey: data.code,
      });
    return data;
  };
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
        children: { "minicad.composer": { kind: "single", scope: "session" } },
      },
      ({ SessionProvider, renderSlot }) => (
        <Workbench
          t={t}
          locale={locale}
          enter={(element) => setSidebarCollapsed(element, true)}
          back={(element) => {
            setSidebarCollapsed(element, false);
            ctx.uiWorkspace.startSession();
          }}
          request={request}
          SessionProvider={SessionProvider}
          renderSlot={renderSlot}
          retainSession={(id) => ctx.sessions.retain(id, { source: "minicad" })}
        />
      ),
    ),
  );
  ctx.slots.inject("minicad.composer", () =>
    ctx.slots.register({ name: "minicad.composer" }, NativeComposer),
  );
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: "minicad",
        order: 10,
        label: () => "MiniCAD",
        locale: "minicad",
      },
      Cube,
    ),
  );
}
