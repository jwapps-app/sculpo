import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { ShapeNode } from "../types/scene";
import { buildGeometry } from "../lib/primitives";
import { useManifoldLoaded } from "../lib/manifold";
import { workplaneFromHit } from "../lib/workplane";
import { gizmoState } from "../lib/gizmoState";
import { useScene } from "../state/store";

// Shared by shapes and groups: while the workplane tool is armed, a click on
// any face re-anchors the workplane instead of selecting.
export function handleMeshClick(e: ThreeEvent<MouseEvent>, nodeId: string) {
  const s = useScene.getState();
  // Rounding edges: faces are not targets, and the click must travel on to
  // the edge line it may also have landed on — the line and the face at an
  // edge are the same distance away, and either may be hit first.
  if (s.filletMode) return;
  e.stopPropagation();
  // A placement commit on top of this mesh also produces a click here; in
  // measure mode, clicks are measurement points, not selection.
  if (s.placing || s.measureMode || performance.now() - gizmoState.lastInteractionEnd < 300)
    return;
  if (s.workplaneArmed) {
    if (e.face) {
      const normal = e.face.normal
        .clone()
        .transformDirection(e.object.matrixWorld);
      s.setWorkplane(workplaneFromHit(e.point, normal));
    }
    return;
  }
  if (s.alignMode) {
    // Tinkercad's align: clicking a selected shape makes it the one the
    // others line up with, rather than collapsing the selection to it — which
    // used to drop out of align mode, since align needs two shapes.
    if (s.selection.includes(nodeId)) {
      s.toggleAlignAnchor(nodeId, e.shiftKey);
      return;
    }
    // Shift-click grows the selection without leaving align mode, so a third
    // shape can join two already lined up.
    if (e.shiftKey) {
      s.select(nodeId, true);
      return;
    }
    s.setAlignMode(false);
  }
  s.select(nodeId, e.shiftKey);
}

// Feature edges above this vertex count are skipped (imported meshes can be
// huge and organic scans have no meaningful edges anyway).
export const EDGE_VERTEX_LIMIT = 60_000;
export const EDGE_ANGLE = 30;

export function MeshEdges({
  geometry,
  faded = false,
}: {
  geometry: THREE.BufferGeometry;
  faded?: boolean;
}) {
  const edges = useMemo(() => {
    if (geometry.getAttribute("position").count > EDGE_VERTEX_LIMIT) return null;
    return new THREE.EdgesGeometry(geometry, EDGE_ANGLE);
  }, [geometry]);
  useEffect(() => () => edges?.dispose(), [edges]);
  if (!edges) return null;
  return (
    <lineSegments geometry={edges} raycast={() => null}>
      <lineBasicMaterial color="#1c1c1c" transparent opacity={faded ? 0.12 : 0.75} />
    </lineSegments>
  );
}

export function ShapeMesh({ node, dimmed = false }: { node: ShapeNode; dimmed?: boolean }) {
  const selected = useScene((s) => s.selection.includes(node.id));
  // Boxes with picked rounded edges are built by the boolean engine and show
  // sharp until it loads; rebuild when it does.
  const engineReady = useManifoldLoaded();

  const geometry = useMemo(
    () => buildGeometry(node),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.kind, JSON.stringify(node.params), engineReady],
  );

  // Resize handles and the gizmo move the mesh directly while dragging, then
  // commit to the store. A box's commit folds its scale into w/d/h, so its
  // scale prop reads [1, 1, 1] before and after — unchanged as far as the
  // renderer can tell, which would leave the drag's stretch on the mesh on
  // top of the new size. Re-apply the committed transform whenever the node
  // or its geometry changes.
  const meshRef = useRef<THREE.Mesh>(null);
  useLayoutEffect(() => {
    const m = meshRef.current;
    if (!m) return;
    m.position.set(...node.position);
    m.rotation.set(...node.rotation);
    m.scale.set(...node.scale);
  }, [node.position, node.rotation, node.scale, geometry]);

  if (node.hidden || !geometry) return null;

  const isHole = node.role === "hole";

  return (
    <mesh
      ref={meshRef}
      name={node.id}
      userData={dimmed ? {} : { nodeId: node.id }}
      geometry={geometry}
      position={node.position}
      rotation={node.rotation}
      scale={node.scale}
      raycast={dimmed ? () => null : undefined}
      onClick={dimmed ? undefined : (e) => handleMeshClick(e, node.id)}
      onDoubleClick={
        dimmed
          ? undefined
          : (e) => {
              // Sketch-based shapes reopen their 2D editor.
              const s = useScene.getState();
              if (s.workplaneArmed || s.cruiseMode || s.placing) return;
              if (["sketch", "revolve", "scribble"].includes(node.kind)) {
                e.stopPropagation();
                s.editSketch(node.id);
              }
            }
      }
    >
      <meshStandardMaterial
        color={isHole ? "#9aa0a6" : node.color}
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
