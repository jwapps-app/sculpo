import * as THREE from "three";
import { FontLoader, type Font } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { PrimitiveKind, ShapeNode } from "../types/scene";
import { newId } from "./id";
import { decodeMeshGeometry } from "./meshData";
import { GEAR_CURVE_SEGMENTS, gearGeometry, gearShape, threadGeometry } from "./generators";
import {
  isLegacyRounding,
  parsePicks,
  roundedGeometry,
  type Pt,
  type RoundSpec,
} from "./rounding";
import {
  extrudeSketchGeometry,
  parsePaths,
  parsePoints,
  revolveLoop,
  revolveSketchGeometry,
  scribbleGeometry,
  scribbleShapes,
} from "./sketchGeometry";
import typefaceData from "../assets/fonts/helvetiker_regular.typeface.json";
import typefaceBold from "../assets/fonts/helvetiker_bold.typeface.json";
import typefaceSerif from "../assets/fonts/optimer_regular.typeface.json";

// Bundled typefaces. Parsed lazily and cached — parsing is the expensive part.
export const FONTS: Record<string, unknown> = {
  sans: typefaceData,
  "sans bold": typefaceBold,
  serif: typefaceSerif,
};
export const FONT_NAMES = Object.keys(FONTS);

const fontCache = new Map<string, Font>();
function getFont(name: string): Font {
  const key = FONTS[name] ? name : "sans";
  let f = fontCache.get(key);
  if (!f) {
    f = new FontLoader().parse(FONTS[key] as Parameters<FontLoader["parse"]>[0]);
    fontCache.set(key, f);
  }
  return f;
}

// Units are millimeters. World is Z-up; three's Y-up primitives (cylinder,
// cone) are rotated so their axis is Z.

export const DEFAULT_PARAMS: Record<
  PrimitiveKind,
  Record<string, number | string>
> = {
  box: { w: 20, d: 20, h: 20, radius: 0 },
  cylinder: { r: 10, h: 20, segments: 48, bevel: 0 },
  sphere: { r: 10, segments: 32 },
  cone: { r: 10, h: 20, segments: 48 },
  torus: { r: 10, tube: 4, segments: 48 },
  text: { value: "Text", font: "sans", size: 10, depth: 5 },
  wedge: { w: 20, d: 20, h: 20 },
  roof: { w: 20, d: 20, h: 20 },
  pyramid: { w: 20, h: 20 },
  hemisphere: { r: 10, segments: 32 },
  polygon: { r: 10, h: 20, sides: 6 },
  tube: { r: 10, wall: 3, h: 20, segments: 48 },
  star: { points: 5, r1: 10, r2: 4, h: 5 },
  octagon: { r: 10, h: 20 },
  thread: { diameter: 10, pitch: 1.5, length: 20, segments: 64, internal: 0 },
  gear: { teeth: 16, module: 2, thickness: 6, bore: 5 },
  sketch: { profile: "[]", h: 10 },
  revolve: { profile: "[]", segments: 48 },
  scribble: { paths: "[]", brush: 4, h: 5 },
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
  octagon: "#5da8d6",
  thread: "#8a94a6",
  gear: "#5d9ad6",
  sketch: "#5d7fd6",
  revolve: "#c97a5d",
  scribble: "#7a5dd6",
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

// ---- Rounded edges ----------------------------------------------------------

const ROTATE_UP = new THREE.Matrix4().makeRotationX(Math.PI / 2);
// An outline vertex turning less than this is part of a curve, not a corner.
const SHARP_ANGLE = Math.PI / 6;

function contoursOf(shapes: THREE.Shape[], curveSegments: number): Pt[][] {
  const out: Pt[][] = [];
  for (const shape of shapes) {
    const { shape: outer, holes } = shape.extractPoints(curveSegments);
    out.push(outer.map((v) => [v.x, v.y] as Pt));
    for (const hole of holes) out.push(hole.map((v) => [v.x, v.y] as Pt));
  }
  return out;
}

/**
 * An extruded outline centred on its bounding box, as geometry.center()
 * leaves ExtrudeGeometry, optionally followed by a further transform.
 */
function centredExtrusion(
  contours: Pt[][],
  depth: number,
  sharpAngle = SHARP_ANGLE,
  after?: THREE.Matrix4,
): RoundSpec {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of contours)
    for (const [x, y] of c) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  const centre = new THREE.Matrix4().makeTranslation(-(minX + maxX) / 2, -(minY + maxY) / 2, -depth / 2);
  const post = after ? after.clone().multiply(centre) : centre;
  return { family: "extrude", contours, z0: 0, z1: depth, post, sharpAngle };
}

