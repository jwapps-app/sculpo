import { useEffect } from "react";
import { Pencil, PenTool, RotateCcw } from "lucide-react";
import type { PrimitiveKind } from "../types/scene";
import { fallbackIcon, releaseIconRenderer, shapeIcon } from "../lib/shapeIcons";
import { useScene } from "../state/store";
import { SHAPE_DRAG_TYPE } from "./Viewport";

const SKETCH_TOOLS = [
  { mode: "scribble", label: "Scribble", icon: Pencil },
  { mode: "extrude", label: "Extrude sketch", icon: PenTool },
  { mode: "revolve", label: "Revolve sketch", icon: RotateCcw },
] as const;

const KINDS: { kind: PrimitiveKind; label: string }[] = [
  { kind: "box", label: "Box" },
  { kind: "cylinder", label: "Cylinder" },
  { kind: "sphere", label: "Sphere" },
  { kind: "cone", label: "Cone" },
  { kind: "torus", label: "Torus" },
  { kind: "wedge", label: "Wedge" },
  { kind: "roof", label: "Roof" },
  { kind: "pyramid", label: "Pyramid" },
  { kind: "hemisphere", label: "Half Sphere" },
  { kind: "polygon", label: "Polygon" },
  { kind: "octagon", label: "Octagon" },
  { kind: "tube", label: "Tube" },
  { kind: "star", label: "Star" },
  { kind: "text", label: "Text" },
  { kind: "gear", label: "Gear" },
  { kind: "thread", label: "Thread" },
];

export function Palette() {
  // Icons are rendered during the first render; the GPU context behind
  // them is released as soon as that is done.
  useEffect(() => releaseIconRenderer(), []);
  const setPlacing = useScene((s) => s.setPlacing);
  const placing = useScene((s) => s.placing);
  const setSketchMode = useScene((s) => s.setSketchMode);

  return (
    <div className="flex w-32 flex-col gap-2 overflow-y-auto border-r border-neutral-200 bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Shapes
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {KINDS.map(({ kind, label }) => (
          <button
            key={kind}
            onClick={() => setPlacing(placing === kind ? null : kind)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(SHAPE_DRAG_TYPE, kind);
              e.dataTransfer.effectAllowed = "copy";
            }}
            title={`${label} — click, then click in the scene to place`}
            aria-label={label}
            className={`flex aspect-square cursor-grab items-center justify-center rounded-md border hover:bg-neutral-100 active:bg-neutral-200 ${
              placing === kind
                ? "border-blue-500 bg-blue-50"
                : "border-neutral-200 hover:border-neutral-300"
            }`}
          >
            <img
              src={shapeIcon(kind) || fallbackIcon(kind, label)}
              alt={label}
              draggable={false}
              className="h-9 w-9"
            />
          </button>
        ))}
      </div>
      <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Sketch
      </div>
      <div className="flex flex-col gap-1.5">
        {SKETCH_TOOLS.map(({ mode, label, icon: Icon }) => (
          <button
            key={mode}
            onClick={() => setSketchMode(mode)}
            title={label}
            className="flex items-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5 text-xs hover:border-neutral-300 hover:bg-neutral-100"
          >
            <Icon size={14} strokeWidth={1.8} className="shrink-0 text-neutral-600" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
