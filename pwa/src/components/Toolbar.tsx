import { useRef } from "react";
import { APP_NAME } from "../constants/branding";
import { useScene, undo, redo } from "../state/store";
import type { TransformMode } from "../state/store";
import { isGroup } from "../types/scene";
import { exportSceneStl } from "../lib/exportStl";
import { saveProjectFile, parseProjectFile } from "../lib/projectFile";

const MODES: { mode: TransformMode; label: string; key: string }[] = [
  { mode: "translate", label: "Move", key: "G" },
  { mode: "rotate", label: "Rotate", key: "R" },
  { mode: "scale", label: "Scale", key: "S" },
];

function ToolButton({
  active,
  onClick,
  children,
  title,
  disabled,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`rounded-md px-2.5 py-1 text-sm ${
        active
          ? "bg-neutral-800 text-white"
          : "text-neutral-700 hover:bg-neutral-200 disabled:opacity-40"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-2 h-5 w-px bg-neutral-200" />;
}

export function Toolbar() {
  const mode = useScene((s) => s.transformMode);
  const setMode = useScene((s) => s.setTransformMode);
  const snap = useScene((s) => s.snap);
  const setSnap = useScene((s) => s.setSnap);
  const selection = useScene((s) => s.selection);
  const nodes = useScene((s) => s.project.nodes);
  const projectId = useScene((s) => s.project.id);
  const projectName = useScene((s) => s.project.name);
  const deleteSelected = useScene((s) => s.deleteSelected);
  const duplicateSelected = useScene((s) => s.duplicateSelected);
  const groupSelected = useScene((s) => s.groupSelected);
  const ungroupSelected = useScene((s) => s.ungroupSelected);
  const setProjectName = useScene((s) => s.setProjectName);
  const loadProject = useScene((s) => s.loadProject);

  const fileInput = useRef<HTMLInputElement>(null);

  const hasSelection = selection.length > 0;
  const canGroup = selection.length >= 2;
  const canUngroup = selection.some((id) => {
    const n = nodes[id];
    return n && isGroup(n);
  });

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
    <div className="flex items-center gap-1 border-b border-neutral-200 bg-white px-3 py-1.5">
      <span className="text-sm font-bold">{APP_NAME}</span>
      <input
        key={projectId}
        defaultValue={projectName}
        onBlur={(e) => setProjectName(e.target.value.trim() || "Untitled")}
        title="Project name"
        className="mx-2 w-32 rounded border border-transparent px-1.5 py-0.5 text-sm text-neutral-600 hover:border-neutral-300 focus:border-neutral-400 focus:outline-none"
      />

      {MODES.map(({ mode: m, label, key }) => (
        <ToolButton key={m} active={mode === m} onClick={() => setMode(m)} title={`${label} (${key})`}>
          {label}
        </ToolButton>
      ))}

      <Divider />

      <ToolButton active={snap} onClick={() => setSnap(!snap)} title="Snap to grid">
        Snap
      </ToolButton>

      <Divider />

      <ToolButton onClick={undo} title="Undo (⌘Z)">
        Undo
      </ToolButton>
      <ToolButton onClick={redo} title="Redo (⇧⌘Z)">
        Redo
      </ToolButton>

      <Divider />

      <ToolButton onClick={groupSelected} disabled={!canGroup} title="Group (⌘G)">
        Group
      </ToolButton>
      <ToolButton onClick={ungroupSelected} disabled={!canUngroup} title="Ungroup (⇧⌘G)">
        Ungroup
      </ToolButton>

      <Divider />

      <ToolButton onClick={duplicateSelected} disabled={!hasSelection} title="Duplicate (⌘D)">
        Duplicate
      </ToolButton>
      <ToolButton onClick={deleteSelected} disabled={!hasSelection} title="Delete (⌫)">
        Delete
      </ToolButton>

      <div className="flex-1" />

      <ToolButton onClick={() => fileInput.current?.click()} title="Open a saved project file">
        Open
      </ToolButton>
      <ToolButton
        onClick={() => saveProjectFile(useScene.getState().project)}
        title="Download the project as JSON"
      >
        Save
      </ToolButton>
      <button
        onClick={onExport}
        className="ml-1 rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
      >
        Export STL
      </button>

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
    </div>
  );
}
