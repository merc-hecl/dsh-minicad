import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, IconChevronRightOutlineRegular, IconCloseOutlineRegular, StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import { Viewport } from "./viewport.jsx";
import { ErrorDetails } from "./workbench-dialog.jsx";
import { errorDetail } from "../shared/errors.js";

const columnWidth = 140, rowHeight = 64, nodeWidth = 106, nodeHeight = 36;

function layoutRevisions(revisions) {
  const children = new Map();
  for (const entry of revisions.toReversed()) {
    if (!children.has(entry.parent)) children.set(entry.parent, []);
    children.get(entry.parent).push(entry);
  }
  let nextLane = 0, depth = 0;
  const nodes = new Map();
  const stack = (children.get(null) || []).toReversed().map(entry => ({ entry, column: 0 }));
  while (stack.length) {
    const { entry, column, lane = nextLane++ } = stack.pop();
    depth = Math.max(depth, column + 1);
    nodes.set(entry.revision, { ...entry, x: 20 + column * columnWidth, y: 18 + lane * rowHeight, lane });
    const branches = children.get(entry.revision) || [];
    for (let index = branches.length - 1; index >= 0; index--)
      stack.push({ entry: branches[index], column: column + 1, lane: index === 0 ? lane : undefined });
  }
  return { nodes, width: depth * columnWidth + 6, height: nextLane * rowHeight + 10 };
}

function RevisionDetails({ project, entry, date, request, disabled, onSelect, t }) {
  const { id: projectId, sourceFile, head } = project;
  const { revision } = entry;
  const current = revision === head;
  const currentPreview = current ? project.design?.previewData : null;
  const [preview, setPreview] = useState(null);
  const [webglFailed, setWebglFailed] = useState(false);
  useEffect(() => {
    if (currentPreview) return;
    const controller = new AbortController();
    request("preview", { projectId, sourceFile, revision }, controller.signal)
      .then(data => {
        if (!controller.signal.aborted) setPreview({ revision, data });
      })
      .catch(error => {
        if (!controller.signal.aborted) setPreview({ revision, error: errorDetail(error) });
      });
    return () => controller.abort();
  }, [currentPreview, projectId, sourceFile, revision, request]);

  const loaded = preview?.revision === revision ? preview : null;
  const previewData = currentPreview || loaded?.data;
  const design = previewData ? { previewData, sourceFile, revision } : null;
  const error = webglFailed ? t("webglError") : currentPreview ? null : loaded?.error;

  return <div className="mc-revision-detail">
    <div className="mc-revision-stage" aria-label={t("revisionPreview", { n: revision })}>
      <Viewport presentation="record" design={design} t={t} onError={() => setWebglFailed(true)} />
      {error ? <div className="mc-record-error" role="alert"><div className="mc-record-error-content mc-panel-scroll">
        <span>{t("previewUnavailable")}</span><ErrorDetails detail={error} t={t} />
      </div></div>
        : !design && <div className="mc-record-placeholder" role="status"><StateDot state="ongoing" />{t("loading")}</div>}
    </div>
    <div className="mc-revision-information">
      <div className="mc-revision-meta">
        {entry.parent !== null && <>
          <span><span className="mc-revision-base-label">{t("revisionBase")}</span> v{entry.parent}</span>
          <IconChevronRightOutlineRegular className="mc-revision-direction" size={12} aria-hidden="true" />
        </>}
        <strong>v{revision}</strong>
      </div>
      <h3>{entry.summary || t("savedVersion")}</h3>
      <time dateTime={new Date(entry.created * 1000).toISOString()}>{date}</time>
      <div className="mc-revision-footer">
        <Button variant={current ? "ghost" : "primary"} size="sm" disabled={current || disabled}
          onClick={() => onSelect(revision)}>{current ? t("currentVersion") : t("switchVersion", { n: revision })}</Button>
      </div>
    </div>
  </div>;
}

export function VersionLibrary({ project, request, language, disabled, onSelect, onClose, t }) {
  const [selected, setSelected] = useState(null);
  const tree = useRef(null);
  const { nodes, width, height } = useMemo(() => layoutRevisions(project.revisions), [project.revisions]);
  const entry = nodes.get(selected);
  const dates = useMemo(() => new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }), [language]);
  useLayoutEffect(() => {
    const selector = selected === null ? '[aria-current="true"]' : '[aria-pressed="true"]';
    tree.current?.querySelector(selector)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);

  return <section id="mc-version-library" className="mc-version-library mc-panel"
    data-selection={!!entry || undefined} aria-labelledby="mc-version-library-title">
    <header className="mc-record-bar">
      <h1 id="mc-version-library-title">{t("versionLibrary")}</h1>
      <span className="mc-record-project" title={project.title}>{project.title}</span>
      <span className="mc-version-count">{t("versionCount", { count: nodes.size })}</span>
      <Button variant="ghost" size="sm" icon={<IconCloseOutlineRegular size={16} />} aria-label={t("close")} onClick={onClose} />
    </header>
    <div ref={tree} className="mc-revision-tree">
      <div className="mc-revision-tree-graph" style={{ width, height }}>
        <svg width={width} height={height} fill="none" aria-hidden="true">
          {[...nodes.values()].map(node => {
            const parent = nodes.get(node.parent);
            if (!parent) return null;
            const x = parent.x + nodeWidth, y = parent.y + nodeHeight / 2;
            const endY = node.y + nodeHeight / 2, mid = (x + node.x) / 2;
            return <path key={node.revision} data-branch={parent.lane !== node.lane || undefined}
              d={`M${x} ${y} C${mid} ${y} ${mid} ${endY} ${node.x} ${endY}`} />;
          })}
        </svg>
        {[...nodes.values()].map(node => {
          const current = node.revision === project.head;
          return <Button key={node.revision} className="mc-revision-node" variant="ghost" size="sm"
            style={{ left: node.x, top: node.y, width: nodeWidth, height: nodeHeight }}
            aria-current={current || undefined} aria-pressed={node.revision === selected}
            onClick={() => setSelected(node.revision)}>
            <strong>v{node.revision}</strong>
            {current && <span>{t("current")}</span>}
          </Button>;
        })}
      </div>
    </div>
    {entry && <RevisionDetails project={project} entry={entry} date={dates.format(entry.created * 1000)}
      request={request} disabled={disabled} onSelect={onSelect} t={t} />}
  </section>;
}
