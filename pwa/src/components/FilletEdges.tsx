import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useScene } from "../state/store";
import { isGroup, type ShapeNode } from "../types/scene";
import { BOX_EDGES, edgeEndpoints, roundedEdges } from "../lib/boxEdges";
import { gizmoState } from "../lib/gizmoState";
import { isCoarsePointer } from "../lib/pointer";

// Rounded edges are amber, the same color align uses for "this is the one";
// square edges are a quiet blue so they read as available, not chosen.
const ROUNDED = "#f59e0b";
const SQUARE = "#2563eb";

const UP = new THREE.Vector3(0, 1, 0);
const TUBE = new THREE.CylinderGeometry(1, 1, 1, 8, 1);

/** The box the tool is working on: exactly one selected, unlocked, visible box. */
function useTargetBox(): ShapeNode | null {
  return useScene((s) => {
    if (s.selection.length !== 1) return null;
    const n = s.project.nodes[s.selection[0]];
    if (!n || isGroup(n) || n.kind !== "box" || n.locked || n.hidden) return null;
    return n;
  });
}

// Is this hit the nearest thing under the cursor? R3F passes events on to
// everything the ray crosses, so without this an edge behind the box would
// light up through it.
function nearest(e: ThreeEvent<PointerEvent | MouseEvent>): boolean {
  return e.intersections[0]?.object === e.object;
}

// Click-to-round. With the tool on and one box selected, its twelve edges are
// drawn as tubes; clicking one rounds it, clicking a rounded one squares it.
// Tubes sit on the original sharp edge line, so a rounded edge stays where
// the user expects to find it.
export function FilletEdges() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const filletMode = useScene((s) => s.filletMode);
  const setFilletMode = useScene((s) => s.setFilletMode);
  const toggleBoxEdge = useScene((s) => s.toggleBoxEdge);
  const box = useTargetBox();
  const active = filletMode && !!box;

  // Leave the tool when the selection stops being a single box.
  useEffect(() => {
    if (filletMode && !box) setFilletMode(false);
  }, [filletMode, box, setFilletMode]);

  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (!active) setHover(null);
  }, [active]);

  const rounded = useMemo(() => new Set(box ? roundedEdges(box.params) : []), [box]);
  const tubes = useRef<Map<number, THREE.Mesh>>(new Map());

  const a = useMemo(() => new THREE.Vector3(), []);
  const b = useMemo(() => new THREE.Vector3(), []);
  const mid = useMemo(() => new THREE.Vector3(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (!active || !box) return;
    // The rendered mesh carries the full world transform, including any
    // group being edited around it.
    const mesh = scene.getObjectByName(box.id);
    if (!mesh) return;
    mesh.updateWorldMatrix(true, false);
    const p = box.params;
    const size: [number, number, number] = [
      typeof p.w === "number" ? p.w : 20,
      typeof p.d === "number" ? p.d : 20,
      typeof p.h === "number" ? p.h : 20,
    ];
    const coarse = isCoarsePointer();
    for (const edge of BOX_EDGES) {
      const tube = tubes.current.get(edge.id);
      if (!tube) continue;
      const [la, lb] = edgeEndpoints(edge, size);
      a.set(...la).applyMatrix4(mesh.matrixWorld);
      b.set(...lb).applyMatrix4(mesh.matrixWorld);
      mid.addVectors(a, b).multiplyScalar(0.5);
      dir.subVectors(b, a);
      const length = dir.length();
      tube.position.copy(mid);
      tube.quaternion.setFromUnitVectors(UP, dir.normalize());
      // Screen-constant thickness, thicker for fingers and when hovered.
      const hovered = hover === edge.id;
      const k = (coarse ? 0.009 : 0.005) * (hovered ? 1.6 : 1);
      const radius = Math.max(camera.position.distanceTo(mid) * k, 0.15);
      tube.scale.set(radius, length, radius);
      const mat = tube.material as THREE.MeshBasicMaterial;
      const isRounded = rounded.has(edge.id);
      mat.color.set(isRounded || hovered ? ROUNDED : SQUARE);
      mat.opacity = hovered ? 1 : isRounded ? 0.95 : 0.55;
    }
  });

  if (!active || !box) return null;

  return (
    <group>
      {BOX_EDGES.map((edge) => (
        <mesh
          key={edge.id}
          geometry={TUBE}
          renderOrder={998}
          ref={(m) => {
            if (m) tubes.current.set(edge.id, m);
            else tubes.current.delete(edge.id);
          }}
          onClick={(e) => {
            if (!nearest(e)) return;
            e.stopPropagation();
            toggleBoxEdge(box.id, edge.id);
          }}
          onPointerMove={(e) => {
            if (!nearest(e)) {
              setHover((h) => (h === edge.id ? null : h));
              return;
            }
            e.stopPropagation();
            if (hover !== edge.id) setHover(edge.id);
            gizmoState.handleActive = true;
          }}
          onPointerOut={() => {
            setHover((h) => (h === edge.id ? null : h));
            gizmoState.handleActive = false;
          }}
        >
          <meshBasicMaterial color={SQUARE} transparent toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
