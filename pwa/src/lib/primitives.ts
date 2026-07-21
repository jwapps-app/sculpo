import * as THREE from "three";
import { FontLoader, type Font } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import type { PrimitiveKind, ShapeNode } from "../types/scene";
import { newId } from "./id";
import { decodeMeshGeometry } from "./meshData";
import typefaceData from "../assets/fonts/helvetiker_regular.typeface.json";

let font: Font | null = null;
function getFont(): Font {
  font ??= new FontLoader().parse(typefaceData);
  return font;
}

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
  wedge: { w: 20, d: 20, h: 20 },
  roof: { w: 20, d: 20, h: 20 },
  pyramid: { w: 20, h: 20 },
  hemisphere: { r: 10, segments: 32 },
  polygon: { r: 10, h: 20, sides: 6 },
  tube: { r: 10, wall: 3, h: 20, segments: 48 },
  star: { points: 5, r1: 10, r2: 4, h: 5 },
  heart: { w: 20, h: 10 },
  mesh: {},
};

export const PALETTE_COLORS: Record<PrimitiveKind, string> = {
  box: "#e05d5d",
  cylinder: "#5d8fe0",
  sphere: "#5dbf6e",
  cone: "#e0a15d",
  torus: "#a15de0",
  text: "#5dc9c9",
  wedge: "#d6795d",
  roof: "#c95d8e",
  pyramid: "#b8b25a",
  hemisphere: "#6ba85d",
  polygon: "#5d6fd6",
  tube: "#8f5dd6",
  star: "#d6b25d",
  heart: "#d65d7a",
  mesh: "#8d99a6",
};

function num(params: Record<string, number | string>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

// Extrudes a 2D profile (in the XY plane) along Z and centers it.
function extrudeProfile(
  points: [number, number][],
  depth: number,
  curveSegments = 12,
): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments });
  geo.center();
  return geo;
}

