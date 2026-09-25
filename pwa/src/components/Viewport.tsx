import {
  Component,
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useScene } from "../state/store";
import { isGroup, type PrimitiveKind, type SceneNode } from "../types/scene";
import { sceneApi, type ViewName } from "../lib/sceneApi";
import { gizmoState } from "../lib/gizmoState";
import { ShapeMesh } from "./ShapeMesh";
import { GroupMesh } from "./GroupMesh";
import { Gizmo } from "./Gizmo";
import { ResizeHandles } from "./ResizeHandles";
import { AlignDots } from "./AlignDots";
import { FilletEdges } from "./FilletEdges";
import { FilletBar } from "./FilletBar";
import { MeasureOverlay } from "./MeasureOverlay";
import { RulerOverlay } from "./RulerOverlay";
import { ViewCube } from "./ViewCube";
import { PlacementPreview } from "./PlacementPreview";
import { measureState } from "../lib/measure";
import { SceneRig } from "./SceneRig";
import { placementState } from "../lib/placement";

// CAD/STL convention: Z is up, the workplane is XY.
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export const SHAPE_DRAG_TYPE = "application/x-shape-kind";

const VIEWS: { view: ViewName; label: string; key: string }[] = [
  { view: "top", label: "Top", key: "1" },
  { view: "front", label: "Front", key: "2" },
  { view: "right", label: "Right", key: "3" },
  { view: "iso", label: "Iso", key: "4" },
];

function ViewButtons() {
  const ortho = useScene((s) => s.ortho);
  const setOrtho = useScene((s) => s.setOrtho);
  return (
    <div className="absolute left-2 top-2 flex flex-col gap-1">
      {VIEWS.map(({ view, label, key }) => (
        <button
          key={view}
          onClick={() => sceneApi.setView(view)}
          title={`${label} view (${key})`}
          className="w-14 rounded border border-neutral-300 bg-white/90 px-1.5 py-0.5 text-xs text-neutral-600 hover:bg-white"
        >
          {label}
        </button>
      ))}
      <button
        onClick={() => sceneApi.zoomToFit()}
        title="Zoom to fit (F)"
        className="w-14 rounded border border-neutral-300 bg-white/90 px-1.5 py-0.5 text-xs font-medium text-neutral-700 hover:bg-white"
      >
        Fit
      </button>
      <button
        onClick={() => setOrtho(!ortho)}
        title="Toggle orthographic projection"
        className={`w-14 rounded border px-1.5 py-0.5 text-xs ${
          ortho
            ? "border-neutral-700 bg-neutral-800 text-white"
            : "border-neutral-300 bg-white/90 text-neutral-600 hover:bg-white"
        }`}
      >
        Ortho
      </button>
    </div>
  );
}

// Swaps between perspective and orthographic cameras, carrying the viewpoint
// (position, target, apparent zoom) across the switch.
function Cameras() {
  const ortho = useScene((s) => s.ortho);
  const persp = useRef<THREE.PerspectiveCamera>(null);
  const orthoCam = useRef<THREE.OrthographicCamera>(null);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const prev = useRef(ortho);

  useEffect(() => {
    if (prev.current === ortho) return;
    prev.current = ortho;
    const from = ortho ? persp.current : orthoCam.current;
    const to = ortho ? orthoCam.current : persp.current;
    if (!from || !to) return;
    const target = controls
      ? controls.target.clone()
      : new THREE.Vector3(0, 0, 0);
    to.up.set(0, 0, 1);
    to.position.copy(from.position);
    if (ortho) {
      const d = from.position.distanceTo(target);
      (to as THREE.OrthographicCamera).zoom =
        size.height / (2 * d * Math.tan(THREE.MathUtils.degToRad(22.5)));
    }
    to.updateProjectionMatrix();
    to.lookAt(target);
  }, [ortho, controls, size.height]);

  // Restore the orbit target after drei rebuilds the controls for the new
  // default camera.
  const savedTarget = useRef(new THREE.Vector3());
  useEffect(() => {
    if (controls) {
      controls.target.copy(savedTarget.current);
      controls.update();
      const save = () => savedTarget.current.copy(controls.target);
      controls.addEventListener("change", save);
      return () => controls.removeEventListener("change", save);
    }
  }, [controls]);

  return (
    <>
      <PerspectiveCamera
        ref={persp}
        makeDefault={!ortho}
        position={[90, -90, 70]}
        up={[0, 0, 1]}
        fov={45}
        near={0.1}
        far={5000}
      />
      <OrthographicCamera
        ref={orthoCam}
        makeDefault={ortho}
        position={[90, -90, 70]}
        up={[0, 0, 1]}
        near={-5000}
        far={5000}
      />
    </>
  );
}

