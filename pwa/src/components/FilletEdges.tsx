import { useEffect, useMemo, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { MeshBVH } from "three-mesh-bvh";
import { useScene } from "../state/store";
import { isGroup, type Project, type ShapeNode } from "../types/scene";
import { roundingSpec } from "../lib/primitives";
import { parsePicks, pickEdges, roundFamily, type PickEdge } from "../lib/rounding";
import { composeMatrix } from "../lib/transform";
import { gizmoState } from "../lib/gizmoState";
import { useCoarsePointer } from "../lib/pointer";
import { useManifoldLoaded } from "../lib/manifold";

// The rounding tool. While it is on, every line in the scene that can be
// rounded is drawn over the shapes: blue when square, amber when rounded.
// Hover one and it lights up; click it and that edge is rounded at the
// tool's radius, or squared again. Shapes inside a group count too — a
// group is rebuilt from its parts, so rounding a part's edge and re-cutting
// is how a grouped edge gets rounded. Only lines that still lie on the
// group's surface are offered, so edges a cut has swallowed don't float in
// the air. Lines created by a cut itself (the rim of a drilled hole) belong
// to no shape and are not offered.

const SQUARE = "#2563eb";
const ROUNDED = "#f59e0b";

/** A shape the tool can reach, and where it sits in the world. */
interface Leaf {
  node: ShapeNode;
  world: THREE.Matrix4;
  /** The top-level node to select when one of its edges is clicked. */
  owner: string;
  /** For a part of a group: the group, and the part's frame inside it. */
  within: { groupId: string; frame: THREE.Matrix4 } | null;
}

function matrixOf(n: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }) {
  return composeMatrix(n.position, n.rotation, n.scale);
}

function collectLeaves(nodes: Project["nodes"], rootOrder: string[], editingId: string | null): Leaf[] {
  const out: Leaf[] = [];
  const walk = (
    id: string,
    world: THREE.Matrix4,
    frame: THREE.Matrix4,
    owner: string,
    groupId: string,
  ) => {
    const n = nodes[id];
    if (!n || n.hidden || n.locked) return;
    const m = matrixOf(n);
    const w = world.clone().multiply(m);
    const f = frame.clone().multiply(m);
    if (isGroup(n)) for (const c of n.childIds) walk(c, w, f, owner, groupId);
    else out.push({ node: n, world: w, owner, within: { groupId, frame: f } });
  };
  // A group rendered as one solid: its parts, checked against its surface.
  const intoGroup = (groupId: string, world: THREE.Matrix4, owner: string) => {
    const g = nodes[groupId];
    if (!g || !isGroup(g)) return;
    for (const c of g.childIds) walk(c, world, new THREE.Matrix4(), owner, groupId);
  };
  const editing = editingId ? nodes[editingId] : undefined;
  if (editing && isGroup(editing)) {
    // Editing in place: the group's own children are drawn one by one.
    const gm = matrixOf(editing);
    for (const cid of editing.childIds) {
      const c = nodes[cid];
      if (!c || c.hidden || c.locked) continue;
      const cm = gm.clone().multiply(matrixOf(c));
      if (isGroup(c)) intoGroup(cid, cm, editing.id);
      else out.push({ node: c, world: cm, owner: editing.id, within: null });
    }
    return out;
  }
  for (const id of rootOrder) {
    const n = nodes[id];
    if (!n || n.hidden || n.locked) continue;
    if (isGroup(n)) intoGroup(id, matrixOf(n), id);
    else out.push({ node: n, world: matrixOf(n), owner: id, within: null });
  }
  return out;
}

// Search structures for group surfaces, built once per evaluated geometry.
const bvhs = new WeakMap<THREE.BufferGeometry, MeshBVH>();
function bvhFor(geo: THREE.BufferGeometry): MeshBVH {
  let bvh = bvhs.get(geo);
  if (!bvh) {
    // A view of the positions: the BVH may add or reorder an index, and the
    // rendered geometry should not change under it.
    const view = new THREE.BufferGeometry();
    view.setAttribute("position", geo.getAttribute("position"));
    if (geo.index) view.setIndex(geo.index.clone());
    bvh = new MeshBVH(view);
    bvhs.set(geo, bvh);
  }
  return bvh;
}

