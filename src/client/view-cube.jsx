import React, { forwardRef, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { Tooltip } from "@deepseek-ai/dsh-client-ui-primitives";

const SIZE = 176;
const EDGE = 60;
const CENTER = new THREE.Vector2(80, 96);
const AXES = ["X", "Y", "Z"].map((label, index) => ({
  label, normal: new THREE.Vector3().setComponent(index, 1),
}));

function project(point) {
  return new THREE.Vector2(CENTER.x + point.x * EDGE / 2, CENTER.y - point.y * EDGE / 2);
}

function arrowPath(start, end, direction) {
  const side = new THREE.Vector2(-direction.y, direction.x);
  const wing = end.clone().addScaledVector(direction, -5);
  const left = wing.clone().addScaledVector(side, 3), right = wing.clone().addScaledVector(side, -3);
  return `M ${start.x} ${start.y} L ${end.x} ${end.y} M ${left.x} ${left.y} L ${end.x} ${end.y} L ${right.x} ${right.y}`;
}

function trackballPoint(x, y, rect, radiusFactor) {
  // Adding axes enlarges the widget, not its rotation sensitivity. Keep the
  // accepted 120px trackball diameter, centered on the cube's projected origin.
  const scale = rect.width / SIZE;
  const radius = 120 * scale * radiusFactor / 2;
  const px = (x - rect.left - CENTER.x * scale) / radius;
  const py = (rect.top + CENTER.y * scale - y) / radius;
  const distanceSq = px * px + py * py;
  const z = distanceSq <= 0.5 ? Math.sqrt(1 - distanceSq) : 0.5 / Math.sqrt(distanceSq);
  return new THREE.Vector3(px, py, z);
}

// Face normals and local lettering share the world's right-handed, Z-up basis.
const FACES = [
  ["right", "X", [1, 0, 0], [0, 0, 1]],
  ["left", "−X", [-1, 0, 0], [0, 0, 1]],
  ["rear", "Y", [0, 1, 0], [0, 0, 1]],
  ["front", "−Y", [0, -1, 0], [0, 0, 1]],
  ["top", "Z", [0, 0, 1], [0, 1, 0]],
  ["bottom", "−Z", [0, 0, -1], [0, -1, 0]],
].map(([id, label, normal, up]) => {
  const n = new THREE.Vector3(...normal), v = new THREE.Vector3(...up);
  const u = new THREE.Vector3().crossVectors(v, n);
  return {
    id, label, normal: n, right: u, up: v, axis: label.slice(-1).toLowerCase(),
    corners: [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([x, y]) =>
      n.clone().addScaledVector(u, x).addScaledVector(v, y)),
  };
});

// Use the same projected geometry for face, edge and corner picking. Geometry
// stays invisible; the cube itself is the complete navigation control.
function pickDirection(face, event, element, rotation) {
  const rect = element.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    (event.clientX - rect.left) * SIZE / rect.width,
    (event.clientY - rect.top) * SIZE / rect.height,
  );
  const points = face.corners.map((corner) => {
    const p = corner.clone().applyQuaternion(rotation);
    return project(p);
  });
  let nearest = 0;
  for (let i = 1; i < points.length; i++)
    if (points[i].distanceToSquared(pointer) < points[nearest].distanceToSquared(pointer)) nearest = i;
  if (points[nearest].distanceTo(pointer) <= 9) return face.corners[nearest].clone();
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const segment = points[j].clone().sub(points[i]);
    const length = segment.lengthSq();
    if (length < 1) continue;
    const amount = THREE.MathUtils.clamp(pointer.clone().sub(points[i]).dot(segment) / length, 0, 1);
    if (pointer.distanceTo(points[i].clone().addScaledVector(segment, amount)) <= 4)
      return face.corners[i].clone().add(face.corners[j]).multiplyScalar(0.5);
  }
  return face.normal.clone();
}

