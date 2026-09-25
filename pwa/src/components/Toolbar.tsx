import { Fragment, useRef, useState } from "react";
import {
  AlignStartVertical,
  ArrowDownToLine,
  Copy,
  Eye,
  FilePlus2,
  FileUp,
  FlipHorizontal2,
  FolderOpen,
  Frame,
  Group as GroupIcon,
  Hand,
  Layers,
  Lock,
  LockOpen,
  Magnet,
  Move,
  Printer,
  RotateCw,
  Ruler,
  Save,
  Scaling,
  Settings2,
  Trash2,
  Undo2,
  Redo2,
  EyeOff,
  Ungroup as UngroupIcon,
  TriangleAlert,
  Radius,
} from "lucide-react";
import { APP_NAME } from "../constants/branding";
import { useCoarsePointer } from "../lib/pointer";
import { useEngineStatus } from "../lib/manifold";
import { AXIS_COLORS } from "../constants/ui";
import { SNAP_STEPS } from "../lib/units";
import { useScene, undo, redo } from "../state/store";
import type { TransformMode } from "../state/store";
import { isGroup } from "../types/scene";
import { exportSceneStl } from "../lib/exportStl";
import { saveProjectFile, parseProjectFile } from "../lib/projectFile";
import { CloudPanel } from "./CloudPanel";

// Common FDM build plates (mm). Sizes, not brand promises.
const BED_PRESETS: { label: string; size: [number, number] }[] = [
  { label: "180 × 180", size: [180, 180] },
  { label: "220 × 220", size: [220, 220] },
  { label: "250 × 210", size: [250, 210] },
  { label: "256 × 256", size: [256, 256] },
  { label: "300 × 300", size: [300, 300] },
  { label: "350 × 350", size: [350, 350] },
];

const MODES: { mode: TransformMode; label: string; key: string; icon: typeof Move }[] = [
  { mode: "translate", label: "Move", key: "G", icon: Move },
  { mode: "rotate", label: "Rotate", key: "R", icon: RotateCw },
  { mode: "scale", label: "Scale", key: "S", icon: Scaling },
];

