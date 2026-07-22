import * as THREE from "three";
import { AXIS_COLORS } from "../constants/ui";
import type { ShapeNode, Vec3 } from "../types/scene";
import { isGroup } from "../types/scene";
import { useScene } from "../state/store";

function NumberField({
  label,
  value,
  onCommit,
  step = 1,
  labelColor,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  labelColor?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span
        className={`w-5 ${labelColor ? "font-bold" : "text-neutral-500"}`}
        style={labelColor ? { color: labelColor } : undefined}
      >
        {label}
      </span>
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
          labelColor={AXIS_COLORS[i]}
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

// Params that hold encoded geometry/sketch data, not user-editable values.
const HIDDEN_PARAMS = new Set(["pos", "idx", "profile", "paths"]);

function ShapeParams({ node }: { node: ShapeNode }) {
  const updateShape = useScene((s) => s.updateShape);
  const numericKeys = Object.keys(node.params).filter(
    (k) => typeof node.params[k] === "number" && !HIDDEN_PARAMS.has(k),
  );
  const stringKeys = Object.keys(node.params).filter(
    (k) => typeof node.params[k] === "string" && !HIDDEN_PARAMS.has(k),
  );
  if (numericKeys.length === 0 && stringKeys.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {node.kind} params (mm)
      </div>
      {stringKeys.map((key) => (
        <label key={key} className="flex items-center justify-between gap-2 text-sm">
          <span className="text-neutral-500">{key}</span>
          <input
            type="text"
            key={`${node.id}-${key}`}
            defaultValue={node.params[key] as string}
            onBlur={(e) =>
              updateShape(node.id, { params: { ...node.params, [key]: e.target.value } })
            }
            className="w-28 rounded border border-neutral-300 px-1.5 py-0.5 text-sm"
          />
        </label>
      ))}
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

const AXES = ["X", "Y", "Z"] as const;

function LockHideRow() {
  const toggleLockSelected = useScene((s) => s.toggleLockSelected);
  const hideSelected = useScene((s) => s.hideSelected);
  const selection = useScene((s) => s.selection);
  const nodes = useScene((s) => s.project.nodes);
  const anyLocked = selection.some((id) => nodes[id]?.locked);
  return (
    <div className="flex gap-1">
      <button
        onClick={toggleLockSelected}
        className={`flex-1 rounded border px-2 py-1 text-xs ${
          anyLocked
            ? "border-neutral-700 bg-neutral-800 text-white"
            : "border-neutral-300 hover:bg-neutral-100"
        }`}
      >
        {anyLocked ? "Unlock" : "Lock"}
      </button>
      <button
        onClick={hideSelected}
        className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100"
      >
        Hide
      </button>
    </div>
  );
}

function FlipRow() {
  const mirrorSelected = useScene((s) => s.mirrorSelected);
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Flip
      </div>
      <div className="flex gap-1">
        {AXES.map((axis, i) => (
          <button
            key={axis}
            onClick={() => mirrorSelected(i as 0 | 1 | 2)}
            className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs font-bold hover:bg-neutral-100"
            style={{ color: AXIS_COLORS[i] }}
          >
            {axis}
          </button>
        ))}
      </div>
    </div>
  );
}

function AlignPanel() {
  const alignMode = useScene((s) => s.alignMode);
  const setAlignMode = useScene((s) => s.setAlignMode);
  return (
    <button
      onClick={() => setAlignMode(!alignMode)}
      className={`rounded border px-2 py-1 text-xs ${
        alignMode
          ? "border-neutral-700 bg-neutral-800 text-white"
          : "border-neutral-300 hover:bg-neutral-100"
      }`}
    >
      {alignMode ? "Align: click the colored dots" : "Align (L)"}
    </button>
  );
}

export function Inspector() {
  const selection = useScene((s) => s.selection);
  const nodes = useScene((s) => s.project.nodes);
  const updateShape = useScene((s) => s.updateShape);
  const setTransform = useScene((s) => s.setTransform);

  const selected = selection.map((id) => nodes[id]).filter((n) => !!n);

  if (selected.length === 0) {
    return (
      <div className="w-56 border-l border-neutral-200 bg-white p-3 text-sm text-neutral-400">
        Nothing selected
      </div>
    );
  }

  if (selected.length > 1) {
    return (
      <div className="flex w-56 flex-col gap-4 overflow-y-auto border-l border-neutral-200 bg-white p-3">
        <div className="text-sm text-neutral-500">
          {selected.length} objects selected
        </div>
        <AlignPanel />
        <FlipRow />
        <LockHideRow />
      </div>
    );
  }

  if (isGroup(selected[0])) {
    const group = selected[0];
    return (
      <div className="flex w-56 flex-col gap-4 overflow-y-auto border-l border-neutral-200 bg-white p-3">
        <div className="text-sm font-semibold">
          Group · {group.childIds.length} children
        </div>
        <VecFields
          title="Position (mm)"
          value={group.position}
          onCommit={(v) => setTransform(group.id, v, group.rotation, group.scale)}
        />
        <VecFields
          title="Rotation (°)"
          value={group.rotation}
          step={15}
          toDisplay={(v) => THREE.MathUtils.radToDeg(v)}
          fromDisplay={(v) => THREE.MathUtils.degToRad(v)}
          onCommit={(v) => setTransform(group.id, group.position, v, group.scale)}
        />
        <VecFields
          title="Scale"
          value={group.scale}
          step={0.1}
          onCommit={(v) => setTransform(group.id, group.position, group.rotation, v)}
        />
        <FlipRow />
        <LockHideRow />
        <p className="text-xs text-neutral-400">
          Double-click to edit the shapes inside; ⇧⌘G to ungroup.
        </p>
      </div>
    );
  }

  const node = selected[0] as ShapeNode;

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

      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-neutral-500">Color</span>
        <input
          type="color"
          value={node.color}
          onChange={(e) => updateShape(node.id, { color: e.target.value })}
          className="h-7 w-14 cursor-pointer rounded border border-neutral-300"
        />
      </label>

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
      <FlipRow />
      <LockHideRow />
    </div>
  );
}
