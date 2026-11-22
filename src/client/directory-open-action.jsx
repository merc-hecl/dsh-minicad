import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Menu, Tooltip, Toast, IconChevronDownOutlineRegular, IconRightUpOutlineRegular,
  IconWarningOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import freecadIcon from "./assets/freecad.svg";
import cadAssistantIcon from "./assets/cad-assistant.png";
import rhinoIcon from "./assets/rhino.png";
import solidworksIcon from "./assets/solidworks.svg";
import inventorIcon from "./assets/inventor.svg";
import { errorKey } from "../shared/errors.js";

const choiceKey = "minicad.openInApp.choice";
const modelIcons = {
  freecad: freecadIcon,
  "cad-assistant": cadAssistantIcon,
  rhino: rhinoIcon,
  solidworks: solidworksIcon,
  inventor: inventorIcon,
};

function ApplicationIcon({ source, size = 14 }) {
  const [failed, setFailed] = useState(false);
  return !source || failed ? <IconRightUpOutlineRegular size={size} />
    : <img src={source} width={size} height={size} className="mc-open-in-app-appIcon"
      alt="" draggable={false} onError={() => setFailed(true)} />;
}

export function DirectoryOpenAction(props) {
  const { absolutePath, projectId, modelFile, hasModel, request, minicadT, t, onMenuOpenChange } = props;
  const available = props.useOpenInAppApps(apps => apps);
  const nativeChoice = props.useOpenInAppChoice(id => id);
  const operation = props.useOpenInAppLaunch(value => value);
  const shortcut = props.useShortcuts(rows => rows.find(row => row.id === "workspace.openLocal"));
  const [modelChoice, setModelChoice] = useState(() => localStorage.getItem(choiceKey));
  const [modelApps, setModelApps] = useState([{ id: "freecad", name: "FreeCAD" }]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState(false), [banner, setBanner] = useState(null);
  const inFlight = useRef(false), sequence = useRef(0);
  const menuAnchor = useRef(null);
  const getMenuAnchorRect = useCallback(() => {
    const anchor = menuAnchor.current;
    if (!anchor) return null;
    const rect = anchor.getBoundingClientRect();
    const toolbar = anchor.closest(".mc-header-actions")?.getBoundingClientRect() ?? rect;
    const top = toolbar.top - 4, bottom = toolbar.bottom + 4;
    return DOMRect.fromRect({ x: rect.left, y: top, width: rect.width, height: bottom - top });
  }, []);
  const notify = text => setBanner({ text, sequence: ++sequence.current });
  const refresh = async signal => {
    try { setModelApps(await request("model_apps", {}, signal)); }
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
  apps.push(...modelApps.map(app => ({
    id: `model:${app.id}`, modelApp: app,
    name: app.available === false ? minicadT("modelAppUnavailable", { app: app.name }) : app.name,
    icon: modelIcons[app.id],
    disabled: !hasModel || !app.available,
  })));
  const preferred = apps.find(app => app.modelApp?.id === modelChoice && !app.disabled)
    ?? apps.find(app => app.id === nativeChoice && !app.disabled)
    ?? apps.find(app => !app.disabled) ?? apps[0];
  const busy = pending || operation.phase === "busy";
  useLayoutEffect(() => {
    onMenuOpenChange?.(menuOpen && !busy);
    return () => onMenuOpenChange?.(false);
  }, [menuOpen, busy, onMenuOpenChange]);
  const primaryLabel = t("open.title", { app: preferred.name });
  const nativeShortcut = preferred.modelApp ? undefined : shortcut;
  const act = async id => {
    const app = apps.find(app => app.id === id);
    if (!app || app.disabled || inFlight.current || busy) return;
    inFlight.current = true; setPending(true); setMenuOpen(false);
    try {
      if (app.modelApp) {
        await request("open_model", { projectId, modelFile, application: app.modelApp.id });
        localStorage.setItem(choiceKey, app.modelApp.id); setModelChoice(app.modelApp.id);
      } else {
        await props.launch(id, absolutePath);
        props.choose(id);
        localStorage.removeItem(choiceKey); setModelChoice(null);
      }
    } catch (error) {
      notify(app.modelApp ? minicadT(error.uiKey || errorKey(error.message), { app: app.modelApp.name })
        : t("path.openError"));
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
