import { useState } from "react";
import { useScene } from "../state/store";
import { fromDisplay, toDisplay, type Units } from "../lib/units";

/** A length field that commits on blur or Enter, shown in the user's units. */
function LengthField({
  label,
  mm,
  units,
  onCommit,
}: {
  label: string;
  mm: number;
  units: Units;
  onCommit: (mm: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = Number(toDisplay(mm, units).toFixed(3));
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    setDraft(null);
    if (Number.isFinite(v) && v > 0) onCommit(fromDisplay(v, units));
  };
  return (
    <label className="flex items-center gap-1">
      {label}
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
  );
}

/** The rounding tool's controls, shown along the bottom of the viewport. */
export function FilletBar() {
  const filletMode = useScene((s) => s.filletMode);
  const style = useScene((s) => s.filletStyle);
  const radius = useScene((s) => s.filletRadius);
  const diameter = useScene((s) => s.sinkDiameter);
  const angle = useScene((s) => s.sinkAngle);
  const setRadius = useScene((s) => s.setFilletRadius);
  const setStyle = useScene((s) => s.setFilletStyle);
  const setDiameter = useScene((s) => s.setSinkDiameter);
  const setAngle = useScene((s) => s.setSinkAngle);
  const setFilletMode = useScene((s) => s.setFilletMode);
  const units = useScene((s) => s.units);
  const [angleDraft, setAngleDraft] = useState<string | null>(null);
  if (!filletMode) return null;

  const tab = (on: boolean) =>
    `rounded px-2 py-0.5 ${on ? "bg-white text-neutral-900" : "bg-white/15 hover:bg-white/25"}`;
  const commitAngle = () => {
    if (angleDraft === null) return;
    const v = Number(angleDraft);
    setAngleDraft(null);
    if (Number.isFinite(v)) setAngle(v);
  };

  return (
    <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded bg-neutral-800/90 px-3 py-1.5 text-xs text-white">
      <span className="flex gap-1">
        <button className={tab(style === "round")} onClick={() => setStyle("round")}>
          Round
        </button>
        <button className={tab(style === "sink")} onClick={() => setStyle("sink")}>
          Countersink
        </button>
      </span>
      {style === "round" ? (
        <>
          <LengthField label="radius" mm={radius} units={units} onCommit={setRadius} />
          <span className="text-white/70">Click any edge to round it · again to square it</span>
        </>
      ) : (
        <>
          <LengthField label="Ø" mm={diameter} units={units} onCommit={setDiameter} />
          <label className="flex items-center gap-1">
            angle
            <input
              type="number"
              min={10}
              max={170}
              step={1}
              value={angleDraft ?? angle}
              onChange={(e) => setAngleDraft(e.target.value)}
              onBlur={commitAngle}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setAngleDraft(null);
              }}
              className="w-12 rounded bg-white/15 px-1 py-0.5 text-right text-white"
            />
            °
          </label>
          <span className="text-white/70">Click a hole's rim to countersink it · again to undo</span>
        </>
      )}
      <button
        onClick={() => setFilletMode(false)}
        className="rounded bg-white/20 px-2 py-0.5 hover:bg-white/30"
      >
        Done (Esc)
      </button>
    </div>
  );
}
