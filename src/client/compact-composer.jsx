import React, { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import { Button, IconPaperclipOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";

export const CompactComposerContext = createContext(null);

function CompactLayout({ input, children }) {
  const root = useRef(null);
  const [multiline, setMultiline] = useState(false);
  useLayoutEffect(() => {
    const element = root.current;
    const editor = element.querySelector("[data-composer-input]");
    if (!editor) return;
    const measure = () => {
      if (!element.clientWidth) return;
      // Measure the compact layout even while expanded, so expansion cannot
      // change its own threshold. Restore it before the browser paints.
      const expanded = element.hasAttribute("data-multiline");
      element.removeAttribute("data-multiline");
      const style = getComputedStyle(editor);
      const height = editor.scrollHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const wraps = height > parseFloat(style.lineHeight) * 1.5;
      element.toggleAttribute("data-multiline", expanded);
      setMultiline(wraps || input.draft.includes("\n") || input.attachmentIds.length > 0 || input.occurrences.length > 0);
    };
    measure();
    let width = element.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = element.getBoundingClientRect().width;
      if (next !== width) { width = next; measure(); }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [input.draft, input.attachmentIds.length, input.occurrences.length]);
  return <div ref={root} className="mc-compact-composer" data-multiline={multiline || undefined}>{children}</div>;
}

// Keep the installed editor, submission policy and file intake. Alias its child
// seats so this scoped presentation never replaces controls in ordinary Chat.
export function registerCompactComposer(ctx) {
  const alias = name => `minicad.compact.${name}`;
  function mirrorChildren(children) {
    return Object.fromEntries(Object.entries(children || {}).map(([name, spec]) => [alias(name), spec]));
  }
  function mirror(source) {
    return ctx.slots.inject(alias(source), () => {
      let previous = [], disposers = [];
      const sync = () => {
        const entries = ctx.slots.entriesOfSlot(source);
        if (entries.length === previous.length && entries.every((entry, index) => entry === previous[index])) return;
        disposers.forEach(dispose => dispose()); previous = entries;
        disposers = entries.map(entry => {
          const Native = entry.component;
          const dispose = ctx.slots.register({ ...entry.options, name: alias(source), inject: entry.inject,
            locale: entry.locale, store: entry.store, children: mirrorChildren(entry.children) }, props =>
            <Native {...props} renderSlot={props.renderSlot && ((name, ...args) => props.renderSlot(alias(name), ...args))}
              renderSlotChain={props.renderSlotChain && ((name, ...args) => props.renderSlotChain(alias(name), ...args))} />);
          const descendants = Object.keys(entry.children || {}).map(mirror);
          return () => { descendants.forEach(cleanup => cleanup()); dispose(); };
        });
      };
      const unsubscribe = ctx.slots.subscribe(source, sync); sync();
      return () => { unsubscribe(); disposers.forEach(dispose => dispose()); };
    });
  }
  ctx.slots.inject("conversation.composer.bar", () => {
    let source, dispose, descendants = [];
    function CompactBar(props) {
      const t = useContext(CompactComposerContext);
      const input = props.useInput(state => state);
      const Native = source.component;
      const renderSlot = (name, ...args) => {
        if (t) {
          if (name === "conversation.input.left") return <Button variant="ghost" className="mc-attach"
            aria-label={t("attachFile")} title={t("attachFile")} disabled={!props.keyboard || props.disabled || !!props.blocked}
            icon={<IconPaperclipOutlineRegular size={20} />} onClick={() => props.keyboard.pickFiles()} />;
          if (["conversation.input.plan", "conversation.input.right",
            "conversation.input.activity", "conversation.composer.dock"].includes(name)) return null;
        }
        return props.renderSlot(alias(name), ...args);
      };
      const native = <Native {...props} renderSlot={renderSlot} placeholder={t && !props.disabled && !props.blocked ? t("canvasPlaceholder") : props.placeholder} />;
      return t ? <CompactLayout input={input}>{native}</CompactLayout> : native;
    }
    const sync = () => {
      const entry = ctx.slots.entries("conversation.composer.bar").find(item => item.component !== CompactBar);
      if (entry === source) return;
      descendants.forEach(cleanup => cleanup()); dispose?.(); source = entry;
      dispose = entry && ctx.slots.register({ name: "conversation.composer.bar", priority: (entry.options.priority || 0) - 1,
        inject: entry.inject, locale: entry.locale, store: entry.store, children: mirrorChildren(entry.children) }, CompactBar);
      descendants = Object.keys(entry?.children || {}).map(mirror);
    };
    const unsubscribe = ctx.slots.subscribe("conversation.composer.bar", sync); sync();
    return () => { unsubscribe(); descendants.forEach(cleanup => cleanup()); dispose?.(); };
  });
}
