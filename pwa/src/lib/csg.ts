import * as THREE from "three";
import { Brush, Evaluator, ADDITION, SUBTRACTION } from "three-bvh-csg";
import type { GroupNode, Project, ShapeNode } from "../types/scene";
import { isGroup, nodeRole } from "../types/scene";
import { buildGeometry } from "./primitives";
import { bakeTransform, composeMatrix } from "./transform";
import {
  cutGroup,
  isClosedSolid,
  isFlatExtrusion,
  manifoldLoaded,
  repairExtrusion,
} from "./manifold";

// Two engines. Manifold (WebAssembly, loaded asynchronously) is the real one:
// its output is always a closed, consistently oriented skin, which is what a
// slicer needs. three-bvh-csg covers two cases Manifold cannot — inputs that
// are not themselves closed solids (a scanned mesh with holes, a font glyph
// whose outline crosses itself), and the moment before the WASM arrives.
const evaluator = new Evaluator();
evaluator.attributes = ["position", "normal"];

// three-bvh-csg leaves two kinds of trash in its output:
// stale vertices beyond drawRange (it reuses oversized buffers)
// and degenerate sliver triangles along cut planes — invisible, but they
// stretch the bounding box, so drop-to-workplane, align, measure, and
// placement all see a phantom extent where removed material used to be.
// Rebuild the result keeping only real triangles in exactly-sized buffers.
const MIN_TRIANGLE_AREA = 1e-4; // mm² — far below anything visible/printable

function compactEvaluated(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.getAttribute("position");
  if (!pos) return geo;
  const total = geo.index ? geo.index.count : pos.count;
  const start = geo.drawRange.start;
  const end =
    geo.drawRange.count === Infinity ? total : Math.min(start + geo.drawRange.count, total);
  const normal = geo.getAttribute("normal");
  const maxVerts = end - start;
  const outPos = new Float32Array(maxVerts * 3);
  const outNorm = normal ? new Float32Array(maxVerts * 3) : null;
  let w = 0; // vertices written
  const p = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = start; i + 2 < end; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = geo.index ? geo.index.getX(i + k) : i + k;
      p[k * 3] = pos.getX(v);
      p[k * 3 + 1] = pos.getY(v);
      p[k * 3 + 2] = pos.getZ(v);
    }
    const ux = p[3] - p[0];
    const uy = p[4] - p[1];
    const uz = p[5] - p[2];
    const vx = p[6] - p[0];
    const vy = p[7] - p[1];
    const vz = p[8] - p[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (0.5 * Math.hypot(nx, ny, nz) < MIN_TRIANGLE_AREA) continue; // sliver
    for (let k = 0; k < 3; k++) {
      const v = geo.index ? geo.index.getX(i + k) : i + k;
      outPos[w * 3] = p[k * 3];
      outPos[w * 3 + 1] = p[k * 3 + 1];
      outPos[w * 3 + 2] = p[k * 3 + 2];
      if (outNorm && normal) {
        outNorm[w * 3] = normal.getX(v);
        outNorm[w * 3 + 1] = normal.getY(v);
        outNorm[w * 3 + 2] = normal.getZ(v);
      }
      w++;
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(outPos.subarray(0, w * 3), 3));
  if (outNorm) out.setAttribute("normal", new THREE.BufferAttribute(outNorm.subarray(0, w * 3), 3));
  return out;
}

