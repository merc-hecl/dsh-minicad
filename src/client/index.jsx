import React from "react";
import { Workbench, Cube } from "./workbench.jsx";
import { zh, en } from "./locale.js";
import css from "./styles.css";
export const inject = ["slots", "layout", "locale"];
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
  ctx.slots.inject("main", () =>
    ctx.slots.register(
      { name: "main", key: "minicad", locale: "minicad" },
      () => (
        <Workbench
          t={t}
          locale={locale}
          back={() => ctx.layout.selectPanel(null)}
          request={request}
        />
      ),
    ),
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
