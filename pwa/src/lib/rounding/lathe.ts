import * as THREE from "three";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import type { LatheSpec, PickEdge, Pt } from "./types";
import type { Picks } from "./picks";
import { filletCorner, turning } from "./fillet2d";
import { fromManifold, toManifold } from "../manifold";

// Turned solids. Rounding a circular edge of a lathed shape is exactly
// rounding the matching corner of its profile before it is turned, so this
// needs no boolean engine and is exact.

// A profile vertex turning less than this is part of a curve, not a corner.
const CORNER_ANGLE = Math.PI / 6;
const CREASE = THREE.MathUtils.degToRad(40);

/** Profile corners that make a circular edge: off the axis, and sharp. */
export function latheCorners(spec: LatheSpec): number[] {
  const p = spec.profile;
  const n = p.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!spec.closed && (i === 0 || i === n - 1)) continue;
    if (p[i][0] < 1e-6) continue;
    const prev = p[(i - 1 + n) % n];
    const next = p[(i + 1) % n];
    if (turning(prev, p[i], next) > CORNER_ANGLE) out.push(i);
  }
  return out;
}

/**
 * A hemisphere's rim, where the flat base meets the sphere, rounded exactly:
 * the rounding circle touches the base and sits inside the sphere, tangent
 * to both.
 */
function hemisphereProfile(R: number, f: number, segments: number): Pt[] {
  const fr = Math.min(f, R * 0.45);
  const xf = Math.sqrt((R - fr) ** 2 - fr * fr);
  const alpha = Math.atan2(fr, xf);
  const out: Pt[] = [[0, 0], [xf, 0]];
  const filletSteps = Math.max(3, Math.ceil((alpha + Math.PI / 2) / (Math.PI / 24)));
  for (let i = 1; i <= filletSteps; i++) {
    const a = -Math.PI / 2 + ((alpha + Math.PI / 2) * i) / filletSteps;
    out.push([xf + fr * Math.cos(a), fr + fr * Math.sin(a)]);
  }
  const sphereSteps = Math.max(4, Math.ceil(((Math.PI / 2 - alpha) / (Math.PI / 2)) * (segments / 2)));
  for (let i = 1; i <= sphereSteps; i++) {
    const a = alpha + ((Math.PI / 2 - alpha) * i) / sphereSteps;
    out.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  out[out.length - 1] = [0, R];
  return out;
}

export function buildLathe(spec: LatheSpec, picks: Picks): THREE.BufferGeometry {
  let profile: Pt[];
  if (spec.hemisphere && picks.has("c1")) {
    profile = hemisphereProfile(spec.hemisphere, picks.get("c1")!, spec.segments);
  } else {
    const p = spec.profile;
    const n = p.length;
    const corners = new Set(latheCorners(spec));
    profile = [];
    for (let i = 0; i < n; i++) {
      const r = corners.has(i) ? picks.get(`c${i}`) : undefined;
      const arc = r ? filletCorner(p[(i - 1 + n) % n], p[i], p[(i + 1) % n], r) : null;
      if (arc) profile.push(...arc);
      else profile.push(p[i]);
    }
  }
  if (spec.closed) profile.push(profile[0]);
  const lathe = new THREE.LatheGeometry(
    profile.map(([x, y]) => new THREE.Vector2(x, y)),
    spec.segments,
  );
  lathe.applyMatrix4(spec.post);
  // A lathe leaves a seam whose two sides differ in the last bit and
  // collapsed triangles at the axis; welding through the engine gives one
  // closed skin, as a slicer wants. Without the engine yet, show it as is.
  const solid = toManifold(lathe);
  if (solid) {
    const clean = fromManifold(solid);
    solid.delete();
    lathe.dispose();
    return clean;
  }
  // Smooth across the rounding, sharp across any corner left square.
  const shaded = toCreasedNormals(lathe, CREASE);
  lathe.dispose();
  return shaded;
}

export function latheEdges(spec: LatheSpec): PickEdge[] {
  // The shape's own facet count, so the line sits on its rim, not inside it.
  const N = spec.segments;
  const v = new THREE.Vector3();
  return latheCorners(spec).map((i) => {
    const [x, y] = spec.profile[i];
    const points: number[] = [];
    // Same parametrisation as LatheGeometry: (x sin φ, y, x cos φ).
    const at = (k: number) => {
      const phi = (k / N) * Math.PI * 2;
      v.set(x * Math.sin(phi), y, x * Math.cos(phi)).applyMatrix4(spec.post);
      return [v.x, v.y, v.z];
    };
    for (let k = 0; k < N; k++) points.push(...at(k), ...at(k + 1));
    return { id: `c${i}`, points };
  });
}
