import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { GroupNode } from "../types/scene";
import { nodeRole } from "../types/scene";
import { firstSolidColor, subtreeSignature } from "../lib/csg";
import { evaluateGroupAsync } from "../lib/csgAsync";
import { useManifoldLoaded } from "../lib/manifold";
import { useScene } from "../state/store";
import { handleMeshClick, MeshEdges } from "./ShapeMesh";

export function GroupMesh({ node, dimmed = false }: { node: GroupNode; dimmed?: boolean }) {
  const selected = useScene((s) => s.selection.includes(node.id));
  const signature = useScene((s) => subtreeSignature(node, s.project.nodes));
  const nodes = useScene((s) => s.project.nodes);
  const setEditingGroup = useScene((s) => s.setEditingGroup);
  const isTopLevel = useScene((s) => s.project.rootOrder.includes(node.id));
  // Groups cut before the boolean engine finished loading get cut again by it.
  const engineReady = useManifoldLoaded();

  // Re-runs only when a descendant changes, not when the group moves. The
  // boolean runs in a worker; the previous shape stays on screen until the
  // new one is ready, so a big cut never freezes the page or blanks the
  // group. A result for a signature the group has since moved past is
  // dropped.
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  useEffect(() => {
    let live = true;
    evaluateGroupAsync(node, nodes)
      .then((geo) => {
        if (live) setGeometry(geo);
        else geo?.dispose();
      })
      .catch((err) => {
        console.warn("Could not evaluate group", err);
        if (live) setGeometry(null);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, engineReady]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  const inherited = useMemo(
    () => firstSolidColor(node, nodes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );
  const color = node.color ?? inherited;
  // Nothing solid inside: a hole group, drawn like any other hole.
  const isHole = useScene((s) => nodeRole(node, s.project.nodes) === "hole");

  if (node.hidden || !geometry) return null;

  return (
    <mesh
      name={node.id}
      userData={dimmed ? {} : { nodeId: node.id }}
      geometry={geometry}
      position={node.position}
      rotation={node.rotation}
      scale={node.scale}
      raycast={dimmed ? () => null : undefined}
      onClick={dimmed ? undefined : (e) => handleMeshClick(e, node.id)}
      onDoubleClick={
        dimmed || !isTopLevel
          ? undefined
          : (e) => {
              e.stopPropagation();
              if (!useScene.getState().workplaneArmed && !node.locked) {
                setEditingGroup(node.id);
              }
            }
      }
    >
      <meshStandardMaterial
        color={isHole ? "#9aa0a6" : color}
        transparent={isHole || dimmed || !!node.transparent}
        opacity={dimmed ? 0.15 : isHole ? 0.4 : node.transparent ? 0.45 : 1}
        emissive={selected && !dimmed ? "#2a6cd4" : "#000000"}
        emissiveIntensity={selected && !dimmed ? 0.35 : 0}
        roughness={0.65}
        metalness={0.05}
        side={THREE.DoubleSide}
      />
      <MeshEdges geometry={geometry} faded={dimmed || isHole} />
    </mesh>
  );
}
