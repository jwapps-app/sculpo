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
      <div className="grid grid-cols-2 gap-1.5">
        {KINDS.map(({ kind, label }) => (
          <button
            key={kind}
            onClick={() => addShape(kind)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(SHAPE_DRAG_TYPE, kind);
              e.dataTransfer.effectAllowed = "copy";
            }}
            title={label}
            aria-label={label}
            className="flex aspect-square cursor-grab items-center justify-center rounded-md border border-neutral-200 hover:border-neutral-300 hover:bg-neutral-100 active:bg-neutral-200"
          >
            <img
              src={shapeIcon(kind)}
              alt={label}
              draggable={false}
              className="h-9 w-9"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
