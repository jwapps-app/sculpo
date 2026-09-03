import { useEffect, useState } from "react";
import * as THREE from "three";
import { Link2, Unlink2 } from "lucide-react";
import { AXIS_COLORS } from "../constants/ui";
import { sceneApi } from "../lib/sceneApi";
import { FONT_NAMES } from "../lib/primitives";
import {
  COUNT_PARAMS,
  fromDisplay as mmFromDisplay,
  toDisplay as mmToDisplay,
  type Units,
} from "../lib/units";
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

const SIZE_LOCK_KEY = "size-lock-proportions";

/**
 * Overall size of the selection — width, depth, height in the current units,
 * read from the live world bounds, so it works the same for a primitive, a
 * group, an import, or several things at once. Typing a new value scales the
 * selection to hit it; with proportions locked (the default) the other two
 * follow, so "make it 37 wide" keeps a complex part's shape.
 *
 * Scales about the bottom-centre of the bounds: the part stays centred where
 * it was and keeps its feet on the workplane, which is what you want for a
 * thing that is going to be printed.
 */
function SizeFields({ ids, units }: { ids: string[]; units: Units }) {
  const nodes = useScene((s) => s.project.nodes);
  const [dims, setDims] = useState<Vec3 | null>(null);
  const [locked, setLocked] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIZE_LOCK_KEY) !== "off";
    } catch {
      return true;
    }
  });

  // A stable identity for the selection: the caller passes a fresh array
  // each render, and depending on it directly made the effect re-run on
  // every re-render for no reason.
  const key = ids.join("|");

  // Bounds come from the rendered scene, which lives in a separate React
  // root and may commit after this one. Measure now, and again on the next
  // macrotask, by which point both roots have flushed. A timeout rather than
  // an animation frame: frames stop entirely in a background tab, and a
  // measurement that silently never happens is worse than one a tick late.
  useEffect(() => {
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const box = new THREE.Box3();
      let any = false;
      for (const id of key.split("|")) {
        const b = sceneApi.getNodeBounds(id);
        if (b && !b.isEmpty()) {
          box.union(b);
          any = true;
        }
      }
      setDims(any ? (box.getSize(new THREE.Vector3()).toArray() as Vec3) : null);
    };
    measure();
    const later = setTimeout(measure, 0);
    return () => {
      alive = false;
      clearTimeout(later);
    };
  }, [key, nodes]);

  const toggleLock = () => {
    const next = !locked;
    setLocked(next);
    try {
      localStorage.setItem(SIZE_LOCK_KEY, next ? "on" : "off");
    } catch {
      /* private mode etc. — the toggle still works for this session */
    }
  };

  const resize = (axis: 0 | 1 | 2, displayValue: number) => {
    // Measure at commit time rather than trusting state: the factor is a
    // ratio against the *current* size, and a stale reading compounds.
    const box = new THREE.Box3();
    for (const id of ids) {
      const b = sceneApi.getNodeBounds(id);
      if (b && !b.isEmpty()) box.union(b);
    }
    if (box.isEmpty()) return;
    const current = box.getSize(new THREE.Vector3()).getComponent(axis);
    const targetMm = mmFromDisplay(displayValue, units);
    if (!(targetMm > 0) || !(current > 0)) return;
    const f = targetMm / current;
    const factors: Vec3 = locked ? [f, f, f] : [1, 1, 1];
    if (!locked) factors[axis] = f;
    // Anchor: bottom-centre of the current bounds.
    const c = box.getCenter(new THREE.Vector3());
    sceneApi.scaleNodesAbout(ids, factors, [c.x, c.y, box.min.z]);
  };

  return (
    <div className="space-y-1" data-dims={dims ? dims.map((v) => v.toFixed(3)).join(",") : ""}>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Size ({units})
        </div>
        <button
          onClick={toggleLock}
          title={
            locked
              ? "Proportions locked — changing one dimension scales the others to match"
              : "Proportions unlocked — each dimension changes on its own"
          }
          aria-pressed={locked}
          className={`rounded p-1 ${
            locked ? "bg-neutral-800 text-white" : "text-neutral-500 hover:bg-neutral-100"
          }`}
        >
          {locked ? <Link2 size={13} /> : <Unlink2 size={13} />}
        </button>
      </div>
      {(["W", "D", "H"] as const).map((label, i) => (
        <DraftNumberField
          key={`${label}:${key}`}
          label={label}
          labelColor={AXIS_COLORS[i]}
          step={units === "in" ? 0.125 : 1}
          value={dims ? mmToDisplay(dims[i], units) : 0}
          onCommit={(v) => resize(i as 0 | 1 | 2, v)}
        />
      ))}
    </div>
  );
}

