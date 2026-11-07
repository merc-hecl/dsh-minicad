import React from "react";
import { ReferenceChip } from "@deepseek-ai/dsh-client-ui-primitives";
import {
  nextGeometryAnnotation,
  serializeGeometryAnnotation,
} from "../shared/geometry-annotations.js";

const sourceName = "minicad-geometry";

function GeometryReference({ node }) {
  const item = node.data;
  return (
    <span>
      <ReferenceChip
        label={`${item.label} · v${item.expectedRevision}`}
        title={`${item.modelFile}\n${item.reference}`}
      />
      {item.note && <span> — {item.note}</span>}
    </span>
  );
}

// DSH owns chip editing, persistence, serialization and sent-message rendering.
export function registerGeometryReferences(ctx, request) {
  ctx.effect(
    () =>
      ctx.inputTriggers.registerSource({
        name: sourceName,
        trigger: "@",
        candidates: async () => [],
        codec: {
          clipboardText: (ref) => serializeGeometryAnnotation(JSON.parse(ref)),
          serialize: async (ref, signal) => {
            try {
              return serializeGeometryAnnotation(
                await request("geometry_annotation", JSON.parse(ref), signal),
              );
            } catch (error) {
              if (error.uiKey)
                error.message = ctx.locale.bind("minicad")(error.uiKey);
              throw error;
            }
          },
        },
      }),
    "minicad: geometry reference codec",
  );
  ctx.uiConversation.userText.register({
    id: sourceName,
    order: 20,
    match: nextGeometryAnnotation,
  });
  ctx.slots.inject("conversation.user.text.node", () =>
    ctx.slots.register(
      { name: "conversation.user.text.node", key: sourceName, priority: 100 },
      GeometryReference,
    ),
  );

  return (sessionId, annotations) => {
    const shell = ctx.conversation.input.shell(sessionId);
    // Each synchronous insertion takes the updated draft revision and caret;
    // all geometry was validated together before reaching the native composer.
    for (const annotation of annotations) {
      const inserted = shell.insertReference(
        { source: sourceName, ref: JSON.stringify(annotation),
          label: `${annotation.label} · v${annotation.expectedRevision}${annotation.note ? ` — ${annotation.note}` : ""}`,
          clipboardText: serializeGeometryAnnotation(annotation) },
        shell.actions.captureInsertion(),
      );
      if (!inserted) return false;
    }
    shell.actions.persistDraft();
    return true;
  };
}
