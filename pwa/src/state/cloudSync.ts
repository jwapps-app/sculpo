import { create } from "zustand";
import { api } from "../lib/api";
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
      await api.updateProject(s.cloudProjectId, project.name, project);
    } else {
      const meta = await api.createProject(project.name, project);
      useScene.getState().setCloudProjectId(meta.id);
    }
    lastSynced = project;
    useCloudSync.setState({ status: "saved", detail: null });
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
