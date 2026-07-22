import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { TransformControls } from "@react-three/drei";
import * as THREE from "three";
import type { TransformControls as TransformControlsImpl } from "three-stdlib";
import { useScene } from "../state/store";
import { gizmoState } from "../lib/gizmoState";
import { sceneApi } from "../lib/sceneApi";
import type { Vec3 } from "../types/scene";

interface DragState {
  pivotStart: THREE.Matrix4;
  objects: { id: string; obj: THREE.Object3D; start: THREE.Matrix4 }[];
}

// One gizmo drives the whole selection: it attaches to an invisible pivot at
// the selection's bounds center; per-frame the pivot's delta matrix is applied
// to every selected object, and the store is committed once on mouse-up.
export function Gizmo() {
  const scene = useThree((s) => s.scene);
  const selection = useScene((s) => s.selection);
  const mode = useScene((s) => s.transformMode);
  const snap = useScene((s) => s.snap);
  const snapStep = useScene((s) => s.snapStep);
  const nodes = useScene((s) => s.project.nodes);
  const setTransforms = useScene((s) => s.setTransforms);
  const alignMode = useScene((s) => s.alignMode);
  const measureMode = useScene((s) => s.measureMode);
  const setDragInfo = useScene((s) => s.setDragInfo);

  const pivot = useMemo(() => new THREE.Object3D(), []);
  const controlsRef = useRef<TransformControlsImpl | null>(null);
  const drag = useRef<DragState | null>(null);

  const ids = useMemo(
    () => selection.filter((id) => nodes[id] && !nodes[id].locked),
    [selection, nodes],
  );

  // Re-center the pivot whenever the selection or the scene graph changes
  // (but never mid-drag).
  useEffect(() => {
    if (drag.current || ids.length === 0) return;
    const box = new THREE.Box3();
    let any = false;
    for (const id of ids) {
      const b = sceneApi.getNodeBounds(id);
      if (b) {
        box.union(b);
        any = true;
      }
    }
    pivot.position.copy(
      any ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(),
    );
    pivot.rotation.set(0, 0, 0);
    pivot.scale.set(1, 1, 1);
    pivot.updateMatrixWorld(true);
  }, [ids, nodes, pivot]);

  useEffect(() => {
    gizmoState.controls = controlsRef.current;
    return () => {
      gizmoState.controls = null;
    };
  });

  // Align and measure modes keep the scene free of grabbable gizmos.
  if (ids.length === 0 || alignMode || measureMode) return null;

  const collectObjects = () => {
    const out: DragState["objects"] = [];
    for (const id of ids) {
      let found: THREE.Object3D | null = null;
      scene.traverse((o) => {
        if (!found && o.userData.nodeId === id) found = o;
      });
      if (found) {
        const obj = found as THREE.Object3D;
        obj.updateMatrixWorld(true);
        out.push({ id, obj, start: obj.matrixWorld.clone() });
      }
    }
    return out;
  };

  const onMouseDown = () => {
    pivot.updateMatrixWorld(true);
    drag.current = {
      pivotStart: pivot.matrixWorld.clone(),
      objects: collectObjects(),
    };
  };

  const onObjectChange = () => {
    const d = drag.current;
    if (!d) return;
    pivot.updateMatrixWorld(true);
    const delta = pivot.matrixWorld
      .clone()
      .multiply(d.pivotStart.clone().invert());
    const m = new THREE.Matrix4();
    for (const { obj, start } of d.objects) {
      // delta and start are world matrices; convert back into the object's
      // parent frame (non-identity while editing a group in place).
      m.copy(delta).multiply(start);
      if (obj.parent) {
        obj.parent.updateWorldMatrix(true, false);
        m.premultiply(obj.parent.matrixWorld.clone().invert());
      }
      m.decompose(obj.position, obj.quaternion, obj.scale);
    }
    const fmt = (v: THREE.Vector3, digits = 1) =>
      `X ${v.x.toFixed(digits)}  Y ${v.y.toFixed(digits)}  Z ${v.z.toFixed(digits)}`;
    if (mode === "translate") setDragInfo(fmt(pivot.position));
    else if (mode === "scale") setDragInfo(fmt(pivot.scale, 2));
    else {
      const e = pivot.rotation;
      setDragInfo(
        `X ${THREE.MathUtils.radToDeg(e.x).toFixed(0)}°  Y ${THREE.MathUtils.radToDeg(e.y).toFixed(0)}°  Z ${THREE.MathUtils.radToDeg(e.z).toFixed(0)}°`,
      );
    }
  };

  const onMouseUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragInfo(null);
    if (!d) return;
    setTransforms(
      d.objects.map(({ id, obj }) => ({
        id,
        position: obj.position.toArray() as Vec3,
        rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z] as Vec3,
        scale: obj.scale.toArray() as Vec3,
      })),
    );
  };

  return (
    <>
      <primitive object={pivot} />
      <TransformControls
        ref={controlsRef}
        object={pivot}
        mode={mode}
        translationSnap={snap ? snapStep : null}
        rotationSnap={snap ? THREE.MathUtils.degToRad(15) : null}
        scaleSnap={snap ? 0.1 : null}
        onMouseDown={onMouseDown}
        onObjectChange={onObjectChange}
        onMouseUp={onMouseUp}
      />
    </>
  );
}
