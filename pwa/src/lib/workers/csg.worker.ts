import * as THREE from "three";
import { cutGroupRims, manifoldReady } from "../manifold";
import type { RimSpec } from "../rounding/rims";

// The boolean engine, off the UI thread. A request carries the baked child
// geometries of one group as raw arrays, and for each hole whose rims can
// be treated, its rim spec; the reply is the cut result and where each such
// hole leaves the material, or a
// note that the engine is not available here and the caller should use its
// in-thread fallback. Arrays are transferred, not copied, in both directions.

interface RawGeo {
  pos: Float32Array;
  idx: Uint32Array | null;
}
interface Request {
  id: number;
  solids: RawGeo[];
  holes: RawGeo[];
  rims: (RimSpec | null)[];
}

const ctx = self as unknown as {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  onmessage: ((e: MessageEvent<Request>) => void) | null;
};

function toGeometry(raw: RawGeo): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(raw.pos, 3));
  if (raw.idx) geo.setIndex(new THREE.BufferAttribute(raw.idx, 1));
  return geo;
}

ctx.onmessage = async (e) => {
  const { id, solids, holes, rims } = e.data;
  if (!(await manifoldReady)) {
    ctx.postMessage({ id, fallback: true });
    return;
  }
  const cut = cutGroupRims(solids.map(toGeometry), holes.map(toGeometry), rims);
  if (!cut) {
    ctx.postMessage({ id, fallback: true });
    return;
  }
  const out = cut.geometry;
  const pos = out.getAttribute("position").array as Float32Array;
  const normal = out.getAttribute("normal")?.array as Float32Array | undefined;
  const idx = out.index ? (out.index.array as Uint32Array) : null;
  const transfer: Transferable[] = [pos.buffer];
  if (normal) transfer.push(normal.buffer);
  if (idx) transfer.push(idx.buffer);
  ctx.postMessage({ id, pos, normal, idx, exits: cut.exits }, transfer);
};
