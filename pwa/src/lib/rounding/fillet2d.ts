import type { Pt } from "./types";

// Plane geometry shared by the rounding builders: rounding a corner of an
// outline, and telling corners from curves.

/** Drops repeated points, including a closing copy of the first. */
export function dedupe(pts: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9) out.push([p[0], p[1]]);
  }
  while (
    out.length > 2 &&
    Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-9
  ) {
    out.pop();
  }
  return out;
}

export function signedArea(pts: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** How far the outline turns at v: 0 going straight, up to π for a hairpin. */
export function turning(prev: Pt, v: Pt, next: Pt): number {
  const ax = v[0] - prev[0];
  const ay = v[1] - prev[1];
  const bx = next[0] - v[0];
  const by = next[1] - v[1];
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-12 || lb < 1e-12) return 0;
  const cos = (ax * bx + ay * by) / (la * lb);
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

/**
 * Replaces the corner at v with a circular arc of radius r tangent to both
 * neighbouring edges. Works for outward and inward corners alike: the arc's
 * centre sits on the side where the corner's angle is less than 180°.
 * The tangent points may use at most 49% of each neighbouring edge, so two
 * rounded corners on one edge never overlap; a radius too big for that is
 * reduced to fit. Returns the arc's points, first tangent point to last, or
 * null for a corner that is effectively straight.
 */
export function filletCorner(prev: Pt, v: Pt, next: Pt, r: number): Pt[] | null {
  return filletArc(prev, v, next, r)?.points ?? null;
}

export interface FilletArc {
  points: Pt[];
  center: Pt;
  radius: number;
  /** Angle of the first tangent point seen from the centre, and the signed sweep. */
  start: number;
  sweep: number;
}

/** filletCorner, with the arc's circle as well as its points. */
export function filletArc(prev: Pt, v: Pt, next: Pt, r: number): FilletArc | null {
  const ax = prev[0] - v[0];
  const ay = prev[1] - v[1];
  const bx = next[0] - v[0];
  const by = next[1] - v[1];
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-9 || lb < 1e-9) return null;
  const ua: Pt = [ax / la, ay / la];
  const ub: Pt = [bx / lb, by / lb];
  const theta = Math.acos(Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1])));
  if (theta < 1e-3 || theta > Math.PI - 1e-3) return null;
  const tanHalf = Math.tan(theta / 2);
  const t = Math.min(r / tanHalf, 0.49 * la, 0.49 * lb);
  const rr = t * tanHalf;
  if (rr < 1e-4) return null;
  const bis: Pt = [ua[0] + ub[0], ua[1] + ub[1]];
  const bl = Math.hypot(bis[0], bis[1]);
  const d = rr / Math.sin(theta / 2);
  const c: Pt = [v[0] + (bis[0] / bl) * d, v[1] + (bis[1] / bl) * d];
  const t1: Pt = [v[0] + ua[0] * t, v[1] + ua[1] * t];
  const t2: Pt = [v[0] + ub[0] * t, v[1] + ub[1] * t];
  const a1 = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
  let a2 = Math.atan2(t2[1] - c[1], t2[0] - c[0]);
  // The short way round: the arc spans π − θ.
  let sweep = a2 - a1;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  a2 = a1 + sweep;
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a1 + (sweep * i) / steps;
    out.push([c[0] + rr * Math.cos(a), c[1] + rr * Math.sin(a)]);
  }
  out[0] = t1;
  out[steps] = t2;
  return { points: out, center: c, radius: rr, start: a1, sweep };
}
