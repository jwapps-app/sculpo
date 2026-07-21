import { create } from "zustand";
import { temporal } from "zundo";
import type { PrimitiveKind, Project, ShapeNode, Vec3 } from "../types/scene";
import { emptyProject, isGroup } from "../types/scene";
import { makeShape } from "../lib/primitives";
import { newId } from "../lib/id";

export type TransformMode = "translate" | "rotate" | "scale";

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
        get().updateShape(id, { position, rotation, scale });
      },

      deleteSelected: () => {
        const { selection } = get();
        if (selection.length === 0) return;
        const dead = new Set(selection);
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
        if (selection.length === 0) return;
        const copies: ShapeNode[] = [];
        for (const id of selection) {
          const node = project.nodes[id];
          if (!node || isGroup(node)) continue; // group duplication arrives with grouping
          copies.push({
            ...structuredClone(node),
            id: newId(),
            position: [node.position[0] + 10, node.position[1] + 10, node.position[2]],
          });
        }
        if (copies.length === 0) return;
        set((s) => ({
          project: {
            ...s.project,
            nodes: {
              ...s.project.nodes,
              ...Object.fromEntries(copies.map((c) => [c.id, c])),
            },
            rootOrder: [...s.project.rootOrder, ...copies.map((c) => c.id)],
          },
          selection: copies.map((c) => c.id),
        }));
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
