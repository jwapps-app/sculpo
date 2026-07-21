import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useScene } from "../state/store";
import { buildGeometry, DEFAULT_PARAMS, PALETTE_COLORS } from "../lib/primitives";
import { placementState } from "../lib/placement";
import type { ShapeNode } from "../types/scene";

// Translucent ghost of the shape being placed, following the cursor.
export function PlacementPreview() {
  const placing = useScene((s) => s.placing);
  const mesh = useRef<THREE.Mesh>(null);

  const geometry = useMemo(
    () =>
      placing
        ? buildGeometry({ kind: placing, params: { ...DEFAULT_PARAMS[placing] } } as ShapeNode)
        : null,
    [placing],
  );
  useEffect(() => () => geometry?.dispose(), [geometry]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    m.visible = placementState.valid;
    m.position.copy(placementState.position);
    m.quaternion.copy(placementState.quaternion);
  });

  if (!placing || !geometry) return null;

  return (
    <mesh ref={mesh} geometry={geometry} visible={false} raycast={() => null}>
      <meshStandardMaterial
        color={PALETTE_COLORS[placing]}
        transparent
        opacity={0.55}
        roughness={0.65}
        metalness={0.05}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
