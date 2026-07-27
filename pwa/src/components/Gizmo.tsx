import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { TransformControls } from "@react-three/drei";
import * as THREE from "three";
import type { TransformControls as TransformControlsImpl } from "three-stdlib";
import { useScene } from "../state/store";
import { gizmoState } from "../lib/gizmoState";
import { sceneApi } from "../lib/sceneApi";
import { formatLength } from "../lib/units";
import { useCoarsePointer } from "../lib/pointer";
import type { Vec3 } from "../types/scene";

interface DragState {
  pivotStart: THREE.Matrix4;
  objects: {
    id: string;
    obj: THREE.Object3D;
    start: THREE.Matrix4;
    // Local transform at press, for reverting sub-threshold jitter.
    startLocal: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 };
  }[];
  downClient: { x: number; y: number };
  crossed: boolean;
}

// A press only becomes a transform once the pointer travels past this many
// pixels. Set generously — a hand drifts several pixels during a normal
// click, and because the transform re-baselines when this is crossed, the
// dead zone costs a real drag nothing (movement just starts from here).
const DRAG_THRESHOLD = 8;

// Latest pointer position, so onMouseDown knows where the press landed.
const lastPointer = { x: 0, y: 0 };
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointermove",
    (e) => {
      lastPointer.x = e.clientX;
      lastPointer.y = e.clientY;
    },
    { passive: true },
  );
  window.addEventListener(
    "pointerdown",
    (e) => {
      lastPointer.x = e.clientX;
      lastPointer.y = e.clientY;
    },
    { passive: true, capture: true },
  );
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
  const coarse = useCoarsePointer();

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
  // On touch each mode gets exactly one grabbable tool, so a fingertip can
  // never land on two at once: Move = arrows, Rotate = rings, Scale = the
  // resize handles (which beat the scale gizmo here — bigger targets, and
  // they show the dimension you're editing). Desktop keeps both.
  if (coarse && mode === "scale") return null;

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
        out.push({
          id,
          obj,
          start: obj.matrixWorld.clone(),
          startLocal: {
            pos: obj.position.clone(),
            quat: obj.quaternion.clone(),
            scale: obj.scale.clone(),
          },
        });
      }
    }
    return out;
  };

  const onMouseDown = () => {
    pivot.updateMatrixWorld(true);
    drag.current = {
      pivotStart: pivot.matrixWorld.clone(),
      objects: collectObjects(),
      downClient: { x: lastPointer.x, y: lastPointer.y },
      crossed: false,
    };
  };

  const onObjectChange = () => {
    const d = drag.current;
    if (!d) return;
    // The fling guard is only for translate: a view-aligned drag plane turns a
    // few pixels of click-jitter into a big slide. Rotate/scale don't have
    // that (a pure click on a ring or handle changes nothing), and the guard's
    // hold-then-rebaseline fought the rotation snap — showing 15° while the
    // shape stayed put. So gate it on translate only.
    if (mode === "translate" && !d.crossed) {
      const dist = Math.hypot(
        lastPointer.x - d.downClient.x,
        lastPointer.y - d.downClient.y,
      );
      for (const { obj, startLocal } of d.objects) {
        obj.position.copy(startLocal.pos);
        obj.quaternion.copy(startLocal.quat);
        obj.scale.copy(startLocal.scale);
      }
      if (dist < DRAG_THRESHOLD) return;
      // Crossing: re-baseline so the slide is measured only from HERE, not
      // from the press — the pixels of jitter that got us here are discarded
      // rather than applied all at once.
      d.crossed = true;
      pivot.updateMatrixWorld(true);
      d.pivotStart = pivot.matrixWorld.clone();
      for (const o of d.objects) {
        o.obj.updateMatrixWorld(true);
        o.start = o.obj.matrixWorld.clone();
      }
      return;
    }
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
    const units = useScene.getState().units;
    if (mode === "translate") {
      const p = pivot.position;
      setDragInfo(
        `X ${formatLength(p.x, units)}  Y ${formatLength(p.y, units)}  Z ${formatLength(p.z, units)} ${units}`,
      );
    } else if (mode === "scale") {
      const v = pivot.scale;
      setDragInfo(`X ${v.x.toFixed(2)}×  Y ${v.y.toFixed(2)}×  Z ${v.z.toFixed(2)}×`);
    }
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
    // Commit only if something actually changed. For translate that means the
    // drag crossed the threshold (below it, objects were held at start); for
    // rotate/scale, that a pure click (which moves nothing) leaves them at
    // start. Either way, an unchanged press adds no undo step.
    const changed = d.objects.some(
      ({ obj, startLocal }) =>
        !obj.position.equals(startLocal.pos) ||
        !obj.quaternion.equals(startLocal.quat) ||
        !obj.scale.equals(startLocal.scale),
    );
    if (!changed) {
      for (const { obj, startLocal } of d.objects) {
        obj.position.copy(startLocal.pos);
        obj.quaternion.copy(startLocal.quat);
        obj.scale.copy(startLocal.scale);
      }
      return;
    }
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
        // Bigger arrows and rings for fingertips.
        size={coarse ? 1.5 : 1}
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
