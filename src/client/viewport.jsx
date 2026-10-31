import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function Viewport({ id, active = true, design, view, wire, fitToken, onError }) {
  const mount = useRef(null);
  const runtime = useRef(null);
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
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
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
    let grid = new THREE.GridHelper(1000, 100, 0xcfd3d6, 0xe7eaef);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.01;
    scene.add(grid);
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
      const materials = Array.isArray(grid.material)
        ? grid.material
        : [grid.material];
      materials.forEach((m) => {
        m.transparent = true;
        m.opacity = state.dark ? 0.09 : 0.18;
      });
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
      controls.update();
      renderer.render(scene, camera);
    });
    runtime.current = state;
    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      themeObserver.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material?.dispose();
      });
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
    s.camera.up.set(...(view === "top" ? [0, 1, 0] : [0, 0, 1]));
    s.camera.position
      .copy(s.center)
      .add(new THREE.Vector3(...direction).multiplyScalar(s.span * 3));
    s.camera.zoom = 1;
    s.controls.target.copy(s.center);
    s.camera.lookAt(s.center);
    s.camera.updateProjectionMatrix();
    s.controls.update();
  }, [view, fitToken, design]);
  useEffect(() => {
    runtime.current?.model.traverse((o) => {
      if (o.isMesh) o.material.wireframe = wire;
    });
  }, [wire, design]);
  return <div id={id} ref={mount} role="tabpanel" aria-hidden={!active} className="mc-viewport" aria-label="3D" />;
}
