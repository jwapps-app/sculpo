import { useEffect } from "react";
import { Toolbar } from "./components/Toolbar";
import { Palette } from "./components/Palette";
import { Viewport } from "./components/Viewport";
import { Inspector } from "./components/Inspector";
import { SketchDialog } from "./components/SketchDialog";
import { SignInGate } from "./components/SignInGate";
import { useShortcuts } from "./hooks/useShortcuts";
import { useAuth } from "./state/auth";
import { startCloudSync } from "./state/cloudSync";

export default function App() {
  useShortcuts();
  const status = useAuth((s) => s.status);

  useEffect(() => {
    useAuth.getState().init();
    return startCloudSync();
  }, []);

  // With a backend present, the workspace sits behind sign-in. Without one
  // ("offline"), the standalone tool is open as always.
  if (status === "checking") {
    return <div className="h-screen bg-neutral-100" />;
  }
  if (status === "signed-out" || status === "unreachable") {
    return <SignInGate />;
  }

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
