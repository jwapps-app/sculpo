import { useEffect } from "react";
import { useScene } from "../state/store";
import { parseProjectFile } from "../lib/projectFile";

const KEY = "autosave-project";
const MAX_BYTES = 4_000_000; // stay clear of the ~5MB localStorage quota

// Restores the last session on startup and persists the scene graph
// (debounced) on every change. Purely local — no server involved.
export function useAutosave() {
  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      try {
        const project = parseProjectFile(saved);
        if (project.rootOrder.length > 0) useScene.getState().loadProject(project);
      } catch {
        localStorage.removeItem(KEY);
      }
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useScene.subscribe((state, prev) => {
      if (state.project === prev.project) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const json = JSON.stringify(state.project);
        if (json.length > MAX_BYTES) return; // huge imported meshes: skip quietly
        try {
          localStorage.setItem(KEY, json);
        } catch {
          // quota exceeded — autosave is best-effort
        }
      }, 800);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
