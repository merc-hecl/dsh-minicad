import React, { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CompactComposerContext } from "./compact-composer.jsx";

const TranscriptTarget = createContext(null);
function WorkbenchViews({ renderSlot }) {
  const target = useContext(TranscriptTarget);
  // Keep DSH's draft-persistence binding mounted even when Chat is not read.
  // An unmatched view filter avoids loading/rendering a hidden transcript.
  const view = renderSlot("conversation.session", { view: target ? "chat" : "minicad.folded" });
  return target ? createPortal(view, target) : <div hidden>{view}</div>;
}
const COMPOSER_SLOTS = { views: WorkbenchViews };
const EMPTY_TODOS = [];
const EMPTY_SOURCE = { subscribe: () => () => {}, getSnapshot: () => null };

export function Composer({ renderFactorySlot, useSession, useInput, useSessionStatus, useProjection, useChat, useConversation, sessionId,
  transcriptTarget, onSubmitted, onSessionState, onRestored, minicadT, chatT }) {
  const session = useSession(s => s);
  const input = useInput(s => s);
  const interaction = useSessionStatus(s => s.get(sessionId)?.pendingInteraction);
  const todos = useProjection("todos") ?? EMPTY_TODOS;
  const chat = useChat(s => s);
  const conversation = useConversation(s => s);
  const turnId = chat.timeline.turnOrder.at(-1);
  const turn = chat.timeline.turns.get(turnId);
  const grouped = conversation.views.grouped("chat");
  const group = grouped?.entries.findLast(entry => entry.kind === "group"
    && grouped.groupSource(entry.key).getSnapshot()?.data.turn === turnId);
  const groupSource = group ? grouped.groupSource(group.key) : EMPTY_SOURCE;
  const groupState = useSyncExternalStore(groupSource.subscribe, groupSource.getSnapshot);
  const summary = groupState?.data.summary;
  const retry = session.running && [...chat.order].reverse().map(key => chat.nodes.get(key)).find(node => node?.kind === "model-retry"
    && (node.location.kind === "turn" || node.location.kind === "step") && node.location.turn.turn === turnId)?.data.current;
  const reason = turn?.end?.data.reason;
  const activityKind = summary?.running || "thinking";
  const activity = retry?.retryState === "scheduled" ? minicadT("agentRetry", { current: retry.retry, total: retry.mode === "normal" ? retry.maxRetries : "∞" })
    : summary && !groupState.data.closed ? chatT(`message.stepProcess.${summary.preparing ? `prepare.${activityKind === "thinking" ? "tools" : activityKind}` : activityKind}`) : "";
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
      interaction: interaction?.kind, turnId, terminal: reason?.kind,
      failure: session.promptError?.error?.message || (reason?.kind === "error" ? reason.error?.message : ""),
      todos, activity, activityDetail: summary?.runningDetail || "",
      activities: (summary?.counts || []).map(item => ({ ...item, label: chatT(`message.stepProcess.done.${item.kind}`) })),
      pending: ids.size > 0,
      inputEmpty: !input.draft.trim() && input.attachmentIds.length === 0 && input.occurrences.length === 0 });
    current.ids = ids;
    current.draft = input.draft;
  }, [session.running, session.pendingSubmissions, session.promptError, input.draft, input.attachmentIds, input.occurrences,
    interaction, turnId, reason, todos, summary, activity, chatT]);
  return <CompactComposerContext.Provider value={minicadT}><TranscriptTarget.Provider value={transcriptTarget}>
    {renderFactorySlot("conversation.content", { variant: "embedded", phase: "active", hero: false }, { slots: COMPOSER_SLOTS })}
  </TranscriptTarget.Provider></CompactComposerContext.Provider>;
}
