import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CompactComposerContext } from "./compact-composer.jsx";
import { SessionRecord } from "./session-record.jsx";

const SessionRecordContext = createContext(false);
function WorkbenchViews({ renderSlot }) {
  const visible = useContext(SessionRecordContext);
  // Keep DSH's draft-persistence binding mounted even when Chat is not read.
  // An unmatched view filter avoids loading/rendering a hidden transcript.
  return <div hidden={!visible} className={visible ? "mc-session-record-views" : undefined}>
    {renderSlot("conversation.session", { view: visible ? "chat" : "minicad.folded" })}
  </div>;
}
const COMPOSER_SLOTS = { views: WorkbenchViews };
const EMPTY_TODOS = [];
const EMPTY_SOURCE = { subscribe: () => () => {}, getSnapshot: () => null };

function latestAssistantOutput(chat, turnId) {
  for (let i = chat.order.length - 1; i >= 0; i--) {
    const node = chat.nodes.get(chat.order[i]);
    if (node?.kind !== "assistant-step" || node.location.turn?.turn !== turnId) continue;
    for (let j = node.data.blocks.length - 1; j >= 0; j--) {
      const block = node.data.blocks[j];
      if (block.kind !== "text" && block.kind !== "reasoning") continue;
      const text = block.text.replace(/^<signature>[\s\S]*?<\/signature>\s*/, "");
      if (text.trim() && !text.startsWith("<signature>")) return text;
    }
  }
  return "";
}

function latestLiveTool(members, nodes) {
  let latest;
  function visit(call) {
    if (!("kind" in call) && (!latest || call.time >= latest.time)) latest = call;
    for (const child of call.subCalls) visit(child);
  }
  for (const { key } of members) {
    const node = nodes.get(key);
    if (node?.kind === "tool-call") visit(node.data.root);
  }
  return latest;
}

export function Composer({ renderFactorySlot, useSession, useInput, useSessionStatus, useProjection, useChat, useConversation, sessionId,
  onSubmitted, onSessionState, onRestored, minicadT, chatT, modelDirectory, record, loadEarlier }) {
  const session = useSession(s => s);
  const input = useInput(s => s);
  const models = useSyncExternalStore(modelDirectory.subscribe, modelDirectory.getSnapshot);
  const modelName = models.groups.find(group => group.id === models.current?.provider)
    ?.models.find(model => model.id === models.current?.model)?.name;
  const interaction = useSessionStatus(s => s.get(sessionId)?.pendingInteraction);
  const todos = useProjection("todos") ?? EMPTY_TODOS;
  const chat = useChat(s => s);
  const conversation = useConversation(s => s);
  const inlineHost = useRef(null);
  const [readerTarget, setReaderTarget] = useState(null);
  // Only this unowned outer node moves. React keeps the same native Conversation,
  // Lexical editor, draft binding and pending interactions mounted inside it.
  const [nativeMount] = useState(() => {
    const element = document.createElement("div");
    element.className = "mc-native-session-container";
    return element;
  });
  useLayoutEffect(() => {
    const target = record.open ? readerTarget : inlineHost.current;
    target?.append(nativeMount);
    return () => nativeMount.remove();
  }, [nativeMount, record.open, record.open ? readerTarget : null]);
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
  const tool = summary?.running && !groupState.data.closed ? latestLiveTool(groupState.members, chat.nodes) : undefined;
  const activity = retry?.retryState === "scheduled" ? minicadT("agentRetry", { current: retry.retry, total: retry.mode === "normal" ? retry.maxRetries : "∞" })
    : tool?.name ? minicadT(tool.phase === "preparing" ? "agentPreparingTool" : "agentRunningTool", { tool: tool.name })
      : summary && !groupState.data.closed ? chatT(`message.stepProcess.${summary.preparing ? `prepare.${activityKind === "thinking" ? "tools" : activityKind}` : activityKind}`) : "";
  // Keep the current turn's prose visible while tools and todos change.
  const activityDetail = latestAssistantOutput(chat, turnId);
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
      todos, activity, activityDetail, modelName,
      activities: (summary?.counts || []).map(item => ({ ...item, label: chatT(`message.stepProcess.done.${item.kind}`) })),
      pending: ids.size > 0,
      inputEmpty: !input.draft.trim() && input.attachmentIds.length === 0 && input.occurrences.length === 0 });
    current.ids = ids;
    current.draft = input.draft;
  }, [session.running, session.pendingSubmissions, session.promptError, input.draft, input.attachmentIds, input.occurrences,
    interaction, turnId, reason, todos, summary, activity, activityDetail, modelName, chatT]);
  return <SessionRecordContext.Provider value={record.open}>
    <CompactComposerContext.Provider value={minicadT}>
      <div ref={inlineHost} className="mc-inline-composer-host" />
      {createPortal(renderFactorySlot("conversation.content", { variant: "embedded", phase: "active", hero: false }, { slots: COMPOSER_SLOTS }), nativeMount)}
      {record.host && createPortal(<SessionRecord {...record} turns={chat.navigation.items()} session={session} empty={!chat.timeline.turnOrder.length} waiting={!!interaction}
        loadEarlier={loadEarlier} onReaderTarget={setReaderTarget} t={minicadT} />, record.host)}
    </CompactComposerContext.Provider>
  </SessionRecordContext.Provider>;
}
