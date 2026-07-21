import type { PrimitiveKind } from "../types/scene";
import { PALETTE_COLORS } from "../lib/primitives";
import { useScene } from "../state/store";

const KINDS: { kind: PrimitiveKind; label: string }[] = [
  { kind: "box", label: "Box" },
  { kind: "cylinder", label: "Cylinder" },
  { kind: "sphere", label: "Sphere" },
  { kind: "cone", label: "Cone" },
  { kind: "torus", label: "Torus" },
];

export function Palette() {
  const addShape = useScene((s) => s.addShape);

  return (
    <div className="flex w-32 flex-col gap-2 border-r border-neutral-200 bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Shapes
      </div>
      {KINDS.map(({ kind, label }) => (
        <button
          key={kind}
          onClick={() => addShape(kind)}
          className="flex items-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5 text-sm hover:bg-neutral-100 active:bg-neutral-200"
        >
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ backgroundColor: PALETTE_COLORS[kind] }}
          />
          {label}
        </button>
      ))}
    </div>
  );
}
