import type { PrimitiveKind } from "../types/scene";
import { shapeIcon } from "../lib/shapeIcons";
import { useScene } from "../state/store";
import { SHAPE_DRAG_TYPE } from "./Viewport";

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
  { kind: "tube", label: "Tube" },
  { kind: "star", label: "Star" },
  { kind: "text", label: "Text" },
];

export function Palette() {
  const addShape = useScene((s) => s.addShape);

  return (
    <div className="flex w-32 flex-col gap-2 overflow-y-auto border-r border-neutral-200 bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Shapes
      </div>
      {KINDS.map(({ kind, label }) => (
        <button
          key={kind}
          onClick={() => addShape(kind)}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(SHAPE_DRAG_TYPE, kind);
            e.dataTransfer.effectAllowed = "copy";
          }}
          title="Click to add at origin, or drag onto the workplane"
          className="flex cursor-grab items-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5 text-sm hover:bg-neutral-100 active:bg-neutral-200"
        >
          <img
            src={shapeIcon(kind)}
            alt=""
            draggable={false}
            className="h-8 w-8 shrink-0"
          />
          {label}
        </button>
      ))}
    </div>
  );
}
