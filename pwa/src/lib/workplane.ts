import * as THREE from "three";
import type { Vec3 } from "../types/scene";

export interface Workplane {
  position: Vec3;
  rotation: Vec3; // Euler XYZ; local +Z is the plane normal
}

export function workplaneFromHit(point: THREE.Vector3, worldNormal: THREE.Vector3): Workplane {
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    worldNormal.clone().normalize(),
  );
  const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
  return {
    position: [point.x, point.y, point.z],
    rotation: [e.x, e.y, e.z],
  };
}

export function workplaneNormal(wp: Workplane | null): THREE.Vector3 {
  if (!wp) return new THREE.Vector3(0, 0, 1);
  return new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(...wp.rotation, "XYZ"));
}

export function workplaneMatrix(wp: Workplane): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...wp.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...wp.rotation, "XYZ")),
    new THREE.Vector3(1, 1, 1),
  );
}

export function workplanePlane(wp: Workplane | null): THREE.Plane {
  const normal = workplaneNormal(wp);
  const point = wp ? new THREE.Vector3(...wp.position) : new THREE.Vector3(0, 0, 0);
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
}
