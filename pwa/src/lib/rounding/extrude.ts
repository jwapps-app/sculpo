import * as THREE from "three";
import type { CrossSection, Manifold, ManifoldToplevel, Mat4, Vec3 } from "manifold-3d";
import type { ExtrudeSpec, PickEdge, Pt } from "./types";
import type { Picks } from "./picks";
import { dedupe, filletArc, pointInPolygon, signedArea, turning, type FilletArc } from "./fillet2d";
import { fromManifold, manifoldLib, weldCoincident } from "../manifold";

// Shapes that are a 2D outline pushed straight up: polygons, stars, wedges,
// sketches, gears, text. Upright edges are rounded exactly, by rounding the
// outline's corner. Top and bottom rims are cut the way a box's are: along
// each rim segment, a prism of corner-square-minus-quarter-circle; where two
// rounded segments meet, both are trimmed on the plane that bisects the
// corner, which is exactly where their fillets meet. Around a rounded
// upright corner the rim cut is one piece swept about the corner's centre —
// a ball where the two radii match, a ring where they differ — which is the
// surface a fillet makes there.

export interface ContourInfo {
  pts: Pt[];
  /** True when the material is on the left walking the outline forwards. */
  materialLeft: boolean;
  /** Per vertex: a corner (turns sharply) rather than part of a curve. */
  sharp: boolean[];
  /** Per segment (vertex i to i+1): the id of the rim run it belongs to. */
  chainOf: number[];
}

const analysisCache = new WeakMap<ExtrudeSpec, ContourInfo[]>();

export function analyzeExtrusion(spec: ExtrudeSpec): ContourInfo[] {
  const hit = analysisCache.get(spec);
  if (hit) return hit;
  const contours = spec.contours.map(dedupe).filter((c) => c.length >= 3);
  const info = contours.map((pts, c) => {
    // A contour inside an odd number of others is a hole.
    let depth = 0;
    contours.forEach((other, o) => {
      if (o !== c && pointInPolygon(pts[0], other)) depth++;
    });
    const area = signedArea(pts);
    const materialLeft = depth % 2 === 1 ? area < 0 : area > 0;
    const n = pts.length;
    const sharp = pts.map(
      (p, i) => turning(pts[(i - 1 + n) % n], p, pts[(i + 1) % n]) > spec.sharpAngle,
    );
    const chainOf = new Array<number>(n).fill(0);
    const first = sharp.indexOf(true);
    if (first >= 0) {
      let members: number[] = [];
      for (let k = 0; k < n; k++) {
        const seg = (first + k) % n;
        members.push(seg);
        if (sharp[(seg + 1) % n]) {
          const id = Math.min(...members);
          for (const m of members) chainOf[m] = id;
          members = [];
        }
      }
    }
    return { pts, materialLeft, sharp, chainOf };
  });
  analysisCache.set(spec, info);
  return info;
}

export function extrudeEdges(spec: ExtrudeSpec): PickEdge[] {
  const out: PickEdge[] = [];
  const v = new THREE.Vector3();
  const at = (p: Pt, z: number) => {
    v.set(p[0], p[1], z).applyMatrix4(spec.post);
    return [v.x, v.y, v.z];
  };
  analyzeExtrusion(spec).forEach((ci, c) => {
    const n = ci.pts.length;
    ci.pts.forEach((p, i) => {
      if (ci.sharp[i]) out.push({ id: `s${c}.${i}`, points: [...at(p, spec.z0), ...at(p, spec.z1)] });
    });
    for (const [cap, z] of [["t", spec.z1], ["b", spec.z0]] as const) {
      const runs = new Map<number, number[]>();
      for (let i = 0; i < n; i++) {
        const pts = runs.get(ci.chainOf[i]) ?? [];
        pts.push(...at(ci.pts[i], z), ...at(ci.pts[(i + 1) % n], z));
        runs.set(ci.chainOf[i], pts);
      }
      for (const [id, points] of runs) out.push({ id: `${cap}${c}.${id}`, points });
    }
  });
  return out;
}

