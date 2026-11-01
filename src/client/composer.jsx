import React, { createContext, useContext, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const TranscriptTarget = createContext(null);
function WorkbenchViews({ renderSlot }) {
  const target = useContext(TranscriptTarget);
  // Keep DSH's draft-persistence binding mounted even when Chat is not read.
  // An unmatched view filter avoids loading/rendering a hidden transcript.
  const view = renderSlot("conversation.session", { view: target ? "chat" : "minicad.folded" });
  return target ? createPortal(view, target) : <div hidden>{view}</div>;
}
const COMPOSER_SLOTS = { views: WorkbenchViews };

export function Composer({ renderFactorySlot, useSession, useInput, useSessionStatus, sessionId,
  transcriptTarget, onSubmitted, onSessionState, onRestored }) {
  const session = useSession(s => s);
  const input = useInput(s => s);
  const interaction = useSessionStatus(s => s.get(sessionId)?.pendingInteraction);
  const callbacks = useRef(null);
  callbacks.current = { onSubmitted, onSessionState, onRestored };
  const previous = useRef({ ids: new Set(), draft: input.draft, sent: false });
  useEffect(() => { previous.current = { ids: new Set(), draft: input.draft, sent: false }; }, [sessionId]);
  useEffect(() => {
    const current = previous.current;
    const ids = new Set(session.pendingSubmissions.map(item => item.requestId));
    if (session.pendingSubmissions.some(item => !current.ids.has(item.requestId))) {
      current.sent = true;
      callbacks.current.onSubmitted?.();
    }
    if (current.sent && input.draft.trim() && !current.draft.trim() && !session.running) {
      callbacks.current.onRestored?.();
      current.sent = false;
    }
    callbacks.current.onSessionState?.({ running: session.running, waiting: !!interaction,
      pending: ids.size > 0,
      inputEmpty: !input.draft.trim() && input.attachmentIds.length === 0 && input.occurrences.length === 0 });
    current.ids = ids;
    current.draft = input.draft;
  }, [session.running, session.pendingSubmissions, input.draft, input.attachmentIds, input.occurrences, interaction]);
  return <TranscriptTarget.Provider value={transcriptTarget}>
    {renderFactorySlot("conversation.content", { variant: "embedded", phase: "active", hero: false }, { slots: COMPOSER_SLOTS })}
  </TranscriptTarget.Provider>;
}
