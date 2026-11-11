import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ArcballControls } from "three/addons/controls/ArcballControls.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { Button, pointerModality, Tag, IconTrashOutlineRegular, IconRefreshOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import { defaultIdFormats, geometryLabel, geometryReference } from "../shared/geometry-ids.js";
import { ViewCube } from "./view-cube.jsx";

// Keep grid intervals and scale labels in readable millimetre increments.
function scaleStep(value) {
  const power = 10 ** Math.floor(Math.log10(value));
  const fraction = value / power;
  return (fraction >= 5 ? 5 : fraction >= 2 ? 2 : 1) * power;
}

function millimetres(value) {
  return String(Number(value.toPrecision(6)));
}

function surfaceGeometry(preview) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(preview.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(preview.indices, 1));
  geometry.setAttribute("normal", new THREE.BufferAttribute(preview.normals, 3));
  return geometry;
}

function surfaceColorUpdater(mesh, { faceColors, faceIndices, indices, positions }) {
  if (!faceColors.length) return color => mesh.material.color.setHex(color);
  const attribute = new THREE.BufferAttribute(new Float32Array(positions.length), 3);
  mesh.geometry.setAttribute("color", attribute);
  mesh.material.vertexColors = true;
  const rgb = new THREE.Color();
  let lastFallback;
  return fallback => {
    if (fallback === lastFallback) return;
    lastFallback = fallback;
    let lastColor = -1;
    for (let i = 0; i < faceIndices.length; i++) {
      const packed = faceColors[faceIndices[i]];
      const color = packed ? packed - 1 : fallback;
      if (color !== lastColor) {
        rgb.setHex(color);
        lastColor = color;
      }
      for (let corner = 0; corner < 3; corner++)
        attribute.setXYZ(indices[i * 3 + corner], rgb.r, rgb.g, rgb.b);
    }
    attribute.needsUpdate = true;
  };
}

const diffColors = {
  added: [0x16834a, 0x61d994], removed: [0xc33a48, 0xff7b86], unchanged: [0x94a0b0, 0x8f9caf],
};

