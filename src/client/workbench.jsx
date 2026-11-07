import { InspectionPanel, visiblePreview } from "./inspection-panel.jsx";
import React, {
  useCallback,
  useMemo,
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
  IconPlusOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconCloseOutlineRegular,
  IconPanelLeftOutlineRegular,
  IconBranchOutlineRegular,
  IconFlatListOutlineRegular,
  IconCompareSplitOutlineRegular,
  IconRefreshOutlineRegular,
  pointerModality,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { Viewport } from "./viewport.jsx";
import { errorDetail, errorKey } from "../shared/errors.js";
import { ErrorDetails, WorkbenchDialog } from "./workbench-dialog.jsx";
import { DesignNavigator } from "./design-navigator.jsx";
import { ConversationDock } from "./conversation-dock.jsx";
import { SelectionTools } from "./selection-tools.jsx";
import { MakingRecord } from "./making-record.jsx";
import { VersionDiff } from "./version-diff.jsx";
import { VersionLibrary } from "./version-library.jsx";
import { SolidViewIcon, WireframeViewIcon, TransparentViewIcon, SelectGeometryIcon } from "./viewport-tool-icons.jsx";

const Btn = ({ children, icon: Icon, label, className = "", ...props }) => {
  const button = (
    <Button
      variant="ghost"
      size="md"
      icon={Icon && <Icon size={16} />}
      className={`mc-icon-button ${className}`}
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
  locale, t, enter, back, request, addGeometryReference, SessionProvider, renderSlot, retainSession, sessionCatalog, workspaceCatalog, renameConversation,
  contextMenus, shortcutCatalog,
}) {
  const workbench = useRef(null);
  const dock = useRef(null);
  const canvasPress = useRef(null);
  const [statusTarget, setStatusTarget] = useState(null);
  useLayoutEffect(() => {
    enter(workbench.current);
  }, []);
  const language = useSyncExternalStore(
    locale.subscribe,
    locale.getSnapshot,
  ).active;
  const [projects, setProjects] = useState([]),
    [project, setProject] = useState(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [layoutWidth, setLayoutWidth] = useState("wide");
  const narrow = layoutWidth === "narrow";
  useLayoutEffect(() => {
    const element = workbench.current;
    let previous;
    const resize = () => {
      const next = element.clientWidth <= 760 ? "narrow" : element.clientWidth <= 1000 ? "medium" : "wide";
      if (next === previous) return;
      previous = next;
      setLayoutWidth(next);
      if (next === "narrow") setPanelCollapsed(true);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const [picker, setPicker] = useState(null);
  const sessionState = useSyncExternalStore(sessionCatalog.subscribe, sessionCatalog.getSnapshot);
  const workspaceState = useSyncExternalStore(workspaceCatalog.subscribe, workspaceCatalog.getSnapshot);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameDesignId, setRenameDesignId] = useState("");
  const [selected, setSelected] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(null);
  const [busy, setBusy] = useState(false),
    [running, setRunning] = useState(false);
  const [activeTool, setActiveTool] = useState(null);
  const [selecting, setSelecting] = useState(false);
  const [selectionTargets, setSelectionTargets] = useState([]);
  const [selectionInstant, setSelectionInstant] = useState(false);
  const [measurementResult, setMeasurementResult] = useState(null);
  const measurementKey = JSON.stringify([project?.id, project?.modelFile, project?.head]);
  const [hiddenParts, setHiddenParts] = useState([]);
  const [displayMode, setDisplayMode] = useState("solid");
  const [modelMenu, setModelMenu] = useState(false), [appMenu, setAppMenu] = useState(false);
  const wire = displayMode === "wire", transparent = displayMode === "transparent";
  useEffect(() => { setHiddenParts([]); setDisplayMode(mode => mode === "transparent" ? "solid" : mode); }, [measurementKey]);
  useEffect(() => { setSelectionTargets([]); setMeasurementResult(null); }, [hiddenParts]);
  const [resetView, setResetView] = useState(0);
  const [modal, setModal] = useState(null),
    [value, setValue] = useState("");
  const [sessionReference, setSessionReference] = useState(null);
  const [reference, setReference] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false), [transcriptTarget, setTranscriptTarget] = useState(null);
  const [versionLibraryOpen, setVersionLibraryOpen] = useState(false);
  const closeVersionLibrary = useCallback(() => setVersionLibraryOpen(false), []);
  const [diffOpen, setDiffOpen] = useState(false), [diff, setDiff] = useState(null);
  const [progress, setProgress] = useState(null), [processDesign, setProcessDesign] = useState(null);
  const [nativeRunning, setNativeRunning] = useState(false);
  useEffect(() => {
    if (narrow && (historyOpen || versionLibraryOpen || diffOpen)) setPanelCollapsed(true);
  }, [narrow, historyOpen, versionLibraryOpen, diffOpen]);
  useLayoutEffect(() => { setSelectionTargets([]); setMeasurementResult(null); setActiveTool(null); }, [measurementKey, !!processDesign, historyOpen, diffOpen]);
  useEffect(() => { setDiffOpen(false); setDiff(null); }, [project?.id, project?.modelFile]);
  useLayoutEffect(closeVersionLibrary, [closeVersionLibrary, project?.id, project?.modelFile]);
  useEffect(() => {
    if (!selectionTargets.length || (activeTool === "measure" && selectionTargets.length > 2)) setActiveTool(null);
    setMeasurementResult(null);
  }, [selectionTargets, activeTool]);

  const processKey = useRef("");
  useEffect(() => { setProcessDesign(null); processKey.current = ""; }, [project?.id, project?.modelFile]);
  const selection = useRef(""),
    projectRef = useRef(null),
    alive = useRef(true);
  const lastStatusError = useRef("");
  selection.current = selected;
  projectRef.current = project;
  const previewCache = useRef(null), previewRequest = useRef(null);
  const loadController = useRef(new AbortController());
  const showError = (e) => {
    if (e.name === "AbortError" || e.code === "ABORT_ERR") return;
    if (alive.current) setError({ key: e.uiKey || errorKey(e.message || ""), detail: errorDetail(e) });
  };
  const api = async (method, params = {}) => {
    const render = method === "get";
    const controller = loadController.current;
    const data = await request(method, params, render ? controller.signal : undefined);
    return render ? withPreview(data, controller) : data;
  };
  const withPreview = async (data, controller) => {
    const checkCurrent = () => {
      const current = projectRef.current;
      if (controller.signal.aborted || selection.current !== data.id ||
          (current?.id === data.id && current.modelFile === data.modelFile && current.updated > data.updated))
        throw new DOMException("Superseded model preview", "AbortError");
    };
    checkCurrent();
    if (!data.design || !data.head) return data;
    const key = JSON.stringify([data.id, data.modelFile, data.head]);
    try {
      let previewData;
      if (previewCache.current?.key === key) previewData = previewCache.current.data;
      else {
        let pending = previewRequest.current;
        if (!pending || pending.key !== key || pending.signal !== controller.signal) {
          pending = { key, signal: controller.signal };
          pending.promise = request("preview", { projectId: data.id, modelFile: data.modelFile, revision: data.head }, controller.signal);
          previewRequest.current = pending;
        }
        try { previewData = await pending.promise; }
        finally { if (previewRequest.current === pending) previewRequest.current = null; }
        checkCurrent();
        previewCache.current = { key, data: previewData };
      }
      return { ...data, design: { ...data.design, previewData } };
    } catch (error) {
      if (error.name !== "AbortError" && alive.current) {
        checkCurrent();
        setProject(data);
      }
      throw error;
    }
  };
  async function refreshList() {
    const items = await api("list");
    if (alive.current) setProjects(items);
    return items;
  }
  async function createConversation(task = project) {
    await action(async () => {
      await api("new_session", { projectId: task.id });
      setHistoryOpen(false);
      if (selection.current === task.id) setProject(await api("get", { projectId: task.id }));
      else await load(task.id);
      await refreshList();
    });
  }
  async function openConversation(projectId, sessionId) {
    await action(async () => {
      await api("select_session", { projectId, sessionId });
      if (selection.current === projectId) {
        setHistoryOpen(false); setActiveTool(null);
        setProject(await api("get", { projectId }));
      } else await load(projectId);
      await refreshList();
    });
  }
  async function forkConversation(sessionId) {
    const task = projects.find(item => item.sessions.includes(sessionId));
    await action(async () => {
      await api("fork_session", { projectId: task.id, sessionId });
      if (selection.current === task.id) { setHistoryOpen(false); setActiveTool(null); setProject(await api("get", { projectId: task.id })); }
      else await load(task.id);
      await refreshList();
    });
  }
  async function load(id) {
    setHistoryOpen(false); setProgress(null); setProcessDesign(null); processKey.current = "";
    setActiveTool(null);
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
      }
    } catch (e) {
      showError(e);
    } finally {
      if (selection.current === id && controller === loadController.current) setLoading(false);
    }
  }
  function clearSelection() {
    setHistoryOpen(false); setProgress(null); setProcessDesign(null); processKey.current = "";
    setActiveTool(null);
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
        const first = p[0];
        if (!first) { clearSelection(); return; }
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
    if (!project || !workspaceState.archivedSessionIds.includes(project.activeSessionId)) return;
    const next = project.sessions.find(id => !workspaceState.archivedSessionIds.includes(id));
    if (next) openConversation(project.id, next);
    else clearSelection();
  }, [workspaceState.archivedSessionIds, project?.id, project?.activeSessionId]);
  const activeSessionId = project?.activeSessionId;
  const sessionListed = !!sessionState.byId[activeSessionId];
  const sessionCatalogReady = sessionState.phase === "ready";
  useEffect(() => {
    if (!activeSessionId || (!sessionListed && !sessionCatalogReady)) return;
    let reference;
    try { reference = retainSession(activeSessionId); }
    catch (error) { showError(error); return; }
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
  }, [activeSessionId, sessionListed, sessionCatalogReady]);
  useEffect(() => {
    if (!selected) return;
    let disposed = false,
      timer;
    const poll = async () => {
      try {
        const state = await api("status", { projectId: selected });
        if (disposed || selection.current !== selected) return;
        setRunning(state.running);
        setProgress(state.progress || null);
        if (state.projects) setProjects(state.projects);
        if (state.error && state.error !== lastStatusError.current)
          setError({ key: errorKey(state.error), detail: state.errorDetail ?? state.error });
        lastStatusError.current = state.error || "";
        if (state.title && state.title !== projectRef.current?.title) {
          setProject((current) => current ? { ...current, title: state.title } : current);
        }
        if (projectRef.current && (JSON.stringify(state.models) !== JSON.stringify(projectRef.current.models) || state.activeSessionId !== projectRef.current.activeSessionId || state.head !== projectRef.current.head || state.modelVersion !== projectRef.current.modelVersion || state.workspaceDirectory !== projectRef.current.workspaceDirectory || state.modelFile !== projectRef.current.modelFile)) {
          const p = await api("get", { projectId: selected });
          if (!disposed && selection.current === selected) {
            setProject(p);
            refreshList().catch(showError);
          }
        }
        const step = state.progress?.steps.at(-1), current = projectRef.current;
        if (state.running && step && current && state.progress.modelFile === current.modelFile && ["working", "validating"].includes(state.progress.phase)) {
          const key = `${state.progress.id}:${step.sequence}`;
          if (processKey.current !== key) {
            const previewData = await request("checkpoint", { projectId: selected, modelFile: current.modelFile, runId: state.progress.id, sequence: step.sequence }, loadController.current.signal);
            if (!disposed && selection.current === selected && projectRef.current?.modelFile === current.modelFile) {
              processKey.current = key;
              setProcessDesign({ previewData, metrics: step.metrics, parts: step.parts, entities: step.entities, geometryIds: state.progress.geometryIds,
                modelFile: current.modelFile, checkpoint: { runId: state.progress.id, sequence: step.sequence } });
            }
          }
        } else if (!state.running || state.progress?.phase === "done") {
          processKey.current = ""; setProcessDesign(null);
        }
        timer = setTimeout(poll, state.running ? 500 : 3500);
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
  function selectRevision(revision) {
    if (running || nativeRunning || revision === project.head) return;
    const captured = project, controller = loadController.current;
    return action(async () => {
      const data = await api("restore", {
        projectId: captured.id, modelFile: captured.modelFile,
        revision, expectedRevision: captured.head,
      });
      if (controller.signal.aborted || selection.current !== captured.id || projectRef.current?.modelFile !== captured.modelFile) return;
      controller.abort();
      const next = new AbortController();
      loadController.current = next;
      dismissVersionLibrary();
      setHistoryOpen(false); setDiffOpen(false);
      setProgress(null); setProcessDesign(null); processKey.current = "";
      setProject(await withPreview(data, next));
      await refreshList();
    });
  }
  function selectModelFile(modelFile) {
    if (busy || running || nativeRunning || modelFile === project.modelFile) return;
    const captured = project, controller = loadController.current;
    return action(async () => {
      const data = await api("select_model", { projectId: captured.id, modelFile });
      if (controller.signal.aborted || selection.current !== captured.id) return;
      controller.abort();
      const next = new AbortController();
      loadController.current = next;
      setProgress(null); setProcessDesign(null); processKey.current = "";
      setProject(await withPreview(data, next));
    });
  }
  function dismissVersionLibrary() {
    closeVersionLibrary();
    workbench.current?.querySelector(".mc-header-version")?.focus();
  }
  function clearGeometrySelection() {
    if (busy) return;
    setSelectionTargets([]); setActiveTool(null); setMeasurementResult(null);
  }
  function pickGeometry(target, extend) {
    if (busy) return;
    setSelectionInstant(extend);
    setSelectionTargets(current => {
      if (!target) return [];
      if (!extend) return [target];
      return current.some(item => item.reference === target.reference)
        ? current.filter(item => item.reference !== target.reference) : [...current, target];
    });
  }
  function selectTool(tool) { setError(null); setActiveTool(tool); }
  async function addSelectedReferences({ note }) {
    const captured = { targets: selectionTargets, projectId: selected,
      modelFile: project.modelFile, expectedRevision: project.head, sessionId: project.activeSessionId };
    const currentContext = () => alive.current && selection.current === captured.projectId
      && projectRef.current?.modelFile === captured.modelFile && projectRef.current?.activeSessionId === captured.sessionId;
    await action(async () => {
      const args = { projectId: captured.projectId, modelFile: captured.modelFile, expectedRevision: captured.expectedRevision };
      const { items } = await api("geometry_annotation", { ...args, references: captured.targets.map(target => target.reference), note });
      if (!currentContext() || projectRef.current.head !== captured.expectedRevision) return;
      if (!addGeometryReference(captured.sessionId, items)) throw Object.assign(new Error(t("referenceInputBusy")), { uiKey: "referenceInputBusy" });
      dock.current?.reveal();
      setActiveTool(null);
    });
  }
  function openReference(id, projectId = selected) {
    if (selection.current !== projectId) return;
    setReference({ name: project?.attachments.find((item) => item.id === id)?.name || t("pdfPreview"), url: "/api/minicad/reference?" + new URLSearchParams({ projectId, attachmentId: id }) });
    setModal("reference");
  }
  async function saveDesignName() {
    await action(async () => {
      const id = renameDesignId || selected;
      await api("rename", { projectId: id, title: value });
      await refreshList();
      if (selection.current === id) setProject(await api("get", { projectId: id }));
      setModal(null);
    });
  }
  const design = project?.design;
  const modelSwitchDisabled = busy || running || nativeRunning || diffOpen || historyOpen || versionLibraryOpen || !!processDesign;
  const selectionActive = selecting && !!project && !modal && !processDesign && !historyOpen && !versionLibraryOpen && !diffOpen && !appMenu;
  const pickingActive = selectionActive && !modelMenu;
  const hasAssemblyParts = design?.parts?.length > 1;
  const hasModelChoices = project?.models.length > 1;
  const inspectionVisible = selectionActive && (hasAssemblyParts || hasModelChoices);
  const displayModes = diffOpen ? ["solid", "wire"] : ["solid", "wire", "transparent"];
  const currentDisplayMode = diffOpen && transparent ? "solid" : displayMode;
  const nextDisplayMode = displayModes[(displayModes.indexOf(currentDisplayMode) + 1) % displayModes.length];
  const modeLabel = mode => t(mode === "transparent" ? "transparentView" : mode);
  const originalDesign = diffOpen ? design : processDesign || design;
  const displayedDesign = useMemo(() => originalDesign && ({ ...originalDesign,
    previewData: visiblePreview(originalDesign.previewData, originalDesign.parts, diffOpen ? [] : hiddenParts) }), [originalDesign, hiddenParts, diffOpen]);
  const displayedDiff = diffOpen && diff?.projectId === project?.id && diff?.modelFile === project?.modelFile ? diff : null;
  return (
    <div
      ref={workbench}
      className="mc-workbench"
      data-layout-width={layoutWidth}
      data-project-panel-collapsed={panelCollapsed || undefined}
      data-record-open={historyOpen || undefined}
      data-version-library-open={versionLibraryOpen || undefined}
      data-native-dialog-open={!!renameTarget || !!picker || undefined}
      lang={language === "zh" ? "zh" : "en"}
      tabIndex={-1}
      onPointerDownCapture={event => {
        canvasPress.current = event.isPrimary && event.button === 0 && event.target.matches("#mc-view-model-panel > canvas")
          ? { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false } : null;
      }}
      onPointerMoveCapture={event => {
        const press = canvasPress.current;
        if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) press.moved = true;
      }}
      onPointerCancelCapture={() => { canvasPress.current = null; }}
      onPointerDown={event => {
        if (event.target.matches("#mc-view-model-panel > canvas")) {
          workbench.current?.focus({ preventScroll: true });
        }
      }}
      onClick={event => {
        const press = canvasPress.current;
        if (!event.defaultPrevented && event.detail === 1 && press && !press.moved
          && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 4
          && event.target.matches("#mc-view-model-panel > canvas")) dock.current?.dismiss();
      }}
      onDoubleClick={event => {
        if (!historyOpen && event.target.matches("#mc-view-model-panel > canvas")) {
          event.preventDefault(); dock.current?.reveal({ x: event.clientX, y: event.clientY });
        }
      }}
      onKeyDown={event => {
        if (versionLibraryOpen && event.key === "Escape" && !event.defaultPrevented
          && !event.target.closest('[role="dialog"],[role="menu"]')) {
          event.preventDefault();
          dismissVersionLibrary();
          return;
        }
        dock.current?.keyDown(event);
        if (event.defaultPrevented) return;
        if (historyOpen && event.key === "Escape" && !event.defaultPrevented && !event.target.closest('[role="dialog"],[role="menu"]')) { event.preventDefault(); setHistoryOpen(false); }
        else if (diffOpen && event.key === "Escape" && !event.defaultPrevented && !event.target.closest('[role="dialog"],[role="menu"]')) { event.preventDefault(); setDiffOpen(false); }
        else if (event.key === "Escape" && selecting && !busy && !event.defaultPrevented && !event.isComposing && !event.target.closest('[role="dialog"],[role="menu"]')) {
          event.preventDefault(); setSelectionInstant(true); clearGeometrySelection(); setSelecting(false);
        }
      }}
    >
      <Viewport
        id="mc-view-model-panel"
        active={!historyOpen && !versionLibraryOpen}
        sidebarCollapsed={panelCollapsed}
        design={displayedDesign}
        diff={displayedDiff}
        wire={wire}
        transparent={!diffOpen && transparent}
        selecting={pickingActive}
        targets={selectionTargets}
        selectionInstant={selectionInstant}
        pickingDisabled={busy || versionLibraryOpen}
        measurementResult={pickingActive && activeTool === "measure" && selectionTargets.length === 2 ? measurementResult : null}
        onPick={pickGeometry}
        selectionTools={project && <SelectionTools targets={selectionTargets} tool={pickingActive ? activeTool : null}
          onToolChange={selectTool} onClear={clearGeometrySelection}
          onRemove={reference => { if (!busy) setSelectionTargets(current => current.filter(target => target.reference !== reference)); }}
          referenceDisabled={busy || !sessionReference || sessionReference.sessionId !== project.activeSessionId}
          busy={busy} error={error} project={project} request={request} onResult={setMeasurementResult} onReference={addSelectedReferences} t={t} />}
        resetToken={resetView}
        t={t}
        onError={() => setError({ key: "webglError" })}
      />
      <header className="mc-header">
        <div className="mc-header-app mc-panel">
          <Btn
            icon={IconChevronLeftOutlineRegular}
            label={t("back")}
            disabled={busy}
            onClick={() => action(() => back(workbench.current))}
          />
          <Btn className="mc-library-toggle" icon={IconPanelLeftOutlineRegular}
            label={t(panelCollapsed ? "expandProjects" : "collapseProjects")}
            aria-expanded={!panelCollapsed} aria-controls="mc-design-library"
            onClick={() => {
              if (narrow && panelCollapsed) { setHistoryOpen(false); closeVersionLibrary(); setDiffOpen(false); }
              setPanelCollapsed(value => !value);
            }} />
          <div className="mc-header-document">
            <span className="mc-crumb" title={project?.title || t("app")}>
              {project?.title || t("app")}
            </span>
            {project?.head > 0 && <Btn className="mc-header-version" icon={IconBranchOutlineRegular}
              label={`${t("versionLibrary")} · ${t("current")} v${project.head}`}
              aria-expanded={versionLibraryOpen} aria-controls={versionLibraryOpen ? "mc-version-library" : undefined}
              onClick={() => { setHistoryOpen(false); setDiffOpen(false); setVersionLibraryOpen(value => !value); }} />}
          </div>
        </div>
        <div ref={setStatusTarget} className="mc-header-status" />
        <nav className="mc-header-actions mc-panel" aria-label={t("workbenchTools")}>
          <div className="mc-header-action-group">
            <Btn icon={IconRefreshOutlineRegular} label={t("resetView")} disabled={historyOpen} onClick={() => setResetView(value => value + 1)} />
            <Btn icon={currentDisplayMode === "wire" ? WireframeViewIcon : currentDisplayMode === "transparent" ? TransparentViewIcon : SolidViewIcon}
              label={`${t("displayMode")} · ${modeLabel(currentDisplayMode)}`}
              aria-label={t("switchDisplayMode", { mode: modeLabel(nextDisplayMode) })}
              disabled={historyOpen} onClick={() => setDisplayMode(nextDisplayMode)} />
            <Btn icon={SelectGeometryIcon} label={t("selectGeometry")} aria-pressed={selectionActive}
              aria-expanded={hasAssemblyParts || hasModelChoices ? inspectionVisible : undefined} aria-controls={inspectionVisible ? "mc-model-inspection" : undefined}
              disabled={!project || !!processDesign || busy || diffOpen || historyOpen || versionLibraryOpen}
              onClick={() => { clearGeometrySelection(); setSelectionInstant(false); setSelecting(value => !value); }} />
          </div>
          <div className="mc-header-action-group">
            <Btn icon={IconCompareSplitOutlineRegular} label={t("compareVersion")} disabled={!project || project.revisions.length < 2} aria-pressed={diffOpen}
              onClick={() => { closeVersionLibrary(); setHistoryOpen(false); setDiffOpen(value => !value); }} />
            <Btn icon={IconFlatListOutlineRegular} label={t("makingRecord")} disabled={!project} aria-pressed={historyOpen}
              onClick={() => { closeVersionLibrary(); setDiffOpen(false); setHistoryOpen(value => !value); }} />
          </div>
          {project && renderSlot("minicad.directoryActions", { absolutePath: project.workspaceDirectory,
            projectId: project.id, modelFile: project.modelFile, hasModel: project.head > 0, onMenuOpenChange: setAppMenu })}
        </nav>
      </header>
      <aside id="mc-design-library" className="mc-sidebar mc-panel" aria-label={t("projects")}
        aria-hidden={panelCollapsed} inert={panelCollapsed ? "" : undefined} data-instant={!pointerModality() || undefined}>
          <DesignNavigator projects={projects} selected={selected} currentSessionId={project?.activeSessionId} language={language} t={t}
            sessionState={sessionState} workspaceState={workspaceState} renderTaskSlot={renderSlot}
            contextMenus={contextMenus} shortcutCatalog={shortcutCatalog}
            onRenameSession={(sessionId, currentTitle) => setRenameTarget({ sessionId, currentTitle })} onForkSession={forkConversation}
            pickerBusy={!!picker || busy}
            onCreate={() => { if (!busy) { setError(null); setPicker({ type: "open" }); } }}
            onRename={task => { setError(null); setRenameDesignId(task.id); setValue(task.title); setModal("rename"); }}
            onFork={task => { setError(null); setPicker({ type: "saveAs", project: task }); }}
            onNewSession={createConversation}
            onRemove={async task => {
              await api("close_design", { projectId: task.id });
              const items = await refreshList();
              if (selection.current === task.id) { if (items[0]) await load(items[0].id); else clearSelection(); }
            }}
            onOpen={(...args) => { if (narrow) setPanelCollapsed(true); return openConversation(...args); }} attachments={project?.attachments || []} onReference={openReference} />
      </aside>
      {renderSlot("minicad.directoryFlow", {
        open: !!picker, busy,
        onPicked: async path => {
          const captured = picker;
          await action(async () => {
            const design = captured.type === "saveAs"
              ? await api("fork_project", { projectId: captured.project.id, path })
              : await api("open_design", { path });
            await refreshList(); await load(design.id);
          });
          setPicker(null);
        },
        onCancel: () => setPicker(null),
        onError: message => { setPicker(null); showError(new Error(message)); },
      })}
      {loading && (
        <div className="mc-empty">
          <span role="status" className="mc-loading"><StateDot state="ongoing" />{t("loading")}</span>
        </div>
      )}
      {inspectionVisible && <InspectionPanel key={measurementKey} project={project} parts={design?.parts}
        hidden={hiddenParts} setHidden={setHiddenParts}
        busy={modelSwitchDisabled} onModel={selectModelFile} onMenuOpenChange={setModelMenu}
        onClose={() => { clearGeometrySelection(); setSelecting(false); }} t={t} />}
      {diffOpen && project && <VersionDiff key={`${project.id}:${project.modelFile}`} project={project} request={request}
        onResult={setDiff} onClose={() => setDiffOpen(false)} t={t} language={language} />}
      {historyOpen && project && <MakingRecord key={`${project.id}:${project.modelFile}`} project={project} progress={progress}
        request={request} t={t} language={language}
        onClose={() => setHistoryOpen(false)} onTranscriptTarget={setTranscriptTarget} />}
      {versionLibraryOpen && project?.head > 0 && <VersionLibrary key={`${project.id}:${project.modelFile}`} project={project}
        request={request} language={language} disabled={busy || running || nativeRunning}
        onClose={dismissVersionLibrary} onSelect={selectRevision} t={t} />}
      <ConversationDock key={project?.activeSessionId || "none"} ref={dock} t={t} hidden={historyOpen || versionLibraryOpen}
        running={running} statusTarget={statusTarget} revision={project?.head || 0} latestRevision={project?.revisions[0]?.revision || 0}
        onRecord={() => { closeVersionLibrary(); setDiffOpen(false); setHistoryOpen(true); }}
        onStart={() => setError(null)}
        onCancel={() => action(() => api("cancel", { projectId: selected }))} onRunning={setNativeRunning}>
        {callbacks => <>
        {sessionReference && project && sessionReference.sessionId === project.activeSessionId ? (
          <SessionProvider session={sessionReference}>
            {renderSlot("minicad.composer", { ...callbacks, transcriptTarget })}
          </SessionProvider>
        ) : selected || loading ? <span role="status" className="mc-loading mc-muted"><StateDot state="ongoing" />{t("loading")}</span> : (
          <Btn icon={IconPlusOutlineRegular} onClick={() => setPicker({ type: "open" })}>{t("openDesignFolder")}</Btn>
        )}
        </>}
      </ConversationDock>
      {renderSlot("minicad.session.renameDialog", { renameTarget, onSettleRename: () => setRenameTarget(null),
        onRenameSession: renameConversation })}
      {modal && (
        <WorkbenchDialog
          key={modal}
          title={t(modal === "reference" ? "pdfPreview" : modal === "rename" ? "renameDesign" : modal)}
          className={modal === "reference" ? "mc-wide" : ""}
          busy={busy}
          error={error}
          onClose={() => setModal(null)}
          t={t}
          footer={modal === "rename" ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setModal(null)}>
                {t("cancel")}
              </Button>
              <Button
                variant="primary"
                disabled={busy || !value.trim()}
                icon={busy ? <StateDot state="ongoing" /> : undefined}
                onClick={saveDesignName}
              >
                {t(busy ? "working" : "rename")}
              </Button>
            </>
          ) : undefined}
        >
          {modal === "rename" && (
            <label className="mc-name-field" htmlFor="mc-design-name">
              <span>{t("name")}</span>
              <Input
                id="mc-design-name"
                data-modal-autofocus
                disabled={busy}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
                    e.preventDefault();
                    if (value.trim()) saveDesignName();
                  }
                }}
              />
            </label>
          )}
          {modal === "reference" &&
            (reference ? (
              <iframe className="mc-reference" title={reference.name} src={reference.url} />
            ) : (
              <span role="status" className="mc-loading"><StateDot state="ongoing" />{t("loading")}</span>
            ))}
        </WorkbenchDialog>
      )}
      {error && !modal && !activeTool && (
        <div role="alert" className="mc-error mc-panel">
          <div className="mc-error-head">
            <span>{t(error.key)}</span>
            <Btn
              icon={IconCloseOutlineRegular}
              aria-label={t("close")}
              onClick={() => setError(null)}
            />
          </div>
          {error.detail && <ErrorDetails detail={error.detail} t={t} />}
        </div>
      )}
    </div>
  );
}
