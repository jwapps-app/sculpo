import { create } from "zustand";
import { temporal } from "zundo";
import type { GroupNode, PrimitiveKind, Project, SceneNode, ShapeNode, Vec3 } from "../types/scene";
import { emptyProject, isGroup } from "../types/scene";
import { makeShape } from "../lib/primitives";
import { newId } from "../lib/id";
import { composeMatrix, decomposeMatrix } from "../lib/transform";

export type TransformMode = "translate" | "rotate" | "scale";

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

interface SceneState {
  project: Project;
  selection: string[];
  transformMode: TransformMode;
  snap: boolean;

  addShape: (kind: PrimitiveKind, at?: Vec3) => void;
  updateShape: (id: string, patch: Partial<Omit<ShapeNode, "id" | "kind">>) => void;
  setTransform: (id: string, position: Vec3, rotation: Vec3, scale: Vec3) => void;
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
}

export const useScene = create<SceneState>()(
  temporal(
    (set, get) => ({
      project: emptyProject(),
      selection: [],
      transformMode: "translate",
      snap: true,

      addShape: (kind, at) => {
        const shape = makeShape(kind, at);
        set((s) => ({
          project: {
            ...s.project,
            nodes: { ...s.project.nodes, [shape.id]: shape },
            rootOrder: [...s.project.rootOrder, shape.id],
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
        const node = get().project.nodes[id];
        if (!node) return;
        set((s) => ({
          project: {
            ...s.project,
            nodes: {
              ...s.project.nodes,
              [id]: { ...node, position, rotation, scale },
            },
          },
        }));
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

      setProjectName: (name) =>
        set((s) => ({ project: { ...s.project, name } })),

      loadProject: (project) => {
        set({ project, selection: [] });
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
