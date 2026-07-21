import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useScene } from "../state/store";
import { sceneApi } from "../lib/sceneApi";
import { gizmoState } from "../lib/gizmoState";
import type { Vec3 } from "../types/scene";

interface HandleDef {
  key: string;
  dir: [number, number]; // XY sign of the handle on the base rectangle
  kind: "corner" | "side" | "top";
}

const DEFS: HandleDef[] = [
  { key: "c1", dir: [1, 1], kind: "corner" },
  { key: "c2", dir: [1, -1], kind: "corner" },
  { key: "c3", dir: [-1, 1], kind: "corner" },
  { key: "c4", dir: [-1, -1], kind: "corner" },
  { key: "sx+", dir: [1, 0], kind: "side" },
  { key: "sx-", dir: [-1, 0], kind: "side" },
  { key: "sy+", dir: [0, 1], kind: "side" },
  { key: "sy-", dir: [0, -1], kind: "side" },
  { key: "top", dir: [0, 0], kind: "top" },
];

const IDLE_COLOR = 0xffffff;
const HOVER_COLOR = 0x2a6cd4;
const MIN_FACTOR = 0.02;

const HANDLE_EDGES = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));

interface DragState {
  def: HandleDef;
  bbox: THREE.Box3;
  anchor: THREE.Vector3;
  start: THREE.Vector3;
  uniform: boolean;
  objects: { id: string; obj: THREE.Object3D; startWorld: THREE.Matrix4 }[];
}

function handlePosition(def: HandleDef, bbox: THREE.Box3, out: THREE.Vector3) {
  const c = bbox.getCenter(new THREE.Vector3());
  if (def.kind === "top") return out.set(c.x, c.y, bbox.max.z);
  return out.set(
    def.dir[0] === 0 ? c.x : def.dir[0] > 0 ? bbox.max.x : bbox.min.x,
    def.dir[1] === 0 ? c.y : def.dir[1] > 0 ? bbox.max.y : bbox.min.y,
    bbox.min.z,
  );
}