type Tag = { seg: number } | { arc: number };

const TRIM_OVERLAP = 1e-3;

/**
 * The rim cut around a rounded upright corner: the rim's corner-square-minus-
 * circle section swept about the corner's centre through the arc's angle.
 * On an outward corner the material is inside the arc, on an inward one
 * outside it.
 */
function arcCutter(
  lib: ManifoldToplevel,
  keep: <T extends Manifold | CrossSection>(x: T) => T,
  arc: FilletArc,
  rr: number,
  zc: number,
  sigma: 1 | -1,
  convex: boolean,
): Manifold {
  const rs = arc.radius;
  const d = convex ? -1 : 1;
  // A rim radius larger than an outward corner's radius cannot wrap it.
  const r = convex ? Math.min(rr, rs) : rr;
  const eps = Math.max(0.01, r * 0.02);
  const rhoA = rs - d * eps;
  const rhoB = rs + d * r;
  const rho0 = Math.max(0, Math.min(rhoA, rhoB));
  const rho1 = Math.max(rhoA, rhoB);
  // Revolve maps 2D y to height; depth into the material is downward for
  // the top rim and upward for the bottom one.
  const yA = sigma * eps;
  const yB = -sigma * r;
  const y0 = Math.min(yA, yB);
  const y1 = Math.max(yA, yB);
  const segments = 4 * Math.min(16, Math.max(4, Math.ceil(r * 2)));
  const square = keep(lib.CrossSection.square([rho1 - rho0, y1 - y0]).translate([rho0, y0]));
  const circle = keep(lib.CrossSection.circle(r, segments).translate([rs + d * r, -sigma * r]));
  const section = keep(square.subtract(circle));
  // A hair past each end, so it overlaps the straight cuts it joins.
  const pad = 0.25;
  const degrees = (Math.abs(arc.sweep) * 180) / Math.PI + 2 * pad;
  const from = ((arc.sweep >= 0 ? arc.start : arc.start + arc.sweep) * 180) / Math.PI - pad;
  const swept = keep(lib.Manifold.revolve(section, 96, degrees));
  const turned = keep(swept.rotate([0, 0, from]));
  return keep(turned.translate([arc.center[0], arc.center[1], zc]));
}

interface RimCut {
  A: Pt;
  B: Pt;
  P: Pt;
  N: Pt;
  r: number;
  zc: number;
  sigma: 1 | -1;
  materialLeft: boolean;
  prevCut: boolean;
  nextCut: boolean;
  /** The neighbour at that end is a swept corner cut: end square to meet it. */
  prevArc?: boolean;
  nextArc?: boolean;
}

function unit(x: number, y: number): Pt {
  const l = Math.hypot(x, y);
  return l < 1e-12 ? [0, 0] : [x / l, y / l];
}

