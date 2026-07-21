import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useScene } from "../state/store";
import { isGroup, type PrimitiveKind, type SceneNode } from "../types/scene";
import { sceneApi, type ViewName } from "../lib/sceneApi";
import { gizmoState } from "../lib/gizmoState";
import { ShapeMesh } from "./ShapeMesh";
import { GroupMesh } from "./GroupMesh";
import { Gizmo } from "./Gizmo";
import { ResizeHandles } from "./ResizeHandles";
import { SceneRig } from "./SceneRig";

// CAD/STL convention: Z is up, the workplane is XY.
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export const SHAPE_DRAG_TYPE = "application/x-shape-kind";

const VIEWS: { view: ViewName; label: string; key: string }[] = [
  { view: "top", label: "Top", key: "1" },
  { view: "front", label: "Front", key: "2" },
  { view: "right", label: "Right", key: "3" },
  { view: "iso", label: "Iso", key: "4" },
];

function ViewButtons() {
  const ortho = useScene((s) => s.ortho);
  const setOrtho = useScene((s) => s.setOrtho);
  return (
    <div className="absolute left-2 top-2 flex flex-col gap-1">
      {VIEWS.map(({ view, label, key }) => (
        <button
          key={view}
          onClick={() => sceneApi.setView(view)}
          title={`${label} view (${key})`}
          className="w-14 rounded border border-neutral-300 bg-white/90 px-1.5 py-0.5 text-xs text-neutral-600 hover:bg-white"
        >
          {label}
        </button>
      ))}
      <button
        onClick={() => sceneApi.zoomToFit()}
        title="Zoom to fit (F)"
        className="w-14 rounded border border-neutral-300 bg-white/90 px-1.5 py-0.5 text-xs font-medium text-neutral-700 hover:bg-white"
      >
        Fit
      </button>
      <button
        onClick={() => setOrtho(!ortho)}
        title="Toggle orthographic projection"
        className={`w-14 rounded border px-1.5 py-0.5 text-xs ${
          ortho
            ? "border-neutral-700 bg-neutral-800 text-white"
            : "border-neutral-300 bg-white/90 text-neutral-600 hover:bg-white"
        }`}
      >
        Ortho
      </button>
    </div>
  );
}

// Swaps between perspective and orthographic cameras, carrying the viewpoint
// (position, target, apparent zoom) across the switch.
function Cameras() {
  const ortho = useScene((s) => s.ortho);
  const persp = useRef<THREE.PerspectiveCamera>(null);
  const orthoCam = useRef<THREE.OrthographicCamera>(null);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const prev = useRef(ortho);

  useEffect(() => {
    if (prev.current === ortho) return;
    prev.current = ortho;
    const from = ortho ? persp.current : orthoCam.current;
    const to = ortho ? orthoCam.current : persp.current;
    if (!from || !to) return;
    const target = controls
      ? controls.target.clone()
      : new THREE.Vector3(0, 0, 0);
    to.up.set(0, 0, 1);
    to.position.copy(from.position);
    if (ortho) {
      const d = from.position.distanceTo(target);
      (to as THREE.OrthographicCamera).zoom =
        size.height / (2 * d * Math.tan(THREE.MathUtils.degToRad(22.5)));
    }
    to.updateProjectionMatrix();
    to.lookAt(target);
  }, [ortho, controls, size.height]);

  // Restore the orbit target after drei rebuilds the controls for the new
  // default camera.
  const savedTarget = useRef(new THREE.Vector3());
  useEffect(() => {
    if (controls) {
      controls.target.copy(savedTarget.current);
      controls.update();
      const save = () => savedTarget.current.copy(controls.target);
      controls.addEventListener("change", save);
      return () => controls.removeEventListener("change", save);
    }
  }, [controls]);

  return (
    <>
      <PerspectiveCamera
        ref={persp}
        makeDefault={!ortho}
        position={[90, -90, 70]}
        up={[0, 0, 1]}
        fov={45}
        near={0.1}
        far={5000}
      />
      <OrthographicCamera
        ref={orthoCam}
        makeDefault={ortho}
        position={[90, -90, 70]}
        up={[0, 0, 1]}
        near={-5000}
        far={5000}
      />
    </>
  );
}