// With one finger doing double duty — orbit the view, but also drag gizmos,
// resize handles, the view cube and measure points — orbit has to stand down
// whenever one of those owns the gesture. On mouse this was handled by using
// different buttons; on touch there's only the one.
function ControlsGate() {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  useFrame(() => {
    if (!controls) return;
    const busy = gizmoState.busy();
    if (controls.enabled === busy) controls.enabled = !busy;
  });
  return null;
}

// Build-plate outline: the printable footprint, so parts can be laid out
// against a real printer's bed.
function BuildPlate() {
  const bed = useScene((s) => s.bed);
  const outline = useMemo(() => {
    if (!bed) return null;
    const [w, d] = bed;
    const pts = [
      new THREE.Vector3(-w / 2, -d / 2, 0),
      new THREE.Vector3(w / 2, -d / 2, 0),
      new THREE.Vector3(w / 2, d / 2, 0),
      new THREE.Vector3(-w / 2, d / 2, 0),
      new THREE.Vector3(-w / 2, -d / 2, 0),
    ];
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: "#2563eb", transparent: true, opacity: 0.8 }),
    );
    line.raycast = () => null;
    return line;
  }, [bed]);
  if (!outline || !bed) return null;
  return (
    <>
      <primitive object={outline} />
      <mesh position={[0, 0, -0.05]} raycast={() => null}>
        <planeGeometry args={bed} />
        <meshBasicMaterial color="#2563eb" transparent opacity={0.05} />
      </mesh>
    </>
  );
}

function WorkplaneGrid() {
  const workplane = useScene((s) => s.workplane);
  const quaternion = useMemo(() => {
    if (!workplane) return null;
    return new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...workplane.rotation, "XYZ"),
    );
  }, [workplane]);
  if (!workplane || !quaternion) return null;
  return (
    <group position={workplane.position} quaternion={quaternion}>
      <Grid
        rotation={[Math.PI / 2, 0, 0]}
        raycast={() => null}
        infiniteGrid
        cellSize={1}
        cellThickness={0.5}
        sectionSize={10}
        sectionThickness={1.2}
        cellColor="#d9a05b"
        sectionColor="#b97a2e"
        fadeDistance={220}
        fadeStrength={1.2}
        side={THREE.DoubleSide}
      />
    </group>
  );
}

function DragChip() {
  const dragInfo = useScene((s) => s.dragInfo);
  if (!dragInfo) return null;
  return (
    <div className="pointer-events-none absolute right-2 top-2 rounded bg-neutral-800/90 px-2 py-1 font-mono text-xs text-white">
      {dragInfo}
    </div>
  );
}

function renderNode(node: SceneNode, dimmed: boolean) {
  return isGroup(node) ? (
    <GroupMesh key={node.id} node={node} dimmed={dimmed} />
  ) : (
    <ShapeMesh key={node.id} node={node} dimmed={dimmed} />
  );
}

interface MarqueeRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// three throws outright when it cannot get a WebGL context, which took the
// whole app down with it. The usual cause is nothing to do with Sculpo: a
// Chrome GPU process that has fallen over, hardware acceleration switched
// off, or too many live WebGL tabs at once. Detect it and say so, rather
// than dying in a render.
// three only discovers a dead context by trying, and probing first is worse
// than useless: a probe canvas holds a context of its own, and browsers cap
// how many can be live at once, so the check can be what pushes the real
// renderer over the limit. Let it try, and catch the failure.
class WebGLBoundary extends Component<
  { children: (conservative: boolean) => ReactNode },
  { error: Error | null; tries: number }
