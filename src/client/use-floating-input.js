import { useLayoutEffect, useRef, useState } from "react";

const clamp = (point, bounds) => ({
  left: Math.max(16, Math.min(point.left, bounds.maxLeft)),
  top: Math.max(bounds.minTop, Math.min(point.top, bounds.maxTop)),
});

// Pointer tracking writes only this surface's transform. The editor and native
// controls do not rerender per frame, and release keeps the exact drop position.
export function useFloatingInput(input, visible, waiting, statusTarget, onGripClick) {
  const anchor = useRef(null), position = useRef({ left: 16, top: 120 });
  const drag = useRef(null), frame = useRef(0), suppressClick = useRef(false);
  const focusRequested = useRef(false), [request, setRequest] = useState(0);
  function measure() {
    const element = input.current, workspace = element.closest(".mc-workbench");
    const rect = workspace.getBoundingClientRect();
    const header = workspace.querySelector(".mc-header").getBoundingClientRect();
    return { rect, width: element.offsetWidth, height: element.offsetHeight,
      minTop: Math.max(64, header.bottom - rect.top + 12),
      maxLeft: rect.width - element.offsetWidth - 16, maxTop: rect.height - element.offsetHeight - 16 };
  }
  function publish(point) {
    position.current = point;
    input.current.style.transform = `translate3d(${point.left}px, ${point.top}px, 0)`;
  }
  function paint() {
    frame.current = 0;
    const gesture = drag.current;
    if (!gesture) return;
    const dx = gesture.x - gesture.startX, dy = gesture.y - gesture.startY;
    if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
    gesture.moved = true;
    input.current.dataset.dragging = "";
    publish(clamp({ left: gesture.origin.left + dx, top: gesture.origin.top + dy }, gesture.bounds));
  }
  function finish(commit) {
    const gesture = drag.current;
    if (!gesture) return false;
    cancelAnimationFrame(frame.current); frame.current = 0;
    if (commit) paint();
    const point = commit ? clamp(position.current, measure()) : gesture.origin;
    publish(point); anchor.current = point;
    suppressClick.current = gesture.moved;
    drag.current = null;
    delete input.current.dataset.dragging;
    if (input.current.hasPointerCapture(gesture.id)) input.current.releasePointerCapture(gesture.id);
    return true;
  }
  useLayoutEffect(() => {
    if (!visible) { finish(false); return; }
    const element = input.current, workspace = element.closest(".mc-workbench");
    const place = () => {
      if (drag.current) return;
      const bounds = measure(), status = statusTarget?.getBoundingClientRect();
      const point = waiting && status ? { left: status.left - bounds.rect.left, top: status.bottom - bounds.rect.top + 12 }
        : anchor.current || { left: (bounds.rect.width - bounds.width) / 2, top: Math.min(240, bounds.rect.height / 3) };
      publish(clamp(point, bounds));
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(element); observer.observe(workspace);
    if (focusRequested.current && !waiting) {
      element.querySelector('[contenteditable="true"]')?.focus({ preventScroll: true }); focusRequested.current = false;
    }
    return () => { observer.disconnect(); finish(false); };
  }, [visible, waiting, statusTarget, request]);
  return {
    revealAt(point) {
      finish(false);
      if (point) {
        const { rect } = measure();
        anchor.current = { left: point.x - rect.left, top: point.y - rect.top };
      }
      focusRequested.current = true; setRequest(value => value + 1);
    },
    cancelDrag: () => finish(false),
    nudge(event) {
      const directions = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
      const direction = directions[event.key];
      if (!direction) return;
      event.preventDefault(); event.stopPropagation();
      const point = clamp({ left: position.current.left + direction[0], top: position.current.top + direction[1] }, measure());
      publish(point); anchor.current = point;
    },
    handlers: {
      onPointerDownCapture(event) {
        if (event.isPrimary) suppressClick.current = false;
        if (!visible || waiting || !event.isPrimary || event.button !== 0 || drag.current) return;
        const handle = event.target.closest(".mc-input-grip");
        if (!handle) return;
        event.preventDefault(); event.stopPropagation();
        suppressClick.current = false;
        drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY,
          x: event.clientX, y: event.clientY, origin: position.current, bounds: measure(), moved: false };
        input.current.setPointerCapture(event.pointerId);
      },
      onPointerMove(event) {
        if (drag.current?.id !== event.pointerId) return;
        drag.current.x = event.clientX; drag.current.y = event.clientY;
        if (Math.hypot(event.clientX - drag.current.startX, event.clientY - drag.current.startY) >= 4) drag.current.moved = true;
        if (!frame.current) frame.current = requestAnimationFrame(paint);
      },
      onPointerUp(event) {
        if (drag.current?.id !== event.pointerId) return;
        const gesture = drag.current;
        gesture.x = event.clientX; gesture.y = event.clientY;
        finish(true);
        if (!gesture.moved) onGripClick();
      },
      onPointerCancel(event) { if (drag.current?.id === event.pointerId) finish(false); },
      onLostPointerCapture(event) { if (drag.current?.id === event.pointerId) finish(false); },
      onClickCapture(event) {
        if (!suppressClick.current || event.detail === 0) return;
        suppressClick.current = false; event.preventDefault(); event.stopPropagation();
      },
    },
  };
}
