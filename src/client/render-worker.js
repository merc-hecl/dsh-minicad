import * as THREE from "three";
import { decodePreview } from "../shared/preview.js";
import { addModelLights, modelSurface, surfaceColorUpdater } from "./model-surface.js";

const photoDirections = {
  isometric: [1, -1, 1],
  front: [0, -1, 0],
  top: [0, 0, 1],
  right: [1, 0, 0],
};

async function capture(buffer, views) {
  if (typeof OffscreenCanvas === "undefined") throw new Error("OffscreenCanvas is unavailable");
  const preview = decodePreview(buffer);
  if (!preview.indices.length) throw new Error("The model has no renderable faces");
  const canvas = new OffscreenCanvas(1024, 1024);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  const scene = new THREE.Scene();
  try {
    scene.background = new THREE.Color(0xf3f5f8);
    addModelLights(scene);
    const surface = modelSurface(preview);
    scene.add(surface);
    surfaceColorUpdater(surface, preview)(0xd8dee8);
    if (preview.edges.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(preview.edges, 3));
      scene.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x546176 })));
    }
    const bounds = new THREE.Box3().setFromObject(surface);
    const center = bounds.getCenter(new THREE.Vector3());
    const distance = Math.max(1, bounds.getSize(new THREE.Vector3()).length() * 2);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, distance * 2);
    bounds.translate(center.clone().negate());
    const images = [];
    for (const view of views) {
      camera.up.fromArray(view === "top" ? [0, 1, 0] : [0, 0, 1]);
      camera.position.fromArray(photoDirections[view]).normalize().multiplyScalar(distance).add(center);
      camera.lookAt(center);
      const rotation = new THREE.Matrix4().makeRotationFromQuaternion(camera.quaternion.clone().invert());
      const projected = bounds.clone().applyMatrix4(rotation).getSize(new THREE.Vector3());
      const halfSpan = Math.max(projected.x, projected.y) * 0.58;
      camera.left = camera.bottom = -halfSpan;
      camera.right = camera.top = halfSpan;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      const image = await canvas.convertToBlob({ type: "image/png" });
      if (renderer.getContext().isContextLost()) throw new Error("The offscreen WebGL context was lost");
      images.push(image);
    }
    return images;
  } finally {
    scene.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

self.onmessage = async ({ data: { buffer, views } }) => {
  try {
    self.postMessage({ images: await capture(buffer, views) });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