function WorkplaneGrid() {
  const workplane = useScene((s) => s.workplane);
  const quaternion = useMemo(() => {
    if (!workplane) return null;
    return new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...workplane.rotation, "XYZ"),
    );
  }, [workplane]);
  if (!workplane || !quaternion) return null;
  return (
    <group position={workplane.position} quaternion={quaternion}>
      <Grid
        rotation={[Math.PI / 2, 0, 0]}
        raycast={() => null}
        infiniteGrid
        cellSize={1}
        cellThickness={0.5}
        sectionSize={10}
        sectionThickness={1.2}
        cellColor="#d9a05b"
        sectionColor="#b97a2e"
        fadeDistance={220}
        fadeStrength={1.2}
        side={THREE.DoubleSide}
      />
    </group>
  );
}

function DragChip() {
  const dragInfo = useScene((s) => s.dragInfo);
  if (!dragInfo) return null;
  return (
    <div className="pointer-events-none absolute right-2 top-2 rounded bg-neutral-800/90 px-2 py-1 font-mono text-xs text-white">
      {dragInfo}
    </div>
  );
}

function renderNode(node: SceneNode, dimmed: boolean) {
  return isGroup(node) ? (
    <GroupMesh key={node.id} node={node} dimmed={dimmed} />
  ) : (
    <ShapeMesh key={node.id} node={node} dimmed={dimmed} />
  );
}

interface MarqueeRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function Viewport() {
  const nodes = useScene((s) => s.project.nodes);
  const rootOrder = useScene((s) => s.project.rootOrder);
  const clearSelection = useScene((s) => s.clearSelection);
  const workplaneArmed = useScene((s) => s.workplaneArmed);
  const editingGroupId = useScene((s) => s.editingGroupId);
  const setEditingGroup = useScene((s) => s.setEditingGroup);

  const editingGroup =
    editingGroupId && nodes[editingGroupId] && isGroup(nodes[editingGroupId])
      ? nodes[editingGroupId]
      : null;

