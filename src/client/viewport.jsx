import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ArcballControls } from "three/addons/controls/ArcballControls.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
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

export function Viewport({ id, active = true, design, wire, resetToken, onError, t }) {
  const mount = useRef(null);
  const runtime = useRef(null);
  const cube = useRef(null);
  const [scale, setScale] = useState(null);
  useEffect(() => {
    const el = mount.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      onError();
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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
    controls.cursorZoom = true;
    controls.enableGizmos = false;
    controls.setGizmosVisible(false);
    controls.enableFocus = false;
    const initialRotation = camera.quaternion.clone();
    const model = new THREE.Group();
    scene.add(model);
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
    renderer.autoClear = false;
    const state = {
      renderer,
      scene,
      camera,
      controls,
      model,
      span: 180,
      center: new THREE.Vector3(),
      bounds: new THREE.Box3(),
      dark: false,
      wire: false,
      defaultView: true,
      orbitDistance: camera.position.length(),
    };
    let turn = null, cubeDrag = null, fitFrame = 0;
    let renderFrame = 0, disposed = false, inView = true;
    state.active = active;
    const canRender = () => !disposed && inView && state.active && !document.hidden;
    function invalidate() {
      if (canRender() && !renderFrame) renderFrame = requestAnimationFrame(draw);
    }
    state.invalidate = invalidate;
    state.setActive = (value) => {
      state.active = value;
      controls.enabled = canRender() && !turn && !cubeDrag;
      if (canRender()) invalidate();
      else { cancelAnimationFrame(renderFrame); renderFrame = 0; }
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
    state.fit = (rotation = camera.quaternion.clone()) => {
      stopMotion();
      cubeDrag = null;
      camera.zoom = 1;
      const target = state.center.clone();
      if (!state.bounds.isEmpty()) {
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h) {
          rebaseControls(currentTarget());
          return;
        }
        const viewport = el.getBoundingClientRect();
        const area = { left: 24, right: w - 24, top: 24, bottom: h - 24 };
        const owner = el.closest(".mc-workbench");
        const rect = (selector) => owner?.querySelector(selector)?.getBoundingClientRect();
        const sidebar = rect(".mc-sidebar"), composer = rect(".mc-bottom");
        if (sidebar?.width) area.left = sidebar.right - viewport.left + 24;
        if (composer?.height) area.bottom = composer.top - viewport.top - 24;
        for (const selector of [".mc-header", ".mc-view-tabs"]) {
          const box = rect(selector);
          if (box?.height) area.top = Math.max(area.top, box.bottom - viewport.top + 16);
        }
        for (const selector of [".mc-tools", ".mc-view-cube:not([hidden])"]) {
          const box = rect(selector);
          if (box?.width && box.top - viewport.top < area.bottom && box.bottom - viewport.top > area.top)
            area.right = Math.min(area.right, box.left - viewport.left - 16);
        }
        area.left = Math.min(area.left, w - 88);
        area.right = Math.max(area.right, area.left + 64);
        area.top = Math.min(area.top, h - 88);
        area.bottom = Math.max(area.bottom, area.top + 64);
        const inverse = rotation.clone().invert();
        const projection = new THREE.Box3();
        for (const x of [state.bounds.min.x, state.bounds.max.x])
          for (const y of [state.bounds.min.y, state.bounds.max.y])
            for (const z of [state.bounds.min.z, state.bounds.max.z])
              projection.expandByPoint(new THREE.Vector3(x, y, z).sub(state.center).applyQuaternion(inverse));
        const size = projection.getSize(new THREE.Vector3());
        const mmPerPixel = Math.max(size.x / (area.right - area.left), size.y / (area.bottom - area.top), 1e-6) * 1.15;
        state.span = mmPerPixel * h;
        state.orbitDistance = Math.max(state.bounds.getSize(new THREE.Vector3()).length() * 3, 1);
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
      // Prevent a dense stripe at grazing angles to the XY plane.
      gridTheme(THREE.MathUtils.smoothstep(Math.abs(direction.z), 0.04, 0.18));
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
      if (controls.enabled) controls.setTbRadius(controls.radiusFactor);
      // The projection span can change when a different model is fitted.
      scaleHeight = 0;
      updateGrid();
      invalidate();
    }
    state.resize = resize;
    const observer = new ResizeObserver(() => {
      resize();
      // The native composer may finish mounting after the model arrives.
      // Keep default framing aligned with Reset until the user navigates.
      if (state.defaultView) state.scheduleFit();
    });
    observer.observe(el);
    const composer = el.closest(".mc-workbench")?.querySelector(".mc-bottom");
    if (composer) observer.observe(composer);
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
        } else if (o.isMesh) {
          o.material.color.set(state.dark ? 0xabb3c0 : 0xd8dee8);
        }
      });
      gridTheme();
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
      if (turn) {
        const amount = turn.duration ? Math.min((performance.now() - turn.start) / turn.duration, 1) : 1;
        const eased = amount * amount * (3 - 2 * amount);
        const rotation = new THREE.Quaternion().slerpQuaternions(turn.from, turn.to, eased);
        applyOrbit(turn.target, rotation);
        if (amount === 1) finishTurn();
      }
      cube.current?.sync(camera, controls);
      updateGrid();
      renderer.clear();
      renderer.render(gridScene, gridCamera);
      renderer.clearDepth();
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
      themeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", beginNavigation, true);
      renderer.domElement.removeEventListener("wheel", beginNavigation, true);
      controls.dispose();
      for (const root of [scene, gridScene]) {
        root.traverse((o) => {
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
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(preview.positions, 3),
    );
    geometry.setIndex(new THREE.BufferAttribute(preview.indices, 1));
    if (preview.normals) {
      geometry.setAttribute(
        "normal",
        new THREE.BufferAttribute(preview.normals, 3),
      );
    } else geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0xd8dee8,
        metalness: 0.22,
        roughness: 0.58,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    s.model.add(mesh);
    if (preview.edges.length) {
      const edgeGeometry = new LineSegmentsGeometry();
      edgeGeometry.setPositions(preview.edges);
      s.model.add(new LineSegments2(edgeGeometry, new LineMaterial({
        color: 0x9ca8b8, linewidth: 1, worldUnits: false, alphaToCoverage: true,
        transparent: true, opacity: 0.65, depthWrite: false,
      })));
    }
    const bounds = new THREE.Box3().setFromObject(mesh);
    s.bounds.copy(bounds);
    bounds.getCenter(s.center);
    s.theme();
  }, [design?.previewData]);
  useEffect(() => {
    runtime.current?.scheduleFit();
  }, [design?.previewData]);
  useEffect(() => { runtime.current?.setActive(active); }, [active]);
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
    s.theme();
  }, [wire, design?.previewData]);
  return (
    <div id={id} ref={mount} aria-hidden={!active} className="mc-viewport" aria-label="3D">
      <ViewCube
        ref={cube}
        active={active}
        t={t}
        onSelect={(direction) => runtime.current?.orient(direction)}
        onDragStart={() => runtime.current?.beginCubeDrag()}
        onDrag={(start, end) => runtime.current?.rotateCube(start, end)}
        onDragEnd={() => runtime.current?.endCubeDrag()}
      />
      {active && scale && (
        <div className="mc-scale mc-panel mc-secondary" role="img" aria-label={`${millimetres(scale.distance)} mm`}>
          <span>{millimetres(scale.distance)} mm</span>
          <span className="mc-scale-bar" style={{ width: scale.width }} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
