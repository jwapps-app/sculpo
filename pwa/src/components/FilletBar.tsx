import { useState } from "react";
import { useScene } from "../state/store";
import { fromDisplay, toDisplay } from "../lib/units";

/** The rounding tool's controls, shown along the bottom of the viewport. */
export function FilletBar() {
  const filletMode = useScene((s) => s.filletMode);
  const radius = useScene((s) => s.filletRadius);
  const setRadius = useScene((s) => s.setFilletRadius);
  const setFilletMode = useScene((s) => s.setFilletMode);
  const units = useScene((s) => s.units);
  const [draft, setDraft] = useState<string | null>(null);
  if (!filletMode) return null;

  const shown = Number(toDisplay(radius, units).toFixed(3));
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    setDraft(null);
    if (Number.isFinite(v) && v > 0) setRadius(fromDisplay(v, units));
  };

  return (
    <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded bg-neutral-800/90 px-3 py-1.5 text-xs text-white">
      <span className="font-semibold">Round edges</span>
      <label className="flex items-center gap-1">
        radius
        <input
          type="number"
          min={0}
          step={units === "mm" ? 0.5 : 0.0625}
          value={draft ?? shown}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setDraft(null);
          }}
          className="w-14 rounded bg-white/15 px-1 py-0.5 text-right text-white"
        />
        {units}
      </label>
      <span className="text-white/70">Click any edge to round it · again to square it</span>
      <button
        onClick={() => setFilletMode(false)}
        className="rounded bg-white/20 px-2 py-0.5 hover:bg-white/30"
      >
        Done (Esc)
      </button>
    </div>
  );
}
