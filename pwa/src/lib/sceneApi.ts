import type * as THREE from "three";
import type { PrimitiveKind } from "../types/scene";

export type ViewName = "top" | "front" | "right" | "iso";

// Imperative bridge from DOM UI (toolbar, palette drag-drop, marquee) into the
// R3F scene. SceneRig assigns the implementations once the canvas exists.
export const sceneApi = {
  setView: (_view: ViewName) => {},
  zoomToFit: () => {},
  dropShape: (_kind: PrimitiveKind, _clientX: number, _clientY: number) => {},
  // World-space AABB of a top-level node's rendered mesh.
  getNodeBounds: (_id: string): THREE.Box3 | null => null,
  // True when the pointer position is over a shape mesh.
  hitTestNodes: (_clientX: number, _clientY: number): boolean => false,
  // Top-level node ids whose bounds-center projects inside the client-px rect.
  pickInRect: (_x1: number, _y1: number, _x2: number, _y2: number): string[] => [],
};
