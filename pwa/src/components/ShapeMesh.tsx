import { useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import type { ShapeNode } from "../types/scene";
import { buildGeometry } from "../lib/primitives";
import { useScene } from "../state/store";

export function ShapeMesh({ node }: { node: ShapeNode }) {
  const select = useScene((s) => s.select);
  const selected = useScene((s) => s.selection.includes(node.id));

  const geometry = useMemo(
    () => buildGeometry(node),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.kind, JSON.stringify(node.params)],
  );

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    select(node.id, e.shiftKey);
  };

  const isHole = node.role === "hole";

  return (
    <mesh
      name={node.id}
      userData={{ nodeId: node.id }}
      geometry={geometry}
      position={node.position}
      rotation={node.rotation}
      scale={node.scale}
      onClick={onClick}
    >
      <meshStandardMaterial
        color={isHole ? "#9aa0a6" : node.color}
        transparent={isHole}
        opacity={isHole ? 0.4 : 1}
        emissive={selected ? "#2a6cd4" : "#000000"}
        emissiveIntensity={selected ? 0.35 : 0}
        roughness={0.65}
        metalness={0.05}
      />
    </mesh>
  );
}
