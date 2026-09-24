import { create } from "zustand";
import { temporal } from "zundo";
import * as THREE from "three";
import type { GroupNode, PrimitiveKind, Project, SceneNode, ShapeNode, Vec3 } from "../types/scene";
import { emptyProject, isGroup } from "../types/scene";
import { bottomOffset, footprint, makeShape } from "../lib/primitives";
import { newId } from "../lib/id";
import { composeMatrix, decomposeMatrix } from "../lib/transform";
import { workplaneNormal, type Workplane } from "../lib/workplane";
import { sceneApi } from "../lib/sceneApi";
import { planAlign } from "../lib/align";
import {
  DEFAULT_FILLET_RADIUS,
  formatEdges,
  maxFilletRadius,
  roundedEdges,
} from "../lib/boxEdges";
import { DEFAULT_STEP, type Units } from "../lib/units";

export type TransformMode = "translate" | "rotate" | "scale";

const CLIPBOARD_KEY = "clipboard";
export type AlignMode = "min" | "center" | "max";
export type Axis = 0 | 1 | 2;

export interface Placement {
  position: Vec3; // point on the workplane the shape rests on
  rotation: Vec3;
}

interface TransformEntry {
  id: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

function collectSubtree(id: string, nodes: Project["nodes"], acc: Set<string>) {
  const node = nodes[id];
  if (!node || acc.has(id)) return;
  acc.add(id);
  if (isGroup(node)) node.childIds.forEach((c) => collectSubtree(c, nodes, acc));
}

// A box's size lives in its w/d/h params, not in its scale: rounded edges are
// built at a fixed radius in millimetres, and a scaled box would stretch them
// into ovals. Every path that can leave a box scaled — resize handles, the
// gizmo, the Size row, the Scale fields, mirror, ungroup — passes the node
// through here, which moves the scale into the dimensions. The box looks the
// same; its rounding stays round. A mirror's sign stays in the scale.
function foldBoxScale<T extends SceneNode>(node: T): T {
  if (isGroup(node) || node.kind !== "box") return node;
  const mags = node.scale.map(Math.abs);
  if (mags.every((m) => Math.abs(m - 1) < 1e-6)) return node;
  const p = node.params;
  const dim = (key: string, fallback: number) =>
    typeof p[key] === "number" && Number.isFinite(p[key]) ? (p[key] as number) : fallback;
  return {
    ...node,
    params: {
      ...p,
      w: dim("w", 20) * mags[0],
      d: dim("d", 20) * mags[1],
      h: dim("h", 20) * mags[2],
    },
    scale: node.scale.map((v) => (v < 0 ? -1 : 1)) as Vec3,
  };
}

function cloneSubtree(
  id: string,
  nodes: Project["nodes"],
  out: Record<string, SceneNode>,
): string | null {
  const node = nodes[id];
  if (!node) return null;
  const cloned = structuredClone(node);
  cloned.id = newId();
  if (isGroup(cloned)) {
    cloned.childIds = (node as GroupNode).childIds
      .map((c) => cloneSubtree(c, nodes, out))
      .filter((c): c is string => c !== null);
  }
  out[cloned.id] = cloned;
  return cloned.id;
}

// Spiral outward from the origin until the shape's footprint doesn't overlap
// any existing object — new shapes must never land on top of existing work.
function findFreeSpot(halfW: number, halfD: number, ids: string[]): [number, number] {
  const margin = 5;
  const boxes: THREE.Box3[] = [];
  for (const id of ids) {
    const b = sceneApi.getNodeBounds(id);
    if (b) boxes.push(b);
  }
  const clear = (x: number, y: number) =>
    boxes.every(
      (b) =>
        x + halfW + margin <= b.min.x ||
        x - halfW - margin >= b.max.x ||
        y + halfD + margin <= b.min.y ||
        y - halfD - margin >= b.max.y,
    );
  if (clear(0, 0)) return [0, 0];
  const step = Math.max(halfW, halfD) * 2 + 10;
  for (let ring = 1; ring <= 6; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const x = i * step;
        const y = j * step;
        if (clear(x, y)) return [x, y];
      }
    }
  }
  return [0, 0];
}

// Min/center/max of a world AABB along one axis.
// Creation transforms of the last duplicate, keyed by copy id — pressing
// duplicate again with those copies still selected repeats the delta the user
// applied to them (Tinkercad's pattern-making duplicate).
interface SmartDup {
  transforms: Record<string, { position: Vec3; rotation: Vec3; scale: Vec3 }>;
}

