import React from "react";
import { Button, IconCloseOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";

export function InstrumentPanel({ note, part, recording, count, onToggleRecording, onExport, onClose, t }) {
  return <section className="mc-instrument mc-panel" aria-label={t("instrument")}>
    <div className="mc-instrument-head">
      <strong>{t("instrument")}</strong>
      <Button variant="ghost" size="sm" icon={<IconCloseOutlineRegular size={14} />} aria-label={t("close")} onClick={onClose} />
    </div>
    <div className="mc-instrument-note">
      <strong>{note || "—"}</strong>
      <span title={part || undefined}>{part}</span>
    </div>
    <div className="mc-instrument-actions">
      <Button variant="ghost" size="sm" aria-pressed={recording} onClick={onToggleRecording}>
        {t(recording ? "instrumentStop" : "instrumentRecord")}
      </Button>
      <Button variant="outline" size="sm" disabled={!count} onClick={onExport} aria-label={t("instrumentExport")}>
        {t("instrumentExport")}
      </Button>
      <span className="mc-instrument-count">{t("instrumentNotes", { count })}</span>
    </div>
  </section>;
}