export function Viewport({ id, active = true, presentation = "workbench", historyOpen = false, sidebarCollapsed = false, design, diff, wire, transparent = false, resetToken, targets = [], measurementResult, selectionTools, selectionInstant, pickingDisabled, onPick, selecting = false, section = null, explode = 0, explodeAxis = "radial", followPreview = true, fitBounds = null, striking = false, onStrike, marks = [], onMarkDelete, onMarkRestrike, onError, t }) {
  const mount = useRef(null);
  const runtime = useRef(null);
  const cube = useRef(null);
  const marksLayer = useRef(null);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const coordinates = useRef(null);
  const partHover = useRef(null);
  const [scale, setScale] = useState(null);
  const floating = useRef(null);
  const selectionProps = useRef(null);
  selectionProps.current = { design, selecting, targets, onPick, pickingDisabled, striking, onStrike };
  useEffect(() => {
    const el = mount.current;
    const contained = presentation === "record";
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
      onError();
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(
      -100,
      100,
      100,
      -100,
      0.01,
      1000000,
    );
    camera.up.set(0, 0, 1);
    camera.position.set(100, -140, 110);
    let controls = new ArcballControls(camera, renderer.domElement);
    const trackballRadiusFactor = controls.radiusFactor;
    const navigationArea = el.closest(".mc-workbench") || el;
    function updateTrackballRadius() {
      const viewportSize = Math.min(el.clientWidth, el.clientHeight);
      if (!viewportSize) return;
      // Use the same sphere size in screen pixels in the workbench and record.
      // A smaller preview must not amplify rotation or move drags onto its rim.
      const referenceSize = Math.min(navigationArea.clientWidth, navigationArea.clientHeight);
      controls.setTbRadius(trackballRadiusFactor * referenceSize / viewportSize);
    }
    controls.cursorZoom = true;
    controls.enableGizmos = false;
    controls.setGizmosVisible(false);
    controls.enableFocus = false;
    const initialRotation = camera.quaternion.clone();
    const model = new THREE.Group();
    scene.add(model);
    const diffModel = new THREE.Group();
    scene.add(diffModel);
    const selectionOverlay = new THREE.Group();
    scene.add(selectionOverlay);
    const measurementOverlay = new THREE.Group();
    scene.add(measurementOverlay);
    scene.add(new THREE.AmbientLight(0xffffff, 2.1));
    for (const [position, power] of [
      [[100, -150, 250], 3],
      [[-120, 120, 100], 1.1],
    ]) {
      const light = new THREE.DirectionalLight(0xffffff, power);
      light.position.set(...position);
      scene.add(light);
    }
    const grid = new THREE.Group();
    grid.position.z = -0.01;
    // A separate orthographic background pass prevents the floor grid from
    // crossing the model camera's near/far planes when zoomed far out.
    const gridScene = new THREE.Scene();
    const gridCamera = camera.clone();
    gridScene.add(grid);
    const gridAxes = [[-1, 0, 0, 1, 0, 0], [0, -1, 0, 0, 1, 0]].map(points => {
      const axis = new LineSegments2(new LineSegmentsGeometry().setPositions(points), new LineMaterial({
        linewidth: 1.6, alphaToCoverage: true, transparent: true, depthTest: false, depthWrite: false,
      }));
      axis.position.z = grid.position.z;
      axis.renderOrder = 1;
      return axis;
    });
    gridScene.add(...gridAxes);
    const groundLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0),
      ]),
      new THREE.LineBasicMaterial({ transparent: true, depthWrite: false }),
    );
    gridScene.add(groundLine);
    renderer.autoClear = false;
    const state = {
      renderer,
      scene,
      camera,
      controls,
      model,
      diffModel,
      // Local clipping stays enabled; the plane parks far away when unused so
      // every material keeps a stable clipping array without recompiling.
      clipping: [new THREE.Plane(new THREE.Vector3(0, 0, 1), 1e6)],
      span: 180,
      center: new THREE.Vector3(),
      bounds: new THREE.Box3(),
      dark: false,
      wire: false,
      defaultView: true,
      orbitDistance: camera.position.length(),
      section: null,
      sectionActive: false,
      explode: 0,
      explodeAxis: "radial",
      explodedActive: false,
      transparent: false,
    };
    let turn = null, cubeDrag = null, fitFrame = 0;
    let renderFrame = 0, disposed = false, inView = true;
    // Pointer-only frames update the readout without redrawing the scene.
    let sceneDirty = false;
    state.active = active;
    const canRender = () => !disposed && inView && state.active && !document.hidden;
    function scheduleFrame() {
      if (canRender() && !renderFrame) renderFrame = requestAnimationFrame(draw);
    }
    function invalidate() {
      sceneDirty = true;
      scheduleFrame();
    }
    state.invalidate = invalidate;
    state.clearPick = () => {
      for (const item of [...selectionOverlay.children]) {
        if (item.userData.sharedPosition) item.geometry.deleteAttribute("position");
        item.geometry.dispose(); item.material.dispose(); selectionOverlay.remove(item);
      }
      invalidate();
    };
    // Section plane: the cut is only a view state, so picking skips geometry on
    // the removed side instead of changing the model or the saved revision.
    state.clipTest = point => !state.sectionActive || state.clipping[0].distanceToPoint(point) >= 0;
    state.applySection = () => {
      const plane = state.clipping[0];
      const section = state.section;
      let active = false;
      if (section?.axis && !state.bounds.isEmpty()) {
        const index = section.axis === "x" ? 0 : section.axis === "y" ? 1 : 2;
        const min = state.bounds.min.getComponent(index), max = state.bounds.max.getComponent(index);
        const position = Math.min(1, Math.max(0, Number(section.position) || 0));
        // Keep the far side first, so the initial three-quarter view looks into
        // the cut instead of at the removed half's outer surface.
        const sign = (index === 1 ? 1 : -1) * (section.flip ? -1 : 1);
        plane.normal.set(0, 0, 0).setComponent(index, sign);
        plane.constant = -(min + (max - min) * position) * sign;
        active = true;
      }
      if (!active) {
        plane.normal.set(0, 0, 1);
        plane.constant = 1e6;
      }
      state.sectionActive = active;
      if (state.surface)
        state.surface.material.side = active || state.transparent ? THREE.DoubleSide : THREE.FrontSide;
      invalidate();
    };
    state.setSection = section => {
      state.section = section;
      state.applySection();
    };
    // Exploded view: parts keep their own preview slice and translate along the
    // vector from the assembly centre to their bounding-box centre.
    state.clearExploded = () => {
      if (!state.explodedGroup) return;
      for (const partGroup of state.explodedGroup.children)
        partGroup.traverse(item => {
          if (!item.geometry) return;
          // Shared attributes belong to the assembled surface; remove them from
          // this geometry before disposing so its buffers stay alive.
          if (item.userData.sharedAttributes) {
            item.geometry.deleteAttribute("position");
            item.geometry.deleteAttribute("normal");
            item.geometry.deleteAttribute("color");
          }
          item.geometry.dispose();
          if (item.userData.ownMaterial) item.material.dispose();
        });
      state.model.remove(state.explodedGroup);
      state.explodedGroup = null;
    };
    state.buildExploded = (preview, parts) => {
      if (!preview || !parts || parts.length < 2 || !state.surface) return;
      const group = new THREE.Group();
      group.visible = false;
      const position = state.surface.geometry.getAttribute("position");
      const normal = state.surface.geometry.getAttribute("normal");
      const color = state.surface.geometry.getAttribute("color");
      const buckets = parts.map(() => []);
      for (let triangle = 0; triangle < preview.faceIndices.length; triangle++) {
        const face = preview.faceIndices[triangle];
        for (let index = 0; index < parts.length; index++) {
          const part = parts[index];
          if (face >= part.faceStart && face < part.faceStart + part.faceCount) {
            buckets[index].push(triangle);
            break;
          }
        }
      }
      const center = state.bounds.getCenter(new THREE.Vector3());
      // Axial mode keeps the order along one axis and adds a uniform gap, so
      // parts separate even when their bounding-box centres coincide.
      const axial = { x: [], y: [], z: [] };
      for (const [axisIndex, key] of ["x", "y", "z"].entries()) {
        const maxSize = Math.max(1e-6, ...parts.map(part => Math.abs(part.size?.[axisIndex] || 0)));
        const span = Math.abs(state.bounds.max.getComponent(axisIndex) - state.bounds.min.getComponent(axisIndex));
        const step = Math.max(maxSize * 1.25, span * 0.15);
        const order = parts.map((_, partIndex) => partIndex)
          .sort((left, right) => parts[left].center[axisIndex] - parts[right].center[axisIndex]);
        order.forEach((partIndex, rank) => {
          const offset = new THREE.Vector3();
          offset.setComponent(axisIndex, (rank - (order.length - 1) / 2) * step);
          axial[key][partIndex] = offset;
        });
      }
      parts.forEach((part, index) => {
        const partGroup = new THREE.Group();
        const size = part.size || [0, 0, 0];
        partGroup.userData.offsets = {
          radial: new THREE.Vector3().fromArray(part.center).sub(center).multiplyScalar(1.4),
          x: axial.x[index], y: axial.y[index], z: axial.z[index],
        };
        partGroup.userData.box = new THREE.Box3(
          new THREE.Vector3(part.center[0] - size[0] / 2, part.center[1] - size[1] / 2, part.center[2] - size[2] / 2),
          new THREE.Vector3(part.center[0] + size[0] / 2, part.center[1] + size[1] / 2, part.center[2] + size[2] / 2),
        );
        const triangles = buckets[index];
        if (triangles.length) {
          const indices = new Uint32Array(triangles.length * 3);
          triangles.forEach((triangle, slot) => {
            indices[slot * 3] = preview.indices[triangle * 3];
            indices[slot * 3 + 1] = preview.indices[triangle * 3 + 1];
            indices[slot * 3 + 2] = preview.indices[triangle * 3 + 2];
          });
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", position);
          geometry.setAttribute("normal", normal);
          if (color) geometry.setAttribute("color", color);
          geometry.setIndex(new THREE.BufferAttribute(indices, 1));
          const mesh = new THREE.Mesh(geometry, state.surface.material);
          mesh.userData.sharedAttributes = true;
          partGroup.add(mesh);
        }
        const segments = [];
        for (let segment = 0; segment < preview.edgeIndices.length; segment++) {
          const edge = preview.edgeIndices[segment];
          if (edge < part.edgeStart || edge >= part.edgeStart + part.edgeCount) continue;
          for (let value = 0; value < 6; value++) segments.push(preview.edges[segment * 6 + value]);
        }
        if (segments.length) {
          const edgeGeometry = new LineSegmentsGeometry();
          edgeGeometry.setPositions(segments);
          const lines = new LineSegments2(edgeGeometry, new LineMaterial({
            color: 0x9ca8b8, linewidth: 1, worldUnits: false, alphaToCoverage: true,
            transparent: true, opacity: 0.65, depthWrite: false, clippingPlanes: state.clipping,
          }));
          lines.userData.ownMaterial = true;
          partGroup.add(lines);
        }
        group.add(partGroup);
      });
      state.model.add(group);
      state.explodedGroup = group;
    };
    state.applyExplode = () => {
      const active = state.explode > 0 && !!state.explodedGroup;
      if (state.explodedGroup) {
        state.explodedGroup.visible = active;
        for (const partGroup of state.explodedGroup.children) {
          const offset = partGroup.userData.offsets?.[state.explodeAxis] || partGroup.userData.offsets?.radial;
          if (offset) partGroup.position.copy(offset).multiplyScalar(state.explode);
        }
      }
      if (state.surface) state.surface.visible = !active && !state.wire;
      if (state.edges) state.edges.visible = !active;
      state.explodedActive = active;
      invalidate();
    };
    state.setExplode = explode => {
      state.explode = Number.isFinite(explode) ? Math.max(0, Math.min(1, explode)) : 0;
      state.applyExplode();
    };
    state.setExplodeAxis = axis => {
      state.explodeAxis = ["x", "y", "z"].includes(axis) ? axis : "radial";
      state.applyExplode();
    };
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2(), ndc = new THREE.Vector2();
    const cursorValues = coordinates.current?.querySelectorAll("[data-coordinate]");
    const cursorHits = [], gridPoint = new THREE.Vector3();
    const xyPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1));
    let cursorOnCanvas = false, hoverAllowed = true;
    function setPointerRay(x, y, rect) {
      ndc.set((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2);
      raycaster.setFromCamera(ndc, camera);
    }
    function showCoordinates(point) {
      cursorValues?.forEach((element, axis) => {
        const value = point?.getComponent(axis);
        const label = value === undefined ? "—" : (Math.abs(value) < 0.005 ? 0 : value).toFixed(2);
        if (element.textContent !== label) element.textContent = label;
      });
    }
    function clearCoordinates() {
      cursorOnCanvas = false;
      showCoordinates(null);
      if (partHover.current) partHover.current.hidden = true;
    }
    state.clearCursor = clearCoordinates;
    function pickTarget(surfaceHit, rect) {
      const { design } = selectionProps.current;
      const preview = design?.previewData;
      if (!preview || !state.surface) return null;
      let index, kind, point;
      if (surfaceHit) { index = preview.faceIndices[surfaceHit.faceIndex]; kind = "faces"; point = surfaceHit.point; }
      if (state.edgePicker) {
        const mmPerPixel = (camera.top-camera.bottom)/camera.zoom/rect.height;
        raycaster.params.Line.threshold = mmPerPixel * 6;
        const hit = raycaster.intersectObject(state.edgePicker, false).find(hit => state.clipTest(hit.point) && (state.wire || !surfaceHit || hit.distance <= surfaceHit.distance + mmPerPixel * 6));
        if (hit) { index = preview.edgeIndices[Math.floor(hit.index / 2)]; kind = "edges"; point = hit.point; }
      }
      if (index === undefined) return null;
      const entity = design.entities?.find(entity => entity[kind].includes(index));
      return { kind, index, point: point.toArray(), entityName: entity?.name,
        label: geometryLabel(kind, index, design.geometryIds || defaultIdFormats),
        reference: geometryReference(design.geometryScope, design.revision, kind, index),
      };
    }
    function showPartName(surfaceHit, rect) {
      const element = partHover.current;
      if (!element) return;
      const name = hoverAllowed && !state.diffActive ? pickTarget(surfaceHit, rect)?.entityName : "";
      element.hidden = !name;
      if (!name) return;
      if (element.textContent !== name) element.textContent = name;
      const viewport = el.getBoundingClientRect();
      const width = element.offsetWidth, height = element.offsetHeight;
      const x = pointer.x - viewport.left, y = pointer.y - viewport.top;
      const left = Math.max(12, Math.min(x + 14, viewport.width - width - 12));
      const top = Math.max(12, Math.min(y + 18 + height <= viewport.height - 12 ? y + 18 : y - height - 12, viewport.height - height - 12));
      element.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    }
    function updateCoordinates() {
      if (!cursorOnCanvas) return;
      const rect = renderer.domElement.getBoundingClientRect();
      if (pointer.x < rect.left || pointer.x >= rect.right || pointer.y < rect.top || pointer.y >= rect.bottom) {
        clearCoordinates();
        return;
      }
      setPointerRay(pointer.x, pointer.y, rect);
      if (state.diffActive) {
        for (const item of diffModel.children) {
          if (item.isMesh && !item.isLineSegments2) raycaster.intersectObject(item, false, cursorHits);
        }
      } else if (state.surface && !state.explodedActive) {
        raycaster.intersectObject(state.surface, false, cursorHits);
      }
      const hit = cursorHits.find(candidate => state.diffActive || state.clipTest(candidate.point));
      cursorHits.length = 0;
      const gridHit = !hit && Math.abs(raycaster.ray.direction.z) > 0.04
        ? raycaster.ray.intersectPlane(xyPlane, gridPoint) : null;
      showCoordinates(hit?.point ?? gridHit);
      showPartName(hit, rect);
    }
    let clickStart = null;
    const startPick = (event) => {
      hoverAllowed = false;
      if (partHover.current) partHover.current.hidden = true;
      const { selecting, striking, pickingDisabled } = selectionProps.current;
      if (event.button === 0 && (selecting || striking) && !pickingDisabled)
        clickStart = { x: event.clientX, y: event.clientY, id: event.pointerId, extend: event.ctrlKey };
    };
    const endPick = (event) => {
      const start = clickStart;
      clickStart = null;
      const { design, selecting, striking, pickingDisabled, onPick, onStrike } = selectionProps.current;
      if ((!selecting && !striking) || pickingDisabled || !start || start.id !== event.pointerId || Math.hypot(event.clientX-start.x,event.clientY-start.y) > 4) return;
      const preview = design?.previewData;
      if (!preview || !state.surface) return;
      const rect = renderer.domElement.getBoundingClientRect();
      setPointerRay(event.clientX, event.clientY, rect);
      const surfaceHit = raycaster.intersectObject(state.surface, false).find(hit => state.clipTest(hit.point));
      if (striking) {
        if (surfaceHit) onStrike?.({
          point: surfaceHit.point.toArray(),
          normal: surfaceHit.face.normal.toArray(),
          face: preview.faceIndices[surfaceHit.faceIndex],
        });
        return;
      }
      onPick(pickTarget(surfaceHit, rect), start.extend);
    };
    state.highlightPicks = targets => {
      state.clearPick();
      const preview = selectionProps.current.design?.previewData;
      if (!preview || !state.surface) return;
      for (const { kind, index } of targets) {
        let highlight;
        if (kind === "faces") {
          let count = 0;
          for (const owner of preview.faceIndices) if (owner === index) count++;
          const triangles = new Uint32Array(count * 3);
          let offset = 0;
          for (let i=0; i<preview.faceIndices.length; i++) if (preview.faceIndices[i] === index) {
            triangles.set(preview.indices.subarray(i*3, i*3+3), offset); offset += 3;
          }
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", state.surface.geometry.getAttribute("position"));
          geometry.setIndex(new THREE.BufferAttribute(triangles, 1));
          highlight = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: state.dark ? 0x8fb8ff : 0x2456a6, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, clippingPlanes: state.clipping }));
          highlight.userData.sharedPosition = true;
        } else {
          const lines = [];
          for (let i=0; i<preview.edgeIndices.length; i++) if (preview.edgeIndices[i] === index)
            for (let j=0;j<6;j++) lines.push(preview.edges[i*6+j]);
          const geometry = new LineSegmentsGeometry();
          geometry.setPositions(lines);
          highlight = new LineSegments2(geometry, new LineMaterial({ color: state.dark ? 0x8fb8ff : 0x2456a6, linewidth: 3, depthWrite: false, clippingPlanes: state.clipping }));
        }
        selectionOverlay.add(highlight);
      }
      invalidate();
    };
    state.showMeasurement = items => {
      for (const item of [...measurementOverlay.children]) {
        item.geometry.dispose(); item.material.dispose(); measurementOverlay.remove(item);
      }
      for (const [index, item] of (items || []).entries()) {
        const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...item.point), new THREE.Vector3(...item.otherPoint)]);
        const color = index ? 0xd49423 : 0x357aea;
        const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color, depthTest: false, transparent: true, opacity: .95,
          dashSize: index ? Math.max(item.value / 35, .05) : 1e10, gapSize: index ? Math.max(item.value / 60, .03) : 0, clippingPlanes: state.clipping }));
        line.computeLineDistances(); line.renderOrder = 10; measurementOverlay.add(line);
        const dots = new THREE.Points(geometry.clone(), new THREE.PointsMaterial({ color, size: 7, depthTest: false, clippingPlanes: state.clipping }));
        dots.renderOrder = 11; measurementOverlay.add(dots);
      }
      invalidate();
    };
    const anchorPoint = new THREE.Vector3();
    state.positionSelection = () => {
      const panel = floating.current;
      const { targets, selecting } = selectionProps.current;
      const target = targets.at(-1);
      if (!panel || !selecting || !target) return;
      const viewport = el.getBoundingClientRect();
      const owner = el.closest(".mc-workbench");
      const box = selector => owner?.querySelector(selector)?.getBoundingClientRect();
      const sidebar = owner?.hasAttribute("data-project-panel-collapsed") ? null : box(".mc-sidebar"), header = box(".mc-header");
      const left = Math.min(Math.max(12, sidebar?.width ? sidebar.right - viewport.left + 12 : 12), Math.max(12, viewport.width - 160));
      const right = Math.max(left + 120, viewport.width - 12);
      let top = Math.max(12, (header?.bottom || viewport.top) - viewport.top + 12);
      panel.style.maxWidth = `${Math.max(120, right - left)}px`;
      anchorPoint.fromArray(target.point).project(camera);
      const x = (anchorPoint.x + 1) * viewport.width / 2;
      const y = (1 - anchorPoint.y) * viewport.height / 2;
      const width = panel.offsetWidth;
      let px = Math.max(left, Math.min(x + 12 + width <= right ? x + 12 : x - 12 - width, right - width));
      const inspection = box(".mc-inspection");
      if (inspection && px + width > inspection.left - viewport.left && px < inspection.right - viewport.left) {
        const before = inspection.left - viewport.left - width - 12;
        if (before >= left) px = Math.min(px, before);
        else top = Math.max(top, inspection.bottom - viewport.top + 12);
      }
      let bottom = viewport.height - 20;
      const navigation = box(".mc-navigation");
      if (navigation && px + width > navigation.left - viewport.left && px < navigation.right - viewport.left)
        bottom = Math.max(top + 44, Math.min(bottom, navigation.top - viewport.top - 12));
      panel.style.maxHeight = `${Math.max(44, bottom - top)}px`;
      const height = panel.offsetHeight;
      const above = y + 12 + height > bottom && y - top > bottom - y;
      panel.dataset.panelSide = above ? "top" : "bottom";
      const py = Math.max(top, Math.min(above ? y - 12 - height : y + 12, bottom - height));
      panel.style.transform = `translate3d(${px}px, ${py}px, 0)`;
      const barHeight = panel.querySelector(".mc-selection-bar")?.offsetHeight || 44;
      panel.style.setProperty("--mc-bar-origin", `${Math.max(0, Math.min(width, x - px))}px ${above ? barHeight : 0}px`);
      panel.dataset.placed = "true";
    };
    const markProjection = new THREE.Vector3();
    // Instrument strikes are HTML pills over the canvas, projected each frame so
    // orbiting keeps them on their model positions.
    state.positionMarks = () => {
      const layer = marksLayer.current;
      if (!layer) return;
      const items = marksRef.current;
      const width = el.clientWidth, height = el.clientHeight;
      for (let index = 0; index < layer.children.length; index++) {
        const chip = layer.children[index];
        const mark = items[index];
        if (!mark) { chip.style.visibility = "hidden"; continue; }
        markProjection.fromArray(mark.point).project(camera);
        const x = (markProjection.x + 1) * width / 2;
        const y = (1 - markProjection.y) * height / 2;
        const visible = markProjection.z >= -1 && markProjection.z <= 1;
        chip.style.visibility = visible ? "visible" : "hidden";
        chip.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%) translateY(3px)`;
      }
    };
    const cancelPointer = () => { clickStart = null; clearCoordinates(); };
    const movePointer = event => {
      if (clickStart && Math.hypot(event.clientX-clickStart.x,event.clientY-clickStart.y) > 4) clickStart = null;
      if (!cursorValues || event.pointerType !== "mouse") return;
      hoverAllowed = !event.buttons;
      cursorOnCanvas = true;
      pointer.set(event.clientX, event.clientY);
      scheduleFrame();
    };
    renderer.domElement.addEventListener("pointerdown", startPick);
    renderer.domElement.addEventListener("pointerup", endPick);
    renderer.domElement.addEventListener("pointermove", movePointer);
    renderer.domElement.addEventListener("pointerleave", clearCoordinates);
    renderer.domElement.addEventListener("pointercancel", cancelPointer);
    state.setActive = (value) => {
      state.active = value;
      controls.enabled = canRender() && !turn && !cubeDrag;
      if (canRender()) invalidate();
      else {
        cancelAnimationFrame(renderFrame); renderFrame = 0;
        clearCoordinates();
      }
    };
    controls.addEventListener("change", invalidate);
    function leaveDefaultView() {
      state.defaultView = false;
      cancelAnimationFrame(fitFrame);
      fitFrame = 0;
    }
    function stopMotion() {
      turn = null;
      // Dispose cancels inertia and active input. Never reset/reuse that
      // controller: its saved projection, pivot and input state may be stale.
      controls.enabled = false;
      controls.dispose();
    }
    function currentTarget() {
      // Arcball's public target is not updated by orthographic panning. Its
      // camera-to-pivot distance stays constant through pan, orbit and zoom.
      return camera.getWorldDirection(new THREE.Vector3())
        .multiplyScalar(state.orbitDistance).add(camera.position);
    }
    function applyOrbit(target, quaternion) {
      camera.quaternion.copy(quaternion);
      camera.position.set(0, 0, state.orbitDistance)
        .applyQuaternion(quaternion).add(target);
      camera.up.set(0, 1, 0).applyQuaternion(quaternion);
      camera.updateMatrixWorld();
    }
    function rebaseControls(target) {
      const rotation = camera.quaternion.clone();
      controls.dispose();
      controls = new ArcballControls(camera, renderer.domElement);
      controls.cursorZoom = true;
      controls.enableGizmos = false;
      controls.enableFocus = false;
      controls.target.copy(target);
      // Construction initially looks at the origin; restore the live pose
      // before binding the actual (possibly panned) viewing center.
      camera.quaternion.copy(rotation);
      controls.setCamera(camera);
      updateTrackballRadius();
      controls.update();
      controls.saveState();
      controls.setGizmosVisible(false);
      state.controls = controls;
      controls.addEventListener("change", invalidate);
      controls.enabled = canRender() && !turn && !cubeDrag;
    }
    function finishTurn() {
      if (!turn) return;
      const target = turn.target;
      turn = null;
      rebaseControls(target);
    }
    // Manual navigation ends automatic initial framing and interrupts a snap.
    function beginNavigation() {
      leaveDefaultView();
      finishTurn();
    }
    renderer.domElement.addEventListener("pointerdown", beginNavigation, true);
    renderer.domElement.addEventListener("wheel", beginNavigation, { capture: true, passive: true });
    state.orient = (normal) => {
      leaveDefaultView();
      stopMotion();
      const direction = normal.clone().normalize();
      const up = Math.abs(direction.z) > 0.99999
        ? new THREE.Vector3(0, direction.z > 0 ? 1 : -1, 0)
        : new THREE.Vector3(0, 0, 1);
      turn = {
        start: performance.now(),
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240,
        from: camera.quaternion.clone(),
        to: new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().lookAt(direction, new THREE.Vector3(), up),
        ),
        target: currentTarget(),
      };
      controls.enabled = false;
      invalidate();
    };
    state.beginCubeDrag = () => {
      leaveDefaultView();
      stopMotion();
      cubeDrag = { target: currentTarget(), from: camera.quaternion.clone() };
      controls.enabled = false;
    };
    state.rotateCube = (start, end) => {
      if (!cubeDrag) return;
      // Same sphere/hyperboloid rotation rule as ArcballControls, in local
      // camera coordinates. The inverse rotates the camera around the cube.
      const axis = new THREE.Vector3().crossVectors(start, end);
      if (axis.lengthSq() < 1e-12) return;
      const angle = Math.max(start.distanceTo(end), start.angleTo(end)) * controls.rotateSpeed;
      const rotation = cubeDrag.from.clone().multiply(
        new THREE.Quaternion().setFromAxisAngle(axis.normalize(), -angle),
      );
      applyOrbit(cubeDrag.target, rotation);
      invalidate();
    };
    state.endCubeDrag = () => {
      if (!cubeDrag) return;
      const target = cubeDrag.target;
      cubeDrag = null;
      rebaseControls(target);
      invalidate();
    };
    state.fit = (rotation = camera.quaternion.clone(), override = null) => {
      stopMotion();
      cubeDrag = null;
      camera.zoom = 1;
      const bounds = override ? override.clone() : state.bounds.clone();
      if (!override) {
        if (state.diffBounds) bounds.copy(state.diffBounds);
        else if (state.explodedGroup && state.explode > 0)
          for (const partGroup of state.explodedGroup.children)
            if (partGroup.children.length)
              bounds.union(partGroup.userData.box.clone().translate(partGroup.position));
      }
      const center = bounds.isEmpty() ? state.center : bounds.getCenter(new THREE.Vector3());
      const target = center.clone();
      if (!bounds.isEmpty()) {
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h) {
          rebaseControls(currentTarget());
          return;
        }
        const viewport = el.getBoundingClientRect();
        const area = { left: 24, right: w - 24, top: 24, bottom: h - 24 };
        // A contained record stage has no workbench chrome inside its viewport.
        // External workbench rectangles otherwise move the model offscreen.
        const owner = contained ? null : el.closest(".mc-workbench");
        const rect = (selector) => owner?.querySelector(selector)?.getBoundingClientRect();
        const sidebar = owner?.hasAttribute("data-project-panel-collapsed") ? null : rect(".mc-sidebar");
        if (sidebar?.width) area.left = sidebar.right - viewport.left + 24;
        // The composer overlays the canvas; opening it must not change framing.
        for (const selector of [".mc-header", ".mc-version-diff", ".mc-record-toolbar"]) {
          const box = rect(selector);
          if (box?.height) area.top = Math.max(area.top, box.bottom - viewport.top + 16);
        }
        const history = rect(".mc-record-reel");
        if (history?.height) area.bottom = Math.min(area.bottom, history.top - viewport.top - 16);
        const navigation = rect(".mc-navigation");
        if (navigation?.width && navigation.top - viewport.top < area.bottom && navigation.bottom - viewport.top > area.top)
          area.right = Math.min(area.right, navigation.left - viewport.left - 16);
        area.left = Math.min(area.left, w - 88);
        area.right = Math.max(area.right, area.left + 64);
        area.top = Math.min(area.top, h - 88);
        area.bottom = Math.max(area.bottom, area.top + 64);
        const inverse = rotation.clone().invert();
        const projection = new THREE.Box3();
        for (const x of [bounds.min.x, bounds.max.x])
          for (const y of [bounds.min.y, bounds.max.y])
            for (const z of [bounds.min.z, bounds.max.z])
              projection.expandByPoint(new THREE.Vector3(x, y, z).sub(center).applyQuaternion(inverse));
        const size = projection.getSize(new THREE.Vector3());
        const mmPerPixel = Math.max(size.x / (area.right - area.left), size.y / (area.bottom - area.top), 1e-6) * 1.15;
        state.span = mmPerPixel * h;
        state.orbitDistance = Math.max(bounds.getSize(new THREE.Vector3()).length() * 3, 1);
        target.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(rotation),
          (w / 2 - (area.left + area.right) / 2) * mmPerPixel);
        target.addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(rotation),
          ((area.top + area.bottom) / 2 - h / 2) * mmPerPixel);
      } else {
        state.span = 180;
        state.orbitDistance = state.span * 3;
      }
      camera.far = Math.max(1000000, state.orbitDistance * 2);
      applyOrbit(target, rotation);
      resize();
      rebaseControls(target);
    };
    state.fitToBounds = value => {
      if (!value) return;
      state.fit(camera.quaternion.clone(), new THREE.Box3(
        new THREE.Vector3(...value.min), new THREE.Vector3(...value.max)));
    };
    state.resetView = () => {
      state.defaultView = true;
      state.fit(initialRotation);
    };
    state.scheduleFit = () => {
      cancelAnimationFrame(fitFrame);
      fitFrame = requestAnimationFrame(() => {
        fitFrame = 0;
        if (state.defaultView) state.resetView();
        else state.fit();
      });
    };
    let gridStep = 0, gridDivisions = 0, scaleZoom = 0, scaleHeight = 0;
    const direction = new THREE.Vector3();
    const gridCenter = new THREE.Vector3();
    function gridTheme(fade = 1) {
      grid.children.forEach((layer, index) => {
        layer.material.color.set(state.dark
          ? (index ? 0x9caabe : 0x7b8797)
          : (index ? 0x8e9bab : 0xb2bbc9));
        layer.material.opacity = (state.dark
          ? (index ? 0.5 : 0.35)
          : (index ? 0.75 : 0.6)) * fade;
      });
      const axisColors = state.dark ? [0xf28b82, 0x79ce9a] : [0xc94b4b, 0x258552];
      gridAxes.forEach((axis, index) => {
        axis.material.color.set(axisColors[index]);
        axis.material.opacity = 0.72 * fade;
      });
      groundLine.material.color.set(state.dark ? 0x9caabe : 0x8e9bab);
      groundLine.material.opacity = (state.dark ? 0.5 : 0.6) * (1 - fade);
    }
    function updateGrid() {
      const width = el.clientWidth, height = el.clientHeight;
      if (!width || !height) return;
      const mmPerPixel = (camera.top - camera.bottom) / camera.zoom / height;
      if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0) return;
      const step = scaleStep(mmPerPixel * 50);
      // Cover the visible plane beyond the screen, including oblique views.
      const divisions = Math.ceil(Math.max(width, height) / 200) * 80;
      if (step !== gridStep || divisions !== gridDivisions) {
        for (const layer of [...grid.children]) {
          grid.remove(layer);
          layer.dispose();
        }
        gridStep = step;
        gridDivisions = divisions;
        for (const stride of [1, 5]) {
          const layer = new THREE.GridHelper(step * divisions, divisions / stride, 0xffffff, 0xffffff);
          layer.rotation.x = Math.PI / 2;
          layer.material.transparent = true;
          layer.material.depthWrite = false;
          grid.add(layer);
        }
      }
      camera.getWorldDirection(direction);
      // Follow panning while keeping grid lines anchored to world coordinates.
      if (Math.abs(direction.z) > 0.04) {
        gridCenter.copy(camera.position).addScaledVector(direction, -camera.position.z / direction.z);
      } else {
        gridCenter.copy(state.center);
      }
      const majorStep = step * 5;
      grid.position.x = Math.round(gridCenter.x / majorStep) * majorStep;
      grid.position.y = Math.round(gridCenter.y / majorStep) * majorStep;
      // Cross-fade dense, grazing-angle grids into a single line in the XY
      // plane, perpendicular to the viewing direction. Anchor it below the
      // live orbit target so panning and camera roll preserve its alignment.
      const fade = THREE.MathUtils.smoothstep(Math.abs(direction.z), 0.04, 0.18);
      gridTheme(fade);
      gridAxes.forEach((axis, index) => {
        axis.visible = fade > 0;
        // Extend each line along the visible grid while keeping its other coordinate at zero.
        axis.position.setComponent(index, grid.position.getComponent(index));
        axis.scale.setComponent(index, step * divisions / 2);
      });
      groundLine.visible = fade < 1;
      if (groundLine.visible) {
        groundLine.position.copy(camera.position).addScaledVector(direction, state.orbitDistance);
        groundLine.position.z = grid.position.z;
        groundLine.rotation.z = Math.atan2(direction.x, -direction.y);
        groundLine.scale.x = Math.hypot(camera.right - camera.left, camera.top - camera.bottom) / camera.zoom / 2;
      }
      // Moving an orthographic camera along its viewing axis preserves the
      // projected grid alignment while making room for its full depth range.
      const padding = step * divisions + camera.position.distanceTo(grid.position);
      gridCamera.copy(camera);
      gridCamera.position.addScaledVector(direction, -padding);
      gridCamera.near = 0.01;
      gridCamera.far = padding * 2 + 1;
      gridCamera.updateProjectionMatrix();
      if (scaleZoom !== camera.zoom || scaleHeight !== height) {
        setScale({ distance: step, width: step / mmPerPixel });
        scaleZoom = camera.zoom;
        scaleHeight = height;
      }
    }
    function resize() {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.left = (-state.span * w) / h / 2;
      camera.right = -camera.left;
      camera.top = state.span / 2;
      camera.bottom = -camera.top;
      camera.updateProjectionMatrix();
      if (controls.enabled) updateTrackballRadius();
      // The projection span can change when a different model is fitted.
      scaleHeight = 0;
      if (!contained) updateGrid();
      invalidate();
    }
    state.resize = resize;
    const observer = new ResizeObserver(() => {
      resize();
      // Keep default framing aligned with actual viewport size changes.
      if (state.defaultView) state.scheduleFit();
    });
    observer.observe(el);
    const selectionObserver = new ResizeObserver(() => state.positionSelection());
    if (floating.current) selectionObserver.observe(floating.current);
    const sidebarElement = el.closest(".mc-workbench")?.querySelector(".mc-sidebar");
    if (sidebarElement) selectionObserver.observe(sidebarElement);
    function theme() {
      state.dark = document.body.hasAttribute("data-ds-dark-theme");
      model.traverse((o) => {
        // Wide lines are meshes too: handle them before solid surfaces.
        if (o.isLineSegments2) {
          o.material.color.set(state.wire
            ? (state.dark ? 0x8fb8ff : 0x2456a6)
            : (state.dark ? 0x515e73 : 0x9ca8b8));
          o.material.linewidth = state.wire ? 1.8 : 1;
          o.material.opacity = state.wire ? 1 : 0.65;
        }
      });
      state.setSurfaceColor?.(state.dark ? 0xabb3c0 : 0xd8dee8);
      diffModel.traverse(o => {
        const kind = o.userData.diffKind;
        if (kind) o.material.color.set(diffColors[kind][state.dark ? 1 : 0]);
      });
      model.visible = !state.diffActive;
      gridTheme();
      selectionOverlay.traverse(item => { if (item.material) item.material.color.set(state.dark ? 0x8fb8ff : 0x2456a6); });
      invalidate();
    }
    state.theme = theme;
    const themeObserver = new MutationObserver(theme);
    themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-ds-dark-theme"],
    });
    theme();
    resize();
    function draw() {
      renderFrame = 0;
      if (!canRender()) return;
      if (sceneDirty) {
        sceneDirty = false;
        drawScene();
      }
      updateCoordinates();
    }
    function drawScene() {
      if (turn) {
        const amount = turn.duration ? Math.min((performance.now() - turn.start) / turn.duration, 1) : 1;
        const eased = amount * amount * (3 - 2 * amount);
        const rotation = new THREE.Quaternion().slerpQuaternions(turn.from, turn.to, eased);
        applyOrbit(turn.target, rotation);
        if (amount === 1) finishTurn();
      }
      cube.current?.sync(camera, controls);
      state.positionSelection();
      state.positionMarks();
      renderer.clear();
      if (!contained) {
        updateGrid();
        renderer.render(gridScene, gridCamera);
        renderer.clearDepth();
      }
      renderer.render(scene, camera);
      if (turn) invalidate();
    }
    const visibility = () => state.setActive(state.active);
    document.addEventListener("visibilitychange", visibility);
    const intersection = new IntersectionObserver((entries) => {
      inView = entries[0]?.isIntersecting ?? false;
      visibility();
    });
    intersection.observe(el);
    runtime.current = state;
    invalidate();
    return () => {
      disposed = true;
      cancelAnimationFrame(renderFrame);
      cancelAnimationFrame(fitFrame);
      intersection.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      observer.disconnect();
      selectionObserver.disconnect();
      themeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", beginNavigation, true);
      renderer.domElement.removeEventListener("wheel", beginNavigation, true);
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", startPick);
      renderer.domElement.removeEventListener("pointerup", endPick);
      renderer.domElement.removeEventListener("pointermove", movePointer);
      renderer.domElement.removeEventListener("pointerleave", clearCoordinates);
      renderer.domElement.removeEventListener("pointercancel", cancelPointer);
      for (const root of [scene, gridScene]) {
        root.traverse((o) => {
          if (o.userData.sharedPosition) o.geometry.deleteAttribute("position");
          o.geometry?.dispose();
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material?.dispose();
        });
      }
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      runtime.current = null;
    };
  }, []);
  useEffect(() => {
    const s = runtime.current;
    if (!s) return;
    s.clearPick();
    s.clearCursor();
    s.clearExploded();
    s.surface = null;
    s.setSurfaceColor = null;
    s.edgePicker = null;
    s.edges = null;
    for (const o of [...s.model.children]) {
      o.geometry.dispose();
      o.material.dispose();
      s.model.remove(o);
    }
    const preview = design?.previewData;
    if (!preview) {
      s.center.set(0, 0, 0);
      s.bounds.makeEmpty();
      s.span = 180;
      s.defaultView = true;
      return;
    }
    const geometry = surfaceGeometry(preview);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        metalness: 0.22,
        roughness: 0.58,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        clippingPlanes: s.clipping,
      }),
    );
    s.model.add(mesh);
    s.surface = mesh;
    s.setSurfaceColor = surfaceColorUpdater(mesh, preview);
    if (preview.edges.length) {
      const picker = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(preview.edges, 3)), new THREE.LineBasicMaterial());
      picker.visible = false;
      s.model.add(picker);
      s.edgePicker = picker;
      const edgeGeometry = new LineSegmentsGeometry();
      edgeGeometry.setPositions(preview.edges);
      const lines = new LineSegments2(edgeGeometry, new LineMaterial({
        color: 0x9ca8b8, linewidth: 1, worldUnits: false, alphaToCoverage: true,
        transparent: true, opacity: 0.65, depthWrite: false, clippingPlanes: s.clipping,
      }));
      s.model.add(lines);
      s.edges = lines;
    }
    const bounds = new THREE.Box3().setFromObject(mesh);
    s.bounds.copy(bounds);
    bounds.getCenter(s.center);
    s.buildExploded(preview, design.parts);
    s.applySection();
    s.applyExplode();
    s.theme();
  }, [design?.previewData]);
  useEffect(() => {
    if (followPreview) runtime.current?.scheduleFit();
  }, [design?.previewData, followPreview]);
  useEffect(() => {
    if (fitBounds) runtime.current?.fitToBounds(fitBounds);
  }, [fitBounds]);
  useEffect(() => {
    const s = runtime.current;
    if (!s || !s.surface) return;
    s.transparent = transparent;
    s.surface.material.transparent = transparent;
    s.surface.material.opacity = transparent ? 0.3 : 1;
    s.surface.material.depthWrite = !transparent;
    s.surface.material.side = transparent || s.sectionActive ? THREE.DoubleSide : THREE.FrontSide;
    s.surface.material.needsUpdate = true;
    s.invalidate();
  }, [transparent, design?.previewData]);
  useEffect(() => {
    runtime.current?.setSection(section);
  }, [section, design?.previewData]);
  useEffect(() => {
    runtime.current?.setExplode(explode);
  }, [explode, design?.previewData]);
  useEffect(() => {
    runtime.current?.setExplodeAxis(explodeAxis);
  }, [explodeAxis, design?.previewData]);
  useEffect(() => { runtime.current?.setActive(active); }, [active]);
  useLayoutEffect(() => {
    const state = runtime.current;
    if (!state) return;
    const observer = new ResizeObserver(() => state.scheduleFit());
    const owner = mount.current?.closest(".mc-workbench");
    for (const selector of [".mc-record-reel", ".mc-record-toolbar"])
      if (owner?.querySelector(selector)) observer.observe(owner.querySelector(selector));
    state.scheduleFit();
    return () => observer.disconnect();
  }, [historyOpen]);
  useLayoutEffect(() => { runtime.current?.positionSelection(); }, [sidebarCollapsed]);
  useEffect(() => {
    const s = runtime.current;
    if (!s) return;
    s.diffActive = !!diff;
    if (!diff) { s.theme(); return; }
    for (const kind of ["unchanged", "added", "removed"]) {
      const preview = diff[kind]?.previewData;
      if (!preview) continue;
      const removed = kind === "removed", unchanged = kind === "unchanged";
      const surface = new THREE.Mesh(surfaceGeometry(preview), new THREE.MeshStandardMaterial({
        metalness: 0, roughness: .8, transparent: true,
        opacity: unchanged ? .18 : removed ? .38 : .9,
        depthWrite: !unchanged && !removed, depthTest: !removed,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        side: THREE.DoubleSide,
      }));
      surface.userData.diffKind = kind;
      surface.renderOrder = unchanged ? 0 : removed ? 3 : 1;
      surface.visible = !s.wire;
      s.diffModel.add(surface);
      if (preview.edges.length) {
        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(preview.edges);
        const lines = new LineSegments2(geometry, new LineMaterial({
          linewidth: unchanged ? 1 : 1.6, transparent: true, opacity: unchanged ? .24 : .9,
          depthWrite: false, depthTest: !removed, dashed: removed,
          dashSize: .8, gapSize: .5,
        }));
        lines.computeLineDistances();
        lines.userData.diffKind = kind; lines.renderOrder = removed ? 4 : 2;
        s.diffModel.add(lines);
      }
    }
    s.diffBounds = new THREE.Box3().setFromObject(s.diffModel);
    s.theme();
    s.scheduleFit();
    return () => {
      if (runtime.current !== s) return;
      for (const item of [...s.diffModel.children]) {
        item.geometry.dispose(); item.material.dispose(); s.diffModel.remove(item);
      }
      s.diffBounds = null; s.diffActive = false; s.model.visible = true;
      s.scheduleFit(); s.invalidate();
    };
  }, [diff]);
  useLayoutEffect(() => {
    runtime.current?.positionMarks();
  }, [marks]);
  useLayoutEffect(() => {
    const state = runtime.current;
    if (!state) return;
    state.highlightPicks(selecting ? targets : []);
    state.positionSelection();
  }, [targets, selecting, design?.previewData]);
  useEffect(() => { runtime.current?.showMeasurement(measurementResult); }, [measurementResult]);
  useEffect(() => {
    if (resetToken > 0) runtime.current?.resetView();
  }, [resetToken]);
  useEffect(() => {
    const s = runtime.current;
    if (!s) return;
    s.wire = wire;
    s.model.traverse((o) => {
      // CAD wireframe uses the kernel's BREP edges, not tessellation diagonals.
      if (o.isLineSegments2) o.visible = true;
      else if (o.isMesh) o.visible = !wire;
    });
    s.diffModel.traverse(o => { if (o.userData.diffKind && !o.isLineSegments2) o.visible = !wire; });
    s.applyExplode();
    s.theme();
  }, [wire, design?.previewData]);
  return (
    <div id={id} ref={mount} aria-hidden={!active} className={`mc-viewport ${selecting || striking ? "mc-selecting" : ""}`} aria-label="3D">
      {presentation === "workbench" && <div ref={partHover} className="mc-part-hover mc-panel" hidden />}
      {marks.length > 0 && <div ref={marksLayer} className="mc-instrument-marks">
        {marks.map(mark => <span key={mark.index} className="mc-instrument-mark" data-restrike={mark.armed || undefined}>
          <span className="mc-instrument-callout">
            <Tag tone="neutral" className="mc-instrument-tag">
              <span className="mc-instrument-index">{mark.index} ·</span>
              <span className="mc-instrument-note">{mark.note}</span>
              <span className="mc-instrument-mark-actions">
                <Button type="button" variant="ghost" size="sm" className="mc-instrument-action"
                  aria-label={t("instrumentRestrike")} aria-pressed={mark.armed || undefined}
                  icon={<IconRefreshOutlineRegular size={12} />}
                  onClick={event => { event.stopPropagation(); onMarkRestrike?.(mark.position); }} />
                <Button type="button" variant="ghost" size="sm" className="mc-instrument-action"
                  aria-label={t("instrumentDelete")} icon={<IconTrashOutlineRegular size={12} />}
                  onClick={event => { event.stopPropagation(); onMarkDelete?.(mark.position); }} />
              </span>
            </Tag>
            <span className="mc-instrument-anchor" />
          </span>
        </span>)}
      </div>}
      <div ref={floating} className="mc-selection-context" data-open={selecting && targets.length > 0 || undefined}
        data-instant={selectionInstant || !pointerModality() || undefined} aria-hidden={!selecting || !targets.length} inert={!selecting || !targets.length ? "" : undefined}>
        {selectionTools}
      </div>
      {presentation === "workbench" && <div className="mc-navigation">
        <ViewCube
          ref={cube}
          active={active}
          t={t}
          onSelect={(direction) => runtime.current?.orient(direction)}
          onDragStart={() => runtime.current?.beginCubeDrag()}
          onDrag={(start, end) => runtime.current?.rotateCube(start, end)}
          onDragEnd={() => runtime.current?.endCubeDrag()}
        />
        <div className="mc-navigation-readout mc-panel mc-secondary">
          {active && scale && <div className="mc-scale" role="img" aria-label={`${millimetres(scale.distance)} mm`}>
            <span>{millimetres(scale.distance)} mm</span>
            <span className="mc-scale-bar" style={{ width: scale.width }} aria-hidden="true" />
          </div>}
          <div ref={coordinates} className="mc-cursor-coordinates" role="group" aria-label={t("cursorCoordinates")}>
            {["X", "Y", "Z"].map(axis => <span key={axis}>{axis}<span data-coordinate>—</span></span>)}
            <span>mm</span>
          </div>
        </div>
      </div>}
    </div>
  );
}
