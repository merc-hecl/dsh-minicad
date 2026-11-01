import React, { useId, useState } from "react";
import {
  Button,
  SettingsValueField,
  StateDot,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { validateIdFormats } from "../shared/geometry-ids.js";
import { WorkbenchDialog } from "./workbench-dialog.jsx";

export function IdSettingsDialog({
  settings,
  busy,
  error,
  onSave,
  onClose,
  t,
}) {
  const id = useId();
  const [formats, setFormats] = useState(settings);
  let invalid = false;
  try {
    validateIdFormats(formats);
  } catch {
    invalid = true;
  }
  return (
    <WorkbenchDialog
      title={t("idSettings")}
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
            onClick={() => onSave(formats)}
          >
            {t("saveSettings")}
          </Button>
        </>
      }
    >
      {["faceFormat", "edgeFormat"].map((key) => (
        <SettingsValueField
          key={key}
          id={`${id}-${key}`}
          label={t(key)}
          text={formats[key]}
          disabled={busy}
          invalid={formats[key].split("{n}").length !== 2}
          invalidLabel={t("invalidIdFormat")}
          onEdit={(text) =>
            setFormats((current) => ({ ...current, [key]: text }))
          }
        />
      ))}
    </WorkbenchDialog>
  );
}
