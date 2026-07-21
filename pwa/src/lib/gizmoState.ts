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
