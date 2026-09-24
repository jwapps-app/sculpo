import { useSyncExternalStore } from "react";
import * as THREE from "three";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import type { CrossSection, Manifold, ManifoldToplevel, Mat4 } from "manifold-3d";
import { BOX_EDGES, edgeSign, fullyRoundedCorners, type BoxAxis } from "./boxEdges";
// Not the npm package's loader: that one builds functions from strings,
// which the site's Content Security Policy blocks, and the engine would
// silently never start on a real deployment. See vendor/manifold/README.md.
import Module from "../../vendor/manifold/manifold.js";
import wasmUrl from "../../vendor/manifold/manifold.wasm?url";

// The boolean engine. Manifold guarantees watertight output: every result is
// an oriented 2-manifold, so an engraved plate exports as one closed skin
// instead of thousands of open seam edges that slicers flag as non-manifold.
//
// It is WebAssembly and loads asynchronously. Until it is ready — or if it
// never loads — evaluation falls back to three-bvh-csg, which produces the
// same shapes with a rougher surface topology. Components re-render when the
// engine arrives so early groups get re-cut.

let lib: ManifoldToplevel | null = null;
let status: EngineStatus = "loading";
const listeners = new Set<() => void>();

export type EngineStatus = "loading" | "ready" | "failed";

function settle(next: EngineStatus) {
  status = next;
  for (const l of listeners) l();
}

export const manifoldReady: Promise<boolean> = Module({ locateFile: () => wasmUrl })
  .then((m) => {
    m.setup();
    lib = m;
    settle("ready");
    return true;
  })
  .catch((err: unknown) => {
    console.warn("Manifold engine failed to load; booleans use three-bvh-csg", err);
    settle("failed");
    return false;
  });

export function manifoldLoaded(): boolean {
  return lib !== null;
}

export function engineStatus(): EngineStatus {
  return status;
}

/** Whether the engine is loading, ready, or failed to load. Re-renders on change. */
export function useEngineStatus(): EngineStatus {
  return useSyncExternalStore(subscribe, engineStatus, () => "loading" as const);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** True once the engine is loaded. Re-renders the caller when that happens. */
export function useManifoldLoaded(): boolean {
  return useSyncExternalStore(subscribe, manifoldLoaded, () => false);
}

// Edges bending more than this get a crease (split normals); anything gentler
// is shaded smooth. 48-segment cylinders bend 7.5° per facet, an octagon 45°.
const SMOOTH_ANGLE_DEG = 40;

/**
 * Converts a three.js geometry to a Manifold, welding the duplicate vertices
 * three keeps for per-face normals and UVs. Returns null if the mesh is not a
 * closed, consistently oriented solid (an imported scan with holes, a font
 * glyph whose outline crosses itself); callers fall back for that group.
 */
export function toManifold(geo: THREE.BufferGeometry): Manifold | null {
  if (!lib) return null;
  const pos = geo.getAttribute("position");
  if (!pos || pos.count < 3) return null;

  const n = pos.count;
  const vertProperties = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    vertProperties[i * 3] = pos.getX(i);
    vertProperties[i * 3 + 1] = pos.getY(i);
    vertProperties[i * 3 + 2] = pos.getZ(i);
  }
  const triVerts = geo.index
    ? Uint32Array.from(geo.index.array)
    : Uint32Array.from({ length: n }, (_, i) => i);

  const mesh = new lib.Mesh({ numProp: 3, vertProperties, triVerts });
  mesh.merge();
  try {
    const m = new lib.Manifold(mesh);
    if (m.status() !== "NoError" || m.isEmpty()) {
      m.delete();
      return null;
    }
    return m;
  } catch {
    return null;
  }
}

/**
 * Converts a Manifold to a geometry with crease-aware normals. The normals
 * are computed on the three.js side, not by Manifold's calculateNormals:
 * that call is instant on a sphere and took 34 seconds on a 711k-triangle
 * imported plate — an opened project that looked like it would never open.
 * three's version does the same job on that mesh in 150 ms.
 */
export function fromManifold(m: Manifold): THREE.BufferGeometry {
  const mesh = m.getMesh();
  const stride = mesh.numProp;
  const count = mesh.vertProperties.length / stride;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const base = i * stride;
    positions[i * 3] = mesh.vertProperties[base];
    positions[i * 3 + 1] = mesh.vertProperties[base + 1];
    positions[i * 3 + 2] = mesh.vertProperties[base + 2];
  }
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  indexed.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.triVerts), 1));
  const shaded = toCreasedNormals(indexed, THREE.MathUtils.degToRad(SMOOTH_ANGLE_DEG));
  indexed.dispose();
  return shaded;
}