function IconButton({
  label,
  title,
  onClick,
  icon: Icon,
  active,
  disabled,
  accent,
  showLabel,
}: {
  label: string;
  // Hover text, when it should say more than the label (a shortcut hint).
  title?: string;
  onClick: () => void;
  icon: typeof Move;
  active?: boolean;
  disabled?: boolean;
  accent?: boolean;
  // Spell the label out on touch, where there is no hover to reveal it.
  showLabel?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      aria-label={label}
      disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-md p-1.5 ${
        accent
          ? "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
          : active
            ? "bg-neutral-800 text-white"
            : "text-neutral-700 hover:bg-neutral-200 disabled:opacity-30"
      }`}
    >
      <Icon size={17} strokeWidth={1.8} />
      {showLabel && <span className="touch-label text-xs font-medium">{label}</span>}
    </button>
  );
}

function Divider() {
  return <div className="toolbar-divider mx-1.5 h-5 w-px bg-neutral-200" />;
}

const AXES = ["X", "Y", "Z"] as const;

function Popover({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute right-0 top-full z-20 mt-1 rounded-md border border-neutral-200 bg-white p-2 shadow-lg">
        {children}
      </div>
    </>
  );
}

/** Shown only if the boolean engine could not start. Cuts still work through
 *  the compatibility engine, but its output is not watertight, and that is
 *  the kind of failure nobody notices until a slicer complains. */
function EngineWarning() {
  const status = useEngineStatus();
  if (status !== "failed") return null;
  return (
    <span
      role="status"
      title="The boolean engine failed to load, so groups are cut with the compatibility engine. Exports of grouped shapes may not be watertight. Check the browser console for the reason."
      className="ml-1 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800"
    >
      <TriangleAlert size={12} />
      <span className="hidden sm:inline">Engine fallback</span>
    </span>
  );
}

export function Toolbar() {
  const mode = useScene((s) => s.transformMode);
  const setMode = useScene((s) => s.setTransformMode);
  const snap = useScene((s) => s.snap);
  const setSnap = useScene((s) => s.setSnap);
  const snapStep = useScene((s) => s.snapStep);
  const setSnapStep = useScene((s) => s.setSnapStep);
  const units = useScene((s) => s.units);
  const setUnits = useScene((s) => s.setUnits);
  const bed = useScene((s) => s.bed);
  const setBed = useScene((s) => s.setBed);
  const workplaneArmed = useScene((s) => s.workplaneArmed);
  const workplaneSet = useScene((s) => s.workplane !== null);
  const setWorkplaneArmed = useScene((s) => s.setWorkplaneArmed);
  const cruiseMode = useScene((s) => s.cruiseMode);
  const setCruiseMode = useScene((s) => s.setCruiseMode);
  const measureMode = useScene((s) => s.measureMode);
  const setMeasureMode = useScene((s) => s.setMeasureMode);
  const rulerOn = useScene((s) => s.rulerOrigin !== null || s.rulerPlacing);
  const toggleRuler = useScene((s) => s.toggleRuler);
  const dropSelectedToWorkplane = useScene((s) => s.dropSelectedToWorkplane);
  const selection = useScene((s) => s.selection);
  const nodes = useScene((s) => s.project.nodes);
  const projectId = useScene((s) => s.project.id);
  const projectName = useScene((s) => s.project.name);
  const deleteSelected = useScene((s) => s.deleteSelected);
  const duplicateSelected = useScene((s) => s.duplicateSelected);
  const groupSelected = useScene((s) => s.groupSelected);
  const ungroupSelected = useScene((s) => s.ungroupSelected);
  const alignMode = useScene((s) => s.alignMode);
  const setAlignMode = useScene((s) => s.setAlignMode);
  const filletMode = useScene((s) => s.filletMode);
  const setFilletMode = useScene((s) => s.setFilletMode);
  const mirrorSelected = useScene((s) => s.mirrorSelected);
  const toggleLockSelected = useScene((s) => s.toggleLockSelected);
  const hideSelected = useScene((s) => s.hideSelected);
  const showAll = useScene((s) => s.showAll);
  const setProjectName = useScene((s) => s.setProjectName);
  const loadProject = useScene((s) => s.loadProject);
  const newProject = useScene((s) => s.newProject);
  const addImportedMesh = useScene((s) => s.addImportedMesh);
  const anyHidden = useScene((s) => Object.values(s.project.nodes).some((n) => n.hidden));

  const fileInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<{ name: string; cancel: () => void } | null>(null);
  const [menu, setMenu] = useState<"mirror" | "export" | "grid" | "file" | null>(null);
  // A finger needs room a cursor does not, and the toolbar has none to spare.
  // On touch the settings and file groups fold into menus so what is left
  // fits one row — and the dropdowns, cramped down to fit inline, get to be a
  // comfortable size inside the menu.
  const touch = useCoarsePointer();

  const hasSelection = selection.length > 0;
  const canGroup = selection.length >= 2;
  const canUngroup = selection.some((id) => {
    const n = nodes[id];
    return n && isGroup(n);
  });
  const anyLocked = selection.some((id) => nodes[id]?.locked);

  const onExport = (format: "stl" | "obj", selectionOnly: boolean) => {
    setMenu(null);
    const state = useScene.getState();
    const { exported, skippedHoles } = exportSceneStl(state.project, {
      format,
      onlyIds: selectionOnly ? state.selection : undefined,
    });
    if (exported === 0) {
      alert(
        selectionOnly
          ? "Nothing to export — the selection has no solid geometry."
          : "Nothing to export — the scene has no solid geometry.",
      );
    } else if (skippedHoles > 0) {
      alert(
        `Exported ${exported} object(s). Skipped ${skippedHoles} loose hole(s) — a hole only cuts when grouped with a solid.`,
      );
    }
  };

  const onOpenFile = async (file: File) => {
    try {
      loadProject(parseProjectFile(await file.text()));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not read project file.");
    }
  };

  const onNewProject = () => {
    const s = useScene.getState();
    const kept = s.cloudProjectId
      ? "It stays in your library."
      : "It is not saved anywhere else — export it first if you want to keep it.";
    if (s.project.rootOrder.length === 0 || confirm(`Start a new project? ${kept}`)) {
      newProject();
    }
  };

  // Sized for the surface they land on: squeezed onto the bar with a cursor,
  // full width inside the menu on touch.
  const selectClass = touch
    ? "w-full rounded border border-neutral-300 px-2 py-2 text-sm text-neutral-700"
    : "rounded border border-neutral-300 px-0.5 py-0.5 text-xs text-neutral-600";

  const SETTINGS = [
    {
      label: "Snap grid",
      node: (
        <select
          value={snapStep}
          onChange={(e) => setSnapStep(Number(e.target.value))}
          title={`Snap grid size (${units})`}
          className={selectClass}
        >
          {SNAP_STEPS[units].map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      ),
    },
    {
      label: "Units",
      node: (
        <select
          value={units}
          onChange={(e) => setUnits(e.target.value as "mm" | "in")}
          title="Measurement units"
          className={selectClass}
        >
          <option value="mm">mm</option>
          <option value="in">in</option>
        </select>
      ),
    },
    {
      label: "Build plate",
      node: (
        <select
          value={bed ? `${bed[0]}x${bed[1]}` : ""}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return setBed(null);
            const [w, d] = v.split("x").map(Number);
            setBed([w, d]);
          }}
          title="Build plate — show your printer's footprint"
          className={selectClass}
        >
          <option value="">No plate</option>
          {BED_PRESETS.map((b) => (
            <option key={b.label} value={`${b.size[0]}x${b.size[1]}`}>
              {b.label}
            </option>
          ))}
        </select>
      ),
    },
  ];

  const FILE_ACTIONS = [
    { icon: FilePlus2, label: "New project", onClick: onNewProject },
    { icon: FileUp, label: "Import STL / OBJ / SVG", onClick: () => importInput.current?.click() },
    { icon: FolderOpen, label: "Open project file", onClick: () => fileInput.current?.click() },
    {
      icon: Save,
      label: "Save project as JSON",
      onClick: () => saveProjectFile(useScene.getState().project),
    },
  ];

  return (
    <header className="flex items-center gap-0.5 border-b border-neutral-200 bg-white px-3 py-1">
      <img
        src="/icon.svg"
        alt=""
        title={`${APP_NAME} build ${__BUILD_ID__}`}
        className="mr-1.5 h-5 w-5 rounded"
      />
      {!touch && (
        <span className="text-sm font-bold" title={`Build ${__BUILD_ID__}`}>
          {APP_NAME}
        </span>
      )}
      <EngineWarning />
      <input
        key={projectId}
        defaultValue={projectName}
        onBlur={(e) => setProjectName(e.target.value.trim() || "Untitled")}
        title="Project name"
        className="mx-2 w-28 rounded border border-transparent px-1.5 py-0.5 text-sm text-neutral-600 hover:border-neutral-300 focus:border-neutral-400 focus:outline-none"
      />

      {MODES.map(({ mode: m, label, key, icon }) => (
        <IconButton
          key={m}
          icon={icon}
          active={mode === m}
          onClick={() => setMode(m)}
          label={label}
          title={`${label} (${key})`}
          showLabel
        />
      ))}

      <Divider />

      <IconButton icon={Magnet} active={snap} onClick={() => setSnap(!snap)} label="Snap to grid" />
      {touch ? (
        <div className="relative">
          <IconButton
            icon={Settings2}
            active={menu === "grid"}
            onClick={() => setMenu(menu === "grid" ? null : "grid")}
            label="Grid, units and build plate"
          />
          {menu === "grid" && (
            <Popover onClose={() => setMenu(null)}>
              <div className="w-60 space-y-3">
                {SETTINGS.map(({ label, node }) => (
                  <label key={label} className="block">
                    <span className="mb-1 block text-xs font-medium text-neutral-500">
                      {label}
                    </span>
                    {node}
                  </label>
                ))}
              </div>
            </Popover>
          )}
        </div>
      ) : (
        SETTINGS.map(({ label, node }) => <Fragment key={label}>{node}</Fragment>)
      )}

      <IconButton
        icon={Layers}
        active={workplaneArmed || workplaneSet}
        onClick={() => setWorkplaneArmed(!workplaneArmed)}
        label="Workplane (W) — click a face to build on it; empty space resets"
      />
      <IconButton
        icon={Hand}
        active={cruiseMode}
        onClick={() => setCruiseMode(!cruiseMode)}
        label="Cruise (C) — drag a shape along other surfaces to place it"
      />
      <IconButton
        icon={Ruler}
        active={measureMode}
        onClick={() => setMeasureMode(!measureMode)}
        label="Measure (M) — click two points; corners and midpoints snap"
      />
      <IconButton
        icon={Frame}
        active={rulerOn}
        onClick={toggleRuler}
        label="Ruler — drop a datum; the selection shows live sizes and offsets"
      />

      <Divider />

      <IconButton icon={Undo2} onClick={undo} label="Undo (⌘Z)" />
      <IconButton icon={Redo2} onClick={redo} label="Redo (⇧⌘Z)" />

      <Divider />

      <IconButton icon={GroupIcon} onClick={groupSelected} disabled={!canGroup} label="Group (⌘G)" />
      <IconButton
        icon={UngroupIcon}
        onClick={ungroupSelected}
        disabled={!canUngroup}
        label="Ungroup (⇧⌘G)"
      />

      <IconButton
        icon={AlignStartVertical}
        onClick={() => setAlignMode(!alignMode)}
        disabled={selection.length < 2 && !alignMode}
        active={alignMode}
        label="Align (L) — click a shape to align to it, then a colored dot"
      />
      <IconButton
        icon={Radius}
        onClick={() => setFilletMode(!filletMode)}
        active={filletMode}
        label="Round edges (E) — click any edge to round it"
      />

      <div className="relative">
        <IconButton
          icon={FlipHorizontal2}
          onClick={() => setMenu(menu === "mirror" ? null : "mirror")}
          disabled={!hasSelection}
          active={menu === "mirror"}
          label="Mirror / flip selection"
        />
        {menu === "mirror" && (
          <Popover onClose={() => setMenu(null)}>
            <div className="flex gap-1">
              {AXES.map((axis, i) => (
                <button
                  key={axis}
                  onClick={() => mirrorSelected(i as 0 | 1 | 2)}
                  className="w-10 rounded border border-neutral-300 px-1 py-1 text-xs font-bold hover:bg-neutral-100"
                  style={{ color: AXIS_COLORS[i] }}
                >
                  {axis}
                </button>
              ))}
            </div>
          </Popover>
        )}
      </div>

      <Divider />

      <IconButton
        icon={Copy}
        onClick={duplicateSelected}
        disabled={!hasSelection}
        label="Duplicate (⌘D) — repeat after moving a copy to make a pattern"
      />
      <IconButton
        icon={ArrowDownToLine}
        onClick={dropSelectedToWorkplane}
        disabled={!hasSelection}
        label="Drop to workplane (D) — seat the selection on the plane"
      />
      <IconButton icon={Trash2} onClick={deleteSelected} disabled={!hasSelection} label="Delete (⌫)" />
      <IconButton
        icon={anyLocked ? LockOpen : Lock}
        onClick={toggleLockSelected}
        disabled={!hasSelection}
        label={anyLocked ? "Unlock selection" : "Lock selection"}
      />
      <IconButton icon={EyeOff} onClick={hideSelected} disabled={!hasSelection} label="Hide selection" />
      <IconButton icon={Eye} onClick={showAll} disabled={!anyHidden} label="Show all hidden objects" />

      {/* Pushes the file actions to the right edge. On touch the toolbar wraps,
          where a greedy spacer would swallow a whole row — see index.css. */}
      <div className="toolbar-gap flex-1" />

      {touch ? (
        <div className="relative">
          <IconButton
            icon={FolderOpen}
            active={menu === "file"}
            onClick={() => setMenu(menu === "file" ? null : "file")}
            label="Project files"
          />
          {menu === "file" && (
            <Popover onClose={() => setMenu(null)}>
              <div className="w-56 space-y-1">
                {FILE_ACTIONS.map(({ icon: Icon, label, onClick }) => (
                  <button
                    key={label}
                    onClick={() => {
                      setMenu(null);
                      onClick();
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
                  >
                    <Icon size={17} strokeWidth={1.8} />
                    {label}
                  </button>
                ))}
              </div>
            </Popover>
          )}
        </div>
      ) : (
        FILE_ACTIONS.map(({ icon, label, onClick }) => (
          <IconButton key={label} icon={icon} onClick={onClick} label={label} />
        ))
      )}
      <CloudPanel />
      <span className="mx-0.5" />
      <div className="relative">
        <button
          onClick={() => setMenu(menu === "export" ? null : "export")}
          title="Export for printing"
          aria-label="Export"
          className="rounded-md bg-blue-600 p-1.5 text-white hover:bg-blue-700"
        >
          <Printer size={17} strokeWidth={1.8} />
        </button>
        {menu === "export" && (
          <Popover onClose={() => setMenu(null)}>
            <div className="w-44 space-y-1">
              <button
                onClick={() => onExport("stl", false)}
                className="w-full rounded border border-neutral-300 px-2 py-1 text-left text-xs hover:bg-neutral-100"
              >
                STL — everything
              </button>
              <button
                onClick={() => onExport("stl", true)}
                disabled={!hasSelection}
                className="w-full rounded border border-neutral-300 px-2 py-1 text-left text-xs hover:bg-neutral-100 disabled:opacity-40"
              >
                STL — selection only
              </button>
              <button
                onClick={() => onExport("obj", false)}
                className="w-full rounded border border-neutral-300 px-2 py-1 text-left text-xs hover:bg-neutral-100"
              >
                OBJ — everything
              </button>
              <button
                onClick={() => onExport("obj", true)}
                disabled={!hasSelection}
                className="w-full rounded border border-neutral-300 px-2 py-1 text-left text-xs hover:bg-neutral-100 disabled:opacity-40"
              >
                OBJ — selection only
              </button>
            </div>
          </Popover>
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onOpenFile(file);
          e.target.value = "";
        }}
      />
      {importing && (
        <div className="fixed left-1/2 top-14 z-30 flex -translate-x-1/2 items-center gap-3 rounded bg-neutral-800/95 px-3 py-1.5 text-xs text-white shadow-lg">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
          Importing {importing.name}…
          <button
            onClick={() => {
              importing.cancel();
              setImporting(null);
            }}
            className="rounded bg-white/20 px-2 py-0.5 hover:bg-white/30"
          >
            Cancel
          </button>
        </div>
      )}
      <input
        ref={importInput}
        type="file"
        accept=".stl,.obj,.svg"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            // The importer runs in a worker: parsing and decimating a big
            // scan no longer freezes the page, and it can be cancelled.
            const { importMesh } = await import("../lib/importClient");
            const handle = importMesh(file, (tris) =>
              confirm(
                `This mesh has ${tris.toLocaleString()} triangles.\n\n` +
                  `OK — simplify to ~250,000 for smooth editing (the exact surface ` +
                  `deviation is measured and reported).\n` +
                  `Cancel — keep the full resolution (booleans and saves will be slower).`,
              ),
            );
            setImporting({ name: file.name, cancel: handle.cancel });
            let imported;
            try {
              imported = await handle.result;
            } finally {
              setImporting(null);
            }
            const { params, name, triangles, simplifiedFrom, deviationMm } = imported;
            addImportedMesh(params, name);
            if (simplifiedFrom) {
              const dev =
                deviationMm !== undefined && deviationMm < 0.005
                  ? "under 0.005"
                  : (deviationMm ?? 0).toFixed(3);
              alert(
                `Imported. Simplified from ${simplifiedFrom.toLocaleString()} to ` +
                  `${triangles.toLocaleString()} triangles — measured surface deviation ` +
                  `${dev} mm.`,
              );
            }
          } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") return; // cancelled
            alert(err instanceof Error ? err.message : "Could not import the file.");
          }
        }}
      />
    </header>
  );
}
