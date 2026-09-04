import { useSyncExternalStore } from "react";
import * as THREE from "three";
import Module, { type Manifold, type ManifoldToplevel } from "manifold-3d";
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
    const s: Manifold[] = [];
    const h: Manifold[] = [];
    for (const geo of solids) {
      const m = toManifold(geo);
      if (!m) return null;
      owned.push(m);
      s.push(m);
    }
    for (const geo of holes) {
      const m = toManifold(geo);
      if (!m) return null;
      owned.push(m);
      h.push(m);
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