interface SceneState {
  project: Project;
  selection: string[];
  transformMode: TransformMode;
  snap: boolean;
  snapStep: number;
  units: Units;
  // Build-plate footprint in mm, or null for an unbounded workplane.
  bed: [number, number] | null;
  workplane: Workplane | null;
  workplaneArmed: boolean;
  dragInfo: string | null;
  editingGroupId: string | null;
  ortho: boolean;
  smartDup: SmartDup | null;
  cruiseMode: boolean;
  placing: PrimitiveKind | null;
  alignMode: boolean;
  // Shapes the others align to while align mode is on. Empty means the whole
  // selection is the reference.
  alignAnchors: string[];
  // Click-to-round: edges of the selected box become clickable.
  filletMode: boolean;
  measureMode: boolean;
  // Ruler datum on the workplane: while set, the selection shows persistent
  // dimensions and its offset from this origin. null = ruler off.
  rulerOrigin: [number, number] | null;
  rulerPlacing: boolean;
  // Which sketch tool dialog is open, if any; sketchEditId points at an
  // existing node being re-edited (null = creating a new shape).
  sketchMode: "scribble" | "extrude" | "revolve" | null;
  sketchEditId: string | null;
  // Server id of the currently open project, when it came from the cloud.
  cloudProjectId: string | null;

  addShape: (kind: PrimitiveKind, placement?: Placement) => void;
  placeShapeAt: (kind: PrimitiveKind, position: Vec3, rotation: Vec3) => void;
  setPlacing: (kind: PrimitiveKind | null) => void;
  setAlignMode: (on: boolean) => void;
  // Plain click: make this the only anchor, or clear it if it already is.
  // Additive (shift): toggle it in the anchor set.
  toggleAlignAnchor: (id: string, additive: boolean) => void;
  setFilletMode: (on: boolean) => void;
  // Rounds the edge if it is square, squares it if it is rounded.
  toggleBoxEdge: (id: string, edge: number) => void;
  setBoxEdges: (id: string, edges: number[]) => void;
  setMeasureMode: (on: boolean) => void;
  toggleRuler: () => void;
  setRulerOrigin: (origin: [number, number] | null) => void;
  // Move the selection so its min corner sits at an exact offset from the
  // ruler origin along one axis.
  setOffsetFromRuler: (axis: 0 | 1 | 2, value: number) => void;
  setSketchMode: (mode: "scribble" | "extrude" | "revolve" | null) => void;
  editSketch: (id: string) => void;
  addShapeWithParams: (kind: PrimitiveKind, params: Record<string, number | string>) => void;
  setCloudProjectId: (id: string | null) => void;
  addImportedMesh: (params: Record<string, string>, name: string) => void;
  updateShape: (id: string, patch: Partial<Omit<ShapeNode, "id" | "kind">>) => void;
  setTransform: (id: string, position: Vec3, rotation: Vec3, scale: Vec3) => void;
  setTransforms: (entries: TransformEntry[]) => void;
  translateSelected: (delta: Vec3) => void;
  alignSelected: (axis: Axis, mode: AlignMode) => void;
  mirrorSelected: (axis: Axis) => void;
  dropSelectedToWorkplane: () => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  copySelection: () => void;
  pasteClipboard: () => void;
  selectAll: () => void;
  toggleTransparentSelected: () => void;
  setNodeColor: (id: string, color: string | undefined) => void;
  // Rotate the selection by an angle (radians) about a world axis, pivoting on
  // the selection's combined center — the same result as the gizmo. Editing
  // absolute Euler angles couples the axes confusingly, so the inspector nudges
  // instead.
  rotateSelectedBy: (axis: 0 | 1 | 2, radians: number) => void;
  resetRotationSelected: () => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  setProjectName: (name: string) => void;
  loadProject: (project: Project, cloudId?: string | null) => void;
  newProject: () => void;
  toggleLockSelected: () => void;
  hideSelected: () => void;
  showAll: () => void;
  setEditingGroup: (id: string | null) => void;

  setSelection: (ids: string[]) => void;
  select: (id: string, additive: boolean) => void;
  clearSelection: () => void;
  setTransformMode: (mode: TransformMode) => void;
  setSnap: (snap: boolean) => void;
  setSnapStep: (step: number) => void;
  setUnits: (units: Units) => void;
  setBed: (bed: [number, number] | null) => void;
  setWorkplane: (wp: Workplane | null) => void;
  setWorkplaneArmed: (armed: boolean) => void;
  setDragInfo: (info: string | null) => void;
  setOrtho: (ortho: boolean) => void;
  setCruiseMode: (on: boolean) => void;
}

