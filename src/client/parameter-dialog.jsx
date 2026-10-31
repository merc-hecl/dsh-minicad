import React, { useId, useState } from "react";
import {
  Button,
  SettingsValueField,
  StateDot,
  Switch,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { WorkbenchDialog } from "./workbench-dialog.jsx";

export function ParameterDialog({ parameters, busy, error, onClose, onSave, t }) {
  const id = useId();
  const [fields, setFields] = useState(() =>
    Object.entries(parameters).map(([name, value]) => ({
      name,
      type: typeof value,
      text: typeof value === "object" ? JSON.stringify(value) : String(value),
      checked: value === true,
    })),
  );
  const values = [];
  const errors = fields.map((field) => {
    let value = field.text;
    if (field.type === "boolean") value = field.checked;
    if (field.type === "number") {
      value = Number(field.text);
      if (!field.text.trim() || !Number.isFinite(value)) return "invalidNumber";
    }
    if (field.type === "object") {
      try {
        value = JSON.parse(field.text);
      } catch {
        return "invalidJSON";
      }
    }
    values.push([field.name, value]);
    return null;
  });
  const invalid = errors.some(Boolean);
  const edit = (index, patch) =>
    setFields((current) =>
      current.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    );

  return (
    <WorkbenchDialog
      title={t("parameters")}
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
            onClick={() => onSave(Object.fromEntries(values))}
          >
            {t(busy ? "working" : "save")}
          </Button>
        </>
      }
    >
      {!fields.length && <p>{t("noParameters")}</p>}
      {fields.map((field, index) =>
        field.type === "boolean" ? (
          <div className="mc-parameter-toggle" key={field.name}>
            <span>{field.name}</span>
            <Switch
              label={field.name}
              checked={field.checked}
              disabled={busy}
              onChange={(checked) => edit(index, { checked })}
            />
          </div>
        ) : (
          <SettingsValueField
            key={field.name}
            id={`${id}-${index}`}
            label={field.name}
            text={field.text}
            numeric={field.type === "number"}
            disabled={busy}
            invalid={!!errors[index]}
            invalidLabel={errors[index] ? t(errors[index]) : undefined}
            onEdit={(text) => edit(index, { text })}
          />
        ),
      )}
    </WorkbenchDialog>
  );
}
