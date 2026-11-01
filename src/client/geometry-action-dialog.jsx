import React, { useId, useState } from "react";
import {
  Button,
  SegmentedControl,
  SettingsValueField,
  StateDot,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { WorkbenchDialog } from "./workbench-dialog.jsx";

export function GeometryActionDialog({
  action,
  busy,
  error,
  onClose,
  onSave,
  t,
}) {
  const id = useId();
  const annotation = action.mode === "annotation";
  const ops =
    action.target.kind === "faces"
      ? ["offset_faces", "move_faces", "remove_faces", "remove_fillets"]
      : ["fillet", "chamfer"];
  const [operation, setOperation] = useState(ops[0]);
  const [values, setValues] = useState({
    distance: "1",
    x: "0",
    y: "0",
    z: "0",
  });
  const [note, setNote] = useState("");
  const fields =
    operation === "move_faces"
      ? ["x", "y", "z"]
      : ["remove_faces", "remove_fillets"].includes(operation)
        ? []
        : ["distance"];
  const invalid =
    !annotation &&
    fields.some(
      (key) =>
        !values[key].trim() ||
        !Number.isFinite(Number(values[key])) ||
        (["fillet", "chamfer"].includes(operation) && Number(values[key]) <= 0),
    );
  const save = () => {
    if (annotation) {
      onSave({ note });
      return;
    }
    const target = action.target.reference;
    const op = { op: operation };
    if (action.target.kind === "faces") op.faces = target;
    else op.edges = target;
    if (operation === "move_faces")
      op.by = ["x", "y", "z"].map((key) => Number(values[key]));
    if (["offset_faces", "chamfer"].includes(operation))
      op.distance = Number(values.distance);
    if (operation === "fillet") op.radius = Number(values.distance);
    onSave({ operation: op });
  };
  return (
    <WorkbenchDialog
      className="mc-geometry-dialog"
      title={`${t(annotation ? "referenceGeometry" : "editGeometry")} · ${action.target.label}`}
      busy={busy}
      error={error}
      onClose={onClose}
      t={t}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={busy || invalid}
            icon={busy ? <StateDot state="ongoing" /> : undefined}
            onClick={save}
          >
            {t(annotation ? "addReference" : "saveGeometry")}
          </Button>
        </>
      }
    >
      {annotation ? (
        <SettingsValueField
          id={`${id}-note`}
          label={t("geometryComment")}
          text={note}
          disabled={busy}
          onEdit={setNote}
        />
      ) : (
        <>
          <SegmentedControl
            id={id}
            label={t("editGeometry")}
            value={operation}
            options={ops.map((value) => ({ value, label: t(value) }))}
            onChange={setOperation}
            disabled={busy}
          />
          {fields.map((key) => (
            <SettingsValueField
              key={key}
              id={`${id}-${key}`}
              label={
                key === "distance"
                  ? `${t(operation === "fillet" ? "radius" : "distance")} (mm)`
                  : `${key.toUpperCase()} (mm)`
              }
              text={values[key]}
              numeric
              disabled={busy}
              onEdit={(text) =>
                setValues((current) => ({ ...current, [key]: text }))
              }
            />
          ))}
        </>
      )}
    </WorkbenchDialog>
  );
}
