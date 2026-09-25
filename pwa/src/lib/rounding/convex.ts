import * as THREE from "three";
import type { CrossSection, Manifold, Mat4, Vec3 } from "manifold-3d";
import type { ConvexSpec, PickEdge } from "./types";
import type { Picks } from "./picks";
import { fromManifold, manifoldLib, weldCoincident } from "../manifold";

// Convex solids with flat faces (the pyramid). The box's method, for any
// angle between faces: each rounded edge is cut by a prism whose section is
// the wedge between the two faces minus the rounding circle tangent to
// both; where every edge at a corner is rounded with one radius, a ball
// tangent to all the corner's faces finishes it.

export function convexEdges(spec: ConvexSpec): PickEdge[] {
  return spec.edges.map((e) => ({ id: e.id, points: [...spec.vertices[e.a], ...spec.vertices[e.b]] }));
}

export function buildConvex(spec: ConvexSpec, picks: Picks): THREE.BufferGeometry | null {
  const lib = manifoldLib();
  if (!lib) return null;
  const V = spec.vertices.map((p) => new THREE.Vector3(...p));
  // Inward unit normal and offset per face: inside means n·p ≥ d.
  const faces = spec.faces.map((f) => {
    const out = new THREE.Vector3()
      .subVectors(V[f[1]], V[f[0]])
      .cross(new THREE.Vector3().subVectors(V[f[2]], V[f[0]]))
      .normalize();
    const n = out.negate();
    return { verts: f, n, d: n.dot(V[f[0]]) };
  });
  const facesOf = (a: number, b: number) =>
    faces.filter((f) => f.verts.includes(a) && f.verts.includes(b));
  const radius = (id: string) => Math.min(picks.get(id) ?? 0, spec.maxRadius);

  const owned: (Manifold | CrossSection)[] = [];
  const keep = <T extends Manifold | CrossSection>(x: T): T => {
    owned.push(x);
    return x;
  };
  const segmentsFor = (r: number) => 4 * Math.min(16, Math.max(4, Math.ceil(r * 2)));
  try {
    const solid = keep(lib.Manifold.hull(spec.vertices as Vec3[]));
    const cutters: Manifold[] = [];

    for (const e of spec.edges) {
      const r = radius(e.id);
      if (r <= 0.01) continue;
      const [f1, f2] = facesOf(e.a, e.b);
      if (!f1 || !f2) continue;
      const axis = new THREE.Vector3().subVectors(V[e.b], V[e.a]);
      const L = axis.length();
      axis.normalize();
      const b1 = f1.n.clone();
      const b2 = new THREE.Vector3().crossVectors(axis, b1);
      const n2: [number, number] = [f2.n.dot(b1), f2.n.dot(b2)];
      if (Math.abs(n2[1]) < 1e-6) continue;
      // The rounding circle's centre: distance r from both faces.
      const C: [number, number] = [r, (r - n2[0] * r) / n2[1]];
      const eps = Math.max(0.01, r * 0.02);
      const T1: [number, number] = [0 - eps, C[1]];
      const T2: [number, number] = [C[0] - r * n2[0] - eps * n2[0], C[1] - r * n2[1] - eps * n2[1]];
      const out = [-(1 + n2[0]), -n2[1]];
      const ol = Math.hypot(out[0], out[1]) || 1;
      const E: [number, number] = [(out[0] / ol) * eps, (out[1] / ol) * eps];
      let poly: [number, number][] = [E, T1, C, T2];
      let area = 0;
      for (let i = 0; i < 4; i++) {
        const [x1, y1] = poly[i];
        const [x2, y2] = poly[(i + 1) % 4];
        area += x1 * y2 - x2 * y1;
      }
      if (area < 0) poly = poly.reverse();
      const wedge = keep(new lib.CrossSection([poly]));
      const circle = keep(keep(lib.CrossSection.circle(r, segmentsFor(r))).translate(C));
      const section = keep(wedge.subtract(circle));
      const margin = Math.hypot(C[0], C[1]) + r;
      const prism = keep(keep(lib.Manifold.extrude(section, L + 2 * margin)).translate([0, 0, -margin]));
      const frame = [
        b1.x, b1.y, b1.z, 0,
        b2.x, b2.y, b2.z, 0,
        axis.x, axis.y, axis.z, 0,
        V[e.a].x, V[e.a].y, V[e.a].z, 1,
      ] as Mat4;
      cutters.push(keep(prism.transform(frame)));
    }

    // Ball corners.
    spec.vertices.forEach((_, vi) => {
      const incident = spec.edges.filter((e) => e.a === vi || e.b === vi);
      const radii = incident.map((e) => radius(e.id));
      if (!incident.length || radii.some((r) => r <= 0.01)) return;
      if (Math.max(...radii) - Math.min(...radii) > 1e-6) return;
      const r = radii[0];
      const around = faces.filter((f) => f.verts.includes(vi));
      if (around.length < 3) return;
      // Centre r from each face: solve with three, confirm with the rest.
      const m = new THREE.Matrix3().set(
        around[0].n.x, around[0].n.y, around[0].n.z,
        around[1].n.x, around[1].n.y, around[1].n.z,
        around[2].n.x, around[2].n.y, around[2].n.z,
      );
      if (Math.abs(m.determinant()) < 1e-9) return;
      const rhs = new THREE.Vector3(around[0].d + r, around[1].d + r, around[2].d + r);
      const C = rhs.applyMatrix3(m.clone().invert());
      if (around.some((f) => Math.abs(f.n.dot(C) - f.d - r) > 1e-4)) return;
      const eps = Math.max(0.01, r * 0.02);
      const outward = new THREE.Vector3();
      for (const f of around) outward.sub(f.n);
      outward.normalize();
      const pts: Vec3[] = [
        V[vi].clone().addScaledVector(outward, eps).toArray() as Vec3,
        C.toArray() as Vec3,
      ];
      for (const f of around) {
        pts.push(C.clone().addScaledVector(f.n, -(r + eps)).toArray() as Vec3);
      }
      for (const e of incident) {
        const other = V[e.a === vi ? e.b : e.a];
        const dir = new THREE.Vector3().subVectors(other, V[vi]).normalize();
        const foot = V[vi].clone().addScaledVector(dir, new THREE.Vector3().subVectors(C, V[vi]).dot(dir));
        pts.push(foot.addScaledVector(outward, eps).toArray() as Vec3);
      }
      const cell = keep(lib.Manifold.hull(pts));
      const ball = keep(
        keep(lib.Manifold.sphere(r, segmentsFor(r))).translate(C.toArray() as Vec3),
      );
      cutters.push(keep(cell.subtract(ball)));
    });

    const result = cutters.length ? keep(lib.Manifold.difference([solid, ...cutters])) : solid;
    if (result.status() !== "NoError" || result.isEmpty()) return null;
    const welded = weldCoincident(result);
    if (welded) keep(welded);
    return fromManifold(welded ?? result);
  } catch (err) {
    console.warn("Could not round convex shape", err);
    return null;
  } finally {
    for (const x of owned) x.delete();
  }
}
