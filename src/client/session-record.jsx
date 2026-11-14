import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Button, StateDot, IconCloseOutlineRegular, IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";

const widthKey = "minicad.sessionRecord.width";
const savedWidth = () => {
  const value = Number(localStorage.getItem(widthKey));
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

export function SessionRecord({ open, title, turns, session, empty, waiting, onClose, onReaderTarget, loadEarlier, t }) {
  const closeButton = useRef(null), reader = useRef(null), panel = useRef(null), drag = useRef(null);
  const [width, setWidth] = useState(savedWidth);
  const [selected, setSelected] = useState(null);
  const selectedIndex = selected === null ? turns.length - 1 : turns.findIndex(turn => turn.turn === selected);
  const index = selectedIndex < 0 ? turns.length - 1 : selectedIndex;
  const active = turns[index];
  const mountReader = useCallback(element => { reader.current = element; onReaderTarget(element); }, [onReaderTarget]);
  const bounds = () => {
    const max = panel.current.parentElement.clientWidth;
    return { min: Math.min(parseFloat(getComputedStyle(panel.current).getPropertyValue("--mc-tool-panel-width")), max), max };
  };
  const dragWidth = event => {
    const gesture = drag.current;
    return Math.round(Math.max(gesture.min, Math.min(gesture.max, gesture.width + gesture.x - event.clientX)));
  };
  const finishResize = event => {
    const gesture = drag.current;
    if (!gesture || (event && gesture.id !== event.pointerId)) return;
    const value = event?.type === "pointerup" ? dragWidth(event) : gesture.width;
    drag.current = null;
    if (event?.type === "pointerup" && value !== Math.round(gesture.width)) {
      setWidth(value);
      localStorage.setItem(widthKey, String(value));
    } else setWidth(gesture.saved);
    delete panel.current.dataset.resizing;
    if (gesture.target.hasPointerCapture(gesture.id)) gesture.target.releasePointerCapture(gesture.id);
  };
  useLayoutEffect(() => {
    if (open) closeButton.current?.focus({ preventScroll: true });
    else { setSelected(null); finishResize(); }
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !active) return;
    const element = reader.current;
    const navigate = () => {
      // Navigate the existing native transcript without filtering or rebuilding it.
      const row = [...element.querySelectorAll(`[data-chat-turn="${active.turn}"]`)]
        .find(item => !item.closest("[hidden]"));
      if (!row) return false;
      row.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
      return true;
    };
    if (navigate()) return;
    const observer = new MutationObserver(() => { if (navigate()) observer.disconnect(); });
    observer.observe(element, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [open, active?.turn, selected]);
  const choose = next => setSelected(next === turns.length - 1 ? null : turns[next].turn);
  return <section className="mc-session-record" hidden={!open} aria-label={t("sessionRecord")}>
    <article id="mc-session-reader" ref={panel} className="mc-session-reader mc-panel" data-waiting={waiting || undefined}
      style={{ "--mc-session-reader-width": width === undefined ? undefined : `${width}px` }}>
      <Button className="mc-session-resize" variant="ghost" size="sm" aria-label={t("resizeSessionRecord")}
        aria-controls="mc-session-reader"
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0 || drag.current) return;
          event.preventDefault(); event.stopPropagation();
          event.currentTarget.focus({ preventScroll: true });
          drag.current = { id: event.pointerId, target: event.currentTarget, x: event.clientX,
            width: panel.current.getBoundingClientRect().width, saved: width, ...bounds() };
          panel.current.dataset.resizing = "";
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => { if (drag.current?.id === event.pointerId) setWidth(dragWidth(event)); }}
        onPointerUp={finishResize} onPointerCancel={finishResize} onLostPointerCapture={finishResize}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const { min, max } = bounds();
          const current = panel.current.getBoundingClientRect().width;
          const value = Math.round(event.key === "Home" ? min : event.key === "End" ? max
            : Math.max(min, Math.min(max, current + (event.key === "ArrowLeft" ? 24 : -24))));
          if (value !== Math.round(current)) { setWidth(value); localStorage.setItem(widthKey, String(value)); }
        }}><span aria-hidden="true" /></Button>
      <header className="mc-session-reader-bar">
        <strong title={title}>{t("sessionRecord")}</strong>
        <div className="mc-session-reader-actions">
          {session.hasMore && <Button variant="ghost" size="sm" disabled={session.loadingOlder} onClick={loadEarlier}>
            {t(session.loadingOlder ? "loading" : "earlierConversation")}
          </Button>}
          <Button ref={closeButton} variant="ghost" size="sm" icon={<IconCloseOutlineRegular size={16} />}
            aria-label={t("closeSessionRecord")} onClick={onClose} />
        </div>
      </header>
      <div className="mc-session-reader-content">
        <div ref={mountReader} className="mc-session-reader-mount" />
        {empty && <div className="mc-session-reader-empty" role="status">
          {session.openState === "loading" ? <><StateDot state="ongoing" />{t("loading")}</> : t("noConversationHistory")}
        </div>}
      </div>
      <footer className="mc-session-timeline" aria-label={t("conversationTurns")}>
        <Button variant="ghost" size="sm" icon={<IconChevronLeftOutlineRegular size={16} />}
          aria-label={t("previousTurn")} disabled={index <= 0} onClick={() => choose(index - 1)} />
        <span className="mc-session-position" role="status" aria-live="polite">
          {t("turnPosition", { n: index + 1, total: turns.length })}
        </span>
        <Button variant="ghost" size="sm" icon={<IconChevronRightOutlineRegular size={16} />}
          aria-label={t("nextTurn")} disabled={index < 0 || index >= turns.length - 1} onClick={() => choose(index + 1)} />
        <input className="mc-session-scrubber" type="range" min={0} max={Math.max(0, turns.length - 1)} value={Math.max(0, index)}
          aria-label={t("conversationTurns")} aria-valuetext={active ? t("conversationTurn", { n: active.turn }) : t("noConversationHistory")}
          disabled={!turns.length} onChange={event => choose(Number(event.target.value))} />
        <Button variant="ghost" size="sm" disabled={!turns.length || selected === null}
          onClick={() => choose(turns.length - 1)}>{t("latestTurn")}</Button>
      </footer>
    </article>
  </section>;
}
