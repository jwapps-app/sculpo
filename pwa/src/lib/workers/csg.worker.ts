import * as THREE from "three";
import { cutGroup, manifoldReady } from "../manifold";

// The boolean engine, off the UI thread. A request carries the baked child
// geometries of one group as raw arrays; the reply is the cut result, or a
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
  const { id, solids, holes } = e.data;
  if (!(await manifoldReady)) {
    ctx.postMessage({ id, fallback: true });
    return;
  }
  const out = cutGroup(solids.map(toGeometry), holes.map(toGeometry));
  if (!out) {
    ctx.postMessage({ id, fallback: true });
    return;
  }
  const pos = out.getAttribute("position").array as Float32Array;
  const normal = out.getAttribute("normal")?.array as Float32Array | undefined;
  const idx = out.index ? (out.index.array as Uint32Array) : null;
  const transfer: Transferable[] = [pos.buffer];
  if (normal) transfer.push(normal.buffer);
  if (idx) transfer.push(idx.buffer);
  ctx.postMessage({ id, pos, normal, idx }, transfer);
};