/**
 * A boolean result is always manifold as the engine counts it, but where
 * shapes only touch — a ball tangent to a face, coplanar cutter faces — it
 * can leave two vertices at exactly the same position without joining them.
 * A slicer joins vertices by position, so it would count the edges there as
 * shared by three or four faces and call the part non-manifold. This welds
 * such vertices and rebuilds. Returns a new Manifold for the caller to free,
 * or null when there is nothing to weld (the common case, and cheap to
 * establish) or welding would not give a valid solid.
 */
function weldCoincident(m: Manifold): Manifold | null {
  if (!lib) return null;
  const mesh = m.getMesh();
  const stride = mesh.numProp;
  const vp = mesh.vertProperties;
  const count = vp.length / stride;
  const seen = new Set<string>();
  let duplicates = false;
  for (let i = 0; i < count; i++) {
    const k = `${vp[i * stride]},${vp[i * stride + 1]},${vp[i * stride + 2]}`;
    if (seen.has(k)) {
      duplicates = true;
      break;
    }
    seen.add(k);
  }
  if (!duplicates) return null;

  // Every triangle with its own corners, so merge() joins all by position.
  const tv = mesh.triVerts;
  const soup = new Float32Array(tv.length * 3);
  for (let i = 0; i < tv.length; i++) {
    const v = tv[i] * stride;
    soup[i * 3] = vp[v];
    soup[i * 3 + 1] = vp[v + 1];
    soup[i * 3 + 2] = vp[v + 2];
  }
  const welded = new lib.Mesh({
    numProp: 3,
    vertProperties: soup,
    triVerts: Uint32Array.from({ length: tv.length }, (_, i) => i),
  });
  welded.merge();
  try {
    const out = new lib.Manifold(welded);
    if (out.status() === "NoError" && !out.isEmpty()) return out;
    out.delete();
  } catch {
    /* not weldable into a solid; keep the original */
  }
  return null;
}

/**
 * Union of the solids minus the union of the holes, as one watertight
 * geometry. Null if any input is not a closed solid, so the caller can fall
 * back rather than lose the shape. Every WASM object is freed before return.
 */
export function cutGroup(
  solids: THREE.BufferGeometry[],
  holes: THREE.BufferGeometry[],
): THREE.BufferGeometry | null {
  if (!lib) return null;
  const owned: Manifold[] = [];
  try {
    // Each input is split into its connected pieces first. A shape that is
    // really two closed shells touching along a face is valid input but not a
    // valid result; as separate operands the union dissolves the seam.
    const pieces = (geo: THREE.BufferGeometry): Manifold[] | null => {
      const m = toManifold(geo);
      if (!m) return null;
      owned.push(m);
      const parts = m.decompose();
      owned.push(...parts);
      return parts;
    };
    const s: Manifold[] = [];
    const h: Manifold[] = [];
    for (const geo of solids) {
      const parts = pieces(geo);
      if (!parts) return null;
      s.push(...parts);
    }
    for (const geo of holes) {
      const parts = pieces(geo);
      if (!parts) return null;
      h.push(...parts);
    }
    const joined = lib.Manifold.union(s);
    owned.push(joined);
    const result = h.length ? lib.Manifold.difference([joined, ...h]) : joined;
    if (result !== joined) owned.push(result);
    if (result.status() !== "NoError") return null;
    const welded = weldCoincident(result);
    if (welded) owned.push(welded);
    return fromManifold(welded ?? result);
  } catch (err) {
    console.warn("Manifold boolean failed; falling back", err);
    return null;
  } finally {
    for (const m of owned) m.delete();
  }
}

// Position tolerance for deciding that a vertex sits on an extrusion's top or
// bottom plane — well under any printable feature, above float noise.
const LEVEL_EPS = 1e-4;

/**
 * If every vertex of the geometry lies on one of two z planes — a flat
 * extrusion like text, a sketch, or an imported SVG — returns those planes.
 */
function extrusionLevels(geo: THREE.BufferGeometry): [number, number] | null {
  const pos = geo.getAttribute("position");
  if (!pos || pos.count < 6) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z < lo) lo = z;
    if (z > hi) hi = z;
  }
  if (hi - lo < LEVEL_EPS * 10) return null;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z - lo > LEVEL_EPS && hi - z > LEVEL_EPS) return null;
  }
  return [lo, hi];
}