> {
  state = { error: null as Error | null, tries: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    // First failure is not necessarily fatal. r3f asks for a
    // high-performance context by default, and a machine whose discrete GPU
    // is unavailable or blocklisted can refuse that outright rather than
    // quietly hand back the integrated one. Ask again, undemandingly.
    if (this.state.tries === 0 && /webgl/i.test(error.message)) {
      this.setState({ error: null, tries: 1 });
    }
  }

  render() {
    const { error, tries } = this.state;
    if (error) {
      // Anything not about WebGL belongs to the app-level boundary, which
      // reports it accurately instead of blaming the GPU.
      if (!/webgl/i.test(`${error.message}`)) throw error;
      if (tries > 0) return <NoWebGL />;
      return null; // componentDidCatch is about to retry
    }
    // The key forces a fresh canvas rather than reusing the failed one.
    return <Fragment key={tries}>{this.props.children(tries > 0)}</Fragment>;
  }
}

// Undemanding context settings for the retry: no preference for the discrete
// GPU, no multisampling, and an explicit willingness to accept a slow one.
const FALLBACK_GL = {
  powerPreference: "default" as const,
  antialias: false,
  failIfMajorPerformanceCaveat: false,
};

function NoWebGL() {
  return (
    <div className="flex h-full items-center justify-center bg-neutral-100 p-6">
      <div className="max-w-md space-y-3 rounded-lg border border-neutral-200 bg-white p-5 text-sm shadow-sm">
        <h2 className="text-base font-bold">This browser can&rsquo;t start 3D</h2>
        <p className="text-neutral-600">
          Sculpo draws with WebGL and the browser refused to create a context. Your
          saved work is untouched — this is a display problem, not a data one.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-neutral-600">
          <li>Quit the browser fully and reopen it — a crashed GPU process is the
            most common cause, and it survives a plain reload.</li>
          <li>Close other heavy 3D/video tabs; browsers cap how many WebGL
            contexts can be live at once.</li>
          <li>Check hardware acceleration is on (in Chrome, visit
            <code className="mx-1 rounded bg-neutral-100 px-1">chrome://gpu</code>).</li>
        </ul>
        <button
          onClick={() => window.location.reload()}
          className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export function Viewport() {
  const nodes = useScene((s) => s.project.nodes);
  const rootOrder = useScene((s) => s.project.rootOrder);
  const clearSelection = useScene((s) => s.clearSelection);
  const workplaneArmed = useScene((s) => s.workplaneArmed);
  const editingGroupId = useScene((s) => s.editingGroupId);
  const setEditingGroup = useScene((s) => s.setEditingGroup);

  const editingGroup =
    editingGroupId && nodes[editingGroupId] && isGroup(nodes[editingGroupId])
      ? nodes[editingGroupId]
      : null;

  // If the edited group vanished (undo, load), leave edit mode.
  useEffect(() => {
    if (editingGroupId && !editingGroup) setEditingGroup(null);
  }, [editingGroupId, editingGroup, setEditingGroup]);

  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const marqueeEndedAt = useRef(0);
  // A pointer that went down on empty canvas but hasn't moved enough to be a
  // marquee yet. Capturing here would swallow the browser's click event (and
  // with it click-to-deselect), so capture only once dragging actually starts.
  const pendingMarquee = useRef<{ x: number; y: number } | null>(null);
  // Touch marquee: press and hold on empty space, then drag.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);
  const cruiseDrag = useRef<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const cruiseMode = useScene((s) => s.cruiseMode);
  const placing = useScene((s) => s.placing);
  const measureMode = useScene((s) => s.measureMode);
  const rulerPlacing = useScene((s) => s.rulerPlacing);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (!(e.target instanceof HTMLCanvasElement)) return;
    // A gizmo, resize handle, or the view cube owns this press — no viewport
    // tool should also react to it.
    if (gizmoState.busy()) return;
    const s = useScene.getState();
    if (s.rulerPlacing) {
      const snap = sceneApi.measureSnap(e.clientX, e.clientY);
      if (snap) s.setRulerOrigin([snap.point[0], snap.point[1]]);
      return;
    }
    if (s.measureMode) {
      const snap = sceneApi.measureSnap(e.clientX, e.clientY);
      if (snap) {
        const p = new THREE.Vector3(...snap.point);
        if (!measureState.p1 || measureState.p2) {
          // First point, or starting a fresh measurement after a finished one.
          measureState.p1 = p;
          measureState.p2 = null;
        } else {
          measureState.p2 = p;
        }
      }
      return;
    }
    if (s.placing) {
      // On touch there's no hover to have positioned the ghost, so resolve the
      // drop point from this very press before committing.
      if (e.pointerType !== "mouse") sceneApi.placementMove(e.clientX, e.clientY);
      if (placementState.valid) {
        const eu = new THREE.Euler().setFromQuaternion(placementState.quaternion, "XYZ");
        s.placeShapeAt(
          s.placing,
          placementState.position.toArray() as [number, number, number],
          [eu.x, eu.y, eu.z],
        );
        placementState.valid = false;
        gizmoState.lastInteractionEnd = performance.now();
      }
      return;
    }
    if (s.workplaneArmed) return;
    if (s.cruiseMode && !s.editingGroupId) {
      const id = sceneApi.hitNodeAt(e.clientX, e.clientY);
      if (id && s.project.nodes[id] && !s.project.nodes[id].locked) {
        s.setSelection([id]);
        cruiseDrag.current = id;
        gizmoState.handleActive = true;
        wrapper.current?.setPointerCapture(e.pointerId);
        return;
      }
    }
    if (sceneApi.hitTestNodes(e.clientX, e.clientY)) return;
    if (e.pointerType !== "mouse") {
      // On touch a one-finger drag orbits, so the marquee needs a gesture that
      // can't be confused with it: press and hold still, then drag. Any
      // movement before the hold completes means the user meant to orbit.
      const start = { x: e.clientX, y: e.clientY };
      const pointerId = e.pointerId;
      longPressStart.current = start;
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      longPressTimer.current = setTimeout(() => {
        longPressTimer.current = null;
        longPressStart.current = null;
        // Take the gesture away from orbit for its remainder.
        gizmoState.handleActive = true;
        setMarquee({ x1: start.x, y1: start.y, x2: start.x, y2: start.y });
        try {
          wrapper.current?.setPointerCapture(pointerId);
        } catch {
          /* pointer already gone */
        }
      }, 400);
      return;
    }
    pendingMarquee.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const sNow = useScene.getState();
    if (sNow.measureMode) {
      const snap = sceneApi.measureSnap(e.clientX, e.clientY);
      measureState.hover = snap ? new THREE.Vector3(...snap.point) : null;
      measureState.hoverSnapped = !!snap?.snapped;
      return;
    }
    if (sNow.placing) {
      sceneApi.placementMove(e.clientX, e.clientY);
      return;
    }
    if (cruiseDrag.current) {
      sceneApi.cruiseMove(cruiseDrag.current, e.clientX, e.clientY);
      return;
    }
    // Any real movement during the hold means it was an orbit, not a marquee.
    const holdStart = longPressStart.current;
    if (holdStart && longPressTimer.current) {
      if (
        Math.abs(e.clientX - holdStart.x) >= 8 ||
        Math.abs(e.clientY - holdStart.y) >= 8
      ) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
        longPressStart.current = null;
      }
    }
    const pending = pendingMarquee.current;
    if (pending && !marquee) {
      if (Math.abs(e.clientX - pending.x) >= 4 || Math.abs(e.clientY - pending.y) >= 4) {
        setMarquee({ x1: pending.x, y1: pending.y, x2: e.clientX, y2: e.clientY });
        try {
          wrapper.current?.setPointerCapture(e.pointerId);
        } catch {
          // capture is an optimization; the drag still works without it
        }
      }
      return;
    }
    setMarquee((m) => (m ? { ...m, x2: e.clientX, y2: e.clientY } : m));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pendingMarquee.current = null;
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressStart.current = null;
    // A touch marquee borrowed the gesture from orbit; hand it back.
    if (marquee && e.pointerType !== "mouse") gizmoState.handleActive = false;
    if (cruiseDrag.current) {
      const id = cruiseDrag.current;
      cruiseDrag.current = null;
      gizmoState.handleActive = false;
      gizmoState.lastInteractionEnd = performance.now();
      wrapper.current?.releasePointerCapture(e.pointerId);
      const t = sceneApi.readNodeTransform(id);
      if (t) useScene.getState().setTransform(id, t.position, t.rotation, t.scale);
      return;
    }
    if (!marquee) return;
    try {
      wrapper.current?.releasePointerCapture(e.pointerId);
    } catch {
      // never captured; nothing to release
    }
    const { x1, y1, x2, y2 } = marquee;
    setMarquee(null);
    marqueeEndedAt.current = performance.now();
    const picked = sceneApi.pickInRect(x1, y1, x2, y2);
    const s = useScene.getState();
    s.setSelection(e.shiftKey ? [...new Set([...s.selection, ...picked])] : picked);
  };

  const marqueeStyle = useMemo(() => {
    if (!marquee || !wrapper.current) return null;
    const host = wrapper.current.getBoundingClientRect();
    return {
      left: Math.min(marquee.x1, marquee.x2) - host.left,
      top: Math.min(marquee.y1, marquee.y2) - host.top,
      width: Math.abs(marquee.x2 - marquee.x1),
      height: Math.abs(marquee.y2 - marquee.y1),
    };
  }, [marquee]);

  return (
    <div
      ref={wrapper}
      className="relative h-full w-full"
      style={{ cursor: workplaneArmed || placing ? "crosshair" : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      // A touch the browser takes over (a scroll, a system gesture) ends
      // the same way a lifted finger does, so no marquee or cruise drag is
      // left waiting for a release that never comes.
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        if (
          editingGroupId &&
          e.target instanceof HTMLCanvasElement &&
          !sceneApi.hitTestNodes(e.clientX, e.clientY)
        ) {
          setEditingGroup(null);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(SHAPE_DRAG_TYPE)) e.preventDefault();
      }}
      onDrop={(e) => {
        const kind = e.dataTransfer.getData(SHAPE_DRAG_TYPE);
        if (!kind) return;
        e.preventDefault();
        sceneApi.dropShape(kind as PrimitiveKind, e.clientX, e.clientY);
      }}
    >
      <WebGLBoundary>
        {(conservative) => (
      <Canvas
        gl={conservative ? FALLBACK_GL : undefined}
        onPointerMissed={(e) => {
          // Only a plain left-click on the canvas itself deselects. Clicks on
          // DOM overlays (dimension pills etc.) bubble here too — ignore them,
          // as well as the contextmenu/right-button events orbiting ends with.
          if (!(e.target instanceof HTMLCanvasElement)) return;
          if (e.type !== "click" || e.button !== 0) return;
          // A finished marquee or handle drag also ends with a click on empty
          // canvas — don't let that wipe the selection it just made.
          if (performance.now() - marqueeEndedAt.current < 300) return;
          if (performance.now() - gizmoState.lastInteractionEnd < 300) return;
          const s = useScene.getState();
          if (s.workplaneArmed) {
            // Workplane dropped on empty space resets to the floor.
            s.setWorkplane(null);
            return;
          }
          if (s.alignMode) {
            s.setAlignMode(false);
            return;
          }
          // Rounding: a click that misses every line is a near miss, not a
          // request to stop. The tool ends from its bar, the toolbar, E or Esc.
          if (s.filletMode) return;
          if (s.measureMode) return; // clicks are measurement points
          clearSelection();
        }}
        className="bg-neutral-100"
      >
        <Cameras />
        <ambientLight intensity={0.7} />
        <directionalLight position={[80, -60, 120]} intensity={1.4} />
        <directionalLight position={[-60, 80, 40]} intensity={0.4} />

        <Grid
          rotation={[Math.PI / 2, 0, 0]}
          raycast={() => null}
          infiniteGrid
          cellSize={1}
          cellThickness={0.4}
          sectionSize={10}
          sectionThickness={1}
          cellColor="#b8bcc4"
          sectionColor="#8a909c"
          fadeDistance={600}
          fadeStrength={1.5}
          side={THREE.DoubleSide}
        />
        <BuildPlate />
        <WorkplaneGrid />

        {rootOrder.map((id) => {
          const node = nodes[id];
          if (!node) return null;
          if (editingGroup && id === editingGroup.id) {
            // Edit-in-place: the group's children render live in its frame.
            return (
              <group
                key={id}
                position={editingGroup.position}
                rotation={editingGroup.rotation}
                scale={editingGroup.scale}
              >
                {editingGroup.childIds.map((cid) => {
                  const child = nodes[cid];
                  return child ? renderNode(child, false) : null;
                })}
              </group>
            );
          }
          return renderNode(node, editingGroup !== null);
        })}

        <ViewCube />
        <Gizmo />
        <ResizeHandles />
        <AlignDots />
        <FilletEdges />
        <MeasureOverlay />
        <RulerOverlay />
        <PlacementPreview />
        <ControlsGate />
        <OrbitControls
          makeDefault
          // Zoom towards whatever is under the pointer rather than towards the
          // orbit target. Zooming at the centre means every close-up starts
          // with a scroll and then a pan to put the thing back on screen; this
          // keeps the point you aimed at where you aimed it, which is what
          // every other CAD tool does.
          zoomToCursor
          mouseButtons={{
            LEFT: undefined,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.ROTATE,
          }}
          // Touch: one finger orbits (there's no right button to orbit with),
          // two fingers pinch-zoom and pan. One-finger drags on a shape or a
          // handle are handled by ControlsGate disabling orbit for them.
          touches={{
            ONE: THREE.TOUCH.ROTATE,
            TWO: THREE.TOUCH.DOLLY_PAN,
          }}
        />
        <SceneRig />
      </Canvas>
        )}
      </WebGLBoundary>
      <ViewButtons />
      <DragChip />
      {marqueeStyle && (
        <div
          className="pointer-events-none absolute border border-blue-500 bg-blue-500/10"
          style={marqueeStyle}
        />
      )}
      {workplaneArmed && !placing && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-neutral-800/90 px-3 py-1 text-xs text-white">
          Click a face to set the workplane — click empty space to reset
        </div>
      )}
      {placing && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-neutral-800/90 px-3 py-1 text-xs text-white">
          Click to place the shape — it snaps against nearby objects · Esc to cancel
        </div>
      )}
      {rulerPlacing && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-neutral-800/90 px-3 py-1 text-xs text-white">
          Click to drop the ruler — corners snap · then select a shape to see its size and offsets
        </div>
      )}
      {measureMode && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-neutral-800/90 px-3 py-1 text-xs text-white">
          Measure: click two points — corners and midpoints snap · M or Esc to exit
        </div>
      )}
      {cruiseMode && !workplaneArmed && !placing && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-neutral-800/90 px-3 py-1 text-xs text-white">
          Cruise: drag a shape along other surfaces — C or Esc to exit
        </div>
      )}
      <FilletBar />
      {editingGroup && (
        <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded bg-neutral-800/90 px-3 py-1 text-xs text-white">
          Editing group
          <button
            onClick={() => setEditingGroup(null)}
            className="rounded bg-white/20 px-2 py-0.5 hover:bg-white/30"
          >
            Done (Esc)
          </button>
        </div>
      )}
    </div>
  );
}
