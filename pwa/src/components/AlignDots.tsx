import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useScene, type AlignMode, type Axis } from "../state/store";
import { sceneApi } from "../lib/sceneApi";
import { gizmoState } from "../lib/gizmoState";
import { AXIS_COLORS } from "../constants/ui";

interface DotDef {
  key: string;
  axis: Axis;
  mode: AlignMode;
}

const MODES: AlignMode[] = ["min", "center", "max"];
const DOTS: DotDef[] = ([0, 1, 2] as Axis[]).flatMap((axis) =>
  MODES.map((mode) => ({ key: `${axis}-${mode}`, axis, mode })),
);

function boundsValue(box: THREE.Box3, axis: Axis, mode: AlignMode): number {
  const min = box.min.getComponent(axis);
  const max = box.max.getComponent(axis);
  return mode === "min" ? min : mode === "max" ? max : (min + max) / 2;
}

// Tinkercad-style align: with align mode on and 2+ objects selected, colored
// dots appear along the selection bounds — three per axis. Hovering previews
// where everything will move; clicking applies that alignment.
export function AlignDots() {
  const camera = useThree((s) => s.camera);
  const alignMode = useScene((s) => s.alignMode);
  const setAlignMode = useScene((s) => s.setAlignMode);
  const selection = useScene((s) => s.selection);
  const nodes = useScene((s) => s.project.nodes);
  const alignSelected = useScene((s) => s.alignSelected);

  const ids = useMemo(
    () => selection.filter((id) => nodes[id] && !nodes[id].locked && !nodes[id].hidden),
    [selection, nodes],
  );
  const active = alignMode && ids.length >= 2;

  // Leave align mode when the selection stops being alignable.
  useEffect(() => {
    if (alignMode && ids.length < 2) setAlignMode(false);
  }, [alignMode, ids.length, setAlignMode]);

  const group = useRef<THREE.Group>(null);
  const dots = useRef<Map<string, THREE.Mesh>>(new Map());
  const [hover, setHover] = useState<DotDef | null>(null);

  useEffect(() => {
    if (!active) setHover(null);
  }, [active]);

  // Dots whose alignment would move nothing are shown gray and inert, like
  // Tinkercad. Recomputed each frame alongside dot positions.
  const inert = useRef<Set<string>>(new Set());

  const itemBounds = (): THREE.Box3[] => {
    const out: THREE.Box3[] = [];
    for (const id of ids) {
      const b = sceneApi.getNodeBounds(id);
      if (b) out.push(b);
    }
    return out;
  };

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const items = active ? itemBounds() : [];
    const box = items.length >= 2 ? items.reduce((u, b) => u.union(b), new THREE.Box3()) : null;
    g.visible = !!box;
    if (!box) return;
    const c = box.getCenter(new THREE.Vector3());
    const dist = camera.position.distanceTo(c);
    const off = Math.max(4, dist * 0.03);
    for (const def of DOTS) {
      const mesh = dots.current.get(def.key);
      if (!mesh) continue;
      const v = boundsValue(box, def.axis, def.mode);
      if (def.axis === 0) mesh.position.set(v, box.min.y - off, box.min.z);
      else if (def.axis === 1) mesh.position.set(box.min.x - off, v, box.min.z);
      else mesh.position.set(box.min.x - off, box.min.y - off, v);

      const values = items.map((b) => boundsValue(b, def.axis, def.mode));
      const target =
        def.mode === "min"
          ? Math.min(...values)
          : def.mode === "max"
            ? Math.max(...values)
            : values.reduce((s, x) => s + x, 0) / values.length;
      const moves = values.some((x) => Math.abs(target - x) > 0.05);
      if (moves) inert.current.delete(def.key);
      else inert.current.add(def.key);

      const hovered = hover?.key === def.key && moves;
      mesh.scale.setScalar(Math.max(dist * (hovered ? 0.013 : 0.009), 0.4));
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.set(moves ? AXIS_COLORS[def.axis] : "#b8bcc2");
      mat.opacity = moves ? (hovered ? 1 : 0.85) : 0.5;
    }
  });

  // Hover preview: wireframe boxes at each object's post-align bounds.
  const previews = useMemo(() => {
    if (!hover || !active) return null;
    const items = ids
      .map((id) => ({ id, box: sceneApi.getNodeBounds(id) }))
      .filter((x): x is { id: string; box: THREE.Box3 } => !!x.box);
    if (items.length < 2) return null;
    const target =
      hover.mode === "min"
        ? Math.min(...items.map((x) => boundsValue(x.box, hover.axis, "min")))
        : hover.mode === "max"
          ? Math.max(...items.map((x) => boundsValue(x.box, hover.axis, "max")))
          : items.reduce((sum, x) => sum + boundsValue(x.box, hover.axis, "center"), 0) /
            items.length;
    return items.map(({ box }) => {
      const shifted = box.clone();
      const shift = target - boundsValue(box, hover.axis, hover.mode);
      shifted.min.setComponent(hover.axis, shifted.min.getComponent(hover.axis) + shift);
      shifted.max.setComponent(hover.axis, shifted.max.getComponent(hover.axis) + shift);
      return new THREE.Box3Helper(shifted, new THREE.Color(AXIS_COLORS[hover.axis]));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, active, ids, nodes]);

  if (!active) return null;

  return (
    <>
      <group ref={group} visible={false}>
        {DOTS.map((def) => (
          <mesh
            key={def.key}
            ref={(m) => {
              if (m) dots.current.set(def.key, m);
              else dots.current.delete(def.key);
            }}
            renderOrder={999}
            onClick={(e) => {
              e.stopPropagation();
              if (inert.current.has(def.key)) return;
              alignSelected(def.axis, def.mode);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              if (inert.current.has(def.key)) return;
              setHover(def);
              gizmoState.handleActive = true;
            }}
            onPointerOut={() => {
              setHover((h) => (h?.key === def.key ? null : h));
              gizmoState.handleActive = false;
            }}
          >
            <sphereGeometry args={[1, 16, 12]} />
            <meshBasicMaterial
              color={AXIS_COLORS[def.axis]}
              depthTest={false}
              toneMapped={false}
              transparent
              opacity={hover?.key === def.key ? 1 : 0.85}
            />
          </mesh>
        ))}
      </group>
      {previews?.map((helper, i) => (
        <primitive key={i} object={helper} />
      ))}
    </>
  );
}