export const ViewCube = forwardRef(function ViewCube({ active, t, onSelect, onDragStart, onDrag, onDragEnd }, ref) {
  const root = useRef(null), gesture = useRef(null);
  const faceNodes = useRef(new Map());
  const axisNodes = useRef(new Map());
  const lastCamera = useRef(new THREE.Quaternion(0, 0, 0, 0));
  const rotation = useRef(new THREE.Quaternion());
  const radiusFactor = useRef(0.67);
  const [dragging, setDragging] = useState(false);
  useImperativeHandle(ref, () => ({
    sync(camera, controls) {
      radiusFactor.current = controls.radiusFactor;
      if (lastCamera.current.equals(camera.quaternion)) return;
      lastCamera.current.copy(camera.quaternion);
      rotation.current.copy(camera.quaternion).invert();
      // Update this tiny SVG in the viewport's own frame, using the exact
      // world-to-view rotation used to render the model. No CSS 3D conversion,
      // Euler angles, second camera, or delayed React pose update is involved.
      for (const face of FACES) {
        const node = faceNodes.current.get(face.id);
        if (!node) continue;
        const normal = face.normal.clone().applyQuaternion(rotation.current);
        const visible = normal.z > 0.001;
        node.setAttribute("visibility", visible ? "visible" : "hidden");
        node.setAttribute("tabindex", visible ? "0" : "-1");
        node.setAttribute("aria-hidden", String(!visible));
        node.setAttribute("aria-pressed", String(normal.z > 0.99999));
        if (!visible) continue;
        const points = face.corners.map((corner) => {
          const p = corner.clone().applyQuaternion(rotation.current);
          const point = project(p);
          return `${point.x},${point.y}`;
        });
        node.querySelector("path").setAttribute("d", `M ${points.join(" L ")} Z`);
        const right = face.right.clone().applyQuaternion(rotation.current);
        const down = face.up.clone().negate().applyQuaternion(rotation.current);
        // Match the prototype's readable lettering in both oblique and face
        // views, while retaining planar foreshortening as a face turns away.
        const textScale = 1 / Math.max(Math.hypot(right.x, right.y), Math.hypot(down.x, down.y));
        const center = project(normal);
        node.querySelector("text").setAttribute("transform", `matrix(${right.x * textScale} ${-right.y * textScale} ${down.x * textScale} ${-down.y * textScale} ${center.x} ${center.y})`);
      }
      for (const axis of AXES) {
        const back = axisNodes.current.get(`back-${axis.label}`);
        const front = axisNodes.current.get(`front-${axis.label}`);
        if (!back || !front) continue;
        const normal = axis.normal.clone().applyQuaternion(rotation.current);
        const direction = new THREE.Vector2(normal.x, -normal.y);
        const length = direction.length();
        const visible = length > 0.001;
        const facing = normal.z >= 0;
        back.setAttribute("display", visible ? "inline" : "none");
        front.setAttribute("display", visible && facing ? "inline" : "none");
        if (!visible) continue;
        direction.divideScalar(length);
        // Unit cube faces are at +/-1. The shaft starts at the internal
        // origin, crosses its +1 face center and ends at +2.65, never a corner.
        const exit = project(normal), end = project(normal.clone().multiplyScalar(2.65));
        back.querySelector("path").setAttribute("d", facing
          ? `M ${CENTER.x} ${CENTER.y} L ${exit.x} ${exit.y}`
          : arrowPath(CENTER, end, direction));
        front.querySelector("path").setAttribute("d", arrowPath(exit, end, direction));
      }
    },
  }), []);
  const renderAxes = (layer) => (
    <g className="mc-cube-axes" aria-hidden="true">
      {AXES.map((axis) => (
        <g
          key={axis.label}
          ref={(node) => {
            const key = `${layer}-${axis.label}`;
            if (node) axisNodes.current.set(key, node);
            else axisNodes.current.delete(key);
          }}
          className="mc-cube-axis"
          data-axis={axis.label.toLowerCase()}
          display="none"
        >
          <path />
        </g>
      ))}
    </g>
  );
  function finish(event, cancelled = false) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    setDragging(false);
    onDragEnd();
    if (root.current.hasPointerCapture(event.pointerId)) root.current.releasePointerCapture(event.pointerId);
    if (!cancelled && !current.moved)
      onSelect(pickDirection(current.face, event, root.current, rotation.current));
  }
  return (
    <div
      ref={root}
      className="mc-view-cube"
      hidden={!active}
      role="group"
      aria-label={t("viewCube")}
      data-dragging={dragging || undefined}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary || gesture.current) return;
        const button = event.target.closest("[data-cube-face]");
        const face = FACES.find((item) => item.id === button?.dataset.cubeFace);
        if (!face) return;
        event.preventDefault();
        button.focus({ preventScroll: true });
        const rect = root.current.getBoundingClientRect();
        gesture.current = {
          id: event.pointerId, face, x: event.clientX, y: event.clientY,
          rect, radiusFactor: radiusFactor.current,
          start: trackballPoint(event.clientX, event.clientY, rect, radiusFactor.current), moved: false,
        };
        root.current.setPointerCapture(event.pointerId);
        onDragStart();
      }}
      onPointerMove={(event) => {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        const dx = event.clientX - current.x, dy = event.clientY - current.y;
        if (current.moved || Math.hypot(dx, dy) >= 4) {
          current.moved = true;
          setDragging(true);
          onDrag(current.start, trackballPoint(event.clientX, event.clientY, current.rect, current.radiusFactor));
        }
      }}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) => finish(event, true)}
    >
      <svg className="mc-cube-body" viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {renderAxes("back")}
        {FACES.map((face) => {
          const label = `${t(face.id)} (${face.label})`;
          return (
            <Tooltip key={face.id} label={label} portal>
              <g
                ref={(node) => {
                  if (node) faceNodes.current.set(face.id, node);
                  else faceNodes.current.delete(face.id);
                }}
                className="mc-cube-face"
                role="button"
                data-cube-face={face.id}
                data-axis={face.axis}
                tabIndex={-1}
                visibility="hidden"
                aria-hidden="true"
                aria-label={label}
                aria-pressed="false"
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(face.normal.clone());
                  }
                }}
                onClick={(event) => {
                  // Pointer clicks are handled on release so a drag cannot snap.
                  if (event.detail === 0) onSelect(face.normal.clone());
                }}
              >
                <path />
                <text x="0" y="0" textAnchor="middle" dominantBaseline="central">{face.label}</text>
              </g>
            </Tooltip>
          );
        })}
        {/* Outward shafts are in front of face lettering; no text mask or gap. */}
        {renderAxes("front")}
      </svg>
    </div>
  );
});
