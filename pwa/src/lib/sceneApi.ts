import type { PrimitiveKind } from "../types/scene";

export type ViewName = "top" | "front" | "right" | "iso";

// Imperative bridge from DOM UI (toolbar, palette drag-drop) into the R3F
// scene. SceneRig assigns the implementations once the canvas exists.
export const sceneApi = {
  setView: (_view: ViewName) => {},
  zoomToFit: () => {},
  dropShape: (_kind: PrimitiveKind, _clientX: number, _clientY: number) => {},
};