/**
 * Rebuilds a flat extrusion as a closed solid from its own cap triangles.
 * Font glyphs and SVG paths often carry outlines that overlap or touch
 * themselves; extruded directly they produce edges shared by four faces,
 * which no boolean engine or slicer accepts. Unioning the cap triangles in
 * 2D dissolves the overlaps into one clean outline, and extruding that back
 * to the same height gives the same shape, watertight. Null if the geometry
 * is not a flat extrusion or has no area.
 */
export function repairExtrusion(geo: THREE.BufferGeometry): THREE.BufferGeometry | null {
  if (!lib) return null;
  const levels = extrusionLevels(geo);
  if (!levels) return null;
  const [lo, hi] = levels;
  const pos = geo.getAttribute("position");
  const index = geo.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const vert = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);

  // Every cap triangle, top and bottom, as a counter-clockwise 2D polygon.
  const polys: [number, number][][] = [];
  for (let t = 0; t < triCount; t++) {
    const a = vert(t, 0);
    const b = vert(t, 1);
    const c = vert(t, 2);
    const za = pos.getZ(a);
    const zb = pos.getZ(b);
    const zc = pos.getZ(c);
    const onTop = hi - za < LEVEL_EPS && hi - zb < LEVEL_EPS && hi - zc < LEVEL_EPS;
    const onBottom = za - lo < LEVEL_EPS && zb - lo < LEVEL_EPS && zc - lo < LEVEL_EPS;
    if (!onTop && !onBottom) continue;
    const tri: [number, number][] = [
      [pos.getX(a), pos.getY(a)],
      [pos.getX(b), pos.getY(b)],
      [pos.getX(c), pos.getY(c)],
    ];
    const area2 =
      (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) -
      (tri[2][0] - tri[0][0]) * (tri[1][1] - tri[0][1]);
    if (Math.abs(area2) < 1e-10) continue;
    if (area2 < 0) tri.reverse();
    polys.push(tri);
  }
  if (!polys.length) return null;

  let outline: CrossSection | null = null;
  let solid: Manifold | null = null;
  let placed: Manifold | null = null;
  try {
    outline = new lib.CrossSection(polys, "NonZero");
    if (outline.isEmpty()) return null;
    solid = lib.Manifold.extrude(outline, hi - lo);
    placed = solid.translate([0, 0, lo]);
    if (placed.status() !== "NoError" || placed.isEmpty()) return null;
    return fromManifold(placed);
  } catch (err) {
    console.warn("Could not rebuild extrusion", err);
    return null;
  } finally {
    outline?.delete();
    solid?.delete();
    placed?.delete();
  }
}

/** True if every vertex sits on one of two z planes: text, a sketch, an
 *  imported SVG. A single pass over the positions, so cheap enough to ask
 *  about a scan before doing anything expensive with it. */
export function isFlatExtrusion(geo: THREE.BufferGeometry): boolean {
  return extrusionLevels(geo) !== null;
}

/** True if Manifold accepts the geometry as a closed, oriented solid. */
export function isClosedSolid(geo: THREE.BufferGeometry): boolean {
  const probe = toManifold(geo);
  if (!probe) return false;
  probe.delete();
  return true;
}

/**
 * The geometry as one clean solid, for exporting a shape on its own: a
 * closed mesh is passed through the engine so touching or nested pieces
 * are unioned into a single skin; a flat extrusion whose outline crosses
 * itself is rebuilt; anything else comes back unchanged.
 */
export function asClosedSolid(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!lib) return geo;
  return cutGroup([geo], []) ?? repairExtrusion(geo) ?? geo;
}

// ---- Box fillets ------------------------------------------------------------

// Built boxes are cached by size, radius and edge set: the same box is asked
// for by the viewport, every group containing it, the thumbnail and export.
const filletCache = new Map<string, THREE.BufferGeometry>();
const FILLET_CACHE_MAX = 64;

// For each edge axis, the two perpendicular axes in cyclic order, so that
// mapping 2D (x, y) and extrusion z onto them is a rotation, never a mirror.
const CYCLIC: Record<BoxAxis, [BoxAxis, BoxAxis]> = { 0: [1, 2], 1: [2, 0], 2: [0, 1] };

