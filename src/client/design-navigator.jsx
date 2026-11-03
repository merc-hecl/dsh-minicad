import React, { useEffect, useRef, useState } from "react";
import {
  Button, Modal, Menu, Tooltip,
  IconProjectAddOutlineRegular, IconSearchOutlineRegular, IconSlidersTwoOutlineRegular,
  IconCloseFillRegular, IconPaperclipOutlineRegular,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { DesignFolderRow, TaskRow, workspaceClasses as c, workspaceLocale } from "./design-navigation-rows.jsx";
import { errorKey } from "../shared/errors.js";

export function DesignNavigator({ projects, selected, currentSessionId, language, t, onOpen, onCreate,
  onRename, onFork, onNewSession, onForkSession, onRenameSession, onRemove, onReference,
  attachments, pickerBusy, sessionState, workspaceState, renderTaskSlot }) {
  const [expanded, setExpanded] = useState({});
  const [archivedFilter, setArchivedFilter] = useState("hide-archived");
  const [search, setSearch] = useState(false), [query, setQuery] = useState("");
  const [options, setOptions] = useState(false), [order, setOrder] = useState("updated");
  const [removeTarget, setRemoveTarget] = useState(null), [removing, setRemoving] = useState(false), [removeError, setRemoveError] = useState(null);
  const [now, setNow] = useState(Date.now());
  const input = useRef(null);
  const navigationT = (key, values = {}) => {
    if (key === "actions.workspace.aria") return t("taskActions", values);
    if (key === "delete.workspace") return t("removeDesign");
    const text = workspaceLocale[language === "zh" ? "zh" : "en"][key] || key;
    return text.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
  };
  useEffect(() => {
    if (selected) setExpanded(state => ({ ...state, [selected]: true }));
  }, [selected]);
  useEffect(() => { if (search) input.current?.focus(); }, [search]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const archived = new Set(workspaceState.archivedSessionIds);
  const pins = workspaceState.pinnedSessionIds;
  const actions = (name, props, options) => {
    if (name === "sidebar.workspaces.session.menu.item") return renderTaskSlot("minicad.session.menu", {
      ...props, onRenameSession, onForkSession,
    }, options);
    const slots = { "sidebar.workspaces.session.row.action": "minicad.session.rowActions",
      "sidebar.session.row.leading": "minicad.session.leading", "sidebar.session.row.hover": "minicad.session.hover" };
    return slots[name] ? renderTaskSlot(slots[name], props) : null;
  };
  const queryText = query.trim().toLocaleLowerCase();
  // DSH keeps workspace registry order; sorting applies only to member sessions.
  const folders = projects;
  return <div className={`${c.root} mc-design-navigator`}>
    <div className={c.sectionHeader}>
      <span className={`${c.sectionLabel} ${c.wide} ${search ? c.sectionLabelHidden : ""}`}>{t("projects")}</span>
      <div className={`${c.searchSlot} ${search ? c.searchSlotExpanded : ""}`}><div className={`${c.search} ${search ? c.searchExpanded : ""}`}>
        <Tooltip label={t("searchTasks")} side="bottom" portal delayMs={500}><button className={c.searchButton} aria-label={t("searchTasks")} aria-expanded={search} onClick={() => setSearch(true)}><IconSearchOutlineRegular size={search ? 11 : 14} /></button></Tooltip>
        <input ref={input} className={c.searchInput} value={query} tabIndex={search ? 0 : -1} aria-label={t("searchTasks")} placeholder={t("searchTasks")} maxLength={500}
          onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { setQuery(""); setSearch(false); } }} />
        {search && <button className={c.clearButton} aria-label={t("close")} onClick={() => { setQuery(""); setSearch(false); }}><IconCloseFillRegular /></button>}
      </div></div>
      <div className={`${c.headerActions} ${search ? c.headerActionsHidden : ""}`}>
        <Menu open={options} onClose={() => setOptions(false)} portal anchor={<button className={c.iconButton} aria-label={t("viewOptions")} onClick={() => setOptions(open => !open)}><IconSlidersTwoOutlineRegular /></button>}
          selectedIds={[order, archivedFilter]} items={[
            { id: "updated", label: t("orderUpdated") }, { id: "title", label: t("orderTitle") },
            { type: "separator", id: "archive-separator" },
            ...["hide-archived", "show-archived", "only-archived"].map((id, index) => ({ id,
              label: navigationT(["viewOptions.hideArchived", "viewOptions.showArchived", "viewOptions.onlyArchived"][index]) })),
          ]} onSelect={value => { if (value.endsWith("-archived")) setArchivedFilter(value); else setOrder(value); setOptions(false); }} />
        <Tooltip label={t("openDesignFolder")} side="bottom" align="end" portal delayMs={500}><button className={c.iconButton} aria-label={t("openDesignFolder")} disabled={pickerBusy} onClick={onCreate}><IconProjectAddOutlineRegular /></button></Tooltip>
      </div>
    </div>
    <div className={c.list} role="tree" aria-label={t("projects")}>
      {folders.map(project => {
        const matchesFolder = project.title.toLocaleLowerCase().includes(queryText);
        const sessions = project.sessions.map(id => {
          const session = sessionState.byId[id];
          return { id, title: session?.title || "", blank: session?.blank ?? true,
            updatedAt: session?.updatedAt ?? project.created * 1000, running: session?.running || false,
            runningSubagentCount: sessionState.projectionsBySession[id]?.values.subagentCatalog?.filter(child => sessionState.byId[child.id]?.running).length || 0,
            completed: false, archived: archived.has(id), pinned: pins.includes(id) };
        }).filter(session => (archivedFilter === "show-archived" || session.archived === (archivedFilter === "only-archived"))
          && (!session.blank || session.id === project.activeSessionId)
          && (!queryText || matchesFolder || session.title.toLocaleLowerCase().includes(queryText)));
        if ((queryText && !matchesFolder && !sessions.length) || (archivedFilter === "only-archived" && !sessions.length)) return null;
        sessions.sort((a,b) => {
          if (a.blank !== b.blank) return a.blank ? -1 : 1;
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          if (a.pinned && b.pinned) return pins.indexOf(a.id) - pins.indexOf(b.id);
          return order === "title" ? a.title.localeCompare(b.title) : b.updatedAt - a.updatedAt;
        });
        const open = queryText ? true : expanded[project.id] ?? true;
        const references = project.id === selected ? attachments : [];
        return <div key={project.id} className={c.groupSection} role="group">
          <DesignFolderRow group={{ key: project.id, workspaceId: project.id, label: project.title,
            cwd: project.directory, createdAt: project.created * 1000, expanded: open, containsCurrent: project.id === selected }}
            onToggle={() => setExpanded(state => ({ ...state, [project.id]: !open }))}
            onCreate={() => { setExpanded(state => ({ ...state, [project.id]: true })); onNewSession(project); }}
            actions={{ rename: () => onRename(project), delete: () => { setRemoveTarget(project); setRemoveError(null); },
              items: [{ type: "separator", id: "design-separator" },
                { id: "save-as", label: t("saveAsDesign"), disabled: project.running, icon: <IconProjectAddOutlineRegular /> },
                ...references.map(attachment => ({ id: attachment.id, label: attachment.name, icon: <IconPaperclipOutlineRegular /> }))],
              select: id => id === "save-as" ? onFork(project) : onReference(id),
            }} t={navigationT} />
          {open && sessions.map(session => <TaskRow key={session.id} node={session} currentId={currentSessionId} now={now}
            onOpen={() => { if (!session.archived && session.id !== currentSessionId) onOpen(project.id, session.id); }}
            onRenameRequest={onRenameSession} renderSlot={actions} t={navigationT} />)}
        </div>;
      })}
    </div>
    <Modal className="mc-dialog" open={removeTarget !== null} onClose={() => { if (!removing) setRemoveTarget(null); }} closeLabel={t("close")} title={t("removeDesign")}
      description={removeTarget ? t("removeDesignDescription", { name: removeTarget.title }) : undefined}
      footer={<><Button variant="outline" disabled={removing} onClick={() => setRemoveTarget(null)}>{t("cancel")}</Button>
        <Button variant="outline" className={c.deleteAction} disabled={removing} onClick={async () => {
          setRemoving(true); setRemoveError(null);
          try { await onRemove(removeTarget); setRemoveTarget(null); } catch (error) { setRemoveError(t(error.uiKey || errorKey(error.message || ""))); } finally { setRemoving(false); }
        }}>{t("removeDesign")}</Button></>}>
      {removeError && <div className={c.renameError} role="alert">{removeError}</div>}
    </Modal>
  </div>;
}
