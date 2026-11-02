import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Button, IconChevronDownOutlineRegular, IconCloseOutlineRegular,
  IconCheckOutlineRegular, pointerModality, useDismissOnOutsidePointer } from "@deepseek-ai/dsh-client-ui-primitives";
import { PluginIcon } from "./plugin-icon.jsx";

export const ConversationDock = forwardRef(function ConversationDock({ children, running, progress, error,
  hidden, t, sourceKey, onCancel, onRunning, onStart }, ref) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [native, setNative] = useState({ running: false, waiting: false, pending: false, inputEmpty: false });
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const input = useRef(null), wasRunning = useRef(false);
  const baseline = useRef(null), stopped = useRef(false);
  const statusPanel = useRef(null), hoverTimer = useRef(null), pinned = useRef(false);
  const closeExpanded = useCallback(() => {
    clearTimeout(hoverTimer.current); pinned.current = false; setExpanded(false);
  }, []);
  useDismissOnOutsidePointer(statusPanel, expanded, closeExpanded);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const alive = running || native.running || pending;
  const phase = native.waiting ? "waiting" : error ? "error" : alive
    ? ["working", "validating"].includes(progress?.phase) ? progress.phase
      : progress?.phase === "done" && progress.id !== baseline.current ? "validating" : "planning"
    : feedback;
  const reveal = () => { closeExpanded(); setOpen(true); };
  useImperativeHandle(ref, () => ({ reveal, dismissEmpty() {
    if (open && native.inputEmpty && !input.current?.querySelector("[data-composer-composing]")) setOpen(false);
  }, keyDown(event) {
    if (event.defaultPrevented || event.isComposing) return;
    const editing = event.target.closest('input,textarea,[contenteditable="true"],button,a,[role="button"],[role="tab"],[role="dialog"],[role="menu"]');
    if (event.key === "Escape" && expanded) { event.preventDefault(); closeExpanded(); }
    else if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); }
    else if (event.key === "Enter" && !editing && !hidden && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault(); reveal();
    }
  } }));
  useEffect(() => {
    setOpen(false); setFeedback(null); setPending(false); closeExpanded();
    setNative({ running: false, waiting: false, pending: false, inputEmpty: false }); wasRunning.current = false; baseline.current = null; stopped.current = false;
  }, [sourceKey]);
  useEffect(() => {
    if (native.running || running || !native.pending) setPending(false);
    onRunning(native.running);
    if (native.waiting) reveal();
  }, [native.running, native.waiting, native.pending, running]);
  useEffect(() => {
    if (!wasRunning.current && alive) baseline.current = ["working", "validating"].includes(progress?.phase) ? null : progress?.id;
    if (wasRunning.current && !alive) setFeedback(stopped.current ? "stopped" : progress?.id !== baseline.current && progress?.phase === "done" ? "done"
      : progress?.id !== baseline.current && progress?.phase === "error" ? "error" : progress?.phase === "stopped" ? "stopped" : "waiting");
    wasRunning.current = alive;
  }, [alive, progress?.phase]);
  useEffect(() => {
    if (phase !== "done" || expanded) return;
    const timer = setTimeout(() => setFeedback(null), 2400);
    return () => clearTimeout(timer);
  }, [phase, expanded]);
  useEffect(() => {
    if (!open || hidden) return;
    const timer = setTimeout(() => input.current?.querySelector('[contenteditable="true"]')?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(timer);
  }, [open, hidden]);
  const last = progress?.steps.at(-1);
  const label = phase === "working" && last
    ? last.label || t(last.operation || "modeling")
    : phase === "waiting" && progress?.phase === "preview" ? t("trialReady") : t(`taskStatus.${phase}`);
  return <>
    <section ref={input} className="mc-bottom mc-native-input" data-open={open && !hidden || undefined} data-instant={!pointerModality() || undefined}
      inert={!open || hidden ? "" : undefined} aria-hidden={!open || hidden}>
      {children({ onSubmitted: () => { stopped.current = false; onStart(); setOpen(false); setFeedback(null); closeExpanded(); if (!running && !native.running) setPending(true); },
        onSessionState: setNative,
        onRestored: () => { setPending(false); setFeedback("error"); reveal(); } })}
    </section>
    {!open && !hidden && phase ? <div ref={statusPanel} className="mc-task-status-anchor"
      onPointerEnter={event => {
        if (event.pointerType !== "mouse" || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => setExpanded(true), 150);
      }}
      onPointerLeave={() => { clearTimeout(hoverTimer.current); if (!pinned.current && !statusPanel.current?.contains(document.activeElement)) setExpanded(false); }}>
      <div className="mc-task-status" data-state={phase} data-expanded={expanded || undefined} data-instant={!pointerModality() || undefined}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) closeExpanded(); }}>
        <Button className="mc-task-status-main" variant="ghost" onClick={() => { pinned.current = !pinned.current; setExpanded(pinned.current); }} aria-expanded={expanded}>
          <span className="mc-task-status-mark">{phase === "done" ? <IconCheckOutlineRegular size={20} /> : <PluginIcon size={20} />}</span>
          <span className="mc-task-status-label" role="status">{label}</span><IconChevronDownOutlineRegular size={14} />
        </Button>
        {expanded && <div className="mc-task-status-details">
          {last && <span className="mc-muted">{t("checkpoint")} {last.sequence}</span>}
          {progress?.error && <p className="mc-task-status-error">{progress.error}</p>}
          <div className="mc-task-status-actions">
            <Button variant="ghost" size="sm" onClick={reveal}>{t(phase === "waiting" ? "answer" : "openInput")}</Button>
            {alive && <Button variant="ghost" size="sm" icon={<IconCloseOutlineRegular size={14} />} onClick={() => { stopped.current = true; setFeedback("stopped"); onCancel(); }}>{t("stop")}</Button>}
          </div>
        </div>}
      </div>
    </div> : !open && !hidden ? <Button className="mc-input-peek" variant="ghost" aria-label={t("openInput")} icon={<PluginIcon size={24} />} onClick={reveal} /> : null}
  </>;
});
