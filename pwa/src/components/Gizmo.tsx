import { useEffect, useState } from "react";
import { useThree } from "@react-three/fiber";
import { TransformControls } from "@react-three/drei";
import * as THREE from "three";
import { useScene } from "../state/store";
import type { Vec3 } from "../types/scene";

// Attaches a transform gizmo to the most recently selected shape. The gizmo
// mutates the Object3D directly while dragging; the store is committed once on
// mouse-up so undo captures one step per drag.
export function Gizmo() {
  const scene = useThree((s) => s.scene);
  const selection = useScene((s) => s.selection);
  const mode = useScene((s) => s.transformMode);
  const snap = useScene((s) => s.snap);
  const setTransform = useScene((s) => s.setTransform);
  const nodes = useScene((s) => s.project.nodes);

  const [target, setTarget] = useState<THREE.Object3D | null>(null);

  const activeId = [...selection].reverse().find((id) => nodes[id] !== undefined);

  useEffect(() => {
    if (!activeId) {
      setTarget(null);
      return;
    }
    let found: THREE.Object3D | null = null;
    scene.traverse((o) => {
      if (!found && o.userData.nodeId === activeId) found = o;
    });
    setTarget(found);
  }, [activeId, scene, nodes]);

  if (!target || !activeId) return null;

  const commit = () => {
    const o = target;
    setTransform(
      activeId,
      o.position.toArray() as Vec3,
      [o.rotation.x, o.rotation.y, o.rotation.z] as Vec3,
      o.scale.toArray() as Vec3,
    );
  };

  return (
    <TransformControls
      object={target}
      mode={mode}
      translationSnap={snap ? 1 : null}
      rotationSnap={snap ? THREE.MathUtils.degToRad(15) : null}
      scaleSnap={snap ? 0.1 : null}
      onMouseUp={commit}
    />
  );
}
