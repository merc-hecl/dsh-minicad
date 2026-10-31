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
  Menu,
  SegmentedControl,
  IconPlusOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconChevronDownOutlineRegular,
  IconCloseOutlineRegular,
  IconFolderCloseRegular,
  IconFolderOpenRegular,
  IconTriangleRightFillRegular,
  IconPanelLeftOutlineRegular,
  IconEllipsisOutlineRegular,
  IconCheckOutlineRegular,
  IconDownloadOutlineRegular,
  IconClockOutlineRegular,
  IconFullscreenOutlineRegular,
  IconSlidersTwoOutlineRegular,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { Viewport } from "./viewport.jsx";
import { errorKey } from "./locale.js";
import { ForgeIcon } from "./forge-icon.jsx";

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
      className={`mc-button ${!children ? "mc-icon" : ""} ${className}`}
      aria-label={label}
      {...props}
    >
      {children}
    </Button>
  );
  return label ? (
    <Tooltip label={label} delayMs={500} portal>{button}</Tooltip>
  ) : button;
};

const NoConversationView = () => null;
const COMPOSER_SLOTS = { views: NoConversationView };

// Use DSH 0.2.1-rc.5's public Factory, which owns its child slots exclusively.
// Only omit the transcript here; retain the complete native composer and takeovers.
export function NativeComposer({ renderFactorySlot }) {
  return renderFactorySlot(
    "conversation.content",
    { variant: "embedded", phase: "active", hero: false },
    { slots: COMPOSER_SLOTS },
  );
}

