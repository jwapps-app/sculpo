import * as THREE from "three";
import type { GroupNode, Project } from "../types/scene";
import { isGroup, nodeRole } from "../types/scene";
import { bakeChild, cutGroupBvh, prepareChild, subtreeSignature } from "./csg";
import { manifoldLoaded } from "./manifold";

// Group evaluation off the UI thread. The children are prepared here (cheap:
// primitives, and the transforms baked in) and the boolean — the part that
// takes seconds on a big imported mesh and used to freeze the page — runs in
// a worker. Results are cached by the group's geometry signature, so the
// viewport, the export and a re-render after a colour change all share one
// evaluation.

interface RawGeo {
  pos: Float32Array;
  idx: Uint32Array | null;
}

const CACHE_MAX = 32;
const cache = new Map<string, THREE.BufferGeometry | null>();
const inFlight = new Map<string, Promise<THREE.BufferGeometry | null>>();

function remember(signature: string, geo: THREE.BufferGeometry | null) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.get(oldest)?.dispose();
      cache.delete(oldest);
    }
  }
  cache.set(signature, geo);
}

/** The evaluated geometry if this group has been evaluated already, else null.
 *  A clone: the caller owns what it gets and may dispose it. */
export function peekEvaluated(group: GroupNode, nodes: Project["nodes"]): THREE.BufferGeometry | null | undefined {
  const hit = cache.get(subtreeSignature(group, nodes));
  return hit === undefined ? undefined : hit ? hit.clone() : null;
}

// ---- The worker ---------------------------------------------------------------

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, (reply: Reply) => void>();

interface Reply {
  id: number;
  fallback?: boolean;
  pos?: Float32Array;
  normal?: Float32Array;
  idx?: Uint32Array | null;
}

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./workers/csg.worker.ts", import.meta.url), { type: "module" });
  } catch (err) {
    console.warn("No worker for booleans; cutting on the UI thread", err);
    workerBroken = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const done = pending.get(e.data.id);
    pending.delete(e.data.id);
    done?.(e.data);
  };
  worker.onerror = (err) => {
    console.warn("Boolean worker failed; cutting on the UI thread", err);
    workerBroken = true;
    for (const done of pending.values()) done({ id: 0, fallback: true });
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function raw(geo: THREE.BufferGeometry): RawGeo {
  // Copies, so the geometry the caller keeps is not detached by the transfer.
  const pos = new Float32Array(geo.getAttribute("position").array as Float32Array);
  const idx = geo.index ? new Uint32Array(geo.index.array as ArrayLike<number>) : null;
  return { pos, idx };
}

function cutInWorker(solids: THREE.BufferGeometry[], holes: THREE.BufferGeometry[]): Promise<THREE.BufferGeometry | null> {
  const w = getWorker();
  if (!w) return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = nextId++;
    const s = solids.map(raw);
    const h = holes.map(raw);
    const transfer: Transferable[] = [];
    for (const g of [...s, ...h]) {
      transfer.push(g.pos.buffer);
      if (g.idx) transfer.push(g.idx.buffer);
    }
    pending.set(id, (reply) => {
      if (reply.fallback || !reply.pos) {
        resolve(null);
        return;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(reply.pos, 3));
      if (reply.normal) geo.setAttribute("normal", new THREE.BufferAttribute(reply.normal, 3));
      if (reply.idx) geo.setIndex(new THREE.BufferAttribute(reply.idx, 1));
      resolve(geo);
    });
    w.postMessage({ id, solids: s, holes: h }, transfer);
  });
}

// ---- Evaluation --------------------------------------------------------------

/**
 * The group's evaluated solid, computed off the UI thread where possible.
 * Same result as evaluateGroup(); the boolean runs in a worker and the
 * in-thread fallback covers a worker that could not start or an input the
 * engine refuses. Concurrent calls for the same group share one evaluation.
 */
export function evaluateGroupAsync(group: GroupNode, nodes: Project["nodes"]): Promise<THREE.BufferGeometry | null> {
  const signature = subtreeSignature(group, nodes);
  const hit = cache.get(signature);
  if (hit !== undefined) return Promise.resolve(hit ? hit.clone() : null);
  const running = inFlight.get(signature);
  if (running) return running.then((g) => (g ? g.clone() : null));
  const job = (async () => {
    const solids: THREE.BufferGeometry[] = [];
    const holes: THREE.BufferGeometry[] = [];
    for (const childId of group.childIds) {
      const child = nodes[childId];
      if (!child) continue;
      let geo: THREE.BufferGeometry | null;
      let role: "solid" | "hole";
      if (isGroup(child)) {
        geo = await evaluateGroupAsync(child, nodes);
        role = nodeRole(child, nodes);
      } else {
        const prepared = prepareChild(child);
        geo = prepared.geo;
        role = prepared.role;
      }
      if (!geo) continue;
      (role === "solid" ? solids : holes).push(bakeChild(child, geo));
    }
    const [add, cut] = solids.length ? [solids, holes] : [holes, []];
    let result: THREE.BufferGeometry | null = null;
    if (add.length) {
      result = manifoldLoaded() || getWorker() ? await cutInWorker(add, cut) : null;
      if (!result) {
        try {
          result = cutGroupBvh(add, cut);
        } catch (err) {
          console.warn("Group evaluation failed", err);
          result = null;
        }
      }
    }
    remember(signature, result);
    return result;
  })();
  inFlight.set(signature, job);
  job.catch(() => {}).finally(() => inFlight.delete(signature));
  return job.then((g) => (g ? g.clone() : null));
}

declare global {
  interface Window {
    __csgAsync?: { stats: () => Record<string, unknown> };
  }
}
if (import.meta.env.DEV) {
  window.__csgAsync = {
    stats: () => ({ workerBroken, hasWorker: !!worker, pending: pending.size, inFlight: inFlight.size, cached: cache.size }),
  };
}
