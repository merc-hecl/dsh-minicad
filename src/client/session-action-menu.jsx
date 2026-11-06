import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Menu } from "@deepseek-ai/dsh-client-ui-primitives";

function menuItems(actions, shortcuts, renderSlot) {
  return actions.flatMap(action => {
    const item = {
      id: action.id,
      label: action.label,
      disabled: action.disabled,
      danger: action.danger,
      shortcut: shortcuts.find(entry => entry.id === action.commandId),
      icon: action.icon && renderSlot("minicad.contextMenu.icon", { icon: action.icon }, { entryKey: action.icon.key }),
      submenu: action.children && menuItems(action.children, shortcuts, renderSlot),
    };
    return action.separatorBefore ? [{ type: "separator", id: `${action.id}:separator` }, item] : [item];
  });
}

export function SessionActionMenu({ anchor, open, setOpen, sessionId, displayTitle, contextMenus, shortcuts, renderSlot, onRename, onFork }) {
  const [actions, setActions] = useState([]);
  const occurrence = useRef(null);
  const close = useCallback(() => setOpen(false), [setOpen]);
  const menuOpenState = useMemo(() => [open, setOpen], [open, setOpen]);

  useLayoutEffect(() => {
    if (!open) return;
    const menu = contextMenus.resolve({ kind: "session", value: { sessionId, displayTitle } });
    occurrence.current = menu;
    const sync = () => setActions(menu.source.getSnapshot());
    const unsubscribe = menu.source.subscribe(sync);
    sync();
    return () => {
      unsubscribe();
      menu.dispose();
      occurrence.current = null;
    };
  }, [contextMenus, displayTitle, open, sessionId]);

  return <Menu anchor={anchor} open={open} onClose={close} portal autoFocus contextual
    items={menuItems(actions.filter(action => !action.afterContent), shortcuts, renderSlot)}
    footer={menuItems(actions.filter(action => action.afterContent), shortcuts, renderSlot)}
    onSelect={id => {
      const menu = occurrence.current;
      if (!menu) return;
      close();
      // Keep the workbench's dialog styling and fork placement in the design.
      if (id === "session.rename/rename" || id === "session.fork/fork") {
        if (!menu.source.getSnapshot().some(action => action.id === id && !action.disabled)) return;
        if (id === "session.rename/rename") onRename(sessionId, displayTitle);
        else onFork(sessionId);
      } else menu.select(id);
    }}>
    {open && renderSlot("minicad.session.menu", { sessionId, displayTitle, closeMenu: close }, { hookContext: menuOpenState })}
  </Menu>;
}
