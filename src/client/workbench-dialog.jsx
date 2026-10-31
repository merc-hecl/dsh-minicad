import React, { useState } from "react";
import { CodeBlock, DisclosureRow, Modal } from "@deepseek-ai/dsh-client-ui-primitives";

export function ErrorDetails({ detail, t }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <DisclosureRow
      title={t("details")}
      open={expanded}
      expandable
      expandOnRowClick
      onToggle={() => setExpanded((current) => !current)}
    >
      <CodeBlock code={detail} showHeader={false} />
    </DisclosureRow>
  );
}

// DSH 0.2.1-rc.5 owns modal chrome, focus, dismissal and animation.
// Local classes only constrain content size and scrolling.
export function WorkbenchDialog({ busy, error, onClose, t, children, className = "", ...props }) {
  return (
    <Modal
      {...props}
      open
      closeLabel={t("close")}
      onClose={() => {
        if (!busy) onClose();
      }}
      className={`mc-dialog ${className}`}
      contentClassName="mc-dialog-content"
    >
      {error && (
        <div role="alert" className="mc-dialog-error">
          <p>{t(error.key)}</p>
          {error.detail && <ErrorDetails detail={error.detail} t={t} />}
        </div>
      )}
      {children}
    </Modal>
  );
}
