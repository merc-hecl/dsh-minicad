import React, { useEffect, useRef, useState } from "react";
import {
  Button, Modal, Menu, MenuItemButton, Tooltip,
  IconFolderCloseRegular, IconProjectAddOutlineRegular,
  IconSearchOutlineRegular, IconSlidersTwoOutlineRegular, IconCloseFillRegular,
  IconPanelLeftOutlineRegular, IconPaperclipOutlineRegular,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { LibraryRow, TaskRow, workspaceClasses as c, workspaceLocale } from "./design-navigation-rows.jsx";

export function DesignNavigator({ libraries, projects, selected, running, language, t,
  onOpen, onCreate, onCreateLibrary, onRename, onRenameLibrary, onDeleteLibrary, onFork, onMove, onCollapse, onReference, attachments, libraryPickerBusy, renderTaskSlot, workspaceState }) {
  const [expanded, setExpanded] = useState({});
  const [search, setSearch] = useState(false), [query, setQuery] = useState("");
  const [options, setOptions] = useState(false), [order, setOrder] = useState("updated");
  const [archivedFilter, setArchivedFilter] = useState("hide-archived");
  const [deleteTarget, setDeleteTarget] = useState(null), [deleting, setDeleting] = useState(false), [deleteError, setDeleteError] = useState(null);
  const [now, setNow] = useState(Date.now());
  const input = useRef(null);
  const libraryName = (library) => library.title || t("defaultLibrary");
  const navigationT = (key, values = {}) => {
    if (key === "session.new") return t("newProject");
    if (key === "session.untitled") return t("untitled");
    if (key === "actions.newSession") return t("newProject");
    if (key === "actions.newSession.aria") return t("newTaskInLibrary", values);
    if (key === "actions.workspace.aria") return t("libraryActions", values);
    if (key === "actions.session.aria") return t("taskActions", values);
    if (key === "delete.workspace") return t("deleteLibrary");
    const text = workspaceLocale[language === "zh" ? "zh" : "en"][key] || key;
    return text.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
  };
  useEffect(() => {
    const libraryId = projects.find((project) => project.id === selected)?.library_id;
    if (libraryId) setExpanded((state) => ({ ...state, [libraryId]: true }));
  }, [selected, projects.find((project) => project.id === selected)?.library_id]);
  useEffect(() => {
    if (search) input.current?.focus();
  }, [search]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const archived = new Set(workspaceState.archivedSessionIds || []);
  const pins = workspaceState.pinnedSessionIds || [];
  const actions = (name, props, options) => {
    if (name === "sidebar.workspaces.session.row.action") return renderTaskSlot("minicad.task.rowActions", props);
    if (name !== "sidebar.workspaces.session.menu.item") return null;
    const project = projects.find((item) => item.session_id === props.sessionId);
    if (!project) return null;
    const perform = (callback) => { props.closeMenu(); callback(); };
    return <>
      {renderTaskSlot("minicad.task.menu", { ...props, onRenameTask: () => onRename(project), onForkTask: () => onFork(project) }, options)}
      {project.id === selected && attachments.map((attachment, index) => (
        <MenuItemButton key={attachment.id} separatorBefore={index === 0} icon={<IconPaperclipOutlineRegular />}
          onSelect={() => perform(() => onReference(attachment.id))}>
          {attachment.name}
        </MenuItemButton>
      ))}
      {libraries.filter((library) => library.id !== project.library_id).map((library, index) => (
        <MenuItemButton key={library.id} separatorBefore={index === 0} icon={<IconFolderCloseRegular />}
          onSelect={() => perform(() => onMove(project, library.id))}>
          {t("moveToLibrary", { name: libraryName(library) })}
        </MenuItemButton>
      ))}
    </>;
  };
  return (
    <div className={`${c.root} mc-design-navigator`}>
      <div className={c.sectionHeader}>
        <Tooltip label={t("collapseProjects")} portal>
          <button className={c.iconButton} aria-label={t("collapseProjects")} onClick={onCollapse}><IconPanelLeftOutlineRegular /></button>
        </Tooltip>
        <span className={`${c.sectionLabel} ${c.wide} ${search ? c.sectionLabelHidden : ""}`}>{t("libraries")}</span>
        <div className={`${c.searchSlot} ${search ? c.searchSlotExpanded : ""}`}>
          <div className={`${c.search} ${search ? c.searchExpanded : ""}`}>
            <Tooltip label={t("searchTasks")} side="bottom" portal delayMs={500}>
              <button className={c.searchButton} aria-label={t("searchTasks")} aria-expanded={search} onClick={() => setSearch(true)}>
                <IconSearchOutlineRegular size={search ? 11 : 14} />
              </button>
            </Tooltip>
            <input ref={input} className={c.searchInput} value={query} tabIndex={search ? 0 : -1}
              aria-label={t("searchTasks")} placeholder={t("searchTasks")} maxLength={500}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") { setQuery(""); setSearch(false); } }} />
            {search && <button className={c.clearButton} aria-label={t("close")} onClick={() => { setQuery(""); setSearch(false); }}><IconCloseFillRegular /></button>}
          </div>
        </div>
        <div className={`${c.headerActions} ${search ? c.headerActionsHidden : ""}`}>
          <Menu open={options} onClose={() => setOptions(false)} portal
            anchor={<button className={c.iconButton} aria-label={t("viewOptions")} onClick={() => setOptions((open) => !open)}><IconSlidersTwoOutlineRegular /></button>}
            selectedIds={[order, archivedFilter]} items={[
              { id: "updated", label: t("orderUpdated") }, { id: "title", label: t("orderTitle") },
              { type: "separator", id: "archive-separator" },
              { id: "hide-archived", label: navigationT("viewOptions.hideArchived") },
              { id: "show-archived", label: navigationT("viewOptions.showArchived") },
              { id: "only-archived", label: navigationT("viewOptions.onlyArchived") },
            ]}
            onSelect={(value) => { if (value.endsWith("-archived")) setArchivedFilter(value); else setOrder(value); setOptions(false); }} />
          <Tooltip label={t("newLibrary")} side="bottom" align="end" portal delayMs={500}>
            <button className={c.iconButton} aria-label={t("newLibrary")} disabled={libraryPickerBusy} onClick={onCreateLibrary}><IconProjectAddOutlineRegular /></button>
          </Tooltip>
        </div>
      </div>
      <div className={c.list} role="tree" aria-label={t("libraries")}>
        {libraries.map((library) => {
          const tasks = projects.filter((project) => project.library_id === library.id);
          const filtered = tasks.filter((project) => (archivedFilter === "show-archived" || archived.has(project.session_id) === (archivedFilter === "only-archived")) && `${libraryName(library)} ${project.title}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
          if (query && !filtered.length) return null;
          const open = query ? true : expanded[library.id] ?? library.id === "default";
          const containsCurrent = tasks.some((project) => project.id === selected);
          return <div key={library.id} className={c.groupSection} role="group">
            <LibraryRow group={{ key: library.id, workspaceId: library.id, label: libraryName(library), cwd: library.path, expanded: open, containsCurrent, createdAt: library.created * 1000 }}
              onToggle={() => setExpanded((state) => ({ ...state, [library.id]: !open }))}
              onCreate={() => { setExpanded((state) => ({ ...state, [library.id]: true })); onCreate(library.id); }}
              actions={{ rename: () => onRenameLibrary(library), delete: () => { setDeleteTarget(library); setDeleteError(null); } }} t={navigationT} />
            {open && filtered.sort((a, b) => {
              const aPin = pins.indexOf(a.session_id), bPin = pins.indexOf(b.session_id);
              if (aPin >= 0 || bPin >= 0) return (aPin < 0 ? Infinity : aPin) - (bPin < 0 ? Infinity : bPin);
              return order === "title" ? a.title.localeCompare(b.title) : b.updated - a.updated;
            }).map((project) => (
                  <TaskRow key={project.id} node={{ id: project.session_id || project.id, title: project.title, updatedAt: project.updated * 1000,
                    blank: !project.has_messages, running: project.running || (project.id === selected && running),
                    runningSubagentCount: 0, completed: false, archived: archived.has(project.session_id), pinned: pins.includes(project.session_id) }}
                    currentId={projects.find((item) => item.id === selected)?.session_id}
                    now={now} onOpen={() => { if (project.id !== selected && !archived.has(project.session_id)) onOpen(project.id); }}
                    onRenameRequest={() => onRename(project)} renderSlot={actions} t={navigationT} />
              ))}
          </div>;
        })}
      </div>
      <Modal open={deleteTarget !== null} onClose={() => { if (!deleting) setDeleteTarget(null); }} closeLabel={t("close")}
        title={t("deleteLibrary")} description={deleteTarget ? t("deleteLibraryDescription", { name: libraryName(deleteTarget) }) : undefined}
        footer={<>
          <Button variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>{t("cancel")}</Button>
          <Button variant="outline" className={c.deleteAction} disabled={deleting} onClick={async () => {
            setDeleting(true); setDeleteError(null);
            try { await onDeleteLibrary(deleteTarget); setDeleteTarget(null); }
            catch (error) { setDeleteError(error.message || String(error)); }
            finally { setDeleting(false); }
          }}>{t("deleteLibrary")}</Button>
        </>}>
        {deleting && <div className={c.deleteStatus} role="status">{t("deletingLibrary")}</div>}
        {deleteError && <div className={c.renameError} role="alert">{deleteError}</div>}
      </Modal>
    </div>
  );
}
