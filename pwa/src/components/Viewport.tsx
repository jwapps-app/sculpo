import { useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useScene } from "../state/store";
import { isGroup, type PrimitiveKind } from "../types/scene";
import { sceneApi, type ViewName } from "../lib/sceneApi";
import { gizmoState } from "../lib/gizmoState";
import { ShapeMesh } from "./ShapeMesh";
import { GroupMesh } from "./GroupMesh";
import { Gizmo } from "./Gizmo";
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
    </div>
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

  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const marqueeEndedAt = useRef(0);
  const wrapper = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (!(e.target instanceof HTMLCanvasElement)) return;
    if (useScene.getState().workplaneArmed) return;
    if (gizmoState.busy()) return;
    if (sceneApi.hitTestNodes(e.clientX, e.clientY)) return;
    setMarquee({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY });
    wrapper.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    setMarquee((m) => (m ? { ...m, x2: e.clientX, y2: e.clientY } : m));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!marquee) return;
    wrapper.current?.releasePointerCapture(e.pointerId);
    const { x1, y1, x2, y2 } = marquee;
    setMarquee(null);
    if (Math.abs(x2 - x1) < 4 && Math.abs(y2 - y1) < 4) return; // plain click
    marqueeEndedAt.current = performance.now();
    const picked = sceneApi.pickInRect(x1, y1, x2, y2);
    const s = useScene.getState();
    s.setSelection(e.shiftKey ? [...new Set([...s.selection, ...picked])] : picked);
  };

  const marqueeStyle = useMemo(() => {
    if (!marquee || !wrapper.current) return null;
    const host = wrapper.current.getBoundingClientRect();
    const left = Math.min(marquee.x1, marquee.x2) - host.left;
    const top = Math.min(marquee.y1, marquee.y2) - host.top;
    return {
      left,
      top,
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
        camera={{ position: [90, -90, 70], fov: 45, up: [0, 0, 1], near: 0.1, far: 5000 }}
        onPointerMissed={() => {
          // A finished marquee also ends with a click on empty canvas — don't
          // let that wipe the selection it just made.
          if (performance.now() - marqueeEndedAt.current < 300) return;
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
          return isGroup(node) ? (
            <GroupMesh key={id} node={node} />
          ) : (
            <ShapeMesh key={id} node={node} />
          );
        })}

        <Gizmo />
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
    </div>
  );
}
