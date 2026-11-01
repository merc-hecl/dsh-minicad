import React from "react";

const NoConversationView = () => null;
const COMPOSER_SLOTS = { views: NoConversationView };

// Use DSH 0.2.1-rc.5's public Factory, which owns its child slots exclusively.
// Only omit the transcript here; retain the complete native composer and takeovers.
export function Composer({ renderFactorySlot }) {
  return renderFactorySlot(
    "conversation.content",
    { variant: "embedded", phase: "active", hero: false },
    { slots: COMPOSER_SLOTS },
  );
}
