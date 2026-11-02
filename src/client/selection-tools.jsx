import React, { useRef } from "react";
import { Button, Tooltip, IconContextInjectionOutlineRegular, IconEditOutlineRegular, IconCloseOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import { GeometryActionPanel } from "./geometry-action-panel.jsx";
import { MeasurementPanel } from "./measurement-panel.jsx";

function Ruler({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <g transform="rotate(-45 12 12)"><rect x="3" y="8" width="18" height="8" rx="1.5" /><path d="M7 8v3 M10 8v2 M13 8v3 M16 8v2" /></g>
  </svg>;
}

export function SelectionTools({ targets, tool, onToolChange, onClear, onRemove, referenceDisabled, editingDisabled, busy, error, project, request, onResult, onSave, t }) {
  // Preserve the last label during the CSS exit, without retaining active reads.
  const lastTargets = useRef(targets);
  if (targets.length) lastTargets.current = targets;
  const summary = lastTargets.current.length === 1 ? lastTargets.current[0].label : t("selectionCount", { count: lastTargets.current.length });
  const mixed = targets.some(target => target.kind !== targets[0]?.kind);
  const actions = [
    { key: "measure", label: "measureGeometry", Icon: Ruler, disabled: !targets.length || targets.length > 2, hint: "measurementSelectionLimit" },
    { key: "annotation", label: "referenceGeometry", Icon: IconContextInjectionOutlineRegular, disabled: referenceDisabled },
    { key: "edit", label: "modifyGeometry", Icon: IconEditOutlineRegular, disabled: editingDisabled || mixed, hint: mixed ? "sameKindEditingHint" : undefined },
  ];
  return <>
    <div className="mc-selection-bar mc-panel" role="toolbar" aria-label={t("selectionActions")} onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const buttons = [...event.currentTarget.querySelectorAll("button:not(:disabled)")];
      const index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }}>
      <span className="mc-selection-summary" title={lastTargets.current.map(target => `${target.label}\n${target.reference}`).join("\n")}>{summary}</span>
      <span className="mc-selection-divider" aria-hidden="true" />
      {actions.map(({ key, label, Icon, disabled, hint }) => <Tooltip key={key} label={t(disabled && hint ? hint : label)} portal>
        <span className="mc-selection-action"><Button type="button" variant="ghost" size="sm" icon={<Icon size={16} />} aria-pressed={tool === key} disabled={busy || disabled}
          onClick={() => onToolChange(tool === key ? null : key)}>{t(label)}</Button></span>
      </Tooltip>)}
      <Button variant="ghost" size="sm" className="mc-selection-clear" icon={<IconCloseOutlineRegular size={14} />} aria-label={t("clearSelection")} disabled={busy} onClick={onClear} />
    </div>
    {targets.length > 0 && tool && <div className="mc-selection-body">
      {tool === "measure" && targets.length <= 2 ? <MeasurementPanel targets={targets} onClose={() => onToolChange(null)} project={project} request={request} onResult={onResult} t={t} />
        : tool !== "measure" && !(tool === "edit" && mixed) && <GeometryActionPanel key={tool === "annotation" ? tool : `${tool}-${targets[0].kind}`} mode={tool} targets={targets} busy={busy} error={error} onRemove={onRemove} onClose={() => onToolChange(null)} onSave={onSave} t={t} />}
    </div>}
  </>;
}
