import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useScene } from "../state/store";
import { isGroup, type PrimitiveKind } from "../types/scene";
import { sceneApi, type ViewName } from "../lib/sceneApi";
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

export function Viewport() {
  const nodes = useScene((s) => s.project.nodes);
  const rootOrder = useScene((s) => s.project.rootOrder);
  const clearSelection = useScene((s) => s.clearSelection);

  return (
    <div
      className="relative h-full w-full"
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
        onPointerMissed={() => clearSelection()}
        className="bg-neutral-100"
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[80, -60, 120]} intensity={1.4} />
        <directionalLight position={[-60, 80, 40]} intensity={0.4} />

        <Grid
          rotation={[Math.PI / 2, 0, 0]}
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
        <OrbitControls makeDefault />
        <SceneRig />
      </Canvas>
      <ViewButtons />
    </div>
  );
}
