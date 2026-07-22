import { Toolbar } from "./components/Toolbar";
import { Palette } from "./components/Palette";
import { Viewport } from "./components/Viewport";
import { Inspector } from "./components/Inspector";
import { SketchDialog } from "./components/SketchDialog";
import { useShortcuts } from "./hooks/useShortcuts";
import { useAutosave } from "./hooks/useAutosave";

export default function App() {
  useShortcuts();
  useAutosave();
  return (
    <div className="flex h-screen flex-col">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <Palette />
        <div className="min-w-0 flex-1">
          <Viewport />
        </div>
        <Inspector />
      </div>
      <SketchDialog />
    </div>
  );
}
