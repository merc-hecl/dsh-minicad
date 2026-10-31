import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ArcballControls } from "three/addons/controls/ArcballControls.js";

// Keep grid intervals and scale labels in readable millimetre increments.
function scaleStep(value) {
  const power = 10 ** Math.floor(Math.log10(value));
  const fraction = value / power;
  return (fraction >= 5 ? 5 : fraction >= 2 ? 2 : 1) * power;
}

function millimetres(value) {
  return String(Number(value.toPrecision(6)));
}

export function Viewport({ id, active = true, design, view, wire, fitToken, onError }) {
  const mount = useRef(null);
  const runtime = useRef(null);
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
    camera.position.set(100, -130, 110);
    const controls = new ArcballControls(camera, renderer.domElement);
    controls.cursorZoom = true;
    controls.enableGizmos = false;
    controls.setGizmosVisible(false);
    controls.enableFocus = false;
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
      dark: false,
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
      controls.setTbRadius(controls.radiusFactor);
      // The projection span can change when a different model is fitted.
      scaleHeight = 0;
      updateGrid();
    }
    state.resize = resize;
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    function theme() {
      state.dark = document.body.hasAttribute("data-ds-dark-theme");
      model.traverse((o) => {
        if (o.isMesh) o.material.color.set(state.dark ? 0xabb3c0 : 0xd8dee8);
        else if (o.isLine)
          o.material.color.set(state.dark ? 0x515e73 : 0x9ca8b8);
      });
      gridTheme();
    }
    state.theme = theme;
    const themeObserver = new MutationObserver(theme);
    themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-ds-dark-theme"],
    });
    theme();
    resize();
    renderer.setAnimationLoop(() => {
      updateGrid();
      renderer.clear();
      renderer.render(gridScene, gridCamera);
      renderer.clearDepth();
      renderer.render(scene, camera);
    });
    runtime.current = state;
    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      themeObserver.disconnect();
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
    if (!design?.mesh) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(design.mesh.vertices.flat(), 3),
    );
    geometry.setIndex(design.mesh.triangles.flat());
    geometry.computeVertexNormals();
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
    const points = [];
    for (const edge of design.edges)
      for (let i = 1; i < edge.length; i++)
        points.push(...edge[i - 1], ...edge[i]);
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(points, 3),
    );
    s.model.add(
      new THREE.LineSegments(
        edgeGeometry,
        new THREE.LineBasicMaterial({
          color: 0x9ca8b8,
          transparent: true,
          opacity: 0.65,
        }),
      ),
    );
    const bounds = new THREE.Box3().setFromObject(mesh);
    bounds.getCenter(s.center);
    s.span =
      Math.max(...bounds.getSize(new THREE.Vector3()).toArray(), 1) * 2.8;
    s.controls.target.copy(s.center);
    s.camera.zoom = 1;
    s.resize();
    s.theme();
  }, [design]);
  useEffect(() => {
    const s = runtime.current;
    if (!s) return;
    const direction = {
      iso: [1, -1.4, 1.1],
      top: [0, 0, 1],
      front: [0, -1, 0],
      right: [1, 0, 0],
    }[view] || [1, -1.4, 1.1];
    // Stop any rotation inertia before applying a preset or fitting the model.
    s.controls.reset();
    s.camera.up.set(...(view === "top" ? [0, 1, 0] : [0, 0, 1]));
    s.camera.position
      .copy(s.center)
      .add(new THREE.Vector3(...direction).multiplyScalar(s.span * 3));
    s.camera.zoom = 1;
    s.controls.target.copy(s.center);
    s.camera.lookAt(s.center);
    s.camera.updateProjectionMatrix();
    s.controls.setCamera(s.camera);
    s.controls.update();
    s.controls.saveState();
    s.controls.setGizmosVisible(false);
  }, [view, fitToken, design]);
  useEffect(() => {
    runtime.current?.model.traverse((o) => {
      // CAD wireframe uses the kernel's BREP edges, not tessellation diagonals.
      if (o.isMesh) o.visible = !wire;
      else if (o.isLine) o.material.opacity = wire ? 1 : 0.65;
    });
  }, [wire, design]);
  return (
    <div id={id} ref={mount} role="tabpanel" aria-hidden={!active} className="mc-viewport" aria-label="3D">
      {active && scale && (
        <div className="mc-scale mc-panel mc-secondary" role="img" aria-label={`${millimetres(scale.distance)} mm`}>
          <span>{millimetres(scale.distance)} mm</span>
          <span className="mc-scale-bar" style={{ width: scale.width }} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
