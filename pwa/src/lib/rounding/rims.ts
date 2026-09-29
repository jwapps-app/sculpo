import * as THREE from "three";
import type { ShapeNode } from "../../types/scene";
import type { PickEdge, Pt } from "./types";
import { parsePicks, parseSinks } from "./picks";

// The rims of a drilled hole. A cylinder hole's own two rims are usually in
// the air — it pokes through the plate it drills — and the lines the cut
// leaves where the hole meets the plate's faces belong to no shape. Those
// are the lines a screw hole needs treated: rounded over, or cut to a cone
// so a flat-head screw sits flush. They are found during the cut (the
// engine intersects the hole with the solids and reads how far along the
// hole the material reaches), and the treated cutter is the hole's own
// profile with a flare at that height, built here.

export const RIM_TOP = "xt";
export const RIM_BOTTOM = "xb";

export function isRimEdge(id: string): boolean {
  return id === RIM_TOP || id === RIM_BOTTOM;
}

/**
 * What to do to a rim: round it over at `size` (a radius) or, with `angle`
 * set, countersink it — a cone `size` across at the surface, `angle` being
 * the cone's included angle (90° for metric flat-head screws, 82° imperial).
 */
export interface RimTreatment {
  size: number;
  angle?: number;
}

/** A hole whose rims can be treated, in its own frame: Z along the hole. */
export interface RimSpec {
  /** The hole's placement inside its group, column-major. */
  frame: number[];
  r: number;
  z0: number;
  z1: number;
  segments: number;
  top?: RimTreatment;
  bottom?: RimTreatment;
}

/** Heights along a hole where it leaves the material; null where it does not. */
export interface RimExits {
  top: number | null;
  bottom: number | null;
}

