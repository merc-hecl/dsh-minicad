import React from "react";
import { Button, IconCloseOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import { ErrorDetails } from "./workbench-dialog.jsx";

export function GeometryPanel({ title, busy, error, onClose, t, children }) {
  return <section className="mc-geometry-panel mc-panel" aria-label={title}>
    <header className="mc-geometry-panel-header"><strong>{title}</strong>
      <Button variant="ghost" size="sm" icon={<IconCloseOutlineRegular size={14} />} aria-label={t("close")} disabled={busy} onClick={onClose} />
    </header>
    {children}
    {error && <div className="mc-geometry-error" role="alert"><p>{t(error.key)}</p><ErrorDetails detail={error.detail} t={t} /></div>}
  </section>;
}
