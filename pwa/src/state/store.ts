import { create } from "zustand";
import { temporal } from "zundo";
import * as THREE from "three";
import type { GroupNode, PrimitiveKind, Project, SceneNode, ShapeNode, Vec3 } from "../types/scene";
import { emptyProject, isGroup } from "../types/scene";
import { dropHeight, makeShape } from "../lib/primitives";
import { newId } from "../lib/id";
import { composeMatrix, decomposeMatrix } from "../lib/transform";
import { workplaneNormal, type Workplane } from "../lib/workplane";
import { sceneApi } from "../lib/sceneApi";

export type TransformMode = "translate" | "rotate" | "scale";
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

function hasSolidContent(id: string, nodes: Project["nodes"]): boolean {
  const node = nodes[id];
  if (!node) return false;
  if (isGroup(node)) return node.childIds.some((c) => hasSolidContent(c, nodes));
  return node.role === "solid";
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

// Min/center/max of a world AABB along one axis.
function boundsValue(box: THREE.Box3, axis: Axis, mode: AlignMode): number {
  const min = box.min.getComponent(axis);
  const max = box.max.getComponent(axis);
  return mode === "min" ? min : mode === "max" ? max : (min + max) / 2;
}

interface SceneState {
  project: Project;
  selection: string[];
  transformMode: TransformMode;
  snap: boolean;
  snapStep: number;
  workplane: Workplane | null;
  workplaneArmed: boolean;
  dragInfo: string | null;

  addShape: (kind: PrimitiveKind, placement?: Placement) => void;
  updateShape: (id: string, patch: Partial<Omit<ShapeNode, "id" | "kind">>) => void;
  setTransform: (id: string, position: Vec3, rotation: Vec3, scale: Vec3) => void;
  setTransforms: (entries: TransformEntry[]) => void;
  translateSelected: (delta: Vec3) => void;
  alignSelected: (axis: Axis, mode: AlignMode) => void;
  mirrorSelected: (axis: Axis) => void;
  dropSelectedToWorkplane: () => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  setProjectName: (name: string) => void;
  loadProject: (project: Project) => void;

  setSelection: (ids: string[]) => void;
  select: (id: string, additive: boolean) => void;
  clearSelection: () => void;
  setTransformMode: (mode: TransformMode) => void;
  setSnap: (snap: boolean) => void;
  setSnapStep: (step: number) => void;
  setWorkplane: (wp: Workplane | null) => void;
  setWorkplaneArmed: (armed: boolean) => void;
  setDragInfo: (info: string | null) => void;
}

export const useScene = create<SceneState>()(
  temporal(
    (set, get) => ({
      project: emptyProject(),
      selection: [],
      transformMode: "translate",
      snap: true,
      snapStep: 1,
      workplane: null,
      workplaneArmed: false,
      dragInfo: null,

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
          const h = dropHeight(kind, shape.params);
          shape.position = [
            place.position[0] + n.x * h,
            place.position[1] + n.y * h,
            place.position[2] + n.z * h,
          ];
          shape.rotation = [...place.rotation];
        }
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
            nodes: { ...s.project.nodes, [id]: { ...node, ...patch } },
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
            nodes[e.id] = { ...node, position: e.position, rotation: e.rotation, scale: e.scale };
          }
          return { project: { ...s.project, nodes } };
        });
      },

      translateSelected: (delta) => {
        const { selection, project } = get();
        const ids = selection.filter((id) => project.nodes[id]);
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
        const { selection, project } = get();
        const items = selection
          .map((id) => ({ id, box: sceneApi.getNodeBounds(id) }))
          .filter((x): x is { id: string; box: THREE.Box3 } => !!project.nodes[x.id] && !!x.box);
        if (items.length < 2) return;
        const target =
          mode === "min"
            ? Math.min(...items.map((x) => boundsValue(x.box, axis, "min")))
            : mode === "max"
              ? Math.max(...items.map((x) => boundsValue(x.box, axis, "max")))
              : items.reduce((sum, x) => sum + boundsValue(x.box, axis, "center"), 0) /
                items.length;
        set((s) => {
          const nodes = { ...s.project.nodes };
          for (const { id, box } of items) {
            const n = nodes[id];
            const shift = target - boundsValue(box, axis, mode);
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
          .filter((x): x is { id: string; box: THREE.Box3 } => !!project.nodes[x.id] && !!x.box);
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
            nodes[id] = { ...n, ...decomposeMatrix(m) };
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
          .filter((x): x is { id: string; box: THREE.Box3 } => !!project.nodes[x.id] && !!x.box);
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
        if (selection.length === 0) return;
        const dead = new Set<string>();
        for (const id of selection) collectSubtree(id, project.nodes, dead);
        set((s) => {
          const nodes = { ...s.project.nodes };
          for (const id of dead) delete nodes[id];
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
        const { selection, project } = get();
        const topLevel = selection.filter((id) => project.rootOrder.includes(id));
        if (topLevel.length === 0) return;
        const added: Record<string, SceneNode> = {};
        const newTopIds: string[] = [];
        for (const id of topLevel) {
          const newIdStr = cloneSubtree(id, project.nodes, added);
          if (!newIdStr) continue;
          const clone = added[newIdStr];
          clone.position = [clone.position[0] + 10, clone.position[1] + 10, clone.position[2]];
          newTopIds.push(newIdStr);
        }
        if (newTopIds.length === 0) return;
        set((s) => ({
          project: {
            ...s.project,
            nodes: { ...s.project.nodes, ...added },
            rootOrder: [...s.project.rootOrder, ...newTopIds],
          },
          selection: newTopIds,
        }));
      },

      groupSelected: () => {
        const { selection, project } = get();
        const ids = project.rootOrder.filter((id) => selection.includes(id));
        if (ids.length < 2) return;
        if (!ids.some((id) => hasSolidContent(id, project.nodes))) {
          alert("A group needs at least one solid shape.");
          return;
        }
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
              nodes[cid] = { ...child, ...t };
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

      loadProject: (project) => {
        set({ project, selection: [], workplane: null, workplaneArmed: false });
        useScene.temporal.getState().clear();
      },

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
      setWorkplane: (wp) => set({ workplane: wp, workplaneArmed: false }),
      setWorkplaneArmed: (armed) => set({ workplaneArmed: armed }),
      setDragInfo: (info) => set({ dragInfo: info }),
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
