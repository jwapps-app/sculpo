import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useScene } from "../state/store";
import { measureState, resetMeasure } from "../lib/measure";
import { formatLength } from "../lib/units";

// Renders the measure tool: snap marker under the cursor, endpoint markers,
// the measurement line, and a distance label with per-axis deltas.
export function MeasureOverlay() {
  const measureMode = useScene((s) => s.measureMode);
  const units = useScene((s) => s.units);
  const camera = useThree((s) => s.camera);

  const hoverMarker = useRef<THREE.Mesh>(null);
  const p1Marker = useRef<THREE.Mesh>(null);
  const p2Marker = useRef<THREE.Mesh>(null);
  // Plain THREE.Line: the JSX <line> tag collides with SVG's element type.
  const lineObj = useMemo(() => {
    const l = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: "#f59e0b", depthTest: false, toneMapped: false }),
    );
    l.renderOrder = 1000;
    l.visible = false;
    return l;
  }, []);
  const [readout, setReadout] = useState<{
    mid: [number, number, number];
    d: number;
    dx: number;
    dy: number;
    dz: number;
  } | null>(null);

  useEffect(() => {
    if (!measureMode) {
      resetMeasure();
      setReadout(null);
    }
  }, [measureMode]);

  useFrame(() => {
    const scaleFor = (p: THREE.Vector3) =>
      Math.max(camera.position.distanceTo(p) * 0.008, 0.3);

    const setMarker = (
      marker: THREE.Mesh | null,
      p: THREE.Vector3 | null,
      snapped = true,
    ) => {
      if (!marker) return;
      marker.visible = !!p;
      if (p) {
        marker.position.copy(p);
        marker.scale.setScalar(scaleFor(p) * (snapped ? 1 : 0.6));
      }
    };

    setMarker(hoverMarker.current, measureState.hover, measureState.hoverSnapped);
    setMarker(p1Marker.current, measureState.p1);
    setMarker(p2Marker.current, measureState.p2);

    const a = measureState.p1;
    const b = measureState.p2 ?? measureState.hover;
    lineObj.visible = !!(a && b);
    if (a && b) lineObj.geometry.setFromPoints([a, b]);

    if (a && b) {
      const d = a.distanceTo(b);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const next = {
        mid: mid.toArray() as [number, number, number],
        d,
        dx: Math.abs(b.x - a.x),
        dy: Math.abs(b.y - a.y),
        dz: Math.abs(b.z - a.z),
      };
      setReadout((prev) =>
        prev &&
        prev.d === next.d &&
        prev.mid[0] === next.mid[0] &&
        prev.mid[1] === next.mid[1] &&
        prev.mid[2] === next.mid[2]
          ? prev
          : next,
      );
    } else {
      setReadout((prev) => (prev === null ? prev : null));
    }
  });

  if (!measureMode) return null;

  return (
    <>
      <mesh ref={hoverMarker} visible={false} renderOrder={1001} raycast={() => null}>
        <sphereGeometry args={[1, 12, 8]} />
        <meshBasicMaterial color="#f59e0b" depthTest={false} toneMapped={false} />
      </mesh>
      <mesh ref={p1Marker} visible={false} renderOrder={1001} raycast={() => null}>
        <sphereGeometry args={[1, 12, 8]} />
        <meshBasicMaterial color="#dc2626" depthTest={false} toneMapped={false} />
      </mesh>
      <mesh ref={p2Marker} visible={false} renderOrder={1001} raycast={() => null}>
        <sphereGeometry args={[1, 12, 8]} />
        <meshBasicMaterial color="#dc2626" depthTest={false} toneMapped={false} />
      </mesh>
      <primitive object={lineObj} />
      {readout && (
        <group position={readout.mid}>
          <Html zIndexRange={[45, 40]} style={{ pointerEvents: "none" }}>
            <div className="-translate-y-8 translate-x-2 whitespace-nowrap rounded bg-neutral-800/95 px-2 py-1 font-mono text-xs text-white shadow">
              <span className="font-bold">
                {formatLength(readout.d, units)} {units}
              </span>
              <span className="ml-2" style={{ color: "#f87171" }}>
                X {formatLength(readout.dx, units)}
              </span>
              <span className="ml-1.5" style={{ color: "#4ade80" }}>
                Y {formatLength(readout.dy, units)}
              </span>
              <span className="ml-1.5" style={{ color: "#60a5fa" }}>
                Z {formatLength(readout.dz, units)}
              </span>
            </div>
          </Html>
        </group>
      )}
    </>
  );
}
