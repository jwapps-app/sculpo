import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useScene } from "../state/store";
import { sceneApi } from "../lib/sceneApi";
import { AXIS_COLORS } from "../constants/ui";
import { formatLength, fromDisplay } from "../lib/units";

interface Readout {
  center: [number, number, number];
  size: [number, number, number];
  offset: [number, number, number];
}

// Tinkercad-style ruler: a datum on the workplane. While it's placed, the
// selection carries persistent size labels and editable offsets from the
// datum, so parts can be positioned by exact numbers.
export function RulerOverlay() {
  const rulerOrigin = useScene((s) => s.rulerOrigin);
  const selection = useScene((s) => s.selection);
  const nodes = useScene((s) => s.project.nodes);
  const units = useScene((s) => s.units);
  const setOffsetFromRuler = useScene((s) => s.setOffsetFromRuler);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [editing, setEditing] = useState<0 | 1 | 2 | null>(null);
  const editingRef = useRef<0 | 1 | 2 | null>(null);
  editingRef.current = editing;

  const ids = useMemo(
    () => selection.filter((id) => nodes[id] && !nodes[id].hidden),
    [selection, nodes],
  );

  useEffect(() => {
    if (!rulerOrigin) setEditing(null);
  }, [rulerOrigin]);

  const marker = useMemo(() => {
    if (!rulerOrigin) return null;
    const g = new THREE.Group();
    const mk = (dir: THREE.Vector3, color: string) => {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone()]),
        new THREE.LineBasicMaterial({ color, depthTest: false }),
      );
      line.renderOrder = 1000;
      line.raycast = () => null;
      return line;
    };
    g.add(mk(new THREE.Vector3(30, 0, 0), AXIS_COLORS[0]));
    g.add(mk(new THREE.Vector3(0, 30, 0), AXIS_COLORS[1]));
    g.add(mk(new THREE.Vector3(0, 0, 30), AXIS_COLORS[2]));
    return g;
  }, [rulerOrigin]);

  useFrame(() => {
    if (!rulerOrigin || ids.length === 0) {
      setReadout((p) => (p === null ? p : null));
      return;
    }
    const box = new THREE.Box3();
    let any = false;
    for (const id of ids) {
      const b = sceneApi.getNodeBounds(id);
      if (b) {
        box.union(b);
        any = true;
      }
    }
    if (!any) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const next: Readout = {
      center: [center.x, center.y, box.max.z],
      size: [size.x, size.y, size.z],
      offset: [box.min.x - rulerOrigin[0], box.min.y - rulerOrigin[1], box.min.z],
    };
    setReadout((prev) =>
      prev &&
      prev.size.every((v, i) => v === next.size[i]) &&
      prev.offset.every((v, i) => v === next.offset[i]) &&
      prev.center.every((v, i) => v === next.center[i])
        ? prev
        : next,
    );
  });

  if (!rulerOrigin) return null;

  const labels: { axis: 0 | 1 | 2; name: string }[] = [
    { axis: 0, name: "X" },
    { axis: 1, name: "Y" },
    { axis: 2, name: "Z" },
  ];

  return (
    <>
      {marker && <primitive object={marker} position={[rulerOrigin[0], rulerOrigin[1], 0]} />}
      {readout && (
        <group position={readout.center}>
          <Html zIndexRange={[45, 40]} style={{ pointerEvents: "auto" }}>
            <div className="-translate-y-10 translate-x-3 space-y-1 rounded bg-white/95 p-1.5 shadow ring-1 ring-neutral-300">
              <div className="font-mono text-[11px] text-neutral-700">
                {labels.map(({ axis, name }) => (
                  <span key={name} className="mr-1.5" style={{ color: AXIS_COLORS[axis] }}>
                    {name} {formatLength(readout.size[axis], units)}
                  </span>
                ))}
                <span className="text-neutral-400">{units}</span>
              </div>
              <div className="flex gap-1">
                {labels.map(({ axis, name }) =>
                  editing === axis ? (
                    <form
                      key={name}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const input = e.currentTarget.elements[0] as HTMLInputElement;
                        const v = Number(input.value);
                        if (Number.isFinite(v)) setOffsetFromRuler(axis, fromDisplay(v, units));
                        setEditing(null);
                      }}
                    >
                      <input
                        autoFocus
                        defaultValue={formatLength(readout.offset[axis], units)}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Escape") setEditing(null);
                        }}
                        onBlur={(e) => {
                          const v = Number(e.currentTarget.value);
                          if (Number.isFinite(v)) setOffsetFromRuler(axis, fromDisplay(v, units));
                          setEditing(null);
                        }}
                        className="w-14 rounded border-2 px-1 text-[11px]"
                        style={{ borderColor: AXIS_COLORS[axis] }}
                      />
                    </form>
                  ) : (
                    <button
                      key={name}
                      onClick={() => setEditing(axis)}
                      title={`Distance from the ruler along ${name} — click to set exactly`}
                      className="rounded border px-1 font-mono text-[11px] hover:bg-neutral-100"
                      style={{ borderColor: AXIS_COLORS[axis], color: AXIS_COLORS[axis] }}
                    >
                      ↦{formatLength(readout.offset[axis], units)}
                    </button>
                  ),
                )}
              </div>
            </div>
          </Html>
        </group>
      )}
    </>
  );
}
