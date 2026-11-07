import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, SegmentedTabs, StateDot, Tag, IconCloseOutlineRegular,
  IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular,
  IconRefreshOutlineRegular, pointerModality } from "@deepseek-ai/dsh-client-ui-primitives";
import { Viewport } from "./viewport.jsx";
import { ErrorDetails } from "./workbench-dialog.jsx";
import { errorDetail } from "../shared/errors.js";

function FrameThumbnail({ entry, load, selected, onSelect, date }) {
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
  useEffect(() => {
    if (selected) mount.current.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);
  return <li ref={mount} data-version={!!entry.revision || undefined}>
    <Button className="mc-record-frame" variant="ghost" aria-current={selected ? "step" : undefined}
      aria-label={`${entry.label} · ${entry.title}`} title={entry.title} onClick={() => onSelect(entry.key)}>
      <span className="mc-record-frame-content"><canvas ref={canvas} width={192} height={112} aria-hidden="true" />
        <span><strong>{entry.label}</strong><span>{entry.title}</span></span>
        {date && <small>{date}</small>}</span>
    </Button>
  </li>;
}

export function MakingRecord({ project, progress, request, t, language, onClose, onTranscriptTarget }) {
  const [runs, setRuns] = useState([]);
  const [scope, setScope] = useState("versions"), [selectedVersion, setSelectedVersion] = useState(project.head);
  const [selectedRun, setSelectedRun] = useState(null), [selectedStep, setSelectedStep] = useState(null);
  const [design, setDesign] = useState(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(null);
  const [mode, setMode] = useState("model"), [reset, setReset] = useState(0);
  const reel = useRef(null);
  const controller = useRef(new AbortController()), cache = useRef(new Map());
  useEffect(() => {
    const container = reel.current;
    const scrollRecords = event => {
      const strip = event.target.closest(".mc-record-frames, .mc-record-runs");
      if (!strip || event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || strip.scrollWidth <= strip.clientWidth) return;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? parseFloat(getComputedStyle(strip).lineHeight)
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? strip.clientWidth : 1;
      event.preventDefault();
      strip.scrollLeft += event.deltaY * unit;
    };
    container.addEventListener("wheel", scrollRecords, { passive: false });
    return () => container.removeEventListener("wheel", scrollRecords);
  }, []);
  useEffect(() => {
    request("process_history", { projectId: project.id, sourceFile: project.sourceFile }, controller.current.signal)
      .then(setRuns).catch(error => { if (error.name !== "AbortError") setError(errorDetail(error)); });
    return () => { controller.current.abort(); cache.current.clear(); onTranscriptTarget(null); };
  }, []);
  const allRuns = useMemo(() => {
    const items = new Map(runs.map(run => [run.id, run]));
    if (progress?.sourceFile === project.sourceFile) items.set(progress.id, progress);
    return [...items.values()];
  }, [runs, progress, project.sourceFile]);
  const versions = useMemo(() => project.revisions.map(revision => ({ key: `v${revision.revision}`,
      label: `v${revision.revision}${revision.revision === project.head ? ` · ${t("current")}` : ""}`,
      revision: revision.revision, created: revision.created, title: revision.summary || t("savedVersion") }))
    .sort((a, b) => a.revision - b.revision), [project.revisions, project.head, t]);
  const versionFocus = versions.find(entry => entry.revision === selectedVersion)
    || versions.find(entry => entry.revision === project.head) || versions.at(-1);
  const processRuns = useMemo(() => allRuns.filter(run => run.steps.length)
    .sort((a, b) => b.created - a.created), [allRuns]);
  const activeRun = processRuns.find(run => run.id === selectedRun)
    || processRuns.find(run => run.committedRevision === versionFocus?.revision) || processRuns[0];
  const steps = useMemo(() => activeRun ? activeRun.steps.map(step => ({ key: `${activeRun.id}:${step.sequence}`,
    label: `${t("checkpoint")} ${step.sequence}`, runId: activeRun.id, sequence: step.sequence,
    metrics: step.metrics, geometryIds: activeRun.geometryIds, created: step.created,
    title: step.label || t(step.operation || "modeling"), baseRevision: activeRun.baseRevision })) : [], [activeRun, t]);
  const entries = scope === "versions" ? versions : steps;
  const focus = scope === "versions" ? versionFocus : steps.find(entry => entry.key === selectedStep) || steps.at(-1);
  const selectEntry = key => {
    if (scope === "versions") setSelectedVersion(versions.find(entry => entry.key === key).revision);
    else setSelectedStep(key);
  };
  const changeScope = value => {
    if (value === "process") {
      const related = processRuns.find(run => run.committedRevision === versionFocus?.revision);
      setSelectedRun(related?.id || null); setSelectedStep(null);
    }
    setScope(value);
  };
  const index = entries.indexOf(focus);
  const load = useCallback(async (entry) => {
    let promise = cache.current.get(entry.key);
    if (!promise) {
      promise = request(entry.runId ? "checkpoint" : "preview", {
        projectId: project.id, sourceFile: project.sourceFile,
        ...(entry.runId ? { runId: entry.runId, sequence: entry.sequence } : { revision: entry.revision }),
      }, controller.current.signal).then(previewData => ({ previewData, metrics: entry.metrics,
        sourceFile: project.sourceFile, revision: entry.revision || entry.baseRevision, geometryIds: entry.geometryIds }));
      cache.current.set(entry.key, promise);
      if (cache.current.size > 6) cache.current.delete(cache.current.keys().next().value);
      promise.catch(() => { if (cache.current.get(entry.key) === promise) cache.current.delete(entry.key); });
    }
    return promise;
  }, [project.id, project.sourceFile, request]);
  useEffect(() => {
    if (!focus) { setLoading(false); setDesign(null); return; }
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
  const date = focus && dateFormatter.format(focus.created * 1000);
  return <section className="mc-making-record mc-panel" aria-label={t("makingRecord")} data-mode={mode} data-instant={!pointerModality() || undefined}>
    <header className="mc-record-bar">
      <h1>{t("makingRecord")}</h1><span className="mc-record-project" title={project.title}>{project.title}</span>
      <div className="mc-record-switch"><SegmentedTabs label={t("recordView")} value={mode} onChange={setMode}
        items={[{ value: "model", label: t("recordModel") }, { value: "conversation", label: t("originalConversation") }]} /></div>
      <Button variant="ghost" size="sm" icon={<IconCloseOutlineRegular size={16} />} aria-label={t("closeRecord")} onClick={onClose} />
    </header>
    <div className="mc-record-body">
      <section className="mc-record-model" aria-label={t("recordModel")}>
        <div className="mc-record-toolbar">
          {focus && <Tag tone="neutral">{focus.label}</Tag>}
          <span className="mc-record-kind">{focus ? t(focus.runId ? "checkpointPreview" : "savedVersion") : project.sourceFile}</span>
          <Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular size={16} />} aria-label={t("resetView")} onClick={() => setReset(value => value + 1)} />
        </div>
        <div className="mc-record-stage">
          <Viewport presentation="record" design={design} resetToken={reset} t={t} onError={() => setError(t("webglError"))} />
          {loading && <div className="mc-record-placeholder" role="status"><StateDot state="ongoing" />{t("loading")}</div>}
          {!focus && !loading && <div className="mc-record-placeholder">{t(scope === "versions" ? "noSavedVersions" : "noProcessSteps")}</div>}
          {error && <div className="mc-record-error" role="alert"><div className="mc-record-error-content mc-panel-scroll">
            <span>{t("previewUnavailable")}</span><ErrorDetails detail={error} t={t} />
          </div></div>}
        </div>
        <div className="mc-record-detail">
          {focus && <><p title={focus.title}>{focus.title}</p><span>{date}</span></>}
        </div>
        <footer ref={reel} className="mc-record-reel">
          <div className="mc-record-reel-heading">
            <div className="mc-record-scope"><SegmentedTabs label={t("recordContent")} value={scope} onChange={changeScope}
              items={[{ value: "versions", label: `${t("savedVersions")} (${versions.length})` },
                { value: "process", label: t("modelingProcess") }]} /></div>
            <span className="mc-record-count" style={{ width: `${String(entries.length).length * 2 + 3}ch` }}>
              {index >= 0 ? index + 1 : 0} / {entries.length}
            </span>
            <Button variant="ghost" size="sm" icon={<IconChevronLeftOutlineRegular size={14} />} aria-label={t(scope === "versions" ? "previousVersion" : "previousStep")} disabled={index <= 0} onClick={() => selectEntry(entries[index - 1].key)} />
            <Button variant="ghost" size="sm" icon={<IconChevronRightOutlineRegular size={14} />} aria-label={t(scope === "versions" ? "nextVersion" : "nextStep")} disabled={index < 0 || index >= entries.length - 1} onClick={() => selectEntry(entries[index + 1].key)} />
          </div>
          {scope === "process" && <div className="mc-record-runs" aria-label={t("modelingRuns")}>
            {processRuns.map(run => <Button key={run.id} variant="ghost" size="sm" aria-pressed={run.id === activeRun?.id}
              title={`${run.summary || t("modeling")} · ${dateFormatter.format(run.created * 1000)}`}
              onClick={() => { setSelectedRun(run.id); setSelectedStep(null); }}>
              {run.committedRevision ? `v${run.committedRevision}` : `${t(run.phase === "preview" ? "unsavedTrial" : `taskStatus.${run.phase}`)} · ${dateFormatter.format(run.created * 1000)}`}
              <span className="mc-muted">{t("stepCount", { count: run.steps.length })}</span>
            </Button>)}
            {!processRuns.length && <span className="mc-muted">{t("noProcessSteps")}</span>}
          </div>}
          <ol className="mc-record-frames" aria-label={t(scope === "versions" ? "savedVersions" : "modelingProcess")}>
            {entries.map(entry => <FrameThumbnail key={entry.key} entry={entry} load={load} selected={entry.key === focus?.key} onSelect={selectEntry}
              date={scope === "versions" ? dateFormatter.format(entry.created * 1000) : null} />)}
          </ol>
        </footer>
      </section>
      <section className="mc-record-conversation" aria-label={t("originalConversation")}>
        <div className="mc-record-conversation-heading"><span>{t("originalConversation")}</span><span>{t("recordConversationHint")}</span></div>
        <div ref={onTranscriptTarget} className="mc-record-transcript" />
      </section>
    </div>
  </section>;
}