function num(p: Record<string, number | string>, key: string, fallback: number): number {
  const v = p[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** The rim spec for a hole child of a group, or null for anything else. */
export function holeRim(node: ShapeNode, frame: THREE.Matrix4): RimSpec | null {
  if (node.role !== "hole" || node.kind !== "cylinder") return null;
  const p = node.params;
  const h = num(p, "h", 20);
  const picks = parsePicks(node.kind, p);
  const sinks = parseSinks(p);
  const treat = (id: string): RimTreatment | undefined => {
    const size = picks.get(id);
    if (size === undefined) return undefined;
    const angle = sinks.get(id);
    return angle === undefined ? { size } : { size, angle };
  };
  return {
    frame: frame.toArray(),
    r: num(p, "r", 10),
    z0: -h / 2,
    z1: h / 2,
    segments: Math.max(3, num(p, "segments", 48)),
    top: treat(RIM_TOP),
    bottom: treat(RIM_BOTTOM),
  };
}

// A flush hole end (the cutter stops exactly at the surface) is carried a
// hair past it so the flare cuts through, and no thinner than this.
const LIP = 0.1;
const MIN_FLARE = 0.05;

interface Flare {
  /** How far along the hole, from the rim inward, the flare reaches. */
  depth: number;
  /** Radius at the surface. */
  rOut: number;
  /** (radius, offset from the rim, inward positive), from the wall to the surface. */
  curve: Pt[];
}

function flare(r: number, t: RimTreatment, available: number): Flare | null {
  if (t.angle !== undefined) {
    const rOut = Math.max(t.size / 2, r + MIN_FLARE);
    const tan = Math.tan(THREE.MathUtils.degToRad(Math.min(170, Math.max(10, t.angle)) / 2));
    let depth = (rOut - r) / tan;
    if (depth > available) depth = available;
    const out = r + depth * tan;
    if (depth < 1e-3 || out - r < MIN_FLARE) return null;
    return { depth, rOut: out, curve: [[r, depth], [out, 0]] };
  }
  const R = Math.min(Math.max(t.size, MIN_FLARE), available);
  if (R < 1e-3) return null;
  const steps = 8;
  const curve: Pt[] = [];
  // A quarter circle, concave, from the wall (tangent to it) out to the
  // surface (tangent to that): centre at (r + R, R) in from the rim, the
  // arc on the side of it nearest the corner.
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI - (Math.PI / 2) * (i / steps);
    curve.push([r + R + R * Math.cos(a), R - R * Math.sin(a)]);
  }
  curve[0] = [r, R];
  curve[steps] = [r + R, 0];
  return { depth: R, rOut: r + R, curve };
}

/**
 * The hole's profile with each treated rim flared, as (radius, height)
 * points from the bottom of the axis round to the top of it, or null when
 * no rim is both treated and found.
 */
export function flaredProfile(spec: RimSpec, exits: RimExits): Pt[] | null {
  const zt = spec.top && exits.top !== null ? exits.top : null;
  const zb = spec.bottom && exits.bottom !== null ? exits.bottom : null;
  if (zt === null && zb === null) return null;
  // Room along the hole for the flares: everything between the two rims
  // (or a rim and the hole's far end), shared if both want more than that.
  const span = (zt ?? spec.z1) - (zb ?? spec.z0);
  let top = zt !== null ? flare(spec.r, spec.top!, span - 0.01) : null;
  let bottom = zb !== null ? flare(spec.r, spec.bottom!, span - 0.01) : null;
  if (top && bottom && top.depth + bottom.depth > span - 0.01) {
    const share = (span - 0.01) / 2;
    top = flare(spec.r, spec.top!, share);
    bottom = flare(spec.r, spec.bottom!, share);
  }
  if (!top && !bottom) return null;

  const zStart = bottom ? Math.min(spec.z0, zb! - LIP) : spec.z0;
  const zEnd = top ? Math.max(spec.z1, zt! + LIP) : spec.z1;
  const profile: Pt[] = [[0, zStart]];
  if (bottom) {
    profile.push([bottom.rOut, zStart]);
    for (const [rho, d] of [...bottom.curve].reverse()) profile.push([rho, zb! + d]);
  } else {
    profile.push([spec.r, zStart]);
  }
  if (top) {
    for (const [rho, d] of top.curve) profile.push([rho, zt! - d]);
    profile.push([top.rOut, zEnd]);
  } else {
    profile.push([spec.r, zEnd]);
  }
  profile.push([0, zEnd]);
  return profile;
}

/** A flared profile turned into the hole's frame inside its group. */
export function flaredCutter(profile: Pt[], spec: RimSpec): THREE.BufferGeometry {
  const geo = new THREE.LatheGeometry(
    profile.map(([rho, z]) => new THREE.Vector2(rho, z)),
    spec.segments,
  );
  geo.rotateX(Math.PI / 2);
  geo.applyMatrix4(new THREE.Matrix4().fromArray(spec.frame));
  return geo;
}

/**
 * The lines the rounding tool offers on a hole's found rims, in the hole's
 * own frame. A treated rim's line runs where the flare meets the surface,
 * which is the edge the user now sees.
 */
export function rimEdges(spec: RimSpec, exits: RimExits): PickEdge[] {
  const out: PickEdge[] = [];
  const N = spec.segments;
  const ring = (id: string, z: number, t: RimTreatment | undefined, sign: 1 | -1) => {
    let rho = spec.r;
    if (t) {
      const f = flare(spec.r, t, Math.abs((sign > 0 ? spec.z0 : spec.z1) - z));
      if (f) rho = f.rOut;
    }
    const points: number[] = [];
    const at = (k: number) => {
      const phi = (k / N) * Math.PI * 2;
      return [rho * Math.cos(phi), rho * Math.sin(phi), z];
    };
    for (let k = 0; k < N; k++) points.push(...at(k), ...at(k + 1));
    out.push({ id, points });
  };
  if (exits.top !== null) ring(RIM_TOP, exits.top, spec.top, 1);
  if (exits.bottom !== null) ring(RIM_BOTTOM, exits.bottom, spec.bottom, -1);
  return out;
}
