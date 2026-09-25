import { Component, type ErrorInfo, type ReactNode } from "react";
import { APP_NAME } from "../constants/branding";
import { localSaveState } from "../lib/localStore";
import { saveProjectFile } from "../lib/projectFile";
import { useScene } from "../state/store";

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

async function clearCachesAndReload() {
  // A service worker holding a stale index.html is the classic cause of a
  // blank PWA: it serves markup pointing at asset filenames the server no
  // longer has. Tear the whole cache down rather than guess which entry.
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } finally {
    window.location.reload();
  }
}

function workOffline() {
  // The scene is kept in the browser, so switching the API off gets the
  // modeller back even when the sync side is what is broken. The session
  // belonged to that server; it goes too.
  localStorage.setItem("server-mode", "offline");
  localStorage.removeItem("server-url");
  localStorage.removeItem("session-token");
  window.location.reload();
}

function downloadProject() {
  try {
    saveProjectFile(useScene.getState().project);
  } catch {
    alert("Could not read the design from memory.");
  }
}

/**
 * Catches render-time crashes so a failure shows what went wrong instead of a
 * white screen. It cannot catch an error thrown before React mounts — for
 * that, the "clear cache" route below is the recovery.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info });
    // Keep it in the console too, where a bug report can be copied from.
    console.error("Sculpo crashed:", error, info.componentStack);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const details = [
      `${error.name}: ${error.message}`,
      error.stack ?? "",
      info?.componentStack ?? "",
    ]
      .filter(Boolean)
      .join("\n\n");

    return (
      <div className="flex h-screen items-center justify-center bg-neutral-100 p-6">
        <div className="w-full max-w-lg space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <div>
            <h1 className="text-lg font-bold">{APP_NAME} hit an error</h1>
            <p className="mt-1 text-sm text-neutral-600">
              {localSaveState() === "ok"
                ? "Your work is saved in this browser. Try one of these."
                : "This browser could not keep a copy of your work — download it before reloading."}
            </p>
          </div>

          <p className="rounded border border-red-200 bg-red-50 p-2 font-mono text-xs break-words text-red-800">
            {error.name}: {error.message}
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => window.location.reload()}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            >
              Reload
            </button>
            <button
              onClick={clearCachesAndReload}
              title="Discards the cached copy of the app and fetches it fresh"
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
            >
              Clear cache and reload
            </button>
            <button
              onClick={downloadProject}
              title="Saves the design as a project file you can open again"
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
            >
              Download project file
            </button>
            <button
              onClick={workOffline}
              title="Forgets the server address and runs the modeller on its own"
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
            >
              Work offline
            </button>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-neutral-500 hover:text-neutral-800">
              Technical details
            </summary>
            <pre className="mt-2 max-h-56 overflow-auto rounded bg-neutral-900 p-2 text-[11px] leading-snug text-neutral-100">
              {details}
            </pre>
            <button
              onClick={() => navigator.clipboard?.writeText(details)}
              className="mt-2 rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100"
            >
              Copy
            </button>
          </details>
        </div>
      </div>
    );
  }
}