const specCache = new Map<string, RoundSpec | null>();

/**
 * How a shape's edges can be rounded, described from the same numbers its
 * builder below uses — the rounded shape and the lines the rounding tool
 * offers must sit exactly on what is drawn. Null for shapes with no edges
 * that can be rounded (sphere, torus, thread, imported mesh).
 */
export function roundingSpec(node: Pick<ShapeNode, "kind" | "params">): RoundSpec | null {
  const key = `${node.kind}|${JSON.stringify(node.params)}`;
  if (specCache.has(key)) return specCache.get(key)!;
  const spec = computeSpec(node);
  if (specCache.size > 200) specCache.clear();
  specCache.set(key, spec);
  return spec;
}

function computeSpec(node: Pick<ShapeNode, "kind" | "params">): RoundSpec | null {
  const p = node.params;
  switch (node.kind) {
    case "box":
      return { family: "box", size: [num(p, "w", 20), num(p, "d", 20), num(p, "h", 20)] };
    case "cylinder": {
      const r = num(p, "r", 10);
      const h = num(p, "h", 20);
      return {
        family: "lathe",
        profile: [[0, -h / 2], [r, -h / 2], [r, h / 2], [0, h / 2]],
        closed: false,
        segments: Math.max(3, num(p, "segments", 48)),
        post: ROTATE_UP,
      };
    }
    case "cone": {
      const r = num(p, "r", 10);
      const h = num(p, "h", 20);
      return {
        family: "lathe",
        profile: [[0, -h / 2], [r, -h / 2], [0, h / 2]],
        closed: false,
        segments: Math.max(3, num(p, "segments", 48)),
        post: ROTATE_UP,
      };
    }
    case "hemisphere": {
      const r = num(p, "r", 10);
      const s = Math.max(8, num(p, "segments", 32));
      const steps = Math.ceil(s / 2);
      const profile: Pt[] = [[0, 0]];
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * (Math.PI / 2);
        profile.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      return { family: "lathe", profile, closed: false, segments: s, post: ROTATE_UP, hemisphere: r };
    }
    case "tube": {
      const r = Math.max(0.2, num(p, "r", 10));
      const wall = Math.min(Math.max(0.1, num(p, "wall", 3)), r - 0.1);
      const h = num(p, "h", 20);
      return {
        family: "lathe",
        profile: [[r - wall, -h / 2], [r, -h / 2], [r, h / 2], [r - wall, h / 2]],
        closed: true,
        segments: Math.max(8, num(p, "segments", 48)),
        post: ROTATE_UP,
      };
    }
    case "revolve": {
      const loop = revolveLoop(parsePoints(p.profile));
      if (!loop) return null;
      const ys = loop.map(([, y]) => y);
      const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
      return {
        family: "lathe",
        profile: loop,
        closed: true,
        segments: Math.min(128, Math.max(8, Math.round(num(p, "segments", 48)))),
        post: new THREE.Matrix4().makeTranslation(0, 0, -mid).multiply(ROTATE_UP),
      };
    }
    case "polygon":
    case "octagon": {
      const r = num(p, "r", 10);
      const h = num(p, "h", 20);
      const n = node.kind === "octagon" ? 8 : Math.max(3, Math.round(num(p, "sides", 6)));
      // CylinderGeometry's corners, turned up to Z: (r sin θ, −r cos θ).
      const phase = node.kind === "octagon" ? Math.PI / 8 : 0;
      const outline: Pt[] = [];
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2 + phase;
        outline.push([r * Math.sin(t), -r * Math.cos(t)]);
      }
      return {
        family: "extrude",
        contours: [outline],
        z0: -h / 2,
        z1: h / 2,
        post: new THREE.Matrix4(),
        sharpAngle: SHARP_ANGLE,
      };
    }
    case "star": {
      const n = Math.max(3, Math.round(num(p, "points", 5)));
      const r1 = num(p, "r1", 10);
      const r2 = num(p, "r2", 4);
      const pts: Pt[] = [];
      for (let i = 0; i < n * 2; i++) {
        const r = i % 2 === 0 ? r1 : r2;
        const a = (i / (n * 2)) * Math.PI * 2 + Math.PI / 2;
        pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      return centredExtrusion([pts], num(p, "h", 5));
    }
    case "wedge":
    case "roof": {
      const w = num(p, "w", 20);
      const d = num(p, "d", 20);
      const h = num(p, "h", 20);
      const apex: Pt = node.kind === "wedge" ? [-w / 2, h] : [0, h];
      return centredExtrusion([[[-w / 2, 0], [w / 2, 0], apex]], d, SHARP_ANGLE, ROTATE_UP);
    }
    case "text": {
      const value = String(p.value ?? "").trim() || "Text";
      const shapes = getFont(String(p.font ?? "sans")).generateShapes(value, num(p, "size", 10));
      return centredExtrusion(contoursOf(shapes, 4), num(p, "depth", 5));
    }
    case "gear": {
      const { shape, thickness } = gearShape({
        teeth: num(p, "teeth", 16),
        module: Math.max(0.2, num(p, "module", 2)),
        thickness: num(p, "thickness", 6),
        bore: num(p, "bore", 5),
      });
      return centredExtrusion(contoursOf([shape], GEAR_CURVE_SEGMENTS), thickness);
    }
    case "sketch": {
      const pts = parsePoints(p.profile);
      if (pts.length < 3) return null;
      const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
      return centredExtrusion(contoursOf([shape], 8), num(p, "h", 10));
    }
    case "scribble": {
      const shapes = scribbleShapes(parsePaths(p.paths), num(p, "brush", 4));
      if (!shapes) return null;
      // Brush strokes have no corners: their outline is one smooth run.
      return centredExtrusion(contoursOf(shapes, 4), num(p, "h", 5), Math.PI);
    }
    case "pyramid": {
      const w = num(p, "w", 20);
      const h = num(p, "h", 20);
      return {
        family: "convex",
        vertices: [
          [-w / 2, -w / 2, -h / 2],
          [w / 2, -w / 2, -h / 2],
          [w / 2, w / 2, -h / 2],
          [-w / 2, w / 2, -h / 2],
          [0, 0, h / 2],
        ],
        faces: [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]],
        edges: [
          { id: "b0", a: 0, b: 1 },
          { id: "b1", a: 1, b: 2 },
          { id: "b2", a: 2, b: 3 },
          { id: "b3", a: 3, b: 0 },
          { id: "s0", a: 0, b: 4 },
          { id: "s1", a: 1, b: 4 },
          { id: "s2", a: 2, b: 4 },
          { id: "s3", a: 3, b: 4 },
        ],
        maxRadius: Math.min(w, h) * 0.2,
      };
    }
    default:
      return null;
  }
}