/**
 * Like NumberField, but commits on Enter or blur rather than every keystroke.
 * A size is a ratio against the current size, so committing "2" on the way
 * to "25" would scale the part to 2mm and then 12.5x back up — each step a
 * fresh measurement, each one wrong.
 */
function DraftNumberField({
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
  const shown = Number(value.toFixed(3));
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    setDraft(null);
    if (Number.isFinite(v) && v !== shown) onCommit(v);
  };
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
        value={draft ?? shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(null);
        }}
        className="w-20 rounded border border-neutral-300 px-1.5 py-0.5 text-right text-sm"
      />
    </label>
  );
}

// Params that hold encoded geometry/sketch data, not user-editable values.
const HIDDEN_PARAMS = new Set(["pos", "idx", "profile", "paths"]);
// Params where 0 is meaningful rather than degenerate.
const ZEROABLE_PARAMS = new Set(["radius", "bevel"]);

function ShapeParams({ node }: { node: ShapeNode }) {
  const updateShape = useScene((s) => s.updateShape);
  const units = useScene((s) => s.units);
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
        {node.kind} params ({units})
      </div>
      {stringKeys.map((key) =>
        key === "font" ? (
          <label key={key} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-neutral-500">{key}</span>
            <select
              value={node.params[key] as string}
              onChange={(e) =>
                updateShape(node.id, { params: { ...node.params, [key]: e.target.value } })
              }
              className="w-28 rounded border border-neutral-300 px-1 py-0.5 text-sm"
            >
              {FONT_NAMES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        ) : (
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
        ),
      )}
      {numericKeys.map((key) => {
        const isCount = COUNT_PARAMS.has(key);
        const u: Units = isCount ? "mm" : units; // counts pass through untouched
        const raw = node.params[key] as number;
        return (
          <label key={key} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-neutral-500">{key}</span>
            <input
              type="number"
              value={isCount ? raw : Number(mmToDisplay(raw, u).toFixed(3))}
              step={isCount || u === "mm" ? 1 : 0.125}
              onChange={(e) => {
                const v = Number(e.target.value);
                // Rounding params are legitimately zero (= sharp edges).
                const minAllowed = ZEROABLE_PARAMS.has(key) ? 0 : Number.MIN_VALUE;
                if (!Number.isFinite(v) || v < minAllowed) return;
                updateShape(node.id, {
                  params: { ...node.params, [key]: isCount ? v : mmFromDisplay(v, u) },
                });
              }}
              className="w-20 rounded border border-neutral-300 px-1.5 py-0.5 text-right text-sm"
            />
          </label>
        );
      })}
    </div>
  );
}

const AXES = ["X", "Y", "Z"] as const;

