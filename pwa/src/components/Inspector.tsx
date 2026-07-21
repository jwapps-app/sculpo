import * as THREE from "three";
import type { ShapeNode, Vec3 } from "../types/scene";
import { isGroup } from "../types/scene";
import { useScene } from "../state/store";

function NumberField({
  label,
  value,
  onCommit,
  step = 1,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="w-5 text-neutral-500">{label}</span>
      <input
        type="number"
        step={step}
        value={Number(value.toFixed(3))}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onCommit(v);
        }}
        className="w-20 rounded border border-neutral-300 px-1.5 py-0.5 text-right text-sm"
      />
    </label>
  );
}

function VecFields({
  title,
  value,
  onCommit,
  step,
  toDisplay = (v) => v,
  fromDisplay = (v) => v,
}: {
  title: string;
  value: Vec3;
  onCommit: (v: Vec3) => void;
  step?: number;
  toDisplay?: (v: number) => number;
  fromDisplay?: (v: number) => number;
}) {
  const axes = ["X", "Y", "Z"] as const;
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </div>
      {axes.map((axis, i) => (
        <NumberField
          key={axis}
          label={axis}
          step={step}
          value={toDisplay(value[i])}
          onCommit={(v) => {
            const next = [...value] as Vec3;
            next[i] = fromDisplay(v);
            onCommit(next);
          }}
        />
      ))}
    </div>
  );
}

function ShapeParams({ node }: { node: ShapeNode }) {
  const updateShape = useScene((s) => s.updateShape);
  const numericKeys = Object.keys(node.params).filter(
    (k) => typeof node.params[k] === "number",
  );
  if (numericKeys.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {node.kind} params (mm)
      </div>
      {numericKeys.map((key) => (
        <label key={key} className="flex items-center justify-between gap-2 text-sm">
          <span className="text-neutral-500">{key}</span>
          <input
            type="number"
            value={node.params[key] as number}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v) || v <= 0) return;
              updateShape(node.id, { params: { ...node.params, [key]: v } });
            }}
            className="w-20 rounded border border-neutral-300 px-1.5 py-0.5 text-right text-sm"
          />
        </label>
      ))}
    </div>
  );
}

export function Inspector() {
  const selection = useScene((s) => s.selection);
  const nodes = useScene((s) => s.project.nodes);
  const updateShape = useScene((s) => s.updateShape);

  const selected = selection
    .map((id) => nodes[id])
    .filter((n): n is ShapeNode => !!n && !isGroup(n));

  if (selected.length === 0) {
    return (
      <div className="w-56 border-l border-neutral-200 bg-white p-3 text-sm text-neutral-400">
        Nothing selected
      </div>
    );
  }

  if (selected.length > 1) {
    return (
      <div className="w-56 border-l border-neutral-200 bg-white p-3 text-sm text-neutral-500">
        {selected.length} shapes selected
      </div>
    );
  }

  const node = selected[0];

  return (
    <div className="flex w-56 flex-col gap-4 overflow-y-auto border-l border-neutral-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold capitalize">{node.kind}</span>
        <div className="flex overflow-hidden rounded-md border border-neutral-300 text-xs">
          {(["solid", "hole"] as const).map((role) => (
            <button
              key={role}
              onClick={() => updateShape(node.id, { role })}
              className={`px-2 py-1 capitalize ${
                node.role === role
                  ? "bg-neutral-800 text-white"
                  : "bg-white text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {role}
            </button>
          ))}
        </div>
      </div>

      <VecFields
        title="Position (mm)"
        value={node.position}
        onCommit={(v) => updateShape(node.id, { position: v })}
      />
      <VecFields
        title="Rotation (°)"
        value={node.rotation}
        step={15}
        toDisplay={(v) => THREE.MathUtils.radToDeg(v)}
        fromDisplay={(v) => THREE.MathUtils.degToRad(v)}
        onCommit={(v) => updateShape(node.id, { rotation: v })}
      />
      <VecFields
        title="Scale"
        value={node.scale}
        step={0.1}
        onCommit={(v) => updateShape(node.id, { scale: v })}
      />
      <ShapeParams node={node} />
    </div>
  );
}