export function Workbench({
  locale, t, enter, back, request, SessionProvider, renderSlot, retainSession,
}) {
  const workbench = useRef(null);
  useLayoutEffect(() => {
    enter(workbench.current);
  }, []);
  const language = useSyncExternalStore(
    locale.subscribe,
    locale.getSnapshot,
  ).active;
  const [projects, setProjects] = useState([]),
    [project, setProject] = useState(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false),
    [projectExpanded, setProjectExpanded] = useState(true);
  const [selected, setSelected] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(null);
  const [busy, setBusy] = useState(false),
    [running, setRunning] = useState(false);
  const [tab, setTab] = useState("model"),
    [view, setView] = useState("iso"),
    [wire, setWire] = useState(false),
    [fit, setFit] = useState(0);
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false);
  const [modal, setModal] = useState(null),
    [value, setValue] = useState(""),
    [editHead, setEditHead] = useState(0);
  const [sessionReference, setSessionReference] = useState(null);
  const [reference, setReference] = useState(null),
    [refPage, setRefPage] = useState(1),
    [refId, setRefId] = useState("");
  const selection = useRef(""),
    projectRef = useRef(null),
    alive = useRef(true);
  const languageRef = useRef(language),
    lastStatusError = useRef("");
  languageRef.current = language;
  selection.current = selected;
  projectRef.current = project;
  const showError = (e) => {
    if (alive.current)
      setError({
        key: e.uiKey || errorKey(e.message || ""),
        detail: e.message || String(e),
      });
  };
  const api = (method, params = {}) =>
    request(method, {
      ...params,
      locale: languageRef.current === "zh" ? "zh" : "en",
    });
  async function refreshList() {
    const p = await api("list");
    if (alive.current) setProjects(p);
    return p;
  }
  async function load(id) {
    selection.current = id;
    lastStatusError.current = "";
    setError(null);
    setSelected(id);
    setProjectExpanded(true);
    setLoading(true);
    setProject(null);
    setModal(null);
    setRunning(false);
    try {
      const p = await api("get", { projectId: id });
      if (selection.current === id && alive.current) {
        setProject(p);
      }
    } catch (e) {
      showError(e);
    } finally {
      if (selection.current === id) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    refreshList()
      .then(async (p) => {
        if (!alive.current) return;
        // A native composer needs a real Session even before its first message.
        const first = p[0] || (await api("create", { title: t("untitled") }));
        if (!alive.current) return;
        if (!p.length) await refreshList();
        await load(first.id);
      })
      .catch((e) => {
        showError(e);
        setLoading(false);
      });
    return () => {
      alive.current = false;
    };
  }, []);
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
        if (state.error && state.error !== lastStatusError.current)
          setError({ key: errorKey(state.error), detail: state.error });
        lastStatusError.current = state.error || "";
        if (projectRef.current && state.head !== projectRef.current.head) {
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
  useEffect(() => {
    if (!modal) return;
    const dialog = document.querySelector('.mc-workbench [role="dialog"]');
    const previous = document.activeElement;
    const elements = () => [
      ...dialog.querySelectorAll(
        'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
      ),
    ];
    (dialog.querySelector("[autofocus]") || elements()[0])?.focus();
    const key = (e) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        setModal(null);
      }
      if (e.key === "Tab") {
        const items = elements(),
          first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    dialog.addEventListener("keydown", key);
    return () => {
      dialog.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [modal, busy]);
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
    setModal(kind);
    setEditHead(project?.head || 0);
    setValue(
      kind === "create"
        ? ""
        : kind === "rename"
          ? project.title
          : kind === "parameters"
            ? JSON.stringify(project.design.parameters, null, 2)
            : kind === "source"
              ? project.design.source
              : "",
    );
  }
  async function openReference(id, projectId = selected, page = 1) {
    if (selection.current !== projectId) return;
    setRefId(id);
    setRefPage(page);
    setReference(null);
    setModal("reference");
    try {
      const data = await api("reference", {
        projectId,
        attachmentId: id,
        page,
      });
      if (selection.current === projectId) setReference(data);
    } catch (e) {
      showError(e);
    }
  }
  async function saveEditor() {
    if (modal === "parameters") {
      const invalid = [
        ...document.querySelectorAll(".mc-dialog input, .mc-dialog textarea"),
      ].find((input) => !input.checkValidity());
      if (invalid) {
        invalid.reportValidity();
        return;
      }
    }
    await action(async () => {
      const id = selected;
      if (modal === "create") {
        const p = await api("create", { title: value.trim() || t("untitled") });
        await refreshList();
        await load(p.id);
        return;
      }
      if (modal === "rename") {
        await api("rename", { projectId: id, title: value });
        await refreshList();
        setProject((p) => ({ ...p, title: value }));
        setModal(null);
        return;
      }
      let params;
      if (modal === "parameters") {
        try {
          params = JSON.parse(value);
          if (!params || Array.isArray(params) || typeof params !== "object")
            throw new Error();
        } catch {
          throw { uiKey: "invalidJSON", message: t("invalidJSON") };
        }
      }
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
  const editable = ["create", "rename", "parameters", "source"].includes(modal);
  return (
    <div
      ref={workbench}
      className="mc-workbench"
      data-project-panel-collapsed={panelCollapsed || undefined}
    >
      <Viewport
        id="mc-view-model-panel"
        active={tab === "model"}
        design={design}
        view={view}
        wire={wire}
        fitToken={fit}
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
          {t("projects")}
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
      <aside className={`mc-sidebar ${panelCollapsed ? "" : "mc-panel"}`} aria-label={t("projects")}>
        <div className="mc-side-heading">
          <Btn
            icon={IconPanelLeftOutlineRegular}
            variant={panelCollapsed ? "outline" : "ghost"}
            label={t(panelCollapsed ? "expandProjects" : "collapseProjects")}
            aria-expanded={!panelCollapsed}
            aria-controls="mc-project-list"
            onClick={() => setPanelCollapsed((collapsed) => !collapsed)}
          />
          {!panelCollapsed && (
            <>
              <Tooltip label={t("projects")} delayMs={500} portal>
                <span className="mc-side-title">{t("projects")}</span>
              </Tooltip>
              <Btn
                icon={IconPlusOutlineRegular}
                label={t("newProject")}
                onClick={() => open("create")}
              />
            </>
          )}
        </div>
        <div id="mc-project-list" className="mc-project-list" hidden={panelCollapsed}>
          {!projects.length && (
            <p className="mc-muted mc-secondary">
              {t("noProjects")}
            </p>
          )}
          {projects.map((p) => (
            <div key={p.id} className="mc-project">
              <div className="mc-project-row">
                <Btn
                  className={`mc-button mc-project-toggle ${p.id === selected ? "mc-active" : ""}`}
                  label={p.title}
                  aria-expanded={p.id === selected && projectExpanded}
                  onClick={() => {
                    if (p.id === selected) setProjectExpanded((expanded) => !expanded);
                    else load(p.id);
                  }}
                >
                  <span className="mc-folder-slot" aria-hidden="true">
                    {p.id === selected && projectExpanded ? (
                      <IconFolderOpenRegular className="mc-folder-icon" size={16} />
                    ) : (
                      <IconFolderCloseRegular className="mc-folder-icon" size={16} />
                    )}
                    <IconTriangleRightFillRegular className="mc-folder-arrow" size={16} />
                  </span>
                  <span className="mc-project-title">{p.title}</span>
                </Btn>
                {p.id === selected && (
                  <Btn
                    icon={IconEllipsisOutlineRegular}
                    label={t("rename")}
                    onClick={() => open("rename")}
                  />
                )}
              </div>
              {p.id === selected && project && (
                <div className="mc-tree" hidden={!projectExpanded}>
                  <Btn
                    icon={Cube}
                    onClick={() => {
                      setTab("model");
                      setModal(null);
                    }}
                  >
                    {t("model")}
                  </Btn>
                  <Btn disabled={!design} onClick={() => open("parameters")}>
                    {t("parameters")}
                  </Btn>
                  <Btn disabled={!design} onClick={() => setTab("drawing")}>
                    {t("drawing")}
                  </Btn>
                  <Btn disabled={!design} onClick={() => open("source")}>
                    {t("source")}
                  </Btn>
                  {project.attachments.map((a) => (
                    <Btn
                      key={a.id}
                      label={a.name}
                      onClick={() => openReference(a.id)}
                    >
                      {a.name}
                    </Btn>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </aside>
      <SegmentedControl
        id="mc-view"
        className="mc-view-tabs"
        label={t("model")}
        value={tab}
        options={["model", "drawing"].map((value) => ({
          value,
          label: t(value),
          disabled: value === "drawing" && !design,
        }))}
        onChange={setTab}
      />
      {tab === "model" && (
        <>
          <Menu
            className="mc-camera"
            open={cameraMenuOpen}
            onClose={() => setCameraMenuOpen(false)}
            items={["iso", "top", "front", "right"].map((id) => ({ id, label: t(id) }))}
            selectedId={view}
            onSelect={(id) => {
              setView(id);
              setCameraMenuOpen(false);
            }}
            align="end"
            portal
            anchor={
              <Btn
                variant="outline"
                aria-haspopup="menu"
                aria-expanded={cameraMenuOpen}
                onClick={() => setCameraMenuOpen((open) => !open)}
              >
                {t(view)}
                <IconChevronDownOutlineRegular size={16} />
              </Btn>
            }
          />
          <div className="mc-tools mc-panel">
            <Btn icon={IconFullscreenOutlineRegular} label={t("fit")} onClick={() => setFit((f) => f + 1)} />
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
        </>
      )}
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
          <p>{t("loading")}</p>
        </div>
      )}
      {design && tab === "drawing" && (
        <div id="mc-view-drawing-panel" role="tabpanel" className="mc-sheet">
          <img
            alt={t("drawing")}
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(design.drawing)}`}
          />
        </div>
      )}
      <section className="mc-bottom">
        {sessionReference && project && sessionReference.sessionId === project.session_id ? (
          <SessionProvider session={sessionReference}>
            {renderSlot("minicad.composer", {})}
          </SessionProvider>
        ) : <p className="mc-muted">{t("loading")}</p>}
        <div className="mc-help">{t("controls")}</div>
      </section>
      {modal && (
        <div
          className="mc-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setModal(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={t(modal === "reference" ? "pdfPreview" : modal)}
            className={`mc-dialog mc-panel ${["reference", "source"].includes(modal) ? "mc-wide" : ""}`}
          >
            <header className="mc-dialog-header">
              <h2>
                {t(
                  modal === "reference"
                    ? "pdfPreview"
                    : modal === "create"
                      ? "newProject"
                      : modal,
                )}
              </h2>
              <Btn
                icon={IconCloseOutlineRegular}
                label={t("close")}
                disabled={busy}
                onClick={() => setModal(null)}
              />
            </header>
            <div className="mc-dialog-content">
              {["create", "rename"].includes(modal) && (
                <label>
                  {t("name")}
                  <input
                    className="mc-input"
                    autoFocus
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditor();
                    }}
                  />
                </label>
              )}
              {modal === "source" && (
                <textarea
                  className="mc-code"
                  spellCheck={false}
                  aria-label={t(modal)}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              )}
              {modal === "parameters" && (
                <>
                  <ParameterEditor value={value} setValue={setValue} t={t} />
                  {design.checks.length > 0 && (
                    <div className="mc-checks">
                      <p className="mc-muted">{t("checks")}</p>
                      {design.checks.map((c, i) => (
                        <div key={i} className="mc-check-row">
                          <span>{c.metric}</span>
                          <code>{c.expression || c.expected}</code>
                          <span>{c.actual.toFixed(3)}</span>
                          <IconCheckOutlineRegular size={14} />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {modal === "history" &&
                project.revisions.map((r) => (
                  <div key={r.revision} className="mc-history-row">
                    <div className="mc-spacer">
                      <strong>v{r.revision}</strong> · {r.summary}
                      <small>{date(r.created)}</small>
                    </div>
                    {r.revision === project.head ? (
                      <span className="mc-badge">{t("current")}</span>
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
                            setProject(p);
                            setModal(null);
                          })
                        }
                      >
                        {t("restore")}
                      </Btn>
                    )}
                  </div>
                ))}
              {modal === "export" && (
                <>
                  <p className="mc-muted">
                    {t("exportHint", { n: project.head })}
                  </p>
                  <div className="mc-export-options">
                    {["step", "stl", "svg", "pdf", "zip"].map((format) => (
                      <button
                        className="mc-export-option"
                        disabled={busy}
                        key={format}
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
                        <strong>
                          {format === "zip"
                            ? t("editable")
                            : format.toUpperCase()}
                        </strong>
                        <small>{t(format + "Hint")}</small>
                      </button>
                    ))}
                  </div>
                  <p className="mc-muted mc-secondary">
                    {t("drawingNote")}
                  </p>
                </>
              )}
              {modal === "reference" &&
                (reference ? (
                  <>
                    <div className="mc-reference-nav">
                      <Btn
                        disabled={refPage <= 1}
                        label={t("previous")}
                        onClick={() =>
                          openReference(refId, selected, refPage - 1)
                        }
                      >
                        ←
                      </Btn>
                      <span>
                        {t("page", { page: refPage, total: reference.pages })}
                      </span>
                      <Btn
                        disabled={refPage >= reference.pages}
                        label={t("next")}
                        onClick={() =>
                          openReference(refId, selected, refPage + 1)
                        }
                      >
                        →
                      </Btn>
                    </div>
                    <img
                      className="mc-reference"
                      alt={`${reference.name} ${refPage}`}
                      src={`data:image/png;base64,${reference.image}`}
                    />
                  </>
                ) : (
                  <p>{t("loading")}</p>
                ))}
            </div>
            {editable && (
              <footer className="mc-dialog-footer">
                <Btn disabled={busy} onClick={() => setModal(null)}>
                  {t("cancel")}
                </Btn>
                <Btn
                  variant="primary"
                  disabled={busy || (modal === "rename" && !value.trim())}
                  onClick={saveEditor}
                >
                  {busy
                    ? t("working")
                    : t(
                        modal === "create"
                          ? "create"
                          : modal === "rename"
                            ? "rename"
                            : "save",
                      )}
                </Btn>
              </footer>
            )}
          </section>
        </div>
      )}
      {error && (
        <div role="alert" className="mc-error mc-panel">
          <div className="mc-error-head">
            <span>{t(error.key)}</span>
            <Btn
              icon={IconCloseOutlineRegular}
              label={t("close")}
              onClick={() => setError(null)}
            />
          </div>
          {error.detail && (
            <details>
              <summary>{t("details")}</summary>
              {error.detail}
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function ParameterEditor({ value, setValue, t }) {
  const data = JSON.parse(value || "{}");
  const entries = Object.entries(data);
  if (!entries.length) return <p className="mc-muted">{t("noParameters")}</p>;
  return entries.map(([key, current]) => (
    <label className="mc-param" key={key}>
      <span>{key}</span>
      {typeof current === "boolean" ? (
        <input
          type="checkbox"
          checked={current}
          onChange={(e) =>
            setValue(JSON.stringify({ ...data, [key]: e.target.checked }))
          }
        />
      ) : typeof current === "object" ? (
        <textarea
          className="mc-input"
          defaultValue={JSON.stringify(current)}
          onBlur={(e) => {
            try {
              setValue(
                JSON.stringify({ ...data, [key]: JSON.parse(e.target.value) }),
              );
              e.target.setCustomValidity("");
            } catch {
              e.target.setCustomValidity(t("invalidJSON"));
              e.target.reportValidity();
            }
          }}
        />
      ) : (
        <input
          className="mc-input"
          type={typeof current === "number" ? "number" : "text"}
          step="any"
          defaultValue={current}
          onChange={(e) => {
            if (
              typeof current === "number" &&
              (e.target.value === "" ||
                !Number.isFinite(Number(e.target.value)))
            ) {
              e.target.setCustomValidity(t("invalidNumber"));
              return;
            }
            e.target.setCustomValidity("");
            setValue(
              JSON.stringify({
                ...data,
                [key]:
                  typeof current === "number"
                    ? Number(e.target.value)
                    : e.target.value,
              }),
            );
          }}
        />
      )}
    </label>
  ));
}
