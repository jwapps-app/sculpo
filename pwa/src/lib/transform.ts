import * as THREE from "three";
import type { Vec3 } from "../types/scene";

export function composeMatrix(position: Vec3, rotation: Vec3, scale: Vec3): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation, "XYZ")),
    new THREE.Vector3(...scale),
  );
}

// Bakes a transform into a cloned geometry. A reflection (negative
// determinant, from mirroring via negative scale) flips triangle winding, so
// the winding is restored and normals recomputed — CSG and STL both depend on
// consistent outward-facing triangles.
export function bakeTransform(
  geo: THREE.BufferGeometry,
  m: THREE.Matrix4,
): THREE.BufferGeometry {
  const g = geo.clone();
  g.applyMatrix4(m);
  if (m.determinant() < 0) {
    flipWinding(g);
    g.computeVertexNormals();
  }
  return g;
}

export function flipWinding(g: THREE.BufferGeometry) {
  if (g.index) {
    const arr = g.index.array;
    for (let i = 0; i < arr.length; i += 3) {
      const tmp = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = tmp;
    }
    g.index.needsUpdate = true;
    return;
  }
  for (const attr of Object.values(g.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const size = a.itemSize;
    const arr = a.array;
    for (let v = 0; v < a.count; v += 3) {
      for (let k = 0; k < size; k++) {
        const i1 = (v + 1) * size + k;
        const i2 = (v + 2) * size + k;
        const tmp = arr[i1];
        arr[i1] = arr[i2];
        arr[i2] = tmp;
      }
    }
    a.needsUpdate = true;
  }
}

export function decomposeMatrix(m: THREE.Matrix4): {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
} {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(p, q, s);
  const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
  return {
    position: [p.x, p.y, p.z],
    rotation: [e.x, e.y, e.z],
    scale: [s.x, s.y, s.z],
  };
}