// Evaluates a group per the Tinkercad rule: union of solid children minus the
// union of hole children. Nested groups evaluate innermost-first; a nested
// group counts as a solid unless nothing inside it is solid, in which case it
// is a hole group and cuts. A hole group on its own evaluates to the union of
// its holes, so it can be seen, moved and measured as one shape. The result
// is in the group's local space (children keep their own transforms; the
// group's transform is applied at render/export). Null when empty.
export function evaluateGroup(
  group: GroupNode,
  nodes: Project["nodes"],
): THREE.BufferGeometry | null {
  const solids: THREE.BufferGeometry[] = [];
  const holes: THREE.BufferGeometry[] = [];

  for (const childId of group.childIds) {
    const child = nodes[childId];
    if (!child) continue;

    let geo: THREE.BufferGeometry | null;
    let role: "solid" | "hole";
    if (isGroup(child)) {
      geo = evaluateGroup(child, nodes);
      role = nodeRole(child, nodes);
    } else {
      geo = buildGeometry(child);
      role = child.role;
      // A glyph or SVG outline that overlaps itself is not a closed solid.
      // Rebuilt here, in its own flat frame, before the transform bakes in.
      // Only flat extrusions can be rebuilt, so only they are probed: the
      // probe is a full conversion, a second per 700k triangles, and a scan
      // would pay it here and again in the cut for nothing.
      if (geo && manifoldLoaded() && isFlatExtrusion(geo) && !isClosedSolid(geo)) {
        geo = repairExtrusion(geo) ?? geo;
      }
    }
    if (!geo) continue;

    // Bake the child's full transform (including non-uniform or mirrored
    // scale) into the geometry so the boolean runs on clean world-space meshes.
    const baked = bakeTransform(
      geo,
      composeMatrix(child.position, child.rotation, child.scale),
    );
    (role === "solid" ? solids : holes).push(baked);
  }

  // Nothing solid: a hole group. Its shape is the union of its holes.
  const [add, cut] = solids.length ? [solids, holes] : [holes, []];
  if (!add.length) return null;
  if (manifoldLoaded()) {
    const clean = cutGroup(add, cut);
    if (clean) return clean;
  }
  return cutGroupBvh(add, cut);
}

function cutGroupBvh(
  solids: THREE.BufferGeometry[],
  holes: THREE.BufferGeometry[],
): THREE.BufferGeometry {
  const brushOf = (geo: THREE.BufferGeometry) => {
    const brush = new Brush(geo);
    brush.updateMatrixWorld();
    return brush;
  };
  let solid = brushOf(solids[0]);
  for (const geo of solids.slice(1)) {
    solid = evaluator.evaluate(solid, brushOf(geo), ADDITION);
  }
  for (const geo of holes) {
    solid = evaluator.evaluate(solid, brushOf(geo), SUBTRACTION);
  }
  return compactEvaluated(solid.geometry);
}

// Every distinct params object gets a small number the first time it is
// seen. Params are replaced, never mutated, so the number stands in for
// their content — without serializing them, which for an imported mesh means
// tens of megabytes of base64 on every store update.
const paramsIds = new WeakMap<object, number>();
let nextParamsId = 1;
function paramsId(params: object): number {
  let id = paramsIds.get(params);
  if (id === undefined) {
    id = nextParamsId++;
    paramsIds.set(params, id);
  }
  return id;
}

// Signature of everything that affects a group's evaluated geometry. The
// group's own transform is deliberately excluded so moving a group never
// re-runs the boolean, and so are colour, lock, transparency and visibility,
// which change how a group is drawn but not its shape. Cheap enough to run
// as a store selector: it is evaluated on every store update.
export function subtreeSignature(group: GroupNode, nodes: Project["nodes"]): string {
  const parts: string[] = [group.childIds.join(",")];
  const visit = (id: string) => {
    const n = nodes[id];
    if (!n) return;
    parts.push(id, n.position.join(","), n.rotation.join(","), n.scale.join(","));
    if (isGroup(n)) {
      parts.push(n.childIds.join(","));
      n.childIds.forEach(visit);
    } else {
      parts.push(n.kind, n.role, String(paramsId(n.params)));
    }
  };
  group.childIds.forEach(visit);
  return parts.join("|");
}

export function firstSolidColor(group: GroupNode, nodes: Project["nodes"]): string {
  return findSolidColor(group, nodes) ?? "#b0b0b0";
}

// Null while searching: a nested group with no solid in it must not answer
// with the fallback grey and stop the search short of a solid sibling.
function findSolidColor(group: GroupNode, nodes: Project["nodes"]): string | null {
  for (const childId of group.childIds) {
    const child = nodes[childId];
    if (!child) continue;
    if (isGroup(child)) {
      const c = findSolidColor(child, nodes);
      if (c) return c;
    } else if ((child as ShapeNode).role === "solid") {
      return (child as ShapeNode).color;
    }
  }
  return null;
}
