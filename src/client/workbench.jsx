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
  IconNewChatOutlineRegular,
  IconFlatListOutlineRegular,
  IconCompareSplitOutlineRegular,
  IconRefreshOutlineRegular,
  IconSlidersTwoOutlineRegular,
  pointerModality,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { Viewport } from "./viewport.jsx";
import { errorDetail, errorKey } from "../shared/errors.js";
import { ErrorDetails, WorkbenchDialog } from "./workbench-dialog.jsx";
import { DesignNavigator } from "./design-navigator.jsx";
import { ConversationDock } from "./conversation-dock.jsx";
import { SelectionTools } from "./selection-tools.jsx";
import { VersionDiff } from "./version-diff.jsx";
import { VersionLibrary } from "./version-library.jsx";
import { Timelapse } from "./timelapse.jsx";
import { revisionPath } from "./revision-path.js";
import { SolidViewIcon, WireframeViewIcon, TransparentViewIcon, SelectGeometryIcon, SectionViewIcon, InstrumentIcon } from "./viewport-tool-icons.jsx";
import { ViewPanel } from "./view-panel.jsx";
import { ParameterPanel } from "./parameter-panel.jsx";
import { InstrumentPanel } from "./instrument-panel.jsx";
import { analyze, strike, playVoice, noteName, encodeMidi } from "./instrument.js";
import { downloadBlob } from "./download.js";

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
  locale, t, enter, back, request, addGeometryReference, focusComposer, SessionProvider, renderSlot, retainSession, sessionCatalog, workspaceCatalog, renameConversation,
  contextMenus, shortcutCatalog,
}) {
  const workbench = useRef(null);
  const dock = useRef(null);
  const canvasPress = useRef(null);
  const initialProject = useRef(null);
  const [statusTarget, setStatusTarget] = useState(null);
  useLayoutEffect(() => {
    initialProject.current = enter(workbench.current);
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
  const [viewOpen, setViewOpen] = useState(false);
  const [section, setSection] = useState({ axis: null, position: 0.5, flip: false });
  const [explode, setExplode] = useState(0);
  const [explodeAxis, setExplodeAxis] = useState("radial");
  const [timelapseOpen, setTimelapseOpen] = useState(false);
  const [timelapseFrames, setTimelapseFrames] = useState([]);
  const [timelapseIndex, setTimelapseIndex] = useState(0);
  const [timelapseLoading, setTimelapseLoading] = useState(false);
  const [timelapseError, setTimelapseError] = useState(null);
  const [timelapseTarget, setTimelapseTarget] = useState(null);
  const [libraryInitial, setLibraryInitial] = useState(null);
  const [instrumentOpen, setInstrumentOpen] = useState(false);
  const [instrumentRecording, setInstrumentRecording] = useState(false);
  const [instrumentEvents, setInstrumentEvents] = useState([]);
  const [instrumentNote, setInstrumentNote] = useState(null);
  const [restrikeIndex, setRestrikeIndex] = useState(null);
  const timelapseRequest = useRef(null);
  const instrumentStart = useRef(0);
  const [modelMenu, setModelMenu] = useState(false), [appMenu, setAppMenu] = useState(false);
  const wire = displayMode === "wire", transparent = displayMode === "transparent";
  useEffect(() => { setHiddenParts([]); setDisplayMode(mode => mode === "transparent" ? "solid" : mode); }, [measurementKey]);
  useEffect(() => { setViewOpen(false); setSection({ axis: null, position: 0.5, flip: false }); setExplode(0); setExplodeAxis("radial"); setInstrumentOpen(false); setInstrumentRecording(false); setInstrumentEvents([]); setInstrumentNote(null); setRestrikeIndex(null); }, [project?.id, project?.modelFile]);
  useEffect(() => { closeTimelapse(); }, [project?.id, project?.modelFile, project?.head]);
  useEffect(() => { setSelectionTargets([]); setMeasurementResult(null); }, [hiddenParts]);
  const [resetView, setResetView] = useState(0);
  const [modal, setModal] = useState(null),
    [value, setValue] = useState("");
  const [sessionReference, setSessionReference] = useState(null);
  const [reference, setReference] = useState(null);
  const [versionLibraryOpen, setVersionLibraryOpen] = useState(false);
  const [libraryDesign, setLibraryDesign] = useState(null);
  const [recordOpen, setRecordOpen] = useState(false), [recordHost, setRecordHost] = useState(null);
  const recordNeedsRoom = recordOpen && layoutWidth !== "wide";
  const sidebarCollapsed = panelCollapsed || recordNeedsRoom;
  const closeSessionRecord = useCallback(() => {
    setRecordOpen(false);
    workbench.current?.querySelector(".mc-session-record-toggle")?.focus({ preventScroll: true });
  }, []);
  const openSessionRecord = () => {
    setInstrumentOpen(false); closeTimelapse(); setViewOpen(false); setVersionLibraryOpen(false); setDiffOpen(false);
    setRecordOpen(true);
  };
  const closeVersionLibrary = useCallback(() => { setVersionLibraryOpen(false); setLibraryDesign(null); setLibraryInitial(null); }, []);
  const [diffOpen, setDiffOpen] = useState(false), [diff, setDiff] = useState(null);
  const [progress, setProgress] = useState(null), [processDesign, setProcessDesign] = useState(null);
  const [operationActor, setOperationActor] = useState(null), [userOperation, setUserOperation] = useState(null);
  useEffect(() => { setUserOperation(null); setOperationActor(null); }, [project?.id, project?.modelFile, project?.activeSessionId]);
  const [parameterPanelOpen, setParameterPanelOpen] = useState(false);
  useEffect(() => { setParameterPanelOpen(false); }, [project?.id, project?.modelFile, project?.parameterPanel?.id]);
  const [nativeRunning, setNativeRunning] = useState(false);
  useEffect(() => { if (operationActor === "agent" || nativeRunning) setUserOperation(null); }, [operationActor, nativeRunning]);
  useEffect(() => {
    if (narrow && (versionLibraryOpen || diffOpen)) setPanelCollapsed(true);
  }, [narrow, versionLibraryOpen, diffOpen]);
  useLayoutEffect(() => { setSelectionTargets([]); setMeasurementResult(null); setActiveTool(null); }, [measurementKey, !!processDesign, versionLibraryOpen, diffOpen]);
  useEffect(() => { setDiffOpen(false); setDiff(null); }, [project?.id, project?.modelFile]);
  useLayoutEffect(closeVersionLibrary, [closeVersionLibrary, project?.id, project?.modelFile]);
  useLayoutEffect(() => { setRecordOpen(false); }, [project?.id, project?.activeSessionId, project?.modelFile]);
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
      if (selection.current === task.id) setProject(await api("get", { projectId: task.id }));
      else await load(task.id);
      await refreshList();
    });
  }
  async function openConversation(projectId, sessionId) {
    await action(async () => {
      await api("select_session", { projectId, sessionId });
      if (selection.current === projectId) {
        setActiveTool(null);
        setProject(await api("get", { projectId }));
      } else await load(projectId);
      await refreshList();
    });
  }
  async function forkConversation(sessionId) {
    const task = projects.find(item => item.sessions.includes(sessionId));
    await action(async () => {
      await api("fork_session", { projectId: task.id, sessionId });
      if (selection.current === task.id) { setActiveTool(null); setProject(await api("get", { projectId: task.id })); }
      else await load(task.id);
      await refreshList();
    });
  }
  async function load(id) {
    setProgress(null); setProcessDesign(null); processKey.current = "";
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
    setProgress(null); setProcessDesign(null); processKey.current = "";
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
        const first = p.find(item => item.id === initialProject.current) || p[0];
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
        setOperationActor(state.operationActor);
        setProgress(state.progress || null);
        if (state.projects) setProjects(state.projects);
        if (state.error && state.error !== lastStatusError.current)
          setError({ key: errorKey(state.errorDetail?.zh ?? state.error), detail: state.errorDetail ?? state.error });
        lastStatusError.current = state.error || "";
        if (state.title && state.title !== projectRef.current?.title) {
          setProject((current) => current ? { ...current, title: state.title } : current);
        }
        if (projectRef.current && (state.parameterPanelId !== (projectRef.current.parameterPanel?.id || null) || JSON.stringify(state.models) !== JSON.stringify(projectRef.current.models) || state.activeSessionId !== projectRef.current.activeSessionId || state.head !== projectRef.current.head || state.modelVersion !== projectRef.current.modelVersion || state.workspaceDirectory !== projectRef.current.workspaceDirectory || state.modelFile !== projectRef.current.modelFile)) {
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
      setDiffOpen(false);
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
  function toggleViewPanel() {
    if (busy) return;
    const next = !viewOpen;
    setViewOpen(next);
    if (next) { setInstrumentOpen(false); closeTimelapse(); setSelecting(false); clearGeometrySelection(); }
  }
  // Sound the part at the clicked surface point from its mass distribution.
  function toggleInstrument() {
    if (busy) return;
    const next = !instrumentOpen;
    setInstrumentOpen(next);
    if (next) {
      setSelecting(false);
      clearGeometrySelection();
      setViewOpen(false);
      setRecordOpen(false);
    } else { setInstrumentRecording(false); setRestrikeIndex(null); }
  }
  function handleStrike(hit) {
    if (busy) return;
    const preview = displayedDesign?.previewData;
    if (!preview) return;
    const analysis = analyze(preview, displayedDesign?.parts);
    if (!analysis) return;
    const voice = strike(analysis, hit);
    playVoice(voice);
    setInstrumentNote({ name: noteName(voice.midi), part: voice.partName });
    if (restrikeIndex !== null) {
      setInstrumentEvents(events => events.map((event, index) => index === restrikeIndex ? {
        ...event, midi: voice.midi, velocity: voice.velocity, duration: voice.decay * 1000, point: hit.point,
      } : event));
      setRestrikeIndex(null);
      return;
    }
    if (instrumentRecording) {
      const at = Math.max(0, performance.now() - instrumentStart.current);
      setInstrumentEvents(events => [...events, {
        at, midi: voice.midi, velocity: voice.velocity, duration: voice.decay * 1000, point: hit.point,
      }]);
    }
  }
  function deleteInstrumentEvent(position) {
    setInstrumentEvents(events => events.filter((_, index) => index !== position));
    setRestrikeIndex(current => {
      if (current === null) return null;
      if (current === position) return null;
      return current > position ? current - 1 : current;
    });
  }
  function restrikeInstrumentEvent(position) {
    setRestrikeIndex(current => current === position ? null : position);
  }
  function clearInstrumentEvents() {
    setInstrumentEvents([]);
    setRestrikeIndex(null);
    if (instrumentRecording) instrumentStart.current = performance.now();
  }
  function toggleInstrumentRecording() {
    if (instrumentRecording) { setInstrumentRecording(false); setRestrikeIndex(null); return; }
    instrumentStart.current = performance.now();
    setInstrumentEvents([]);
    setRestrikeIndex(null);
    setInstrumentRecording(true);
  }
  function exportInstrumentMidi() {
    if (!instrumentEvents.length) return;
    const base = String(project?.title || "minicad").replace(/[\\/:*?"<>|]+/g, "_").trim() || "minicad";
    downloadBlob(new Blob([encodeMidi(instrumentEvents, { tempo: 120 })], { type: "audio/midi" }), `${base}-instrument.mid`);
  }
  // Fixed-camera playback along the parent chain from the root to the selected version.
  async function openTimelapse(targetRevision) {
    if (!project) return;
    const path = revisionPath(project.revisions, targetRevision ?? project.head);
    if (!path.length) return;
    closeTimelapse();
    const controller = new AbortController();
    timelapseRequest.current = controller;
    setViewOpen(false);
    setVersionLibraryOpen(false);
    setLibraryDesign(null);
    setDiffOpen(false);
    setRecordOpen(false);
    setSelecting(false);
    setInstrumentOpen(false);
    clearGeometrySelection();
    setSection(current => ({ ...current, axis: null }));
    setExplode(0);
    setTimelapseOpen(true);
    setTimelapseLoading(true);
    setTimelapseTarget(path.at(-1).revision);
    const captured = { id: project.id, modelFile: project.modelFile };
    try {
      const frames = [];
      for (const entry of path) {
        const previewData = await request("preview", {
          projectId: captured.id, modelFile: captured.modelFile, revision: entry.revision,
        }, controller.signal);
        frames.push({ revision: entry.revision, summary: entry.summary, previewData });
      }
      if (controller.signal.aborted || selection.current !== captured.id) return;
      setTimelapseFrames(frames);
      setTimelapseIndex(0);
    } catch (loadError) {
      if (!controller.signal.aborted && loadError.name !== "AbortError")
        setTimelapseError(errorDetail(loadError));
    } finally {
      if (!controller.signal.aborted) setTimelapseLoading(false);
    }
  }
  function closeTimelapse() {
    timelapseRequest.current?.abort();
    timelapseRequest.current = null;
    setTimelapseOpen(false);
    setTimelapseFrames([]);
    setTimelapseIndex(0);
    setTimelapseLoading(false);
    setTimelapseError(null);
  }
  function backToVersionLibrary() {
    const target = timelapseTarget;
    closeTimelapse();
    setLibraryInitial(target ?? project?.head ?? null);
    setVersionLibraryOpen(true);
  }
  function changeSection(patch) {
    setSection(current => ({ ...current, ...patch }));
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
  const modelSwitchDisabled = busy || running || nativeRunning || diffOpen || versionLibraryOpen || !!processDesign;
  const selectionActive = selecting && !!project && !modal && !processDesign && !versionLibraryOpen && !diffOpen && !appMenu;
  const pickingActive = selectionActive && !modelMenu;
  const hasAssemblyParts = design?.parts?.length > 1;
  const hasModelChoices = project?.models.length > 1;
  const inspectionVisible = selectionActive && (hasAssemblyParts || hasModelChoices);
  const displayModes = diffOpen ? ["solid", "wire"] : ["solid", "wire", "transparent"];
  const currentDisplayMode = diffOpen && transparent ? "solid" : displayMode;
  const nextDisplayMode = displayModes[(displayModes.indexOf(currentDisplayMode) + 1) % displayModes.length];
  const modeLabel = mode => t(mode === "transparent" ? "transparentView" : mode);
  const timelapseFrame = timelapseOpen ? timelapseFrames[timelapseIndex] || null : null;
  const timelapseDesign = useMemo(() => timelapseFrame ? {
    modelFile: project?.modelFile,
    revision: timelapseFrame.revision,
    previewData: timelapseFrame.previewData,
  } : null, [timelapseFrame, project?.modelFile]);
  const originalDesign = timelapseOpen ? timelapseDesign || design : versionLibraryOpen ? libraryDesign : diffOpen ? design : processDesign || design;
  const displayedDesign = useMemo(() => originalDesign && ({ ...originalDesign,
    previewData: visiblePreview(originalDesign.previewData, originalDesign.parts, diffOpen || versionLibraryOpen ? [] : hiddenParts) }), [originalDesign, hiddenParts, diffOpen, versionLibraryOpen]);
  const viewExtent = useMemo(() => {
    const positions = displayedDesign?.previewData?.positions;
    if (!positions?.length) return null;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let index = 0; index < positions.length; index += 3)
      for (let axis = 0; axis < 3; axis++) {
        const value = positions[index + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    return { min, max };
  }, [displayedDesign?.previewData]);
  const timelapseBounds = useMemo(() => {
    if (!timelapseOpen || !timelapseFrames.length) return null;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const frame of timelapseFrames) {
      const positions = frame.previewData?.positions;
      if (!positions) continue;
      for (let index = 0; index < positions.length; index += 3)
        for (let axis = 0; axis < 3; axis++) {
          const value = positions[index + axis];
          if (value < min[axis]) min[axis] = value;
          if (value > max[axis]) max[axis] = value;
        }
    }
    return Number.isFinite(min[0]) ? { min, max } : null;
  }, [timelapseOpen, timelapseFrames]);
  const instrumentMarks = useMemo(() => instrumentRecording
    ? instrumentEvents.map((event, index) => ({
        index: index + 1, position: index, note: noteName(event.midi), point: event.point, armed: index === restrikeIndex,
      }))
    : [], [instrumentRecording, instrumentEvents, restrikeIndex]);
  const displayedDiff = diffOpen && diff?.projectId === project?.id && diff?.modelFile === project?.modelFile ? diff : null;
  const parameterPanelVisible = parameterPanelOpen && !!project?.parameterPanel && !viewOpen && !instrumentOpen && !timelapseOpen && !diffOpen && !versionLibraryOpen && !selecting && !recordOpen;
  return (
    <div
      ref={workbench}
      className="mc-workbench"
      data-layout-width={layoutWidth}
      data-project-panel-collapsed={sidebarCollapsed || undefined}
      data-version-library-open={versionLibraryOpen || undefined}
      data-session-record-open={recordOpen || undefined}
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
        if (!versionLibraryOpen && event.target.matches("#mc-view-model-panel > canvas")) {
          event.preventDefault(); dock.current?.reveal({ x: event.clientX, y: event.clientY });
        }
      }}
      onKeyDown={event => {
        if (recordOpen && event.key === "Escape" && !event.defaultPrevented && !event.isComposing
          && !event.target.closest('input,textarea,[contenteditable="true"],[role="dialog"],[role="menu"],[data-trigger-menu]')) {
          event.preventDefault(); closeSessionRecord(); return;
        }
        if (versionLibraryOpen && event.key === "Escape" && !event.defaultPrevented
          && !event.target.closest('[role="dialog"],[role="menu"]')) {
          event.preventDefault();
          dismissVersionLibrary();
          return;
        }
        dock.current?.keyDown(event);
        if (event.defaultPrevented) return;
        if (diffOpen && event.key === "Escape" && !event.defaultPrevented && !event.target.closest('[role="dialog"],[role="menu"]')) { event.preventDefault(); setDiffOpen(false); }
        else if (event.key === "Escape" && selecting && !busy && !event.defaultPrevented && !event.isComposing && !event.target.closest('[role="dialog"],[role="menu"]')) {
          event.preventDefault(); setSelectionInstant(true); clearGeometrySelection(); setSelecting(false);
        }
        else if (timelapseOpen && event.key === "Escape" && !event.isComposing
          && !event.target.closest('input,textarea,[contenteditable="true"],[role="dialog"],[role="menu"]')) {
          event.preventDefault(); closeTimelapse();
        }
        else if (instrumentOpen && event.key === "Escape" && !event.isComposing
          && !event.target.closest('input,textarea,[contenteditable="true"],[role="dialog"],[role="menu"]')) {
          event.preventDefault(); setInstrumentOpen(false); setInstrumentRecording(false); setRestrikeIndex(null);
        }
      }}
    >
      <Viewport
        id="mc-view-model-panel"
        historyOpen={versionLibraryOpen}
        sidebarCollapsed={sidebarCollapsed}
        design={displayedDesign}
        diff={displayedDiff}
        wire={wire}
        transparent={!diffOpen && transparent}
        section={section.axis ? section : null}
        explode={explode}
        explodeAxis={explodeAxis}
        followPreview={!timelapseOpen}
        fitBounds={timelapseOpen ? timelapseBounds : null}
        striking={instrumentOpen}
        onStrike={handleStrike}
        marks={instrumentMarks}
        onMarkDelete={deleteInstrumentEvent}
        onMarkRestrike={restrikeInstrumentEvent}
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
            label={t(sidebarCollapsed ? "expandProjects" : "collapseProjects")}
            aria-expanded={!sidebarCollapsed} aria-controls="mc-design-library"
            onClick={() => {
              if ((narrow || recordNeedsRoom) && sidebarCollapsed) { closeVersionLibrary(); setDiffOpen(false); setRecordOpen(false); }
              setPanelCollapsed(!sidebarCollapsed);
            }} />
          <div className="mc-header-document">
            <span className="mc-crumb" title={project?.title || t("app")}>
              {project?.title || t("app")}
            </span>
            {project && <Btn className="mc-header-version" icon={IconBranchOutlineRegular}
              label={project.head > 0 ? `${t("versionLibrary")} · ${t("current")} v${project.head}` : t("versionLibrary")}
              aria-expanded={versionLibraryOpen} aria-controls={versionLibraryOpen ? "mc-version-library" : undefined}
              onClick={() => { setInstrumentOpen(false); closeTimelapse(); setLibraryInitial(null); setViewOpen(false); setRecordOpen(false); setDiffOpen(false); setLibraryDesign(null); setVersionLibraryOpen(value => !value); }} />}
          </div>
          {project && sidebarCollapsed && <Btn className="mc-header-new-session" icon={IconNewChatOutlineRegular}
            label={t("newSession")} disabled={busy} onClick={() => createConversation(project)} />}
        </div>
        <div ref={setStatusTarget} className="mc-header-status" />
        <nav className="mc-header-actions mc-panel" aria-label={t("workbenchTools")}>
          <div className="mc-header-action-group">
            <Btn icon={IconRefreshOutlineRegular} label={t("resetView")} onClick={() => setResetView(value => value + 1)} />
            <Btn icon={currentDisplayMode === "wire" ? WireframeViewIcon : currentDisplayMode === "transparent" ? TransparentViewIcon : SolidViewIcon}
              label={`${t("displayMode")} · ${modeLabel(currentDisplayMode)}`}
              aria-label={t("switchDisplayMode", { mode: modeLabel(nextDisplayMode) })}
              onClick={() => setDisplayMode(nextDisplayMode)} />
            <Btn icon={SectionViewIcon} label={t("sectionView")} aria-pressed={viewOpen}
              aria-expanded={viewOpen} aria-controls={viewOpen ? "mc-view-panel" : undefined}
              disabled={!project?.head || busy || diffOpen || versionLibraryOpen || !!processDesign}
              onClick={toggleViewPanel} />
            <Btn icon={IconSlidersTwoOutlineRegular} label={t("parameterPanel")} aria-pressed={parameterPanelVisible}
              aria-expanded={parameterPanelVisible} aria-controls={parameterPanelVisible ? "mc-parameter-panel" : undefined}
              disabled={!project?.parameterPanel || busy || running || nativeRunning || diffOpen || versionLibraryOpen || !!processDesign}
              onClick={() => { setViewOpen(false); setInstrumentOpen(false); closeTimelapse(); setRecordOpen(false); clearGeometrySelection(); setSelecting(false); setParameterPanelOpen(!parameterPanelVisible); }} />
            <Btn icon={InstrumentIcon} label={t("instrument")} aria-pressed={instrumentOpen}
              disabled={!project?.head || busy || diffOpen || versionLibraryOpen || timelapseOpen || !!processDesign}
              onClick={toggleInstrument} />
            <Btn icon={SelectGeometryIcon} label={t("selectGeometry")} aria-pressed={selectionActive}
              aria-expanded={hasAssemblyParts || hasModelChoices ? inspectionVisible : undefined} aria-controls={inspectionVisible ? "mc-model-inspection" : undefined}
              disabled={!project || !!processDesign || busy || diffOpen || versionLibraryOpen || explode > 0}
              onClick={() => { setInstrumentOpen(false); closeTimelapse(); setViewOpen(false); clearGeometrySelection(); setSelectionInstant(false); setSelecting(value => !value); }} />
          </div>
          <div className="mc-header-action-group">
            <Btn icon={IconCompareSplitOutlineRegular} label={t("compareVersion")} disabled={!project || project.revisions.length < 2} aria-pressed={diffOpen}
              onClick={() => { setInstrumentOpen(false); closeTimelapse(); setViewOpen(false); setRecordOpen(false); closeVersionLibrary(); setDiffOpen(value => !value); }} />
            <Btn className="mc-session-record-toggle" icon={IconFlatListOutlineRegular} label={t("sessionRecord")}
              disabled={busy || !project?.activeSessionId || sessionReference?.sessionId !== project.activeSessionId}
              aria-expanded={recordOpen} aria-controls={recordOpen ? "mc-session-record-host" : undefined}
              onClick={() => recordOpen ? closeSessionRecord() : openSessionRecord()} />
          </div>
          {project && renderSlot("minicad.directoryActions", { absolutePath: project.workspaceDirectory,
            projectId: project.id, modelFile: project.modelFile, hasModel: project.head > 0, onMenuOpenChange: setAppMenu })}
        </nav>
      </header>
      <aside id="mc-design-library" className="mc-sidebar mc-panel" aria-label={t("projects")}
        aria-hidden={sidebarCollapsed} inert={sidebarCollapsed ? "" : undefined} data-instant={!pointerModality() || undefined}>
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
      {parameterPanelVisible && <ParameterPanel
        key={`${project.id}:${project.modelFile}:${project.head}:${project.parameterPanel.id}`} project={project} language={language}
        disabled={busy || running || nativeRunning || project.workingTreeChanged} request={request} t={t} onClose={() => setParameterPanelOpen(false)}
        onOperation={setUserOperation}
        onApplied={async captured => {
          if (selection.current !== captured.id || projectRef.current?.modelFile !== captured.modelFile) return;
          const data = await api("get", { projectId: captured.id });
          if (selection.current === captured.id && projectRef.current?.modelFile === captured.modelFile) setProject(data);
          await refreshList();
        }} />}
      {viewOpen && project?.head > 0 && <ViewPanel section={section} explode={explode} explodeAxis={explodeAxis}
        explodeAvailable={(design?.parts?.length || 0) > 1} extent={viewExtent}
        onSection={changeSection} onExplode={setExplode} onExplodeAxis={setExplodeAxis}
        onClose={() => setViewOpen(false)} t={t} />}
      {timelapseOpen && <Timelapse project={project} frames={timelapseFrames} index={timelapseIndex}
        onIndex={setTimelapseIndex} loading={timelapseLoading} error={timelapseError}
        onBack={backToVersionLibrary} onClose={closeTimelapse} t={t} />}
      {instrumentOpen && <InstrumentPanel note={instrumentNote?.name} part={instrumentNote?.part}
        recording={instrumentRecording} count={instrumentEvents.length}
        onToggleRecording={toggleInstrumentRecording} onClear={clearInstrumentEvents} onExport={exportInstrumentMidi}
        onClose={() => { setInstrumentOpen(false); setInstrumentRecording(false); setRestrikeIndex(null); }} t={t} />}
      {diffOpen && project && <VersionDiff key={`${project.id}:${project.modelFile}`} project={project} request={request}
        onResult={setDiff} onClose={() => setDiffOpen(false)} t={t} language={language} />}
      {versionLibraryOpen && project && <VersionLibrary key={`${project.id}:${project.modelFile}`} project={project} progress={progress}
        request={request} language={language} disabled={busy || running || nativeRunning} initialRevision={libraryInitial}
        onClose={dismissVersionLibrary} onSelect={selectRevision} onPreview={setLibraryDesign} onTimelapse={openTimelapse} t={t} />}
      <div id="mc-session-record-host" className="mc-session-record-host" ref={setRecordHost} />
      <ConversationDock key={project?.activeSessionId || "none"} ref={dock} t={t} hidden={versionLibraryOpen}
        embedded={recordOpen}
        running={running} operationActor={operationActor} userOperation={userOperation} statusTarget={statusTarget} revision={project?.head || 0} latestRevision={project?.revisions[0]?.revision || 0}
        onSessionRecord={openSessionRecord} onReveal={closeSessionRecord}
        onFocusComposer={() => { const sessionId = project?.activeSessionId; if (sessionId) focusComposer(sessionId); }}
        onStart={() => { setError(null); setUserOperation(null); }}
        onCancel={() => action(() => api("cancel", { projectId: selected }))} onRunning={setNativeRunning}>
        {callbacks => <>
        {sessionReference && project && sessionReference.sessionId === project.activeSessionId ? (
          <SessionProvider session={sessionReference}>
            {renderSlot("minicad.composer", { ...callbacks, record: {
              host: recordHost, open: recordOpen, title: project.title, onClose: closeSessionRecord,
            } })}
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