const roundedCache = new Map<string, THREE.BufferGeometry>();

/**
 * The shape with its picked edges rounded, or null when none are picked (or
 * the boolean engine it needs has not loaded yet). Shapes saved before
 * rounding was per edge keep their old geometry through the switch below.
 */
function buildRounded(node: ShapeNode): THREE.BufferGeometry | null {
  if (typeof node.params.edges !== "string") return null;
  const picks = parsePicks(node.kind, node.params);
  if (picks.size === 0) return null;
  const key = `${node.kind}|${JSON.stringify(node.params)}`;
  const hit = roundedCache.get(key);
  if (hit) return hit.clone();
  const spec = roundingSpec(node);
  if (!spec) return null;
  const geo = roundedGeometry(spec, picks);
  if (!geo) return null;
  if (roundedCache.size >= 48) {
    const oldest = roundedCache.keys().next().value;
    if (oldest !== undefined) {
      roundedCache.get(oldest)?.dispose();
      roundedCache.delete(oldest);
    }
  }
  roundedCache.set(key, geo);
  return geo.clone();
}

export function buildGeometry(node: ShapeNode): THREE.BufferGeometry | null {
  const rounded = buildRounded(node);
  if (rounded) return rounded;
  const p = node.params;
  let geo: THREE.BufferGeometry;
  switch (node.kind) {
    case "box": {
      const w = num(p, "w", 20);
      const d = num(p, "d", 20);
      const h = num(p, "h", 20);
      // Boxes saved before edges could be picked one by one round every edge
      // by `radius`, capped at half the smallest side.
      const radius = Math.min(num(p, "radius", 0), Math.min(w, d, h) / 2 - 0.01);
      geo =
        isLegacyRounding("box", p) && radius > 0.01
          ? new RoundedBoxGeometry(w, d, h, 4, radius)
          : new THREE.BoxGeometry(w, d, h);
      break;
    }
    case "cylinder": {
      const r = num(p, "r", 10);
      const h = num(p, "h", 20);
      const segments = Math.max(3, num(p, "segments", 48));
      // Cylinders saved before rims could be picked one by one round both by
      // `bevel`; lathe a profile with quarter-arcs.
      const bevel = Math.min(num(p, "bevel", 0), Math.min(r, h / 2) - 0.01);
      if (bevel > 0.01 && isLegacyRounding("cylinder", p)) {
        const steps = 6;
        const profile: THREE.Vector2[] = [new THREE.Vector2(0, -h / 2)];
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * (Math.PI / 2);
          profile.push(
            new THREE.Vector2(
              r - bevel + bevel * Math.sin(a),
              -h / 2 + bevel - bevel * Math.cos(a),
            ),
          );
        }
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * (Math.PI / 2);
          profile.push(
            new THREE.Vector2(r - bevel + bevel * Math.cos(a), h / 2 - bevel + bevel * Math.sin(a)),
          );
        }
        profile.push(new THREE.Vector2(0, h / 2));
        geo = new THREE.LatheGeometry(profile, segments);
      } else {
        geo = new THREE.CylinderGeometry(r, r, h, segments);
      }
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
        font: getFont(String(p.font ?? "sans")),
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
    case "octagon": {
      geo = new THREE.CylinderGeometry(
        num(p, "r", 10),
        num(p, "r", 10),
        num(p, "h", 20),
        8,
      );
      // Flat edge forward, like a stop sign.
      geo.rotateY(Math.PI / 8);
      geo.rotateX(Math.PI / 2);
      break;
    }
    case "thread": {
      geo = threadGeometry({
        diameter: num(p, "diameter", 10),
        pitch: Math.max(0.2, num(p, "pitch", 1.5)),
        length: num(p, "length", 20),
        segments: num(p, "segments", 64),
        internal: num(p, "internal", 0) > 0.5,
      });
      break;
    }
    case "gear": {
      geo = gearGeometry({
        teeth: num(p, "teeth", 16),
        module: Math.max(0.2, num(p, "module", 2)),
        thickness: num(p, "thickness", 6),
        bore: num(p, "bore", 5),
      });
      break;
    }
    case "sketch": {
      const built = extrudeSketchGeometry(parsePoints(p.profile), num(p, "h", 10));
      if (!built) return null;
      geo = built;
      break;
    }
    case "revolve": {
      const built = revolveSketchGeometry(parsePoints(p.profile), num(p, "segments", 48));
      if (!built) return null;
      geo = built;
      break;
    }
    case "scribble": {
      const built = scribbleGeometry(parsePaths(p.paths), num(p, "brush", 4), num(p, "h", 5));
      if (!built) return null;
      geo = built;
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

export interface Footprint {
  halfW: number;
  halfD: number;
  bottom: number; // distance from origin down to the lowest point
}

// Derived from the actual geometry: XY half-extents (for finding a free spot
// on the plane) and the drop offset that rests the shape on the workplane.
export function footprint(
  kind: PrimitiveKind,
  params: Record<string, number | string>,
): Footprint {
  const geo = buildGeometry({ kind, params } as ShapeNode);
  if (!geo) return { halfW: 10, halfD: 10, bottom: 0 };
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const result = b
    ? { halfW: (b.max.x - b.min.x) / 2, halfD: (b.max.y - b.min.y) / 2, bottom: -b.min.z }
    : { halfW: 10, halfD: 10, bottom: 0 };
  geo.dispose();
  return result;
}

export function bottomOffset(kind: PrimitiveKind, params: Record<string, number | string>): number {
  return footprint(kind, params).bottom;
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
