import { useEffect } from "react";
import { useScene, undo, redo } from "../state/store";
import { isGroup } from "../types/scene";
import { sceneApi } from "../lib/sceneApi";

export function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }
      const s = useScene.getState();
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        s.duplicateSelected();
        return;
      }
      if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey) s.ungroupSelected();
        else s.groupSelected();
        return;
      }
      if (mod) return;

      switch (e.key.toLowerCase()) {
        case "g":
          s.setTransformMode("translate");
          break;
        case "r":
          s.setTransformMode("rotate");
          break;
        case "s":
          s.setTransformMode("scale");
          break;
        case "h": {
          // toggle solid/hole on selection
          for (const id of s.selection) {
            const node = s.project.nodes[id];
            if (node && !isGroup(node)) {
              s.updateShape(id, { role: node.role === "hole" ? "solid" : "hole" });
            }
          }
          break;
        }
        case "delete":
        case "backspace":
          e.preventDefault();
          s.deleteSelected();
          break;
        case "escape":
          s.clearSelection();
          break;
        case "1":
          sceneApi.setView("top");
          break;
        case "2":
          sceneApi.setView("front");
          break;
        case "3":
          sceneApi.setView("right");
          break;
        case "4":
          sceneApi.setView("iso");
          break;
        case "f":
          sceneApi.zoomToFit();
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
