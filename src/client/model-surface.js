import * as THREE from "three";

export function surfaceGeometry(preview) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(preview.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(preview.indices, 1));
  geometry.setAttribute("normal", new THREE.BufferAttribute(preview.normals, 3));
  return geometry;
}

export function modelSurface(preview, clippingPlanes) {
  return new THREE.Mesh(surfaceGeometry(preview), new THREE.MeshStandardMaterial({
    metalness: 0.22,
    roughness: 0.58,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    ...(clippingPlanes && { clippingPlanes }),
  }));
}

export function addModelLights(scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 2.1));
  for (const [position, power] of [
    [[100, -150, 250], 3],
    [[-120, 120, 100], 1.1],
  ]) {
    const light = new THREE.DirectionalLight(0xffffff, power);
    light.position.set(...position);
    scene.add(light);
  }
}

export function surfaceColorUpdater(mesh, { faceColors, faceIndices, indices, positions }) {
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