export function buildGeometry(node: ShapeNode): THREE.BufferGeometry | null {
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
    case "text": {
      const value = String(p.value ?? "").trim() || "Text";
      // Lies flat in the XY plane, extruded up along Z, centered on its origin.
      geo = new TextGeometry(value, {
        font: getFont(),
        size: num(p, "size", 10),
        depth: num(p, "depth", 5),
        curveSegments: 4,
      });
      geo.center();
      break;
    }
    case "wedge": {
      // Ramp: right-triangle profile in the XZ plane, extruded along Y.
      const w = num(p, "w", 20);
      const d = num(p, "d", 20);
      const h = num(p, "h", 20);
      geo = extrudeProfile(
        [
          [-w / 2, 0],
          [w / 2, 0],
          [-w / 2, h],
        ],
        d,
      );
      geo.rotateX(Math.PI / 2);
      break;
    }
    case "roof": {
      // Gable: isoceles-triangle profile extruded along Y.
      const w = num(p, "w", 20);
      const d = num(p, "d", 20);
      const h = num(p, "h", 20);
      geo = extrudeProfile(
        [
          [-w / 2, 0],
          [w / 2, 0],
          [0, h],
        ],
        d,
      );
      geo.rotateX(Math.PI / 2);
      break;
    }
    case "pyramid": {
      // Square pyramid: 4-sided cone, rotated so faces align with the axes.
      const w = num(p, "w", 20);
      geo = new THREE.ConeGeometry((w * Math.SQRT2) / 2, num(p, "h", 20), 4);
      geo.rotateY(Math.PI / 4);
      geo.rotateX(Math.PI / 2);
      break;
    }
    case "hemisphere": {
      // Lathe a quarter-circle profile closed to the axis at both ends so the
      // bottom is capped (open shells break CSG and slicers).
      const r = num(p, "r", 10);
      const s = Math.max(8, num(p, "segments", 32));
      const profile: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
      const steps = Math.ceil(s / 2);
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * (Math.PI / 2);
        profile.push(new THREE.Vector2(r * Math.cos(a), r * Math.sin(a)));
      }
      geo = new THREE.LatheGeometry(profile, s);
      geo.rotateX(Math.PI / 2);
      break;
    }
    case "polygon": {
      geo = new THREE.CylinderGeometry(
        num(p, "r", 10),
        num(p, "r", 10),
        num(p, "h", 20),
        Math.max(3, Math.round(num(p, "sides", 6))),
      );
      geo.rotateX(Math.PI / 2);
      break;
    }
    case "tube": {
      const r = Math.max(0.2, num(p, "r", 10));
      const wall = Math.min(Math.max(0.1, num(p, "wall", 3)), r - 0.1);
      const s = Math.max(8, num(p, "segments", 48));
      const outer = new THREE.Shape();
      outer.absarc(0, 0, r, 0, Math.PI * 2, false);
      const inner = new THREE.Path();
      inner.absarc(0, 0, r - wall, 0, Math.PI * 2, true);
      outer.holes.push(inner);
      geo = new THREE.ExtrudeGeometry(outer, {
        depth: num(p, "h", 20),
        bevelEnabled: false,
        curveSegments: s,
      });
      geo.center();
      break;
    }
    case "star": {
      const n = Math.max(3, Math.round(num(p, "points", 5)));
      const r1 = num(p, "r1", 10);
      const r2 = num(p, "r2", 4);
      const pts: [number, number][] = [];
      for (let i = 0; i < n * 2; i++) {
        const r = i % 2 === 0 ? r1 : r2;
        const a = (i / (n * 2)) * Math.PI * 2 + Math.PI / 2;
        pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      geo = extrudeProfile(pts, num(p, "h", 5), 1);
      break;
    }
    case "heart": {
      // Classic bezier heart profile (spans 22 × 19 units), scaled to the
      // requested width and extruded.
      const s = num(p, "w", 20) / 22;
      const shape = new THREE.Shape();
      shape.moveTo(5 * s, 5 * s);
      shape.bezierCurveTo(5 * s, 5 * s, 4 * s, 0, 0, 0);
      shape.bezierCurveTo(-6 * s, 0, -6 * s, 7 * s, -6 * s, 7 * s);
      shape.bezierCurveTo(-6 * s, 11 * s, -3 * s, 15.4 * s, 5 * s, 19 * s);
      shape.bezierCurveTo(12 * s, 15.4 * s, 16 * s, 11 * s, 16 * s, 7 * s);
      shape.bezierCurveTo(16 * s, 7 * s, 16 * s, 0, 10 * s, 0);
      shape.bezierCurveTo(7 * s, 0, 5 * s, 5 * s, 5 * s, 5 * s);
      geo = new THREE.ExtrudeGeometry(shape, {
        depth: num(p, "h", 10),
        bevelEnabled: false,
        curveSegments: 12,
      });
      // The classic profile points up; flip so the lobes face +Y.
      geo.rotateZ(Math.PI);
      geo.center();
      break;
    }
    case "mesh": {
      const decoded = decodeMeshGeometry(p);
      if (!decoded) return null;
      geo = decoded;
      break;
    }
  }
  return geo;
}

// Distance from the shape's origin down to its lowest point, so a freshly
// dropped shape rests on the workplane. Derived from the actual geometry.
export function bottomOffset(kind: PrimitiveKind, params: Record<string, number | string>): number {
  const geo = buildGeometry({ kind, params } as ShapeNode);
  if (!geo) return 0;
  geo.computeBoundingBox();
  const offset = geo.boundingBox ? -geo.boundingBox.min.z : 0;
  geo.dispose();
  return offset;
}

export function makeShape(kind: PrimitiveKind): ShapeNode {
  const params = { ...DEFAULT_PARAMS[kind] };
  return {
    id: newId(),
    kind,
    params,
    position: [0, 0, bottomOffset(kind, params)],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    role: "solid",
    color: PALETTE_COLORS[kind],
  };
}
