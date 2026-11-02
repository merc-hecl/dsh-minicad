import React, { useId, useState } from "react";
import { Button, Menu, SettingsValueField, StateDot, IconChevronDownOutlineRegular, IconCloseOutlineRegular, IconContextInjectionOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import { GeometryPanel } from "./geometry-panel.jsx";

export function GeometryActionPanel({ mode, targets, busy, error, onRemove, onClose, onSave, t }) {
  const id = useId();
  const annotation = mode === "annotation";
  const faces = targets[0]?.kind === "faces";
  const operations = faces ? ["offset_faces", "move_faces", "remove_faces", "remove_fillets"] : ["fillet", "chamfer"];
  const [operation, setOperation] = useState(operations[0]);
  const [menu, setMenu] = useState(false);
  const [values, setValues] = useState({ distance: "1", x: "0", y: "0", z: "0" });
  const [note, setNote] = useState("");
  const fields = operation === "move_faces" ? ["x", "y", "z"] : ["remove_faces", "remove_fillets"].includes(operation) ? [] : ["distance"];
  const invalid = !annotation && fields.some(key => !values[key].trim() || !Number.isFinite(Number(values[key])) || (["fillet", "chamfer"].includes(operation) && Number(values[key]) <= 0));
  const save = event => {
    event.preventDefault();
    if (busy || invalid) return;
    if (annotation) { onSave({ note }); return; }
    const references = targets.map(target => target.reference);
    const op = { op: operation, [faces ? "faces" : "edges"]: references.length === 1 ? references[0] : references };
    if (operation === "move_faces") op.by = ["x", "y", "z"].map(key => Number(values[key]));
    if (["offset_faces", "chamfer"].includes(operation)) op.distance = Number(values.distance);
    if (operation === "fillet") op.radius = Number(values.distance);
    onSave({ operation: op });
  };
  return <GeometryPanel title={t(annotation ? "referenceTargets" : faces ? "editFaces" : "editEdges")} busy={busy} error={error} onClose={onClose} t={t}>
    <form className="mc-geometry-form" onSubmit={save}>
      <div className="mc-geometry-targets">{targets.map(target => <Button key={target.reference} type="button" variant="ghost" size="sm" className="mc-geometry-target" disabled={busy} onClick={() => onRemove(target.reference)}
        title={target.reference} aria-label={`${t("removeSelectionTarget")} ${target.label}`}>
        {target.label}<IconCloseOutlineRegular size={10} />
      </Button>)}</div>
      {annotation ? <label className="mc-geometry-note-label" htmlFor={`${id}-note`}>{t("geometryComment")}
        <textarea id={`${id}-note`} value={note} rows={3} disabled={busy} onChange={event => setNote(event.target.value)} />
      </label> : <>
        <div className="mc-geometry-operation"><span>{t("operation")}</span>
          <Menu open={menu} onClose={() => setMenu(false)} portal autoFocus minWidthFromAnchor selectedId={operation}
            anchor={<Button type="button" variant="outline" className="mc-operation-picker" disabled={busy} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(value => !value)}>{t(operation)}<IconChevronDownOutlineRegular size={14} /></Button>}
            items={operations.map(value => ({ id: value, label: t(value) }))} onSelect={value => { setOperation(value); setMenu(false); }} />
        </div>
        {fields.map(key => <SettingsValueField key={key} id={`${id}-${key}`} label={key === "distance" ? `${t(operation === "fillet" ? "radius" : "distance")} (mm)` : `${key.toUpperCase()} (mm)`}
          text={values[key]} numeric disabled={busy} onEdit={text => setValues(current => ({ ...current, [key]: text }))} />)}
      </>}
      <footer className="mc-geometry-footer">
        {!annotation && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>{t("cancel")}</Button>}
        <Button type="submit" variant="primary" size="sm" disabled={busy || invalid} icon={busy ? <StateDot state="ongoing" /> : annotation ? <IconContextInjectionOutlineRegular size={16} /> : undefined}>{t(annotation ? "addReference" : "saveGeometry")}</Button>
      </footer>
    </form>
  </GeometryPanel>;
}
