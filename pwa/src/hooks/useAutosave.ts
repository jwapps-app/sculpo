import { useEffect } from "react";
import { useScene } from "../state/store";
import { parseProjectFile } from "../lib/projectFile";
import { markSynced } from "../state/cloudSync";

const KEY = "autosave-project";
const MAX_BYTES = 4_000_000; // stay clear of the ~5MB localStorage quota

// Restores the last session on startup and persists the scene graph
// (debounced) on every change. The cloud id rides along so a restored
// session keeps updating the same cloud project instead of creating
// duplicates.
export function useAutosave() {
  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { project?: unknown; cloudId?: string | null };
        // v2 payload {project, cloudId}; legacy payloads were the bare project.
        const rawProject = parsed && typeof parsed === "object" && "project" in parsed
          ? JSON.stringify(parsed.project)
          : saved;
        const cloudId =
          parsed && typeof parsed === "object" && typeof parsed.cloudId === "string"
            ? parsed.cloudId
            : null;
        const project = parseProjectFile(rawProject);
        if (project.rootOrder.length > 0) {
          useScene.getState().loadProject(project, cloudId);
          // What we restored is what the cloud last saw (or close enough);
          // don't re-upload until the user actually changes something.
          markSynced(useScene.getState().project);
        }
      } catch {
        localStorage.removeItem(KEY);
      }
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useScene.subscribe((state, prev) => {
      if (state.project === prev.project && state.cloudProjectId === prev.cloudProjectId) {
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const payload = JSON.stringify({
          project: state.project,
          cloudId: state.cloudProjectId,
        });
        if (payload.length > MAX_BYTES) return; // huge imported meshes: skip quietly
        try {
          localStorage.setItem(KEY, payload);
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
