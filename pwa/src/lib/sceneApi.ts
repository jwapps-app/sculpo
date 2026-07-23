import type * as THREE from "three";
import type { PrimitiveKind } from "../types/scene";

export type ViewName = "top" | "front" | "right" | "iso";

// Imperative bridge from DOM UI (toolbar, palette drag-drop, marquee) into the
// R3F scene. SceneRig assigns the implementations once the canvas exists.
export const sceneApi = {
  setView: (_view: ViewName) => {},
  zoomToFit: () => {},
  // Orbit the camera by a pointer delta in pixels (drives view-cube drags).
  orbitBy: (_dx: number, _dy: number) => {},
  dropShape: (_kind: PrimitiveKind, _clientX: number, _clientY: number) => {},
  // World-space AABB of a top-level node's rendered mesh.
  getNodeBounds: (_id: string): THREE.Box3 | null => null,
  // True when the pointer position is over a shape mesh.
  hitTestNodes: (_clientX: number, _clientY: number): boolean => false,
  // Top-level node ids whose bounds-center projects inside the client-px rect.
  pickInRect: (_x1: number, _y1: number, _x2: number, _y2: number): string[] => [],
  // Topmost node under the pointer, or null.
  hitNodeAt: (_clientX: number, _clientY: number): string | null => null,
  // Cruise: glide a node along whatever surface is under the pointer (other
  // shapes' faces, else the floor). Mutates the scene object only; call
  // readNodeTransform to commit.
  cruiseMove: (_id: string, _clientX: number, _clientY: number): void => {},
  readNodeTransform: (
    _id: string,
  ): { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] } | null =>
    null,
  // Updates placementState for the shape kind currently being placed: glides
  // over other shapes' faces, else the floor/workplane, with magnetic
  // edge-snapping against neighbors.
  placementMove: (_clientX: number, _clientY: number): void => {},
  // Measure tool: the point under the cursor, snapped to bounding-box
  // features (corners, edge midpoints, face centers) when close to one, else
  // a surface or floor point. snapped reports which case hit.
  measureSnap: (
    _clientX: number,
    _clientY: number,
  ): { point: [number, number, number]; snapped: boolean } | null => null,
};

declare global {
  interface Window {
    __sceneApi?: typeof sceneApi;
  }
}
if (import.meta.env.DEV) window.__sceneApi = sceneApi;
