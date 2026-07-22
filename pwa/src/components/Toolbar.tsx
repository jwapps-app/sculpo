import { useRef, useState } from "react";
import {
  AlignStartVertical,
  Copy,
  Eye,
  FilePlus2,
  FileUp,
  FlipHorizontal2,
  FolderOpen,
  Group as GroupIcon,
  Hand,
  Layers,
  Lock,
  LockOpen,
  Magnet,
  Move,
  Printer,
  RotateCw,
  Save,
  Scaling,
  Trash2,
  Undo2,
  Redo2,
  EyeOff,
  Ungroup as UngroupIcon,
} from "lucide-react";
import { APP_NAME } from "../constants/branding";
import { AXIS_COLORS } from "../constants/ui";
import { SNAP_STEPS } from "../lib/units";
import { useScene, undo, redo } from "../state/store";
import type { TransformMode } from "../state/store";
import { isGroup } from "../types/scene";
import { exportSceneStl } from "../lib/exportStl";
import { saveProjectFile, parseProjectFile } from "../lib/projectFile";
import { importMeshFile } from "../lib/importMesh";
import { CloudPanel } from "./CloudPanel";

const MODES: { mode: TransformMode; label: string; key: string; icon: typeof Move }[] = [
  { mode: "translate", label: "Move", key: "G", icon: Move },
  { mode: "rotate", label: "Rotate", key: "R", icon: RotateCw },
  { mode: "scale", label: "Scale", key: "S", icon: Scaling },
];

function IconButton({
  label,
  onClick,
  icon: Icon,
  active,
  disabled,
  accent,
}: {
  label: string;
  onClick: () => void;
  icon: typeof Move;
  active?: boolean;
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
      className={`rounded-md p-1.5 ${
        accent
          ? "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
          : active
            ? "bg-neutral-800 text-white"
            : "text-neutral-700 hover:bg-neutral-200 disabled:opacity-30"
      }`}
    >
      <Icon size={17} strokeWidth={1.8} />
    </button>
  );
}

function Divider() {
  return <div className="mx-1.5 h-5 w-px bg-neutral-200" />;
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

export function Toolbar() {
  const mode = useScene((s) => s.transformMode);
  const setMode = useScene((s) => s.setTransformMode);
  const snap = useScene((s) => s.snap);
  const setSnap = useScene((s) => s.setSnap);
  const snapStep = useScene((s) => s.snapStep);
  const setSnapStep = useScene((s) => s.setSnapStep);
  const units = useScene((s) => s.units);
  const setUnits = useScene((s) => s.setUnits);
  const workplaneArmed = useScene((s) => s.workplaneArmed);
  const workplaneSet = useScene((s) => s.workplane !== null);
  const setWorkplaneArmed = useScene((s) => s.setWorkplaneArmed);
  const cruiseMode = useScene((s) => s.cruiseMode);
  const setCruiseMode = useScene((s) => s.setCruiseMode);
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
  const [menu, setMenu] = useState<"mirror" | null>(null);

  const hasSelection = selection.length > 0;
  const canGroup = selection.length >= 2;
  const canUngroup = selection.some((id) => {
    const n = nodes[id];
    return n && isGroup(n);
  });
  const anyLocked = selection.some((id) => nodes[id]?.locked);

  const onExport = () => {
    const { exported, skippedHoles } = exportSceneStl(useScene.getState().project);
    if (exported === 0) {
      alert("Nothing to export — the scene has no solid geometry.");
    } else if (skippedHoles > 0) {
      alert(
        `Exported ${exported} object(s). Skipped ${skippedHoles} ungrouped hole(s) — a hole only cuts inside a group.`,
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

  return (
    <div className="flex items-center gap-0.5 border-b border-neutral-200 bg-white px-3 py-1">
      <span className="text-sm font-bold">{APP_NAME}</span>
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
          label={`${label} (${key})`}
        />
      ))}

      <Divider />

      <IconButton icon={Magnet} active={snap} onClick={() => setSnap(!snap)} label="Snap to grid" />
      <select
        value={snapStep}
        onChange={(e) => setSnapStep(Number(e.target.value))}
        title={`Snap grid size (${units})`}
        className="rounded border border-neutral-300 px-0.5 py-0.5 text-xs text-neutral-600"
      >
        {SNAP_STEPS[units].map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select
        value={units}
        onChange={(e) => setUnits(e.target.value as "mm" | "in")}
        title="Measurement units"
        className="rounded border border-neutral-300 px-0.5 py-0.5 text-xs text-neutral-600"
      >
        <option value="mm">mm</option>
        <option value="in">in</option>
      </select>

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
        label="Align (L) — click the colored dots on the selection"
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
      <IconButton icon={Trash2} onClick={deleteSelected} disabled={!hasSelection} label="Delete (⌫)" />
      <IconButton
        icon={anyLocked ? LockOpen : Lock}
        onClick={toggleLockSelected}
        disabled={!hasSelection}
        label={anyLocked ? "Unlock selection" : "Lock selection"}
      />
      <IconButton icon={EyeOff} onClick={hideSelected} disabled={!hasSelection} label="Hide selection" />
      <IconButton icon={Eye} onClick={showAll} disabled={!anyHidden} label="Show all hidden objects" />

      <div className="flex-1" />

      <IconButton
        icon={FilePlus2}
        onClick={() => {
          if (
            useScene.getState().project.rootOrder.length === 0 ||
            confirm("Start a new project? Unsaved changes will be lost.")
          ) {
            newProject();
          }
        }}
        label="New project"
      />
      <IconButton
        icon={FileUp}
        onClick={() => importInput.current?.click()}
        label="Import STL / OBJ / SVG"
      />
      <IconButton
        icon={FolderOpen}
        onClick={() => fileInput.current?.click()}
        label="Open project file"
      />
      <IconButton
        icon={Save}
        onClick={() => saveProjectFile(useScene.getState().project)}
        label="Save project as JSON"
      />
      <CloudPanel />
      <span className="mx-0.5" />
      <IconButton icon={Printer} onClick={onExport} accent label="Export STL for printing" />

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
            const { params, name } = await importMeshFile(file);
            addImportedMesh(params, name);
          } catch (err) {
            alert(err instanceof Error ? err.message : "Could not import the file.");
          }
        }}
      />
    </div>
  );
}
