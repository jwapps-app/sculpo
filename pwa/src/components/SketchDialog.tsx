import { useEffect, useRef, useState } from "react";
import { useScene } from "../state/store";
import { parsePaths, parsePoints, type Pt } from "../lib/sketchGeometry";
import { isGroup } from "../types/scene";

// 2D sketch editor for the scribble / extrude / revolve tools. Canvas pixels
// map to millimeters at SCALE px/mm; Y is flipped so up on screen is +Y (or
// +Z height for revolve) in the world.
const W = 440;
const H = 440;
const SCALE = 2; // px per mm → 220×220mm workspace
const AXIS_X = 40; // revolve axis position, px
const CLOSE_RADIUS = 10; // px, click near the first vertex to close

type Mode = "scribble" | "extrude" | "revolve";

const TITLES: Record<Mode, string> = {
  scribble: "Scribble — draw freehand, it becomes a solid",
  extrude: "Extrude sketch — click to outline a shape",
  revolve: "Revolve sketch — profile spins around the axis",
};

export function SketchDialog() {
  const mode = useScene((s) => s.sketchMode);
  const editId = useScene((s) => s.sketchEditId);
  const setSketchMode = useScene((s) => s.setSketchMode);
  const addShapeWithParams = useScene((s) => s.addShapeWithParams);
  const updateShape = useScene((s) => s.updateShape);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Pt[][]>([]); // px coords
  const [points, setPoints] = useState<Pt[]>([]); // px coords
  const [closed, setClosed] = useState(false);
  const [brush, setBrush] = useState(4);
  const [height, setHeight] = useState(10);
  const drawing = useRef(false);

  // Reset per open; when re-editing, load the node's stored drawing back into
  // canvas coordinates (mm → px, Y flipped).
  useEffect(() => {
    setStrokes([]);
    setPoints([]);
    setClosed(false);
    setHeight(mode === "scribble" ? 5 : 10);
    if (!mode || !editId) return;
    const node = useScene.getState().project.nodes[editId];
    if (!node || isGroup(node)) return;
    const p = node.params;
    if (mode === "scribble") {
      setStrokes(
        parsePaths(p.paths).map((s) => s.map(([x, y]) => [x * SCALE, H - y * SCALE] as Pt)),
      );
      if (typeof p.brush === "number") setBrush(p.brush);
      if (typeof p.h === "number") setHeight(p.h);
    } else if (mode === "extrude") {
      setPoints(parsePoints(p.profile).map(([x, y]) => [x * SCALE, H - y * SCALE] as Pt));
      setClosed(true);
      if (typeof p.h === "number") setHeight(p.h);
    } else {
      setPoints(
        parsePoints(p.profile).map(([r, h]) => [AXIS_X + r * SCALE, H - h * SCALE] as Pt),
      );
      setClosed(true);
    }
  }, [mode, editId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mode) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    // Grid every 10mm.
    ctx.strokeStyle = "#eceef1";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 10 * SCALE) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += 10 * SCALE) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
      ctx.stroke();
    }
    if (mode === "revolve") {
      ctx.strokeStyle = "#2563eb";
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(AXIS_X, 0);
      ctx.lineTo(AXIS_X, H);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (mode === "scribble") {
      ctx.strokeStyle = "#1f2937";
      ctx.lineWidth = brush * SCALE;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const s of strokes) {
        if (s.length === 0) continue;
        ctx.beginPath();
        s.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.stroke();
        if (s.length === 1) {
          ctx.beginPath();
          ctx.arc(s[0][0], s[0][1], (brush * SCALE) / 2, 0, Math.PI * 2);
          ctx.fillStyle = "#1f2937";
          ctx.fill();
        }
      }
    } else {
      // Polygon preview.
      if (points.length > 0) {
        ctx.strokeStyle = "#1f2937";
        ctx.fillStyle = "rgba(37,99,235,0.12)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        if (closed) ctx.closePath();
        ctx.stroke();
        if (closed) ctx.fill();
        for (const [i, [x, y]] of points.entries()) {
          ctx.beginPath();
          ctx.arc(x, y, i === 0 && !closed ? 5 : 3.5, 0, Math.PI * 2);
          ctx.fillStyle = i === 0 && !closed ? "#2563eb" : "#1f2937";
          ctx.fill();
        }
      }
    }
  }, [mode, strokes, points, closed, brush]);

  if (!mode) return null;

  const local = (e: React.PointerEvent | React.MouseEvent): Pt => {
    const r = canvasRef.current!.getBoundingClientRect();
    let x = Math.min(W, Math.max(0, e.clientX - r.left));
    const y = Math.min(H, Math.max(0, e.clientY - r.top));
    if (mode === "revolve") x = Math.max(AXIS_X, x);
    return [x, y];
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (mode !== "scribble") return;
    drawing.current = true;
    setStrokes((s) => [...s, [local(e)]]);
    try {
      canvasRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer ids can't be captured */
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (mode !== "scribble" || !drawing.current) return;
    setStrokes((s) => {
      const next = s.slice();
      next[next.length - 1] = [...next[next.length - 1], local(e)];
      return next;
    });
  };
  const onPointerUp = () => {
    drawing.current = false;
  };
  const onClick = (e: React.MouseEvent) => {
    if (mode === "scribble" || closed) return;
    const p = local(e);
    if (points.length >= 3) {
      const [fx, fy] = points[0];
      if (Math.hypot(p[0] - fx, p[1] - fy) <= CLOSE_RADIUS) {
        setClosed(true);
        return;
      }
    }
    setPoints((pts) => [...pts, p]);
  };

  const undo = () => {
    if (mode === "scribble") setStrokes((s) => s.slice(0, -1));
    else if (closed) setClosed(false);
    else setPoints((p) => p.slice(0, -1));
  };

  const canCreate =
    mode === "scribble" ? strokes.length > 0 : points.length >= 3;

  const create = () => {
    let kind: "scribble" | "sketch" | "revolve";
    let params: Record<string, number | string>;
    if (mode === "scribble") {
      // px → mm, Y flipped.
      const paths = strokes.map((s) => s.map(([x, y]) => [x / SCALE, (H - y) / SCALE] as Pt));
      kind = "scribble";
      params = { paths: JSON.stringify(paths), brush, h: height };
    } else if (mode === "extrude") {
      const profile = points.map(([x, y]) => [x / SCALE, (H - y) / SCALE] as Pt);
      kind = "sketch";
      params = { profile: JSON.stringify(profile), h: height };
    } else {
      // x distance from the axis = radius; screen up = +Z height.
      const profile = points.map(
        ([x, y]) => [(x - AXIS_X) / SCALE, (H - y) / SCALE] as Pt,
      );
      kind = "revolve";
      const editNode = editId ? useScene.getState().project.nodes[editId] : undefined;
      const existing = editNode && !isGroup(editNode) ? editNode.params : undefined;
      params = {
        profile: JSON.stringify(profile),
        segments:
          existing && typeof existing.segments === "number" ? existing.segments : 48,
      };
    }
    if (editId) {
      updateShape(editId, { params });
      setSketchMode(null);
    } else {
      addShapeWithParams(kind, params);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
      <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-xl">
        <div className="mb-2 flex items-center justify-between gap-8">
          <span className="text-sm font-semibold">{TITLES[mode]}</span>
          <span className="text-xs text-neutral-400">
            {mode === "scribble"
              ? "Drag to draw"
              : closed
                ? "Outline closed"
                : "Click the first point to close"}
          </span>
        </div>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          data-sketch-canvas
          className="cursor-crosshair rounded border border-neutral-300 bg-white"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={onClick}
        />
        <div className="mt-3 flex items-center gap-3 text-sm">
          {mode === "scribble" && (
            <label className="flex items-center gap-1 text-xs text-neutral-600">
              Brush
              <input
                type="range"
                min={1}
                max={12}
                value={brush}
                onChange={(e) => setBrush(Number(e.target.value))}
              />
              {brush}mm
            </label>
          )}
          {mode !== "revolve" && (
            <label className="flex items-center gap-1 text-xs text-neutral-600">
              Height
              <input
                type="number"
                min={0.5}
                value={height}
                onChange={(e) => setHeight(Math.max(0.5, Number(e.target.value) || 1))}
                className="w-16 rounded border border-neutral-300 px-1 py-0.5 text-right"
              />
              mm
            </label>
          )}
          <button onClick={undo} className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100">
            Undo
          </button>
          <button
            onClick={() => {
              setStrokes([]);
              setPoints([]);
              setClosed(false);
            }}
            className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100"
          >
            Clear
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setSketchMode(null)}
            className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100"
          >
            Cancel
          </button>
          <button
            onClick={create}
            disabled={!canCreate}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {editId ? "Update" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
