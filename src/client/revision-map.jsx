import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Tooltip, pointerModality } from "@deepseek-ai/dsh-client-ui-primitives";

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const transform = view => `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;

export function RevisionMap({ camera, nodes, width, height, cardWidth, cardHeight, selected, current, onSelect, onCurrent, t, children }) {
  const viewport = useRef(null), scene = useRef(null), pointers = useRef(new Map()), gesture = useRef(null);
  const [zoom, setZoom] = useState(camera.current?.scale || 1);
  const apply = useCallback(view => {
    camera.current = view;
    if (scene.current) scene.current.style.transform = transform(view);
    setZoom(view.scale);
  }, [camera]);
  const fitScale = useCallback(() => Math.min(1, Math.max(1, viewport.current.clientWidth - 40) / width,
    Math.max(1, viewport.current.clientHeight - 40) / height), [width, height]);
  const fit = useCallback(() => {
    const scale = fitScale(), { clientWidth, clientHeight } = viewport.current;
    apply({ x: (clientWidth - width * scale) / 2, y: (clientHeight - height * scale) / 2, scale });
  }, [apply, fitScale, width, height]);
  const zoomAt = useCallback((factor, point) => {
    const view = camera.current;
    if (!view) return;
    const scale = Math.max(Math.min(0.1, fitScale()), Math.min(2, view.scale * factor));
    apply({ x: point.x - (point.x - view.x) * scale / view.scale,
      y: point.y - (point.y - view.y) * scale / view.scale, scale });
  }, [camera, apply, fitScale]);
  const center = () => ({ x: viewport.current.clientWidth / 2, y: viewport.current.clientHeight / 2 });
  const focusNode = useCallback((node, scale = camera.current?.scale || 1, onlyIfHidden = false) => {
    if (!node) return;
    const { clientWidth, clientHeight } = viewport.current;
    const view = camera.current;
    if (onlyIfHidden && view && node.x * view.scale + view.x >= 12 && node.y * view.scale + view.y >= 12
      && (node.x + cardWidth) * view.scale + view.x <= clientWidth - 12
      && (node.y + cardHeight) * view.scale + view.y <= clientHeight - 12) return;
    scale = Math.min(scale, Math.max(1, clientWidth - 32) / cardWidth, Math.max(1, clientHeight - 32) / cardHeight);
    apply({ x: clientWidth / 2 - (node.x + cardWidth / 2) * scale,
      y: clientHeight / 2 - (node.y + cardHeight / 2) * scale, scale });
  }, [apply, camera, cardWidth, cardHeight]);
  useLayoutEffect(() => {
    const element = viewport.current;
    const resize = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      if (!camera.current) {
        if (fitScale() < 0.65 && nodes.has(selected)) focusNode(nodes.get(selected), 0.8);
        else fit();
      } else {
        apply(camera.current);
        focusNode(nodes.get(selected), camera.current.scale, true);
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [camera, nodes, selected, fitScale, fit, focusNode, apply]);
  useEffect(() => {
    const element = viewport.current;
    const wheel = event => {
      event.preventDefault(); event.stopPropagation();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      const rect = element.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * unit * 0.0015), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [zoomAt]);
  const point = event => {
    const rect = viewport.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const down = event => {
    if (event.button !== 0 || !camera.current) return;
    const position = point(event);
    if (!pointers.current.size) gesture.current = { start: position, view: camera.current,
      revision: event.target.closest("[data-revision]")?.dataset.revision, moved: false };
    else gesture.current.moved = true;
    pointers.current.set(event.pointerId, position);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = event => {
    const previous = pointers.current.get(event.pointerId), active = gesture.current;
    if (!previous || !active) return;
    const before = [...pointers.current.values()];
    const position = point(event);
    pointers.current.set(event.pointerId, position);
    const view = camera.current;
    if (pointers.current.size > 1) {
      const after = [...pointers.current.values()], from = midpoint(...before), to = midpoint(...after);
      const ratio = distance(...after) / Math.max(1, distance(...before));
      const scale = Math.max(Math.min(0.1, fitScale()), Math.min(2, view.scale * ratio));
      apply({ x: to.x - (from.x - view.x) * scale / view.scale,
        y: to.y - (from.y - view.y) * scale / view.scale, scale });
      active.moved = true;
    } else if (!active.moved) {
      if (distance(position, active.start) < 4) return;
      active.moved = true;
      apply({ ...active.view, x: active.view.x + position.x - active.start.x, y: active.view.y + position.y - active.start.y });
    } else apply({ ...view, x: view.x + position.x - previous.x, y: view.y + position.y - previous.y });
    event.currentTarget.dataset.dragging = "true";
  };
  const end = event => {
    if (!pointers.current.has(event.pointerId)) return;
    const active = gesture.current;
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (pointers.current.size) return;
    delete event.currentTarget.dataset.dragging;
    gesture.current = null;
    if (event.type === "pointerup" && active && !active.moved && active.revision && distance(point(event), active.start) < 4)
      onSelect(Number(active.revision));
  };
  const keyDown = event => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    const view = camera.current;
    if (!view) return;
    const moves = { ArrowLeft: [48, 0], ArrowRight: [-48, 0], ArrowUp: [0, 48], ArrowDown: [0, -48] };
    if (moves[event.key]) apply({ ...view, x: view.x + moves[event.key][0], y: view.y + moves[event.key][1] });
    else if (event.key === "+" || event.key === "=") zoomAt(1.2, center());
    else if (event.key === "-") zoomAt(1 / 1.2, center());
    else if (event.key === "0") fit();
    else return;
    event.preventDefault(); event.stopPropagation();
  };
  return <section className="mc-revision-map mc-panel" aria-label={t("versionMap")}>
    <header className="mc-revision-map-toolbar">
      <strong>{t("versionMap")}</strong>
      <div className="mc-revision-map-zoom">
        <Tooltip label={t("zoomOut")} portal><Button variant="ghost" size="sm" disabled={!nodes.size} aria-label={t("zoomOut")} onClick={() => zoomAt(1 / 1.2, center())}>−</Button></Tooltip>
        <Tooltip label={t("actualSize")} portal><Button variant="ghost" size="sm" disabled={!nodes.size} aria-label={t("actualSize")} onClick={() => zoomAt(1 / zoom, center())}>{Math.round(zoom * 100)}%</Button></Tooltip>
        <Tooltip label={t("zoomIn")} portal><Button variant="ghost" size="sm" disabled={!nodes.size} aria-label={t("zoomIn")} onClick={() => zoomAt(1.2, center())}>+</Button></Tooltip>
      </div>
      <Button variant="ghost" size="sm" disabled={!nodes.size} onClick={fit}>{t("fitVersions")}</Button>
      <Button variant="ghost" size="sm" disabled={!nodes.has(current)} onClick={() => { focusNode(nodes.get(current), Math.max(0.8, zoom)); onCurrent(); }}>{t("currentVersion")}</Button>
    </header>
    <div ref={viewport} className="mc-revision-tree" tabIndex={0} role="group" aria-label={t("versionMap")}
      onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
      onKeyDown={keyDown} onFocusCapture={event => {
        if (pointerModality()) return;
        const revision = event.target.closest("[data-revision]")?.dataset.revision;
        if (revision) focusNode(nodes.get(Number(revision)), camera.current?.scale, true);
      }}
      onClickCapture={event => { if (event.detail > 0) { event.preventDefault(); event.stopPropagation(); } }}>
      <div ref={scene} className="mc-revision-map-scene" style={{ transform: camera.current ? transform(camera.current) : undefined }}>{children}</div>
      {!nodes.size && <div className="mc-revision-empty">{t("noSavedVersions")}</div>}
    </div>
  </section>;
}
