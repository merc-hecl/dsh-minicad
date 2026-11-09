import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, StateDot, Tag, IconCloseOutlineRegular,
  IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import { ErrorDetails } from "./workbench-dialog.jsx";
import { errorDetail } from "../shared/errors.js";

export function ModelThumbnail({ entry, load }) {
  const mount = useRef(null), canvas = useRef(null);
  useEffect(() => {
    let disposed = false;
    const observer = new IntersectionObserver(([item]) => {
      if (!item.isIntersecting) return;
      observer.disconnect();
      load(entry).then(({ previewData }) => {
        if (disposed) return;
        const { edges } = previewData, points = [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < edges.length; i += 3) {
          const x = (edges[i] - edges[i + 1]) * .8660254;
          const y = (edges[i] + edges[i + 1]) * .5 - edges[i + 2];
          points.push(x, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
        const ctx = canvas.current.getContext("2d");
        const scale = Math.min(160 / (maxX - minX || 1), 88 / (maxY - minY || 1));
        ctx.strokeStyle = "#7c8da4";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < points.length; i += 4) {
          ctx.moveTo(96 + (points[i] - (maxX + minX) / 2) * scale, 56 + (points[i + 1] - (maxY + minY) / 2) * scale);
          ctx.lineTo(96 + (points[i + 2] - (maxX + minX) / 2) * scale, 56 + (points[i + 3] - (maxY + minY) / 2) * scale);
        }
        ctx.stroke();
      }).catch(() => {}); // The selected frame reports preview errors in the stage.
    }, { rootMargin: "0px 96px" });
    observer.observe(mount.current);
    return () => { disposed = true; observer.disconnect(); };
  }, [entry.key, load]);
  return <span ref={mount} className="mc-model-thumbnail"><canvas ref={canvas} width={192} height={112} aria-hidden="true" /></span>;
}

function FrameThumbnail({ entry, load, selected, onSelect }) {
  const mount = useRef(null);
  useEffect(() => {
    if (selected) mount.current.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);
  return <li ref={mount}>
    <Button className="mc-record-frame mc-panel" variant="ghost" aria-current={selected ? "step" : undefined}
      aria-label={`${entry.label} · ${entry.title}`} title={entry.title} onClick={() => onSelect(entry.key)}>
      <span className="mc-record-frame-content"><ModelThumbnail entry={entry} load={load} />
        <span><strong>{entry.label}</strong><span>{entry.title}</span></span>
      </span>
    </Button>
  </li>;
}

export function RevisionRecord({ project, entry, runs, historyError, historyLoading, request, t, language, disabled, onSelect, onClose, onPreview, onCurrent, renderVersions }) {
  const [scope, setScope] = useState(entry ? "version" : "process");
  const [selectedRun, setSelectedRun] = useState(null), [selectedStep, setSelectedStep] = useState(null);
  const [design, setDesign] = useState(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(null);
  const reel = useRef(null);
  const controller = useRef(new AbortController()), cache = useRef(new Map());
  useEffect(() => {
    const container = reel.current;
    const scrollRecords = event => {
      const strip = event.target.closest(".mc-record-frames, .mc-record-runs, .mc-revision-tree");
      if (!strip || event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || strip.scrollWidth <= strip.clientWidth) return;
      if (strip.matches(".mc-revision-tree") && strip.scrollHeight > strip.clientHeight && !event.shiftKey) return;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? parseFloat(getComputedStyle(strip).lineHeight)
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? strip.clientWidth : 1;
      event.preventDefault();
      strip.scrollLeft += event.deltaY * unit;
    };
    container.addEventListener("wheel", scrollRecords, { passive: false });
    return () => container.removeEventListener("wheel", scrollRecords);
  }, []);
  useEffect(() => () => { controller.current.abort(); cache.current.clear(); }, []);
  const versionFocus = useMemo(() => entry && ({ key: `v${entry.revision}`,
    label: `v${entry.revision}${entry.revision === project.head ? ` · ${t("current")}` : ""}`,
    revision: entry.revision, parent: entry.parent, created: entry.created, title: entry.summary || t("savedVersion"),
  }), [entry, project.head, t]);
  const processRuns = useMemo(() => runs.filter(run => {
    if (!run.steps.length) return false;
    if (run.committedRevision) return run.committedRevision === versionFocus?.revision;
    // Trials leading to this revision share its target number and parent.
    return (run.candidateRevision === versionFocus?.revision && run.baseRevision === (versionFocus?.parent ?? 0))
      || (run.baseRevision === project.head && (!versionFocus || versionFocus.revision === project.head));
  }).sort((a, b) => b.created - a.created), [runs, versionFocus, project.head]);
  const activeRun = processRuns.find(run => run.id === selectedRun)
    || processRuns.find(run => run.committedRevision === versionFocus?.revision) || processRuns[0];
  const steps = useMemo(() => activeRun ? activeRun.steps.map(step => ({ key: `${activeRun.id}:${step.sequence}`,
    label: `${t("checkpoint")} ${step.sequence}`, runId: activeRun.id, sequence: step.sequence,
    metrics: step.metrics, geometryIds: activeRun.geometryIds, created: step.created,
    title: step.label || (step.operation === "result" ? activeRun.summary : "") || t(step.operation || "modeling"),
    baseRevision: activeRun.baseRevision })) : [], [activeRun, t]);
  const focus = scope === "version" ? versionFocus : steps.find(entry => entry.key === selectedStep) || steps.at(-1);
  const changeScope = value => {
    if (value === "process") {
      const related = processRuns.find(run => run.committedRevision === versionFocus?.revision);
      setSelectedRun(related?.id || null); setSelectedStep(null);
    }
    setScope(value);
  };
  const index = steps.indexOf(focus);
  const currentPreview = project.design?.previewData;
  const load = useCallback(async (entry) => {
    if (entry.revision === project.head && currentPreview)
      return { previewData: currentPreview, modelFile: project.modelFile, revision: entry.revision };
    let promise = cache.current.get(entry.key);
    if (!promise) {
      promise = request(entry.runId ? "checkpoint" : "preview", {
        projectId: project.id, modelFile: project.modelFile,
        ...(entry.runId ? { runId: entry.runId, sequence: entry.sequence } : { revision: entry.revision }),
      }, controller.current.signal).then(previewData => ({ previewData, metrics: entry.metrics,
        modelFile: project.modelFile, revision: entry.revision || entry.baseRevision, geometryIds: entry.geometryIds }));
      cache.current.set(entry.key, promise);
      if (cache.current.size > 6) cache.current.delete(cache.current.keys().next().value);
      promise.catch(() => { if (cache.current.get(entry.key) === promise) cache.current.delete(entry.key); });
    }
    return promise;
  }, [project.id, project.modelFile, project.head, currentPreview, request]);
  useEffect(() => {
    if (!focus) { setLoading(false); setDesign(null); setError(null); return; }
    let disposed = false;
    setLoading(true); setDesign(null); setError(null);
    load(focus).then(value => { if (!disposed) setDesign(value); })
      .catch(error => { if (!disposed && error.name !== "AbortError") setError(errorDetail(error)); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [focus?.key, load]);
  const dateFormatter = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  useEffect(() => { onPreview(design); }, [design, onPreview]);
  const failure = error || (scope === "process" ? historyError : null);
  const pending = loading || (scope === "process" && !focus && historyLoading);
  return <section className="mc-revision-detail" aria-label={t("recordModel")}>
    <header className="mc-record-toolbar mc-panel">
      <strong>{t("versionLibrary")}{entry ? ` · v${entry.revision}` : ""}</strong>
      {entry && <Tag tone="neutral">{t(entry.revision === project.head ? "current" : "revisionPreview")}</Tag>}
      {focus?.runId && <Tag tone="neutral">{focus.label}</Tag>}
      {entry && <Button variant="ghost" size="sm" onClick={() => changeScope(scope === "version" ? "process" : "version")}>
        {t(scope === "version" ? "modelingProcess" : "savedVersion")}
      </Button>}
      {entry && (entry.revision !== project.head || scope === "process") && <Button variant="ghost" size="sm"
        onClick={() => { setScope("version"); onCurrent(); }}>{t("returnCurrent")}</Button>}
      {entry && entry.revision !== project.head && <Button variant="primary" size="sm"
        disabled={disabled || scope === "process"} onClick={() => onSelect(entry.revision)}>
        {t("switchVersion", { n: entry.revision })}
      </Button>}
      <Button variant="ghost" size="sm" icon={<IconCloseOutlineRegular size={16} />} aria-label={t("close")} onClick={onClose} />
    </header>
    <div className="mc-library-preview-status">
      {pending && !failure && <div className="mc-record-placeholder" role="status"><StateDot state="ongoing" />{t("loading")}</div>}
      {!focus && !pending && !failure && <div className="mc-record-placeholder">{t("noProcessSteps")}</div>}
      {failure && <div className="mc-record-error mc-panel" role="alert"><div className="mc-record-error-content mc-panel-scroll">
        <span>{t("previewUnavailable")}</span><ErrorDetails detail={failure} t={t} />
      </div></div>}
    </div>
    <footer ref={reel} className="mc-record-reel" data-scope={scope}>
      {scope === "version" && renderVersions(load)}
      {scope === "process" && <div className="mc-record-reel-heading mc-panel">
        <span className="mc-record-count">{index >= 0 ? index + 1 : 0} / {steps.length}</span>
        <Button variant="ghost" size="sm" icon={<IconChevronLeftOutlineRegular size={14} />} aria-label={t("previousStep")} disabled={index <= 0} onClick={() => setSelectedStep(steps[index - 1].key)} />
        <input className="mc-record-scrubber" type="range" min={0} max={Math.max(0, steps.length - 1)} value={Math.max(0, index)}
          disabled={!steps.length} aria-label={t("modelingProcess")} onChange={event => setSelectedStep(steps[Number(event.target.value)].key)} />
        <Button variant="ghost" size="sm" icon={<IconChevronRightOutlineRegular size={14} />} aria-label={t("nextStep")} disabled={index < 0 || index >= steps.length - 1} onClick={() => setSelectedStep(steps[index + 1].key)} />
      </div>}
      {scope === "process" && <div className="mc-record-runs mc-panel" aria-label={t("modelingRuns")}>
        {processRuns.map(run => <Button key={run.id} variant="ghost" size="sm" aria-pressed={run.id === activeRun?.id}
          title={`${run.summary || t("modeling")} · ${dateFormatter.format(run.created * 1000)}`}
          onClick={() => { setSelectedRun(run.id); setSelectedStep(null); }}>
          <span className="mc-record-run-title">{run.summary || t("modeling")}</span>
          <span className="mc-muted">{run.committedRevision ? `v${run.committedRevision}` : t(run.phase === "preview" ? "unsavedTrial" : `taskStatus.${run.phase}`)} · {dateFormatter.format(run.created * 1000)}</span>
          <span className="mc-muted">{t("stepCount", { count: run.steps.length })}</span>
        </Button>)}
      </div>}
      {scope === "process" && <ol className="mc-record-frames" aria-label={t("modelingProcess")}>
        {steps.map(entry => <FrameThumbnail key={entry.key} entry={entry} load={load} selected={entry.key === focus?.key} onSelect={setSelectedStep} />)}
      </ol>}
    </footer>
  </section>;
}
