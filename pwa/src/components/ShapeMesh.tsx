import { useMemo } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { ShapeNode } from "../types/scene";
import { buildGeometry } from "../lib/primitives";
import { workplaneFromHit } from "../lib/workplane";
import { useScene } from "../state/store";

// Shared by shapes and groups: while the workplane tool is armed, a click on
// any face re-anchors the workplane instead of selecting.
export function handleMeshClick(e: ThreeEvent<MouseEvent>, nodeId: string) {
  e.stopPropagation();
  const s = useScene.getState();
  if (s.workplaneArmed) {
    if (e.face) {
      const normal = e.face.normal
        .clone()
        .transformDirection(e.object.matrixWorld);
      s.setWorkplane(workplaneFromHit(e.point, normal));
    }
    return;
  }
  s.select(nodeId, e.shiftKey);
}

export function ShapeMesh({ node }: { node: ShapeNode }) {
  const selected = useScene((s) => s.selection.includes(node.id));

  const geometry = useMemo(
    () => buildGeometry(node),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.kind, JSON.stringify(node.params)],
  );

  const isHole = node.role === "hole";

  return (
    <mesh
      name={node.id}
      userData={{ nodeId: node.id }}
      geometry={geometry}
      position={node.position}
      rotation={node.rotation}
      scale={node.scale}
      onClick={(e) => handleMeshClick(e, node.id)}
    >
      <meshStandardMaterial
        color={isHole ? "#9aa0a6" : node.color}
        transparent={isHole}
        opacity={isHole ? 0.4 : 1}
        emissive={selected ? "#2a6cd4" : "#000000"}
        emissiveIntensity={selected ? 0.35 : 0}
        roughness={0.65}
        metalness={0.05}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