  // If the edited group vanished (undo, load), leave edit mode.
  useEffect(() => {
    if (editingGroupId && !editingGroup) setEditingGroup(null);
  }, [editingGroupId, editingGroup, setEditingGroup]);

  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const marqueeEndedAt = useRef(0);
  // A pointer that went down on empty canvas but hasn't moved enough to be a
  // marquee yet. Capturing here would swallow the browser's click event (and
  // with it click-to-deselect), so capture only once dragging actually starts.
  const pendingMarquee = useRef<{ x: number; y: number } | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (!(e.target instanceof HTMLCanvasElement)) return;
    if (useScene.getState().workplaneArmed) return;
    if (gizmoState.busy()) return;
    if (sceneApi.hitTestNodes(e.clientX, e.clientY)) return;
    pendingMarquee.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const pending = pendingMarquee.current;
    if (pending && !marquee) {
      if (Math.abs(e.clientX - pending.x) >= 4 || Math.abs(e.clientY - pending.y) >= 4) {
        setMarquee({ x1: pending.x, y1: pending.y, x2: e.clientX, y2: e.clientY });
        wrapper.current?.setPointerCapture(e.pointerId);
      }
      return;
    }
    setMarquee((m) => (m ? { ...m, x2: e.clientX, y2: e.clientY } : m));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pendingMarquee.current = null;
    if (!marquee) return;
    wrapper.current?.releasePointerCapture(e.pointerId);
    const { x1, y1, x2, y2 } = marquee;
    setMarquee(null);
    marqueeEndedAt.current = performance.now();
    const picked = sceneApi.pickInRect(x1, y1, x2, y2);
    const s = useScene.getState();
    s.setSelection(e.shiftKey ? [...new Set([...s.selection, ...picked])] : picked);
  };

  const marqueeStyle = useMemo(() => {
    if (!marquee || !wrapper.current) return null;
    const host = wrapper.current.getBoundingClientRect();
    return {
      left: Math.min(marquee.x1, marquee.x2) - host.left,
      top: Math.min(marquee.y1, marquee.y2) - host.top,
      width: Math.abs(marquee.x2 - marquee.x1),
      height: Math.abs(marquee.y2 - marquee.y1),
    };
  }, [marquee]);

  return (
    <div
      ref={wrapper}
      className="relative h-full w-full"
      style={{ cursor: workplaneArmed ? "crosshair" : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={(e) => {
        if (
          editingGroupId &&
          e.target instanceof HTMLCanvasElement &&
          !sceneApi.hitTestNodes(e.clientX, e.clientY)
        ) {
          setEditingGroup(null);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(SHAPE_DRAG_TYPE)) e.preventDefault();
      }}
      onDrop={(e) => {
        const kind = e.dataTransfer.getData(SHAPE_DRAG_TYPE);
        if (!kind) return;
        e.preventDefault();
        sceneApi.dropShape(kind as PrimitiveKind, e.clientX, e.clientY);
      }}
    >
      <Canvas
        onPointerMissed={(e) => {
          // Only a plain left-click on empty canvas deselects. Orbiting ends
          // with a contextmenu/right-button event that also lands here.
          if (e.type !== "click" || e.button !== 0) return;
          // A finished marquee or handle drag also ends with a click on empty
          // canvas — don't let that wipe the selection it just made.
          if (performance.now() - marqueeEndedAt.current < 300) return;
          if (performance.now() - gizmoState.lastInteractionEnd < 300) return;
          const s = useScene.getState();
          if (s.workplaneArmed) {
            // Workplane dropped on empty space resets to the floor.
            s.setWorkplane(null);
            return;
          }
          clearSelection();
        }}
        className="bg-neutral-100"
      >
        <Cameras />
        <ambientLight intensity={0.7} />
        <directionalLight position={[80, -60, 120]} intensity={1.4} />
        <directionalLight position={[-60, 80, 40]} intensity={0.4} />

        <Grid
          rotation={[Math.PI / 2, 0, 0]}
          raycast={() => null}
          infiniteGrid
          cellSize={1}
          cellThickness={0.4}
          sectionSize={10}
          sectionThickness={1}
          cellColor="#b8bcc4"
          sectionColor="#8a909c"
          fadeDistance={600}
          fadeStrength={1.5}
          side={THREE.DoubleSide}
        />
        <WorkplaneGrid />

        {rootOrder.map((id) => {
          const node = nodes[id];
          if (!node) return null;
          if (editingGroup && id === editingGroup.id) {
            // Edit-in-place: the group's children render live in its frame.
            return (
              <group
                key={id}
                position={editingGroup.position}
                rotation={editingGroup.rotation}
                scale={editingGroup.scale}
              >
                {editingGroup.childIds.map((cid) => {
                  const child = nodes[cid];
                  return child ? renderNode(child, false) : null;
                })}
              </group>
            );
          }
          return renderNode(node, editingGroup !== null);
        })}

        <Gizmo />
        <ResizeHandles />
        <OrbitControls
          makeDefault
          mouseButtons={{
            LEFT: undefined,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.ROTATE,
          }}
        />
        <SceneRig />
      </Canvas>
      <ViewButtons />
      <DragChip />
      {marqueeStyle && (
        <div
          className="pointer-events-none absolute border border-blue-500 bg-blue-500/10"
          style={marqueeStyle}
        />
      )}
      {workplaneArmed && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-neutral-800/90 px-3 py-1 text-xs text-white">
          Click a face to set the workplane — click empty space to reset
        </div>
      )}
      {editingGroup && (
        <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded bg-neutral-800/90 px-3 py-1 text-xs text-white">
          Editing group
          <button
            onClick={() => setEditingGroup(null)}
            className="rounded bg-white/20 px-2 py-0.5 hover:bg-white/30"
          >
            Done (Esc)
          </button>
        </div>
      )}
    </div>
  );
}
