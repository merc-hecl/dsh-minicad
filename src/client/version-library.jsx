import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, Tag } from "@deepseek-ai/dsh-client-ui-primitives";
import { RevisionRecord, ModelThumbnail } from "./revision-record.jsx";
import { RevisionMap } from "./revision-map.jsx";
import { errorDetail } from "../shared/errors.js";

const columnWidth = 180, rowHeight = 136, nodeWidth = 148, nodeHeight = 116;

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
  return { nodes, width: depth * columnWidth + 8, height: nextLane * rowHeight + 18 };
}

export function VersionLibrary({ project, progress, request, language, disabled, initialRevision, onSelect, onClose, onPreview, onTimelapse, t }) {
  const [selected, setSelected] = useState(initialRevision ?? project.head);
  const [runs, setRuns] = useState([]), [historyError, setHistoryError] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  // Revision details remount on selection; the map keeps its camera across those remounts.
  const mapCamera = useRef(null);
  const { nodes, width, height } = useMemo(() => layoutRevisions(project.revisions), [project.revisions]);
  const entry = nodes.get(selected) || nodes.get(project.head);
  useEffect(() => {
    const controller = new AbortController();
    setHistoryError(null); setHistoryLoading(true);
    request("process_history", { projectId: project.id, modelFile: project.modelFile }, controller.signal)
      .then(data => { if (!controller.signal.aborted) setRuns(data); })
      .catch(error => { if (!controller.signal.aborted) setHistoryError(errorDetail(error)); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [project.id, project.modelFile, project.head, request]);
  const allRuns = useMemo(() => {
    const items = new Map(runs.map(run => [run.id, run]));
    if (progress?.modelFile === project.modelFile) items.set(progress.id, progress);
    return [...items.values()];
  }, [runs, progress, project.modelFile]);
  const renderVersions = load => <RevisionMap camera={mapCamera} nodes={nodes} width={width} height={height}
    cardWidth={nodeWidth} cardHeight={nodeHeight} selected={entry?.revision} current={project.head}
    onSelect={setSelected} onCurrent={() => setSelected(project.head)} t={t}>
      <div className="mc-revision-tree-graph" style={{ width, height }}>
        <svg width={width} height={height} fill="none" aria-hidden="true">
          {[...nodes.values()].map(node => {
            const parent = nodes.get(node.parent);
            if (!parent) return null;
            const x = parent.x + nodeWidth, y = parent.y + nodeHeight / 2;
            const endY = node.y + nodeHeight / 2, mid = (x + node.x) / 2;
            return <path key={node.revision} vectorEffect="non-scaling-stroke" data-branch={parent.lane !== node.lane || undefined}
              d={`M${x} ${y} C${mid} ${y} ${mid} ${endY} ${node.x} ${endY}`} />;
          })}
        </svg>
        {[...nodes.values()].map(node => {
          const current = node.revision === project.head;
          return <Button key={node.revision} className="mc-revision-node mc-panel" variant="ghost" size="sm"
            style={{ left: node.x, top: node.y, width: nodeWidth, height: nodeHeight }}
            data-revision={node.revision}
            aria-current={current || undefined} aria-pressed={node.revision === entry?.revision}
            onClick={event => { if (event.detail === 0) setSelected(node.revision); }}>
            <span className="mc-revision-card-heading"><strong>v{node.revision}</strong>
              <span className="mc-revision-card-labels">{current && <span className="mc-revision-card-current">{t("current")}</span>}
                <Tag tone={node.actor === "user" ? "info" : "neutral"}>{t(`revisionActor.${node.actor || "unknown"}`)}</Tag>
              </span></span>
            <ModelThumbnail entry={{ key: `v${node.revision}`, revision: node.revision }} load={load} />
            <span className="mc-revision-card-summary" title={node.summary}>{node.summary || t("savedVersion")}</span>
          </Button>;
        })}
      </div>
  </RevisionMap>;
  return <section id="mc-version-library" className="mc-version-library" aria-label={t("versionLibrary")}>
    <RevisionRecord key={entry?.revision || "unsaved"} project={project} entry={entry} runs={allRuns}
      historyError={historyError} historyLoading={historyLoading}
      request={request} language={language} disabled={disabled} onSelect={onSelect} onClose={onClose}
      onPreview={onPreview} onTimelapse={onTimelapse} onCurrent={() => setSelected(project.head)} renderVersions={renderVersions} t={t} />
  </section>;
}
