import { useSyncExternalStore } from "react";
import * as THREE from "three";
import Module, { type CrossSection, type Manifold, type ManifoldToplevel } from "manifold-3d";
import wasmUrl from "manifold-3d/manifold.wasm?url";

// The boolean engine. Manifold guarantees watertight output: every result is
// an oriented 2-manifold, so an engraved plate exports as one closed skin
// instead of thousands of open seam edges that slicers flag as non-manifold.
//
// It is WebAssembly and loads asynchronously. Until it is ready — or if it
// never loads — evaluation falls back to three-bvh-csg, which produces the
// same shapes with a rougher surface topology. Components re-render when the
// engine arrives so early groups get re-cut.

let lib: ManifoldToplevel | null = null;
const listeners = new Set<() => void>();

export const manifoldReady: Promise<boolean> = Module({ locateFile: () => wasmUrl })
  .then((m) => {
    m.setup();
    lib = m;
    for (const l of listeners) l();
    return true;
  })
  .catch((err: unknown) => {
    console.warn("Manifold engine failed to load; booleans use three-bvh-csg", err);
    return false;
  });

export function manifoldLoaded(): boolean {
  return lib !== null;
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

/** Converts a Manifold to an indexed geometry with computed normals. */
export function fromManifold(m: Manifold): THREE.BufferGeometry {
  const shaded = m.calculateNormals(0, SMOOTH_ANGLE_DEG);
  const mesh = shaded.getMesh();
  shaded.delete();

  const stride = mesh.numProp;
  const count = mesh.vertProperties.length / stride;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const base = i * stride;
    positions[i * 3] = mesh.vertProperties[base];
    positions[i * 3 + 1] = mesh.vertProperties[base + 1];
    positions[i * 3 + 2] = mesh.vertProperties[base + 2];
    normals[i * 3] = mesh.vertProperties[base + 3];
    normals[i * 3 + 1] = mesh.vertProperties[base + 4];
    normals[i * 3 + 2] = mesh.vertProperties[base + 5];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.triVerts), 1));
  return geo;
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
    return fromManifold(result);
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
