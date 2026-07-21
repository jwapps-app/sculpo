import { useMemo } from "react";
import * as THREE from "three";
import type { GroupNode } from "../types/scene";
import { evaluateGroup, firstSolidColor, subtreeSignature } from "../lib/csg";
import { useScene } from "../state/store";
import { handleMeshClick } from "./ShapeMesh";

export function GroupMesh({ node }: { node: GroupNode }) {
  const selected = useScene((s) => s.selection.includes(node.id));
  const signature = useScene((s) => subtreeSignature(node, s.project.nodes));
  const nodes = useScene((s) => s.project.nodes);

  // Re-runs only when a descendant changes, not when the group moves.
  const geometry = useMemo(
    () => evaluateGroup(node, nodes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );
  const color = useMemo(
    () => firstSolidColor(node, nodes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );

  if (!geometry) return null;

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
        color={color}
        emissive={selected ? "#2a6cd4" : "#000000"}
        emissiveIntensity={selected ? 0.35 : 0}
        roughness={0.65}
        metalness={0.05}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
