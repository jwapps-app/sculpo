import { useRef } from "react";
import { GizmoHelper, GizmoViewcube } from "@react-three/drei";
import { sceneApi } from "../lib/sceneApi";

const DRAG_THRESHOLD = 3; // px before a press counts as an orbit, not a click

// The corner orientation cube: click a face/edge/corner to snap the camera,
// or drag it to orbit freely. drei's cube is click-only, so the drag is
// layered on here — with the trailing click swallowed after a real drag so
// releasing over a face doesn't also snap the view.
export function ViewCube() {
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    sceneApi.orbitBy(dx, dy);
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    if (!d?.moved) return;
    // Eat the click this drag is about to produce.
    const swallow = (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
      window.removeEventListener("click", swallow, true);
    };
    window.addEventListener("click", swallow, true);
    setTimeout(() => window.removeEventListener("click", swallow, true), 400);
  };

  return (
    <GizmoHelper alignment="top-right" margin={[64, 64]}>
      <group
        onPointerDown={(e) => {
          e.stopPropagation();
          drag.current = { x: e.clientX, y: e.clientY, moved: false };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        }}
      >
        <GizmoViewcube
          color="#f3f4f6"
          textColor="#374151"
          strokeColor="#9ca3af"
          hoverColor="#2a6cd4"
          faces={["Right", "Left", "Back", "Front", "Top", "Bottom"]}
        />
      </group>
    </GizmoHelper>
  );
}