// A part's line is drawn only where it lies on the group's surface: a hole
// box standing proud of a plate leaves just the bottom of its upright edges
// as the pocket's corners, and the rest would float in the air. Each line is
// cut into short pieces and each piece kept if its middle is on the surface.
// A rounded edge's original line sits off the new curve by up to ~0.41 of
// its radius, so it is allowed that much.
const PIECES_PER_EDGE = 24;

function clipToSurface(
  edge: PickEdge,
  frame: THREE.Matrix4,
  bvh: MeshBVH,
  tolerance: number,
): PickEdge | null {
  const pts = edge.points;
  let total = 0;
  for (let i = 0; i < pts.length; i += 6) {
    total += Math.hypot(pts[i + 3] - pts[i], pts[i + 4] - pts[i + 1], pts[i + 5] - pts[i + 2]);
  }
  if (total <= 0) return null;
  const step = Math.max(total / PIECES_PER_EDGE, 0.25);
  const kept: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  for (let i = 0; i < pts.length; i += 6) {
    a.set(pts[i], pts[i + 1], pts[i + 2]);
    b.set(pts[i + 3], pts[i + 4], pts[i + 5]);
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let k = 0; k < n; k++) {
      const p0 = a.clone().lerp(b, k / n);
      const p1 = a.clone().lerp(b, (k + 1) / n);
      mid.addVectors(p0, p1).multiplyScalar(0.5).applyMatrix4(frame);
      const r = bvh.closestPointToPoint(mid, hit);
      if (r && r.distance <= tolerance) kept.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
    }
  }
  return kept.length ? { id: edge.id, points: kept } : null;
}

interface LineSet {
  object: LineSegments2;
  /** Per drawn segment, the edge it belongs to. */
  edgeIds: string[];
  leafId: string;
  owner: string;
  /** Segment positions per edge, world space, for the hover highlight. */
  segments: Map<string, number[]>;
}

function lineSet(
  leaf: Leaf,
  edges: PickEdge[],
  material: LineMaterial,
  segments: Map<string, number[]>,
): LineSet | null {
  if (!edges.length) return null;
  const positions: number[] = [];
  const edgeIds: string[] = [];
  const v = new THREE.Vector3();
  for (const e of edges) {
    const world: number[] = [];
    for (let i = 0; i < e.points.length; i += 3) {
      v.set(e.points[i], e.points[i + 1], e.points[i + 2]).applyMatrix4(leaf.world);
      world.push(v.x, v.y, v.z);
    }
    positions.push(...world);
    segments.set(e.id, world);
    for (let s = 0; s < e.points.length / 6; s++) edgeIds.push(e.id);
  }
  const geo = new LineSegmentsGeometry();
  geo.setPositions(positions);
  const object = new LineSegments2(geo, material);
  object.renderOrder = 997;
  object.userData = { filletLine: true };
  return { object, edgeIds, leafId: leaf.node.id, owner: leaf.owner, segments };
}

type Hover = { leafId: string; edge: string; owner: string } | null;