function rimCutter(
  lib: ManifoldToplevel,
  keep: <T extends Manifold | CrossSection>(x: T) => T,
  o: RimCut,
): Manifold | null {
  const L = Math.hypot(o.B[0] - o.A[0], o.B[1] - o.A[1]);
  if (L < 1e-9) return null;
  const u = unit(o.B[0] - o.A[0], o.B[1] - o.A[1]);
  const inward: Pt = o.materialLeft ? [-u[1], u[0]] : [u[1], -u[0]];
  // Frame: x inward, y up or down so the frame is a rotation, z along u.
  const e2z = o.materialLeft ? 1 : -1;
  const k = -o.sigma * e2z;
  const r = o.r;
  const eps = Math.max(0.01, r * 0.02);
  const y0 = Math.min(-k * eps, k * r);
  const y1 = Math.max(-k * eps, k * r);
  const segments = 4 * Math.min(16, Math.max(4, Math.ceil(r * 2)));
  const square = keep(lib.CrossSection.square([r + eps, y1 - y0]).translate([-eps, y0]));
  const circle = keep(lib.CrossSection.circle(r, segments).translate([r, k * r]));
  const section = keep(square.subtract(circle));

  const side = o.materialLeft ? 1 : -1;
  const uPrev = unit(o.A[0] - o.P[0], o.A[1] - o.P[1]);
  const uNext = unit(o.N[0] - o.B[0], o.N[1] - o.B[1]);
  const convex = (a: Pt, b: Pt) => (a[0] * b[1] - a[1] * b[0]) * side > 0;
  const runout = (a: Pt, b: Pt) => {
    const t = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])));
    return eps + (t < Math.PI / 2 ? Math.min(3 * r, r / Math.max(Math.tan(t), 1e-6)) : 0);
  };
  const far = 2 * r + L;
  const trims: [Vec3, number][] = [];
  let ext0: number;
  let ext1: number;

  if (o.nextArc) {
    ext1 = far;
    trims.push([[-u[0], -u[1], 0], -(u[0] * o.B[0] + u[1] * o.B[1])]);
  } else if (o.nextCut) {
    const m = unit(u[0] + uNext[0], u[1] + uNext[1]);
    if (m[0] === 0 && m[1] === 0) ext1 = eps;
    else {
      ext1 = far;
      trims.push([[-m[0], -m[1], 0], -(m[0] * o.B[0] + m[1] * o.B[1])]);
    }
  } else if (convex(u, uNext)) {
    // The fillet runs out through the neighbouring face.
    ext1 = runout(u, uNext);
  } else {
    ext1 = far;
    trims.push([[-u[0], -u[1], 0], -(u[0] * o.B[0] + u[1] * o.B[1])]);
  }

  if (o.prevArc) {
    ext0 = far;
    trims.push([[u[0], u[1], 0], u[0] * o.A[0] + u[1] * o.A[1]]);
  } else if (o.prevCut) {
    const m = unit(uPrev[0] + u[0], uPrev[1] + u[1]);
    if (m[0] === 0 && m[1] === 0) ext0 = eps;
    else {
      ext0 = far;
      trims.push([[m[0], m[1], 0], m[0] * o.A[0] + m[1] * o.A[1]]);
    }
  } else if (convex(uPrev, u)) {
    ext0 = runout(uPrev, u);
  } else {
    ext0 = far;
    trims.push([[u[0], u[1], 0], u[0] * o.A[0] + u[1] * o.A[1]]);
  }

  const prism = keep(lib.Manifold.extrude(section, L + ext0 + ext1));
  const moved = keep(prism.translate([0, 0, -ext0]));
  const frame = [
    inward[0], inward[1], 0, 0,
    0, 0, e2z, 0,
    u[0], u[1], 0, 0,
    o.A[0], o.A[1], o.zc, 1,
  ] as Mat4;
  let placed = keep(moved.transform(frame));
  // Each cut keeps a sliver past its trim plane so neighbours overlap rather
  // than meet face to face: two faces exactly coincident can leave a
  // knife-thin fin of material between them, which a slicer reports as
  // non-manifold. On an outward corner the overlap removes nothing its
  // neighbour would not; on an inward one it removes a sliver 1 µm wide.
  for (const [normal, offset] of trims) placed = keep(placed.trimByPlane(normal, offset - TRIM_OVERLAP));
  return placed;
}