export const useScene = create<SceneState>()(
  temporal(
    (set, get) => ({
      project: emptyProject(),
      selection: [],
      transformMode: "translate",
      snap: true,
      snapStep: localStorage.getItem("units") === "in" ? DEFAULT_STEP.in : DEFAULT_STEP.mm,
      units: (localStorage.getItem("units") === "in" ? "in" : "mm") as Units,
      bed: (() => {
        try {
          const raw = localStorage.getItem("bed");
          const v = raw ? JSON.parse(raw) : null;
          return Array.isArray(v) && v.length === 2 ? (v as [number, number]) : null;
        } catch {
          return null;
        }
      })(),
      workplane: null,
      workplaneArmed: false,
      dragInfo: null,
      editingGroupId: null,
      ortho: false,
      smartDup: null,
      cruiseMode: false,
      placing: null,
      alignMode: false,
      alignAnchors: [],
      filletMode: false,
      measureMode: false,
      rulerOrigin: null,
      rulerPlacing: false,
      sketchMode: null,
      sketchEditId: null,
      cloudProjectId: null,

      addShape: (kind, placement) => {
        const shape = makeShape(kind);
        const s = get();
        const place =
          placement ??
          (s.workplane
            ? { position: s.workplane.position, rotation: s.workplane.rotation }
            : null);
        if (place) {
          const n = new THREE.Vector3(0, 0, 1).applyEuler(
            new THREE.Euler(...place.rotation, "XYZ"),
          );
          const h = bottomOffset(kind, shape.params);
          shape.position = [
            place.position[0] + n.x * h,
            place.position[1] + n.y * h,
            place.position[2] + n.z * h,
          ];
          shape.rotation = [...place.rotation];
        } else {
          const fp = footprint(kind, shape.params);
          const [fx, fy] = findFreeSpot(fp.halfW, fp.halfD, s.project.rootOrder);
          shape.position = [fx, fy, shape.position[2]];
        }
        set((st) => {
          // Inside edit-in-place, new shapes join the group being edited.
          const editing = st.editingGroupId ? st.project.nodes[st.editingGroupId] : null;
          if (editing && isGroup(editing)) {
            return {
              project: {
                ...st.project,
                nodes: {
                  ...st.project.nodes,
                  [shape.id]: shape,
                  [editing.id]: { ...editing, childIds: [...editing.childIds, shape.id] },
                },
              },
              selection: [shape.id],
            };
          }
          return {
            project: {
              ...st.project,
              nodes: { ...st.project.nodes, [shape.id]: shape },
              rootOrder: [...st.project.rootOrder, shape.id],
            },
            selection: [shape.id],
          };
        });
      },

      placeShapeAt: (kind, position, rotation) => {
        const shape = makeShape(kind);
        shape.position = [...position];
        shape.rotation = [...rotation];
        set((st) => {
          const editing = st.editingGroupId ? st.project.nodes[st.editingGroupId] : null;
          if (editing && isGroup(editing)) {
            return {
              project: {
                ...st.project,
                nodes: {
                  ...st.project.nodes,
                  [shape.id]: shape,
                  [editing.id]: { ...editing, childIds: [...editing.childIds, shape.id] },
                },
              },
              selection: [shape.id],
              placing: null,
            };
          }
          return {
            project: {
              ...st.project,
              nodes: { ...st.project.nodes, [shape.id]: shape },
              rootOrder: [...st.project.rootOrder, shape.id],
            },
            selection: [shape.id],
            placing: null,
          };
        });
      },

      setPlacing: (kind) =>
        set({ placing: kind, ...(kind ? { workplaneArmed: false, cruiseMode: false } : {}) }),

      setAlignMode: (on) =>
        set({
          alignMode: on,
          alignAnchors: [],
          ...(on ? { measureMode: false, filletMode: false } : {}),
        }),
      setFilletMode: (on) =>
        set({ filletMode: on, ...(on ? { alignMode: false, measureMode: false } : {}) }),
      toggleBoxEdge: (id, edge) => {
        const node = get().project.nodes[id];
        if (!node || isGroup(node) || node.kind !== "box" || node.locked) return;
        const current = roundedEdges(node.params);
        const next = current.includes(edge)
          ? current.filter((e) => e !== edge)
          : [...current, edge];
        get().setBoxEdges(id, next);
      },
      setBoxEdges: (id, edges) => {
        const node = get().project.nodes[id];
        if (!node || isGroup(node) || node.kind !== "box" || node.locked) return;
        const box = foldBoxScale(node);
        const p = box.params;
        const params: Record<string, number | string> = { ...p, edges: formatEdges(edges) };
        // The first edge picked on a square box needs a radius to show.
        const radius = typeof p.radius === "number" ? p.radius : 0;
        if (edges.length && radius <= 0.01) {
          const size = (k: string) => (typeof p[k] === "number" ? (p[k] as number) : 20);
          params.radius = Math.min(DEFAULT_FILLET_RADIUS, maxFilletRadius(size("w"), size("d"), size("h")));
        }
        set((s) => ({
          project: { ...s.project, nodes: { ...s.project.nodes, [id]: { ...box, params } } },
        }));
      },
      toggleAlignAnchor: (id, additive) =>
        set((s) => {
          const has = s.alignAnchors.includes(id);
          if (additive) {
            return {
              alignAnchors: has ? s.alignAnchors.filter((x) => x !== id) : [...s.alignAnchors, id],
            };
          }
          const onlyThis = has && s.alignAnchors.length === 1;
          return { alignAnchors: onlyThis ? [] : [id] };
        }),
      setMeasureMode: (on) =>
        set({
          measureMode: on,
          ...(on ? { alignMode: false, cruiseMode: false, filletMode: false } : {}),
        }),

      toggleRuler: () => {
        const { rulerOrigin, rulerPlacing } = get();
        if (rulerOrigin || rulerPlacing) set({ rulerOrigin: null, rulerPlacing: false });
        else set({ rulerPlacing: true, measureMode: false, alignMode: false });
      },
      setRulerOrigin: (origin) => set({ rulerOrigin: origin, rulerPlacing: false }),

      setOffsetFromRuler: (axis, value) => {
        const { selection, project, rulerOrigin } = get();
        if (!rulerOrigin) return;
        const origin = [rulerOrigin[0], rulerOrigin[1], 0];
        const items = selection
          .map((id) => ({ id, box: sceneApi.getNodeBounds(id) }))
          .filter(
            (x): x is { id: string; box: THREE.Box3 } =>
              !!project.nodes[x.id] && !project.nodes[x.id].locked && !!x.box,
          );
        if (items.length === 0) return;
        const box = items.reduce((u, x) => u.union(x.box), new THREE.Box3());
        const shift = origin[axis] + value - box.min.getComponent(axis);
        if (!Number.isFinite(shift)) return;
        set((s) => {
          const nodes = { ...s.project.nodes };
          for (const { id } of items) {
            const n = nodes[id];
            const position = [...n.position] as Vec3;
            position[axis] += shift;
            nodes[id] = { ...n, position };
          }
          return { project: { ...s.project, nodes } };
        });
      },
      setSketchMode: (mode) => set({ sketchMode: mode, sketchEditId: null }),

      editSketch: (id) => {
        const node = get().project.nodes[id];
        if (!node || isGroup(node) || node.locked) return;
        const modeFor: Partial<Record<string, "scribble" | "extrude" | "revolve">> = {
          scribble: "scribble",
          sketch: "extrude",
          revolve: "revolve",
        };
        const mode = modeFor[node.kind];
        if (mode) set({ sketchMode: mode, sketchEditId: id, selection: [id] });
      },

      // Sketch tools create fully-parameterized shapes: geometry regenerates
      // from params like any primitive. Placed at a free spot on the floor.
      addShapeWithParams: (kind, params) => {
        const shape = makeShape(kind);
        shape.params = params;
        const fp = footprint(kind, params);
        const [fx, fy] = findFreeSpot(fp.halfW, fp.halfD, get().project.rootOrder);
        shape.position = [fx, fy, fp.bottom];
        set((st) => ({
          project: {
            ...st.project,
            nodes: { ...st.project.nodes, [shape.id]: shape },
            rootOrder: [...st.project.rootOrder, shape.id],
          },
          selection: [shape.id],
          sketchMode: null,
          sketchEditId: null,
        }));
      },

      setCloudProjectId: (id) => set({ cloudProjectId: id }),

      addImportedMesh: (params, name) => {
        const shape = makeShape("mesh");
        shape.params = { ...params, name };
        shape.position = [0, 0, bottomOffset("mesh", shape.params)];
        set((st) => ({
          project: {
            ...st.project,
            nodes: { ...st.project.nodes, [shape.id]: shape },
            rootOrder: [...st.project.rootOrder, shape.id],
          },
          selection: [shape.id],
        }));
      },

      updateShape: (id, patch) => {
        const node = get().project.nodes[id];
        if (!node || isGroup(node)) return;
        set((s) => ({
          project: {
            ...s.project,
            nodes: { ...s.project.nodes, [id]: foldBoxScale({ ...node, ...patch }) },
          },
        }));
      },

      setTransform: (id, position, rotation, scale) => {
        get().setTransforms([{ id, position, rotation, scale }]);
      },

      setTransforms: (entries) => {
        set((s) => {
          const nodes = { ...s.project.nodes };
          for (const e of entries) {
            const node = nodes[e.id];
            if (!node) continue;
            nodes[e.id] = foldBoxScale({
              ...node,
              position: e.position,
              rotation: e.rotation,
              scale: e.scale,
            });
          }
          return { project: { ...s.project, nodes } };
        });
      },

      translateSelected: (delta) => {
        const { selection, project } = get();
        const ids = selection.filter((id) => project.nodes[id] && !project.nodes[id].locked);
        if (ids.length === 0) return;
        set((s) => {
          const nodes = { ...s.project.nodes };
          for (const id of ids) {
            const n = nodes[id];
            nodes[id] = {
              ...n,
              position: [
                n.position[0] + delta[0],
                n.position[1] + delta[1],
                n.position[2] + delta[2],
              ],
            };
          }
          return { project: { ...s.project, nodes } };
        });
      },

      alignSelected: (axis, mode) => {
        const { selection, project, alignAnchors } = get();
        const items = selection
          .map((id) => ({ id, box: sceneApi.getNodeBounds(id) }))
          .filter((x): x is { id: string; box: THREE.Box3 } => !!project.nodes[x.id] && !project.nodes[x.id].locked && !!x.box);
        const plan = planAlign(items, alignAnchors, axis, mode);
        if (!plan?.changes) return;
        set((s) => {
          const nodes = { ...s.project.nodes };
          for (const { id, shift } of plan.moves) {
            const n = nodes[id];
            const position = [...n.position] as Vec3;
            position[axis] += shift;
            nodes[id] = { ...n, position };
          }
          return { project: { ...s.project, nodes } };
        });
      },

      mirrorSelected: (axis) => {
        const { selection, project } = get();
        const items = selection
          .map((id) => ({ id, box: sceneApi.getNodeBounds(id) }))
          .filter((x): x is { id: string; box: THREE.Box3 } => !!project.nodes[x.id] && !project.nodes[x.id].locked && !!x.box);
        if (items.length === 0) return;
        const union = new THREE.Box3();
        for (const { box } of items) union.union(box);
        const center = union.getCenter(new THREE.Vector3());
        const reflectScale = new THREE.Vector3(1, 1, 1);
        reflectScale.setComponent(axis, -1);
        const reflect = new THREE.Matrix4()
          .makeTranslation(center.x, center.y, center.z)
          .multiply(new THREE.Matrix4().makeScale(reflectScale.x, reflectScale.y, reflectScale.z))
          .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
        set((s) => {
          const nodes = { ...s.project.nodes };
          for (const { id } of items) {
            const n = nodes[id];
            const m = reflect
              .clone()
              .multiply(composeMatrix(n.position, n.rotation, n.scale));
            nodes[id] = foldBoxScale({ ...n, ...decomposeMatrix(m) });
          }
          return { project: { ...s.project, nodes } };
        });
      },

      dropSelectedToWorkplane: () => {
        const { selection, project, workplane } = get();
        const normal = workplaneNormal(workplane);
        const planePoint = workplane
          ? new THREE.Vector3(...workplane.position)
          : new THREE.Vector3(0, 0, 0);
        const planeD = normal.dot(planePoint);
        const items = selection
          .map((id) => ({ id, box: sceneApi.getNodeBounds(id) }))
          .filter((x): x is { id: string; box: THREE.Box3 } => !!project.nodes[x.id] && !project.nodes[x.id].locked && !!x.box);
        if (items.length === 0) return;
        set((s) => {
          const nodes = { ...s.project.nodes };
          const corner = new THREE.Vector3();
          for (const { id, box } of items) {
            let minDot = Infinity;
            for (let i = 0; i < 8; i++) {
              corner.set(
                i & 1 ? box.max.x : box.min.x,
                i & 2 ? box.max.y : box.min.y,
                i & 4 ? box.max.z : box.min.z,
              );
              minDot = Math.min(minDot, normal.dot(corner));
            }
            const shift = planeD - minDot;
            const n = nodes[id];
            nodes[id] = {
              ...n,
              position: [
                n.position[0] + normal.x * shift,
                n.position[1] + normal.y * shift,
                n.position[2] + normal.z * shift,
              ],
            };
          }
          return { project: { ...s.project, nodes } };
        });
      },

      deleteSelected: () => {
        const { selection, project } = get();
        const deletable = selection.filter((id) => project.nodes[id] && !project.nodes[id].locked);
        if (deletable.length === 0) return;
        const dead = new Set<string>();
        for (const id of deletable) collectSubtree(id, project.nodes, dead);
        set((s) => {
          const nodes = { ...s.project.nodes };
          for (const id of dead) delete nodes[id];
          // Strip dangling references from any surviving group.
          for (const [id, n] of Object.entries(nodes)) {
            if (isGroup(n) && n.childIds.some((c) => dead.has(c))) {
              nodes[id] = { ...n, childIds: n.childIds.filter((c) => !dead.has(c)) };
            }
          }
          return {
            project: {
              ...s.project,
              nodes,
              rootOrder: s.project.rootOrder.filter((id) => !dead.has(id)),
            },
            selection: [],
          };
        });
      },

      duplicateSelected: () => {
        const { selection, project, smartDup, editingGroupId } = get();
        const editing = editingGroupId ? project.nodes[editingGroupId] : null;
        const scope =
          editing && isGroup(editing)
            ? editing.childIds
            : project.rootOrder;
        const sources = scope.filter((id) => selection.includes(id));
        if (sources.length === 0) return;

        // Repeat-duplicate: if the current selection is exactly the copies of
        // the previous duplicate, re-apply whatever delta the user gave them.
        const chained =
          smartDup &&
          sources.length === Object.keys(smartDup.transforms).length &&
          sources.every((id) => id in smartDup.transforms);

        const added: Record<string, SceneNode> = {};
        const newTopIds: string[] = [];
        const nextTransforms: SmartDup["transforms"] = {};
        for (const id of sources) {
          const newIdStr = cloneSubtree(id, project.nodes, added);
          if (!newIdStr) continue;
          const clone = added[newIdStr];
          if (chained) {
            const src = project.nodes[id];
            const creation = smartDup.transforms[id];
            const delta = composeMatrix(src.position, src.rotation, src.scale).multiply(
              composeMatrix(creation.position, creation.rotation, creation.scale).invert(),
            );
            const m = delta.multiply(composeMatrix(src.position, src.rotation, src.scale));
            Object.assign(clone, foldBoxScale({ ...clone, ...decomposeMatrix(m) }));
          }
          nextTransforms[newIdStr] = {
            position: [...clone.position],
            rotation: [...clone.rotation],
            scale: [...clone.scale],
          };
          newTopIds.push(newIdStr);
        }
        if (newTopIds.length === 0) return;
        set((s) => {
          if (editing && isGroup(editing)) {
            const g = s.project.nodes[editing.id] as GroupNode;
            return {
              project: {
                ...s.project,
                nodes: {
                  ...s.project.nodes,
                  ...added,
                  [g.id]: { ...g, childIds: [...g.childIds, ...newTopIds] },
                },
              },
              selection: newTopIds,
              smartDup: { transforms: nextTransforms },
            };
          }
          return {
            project: {
              ...s.project,
              nodes: { ...s.project.nodes, ...added },
              rootOrder: [...s.project.rootOrder, ...newTopIds],
            },
            selection: newTopIds,
            smartDup: { transforms: nextTransforms },
          };
        });
      },

      // Clipboard lives in localStorage so shapes can be pasted into a
      // different design (or another tab), like Tinkercad's copy/paste.
      copySelection: () => {
        const { selection, project, editingGroupId } = get();
        const editing = editingGroupId ? project.nodes[editingGroupId] : null;
        const scope =
          editing && isGroup(editing) ? editing.childIds : project.rootOrder;
        const rootIds = scope.filter((id) => selection.includes(id));
        if (rootIds.length === 0) return;
        const nodes: Record<string, SceneNode> = {};
        const keep = new Set<string>();
        for (const id of rootIds) collectSubtree(id, project.nodes, keep);
        for (const id of keep) nodes[id] = project.nodes[id];
        try {
          localStorage.setItem(CLIPBOARD_KEY, JSON.stringify({ rootIds, nodes }));
        } catch {
          // clipboard is best-effort (quota)
        }
      },

      pasteClipboard: () => {
        let payload: { rootIds: string[]; nodes: Record<string, SceneNode> } | null = null;
        try {
          const raw = localStorage.getItem(CLIPBOARD_KEY);
          payload = raw ? JSON.parse(raw) : null;
        } catch {
          payload = null;
        }
        if (!payload?.rootIds?.length || !payload.nodes) return;
        const added: Record<string, SceneNode> = {};
        const newTopIds: string[] = [];
        for (const id of payload.rootIds) {
          const newIdStr = cloneSubtree(id, payload.nodes, added);
          if (!newIdStr) continue;
          const clone = added[newIdStr];
          // Offset so a paste on top of its source is visible.
          clone.position = [clone.position[0] + 10, clone.position[1] + 10, clone.position[2]];
          newTopIds.push(newIdStr);
        }
        if (newTopIds.length === 0) return;
        set((s) => {
          const editing = s.editingGroupId ? s.project.nodes[s.editingGroupId] : null;
          if (editing && isGroup(editing)) {
            return {
              project: {
                ...s.project,
                nodes: {
                  ...s.project.nodes,
                  ...added,
                  [editing.id]: { ...editing, childIds: [...editing.childIds, ...newTopIds] },
                },
              },
              selection: newTopIds,
            };
          }
          return {
            project: {
              ...s.project,
              nodes: { ...s.project.nodes, ...added },
              rootOrder: [...s.project.rootOrder, ...newTopIds],
            },
            selection: newTopIds,
          };
        });
      },

      selectAll: () => {
        const { project, editingGroupId } = get();
        const editing = editingGroupId ? project.nodes[editingGroupId] : null;
        const scope =
          editing && isGroup(editing) ? editing.childIds : project.rootOrder;
        set({ selection: scope.filter((id) => !project.nodes[id]?.hidden) });
      },

      // Groups may override their inherited color; undefined restores it.
      setNodeColor: (id, color) => {
        set((s) => {
          const node = s.project.nodes[id];
          if (!node) return {};
          const next = { ...node } as SceneNode & { color?: string };
          if (color === undefined) delete next.color;
          else next.color = color;
          return { project: { ...s.project, nodes: { ...s.project.nodes, [id]: next } } };
        });
      },

      rotateSelectedBy: (axis, radians) => {
        const { selection, project } = get();
        const ids = selection.filter(
          (id) => project.nodes[id] && !project.nodes[id].locked,
        );
        if (ids.length === 0 || !Number.isFinite(radians) || radians === 0) return;
        // Pivot on the combined bounds center, like the gizmo.
        const box = new THREE.Box3();
        let any = false;
        for (const id of ids) {
          const b = sceneApi.getNodeBounds(id);
          if (b) {
            box.union(b);
            any = true;
          }
        }
        const center = any ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
        const axisVec = new THREE.Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0);
        const q = new THREE.Quaternion().setFromAxisAngle(axisVec, radians);
        const delta = new THREE.Matrix4()
          .makeTranslation(center.x, center.y, center.z)
          .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
          .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
        set((s) => {
          const nodes = { ...s.project.nodes };
          for (const id of ids) {
            const n = nodes[id];
            const world = delta
              .clone()
              .multiply(composeMatrix(n.position, n.rotation, n.scale));
            const t = decomposeMatrix(world);
            nodes[id] = foldBoxScale({ ...n, position: t.position, rotation: t.rotation, scale: t.scale });
          }
          return { project: { ...s.project, nodes } };
        });
      },

      resetRotationSelected: () => {
        const { selection, project } = get();
        const ids = selection.filter(
          (id) => project.nodes[id] && !project.nodes[id].locked,
        );
        if (ids.length === 0) return;
        set((s) => {
          const nodes = { ...s.project.nodes };
          for (const id of ids) nodes[id] = { ...nodes[id], rotation: [0, 0, 0] };
          return { project: { ...s.project, nodes } };
        });
      },

      toggleTransparentSelected: () => {
        const { selection, project } = get();
        const ids = selection.filter((id) => project.nodes[id]);
        if (ids.length === 0) return;
        const on = ids.some((id) => !project.nodes[id].transparent);
        set((s) => {
          const nodes = { ...s.project.nodes };
          for (const id of ids) nodes[id] = { ...nodes[id], transparent: on };
          return { project: { ...s.project, nodes } };
        });
      },

      groupSelected: () => {
        const { selection, project } = get();
        const ids = project.rootOrder.filter((id) => selection.includes(id));
        if (ids.length < 2) return;
        // A group with no solid in it is a hole group: its holes merge into
        // one hole that cuts as a single piece once grouped with a solid.
        const group: GroupNode = {
          id: newId(),
          type: "group",
          childIds: ids,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        };
        set((s) => {
          const grouped = new Set(ids);
          const rootOrder = s.project.rootOrder.flatMap((id) =>
            id === ids[0] ? [group.id] : grouped.has(id) ? [] : [id],
          );
          return {
            project: {
              ...s.project,
              nodes: { ...s.project.nodes, [group.id]: group },
              rootOrder,
            },
            selection: [group.id],
          };
        });
      },

      ungroupSelected: () => {
        const { selection, project } = get();
        const groups = selection.filter((id) => {
          const n = project.nodes[id];
          return n && isGroup(n) && project.rootOrder.includes(id);
        });
        if (groups.length === 0) return;
        set((s) => {
          const nodes = { ...s.project.nodes };
          let rootOrder = [...s.project.rootOrder];
          const freed: string[] = [];
          for (const gid of groups) {
            const group = nodes[gid] as GroupNode;
            // Fold the group's transform into each child so nothing moves
            // visually when the group dissolves.
            const gm = composeMatrix(group.position, group.rotation, group.scale);
            for (const cid of group.childIds) {
              const child = nodes[cid];
              if (!child) continue;
              const cm = composeMatrix(child.position, child.rotation, child.scale);
              const t = decomposeMatrix(gm.clone().multiply(cm));
              nodes[cid] = foldBoxScale({ ...child, ...t });
            }
            rootOrder = rootOrder.flatMap((id) => (id === gid ? group.childIds : [id]));
            freed.push(...group.childIds);
            delete nodes[gid];
          }
          return {
            project: { ...s.project, nodes, rootOrder },
            selection: freed,
          };
        });
      },

      setProjectName: (name) => set((s) => ({ project: { ...s.project, name } })),

      loadProject: (project, cloudId = null) => {
        set({
          project,
          selection: [],
          workplane: null,
          workplaneArmed: false,
          editingGroupId: null,
          smartDup: null,
          cloudProjectId: cloudId,
        });
        useScene.temporal.getState().clear();
      },

      newProject: () => {
        get().loadProject(emptyProject());
      },

      toggleLockSelected: () => {
        const { selection, project } = get();
        const ids = selection.filter((id) => project.nodes[id]);
        if (ids.length === 0) return;
        const lock = ids.some((id) => !project.nodes[id].locked);
        set((s) => {
          const nodes = { ...s.project.nodes };
          for (const id of ids) nodes[id] = { ...nodes[id], locked: lock };
          return { project: { ...s.project, nodes } };
        });
      },

      hideSelected: () => {
        const { selection, project } = get();
        const ids = selection.filter((id) => project.nodes[id] && !project.nodes[id].locked);
        if (ids.length === 0) return;
        set((s) => {
          const nodes = { ...s.project.nodes };
          for (const id of ids) nodes[id] = { ...nodes[id], hidden: true };
          return { project: { ...s.project, nodes }, selection: [] };
        });
      },

      showAll: () => {
        set((s) => {
          const nodes = { ...s.project.nodes };
          let changed = false;
          for (const [id, n] of Object.entries(nodes)) {
            if (n.hidden) {
              nodes[id] = { ...n, hidden: false };
              changed = true;
            }
          }
          return changed ? { project: { ...s.project, nodes } } : {};
        });
      },

      setEditingGroup: (id) => set({ editingGroupId: id, selection: [] }),

      setSelection: (ids) => set({ selection: ids }),
      select: (id, additive) =>
        set((s) => ({
          selection: additive
            ? s.selection.includes(id)
              ? s.selection.filter((x) => x !== id)
              : [...s.selection, id]
            : [id],
        })),
      clearSelection: () => set({ selection: [] }),
      setTransformMode: (mode) => set({ transformMode: mode }),
      setSnap: (snap) => set({ snap }),
      setSnapStep: (step) => set({ snapStep: step }),
      setUnits: (units) => {
        localStorage.setItem("units", units);
        set({ units, snapStep: DEFAULT_STEP[units] });
      },
      setBed: (bed) => {
        if (bed) localStorage.setItem("bed", JSON.stringify(bed));
        else localStorage.removeItem("bed");
        set({ bed });
      },
      setWorkplane: (wp) => set({ workplane: wp, workplaneArmed: false }),
      setWorkplaneArmed: (armed) => set({ workplaneArmed: armed }),
      setDragInfo: (info) => set({ dragInfo: info }),
      setOrtho: (ortho) => set({ ortho }),
      setCruiseMode: (on) =>
        set({ cruiseMode: on, ...(on ? { workplaneArmed: false } : {}) }),
    }),
    {
      // Only the scene graph participates in undo history; selection and UI
      // modes are ephemeral.
      partialize: (s) => ({ project: s.project }),
      equality: (past, current) => past.project === current.project,
    },
  ),
);

export const undo = () => useScene.temporal.getState().undo();
export const redo = () => useScene.temporal.getState().redo();

declare global {
  interface Window {
    __scene?: typeof useScene;
  }
}
if (import.meta.env.DEV) window.__scene = useScene;
