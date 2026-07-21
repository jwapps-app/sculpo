import * as THREE from "three";
import type { PrimitiveKind, ShapeNode, Vec3 } from "../types/scene";
import { newId } from "./id";

// Units are millimeters. World is Z-up; three's Y-up primitives (cylinder,
// cone) are rotated so their axis is Z.

export const DEFAULT_PARAMS: Record<
  PrimitiveKind,
  Record<string, number | string>
> = {
  box: { w: 20, d: 20, h: 20 },
  cylinder: { r: 10, h: 20, segments: 48 },
  sphere: { r: 10, segments: 32 },
  cone: { r: 10, h: 20, segments: 48 },
  torus: { r: 10, tube: 4, segments: 48 },
  text: { value: "Text", size: 10, depth: 5 },
};

export const PALETTE_COLORS: Record<PrimitiveKind, string> = {
  box: "#e05d5d",
  cylinder: "#5d8fe0",
  sphere: "#5dbf6e",
  cone: "#e0a15d",
  torus: "#a15de0",
  text: "#5dc9c9",
};

function num(params: Record<string, number | string>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function buildGeometry(node: ShapeNode): THREE.BufferGeometry {
  const p = node.params;
  let geo: THREE.BufferGeometry;
  switch (node.kind) {
    case "box":
      geo = new THREE.BoxGeometry(num(p, "w", 20), num(p, "d", 20), num(p, "h", 20));
      break;
    case "cylinder": {
      geo = new THREE.CylinderGeometry(
        num(p, "r", 10),
        num(p, "r", 10),
        num(p, "h", 20),
        Math.max(3, num(p, "segments", 48)),
      );
      geo.rotateX(Math.PI / 2);
      break;
    }
    case "sphere": {
      const s = Math.max(4, num(p, "segments", 32));
      geo = new THREE.SphereGeometry(num(p, "r", 10), s, Math.ceil(s / 2));
      break;
    }
    case "cone": {
      geo = new THREE.ConeGeometry(
        num(p, "r", 10),
        num(p, "h", 20),
        Math.max(3, num(p, "segments", 48)),
      );
      geo.rotateX(Math.PI / 2);
      break;
    }
    case "torus": {
      const s = Math.max(3, num(p, "segments", 48));
      geo = new THREE.TorusGeometry(num(p, "r", 10), num(p, "tube", 4), Math.max(3, Math.ceil(s / 2)), s);
      break;
    }
    case "text":
      // Text needs a font loader; deferred per spec. Placeholder box for now.
      geo = new THREE.BoxGeometry(num(p, "size", 10) * 3, num(p, "size", 10), num(p, "depth", 5));
      break;
  }
  return geo;
}

// Height of the shape's bottom below its origin, so a freshly dropped shape
// rests on the workplane (z = dropHeight).
export function dropHeight(kind: PrimitiveKind, params: Record<string, number | string>): number {
  switch (kind) {
    case "box":
      return num(params, "h", 20) / 2;
    case "cylinder":
    case "cone":
      return num(params, "h", 20) / 2;
    case "sphere":
      return num(params, "r", 10);
    case "torus":
      return num(params, "tube", 4);
    case "text":
      return num(params, "depth", 5) / 2;
  }
}

export function makeShape(kind: PrimitiveKind, at?: Vec3): ShapeNode {
  const params = { ...DEFAULT_PARAMS[kind] };
  const base: Vec3 = at ?? [0, 0, 0];
  return {
    id: newId(),
    kind,
    params,
    position: [base[0], base[1], dropHeight(kind, params)],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    role: "solid",
    color: PALETTE_COLORS[kind],
  };
}
