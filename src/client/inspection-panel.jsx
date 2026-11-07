import React, { useState } from "react";
import { Button, Menu, Switch, Tooltip, IconChevronDownOutlineRegular, IconCloseOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";

function VisibilityIcon({ hidden }) {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M1.5 8s2.3-4.5 6.5-4.5S14.5 8 14.5 8s-2.3 4.5-6.5 4.5S1.5 8 1.5 8Z" />
    <circle cx="8" cy="8" r="2" />{hidden && <path d="m2 2 12 12" strokeWidth="1.5" />}
  </svg>;
}

export function InspectionPanel({ project, parts, hidden, setHidden, transparent, setTransparent, onModel, onClose, busy, t }) {
  const [modelMenu, setModelMenu] = useState(false);
  return <section id="mc-model-inspection" className="mc-inspection mc-panel" aria-label={t("inspectModel")}>
    <div className="mc-inspection-content mc-panel-scroll">
      <header><strong>{t("inspectModel")}</strong><Button variant="ghost" size="sm" icon={<IconCloseOutlineRegular size={14} />} aria-label={t("close")} onClick={onClose} /></header>
      {project.models.length > 1 && <Menu portal open={modelMenu} onClose={() => setModelMenu(false)} selectedIds={[project.sourceFile]}
        anchor={<Button className="mc-inspection-model-picker" variant="outline" disabled={busy} aria-haspopup="menu" aria-expanded={modelMenu}
          aria-label={t("modelSpecifications")} onClick={() => setModelMenu(value => !value)}>
          <span title={project.sourceFile}>{project.sourceFile}</span><IconChevronDownOutlineRegular size={14} />
        </Button>}
        items={project.models.map(model => ({ id: model.sourceFile, label: model.sourceFile }))}
        onSelect={id => { setModelMenu(false); if (id !== project.sourceFile) onModel(id); }} />}
      <div className="mc-inspection-actions"><span>{t("transparentView")}</span>
        <Switch checked={transparent} onChange={setTransparent} label={t("transparentView")} />
      </div>
      {!!parts?.length && <>
        <div className="mc-inspection-actions mc-inspection-parts-heading"><strong>{t("assemblyParts")}</strong>
          <Button variant="ghost" size="sm" disabled={!hidden.length} onClick={() => setHidden([])}>{t("showAllParts")}</Button></div>
        <div className="mc-inspection-parts">{parts.map(part => {
          const invisible = hidden.includes(part.id);
          const visibilityLabel = t(invisible ? "showPart" : "hidePart") + " · " + part.name;
          return <div key={part.id} className="mc-inspection-part" data-hidden={invisible || undefined}>
            <Tooltip label={visibilityLabel} portal><Button variant="ghost" size="sm" className="mc-part-visibility" aria-label={visibilityLabel}
              icon={<VisibilityIcon hidden={invisible} />} onClick={() => {
                setHidden(invisible ? hidden.filter(id => id !== part.id) : [...hidden, part.id]);
              }} /></Tooltip>
            <span className="mc-part-name" title={part.name + " · " + part.id}>{part.name}</span>
          </div>;
        })}</div>
      </>}
    </div>
  </section>;
}

// Filter display triangles and edges, retaining the original geometry IDs.
export function visiblePreview(preview, parts, hidden) {
  if (!preview || !parts?.length || !hidden.length) return preview;
  const visible = parts.filter(part => !hidden.includes(part.id));
  const face = index => visible.some(part => index >= part.faceStart && index < part.faceStart + part.faceCount);
  const edge = index => visible.some(part => index >= part.edgeStart && index < part.edgeStart + part.edgeCount);
  const triangles = [], faces = [], edges = [], edgeIds = [];
  preview.faceIndices.forEach((index, i) => {
    if (face(index)) { faces.push(index); triangles.push(...preview.indices.subarray(i * 3, i * 3 + 3)); }
  });
  preview.edgeIndices.forEach((index, i) => {
    if (edge(index)) { edgeIds.push(index); edges.push(...preview.edges.subarray(i * 6, i * 6 + 6)); }
  });
  return { ...preview, indices: new Uint32Array(triangles), faceIndices: new Uint32Array(faces), edges: new Float32Array(edges), edgeIndices: new Uint32Array(edgeIds) };
}
