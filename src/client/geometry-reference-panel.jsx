import React, { useId, useState } from "react";
import { Button, StateDot, IconCloseOutlineRegular, IconContextInjectionOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import { GeometryPanel } from "./geometry-panel.jsx";

export function GeometryReferencePanel({ targets, busy, error, onRemove, onClose, onAdd, t }) {
  const id = useId();
  const [note, setNote] = useState("");
  const addReference = event => {
    event.preventDefault();
    if (!busy) onAdd({ note });
  };
  return <GeometryPanel title={t("referenceTargets")} busy={busy} error={error} onClose={onClose} t={t}>
    <form className="mc-geometry-form" onSubmit={addReference}>
      <div className="mc-geometry-targets">{targets.map(target => <Button key={target.reference} type="button" variant="ghost" size="sm" className="mc-geometry-target" disabled={busy} onClick={() => onRemove(target.reference)}
        title={target.reference} aria-label={`${t("removeSelectionTarget")} ${target.label}`}>
        {target.label}<IconCloseOutlineRegular size={10} />
      </Button>)}</div>
      <label className="mc-geometry-note-label" htmlFor={`${id}-note`}>{t("geometryComment")}
        <span className="mc-geometry-note-field">
          <textarea id={`${id}-note`} value={note} rows={3} disabled={busy} onChange={event => setNote(event.target.value)} />
        </span>
      </label>
      <footer className="mc-geometry-footer">
        <Button type="submit" variant="primary" size="sm" disabled={busy} icon={busy ? <StateDot state="ongoing" /> : <IconContextInjectionOutlineRegular size={16} />}>{t("addReference")}</Button>
      </footer>
    </form>
  </GeometryPanel>;
}
