import { useEffect } from "react";
import * as THREE from "three";
import { useScene, undo, redo } from "../state/store";
import { isGroup, type Vec3 } from "../types/scene";
import { sceneApi } from "../lib/sceneApi";
import { workplaneNormal } from "../lib/workplane";

// Arrow nudges move in the active workplane's frame; Ctrl/⌘+up/down moves
// along its normal.
function nudge(dx: number, dy: number, dz: number) {
  const s = useScene.getState();
  const step = s.snap ? s.snapStep : 0.1;
  const e = s.workplane ? new THREE.Euler(...s.workplane.rotation, "XYZ") : null;
  const vx = e ? new THREE.Vector3(1, 0, 0).applyEuler(e) : new THREE.Vector3(1, 0, 0);
  const vy = e ? new THREE.Vector3(0, 1, 0).applyEuler(e) : new THREE.Vector3(0, 1, 0);
  const vz = workplaneNormal(s.workplane);
  const delta = new THREE.Vector3()
    .addScaledVector(vx, dx * step)
    .addScaledVector(vy, dy * step)
    .addScaledVector(vz, dz * step);
  s.translateSelected(delta.toArray() as Vec3);
}

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
      if (mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        s.copySelection();
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        s.pasteClipboard();
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        s.selectAll();
        return;
      }
      if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey) s.ungroupSelected();
        else s.groupSelected();
        return;
      }
      if (mod && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        nudge(0, 0, e.key === "ArrowUp" ? 1 : -1);
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
        case "w":
          s.setWorkplaneArmed(!s.workplaneArmed);
          break;
        case "c":
          s.setCruiseMode(!s.cruiseMode);
          break;
        case "l":
          if (s.alignMode || s.selection.length >= 2) s.setAlignMode(!s.alignMode);
          break;
        case "m":
          s.setMeasureMode(!s.measureMode);
          break;
        case "e":
          // Round edges: click any edge line in the scene.
          s.setFilletMode(!s.filletMode);
          break;
        case "d":
          s.dropSelectedToWorkplane();
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
        case "arrowleft":
          e.preventDefault();
          nudge(-1, 0, 0);
          break;
        case "arrowright":
          e.preventDefault();
          nudge(1, 0, 0);
          break;
        case "arrowup":
          e.preventDefault();
          nudge(0, 1, 0);
          break;
        case "arrowdown":
          e.preventDefault();
          nudge(0, -1, 0);
          break;
        case "delete":
        case "backspace":
          e.preventDefault();
          s.deleteSelected();
          break;
        case "escape":
          if (s.sketchMode) s.setSketchMode(null);
          else if (s.rulerPlacing || s.rulerOrigin) s.toggleRuler();
          else if (s.placing) s.setPlacing(null);
          else if (s.workplaneArmed) s.setWorkplaneArmed(false);
          else if (s.alignMode) s.setAlignMode(false);
          else if (s.filletMode) s.setFilletMode(false);
          else if (s.measureMode) s.setMeasureMode(false);
          else if (s.cruiseMode) s.setCruiseMode(false);
          else if (s.editingGroupId) s.setEditingGroup(null);
          else s.clearSelection();
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
