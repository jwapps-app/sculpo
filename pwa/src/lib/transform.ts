import * as THREE from "three";
import type { Vec3 } from "../types/scene";

export function composeMatrix(position: Vec3, rotation: Vec3, scale: Vec3): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation, "XYZ")),
    new THREE.Vector3(...scale),
  );
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
