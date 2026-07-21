import * as THREE from "three";

// Live transform of the shape being placed (palette click → cursor-follow →
// click to commit). Mutated per pointermove by sceneApi.placementMove and read
// per frame by the ghost preview mesh — deliberately outside React state.
export const placementState = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  valid: false,
};

declare global {
  interface Window {
    __placement?: typeof placementState;
  }
}
if (import.meta.env.DEV) window.__placement = placementState;
