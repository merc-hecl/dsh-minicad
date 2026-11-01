import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  Button,
  Tooltip,
  Input,
  StateDot,
  Tag,
  IconPlusOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconCloseOutlineRegular,
  IconFolderCloseRegular,
  IconFolderOpenRegular,
  IconPanelLeftOutlineRegular,
  IconEllipsisOutlineRegular,
  IconDownloadOutlineRegular,
  IconClockOutlineRegular,
  IconRefreshOutlineRegular,
  IconSlidersTwoOutlineRegular,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { Viewport } from "./viewport.jsx";
import { errorKey } from "./locale.js";
import { ForgeIcon } from "./forge-icon.jsx";
import { ParameterDialog } from "./parameter-dialog.jsx";
import { ErrorDetails, WorkbenchDialog } from "./workbench-dialog.jsx";
import { DesignNavigator } from "./design-navigator.jsx";

export function Cube({ size = 22, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      {...props}
    >
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z M4 7.5l8 4.5 8-4.5 M12 12v9 M8 5.2l8 4.6" />
    </svg>
  );
}
const Btn = ({ children, icon: Icon, label, className = "", ...props }) => {
  const button = (
    <Button
      variant="ghost"
      size="md"
      icon={Icon && <Icon size={16} />}
      className={className}
      aria-label={label}
      {...props}
    >
      {children}
    </Button>
  );
  return label ? (
    <Tooltip label={label} portal>{button}</Tooltip>
  ) : button;
};

