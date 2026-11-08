import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, StateDot, TextShimmer, Tooltip, IconChevronDownOutlineRegular, IconCloseOutlineRegular,
  IconCheckOutlineRegular, IconQuestionOutlineRegular, IconWarningOutlineRegular, IconStopFillRegular,
  pointerModality, useDismissOnOutsidePointer } from "@deepseek-ai/dsh-client-ui-primitives";
import { PluginIcon } from "./plugin-icon.jsx";
import { useFloatingInput } from "./use-floating-input.js";

const EMPTY = { running: false, waiting: false, pending: false, todos: [], activities: [] };
export const ConversationDock = forwardRef(function ConversationDock({ children, running,
  hidden, embedded, t, statusTarget, revision, latestRevision, onCancel, onRunning, onStart, onSessionRecord, onReveal }, ref) {
  const [open, setOpen] = useState(false), [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [native, setNative] = useState(EMPTY), [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState(null), [dismissed, setDismissed] = useState(false);
  const input = useRef(null), statusPanel = useRef(null), wasRunning = useRef(false);
  const baseline = useRef(latestRevision), stopped = useRef(false);
  const closeExpanded = useCallback(() => setExpanded(false), []);
  useDismissOnOutsidePointer(statusPanel, expanded, closeExpanded);
  const alive = running || native.running || pending;
  const terminalPhase = ["error", "interrupted", "max-tokens"].includes(native.terminal) ? "error"
    : native.terminal === "aborted" ? "stopped" : null;
  const phase = native.waiting ? "waiting" : alive ? "working" : !dismissed && native.failure ? "error"
    : feedback ? terminalPhase || feedback : null;
  const visible = !hidden && !embedded && (open || native.waiting);
  const togglePinned = () => setPinned(value => !value);
  const floating = useFloatingInput(input, visible, native.waiting, statusTarget, togglePinned);
  const reveal = point => {
    if (embedded) onReveal();
    floating.revealAt(pinned ? undefined : point); setOpen(true); setExpanded(false);
  };
  const dismiss = () => {
    if (native.waiting || pinned) return;
    floating.cancelDrag(); setOpen(false);
    input.current?.closest(".mc-workbench")?.focus({ preventScroll: true });
  };
  useImperativeHandle(ref, () => ({ reveal, dismiss, keyDown(event) {
    if (event.defaultPrevented || event.isComposing || hidden || embedded) return;
    if (event.key === "Escape" && event.target.closest('[role="dialog"],[role="menu"],[data-trigger-menu]')) return;
    if (event.key === "Escape" && floating.cancelDrag()) { event.preventDefault(); return; }
    const editing = event.target.closest('input,textarea,[contenteditable="true"],button,a,[role="button"],[role="tab"],[role="dialog"],[role="menu"]');
    if (event.key === "Escape" && expanded) { event.preventDefault(); setExpanded(false); }
    else if (event.key === "Escape" && visible && !pinned && !native.waiting) {
      event.preventDefault(); dismiss();
    } else if (event.key === "Enter" && !editing && !hidden && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault(); reveal();
    }
  } }));
  useEffect(() => {
    if (native.running || running || !native.pending) setPending(false);
    onRunning(native.running);
  }, [native.running, native.pending, running, onRunning]);
  useEffect(() => {
    if (!wasRunning.current && alive) {
      baseline.current = latestRevision; stopped.current = false;
      setFeedback(null); setDismissed(false);
    }
    if (wasRunning.current && !alive) {
      const result = stopped.current || native.terminal === "aborted" ? "stopped"
        : native.failure || feedback === "error" || ["error", "interrupted", "max-tokens"].includes(native.terminal) ? "error" : "done";
      setFeedback(result);
      if (result !== "done") setExpanded(true);
    }
    wasRunning.current = alive;
  }, [alive, native.terminal, native.failure, latestRevision]);
  const completed = native.todos.filter(todo => todo.status === "completed").length;
  const saved = latestRevision > baseline.current;
  const label = phase === "working" ? native.activity || (native.modelName ? t("agentWorking", { model: native.modelName }) : t("working"))
    : phase === "waiting" ? t(native.interaction === "approval" ? "agentApproval" : native.interaction === "plan-review" ? "agentPlanReview" : "taskStatus.waiting")
      : phase === "done" ? saved ? t("agentSaved", { version: latestRevision }) : t("agentDone")
        : phase ? t(`taskStatus.${phase}`) : t("openInput");
  const failure = native.failure || (native.terminal === "interrupted" ? t("agentInterrupted")
    : native.terminal === "max-tokens" ? t("agentTokenLimit") : "");
  const Mark = phase === "done" ? IconCheckOutlineRegular : phase === "waiting" ? IconQuestionOutlineRegular
    : phase === "error" ? IconWarningOutlineRegular : phase === "stopped" ? IconStopFillRegular : PluginIcon;
  const status = <div ref={statusPanel} className="mc-task-status-anchor">
    <div className="mc-task-status" data-state={phase || "idle"} data-expanded={expanded || undefined} data-instant={!pointerModality() || undefined}>
      <Button className="mc-task-status-main" variant="ghost" onClick={() => native.waiting ? setExpanded(false) : phase ? setExpanded(value => !value) : reveal()}
        aria-expanded={phase ? expanded : undefined} aria-label={label} title={label}>
        <span className="mc-task-status-mark">{phase === "working" ? <StateDot state="ongoing" /> : <Mark size={16} />}</span>
        {phase && <span className="mc-task-status-label" role="status">{phase === "working" ? <TextShimmer active>{label}</TextShimmer> : label}</span>}
        {native.todos.length > 0 && phase && <span className="mc-task-count">{completed}/{native.todos.length}</span>}
        {phase && <IconChevronDownOutlineRegular className="mc-status-chevron" size={14} />}
      </Button>
      {alive && !native.waiting && <Button variant="ghost" className="mc-status-stop" aria-label={t("stop")} title={t("stop")}
        icon={<IconStopFillRegular size={14} />} onClick={() => { stopped.current = true; onCancel(); }} />}
    </div>
    {expanded && phase && !native.waiting && <section className="mc-task-status-details mc-panel" aria-label={label}>
      <div className="mc-task-status-content mc-panel-scroll">
        <div className="mc-status-detail-heading"><strong>{label}</strong><Button variant="ghost" size="sm" aria-label={t("closeStatus")}
          icon={<IconCloseOutlineRegular size={14} />} onClick={closeExpanded} /></div>
        {native.activityDetail && <p className="mc-status-current">{native.activityDetail}</p>}
        {failure && <p className="mc-task-status-error">{failure}</p>}
        {(phase === "stopped" || phase === "error") && <p className="mc-muted">{t(revision > 0 ? "agentRetained" : "agentNoVersion", { version: revision })}</p>}
        {native.todos.length > 0 && <><div className="mc-task-list-heading"><span>{t("agentTasks")}</span><span>{completed}/{native.todos.length}</span></div>
          <ol className="mc-agent-tasks">{native.todos.map((todo, index) => <li key={index} data-state={todo.status}>
            <span role="img" aria-label={t(`agentTask.${todo.status}`)}><StateDot state={todo.status === "completed" ? "done" : todo.status === "in_progress" ? "ongoing" : "idle"} /></span><span>{todo.content}</span>
          </li>)}</ol></>}
        {native.activities.length > 0 && <details className="mc-agent-activities"><summary>{t("agentActivities")}</summary>
          {native.activities.map(item => <div key={item.kind}><span>{item.label}</span><span>{item.count}</span></div>)}
        </details>}
        <div className="mc-task-status-actions">
          <Button variant="ghost" size="sm" onClick={() => native.waiting ? setExpanded(false) : reveal()}>{t(native.waiting ? "answer" : "openInput")}</Button>
          <Button variant="ghost" size="sm" onClick={() => { closeExpanded(); onSessionRecord(); }}>{t("sessionRecord")}</Button>
          {!alive && !native.waiting && <Button variant="ghost" size="sm" onClick={() => { setFeedback(null); setDismissed(true); closeExpanded(); }}>{t("dismissStatus")}</Button>}
        </div>
      </div>
    </section>}
  </div>;
  return <>
    <section ref={input} className="mc-bottom mc-native-input" {...floating.handlers}
      data-open={visible || undefined} data-waiting={native.waiting || undefined} data-instant={!pointerModality() || undefined}
      inert={!visible ? "" : undefined} aria-hidden={!visible} aria-label={t(native.waiting ? "answer" : "openInput")}>
      {!native.waiting && <Tooltip label={t(pinned ? "unpinInput" : "pinInput")} portal>
        <Button className="mc-input-grip" variant="ghost" aria-pressed={pinned}
          aria-label={t(pinned ? "unpinInput" : "pinInput")} onKeyDown={floating.nudge}
          onClick={event => { if (event.detail === 0) togglePinned(); }}><span aria-hidden="true" /></Button>
      </Tooltip>}
      {children({ onSubmitted: () => { onStart(); setOpen(pinned); setFeedback(null); setDismissed(false); setExpanded(false);
        if (!running && !native.running) setPending(true); }, onSessionState: setNative,
      onRestored: () => { setPending(false); setFeedback("error"); reveal(); } })}
    </section>
    {statusTarget && !hidden && createPortal(status, statusTarget)}
  </>;
});
