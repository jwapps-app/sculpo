import type { TransformControls as TransformControlsImpl } from "three-stdlib";

// three-stdlib types these as private, but they're plain runtime properties.
interface ControlsInternals {
  dragging: boolean;
  axis: string | null;
}

// Lets the marquee layer ask whether the pointer is interacting with the
// transform gizmo or a resize handle without threading refs through the tree.
export const gizmoState = {
  controls: null as TransformControlsImpl | null,
  handleActive: false,
  lastInteractionEnd: 0,
  busy(): boolean {
    if (this.handleActive) return true;
    const c = this.controls as unknown as ControlsInternals | null;
    return !!c && (c.dragging || c.axis !== null);
  },
};

// handleActive is set on hover as well as on drag, and a handle that vanishes
// while hovered (the selection cleared, say) never gets its pointer-out — which
// used to strand the flag on, quietly disabling camera orbit and the marquee.
// No gesture outlives the pointer being released, so clear it there.
if (typeof window !== "undefined") {
  const release = () => {
    gizmoState.handleActive = false;
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
}
