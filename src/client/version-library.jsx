import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import { RevisionRecord, ModelThumbnail } from "./revision-record.jsx";
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
  const tree = useCallback(element => {
    element?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [entry?.revision]);

  const renderVersions = load => <>
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
          return <Button key={node.revision} className="mc-revision-node mc-panel" variant="ghost" size="sm"
            style={{ left: node.x, top: node.y, width: nodeWidth, height: nodeHeight }}
            aria-current={current || undefined} aria-pressed={node.revision === entry?.revision}
            onClick={() => setSelected(node.revision)}>
            <span className="mc-revision-card-heading"><strong>v{node.revision}</strong>
              {current && <span>{t("current")}</span>}</span>
            <ModelThumbnail entry={{ key: `v${node.revision}`, revision: node.revision }} load={load} />
            <span className="mc-revision-card-summary" title={node.summary}>{node.summary || t("savedVersion")}</span>
          </Button>;
        })}
      </div>
      {!nodes.size && <div className="mc-revision-empty">{t("noSavedVersions")}</div>}
    </div>
  </>;
  return <section id="mc-version-library" className="mc-version-library" aria-label={t("versionLibrary")}>
    <RevisionRecord key={entry?.revision || "unsaved"} project={project} entry={entry} runs={allRuns}
      historyError={historyError} historyLoading={historyLoading}
      request={request} language={language} disabled={disabled} onSelect={onSelect} onClose={onClose}
      onPreview={onPreview} onTimelapse={onTimelapse} onCurrent={() => setSelected(project.head)} renderVersions={renderVersions} t={t} />
  </section>;
}