export function FilletEdges() {
  const filletMode = useScene((s) => s.filletMode);
  const nodes = useScene((s) => s.project.nodes);
  const rootOrder = useScene((s) => s.project.rootOrder);
  const editingId = useScene((s) => s.editingGroupId);
  const toggleEdge = useScene((s) => s.toggleEdge);
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  const raycaster = useThree((s) => s.raycaster);
  const engineReady = useManifoldLoaded();
  const coarse = useCoarsePointer();

  const materials = useMemo(
    () => ({
      square: new LineMaterial({ color: SQUARE, linewidth: 3, transparent: true, opacity: 0.85 }),
      rounded: new LineMaterial({ color: ROUNDED, linewidth: 3.5, transparent: true, opacity: 0.95 }),
      hover: new LineMaterial({ color: ROUNDED, linewidth: 6, transparent: true, opacity: 1 }),
    }),
    [],
  );
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);
  useEffect(() => {
    const k = coarse ? 1.6 : 1;
    materials.square.linewidth = 3 * k;
    materials.rounded.linewidth = 3.5 * k;
    materials.hover.linewidth = 6 * k;
    // How close, in pixels, the pointer must come to a line to pick it.
    raycaster.params.Line2 = { threshold: coarse ? 18 : 8 };
  }, [coarse, materials, raycaster]);

  // Built after each commit, so group meshes already hold their new shape
  // when the surface check reads them.
  const [sets, setSets] = useState<LineSet[]>([]);
  useEffect(() => {
    if (!filletMode) {
      setSets([]);
      return;
    }
    const next: LineSet[] = [];
    for (const leaf of collectLeaves(nodes, rootOrder, editingId)) {
      if (!roundFamily(leaf.node.kind)) continue;
      const spec = roundingSpec(leaf.node);
      if (!spec) continue;
      const picks = parsePicks(leaf.node.kind, leaf.node.params);
      let edges = pickEdges(spec);
      if (leaf.within) {
        const mesh = scene.getObjectByName(leaf.within.groupId) as THREE.Mesh | undefined;
        const bvh = mesh?.geometry ? bvhFor(mesh.geometry) : null;
        const frame = leaf.within.frame;
        if (bvh) {
          edges = edges
            .map((e) => clipToSurface(e, frame, bvh, 0.05 + 0.45 * (picks.get(e.id) ?? 0)))
            .filter((e): e is PickEdge => e !== null);
        }
      }
      const segments = new Map<string, number[]>();
      const square = lineSet(leaf, edges.filter((e) => !picks.has(e.id)), materials.square, segments);
      const rounded = lineSet(leaf, edges.filter((e) => picks.has(e.id)), materials.rounded, segments);
      if (square) next.push(square);
      if (rounded) next.push(rounded);
    }
    setSets(next);
    return () => {
      for (const s of next) s.object.geometry.dispose();
    };
  }, [filletMode, nodes, rootOrder, editingId, engineReady, scene, materials]);

  const [hover, setHover] = useState<Hover>(null);
  useEffect(() => {
    if (!filletMode) setHover(null);
  }, [filletMode]);
  useEffect(() => {
    document.body.style.cursor = hover ? "pointer" : "";
    gizmoState.handleActive = !!hover;
    return () => {
      document.body.style.cursor = "";
    };
  }, [hover]);

  const hoverObject = useMemo(() => {
    if (!hover) return null;
    const set = sets.find((s) => s.leafId === hover.leafId && s.segments.has(hover.edge));
    const pts = set?.segments.get(hover.edge);
    if (!pts) return null;
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pts);
    const object = new LineSegments2(geo, materials.hover);
    object.renderOrder = 999;
    object.raycast = () => {};
    return object;
  }, [hover, sets, materials]);
  useEffect(() => () => hoverObject?.geometry.dispose(), [hoverObject]);

  useFrame(() => {
    for (const m of Object.values(materials)) m.resolution.set(size.width, size.height);
  });

  // Development only: lets tests find an edge on screen to click.
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __fillet?: unknown }).__fillet = { sets, camera, hover };
  }, [sets, camera, hover]);

  if (!filletMode) return null;

  // The nearest line under the pointer, unless a surface is in front of it.
  const pickAt = (e: ThreeEvent<PointerEvent | MouseEvent>): Hover => {
    let surface = Infinity;
    for (const i of e.intersections) {
      if (i.object.userData?.nodeId !== undefined) {
        surface = i.distance;
        break;
      }
    }
    for (const i of e.intersections) {
      if (!i.object.userData?.filletLine) continue;
      if (i.distance > surface + Math.max(0.3, i.distance * 0.006)) return null;
      const set = sets.find((s) => s.object === i.object);
      const edge = set?.edgeIds[i.faceIndex ?? -1];
      if (set && edge) return { leafId: set.leafId, edge, owner: set.owner };
    }
    return null;
  };

  return (
    <>
      {sets.map((s) => (
        <primitive
          key={s.object.uuid}
          object={s.object}
          onPointerMove={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            const h = pickAt(e);
            if (h?.leafId !== hover?.leafId || h?.edge !== hover?.edge) setHover(h);
          }}
          onPointerOut={() => setHover(null)}
          onClick={(e: ThreeEvent<MouseEvent>) => {
            e.stopPropagation();
            const h = pickAt(e);
            if (!h) return;
            toggleEdge(h.leafId, h.edge);
            useScene.getState().setSelection([h.owner]);
          }}
        />
      ))}
      {hoverObject && <primitive object={hoverObject} />}
    </>
  );
}
