import * as THREE from "three";

// Live state of the measure tool, mutated per pointermove/click and read per
// frame by the overlay — deliberately outside React state, like placement.
export const measureState = {
  hover: null as THREE.Vector3 | null,
  hoverSnapped: false,
  p1: null as THREE.Vector3 | null,
  p2: null as THREE.Vector3 | null,
};

export function resetMeasure() {
  measureState.hover = null;
  measureState.hoverSnapped = false;
  measureState.p1 = null;
  measureState.p2 = null;
}