export function buildExtrusion(spec: ExtrudeSpec, picks: Picks): THREE.BufferGeometry | null {
  const lib = manifoldLib();
  if (!lib) return null;
  const info = analyzeExtrusion(spec);
  const height = spec.z1 - spec.z0;
  const capMax = height * 0.49;

  // Round the chosen upright corners in the outline, remembering where each
  // new segment came from so rim picks still find it.
  const outlines = info.map((ci, c) => {
    const n = ci.pts.length;
    const pts: Pt[] = [];
    const tags: Tag[] = [];
    const arcs = new Map<number, FilletArc>();
    for (let i = 0; i < n; i++) {
      const r = ci.sharp[i] ? picks.get(`s${c}.${i}`) : undefined;
      const arc = r ? filletArc(ci.pts[(i - 1 + n) % n], ci.pts[i], ci.pts[(i + 1) % n], r) : null;
      if (arc) arcs.set(i, arc);
      const piece = arc?.points ?? [ci.pts[i]];
      piece.forEach((p, k) => {
        pts.push(p);
        tags.push(k < piece.length - 1 ? { arc: i } : { seg: i });
      });
    }
    return { c, n, pts, tags, ci, arcs };
  });

  const owned: (Manifold | CrossSection)[] = [];
  const keep = <T extends Manifold | CrossSection>(x: T): T => {
    owned.push(x);
    return x;
  };
  try {
    const polys = outlines.map((o) => (o.ci.materialLeft ? o.pts : [...o.pts].reverse()));
    const section = keep(new lib.CrossSection(polys, "Positive"));
    const solid = keep(keep(lib.Manifold.extrude(section, height)).translate([0, 0, spec.z0]));

    const cutters: Manifold[] = [];
    for (const [cap, zc, sigma] of [["t", spec.z1, 1], ["b", spec.z0, -1]] as const) {
      for (const o of outlines) {
        const K = o.pts.length;
        const runRadius = (seg: number) => picks.get(`${cap}${o.c}.${o.ci.chainOf[seg]}`);
        // A rounded corner's arc is cut when the rim runs on both sides of
        // it are, as one piece swept about the corner.
        const arcRadius = (v: number): number | undefined => {
          const a = runRadius((v - 1 + o.n) % o.n);
          const b = runRadius(v);
          return a && b ? Math.min(a, b) : undefined;
        };
        const tagAt = (idx: number) => o.tags[((idx % K) + K) % K];
        const radiusAt = (idx: number): number | undefined => {
          const tag = tagAt(idx);
          return "seg" in tag ? runRadius(tag.seg) : arcRadius(tag.arc);
        };
        const isArc = (idx: number) => "arc" in tagAt(idx);
        const side = o.ci.materialLeft ? 1 : -1;
        for (const [v, arc] of o.arcs) {
          const rr = arcRadius(v);
          if (!rr) continue;
          // Outward corners sweep towards the material side.
          const convex = Math.sign(arc.sweep) === side;
          cutters.push(arcCutter(lib, keep, arc, Math.min(rr, capMax), zc, sigma, convex));
        }
        for (let idx = 0; idx < K; idx++) {
          if (isArc(idx)) continue;
          const rr = radiusAt(idx);
          if (!rr) continue;
          const cutter = rimCutter(lib, keep, {
            A: o.pts[idx],
            B: o.pts[(idx + 1) % K],
            P: o.pts[(idx - 1 + K) % K],
            N: o.pts[(idx + 2) % K],
            r: Math.min(rr, capMax),
            zc,
            sigma,
            materialLeft: o.ci.materialLeft,
            prevCut: !!radiusAt(idx - 1),
            nextCut: !!radiusAt(idx + 1),
            prevArc: isArc(idx - 1) && !!radiusAt(idx - 1),
            nextArc: isArc(idx + 1) && !!radiusAt(idx + 1),
          });
          if (cutter) cutters.push(cutter);
        }
      }
    }

    const result = cutters.length ? keep(lib.Manifold.difference([solid, ...cutters])) : solid;
    if (result.status() !== "NoError" || result.isEmpty()) return null;
    const welded = weldCoincident(result);
    if (welded) keep(welded);
    const geo = fromManifold(welded ?? result);
    geo.applyMatrix4(spec.post);
    return geo;
  } catch (err) {
    console.warn("Could not round extruded shape", err);
    return null;
  } finally {
    for (const x of owned) x.delete();
  }
}
