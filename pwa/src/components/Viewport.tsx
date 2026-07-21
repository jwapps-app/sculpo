import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useScene } from "../state/store";
import { isGroup } from "../types/scene";
import { ShapeMesh } from "./ShapeMesh";
import { Gizmo } from "./Gizmo";

// CAD/STL convention: Z is up, the workplane is XY.
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export function Viewport() {
  const nodes = useScene((s) => s.project.nodes);
  const rootOrder = useScene((s) => s.project.rootOrder);
  const clearSelection = useScene((s) => s.clearSelection);

  return (
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
        if (!node || isGroup(node)) return null; // group rendering arrives with CSG
        return <ShapeMesh key={id} node={node} />;
      })}

      <Gizmo />
      <OrbitControls makeDefault />
    </Canvas>
  );
}
