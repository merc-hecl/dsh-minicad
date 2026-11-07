import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Menu, Tooltip, Toast, IconChevronDownOutlineRegular, IconRightUpOutlineRegular,
  IconWarningOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import freecadIcon from "./assets/freecad.svg";
import { errorKey } from "../shared/errors.js";

// Directory presentation adapted from DSH 0.2.1-rc.5 OpenInAppAction and
// OpenTargetButton. The native injected catalog, locale and launch controller
// remain authoritative; the FreeCAD action belongs only to this MiniCAD seat.
const choiceKey = "minicad.openInApp.choice";

function ApplicationIcon({ source, size = 14 }) {
  const [failed, setFailed] = useState(false);
  return !source || failed ? <IconRightUpOutlineRegular size={size} />
    : <img src={source} width={size} height={size} className="mc-open-in-app-appIcon"
      alt="" draggable={false} onError={() => setFailed(true)} />;
}

export function DirectoryOpenAction(props) {
  const { absolutePath, projectId, sourceFile, hasModel, request, minicadT, t, onMenuOpenChange } = props;
  const available = props.useOpenInAppApps(apps => apps);
  const nativeChoice = props.useOpenInAppChoice(id => id);
  const operation = props.useOpenInAppLaunch(value => value);
  const shortcut = props.useShortcuts(rows => rows.find(row => row.id === "workspace.openLocal"));
  const [modelChoice, setModelChoice] = useState(() => localStorage.getItem(choiceKey) === "freecad");
  const [freecad, setFreecad] = useState(null), [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState(false), [banner, setBanner] = useState(null);
  const inFlight = useRef(false), sequence = useRef(0);
  const menuAnchor = useRef(null);
  const getMenuAnchorRect = useCallback(() => {
    const anchor = menuAnchor.current;
    if (!anchor) return null;
    const rect = anchor.getBoundingClientRect();
    const toolbar = anchor.closest(".mc-header-actions")?.getBoundingClientRect() ?? rect;
    // The app menu is outside the toolbar; native Menu adds another 4px gap.
    const top = toolbar.top - 4, bottom = toolbar.bottom + 4;
    return DOMRect.fromRect({ x: rect.left, y: top, width: rect.width, height: bottom - top });
  }, []);
  const notify = text => setBanner({ text, sequence: ++sequence.current });
  const refresh = async signal => {
    try { setFreecad((await request("model_apps", {}, signal)).find(app => app.id === "freecad")); }
    catch (error) { if (error.name !== "AbortError") notify(t("path.appsError")); }
  };
  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
  }, [request]);
  const apps = (available ?? []).flatMap(id => {
    const key = `app.${id}`, name = t(key);
    return name === key ? [] : [{ id, name, icon: props.iconUrl(id) }];
  });
  apps.push({ id: "freecad", name: freecad?.available === false
    ? minicadT("modelAppUnavailable", { app: "FreeCAD" }) : "FreeCAD",
    icon: freecadIcon, disabled: !hasModel || !freecad?.available });
  const preferred = apps.find(app => app.id === (modelChoice ? "freecad" : nativeChoice) && !app.disabled)
    ?? apps.find(app => !app.disabled) ?? apps[0];
  const busy = pending || operation.phase === "busy";
  useLayoutEffect(() => {
    onMenuOpenChange?.(menuOpen && !busy);
    return () => onMenuOpenChange?.(false);
  }, [menuOpen, busy, onMenuOpenChange]);
  const primaryLabel = t("open.title", { app: preferred.name });
  const nativeShortcut = preferred.id === "freecad" ? undefined : shortcut;
  const act = async id => {
    if (inFlight.current || busy) return;
    inFlight.current = true; setPending(true); setMenuOpen(false);
    try {
      if (id === "freecad") {
        await request("open_model", { projectId, sourceFile, application: id });
        localStorage.setItem(choiceKey, id); setModelChoice(true);
      } else {
        await props.launch(id, absolutePath);
        props.choose(id);
        localStorage.removeItem(choiceKey); setModelChoice(false);
      }
    } catch (error) {
      notify(id === "freecad" ? minicadT(error.uiKey || errorKey(error.message)) : t("path.openError"));
    } finally { inFlight.current = false; setPending(false); }
  };
  return <>
    <Menu className="mc-open-in-app-menuAnchor" open={menuOpen && !busy} autoFocus portal dense align="end"
      getAnchorRect={getMenuAnchorRect}
      onClose={() => setMenuOpen(false)} items={apps.map(app => ({ id: app.id,
        icon: <ApplicationIcon key={app.icon} source={app.icon} />, disabled: app.disabled,
        label: app.id === preferred.id ? t("path.appDefault", { app: app.name }) : app.name }))}
      onSelect={act} anchor={<div ref={menuAnchor} className="mc-open-in-app-split" data-open-target="directory"
        data-size="compact" data-state={busy ? "busy" : "idle"}>
        <Tooltip portal label={primaryLabel} shortcutKeys={nativeShortcut?.keys} side="bottom" delayMs={500}>
          <button type="button" className="mc-open-in-app-main" disabled={busy || preferred.disabled}
            aria-label={primaryLabel} aria-keyshortcuts={nativeShortcut?.aria} onClick={() => act(preferred.id)}>
            <ApplicationIcon key={preferred.icon} source={preferred.icon} size={16} />
          </button>
        </Tooltip>
        <button type="button" className="mc-open-in-app-chevron" disabled={busy} aria-haspopup="menu"
          aria-expanded={menuOpen && !busy} aria-label={t("path.more")} onClick={() => {
            if (!menuOpen) refresh();
            setMenuOpen(value => !value);
          }}><IconChevronDownOutlineRegular size={10} /></button>
      </div>} />
    {banner && <Toast key={banner.sequence} text={banner.text} icon={<IconWarningOutlineRegular />}
      onDone={() => setBanner(null)} />}
  </>;
}
