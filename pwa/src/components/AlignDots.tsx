import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useScene, type AlignMode, type Axis } from "../state/store";
import { sceneApi } from "../lib/sceneApi";
import { gizmoState } from "../lib/gizmoState";
import { AXIS_COLORS } from "../constants/ui";
import { isCoarsePointer } from "../lib/pointer";
import { boundsValue, planAlign, type AlignItem } from "../lib/align";

// Outline for the shapes everything else aligns to. Distinct from the three
// axis colors and from the blue selection tint.
const ANCHOR_COLOR = "#f59e0b";

interface DotDef {
  key: string;
  axis: Axis;
  mode: AlignMode;
}

const MODES: AlignMode[] = ["min", "center", "max"];
const DOTS: DotDef[] = ([0, 1, 2] as Axis[]).flatMap((axis) =>
  MODES.map((mode) => ({ key: `${axis}-${mode}`, axis, mode })),
);

// Tinkercad-style align: with align mode on and 2+ objects selected, colored
// dots appear along the selection bounds — three per axis. Hovering previews
// where everything will move; clicking applies that alignment. Clicking a
// selected shape first makes it the anchor: it stays put and the rest line up
// with it (shift-click for several, whose combined bounds are the reference).
export function AlignDots() {
  const camera = useThree((s) => s.camera);
  const alignMode = useScene((s) => s.alignMode);
  const setAlignMode = useScene((s) => s.setAlignMode);
  const selection = useScene((s) => s.selection);
  const nodes = useScene((s) => s.project.nodes);
  const alignSelected = useScene((s) => s.alignSelected);
  const anchorsRaw = useScene((s) => s.alignAnchors);
  const toggleAlignAnchor = useScene((s) => s.toggleAlignAnchor);

  const ids = useMemo(
    () => selection.filter((id) => nodes[id] && !nodes[id].locked && !nodes[id].hidden),
    [selection, nodes],
  );
  const active = alignMode && ids.length >= 2;
  const anchors = useMemo(() => anchorsRaw.filter((id) => ids.includes(id)), [anchorsRaw, ids]);

  // An anchor dropped from the selection (shift-click, delete, undo) stops
  // being one, rather than lingering invisibly and steering the next align.
  useEffect(() => {
    for (const id of anchorsRaw) if (!ids.includes(id)) toggleAlignAnchor(id, true);
  }, [anchorsRaw, ids, toggleAlignAnchor]);

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

  const itemBounds = (): AlignItem[] => {
    const out: AlignItem[] = [];
    for (const id of ids) {
      const box = sceneApi.getNodeBounds(id);
      if (box) out.push({ id, box });
    }
    return out;
  };

  // One reusable outline per anchor, refitted every frame so it follows undo
  // and edits made in the inspector.
  const anchorBoxes = useMemo(
    () => anchors.map(() => new THREE.Box3(new THREE.Vector3(), new THREE.Vector3())),
    [anchors],
  );
  const anchorHelpers = useMemo(
    () => anchorBoxes.map((b) => new THREE.Box3Helper(b, new THREE.Color(ANCHOR_COLOR))),
    [anchorBoxes],
  );
  useEffect(
    () => () => {
      for (const h of anchorHelpers) {
        h.geometry.dispose();
        (h.material as THREE.Material).dispose();
      }
    },
    [anchorHelpers],
  );

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const items = active ? itemBounds() : [];
    const box =
      items.length >= 2 ? items.reduce((u, x) => u.union(x.box), new THREE.Box3()) : null;
    g.visible = !!box;
    if (!box) return;
    anchors.forEach((id, i) => {
      const b = items.find((x) => x.id === id)?.box;
      if (b && anchorBoxes[i]) anchorBoxes[i].copy(b).expandByScalar(0.3);
    });
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

      const moves = !!planAlign(items, anchors, def.axis, def.mode)?.changes;
      if (moves) inert.current.delete(def.key);
      else inert.current.add(def.key);

      const hovered = hover?.key === def.key && moves;
      // Fingertips need a bigger target than a cursor does.
      const coarse = isCoarsePointer();
      const base = coarse ? 0.016 : 0.009;
      const big = coarse ? 0.02 : 0.013;
      mesh.scale.setScalar(Math.max(dist * (hovered ? big : base), coarse ? 0.7 : 0.4));
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.set(moves ? AXIS_COLORS[def.axis] : "#b8bcc2");
      mat.opacity = moves ? (hovered ? 1 : 0.85) : 0.5;
    }
  });

  // Hover preview: wireframe boxes where each moving shape will land. Anchors
  // don't move, so they get none.
  const previews = useMemo(() => {
    if (!hover || !active) return null;
    const items = itemBounds();
    const plan = planAlign(items, anchors, hover.axis, hover.mode);
    if (!plan) return null;
    return plan.moves.map(({ id, shift }) => {
      const shifted = items.find((x) => x.id === id)!.box.clone();
      shifted.min.setComponent(hover.axis, shifted.min.getComponent(hover.axis) + shift);
      shifted.max.setComponent(hover.axis, shifted.max.getComponent(hover.axis) + shift);
      return new THREE.Box3Helper(shifted, new THREE.Color(AXIS_COLORS[hover.axis]));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, active, ids, nodes, anchors]);

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
      {anchorHelpers.map((helper, i) => (
        <primitive key={`anchor-${anchors[i]}`} object={helper} raycast={() => null} />
      ))}
    </>
  );
}