// Tinkercad-style resize: white boxes on the selection's base corners (scale
// X+Y), base edge midpoints (scale one axis), and top center (scale height).
// Dragging scales about the opposite corner/face; Shift scales uniformly.
export function ResizeHandles() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const selection = useScene((s) => s.selection);
  const nodes = useScene((s) => s.project.nodes);
  const mode = useScene((s) => s.transformMode);
  const workplaneArmed = useScene((s) => s.workplaneArmed);

  const ids = useMemo(
    () => selection.filter((id) => nodes[id] && !nodes[id].locked && !nodes[id].hidden),
    [selection, nodes],
  );
  const visible = ids.length > 0 && mode !== "rotate" && !workplaneArmed;

  const group = useRef<THREE.Group>(null);
  const drag = useRef<DragState | null>(null);
  const meshes = useRef<Map<string, THREE.Mesh>>(new Map());

  const raycast = (clientX: number, clientY: number): THREE.Raycaster => {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, camera);
    return rc;
  };

  const selectionBounds = (): THREE.Box3 | null => {
    const box = new THREE.Box3();
    let any = false;
    for (const id of ids) {
      const b = sceneApi.getNodeBounds(id);
      if (b) {
        box.union(b);
        any = true;
      }
    }
    return any ? box : null;
  };

  // Keep handles glued to the live selection bounds and screen-constant sized.
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const box = visible ? selectionBounds() : null;
    g.visible = !!box;
    if (!box) return;
    const pos = new THREE.Vector3();
    for (const def of DEFS) {
      const mesh = meshes.current.get(def.key);
      if (!mesh) continue;
      handlePosition(def, box, pos);
      mesh.position.copy(pos);
      const s = camera.position.distanceTo(pos) * 0.011;
      mesh.scale.setScalar(Math.max(s, 0.4));
    }
  });

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const rc = raycast(e.clientX, e.clientY);
    const s = useScene.getState();

    let plane: THREE.Plane;
    if (d.def.kind === "top") {
      // Vertical plane through the handle, facing the camera.
      const n = camera.position.clone().sub(d.start);
      n.z = 0;
      if (n.lengthSq() < 1e-6) return;
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n.normalize(), d.start);
    } else {
      plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -d.bbox.min.z);
    }
    const hit = new THREE.Vector3();
    if (!rc.ray.intersectPlane(plane, hit)) return;
    if (s.snap) {
      hit.x = Math.round(hit.x / s.snapStep) * s.snapStep;
      hit.y = Math.round(hit.y / s.snapStep) * s.snapStep;
      hit.z = Math.round(hit.z / s.snapStep) * s.snapStep;
    }

    const factorFor = (axis: 0 | 1 | 2): number => {
      const span = d.start.getComponent(axis) - d.anchor.getComponent(axis);
      if (Math.abs(span) < 1e-6) return 1;
      return Math.max(
        (hit.getComponent(axis) - d.anchor.getComponent(axis)) / span,
        MIN_FACTOR,
      );
    };

    let sx = 1;
    let sy = 1;
    let sz = 1;
    if (d.def.kind === "top") sz = factorFor(2);
    else {
      if (d.def.dir[0] !== 0) sx = factorFor(0);
      if (d.def.dir[1] !== 0) sy = factorFor(1);
    }
    if (d.uniform || e.shiftKey) {
      const u =
        d.def.kind === "top"
          ? sz
          : Math.abs(sx - 1) > Math.abs(sy - 1)
            ? sx
            : sy;
      sx = sy = sz = u;
    }

    const delta = new THREE.Matrix4()
      .makeTranslation(d.anchor.x, d.anchor.y, d.anchor.z)
      .multiply(new THREE.Matrix4().makeScale(sx, sy, sz))
      .multiply(new THREE.Matrix4().makeTranslation(-d.anchor.x, -d.anchor.y, -d.anchor.z));

    const m = new THREE.Matrix4();
    for (const { obj, startWorld } of d.objects) {
      m.copy(delta).multiply(startWorld);
      if (obj.parent) {
        obj.parent.updateWorldMatrix(true, false);
        m.premultiply(obj.parent.matrixWorld.clone().invert());
      }
      m.decompose(obj.position, obj.quaternion, obj.scale);
    }

    const size = d.bbox.getSize(new THREE.Vector3());
    s.setDragInfo(
      `${(size.x * sx).toFixed(1)} × ${(size.y * sy).toFixed(1)} × ${(size.z * sz).toFixed(1)} mm`,
    );
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    gizmoState.handleActive = false;
    gizmoState.lastInteractionEnd = performance.now();
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    const s = useScene.getState();
    s.setDragInfo(null);
    if (!d) return;
    s.setTransforms(
      d.objects.map(({ id, obj }) => ({
        id,
        position: obj.position.toArray() as Vec3,
        rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z] as Vec3,
        scale: obj.scale.toArray() as Vec3,
      })),
    );
  };

  const startDrag = (def: HandleDef, e: { clientX: number; clientY: number; shiftKey: boolean }) => {
    const bbox = selectionBounds();
    if (!bbox) return;
    const start = handlePosition(def, bbox, new THREE.Vector3());
    const center = bbox.getCenter(new THREE.Vector3());
    const anchor =
      def.kind === "top"
        ? new THREE.Vector3(center.x, center.y, bbox.min.z)
        : new THREE.Vector3(
            def.dir[0] > 0 ? bbox.min.x : def.dir[0] < 0 ? bbox.max.x : center.x,
            def.dir[1] > 0 ? bbox.min.y : def.dir[1] < 0 ? bbox.max.y : center.y,
            bbox.min.z,
          );
    const objects: DragState["objects"] = [];
    for (const id of ids) {
      let found: THREE.Object3D | null = null;
      scene.traverse((o) => {
        if (!found && o.userData.nodeId === id) found = o;
      });
      if (found) {
        const obj = found as THREE.Object3D;
        obj.updateWorldMatrix(true, false);
        objects.push({ id, obj, startWorld: obj.matrixWorld.clone() });
      }
    }
    if (objects.length === 0) return;
    drag.current = { def, bbox: bbox.clone(), anchor, start, uniform: e.shiftKey, objects };
    gizmoState.handleActive = true;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      gizmoState.handleActive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <group ref={group} visible={false}>
      {DEFS.map((def) => (
        <mesh
          key={def.key}
          ref={(m) => {
            if (m) meshes.current.set(def.key, m);
            else meshes.current.delete(def.key);
          }}
          renderOrder={999}
          onPointerDown={(e) => {
            e.stopPropagation();
            gizmoState.handleActive = true;
            startDrag(def, e);
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            ((e.object as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(
              HOVER_COLOR,
            );
            gl.domElement.style.cursor = "pointer";
          }}
          onPointerOut={(e) => {
            ((e.object as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(
              IDLE_COLOR,
            );
            gl.domElement.style.cursor = "";
          }}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color={IDLE_COLOR} depthTest={false} toneMapped={false} />
          <lineSegments geometry={HANDLE_EDGES} renderOrder={1000}>
            <lineBasicMaterial color="#000000" depthTest={false} toneMapped={false} />
          </lineSegments>
        </mesh>
      ))}
    </group>
  );
}