// Relative rotation control: type or step degrees per world axis to rotate the
// selection by that much (about its center, like the gizmo), and Reset returns
// it to upright. Absolute Euler fields couple the axes confusingly, so we
// don't edit them directly.
function RotateControl() {
  const rotateSelectedBy = useScene((s) => s.rotateSelectedBy);
  const resetRotationSelected = useScene((s) => s.resetRotationSelected);
  const nudge = (axis: 0 | 1 | 2, deg: number) => {
    if (deg) rotateSelectedBy(axis, THREE.MathUtils.degToRad(deg));
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Rotate (°)
        </span>
        <button
          onClick={resetRotationSelected}
          title="Return to upright (no rotation)"
          className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs hover:bg-neutral-100"
        >
          Reset
        </button>
      </div>
      {AXES.map((axis, i) => (
        <div key={axis} className="flex items-center gap-2 text-sm">
          <span className="w-4 font-bold" style={{ color: AXIS_COLORS[i] }}>
            {axis}
          </span>
          <div className="flex overflow-hidden rounded border border-neutral-300">
            <button
              onClick={() => nudge(i as 0 | 1 | 2, -15)}
              title="Rotate -15°"
              className="px-1.5 hover:bg-neutral-100"
            >
              −
            </button>
            <input
              type="number"
              step={15}
              defaultValue={0}
              key={`${axis}-nudge`}
              title="Type degrees, press Enter to rotate by that much"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  nudge(i as 0 | 1 | 2, Number(e.currentTarget.value) || 0);
                  e.currentTarget.value = "0";
                  e.currentTarget.blur();
                }
              }}
              className="w-14 border-x border-neutral-300 px-1.5 py-0.5 text-right"
            />
            <button
              onClick={() => nudge(i as 0 | 1 | 2, 15)}
              title="Rotate +15°"
              className="px-1.5 hover:bg-neutral-100"
            >
              +
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function LockHideRow() {
  const toggleLockSelected = useScene((s) => s.toggleLockSelected);
  const hideSelected = useScene((s) => s.hideSelected);
  const toggleTransparentSelected = useScene((s) => s.toggleTransparentSelected);
  const selection = useScene((s) => s.selection);
  const nodes = useScene((s) => s.project.nodes);
  const anyLocked = selection.some((id) => nodes[id]?.locked);
  const anyTransparent = selection.some((id) => nodes[id]?.transparent);
  return (
    <>
    <button
      onClick={toggleTransparentSelected}
      title="See-through, for checking internal fits (display only)"
      className={`rounded border px-2 py-1 text-xs ${
        anyTransparent
          ? "border-neutral-700 bg-neutral-800 text-white"
          : "border-neutral-300 hover:bg-neutral-100"
      }`}
    >
      {anyTransparent ? "Transparent: on" : "Transparent"}
    </button>
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
    </>
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
  const setNodeColor = useScene((s) => s.setNodeColor);
  const units = useScene((s) => s.units);

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
        <SizeFields ids={selection} units={units} />
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
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="text-neutral-500">Color</span>
          <span className="flex items-center gap-1">
            <input
              type="color"
              value={group.color ?? "#b0b0b0"}
              onChange={(e) =>
                setNodeColor(group.id, e.target.value)
              }
              className="h-7 w-14 cursor-pointer rounded border border-neutral-300"
            />
            <button
              onClick={() => setNodeColor(group.id, undefined)}
              title="Inherit from the first solid inside"
              className="rounded border border-neutral-300 px-1.5 py-1 text-xs hover:bg-neutral-100"
            >
              Auto
            </button>
          </span>
        </label>
        <VecFields
          title={`Position (${units})`}
          value={group.position}
          step={units === "in" ? 0.125 : 1}
          toDisplay={(v) => mmToDisplay(v, units)}
          fromDisplay={(v) => mmFromDisplay(v, units)}
          onCommit={(v) => setTransform(group.id, v, group.rotation, group.scale)}
        />
        <SizeFields ids={[group.id]} units={units} />
        <RotateControl />
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
        title={`Position (${units})`}
        value={node.position}
        step={units === "in" ? 0.125 : 1}
        toDisplay={(v) => mmToDisplay(v, units)}
        fromDisplay={(v) => mmFromDisplay(v, units)}
        onCommit={(v) => updateShape(node.id, { position: v })}
      />
      <SizeFields ids={[node.id]} units={units} />
      <RotateControl />
      <VecFields
        title="Scale"
        value={node.scale}
        step={0.1}
        onCommit={(v) => updateShape(node.id, { scale: v })}
      />
      <ShapeParams node={node} />
      {["sketch", "revolve", "scribble"].includes(node.kind) && (
        <button
          onClick={() => useScene.getState().editSketch(node.id)}
          className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100"
        >
          Edit sketch (or double-click the shape)
        </button>
      )}
      <FlipRow />
      <LockHideRow />
    </div>
  );
}
