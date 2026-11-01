import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { WorkbenchDialog } from "./workbench-dialog.jsx";
import { errorKey } from "../shared/errors.js";

// This is a view of MiniCAD's workspace ownership, not a second DSH registry.
// DSH workspace membership validates immutable Session-header cwd, whereas a
// MiniCAD design can move with all of its conversations.
const designKey = id => `minicad:${id}`;
const orderKey = "minicad.mainWorkspaceOrder";
const savedOrder = () => {
  try { return JSON.parse(localStorage.getItem(orderKey) || "[]"); }
  catch { return []; }
};

export function createDesignCatalog(read) {
  let snapshot = [], serialized = "[]", pending;
  const listeners = new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    update(items) {
      const next = JSON.stringify(items);
      if (next === serialized) return;
      snapshot = items; serialized = next;
      for (const listener of listeners) listener();
    },
    refresh() {
      return pending ||= read().finally(() => { pending = null; });
    },
  };
}

function MainWorkspaces({ NativeBrowser, catalog, request, minicadT, ...props }) {
  const designs = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot);
  const native = props.useWorkspaces(state => state);
  const [order, setOrder] = useState(savedOrder);
  const [error, setError] = useState(null);
  useEffect(() => {
    let disposed = false, timer;
    const refresh = async () => {
      try { if (!document.hidden) await catalog.refresh(); }
      catch (error) { if (!disposed) console.warn("MiniCAD workspace list:", error); }
      finally { if (!disposed) timer = setTimeout(refresh, 3500); }
    };
    refresh();
    return () => { disposed = true; clearTimeout(timer); };
  }, [catalog]);
  const byKey = useMemo(() => new Map(designs.map(design => [designKey(design.id), design])), [designs]);
  const workspaces = useMemo(() => {
    const claimed = new Set(designs.flatMap(design => design.sessions));
    const ownedPaths = new Set(designs.map(design => design.directory));
    const items = [
      ...native.items.filter(item => !ownedPaths.has(item.path))
        .map(item => ({ ...item, sessionIds: item.sessionIds.filter(id => !claimed.has(id)) })),
      ...designs.map(design => ({ workspaceId: designKey(design.id), path: design.directory,
        title: design.title, sessionIds: [...new Set([...design.sessions,
          ...native.items.filter(item => item.path === design.directory).flatMap(item => item.sessionIds).filter(id => !claimed.has(id))])],
        createdAt: new Date(design.created * 1000).toISOString(), updatedAt: new Date(design.updated * 1000).toISOString() })),
    ];
    if (order.length) {
      const ranks = new Map(order.map((id, index) => [id, index]));
      items.sort((a, b) => (ranks.get(a.workspaceId) ?? Infinity) - (ranks.get(b.workspaceId) ?? Infinity));
    }
    return { ...native, items };
  }, [native, designs, order]);
  const modify = async (method, args) => {
    const result = await request(method, args);
    await catalog.refresh();
    return result;
  };
  return <><NativeBrowser {...props} useWorkspaces={select => select(workspaces)}
    startSession={(id, options) => {
      const design = byKey.get(id);
      if (!design) return props.startSession(id, options);
      // The native browser owns presentation and opens the real DSH Session.
      modify("new_session", { projectId: design.id }).then(project => props.open(project.activeSessionId))
        .catch(error => setError({ key: error.uiKey || errorKey(error.message), detail: error.message }));
    }}
    renameWorkspace={(id, title) => byKey.has(id)
      ? modify("rename", { projectId: byKey.get(id).id, title }) : props.renameWorkspace(id, title)}
    deleteWorkspace={id => byKey.has(id)
      ? modify("close_design", { projectId: byKey.get(id).id }) : props.deleteWorkspace(id)}
    insertWorkspaceBefore={async (id, beforeId) => {
      if (id === beforeId) return;
      if (!byKey.has(id)) {
        const ids = workspaces.items.map(item => item.workspaceId);
        const anchor = byKey.has(beforeId) ? ids.slice(ids.indexOf(beforeId)).find(key => !byKey.has(key)) : beforeId;
        await props.insertWorkspaceBefore(id, anchor);
      }
      const ids = workspaces.items.map(item => item.workspaceId).filter(key => key !== id);
      const index = beforeId === undefined ? ids.length : ids.indexOf(beforeId);
      ids.splice(index < 0 ? ids.length : index, 0, id);
      localStorage.setItem(orderKey, JSON.stringify(ids)); setOrder(ids);
    }} />
    {error && <WorkbenchDialog error={error} t={minicadT} onClose={() => setError(null)} title={minicadT("error")} />}
  </>;
}

export function mirrorNativeSlot(ctx, target, source, select = () => true, adapt = () => ({})) {
  return ctx.slots.inject(target, () => {
    let entries = [], disposers = [];
    const sync = () => {
      const next = ctx.slots.entriesOfSlot(source).filter(select);
      if (next.length === entries.length && next.every((entry, index) => entry === entries[index])) return;
      disposers.forEach(dispose => dispose());
      entries = next;
      disposers = next.map((entry, index) => {
        const Component = entry.component;
        return ctx.slots.register({ name: target, id: `action-${index}`, order: index,
          inject: entry.inject, locale: entry.locale, store: entry.store }, props => <Component {...props} {...adapt(props)} />);
      });
    };
    const unsubscribe = ctx.slots.subscribe(source, sync);
    sync();
    return () => { unsubscribe(); disposers.forEach(dispose => dispose()); };
  });
}

export function registerMainWorkspaces(ctx, catalog, request) {
  // Single slots explicitly support priority shadowing. Keep the installed
  // browser, its injected actions, view store, dictionaries and child seats.
  ctx.slots.inject("sidebar.workspaces", () => {
    let source, dispose;
    const alias = name => `minicad.main.${name}`;
    function MiniCADWorkspaces(props) {
      return <MainWorkspaces {...props} NativeBrowser={source.component} catalog={catalog} request={request}
        minicadT={ctx.locale.bind("minicad")}
        renderSlot={(name, args, options) => props.renderSlot(alias(name), args, options)} />;
    }
    const sync = () => {
      const entry = ctx.slots.entries("sidebar.workspaces").find(item => item.component.name === "WorkspaceBrowser");
      if (entry === source) return;
      dispose?.(); source = entry;
      dispose = entry ? ctx.slots.register({ name: "sidebar.workspaces", priority: (entry.options.priority || 0) - 1,
        inject: entry.inject, locale: entry.locale, store: entry.store,
        children: Object.fromEntries(Object.entries(entry.children).map(([name, spec]) => [alias(name), spec])),
      }, MiniCADWorkspaces) : undefined;
    };
    const unsubscribe = ctx.slots.subscribe("sidebar.workspaces", sync);
    sync();
    return () => { unsubscribe(); dispose?.(); };
  });
  for (const name of ["sidebar.workspaces.directoryFlow", "sidebar.workspaces.session.menu.item",
    "sidebar.workspaces.session.row.action", "sidebar.session.row.leading", "sidebar.session.row.hover"])
    mirrorNativeSlot(ctx, `minicad.main.${name}`, name);
}
