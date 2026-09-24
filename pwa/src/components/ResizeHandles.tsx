import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useScene } from "../state/store";
import { sceneApi } from "../lib/sceneApi";
import { gizmoState } from "../lib/gizmoState";
import { AXIS_COLORS } from "../constants/ui";
import { formatLength, fromDisplay } from "../lib/units";
import { isCoarsePointer, useCoarsePointer } from "../lib/pointer";
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

// Slightly proud of the faces so the front edges pass the depth test the box
// itself wrote, while its back edges are culled — the handle reads as a solid
// little cube instead of a busy wireframe.
const HANDLE_EDGES = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));

type Axis = 0 | 1 | 2;

// Hover/edit: a mid-edge handle owns the dimension of the line it sits on
// (the axis the edge runs along), so clicking it edits that edge's length.
function dimsFor(def: HandleDef): Axis[] {
  if (def.kind === "top") return [2];
  if (def.kind === "corner") return [0, 1];
  return def.dir[0] !== 0 ? [1] : [0];
}

// Dragging is physical: it pushes the face outward, changing the axis
// perpendicular to that edge — the live readout shows what the drag changes.
function dragDimsFor(def: HandleDef): Axis[] {
  if (def.kind === "top") return [2];
  if (def.kind === "corner") return [0, 1];
  return def.dir[0] !== 0 ? [0] : [1];
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

function anchorFor(def: HandleDef, bbox: THREE.Box3): THREE.Vector3 {
  const center = bbox.getCenter(new THREE.Vector3());
  if (def.kind === "top") return new THREE.Vector3(center.x, center.y, bbox.min.z);
  return new THREE.Vector3(
    def.dir[0] > 0 ? bbox.min.x : def.dir[0] < 0 ? bbox.max.x : center.x,
    def.dir[1] > 0 ? bbox.min.y : def.dir[1] < 0 ? bbox.max.y : center.y,
    bbox.min.z,
  );
}

interface DragState {
  def: HandleDef;
  bbox: THREE.Box3;
  anchor: THREE.Vector3;
  start: THREE.Vector3;
  uniform: boolean;
  objects: { id: string; obj: THREE.Object3D; startWorld: THREE.Matrix4 }[];
  // A press only becomes a resize once the pointer travels past a threshold —
  // the couple of pixels a hand moves during a plain click must change nothing.
  startClient: { x: number; y: number };
  started: boolean;
}

interface LabelState {
  key: string;
  dims: { axis: Axis; mm: number }[];
}

// Tinkercad-style resize: white boxes on the selection's base corners (scale
// X+Y), base edge midpoints (scale one axis), and top center (scale height).
// Hovering shows the controlled dimensions; clicking a dimension edits it
// inline; dragging scales about the opposite corner/face (Shift = uniform).
export function ResizeHandles() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const selection = useScene((s) => s.selection);
  const nodes = useScene((s) => s.project.nodes);
  const mode = useScene((s) => s.transformMode);
  const workplaneArmed = useScene((s) => s.workplaneArmed);
  const alignMode = useScene((s) => s.alignMode);
  const measureMode = useScene((s) => s.measureMode);
  const filletMode = useScene((s) => s.filletMode);
  const units = useScene((s) => s.units);

  const ids = useMemo(
    () => selection.filter((id) => nodes[id] && !nodes[id].locked && !nodes[id].hidden),
    [selection, nodes],
  );
  // Align mode shows only the align dots — handles would overlap and steal
  // their clicks. On touch, restrict the handles to Scale mode as well: a
  // fingertip covers both a gizmo arrow and a nearby resize cube, so showing
  // both in Move mode means aiming at "move" and getting "resize". A mouse is
  // precise enough that keeping both available is a convenience, not a hazard.
  const coarse = useCoarsePointer();
  const modeAllows = coarse ? mode === "scale" : mode !== "rotate";
  const visible =
    ids.length > 0 && modeAllows && !workplaneArmed && !alignMode && !measureMode && !filletMode;

  const group = useRef<THREE.Group>(null);
  const drag = useRef<DragState | null>(null);
  const meshes = useRef<Map<string, THREE.Mesh>>(new Map());
  const [label, setLabel] = useState<LabelState | null>(null);
  const [editingAxis, setEditingAxis] = useState<Axis | null>(null);
  const editingRef = useRef<Axis | null>(null);
  editingRef.current = editingAxis;
  // The label must survive the pointer's trip from the handle to the pill.
  const labelHover = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHideLabel = () => {
    // On touch there is no hover to leave, so a tapped label must persist —
    // otherwise it would vanish before it could be tapped to type a size.
    if (isCoarsePointer()) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (editingRef.current === null && !labelHover.current && !drag.current) {
        setLabel(null);
      }
    }, 350);
  };

  useEffect(() => {
    if (!visible) {
      setLabel(null);
      setEditingAxis(null);
    }
  }, [visible]);

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

  const collectObjects = (): DragState["objects"] => {
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
    return objects;
  };

  const applyDelta = (
    delta: THREE.Matrix4,
    objects: DragState["objects"],
  ) => {
    const m = new THREE.Matrix4();
    for (const { obj, startWorld } of objects) {
      m.copy(delta).multiply(startWorld);
      if (obj.parent) {
        obj.parent.updateWorldMatrix(true, false);
        m.premultiply(obj.parent.matrixWorld.clone().invert());
      }
      m.decompose(obj.position, obj.quaternion, obj.scale);
    }
  };

  const commitObjects = (objects: DragState["objects"]) => {
    useScene.getState().setTransforms(
      objects.map(({ id, obj }) => ({
        id,
        position: obj.position.toArray() as Vec3,
        rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z] as Vec3,
        scale: obj.scale.toArray() as Vec3,
      })),
    );
  };

  const scaleAbout = (anchor: THREE.Vector3, sx: number, sy: number, sz: number) =>
    new THREE.Matrix4()
      .makeTranslation(anchor.x, anchor.y, anchor.z)
      .multiply(new THREE.Matrix4().makeScale(sx, sy, sz))
      .multiply(new THREE.Matrix4().makeTranslation(-anchor.x, -anchor.y, -anchor.z));

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
      // Fingertips need a bigger grab target than a cursor does.
      const coarse = isCoarsePointer();
      const s = camera.position.distanceTo(pos) * (coarse ? 0.019 : 0.011);
      mesh.scale.setScalar(Math.max(s, coarse ? 0.8 : 0.4));
    }
  });

  const showLabelFor = (def: HandleDef) => {
    const box = selectionBounds();
    if (!box) return;
    const size = box.getSize(new THREE.Vector3());
    setLabel({
      key: def.key,
      dims: dimsFor(def).map((axis) => ({ axis, mm: size.getComponent(axis) })),
    });
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.started) {
      if (Math.hypot(e.clientX - d.startClient.x, e.clientY - d.startClient.y) < 4) return;
      d.started = true;
    }
    const rc = raycast(e.clientX, e.clientY);
    const s = useScene.getState();

    let plane: THREE.Plane;
    if (d.def.kind === "top") {
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

    const factorFor = (axis: Axis): number => {
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
        d.def.kind === "top" ? sz : Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy;
      sx = sy = sz = u;
    }

    applyDelta(scaleAbout(d.anchor, sx, sy, sz), d.objects);

    const size = d.bbox.getSize(new THREE.Vector3());
    const factors = [sx, sy, sz];
    setLabel({
      key: d.def.key,
      dims: dragDimsFor(d.def).map((axis) => ({
        axis,
        mm: size.getComponent(axis) * factors[axis],
      })),
    });
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    gizmoState.handleActive = false;
    gizmoState.lastInteractionEnd = performance.now();
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    // A click that never became a drag commits nothing; the dimension label
    // it revealed stays up for editing. On touch, surface that label on tap —
    // there was no hover to reveal it.
    if (!d || !d.started) {
      if (d && isCoarsePointer()) showLabelFor(d.def);
      return;
    }
    commitObjects(d.objects);
    setLabel(null);
  };

  const startDrag = (def: HandleDef, e: { clientX: number; clientY: number; shiftKey: boolean }) => {
    const bbox = selectionBounds();
    if (!bbox) return;
    const start = handlePosition(def, bbox, new THREE.Vector3());
    const objects = collectObjects();
    if (objects.length === 0) return;
    drag.current = {
      def,
      bbox: bbox.clone(),
      anchor: anchorFor(def, bbox),
      start,
      uniform: e.shiftKey,
      objects,
      startClient: { x: e.clientX, y: e.clientY },
      started: false,
    };
    gizmoState.handleActive = true;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Inline dimension editing: scale the selection along one axis so its
  // overall size matches the typed value, anchored like the handle drag.
  const commitDimension = (def: HandleDef, axis: Axis, text: string) => {
    setEditingAxis(null);
    const value = Number(text);
    const s = useScene.getState();
    const mm = fromDisplay(value, s.units);
    const bbox = selectionBounds();
    if (!bbox || !Number.isFinite(mm) || mm < 0.1) return;
    const cur = bbox.getSize(new THREE.Vector3()).getComponent(axis);
    if (cur < 1e-6) return;
    const factor = mm / cur;
    const factors: [number, number, number] = [1, 1, 1];
    factors[axis] = factor;
    const objects = collectObjects();
    if (objects.length === 0) return;
    applyDelta(scaleAbout(anchorFor(def, bbox), ...factors), objects);
    commitObjects(objects);
    setLabel(null);
    gizmoState.lastInteractionEnd = performance.now();
  };

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      gizmoState.handleActive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const labelDef = label ? DEFS.find((d) => d.key === label.key) : null;
  const labelMesh = label ? meshes.current.get(label.key) : null;

  return (
    <group ref={group} visible={false}>
      {DEFS.map((def) => (
        <mesh
          key={def.key}
          ref={(m) => {
            if (m) meshes.current.set(def.key, m);
            else meshes.current.delete(def.key);
          }}
          renderOrder={998}
          onPointerDown={(e) => {
            e.stopPropagation();
            gizmoState.handleActive = true;
            startDrag(def, e);
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            ((e.object as THREE.Mesh).material as THREE.MeshStandardMaterial).color.setHex(
              HOVER_COLOR,
            );
            gl.domElement.style.cursor = "pointer";
            gizmoState.handleActive = true;
            if (hideTimer.current) clearTimeout(hideTimer.current);
            if (!drag.current && editingRef.current === null) showLabelFor(def);
          }}
          onPointerOut={(e) => {
            ((e.object as THREE.Mesh).material as THREE.MeshStandardMaterial).color.setHex(
              IDLE_COLOR,
            );
            gl.domElement.style.cursor = "";
            if (!drag.current) gizmoState.handleActive = false;
            scheduleHideLabel();
          }}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={IDLE_COLOR} depthTest={false} roughness={0.4} />
          <lineSegments geometry={HANDLE_EDGES} scale={1.06} renderOrder={999}>
            <lineBasicMaterial color="#1c1c1c" />
          </lineSegments>
        </mesh>
      ))}

      {label && labelDef && labelMesh && (
        <group position={labelMesh.position}>
          <Html zIndexRange={[40, 30]} style={{ pointerEvents: "auto" }}>
            <div
              className="flex -translate-y-9 translate-x-3 gap-1 p-2"
              onPointerEnter={() => {
                labelHover.current = true;
                if (hideTimer.current) clearTimeout(hideTimer.current);
              }}
              onPointerLeave={() => {
                labelHover.current = false;
                scheduleHideLabel();
              }}
            >
              {label.dims.map(({ axis, mm }) =>
                editingAxis === axis ? (
                  <form
                    key={axis}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const input = e.currentTarget.elements[0] as HTMLInputElement;
                      commitDimension(labelDef, axis, input.value);
                    }}
                  >
                    <input
                      autoFocus
                      defaultValue={formatLength(mm, units)}
                      ref={(el) => {
                        // Select-all must survive the focus timing of embedded
                        // browsers; a frame later is reliable everywhere.
                        if (el) requestAnimationFrame(() => el.select());
                      }}
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Escape") {
                          setEditingAxis(null);
                          setLabel(null);
                        }
                      }}
                      onBlur={(e) => commitDimension(labelDef, axis, e.currentTarget.value)}
                      className="w-16 rounded border-2 bg-white px-1 py-0.5 text-xs shadow"
                      style={{ borderColor: AXIS_COLORS[axis] }}
                    />
                  </form>
                ) : (
                  <button
                    key={axis}
                    onClick={() => setEditingAxis(axis)}
                    title="Click to type an exact size"
                    className="rounded border-2 bg-white px-1.5 py-0.5 font-mono text-xs shadow hover:bg-neutral-50"
                    style={{ borderColor: AXIS_COLORS[axis] }}
                  >
                    {formatLength(mm, units)}
                    <span className="ml-0.5 text-neutral-400">{units}</span>
                  </button>
                ),
              )}
            </div>
          </Html>
        </group>
      )}
    </group>
  );
}