export function Workbench({
  locale, t, enter, back, request, SessionProvider, renderSlot, retainSession, workspaceCatalog, forkTask,
}) {
  const workbench = useRef(null);
  const bottom = useRef(null);
  useLayoutEffect(() => {
    enter(workbench.current);
  }, []);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      workbench.current.style.setProperty("--mc-composer-height", `${bottom.current.offsetHeight}px`);
    });
    observer.observe(bottom.current);
    return () => observer.disconnect();
  }, []);
  const language = useSyncExternalStore(
    locale.subscribe,
    locale.getSnapshot,
  ).active;
  const [projects, setProjects] = useState([]),
    [project, setProject] = useState(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [libraries, setLibraries] = useState([]);
  const workspaceState = useSyncExternalStore(workspaceCatalog.subscribe, workspaceCatalog.getSnapshot);
  const [renameTarget, setRenameTarget] = useState(null);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [editTarget, setEditTarget] = useState("");
  const [selected, setSelected] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(null);
  const [busy, setBusy] = useState(false),
    [running, setRunning] = useState(false);
  const [wire, setWire] = useState(false),
    [resetView, setResetView] = useState(0);
  const [modal, setModal] = useState(null),
    [value, setValue] = useState(""),
    [editHead, setEditHead] = useState(0);
  const [sessionReference, setSessionReference] = useState(null);
  const [reference, setReference] = useState(null);
  const selection = useRef(""),
    projectRef = useRef(null),
    alive = useRef(true);
  const languageRef = useRef(language),
    lastStatusError = useRef("");
  languageRef.current = language;
  selection.current = selected;
  projectRef.current = project;
  const previewCache = useRef(null), previewRequest = useRef(null);
  const loadController = useRef(new AbortController());
  const showError = (e) => {
    if (e.name === "AbortError" || e.code === "ABORT_ERR") return;
    if (alive.current) setError({ key: e.uiKey || errorKey(e.message || ""), detail: e.message || String(e) });
  };
  const api = async (method, params = {}) => {
    const render = ["get", "build", "restore"].includes(method) && params.geometry !== false;
    const controller = loadController.current;
    const data = await request(method, {
      ...params, ...(render ? { geometry: false } : {}),
      locale: languageRef.current === "zh" ? "zh" : "en",
    }, method === "get" ? controller.signal : undefined);
    if (!render) return data;
    const checkCurrent = () => {
      const current = projectRef.current;
      if (controller.signal.aborted || selection.current !== data.id ||
          (current?.id === data.id && current.sourceFile === data.sourceFile && current.head > data.head))
        throw new DOMException("Superseded model preview", "AbortError");
    };
    checkCurrent();
    if (!data.design || !data.head) return data;
    const key = JSON.stringify([data.id, data.sourceFile, data.head]);
    try {
      let previewData;
      if (previewCache.current?.key === key) previewData = previewCache.current.data;
      else {
        let pending = previewRequest.current;
        if (!pending || pending.key !== key || pending.signal !== controller.signal) {
          pending = { key, signal: controller.signal };
          pending.promise = request("preview", { projectId: data.id, sourceFile: data.sourceFile, revision: data.head }, controller.signal);
          previewRequest.current = pending;
        }
        try { previewData = await pending.promise; }
        finally { if (previewRequest.current === pending) previewRequest.current = null; }
        checkCurrent();
        previewCache.current = { key, data: previewData };
      }
      return { ...data, design: { ...data.design, previewData } };
    } catch (error) {
      if (error.name !== "AbortError" && alive.current && !controller.signal.aborted && selection.current === data.id) setProject(data);
      throw error;
    }
  };
  async function refreshList() {
    const [p, groups] = await Promise.all([api("list"), api("libraries")]);
    if (alive.current) { setProjects(p); setLibraries(groups); }
    return p;
  }
  const abandonedTasks = useRef(new Set()), discardingTasks = useRef(new Set());
  async function discardAbandonedTasks(currentId) {
    let changed = false;
    for (const id of [...abandonedTasks.current]) {
      if (selection.current !== currentId || !alive.current) break;
      abandonedTasks.current.delete(id);
      if (id === currentId || discardingTasks.current.has(id)) continue;
      discardingTasks.current.add(id);
      try {
        const result = await api("discard_empty", { projectId: id });
        changed ||= result.discarded;
      } finally {
        discardingTasks.current.delete(id);
      }
    }
    if (changed) await refreshList();
  }
  async function load(id) {
    if (discardingTasks.current.has(id)) return;
    const previous = projects.find((task) => task.id === selection.current);
    if (selection.current && selection.current !== id && !previous?.has_messages && !previous?.head)
      abandonedTasks.current.add(selection.current);
    abandonedTasks.current.delete(id);
    loadController.current.abort();
    loadController.current = new AbortController();
    const controller = loadController.current;
    previewCache.current = null;
    previewRequest.current = null;
    selection.current = id;
    lastStatusError.current = "";
    setError(null);
    setSelected(id);
    setLoading(true);
    setProject(null);
    setModal(null);
    setRunning(false);
    try {
      const p = await api("get", { projectId: id });
      if (selection.current === id && alive.current && controller === loadController.current) {
        setProject(p);
        await discardAbandonedTasks(id);
      }
    } catch (e) {
      showError(e);
    } finally {
      if (selection.current === id && controller === loadController.current) setLoading(false);
    }
  }
  function clearSelection() {
    loadController.current.abort();
    loadController.current = new AbortController();
    previewCache.current = null;
    previewRequest.current = null;
    selection.current = "";
    setSelected("");
    setProject(null);
    setModal(null);
    setRunning(false);
    setLoading(false);
  }
  useEffect(() => {
    alive.current = true;
    refreshList()
      .then(async (p) => {
        if (!alive.current) return;
        // A native composer needs a real Session even before its first message.
        const available = p.filter((task) => !workspaceCatalog.getSnapshot().archivedSessionIds?.includes(task.session_id));
        const groups = available.length ? [] : await api("libraries");
        const first = available[0] || (groups.length ? await api("create", { libraryId: groups[0].id, title: t("untitled") }) : null);
        if (!alive.current) return;
        if (!first) { clearSelection(); return; }
        if (!available.length) await refreshList();
        await load(first.id);
      })
      .catch((e) => {
        showError(e);
        setLoading(false);
      });
    return () => {
      alive.current = false;
      loadController.current.abort();
      previewCache.current = null;
    };
  }, []);
  useEffect(() => {
    if (!project?.session_id || !workspaceState.archivedSessionIds?.includes(project.session_id)) return;
    const next = projects.find((task) => task.id !== selected && !workspaceState.archivedSessionIds.includes(task.session_id));
    if (next) load(next.id);
    else clearSelection();
  }, [workspaceState.archivedSessionIds, project?.session_id]);
  useEffect(() => {
    const id = project?.session_id;
    if (!id) return;
    const reference = retainSession(id);
    let disposed = false;
    reference.ready
      .then(() => {
        if (!disposed) setSessionReference(reference);
      })
      .catch((e) => {
        if (!disposed) showError(e);
      });
    return () => {
      disposed = true;
      setSessionReference(null);
      reference.release();
    };
  }, [project?.session_id]);
  useEffect(() => {
    if (!selected) return;
    let disposed = false,
      timer;
    const poll = async () => {
      try {
        const state = await api("status", { projectId: selected });
        if (disposed || selection.current !== selected) return;
        setRunning(state.running);
        if (state.projects) setProjects(state.projects);
        if (state.error && state.error !== lastStatusError.current)
          setError({ key: errorKey(state.error), detail: state.error });
        lastStatusError.current = state.error || "";
        if (state.title && state.title !== projectRef.current?.title) {
          setProject((current) => current ? { ...current, title: state.title } : current);
        }
        if (projectRef.current && (state.head !== projectRef.current.head || state.sourceVersion !== projectRef.current.sourceVersion || state.workspaceDirectory !== projectRef.current.workspaceDirectory || state.sourceFile !== projectRef.current.sourceFile)) {
          const p = await api("get", { projectId: selected });
          if (!disposed && selection.current === selected) {
            setProject(p);
            refreshList().catch(showError);
          }
        }
        timer = setTimeout(poll, state.running ? 1000 : 3500);
      } catch (e) {
        if (!disposed) {
          showError(e);
          timer = setTimeout(poll, 5000);
        }
      }
    };
    poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [selected]);
  useEffect(() => {
    const id = selection.current;
    if (!id) return;
    api("get", { projectId: id })
      .then((p) => {
        if (alive.current && selection.current === id)
          setProject(p);
      })
      .catch(showError);
  }, [language]);
  async function action(fn) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      showError(e);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function open(kind) {
    setError(null);
    setEditTarget("");
    setModal(kind);
    setEditHead(project?.head || 0);
    setValue(
      kind === "create"
        ? ""
        : kind === "rename"
          ? project.title
          : kind === "source"
            ? project.design.source
            : "",
    );
  }
  function openReference(id, projectId = selected) {
    if (selection.current !== projectId) return;
    setReference({ name: project?.attachments.find((item) => item.id === id)?.name || t("pdfPreview"), url: "/api/minicad/reference?" + new URLSearchParams({ projectId, attachmentId: id }) });
    setModal("reference");
  }
  async function saveEditor(parameterValues) {
    await action(async () => {
      const id = editTarget || selected;
      if (modal === "renameLibrary") {
        await api("rename_library", { title: value, libraryId: editTarget });
        await refreshList();
        setModal(null);
        return;
      }
      if (modal === "create") {
        const p = await api("create", { title: value.trim() || t("untitled") });
        await refreshList();
        await load(p.id);
        return;
      }
      if (modal === "rename") {
        await api("rename", { projectId: id, title: value });
        await refreshList();
        if (selection.current === id) setProject((p) => ({ ...p, title: value }));
        setModal(null);
        return;
      }
      const params = modal === "parameters" ? parameterValues : undefined;
      const next = await api("build", {
        projectId: id,
        expectedRevision: editHead,
        ...(params ? { parameters: params } : { source: value }),
        summary: t(params ? "edited" : "sourceEdited"),
      });
      if (selection.current === id) {
        setProject(next);
        setModal(null);
      }
      await refreshList();
    });
  }
  const design = project?.design;
  const date = (timestamp) =>
    new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(timestamp * 1000);
  const editable = ["create", "rename", "source", "renameLibrary"].includes(modal);
  const libraryEditor = modal === "renameLibrary";
  return (
    <div
      ref={workbench}
      className="mc-workbench"
      data-project-panel-collapsed={panelCollapsed || undefined}
    >
      <Viewport
        id="mc-view-model-panel"
        design={design}
        wire={wire}
        resetToken={resetView}
        t={t}
        onError={() => setError({ key: "webglError" })}
      />
      <header className="mc-header">
        <Btn
          icon={IconChevronLeftOutlineRegular}
          label={t("back")}
          onClick={() => back(workbench.current)}
        />
        <strong>MiniCAD</strong>
        <span className="mc-crumb">
          {libraries.find((library) => library.id === project?.library_id)?.title || t("defaultLibrary")}
          {project ? ` / ${project.title}` : ""}
        </span>
        <span className="mc-spacer" />
        {project?.head > 0 && (
          <Btn icon={IconClockOutlineRegular} onClick={() => open("history")}>
            {`v${project.head}`}
          </Btn>
        )}
        <Btn
          icon={IconDownloadOutlineRegular}
          variant="outline"
          disabled={!design}
          onClick={() => open("export")}
        >
          {t("export")}
        </Btn>
      </header>
      <aside className={`mc-sidebar ${panelCollapsed ? "" : "mc-panel"}`} aria-label={t("libraries")}>
        {panelCollapsed ? (
          <Btn icon={IconPanelLeftOutlineRegular} variant="outline" label={t("expandProjects")} onClick={() => setPanelCollapsed(false)} />
        ) : (
          <DesignNavigator libraries={libraries} projects={projects} selected={selected} running={running} language={language} t={t}
            workspaceState={workspaceState} renderTaskSlot={renderSlot}
            onCollapse={() => setPanelCollapsed(true)}
            libraryPickerBusy={libraryPickerOpen || busy}
            onCreateLibrary={() => { if (!busy) { setError(null); setLibraryPickerOpen(true); } }}
            onRenameLibrary={(library) => { setError(null); setEditTarget(library.id); setValue(library.title || t("defaultLibrary")); setModal("renameLibrary"); }}
            onRename={(task) => setRenameTarget({ sessionId: task.session_id, currentTitle: task.title })}
            onFork={(task) => action(async () => {
              const branch = await forkTask({ ...task, running: task.running || (task.id === selected && running) });
              await refreshList();
              await load(branch.id);
            })}
            onDeleteLibrary={async (library) => {
              await api("remove_library", { libraryId: library.id });
              const tasks = await refreshList();
              if (projectRef.current?.library_id === library.id) {
                const next = tasks.find((task) => !workspaceState.archivedSessionIds?.includes(task.session_id));
                if (next) await load(next.id);
                else clearSelection();
              }
            }}
            onMove={(task, libraryId) => action(async () => {
              await api("move_project", { projectId: task.id, libraryId });
              if (selection.current === task.id) setProject((current) => ({ ...current, library_id: libraryId }));
              await refreshList();
            })}
            onCreate={(libraryId) => action(async () => {
              const task = await api("create", { libraryId, title: t("untitled") });
              await refreshList();
              await load(task.id);
            })}
            onOpen={load}
            attachments={project?.attachments || []}
            onReference={openReference} />
        )}
      </aside>
      {renderSlot("minicad.directoryFlow", {
        open: libraryPickerOpen,
        busy,
        onPicked: async (path) => {
          await action(async () => {
            const library = await api("create_library", { path });
            const tasks = await refreshList();
            let task = tasks.find((item) => item.library_id === library.id && !item.has_messages);
            if (!task) {
              task = await api("create", { libraryId: library.id, title: t("untitled") });
              await refreshList();
            }
            await load(task.id);
          });
          setLibraryPickerOpen(false);
        },
        onCancel: () => setLibraryPickerOpen(false),
        onError: (message) => { setLibraryPickerOpen(false); showError(new Error(message)); },
      })}
          <div className="mc-tools mc-panel">
            <Btn icon={IconRefreshOutlineRegular} label={t("resetView")} onClick={() => setResetView((value) => value + 1)} />
            <Btn
              icon={Cube}
              label={t(wire ? "solid" : "wire")}
              onClick={() => setWire((w) => !w)}
            />
            <Btn
              icon={IconSlidersTwoOutlineRegular}
              label={t("parameters")}
              disabled={!design}
              onClick={() => open("parameters")}
            />
          </div>
      {!design && !loading && (
        <div className="mc-empty">
          <div className="mc-brand-icon">
            <ForgeIcon size={44} />
          </div>
          <h1>{t("emptyTitle")}</h1>
          <p>{t("emptyHint")}</p>
        </div>
      )}
      {loading && (
        <div className="mc-empty">
          <span role="status" className="mc-loading"><StateDot state="ongoing" />{t("loading")}</span>
        </div>
      )}
      <section ref={bottom} className="mc-bottom">
        {sessionReference && project && sessionReference.sessionId === project.session_id ? (
          <SessionProvider session={sessionReference}>
            {renderSlot("minicad.composer", {})}
          </SessionProvider>
        ) : selected || loading ? <span role="status" className="mc-loading mc-muted"><StateDot state="ongoing" />{t("loading")}</span> : (
          <Btn icon={IconPlusOutlineRegular} onClick={() => {
            if (!libraries.length) { setLibraryPickerOpen(true); return; }
            action(async () => {
              const task = await api("create", { libraryId: libraries[0].id, title: t("untitled") });
              await refreshList(); await load(task.id);
            });
          }}>{t(libraries.length ? "newProject" : "newLibrary")}</Btn>
        )}
        <div className="mc-help">{t("controls")}</div>
      </section>
      {renderSlot("minicad.task.renameDialog", {
        renameTarget,
        onSettleRename: () => setRenameTarget(null),
        onRenameTask: async (sessionId, title) => {
          const task = projects.find((item) => item.session_id === sessionId);
          if (!task) throw new Error(t("projectMissing"));
          await api("rename", { projectId: task.id, title });
          if (selection.current === task.id) setProject((current) => current ? { ...current, title } : current);
          await refreshList();
        },
      })}
      {modal === "parameters" && design && (
        <ParameterDialog
          parameters={design.parameters}
          busy={busy}
          error={error}
          onClose={() => setModal(null)}
          onSave={saveEditor}
          t={t}
        />
      )}
      {modal && modal !== "parameters" && (
        <WorkbenchDialog
          key={modal}
          title={t(modal === "reference" ? "pdfPreview" : modal === "create" ? "newProject" : modal)}
          className={["reference", "source"].includes(modal) ? "mc-wide" : modal === "history" ? "mc-history-dialog" : ""}
          busy={busy}
          error={error}
          onClose={() => setModal(null)}
          t={t}
          footer={editable ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setModal(null)}>
                {t("cancel")}
              </Button>
              <Button
                variant="primary"
                disabled={busy || ((modal === "rename" || libraryEditor) && !value.trim())}
                icon={busy ? <StateDot state="ongoing" /> : undefined}
                onClick={() => saveEditor()}
              >
                {t(busy ? "working" : modal === "create" ? "create" : ["rename", "renameLibrary"].includes(modal) ? "rename" : "save")}
              </Button>
            </>
          ) : undefined}
        >
          {(["create", "rename"].includes(modal) || libraryEditor) && (
            <label className="mc-name-field" htmlFor="mc-design-name">
              <span>{t(libraryEditor ? "libraryName" : "name")}</span>
              <Input
                id="mc-design-name"
                data-modal-autofocus
                disabled={busy}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
                    e.preventDefault();
                    if ((modal !== "rename" && !libraryEditor) || value.trim()) saveEditor();
                  }
                }}
              />
            </label>
          )}
          {modal === "source" && (
            <textarea
              className="mc-code"
              disabled={busy}
              spellCheck={false}
              aria-label={t(modal)}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
          {modal === "history" &&
            project.revisions.map((r) => (
              <div key={r.revision} className="mc-history-row">
                <div className="mc-spacer">
                  <strong>v{r.revision}</strong> · {r.summary}
                  <small>{date(r.created)}</small>
                </div>
                {r.revision === project.head ? (
                  <Tag tone="neutral">{t("current")}</Tag>
                ) : (
                  <Btn
                    disabled={busy || running}
                    onClick={() =>
                      action(async () => {
                        const p = await api("restore", {
                          projectId: selected,
                          revision: r.revision,
                          expectedRevision: project.head,
                        });
                        if (selection.current === selected) { setProject(p); setModal(null); }
                      })
                    }
                  >
                    {t("restore")}
                  </Btn>
                )}
              </div>
            ))}
          {modal === "history" && !project.revisions.length && <p>{t("noHistory")}</p>}
          {modal === "export" && (
            <div className="mc-export-options">
              {["step", "stl", "svg", "pdf", "zip"].map((format) => (
                <Button
                  key={format}
                  variant="outline"
                  icon={<IconDownloadOutlineRegular size={16} />}
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      const result = await api("export", {
                        projectId: selected,
                        revision: project.head,
                        format,
                      });
                      const bytes = Uint8Array.from(
                        atob(result.data),
                        (c) => c.charCodeAt(0),
                      );
                      const url = URL.createObjectURL(
                        new Blob([bytes], { type: result.mediaType }),
                      );
                      const anchor = document.createElement("a");
                      anchor.href = url;
                      anchor.download = result.name;
                      anchor.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    })
                  }
                >
                  {format === "zip"
                    ? t("editable")
                    : format.toUpperCase()}
                </Button>
              ))}
            </div>
          )}
          {modal === "reference" &&
            (reference ? (
              <iframe className="mc-reference" title={reference.name} src={reference.url} />
            ) : (
              <span role="status" className="mc-loading"><StateDot state="ongoing" />{t("loading")}</span>
            ))}
        </WorkbenchDialog>
      )}
      {error && !modal && (
        <div role="alert" className="mc-error mc-panel">
          <div className="mc-error-head">
            <span>{t(error.key)}</span>
            <Btn
              icon={IconCloseOutlineRegular}
              label={t("close")}
              onClick={() => setError(null)}
            />
          </div>
          {error.detail && <ErrorDetails detail={error.detail} t={t} />}
        </div>
      )}
    </div>
  );
}