/** Column-major matrix sending x to axis p, y to axis q and z to axis a. */
function axisFrame(p: BoxAxis, q: BoxAxis, a: BoxAxis): Mat4 {
  const m = new Array(16).fill(0) as number[];
  m[p] = 1; // column 0: where x goes
  m[4 + q] = 1; // column 1: where y goes
  m[8 + a] = 1; // column 2: where z goes
  m[15] = 1;
  return m as Mat4;
}

/**
 * A box, centered on the origin, with the given edges rounded to radius r.
 * Each rounded edge is cut by a prism whose cross-section is the corner square
 * minus a quarter circle; where all three edges at a corner are rounded, a
 * cube-minus-ball cutter makes the corner spherical, as a fillet would be.
 * Where only two meet, their fillets intersect in a miter, as they do in CAD.
 *
 * Needs the engine; null until it has loaded, so callers show a sharp box
 * for that moment and rebuild when it arrives.
 */
export function filletedBox(
  size: [number, number, number],
  r: number,
  edges: readonly number[],
): THREE.BufferGeometry | null {
  if (!lib) return null;
  const key = `${size.join(",")}|${r}|${edges.join(",")}`;
  const hit = filletCache.get(key);
  if (hit) return hit.clone();

  const half = size.map((v) => v / 2) as [number, number, number];
  // Cutters overshoot the box so no cutter face lies exactly on a box face.
  const eps = Math.max(0.01, Math.min(...size) * 0.01);
  // A multiple of four puts polygon vertices exactly at the tangent points
  // with the flat faces, so the fillet meets them without a step. Finer for
  // bigger radii, where facets would show.
  const segments = 4 * Math.min(16, Math.max(4, Math.ceil(r * 2)));

  const owned: (Manifold | CrossSection)[] = [];
  const keep = <T extends Manifold | CrossSection>(x: T): T => {
    owned.push(x);
    return x;
  };
  try {
    const box = keep(lib.Manifold.cube(size, true));
    const cutters: Manifold[] = [];

    for (const id of edges) {
      const edge = BOX_EDGES[id];
      if (!edge) continue;
      const a = edge.axis;
      const [p, q] = CYCLIC[a];
      const sp = edgeSign(edge, p);
      const sq = edgeSign(edge, q);
      // The fillet's axis, inset r from both faces.
      const ip = sp * (half[p] - r);
      const iq = sq * (half[q] - r);
      const op = sp * (half[p] + eps);
      const oq = sq * (half[q] + eps);
      const square = keep(
        lib.CrossSection.square([Math.abs(op - ip), Math.abs(oq - iq)]).translate([
          Math.min(ip, op),
          Math.min(iq, oq),
        ]),
      );
      const circle = keep(lib.CrossSection.circle(r, segments).translate([ip, iq]));
      const section = keep(square.subtract(circle));
      const prism = keep(lib.Manifold.extrude(section, size[a] + 2 * eps, 0, 0, [1, 1], true));
      cutters.push(keep(prism.transform(axisFrame(p, q, a))));
    }

    for (const corner of fullyRoundedCorners(edges)) {
      const center = corner.map((s, i) => s * (half[i] - r)) as [number, number, number];
      const outer = corner.map((s, i) => s * (half[i] + eps));
      const lo = center.map((c, i) => Math.min(c, outer[i])) as [number, number, number];
      const cube = keep(lib.Manifold.cube([r + eps, r + eps, r + eps]).translate(lo));
      const ball = keep(lib.Manifold.sphere(r, segments).translate(center));
      cutters.push(keep(cube.subtract(ball)));
    }

    const result = cutters.length ? keep(lib.Manifold.difference([box, ...cutters])) : box;
    if (result.status() !== "NoError" || result.isEmpty()) return null;
    // Ball corners touch the faces tangentially, which is exactly the case
    // that leaves coincident vertices.
    const welded = weldCoincident(result);
    if (welded) keep(welded);
    const geo = fromManifold(welded ?? result);
    if (filletCache.size >= FILLET_CACHE_MAX) {
      const oldest = filletCache.keys().next().value;
      if (oldest !== undefined) {
        filletCache.get(oldest)?.dispose();
        filletCache.delete(oldest);
      }
    }
    filletCache.set(key, geo);
    return geo.clone();
  } catch (err) {
    console.warn("Could not build rounded box", err);
    return null;
  } finally {
    for (const x of owned) x.delete();
  }
}
