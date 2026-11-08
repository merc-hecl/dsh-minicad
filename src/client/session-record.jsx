import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Button, StateDot, IconCloseOutlineRegular, IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";

export function SessionRecord({ open, title, turns, session, empty, waiting, onClose, onReaderTarget, loadEarlier, t }) {
  const closeButton = useRef(null), reader = useRef(null);
  const [selected, setSelected] = useState(null);
  const selectedIndex = selected === null ? turns.length - 1 : turns.findIndex(turn => turn.turn === selected);
  const index = selectedIndex < 0 ? turns.length - 1 : selectedIndex;
  const active = turns[index];
  const mountReader = useCallback(element => { reader.current = element; onReaderTarget(element); }, [onReaderTarget]);
  useLayoutEffect(() => {
    if (open) closeButton.current?.focus({ preventScroll: true });
    else setSelected(null);
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
    <article className="mc-session-reader mc-panel" data-waiting={waiting || undefined}>
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
