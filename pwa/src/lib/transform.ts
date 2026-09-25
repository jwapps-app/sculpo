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

/**
 * A face normal taken into world space. Directions transform by the
 * inverse transpose of the matrix, not the matrix itself: under an uneven
 * scale, transformDirection tilts a sloped face's normal the wrong way, and
 * anything placed against that face leans with it.
 */
export function worldNormal(local: THREE.Vector3, matrixWorld: THREE.Matrix4): THREE.Vector3 {
  return local
    .clone()
    .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(matrixWorld))
    .normalize();
}

/**
 * Whether a matrix can be written as position, rotation and scale without
 * loss. A non-uniformly scaled parent around a rotated child produces
 * shear, which those three cannot express.
 */
export function isDecomposable(m: THREE.Matrix4): boolean {
  const { position, rotation, scale } = decomposeMatrix(m);
  const back = composeMatrix(position, rotation, scale);
  const a = m.elements;
  const b = back.elements;
  let magnitude = 1e-6;
  for (let i = 0; i < 16; i++) magnitude = Math.max(magnitude, Math.abs(a[i]));
  for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > 1e-5 * magnitude) return false;
  return true;
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
