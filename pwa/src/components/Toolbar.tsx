import { APP_NAME } from "../constants/branding";
import { useScene, undo, redo } from "../state/store";
import type { TransformMode } from "../state/store";

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

export function Toolbar() {
  const mode = useScene((s) => s.transformMode);
  const setMode = useScene((s) => s.setTransformMode);
  const snap = useScene((s) => s.snap);
  const setSnap = useScene((s) => s.setSnap);
  const selection = useScene((s) => s.selection);
  const deleteSelected = useScene((s) => s.deleteSelected);
  const duplicateSelected = useScene((s) => s.duplicateSelected);

  const hasSelection = selection.length > 0;

  return (
    <div className="flex items-center gap-1 border-b border-neutral-200 bg-white px-3 py-1.5">
      <span className="mr-4 text-sm font-bold">{APP_NAME}</span>

      {MODES.map(({ mode: m, label, key }) => (
        <ToolButton key={m} active={mode === m} onClick={() => setMode(m)} title={`${label} (${key})`}>
          {label}
        </ToolButton>
      ))}

      <div className="mx-2 h-5 w-px bg-neutral-200" />

      <ToolButton active={snap} onClick={() => setSnap(!snap)} title="Snap to grid">
        Snap
      </ToolButton>

      <div className="mx-2 h-5 w-px bg-neutral-200" />

      <ToolButton onClick={undo} title="Undo (⌘Z)">
        Undo
      </ToolButton>
      <ToolButton onClick={redo} title="Redo (⇧⌘Z)">
        Redo
      </ToolButton>

      <div className="mx-2 h-5 w-px bg-neutral-200" />

      <ToolButton onClick={duplicateSelected} disabled={!hasSelection} title="Duplicate (⌘D)">
        Duplicate
      </ToolButton>
      <ToolButton onClick={deleteSelected} disabled={!hasSelection} title="Delete (⌫)">
        Delete
      </ToolButton>
    </div>
  );
}
