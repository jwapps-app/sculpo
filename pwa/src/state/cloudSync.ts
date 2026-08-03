import { create } from "zustand";
import { api, ApiError } from "../lib/api";
import { sceneApi } from "../lib/sceneApi";
import { useScene } from "./store";
import { useAuth } from "./auth";
import type { Project } from "../types/scene";

// Automatic cloud sync: while signed in, every scene change is pushed to the
// server shortly after the user pauses. The first change to a fresh design
// creates its cloud row; everything after updates it.
export type SyncStatus = "idle" | "saving" | "saved" | "error";

interface CloudSyncState {
  status: SyncStatus;
  detail: string | null;
}

export const useCloudSync = create<CloudSyncState>()(() => ({
  status: "idle",
  detail: null,
}));

let lastSynced: Project | null = null;
// A preview costs a render, an encode and an upload, so it does not ride
// every autosave — those fire ~1.5s after each edit. Once a minute per
// project keeps the library current without following every nudge.
const THUMBNAIL_EVERY_MS = 60_000;
const lastThumbnail = new Map<string, number>();

async function refreshThumbnail(projectId: string) {
  const last = lastThumbnail.get(projectId) ?? 0;
  if (Date.now() - last < THUMBNAIL_EVERY_MS) return;
  const image = sceneApi.captureThumbnail();
  if (!image) return; // no renderer (no WebGL, or nothing drawn yet)
  // Claim the slot before awaiting, so a slow upload cannot queue others.
  lastThumbnail.set(projectId, Date.now());
  try {
    await api.putThumbnail(projectId, image);
  } catch {
    // A missing preview is cosmetic — never let it fail the save.
    lastThumbnail.delete(projectId);
  }
}
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let queued = false;

export function markSynced(project: Project) {
  lastSynced = project;
}

export async function syncNow(): Promise<void> {
  if (useAuth.getState().status !== "signed-in") return;
  const s = useScene.getState();
  const project = s.project;
  if (project === lastSynced) return;
  // Don't create cloud rows for untouched empty scenes.
  if (!s.cloudProjectId && project.rootOrder.length === 0) return;
  if (inFlight) {
    queued = true;
    return;
  }
  inFlight = true;
  useCloudSync.setState({ status: "saving", detail: null });
  try {
    if (s.cloudProjectId) {
      try {
        await api.updateProject(s.cloudProjectId, project.name, project);
      } catch (err) {
        // The row is gone — deleted from another device, or the server was
        // rebuilt. Retrying a dead id would fail forever and quietly stop
        // saving anyone's work, so adopt a new one instead.
        if (err instanceof ApiError && err.status === 404) {
          const meta = await api.createProject(project.name, project);
          useScene.getState().setCloudProjectId(meta.id);
        } else {
          throw err;
        }
      }
    } else {
      const meta = await api.createProject(project.name, project);
      useScene.getState().setCloudProjectId(meta.id);
    }
    lastSynced = project;
    useCloudSync.setState({ status: "saved", detail: null });
    const id = useScene.getState().cloudProjectId;
    if (id) void refreshThumbnail(id);
  } catch (err) {
    useCloudSync.setState({
      status: "error",
      detail: err instanceof Error ? err.message : "Sync failed.",
    });
  } finally {
    inFlight = false;
    if (queued) {
      queued = false;
      void syncNow();
    }
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), 1500);
}

// Call once at app startup.
export function startCloudSync(): () => void {
  const unsubScene = useScene.subscribe((state, prev) => {
    if (state.project !== prev.project) schedule();
  });
  const unsubAuth = useAuth.subscribe((state, prev) => {
    // Signing in pushes any pending local work up shortly after.
    if (state.status === "signed-in" && prev.status !== "signed-in") schedule();
    if (state.status !== "signed-in") {
      useCloudSync.setState({ status: "idle", detail: null });
    }
  });
  return () => {
    unsubScene();
    unsubAuth();
    if (timer) clearTimeout(timer);
  };
}
