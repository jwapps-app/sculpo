import { create } from "zustand";
import { api, ApiError, getServerUrl, lastUsername } from "../lib/api";
import { sceneApi } from "../lib/sceneApi";
import {
  deleteDoc,
  listPending,
  localSaveState,
  readDoc,
  takeLegacyDoc,
  writeDoc,
  type LocalSaveState,
  type StoredDoc,
} from "../lib/localStore";
import { validateProject } from "../lib/projectFile";
import { useScene } from "./store";
import { setSignOutHooks, useAuth } from "./auth";
import type { Project } from "../types/scene";

// Keeps designs safe, in two places.
//
// Locally: the design on screen is written to IndexedDB shortly after every
// change, filed under the account it belongs to. A design with edits the
// server has not acknowledged is also kept as a pending record until it has
// — so switching designs mid-save, closing the tab offline, or a crash
// loses nothing.
//
// In the cloud, while signed in: every change is pushed shortly after the
// user pauses. Saves are filed under the design's own token, not the scene,
// so a save that completes after the user has opened something else is
// credited to the design it was for. Each save names the revision it was
// built on; if another device has saved since, the server refuses and the
// local version is kept as a copy rather than overwriting theirs.

export type SyncStatus = "idle" | "saving" | "saved" | "error";

interface CloudSyncState {
  status: SyncStatus;
  detail: string | null;
  /** Whether the browser's own copy is being kept. */
  local: LocalSaveState;
}

export const useCloudSync = create<CloudSyncState>()(() => ({
  status: "idle",
  detail: null,
  local: localSaveState(),
}));

/** A design the engine knows about, on screen or not. */
interface Doc {
  token: string;
  account: string;
  project: Project;
  cloudId: string | null;
  revision: number | null;
  /** The project the server last acknowledged, by identity. */
  acknowledged: Project | null;
}

const docs = new Map<string, Doc>();

// One key per server and account, so a browser shared between people never
// shows one person's work to the next. Work done while signed out is
// "anonymous" and is adopted by whoever signs in next on this browser.
export function accountKey(username: string | null): string {
  const server = getServerUrl() || (typeof location !== "undefined" ? location.origin : "");
  return `${server}|${username ?? "anonymous"}`;
}

function currentAccount(): string {
  const auth = useAuth.getState();
  // Disconnected: the session belongs to the user last signed in here, and
  // it is their copy that is shown and kept.
  const name = auth.user?.username ?? (auth.status === "disconnected" ? lastUsername() : null);
  return accountKey(name);
}

function isDirty(doc: Doc): boolean {
  return doc.project !== doc.acknowledged;
}

function activeDoc(): Doc | undefined {
  return docs.get(useScene.getState().docToken);
}

// ---- Local copy --------------------------------------------------------------

let localTimer: ReturnType<typeof setTimeout> | null = null;
let localWrite: Promise<void> = Promise.resolve();

// How long after the last change each copy is written. The browser copy is
// cheap and goes first; the cloud waits for the user to pause. Tests shrink
// these so a scenario takes milliseconds instead of seconds.
export const SYNC_DELAYS = { local: 800, cloud: 1500 };

function stored(doc: Doc): StoredDoc {
  return {
    token: doc.token,
    account: doc.account,
    project: doc.project,
    cloudId: doc.cloudId,
    revision: doc.revision,
    synced: !isDirty(doc),
    savedAt: Date.now(),
  };
}

async function persist(doc: Doc, active: boolean): Promise<void> {
  const ok = active
    ? await writeDoc(`current:${doc.account}`, stored(doc))
    : isDirty(doc)
      ? await writeDoc(`pending:${doc.token}`, stored(doc))
      : (await deleteDoc(`pending:${doc.token}`), true);
  useCloudSync.setState({ local: ok ? "ok" : localSaveState() });
}

function scheduleLocal(delayMs = SYNC_DELAYS.local) {
  if (localTimer) clearTimeout(localTimer);
  localTimer = setTimeout(() => void flushLocal(), delayMs);
}

/** Writes the design on screen to the browser now. Awaitable. */
export function flushLocal(): Promise<void> {
  if (localTimer) {
    clearTimeout(localTimer);
    localTimer = null;
  }
  const doc = activeDoc();
  if (!doc) return localWrite;
  localWrite = localWrite.then(() => persist(doc, true));
  return localWrite;
}

// ---- Cloud saves -------------------------------------------------------------

const queue: string[] = [];
let running = false;
let cloudTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 5_000;
// A notice worth keeping on screen through the routine saves that follow
// it — "your version was saved as a copy" must outlive the rename it causes.
let notice: { text: string; at: number } | null = null;
const NOTICE_MS = 60_000;

function enqueue(token: string) {
  if (!queue.includes(token)) queue.push(token);
  void drain();
}

function scheduleCloud(token: string) {
  if (cloudTimer) clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => enqueue(token), SYNC_DELAYS.cloud);
}

async function drain(): Promise<void> {
  if (running) return;
  if (useAuth.getState().status !== "signed-in") return;
  running = true;
  try {
    while (queue.length) {
      const token = queue.shift()!;
      const doc = docs.get(token);
      if (doc && doc.account === currentAccount()) await save(doc);
    }
  } finally {
    running = false;
  }
}

async function save(doc: Doc): Promise<void> {
  const snapshot = doc.project;
  if (snapshot === doc.acknowledged) return;
  // Don't create cloud rows for untouched empty scenes.
  if (!doc.cloudId && snapshot.rootOrder.length === 0) {
    doc.acknowledged = snapshot;
    return;
  }
  useCloudSync.setState({ status: "saving", detail: null });
  try {
    let detail: string | null = null;
    if (doc.cloudId) {
      try {
        const meta = await api.updateProject(
          doc.cloudId,
          snapshot.name,
          snapshot,
          doc.revision ?? undefined,
        );
        doc.revision = meta.revision;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          // Another device saved a newer version. Theirs stays; this
          // version becomes its own project, so neither is lost.
          const name = snapshot.name.endsWith(" (copy)") ? snapshot.name : `${snapshot.name} (copy)`;
          const meta = await api.createProject(name, { ...snapshot, name });
          doc.cloudId = meta.id;
          doc.revision = meta.revision;
          renameDoc(doc, name);
          detail = `“${snapshot.name}” was changed on another device, so your version was saved as “${name}”.`;
        } else if (err instanceof ApiError && err.status === 404) {
          // The row is gone — deleted from another device, or the server
          // was rebuilt. Retrying a dead id would fail forever, so adopt a
          // new one.
          const meta = await api.createProject(snapshot.name, snapshot);
          doc.cloudId = meta.id;
          doc.revision = meta.revision;
        } else {
          throw err;
        }
      }
    } else {
      const meta = await api.createProject(snapshot.name, snapshot);
      doc.cloudId = meta.id;
      doc.revision = meta.revision;
    }
    // The server now holds `snapshot`. Edits made while it was in flight
    // leave the doc dirty, and go up next.
    doc.acknowledged = snapshot;
    const active = useScene.getState().docToken === doc.token;
    if (active) useScene.getState().setCloudRef(doc.cloudId, doc.revision);
    if (doc.project !== snapshot) enqueue(doc.token);
    await persist(doc, active);
    retryDelay = 5_000;
    if (detail) notice = { text: detail, at: Date.now() };
    const shown = notice && Date.now() - notice.at < NOTICE_MS ? notice.text : null;
    useCloudSync.setState({ status: "saved", detail: shown });
    if (doc.cloudId && doc.revision !== null) tellOtherTabs(doc.cloudId, doc.revision);
    if (active && doc.cloudId) void refreshThumbnail(doc.cloudId, doc.token);
  } catch (err) {
    useCloudSync.setState({
      status: "error",
      detail: err instanceof Error ? err.message : "Sync failed.",
    });
    // Keep the edits and try again later; the local copy has them meanwhile.
    if (retryTimer) clearTimeout(retryTimer);
    const token = doc.token;
    retryTimer = setTimeout(() => enqueue(token), retryDelay);
    retryDelay = Math.min(retryDelay * 2, 60_000);
  }
}

function renameDoc(doc: Doc, name: string) {
  const state = useScene.getState();
  if (state.docToken === doc.token) {
    state.setProjectName(name);
    doc.project = useScene.getState().project;
  } else {
    doc.project = { ...doc.project, name };
  }
}

// ---- Other tabs ---------------------------------------------------------------

// Two tabs of the same browser can have the same design open. The server's
// revisions stop them overwriting each other, but a tab that keeps editing
// a stale copy ends up with a "(copy)" project. So a tab that saves tells
// the others; a tab that has the design open and clean follows to the new
// revision, and one with unsent edits says so, so the copy is no surprise.
interface TabNotice {
  cloudId: string;
  revision: number;
  sender: string;
}
const tabId = Math.random().toString(36).slice(2);
let channel: BroadcastChannel | null = null;

function tabs(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === "undefined") return null;
  channel = new BroadcastChannel("sculpo-sync");
  channel.onmessage = (e: MessageEvent<TabNotice>) => {
    const n = e.data;
    if (!n || n.sender === tabId) return;
    const state = useScene.getState();
    if (state.cloudProjectId !== n.cloudId) return;
    if ((state.cloudRevision ?? 0) >= n.revision) return;
    const doc = docs.get(state.docToken);
    if (doc && isDirty(doc)) {
      notice = {
        text: "This design was just saved from another tab. Your unsent edits here will be kept as a copy.",
        at: Date.now(),
      };
      useCloudSync.setState({ detail: notice.text });
      return;
    }
    void reconcile(n.cloudId, state.cloudRevision, state.docToken);
  };
  return channel;
}

function tellOtherTabs(cloudId: string, revision: number) {
  tabs()?.postMessage({ cloudId, revision, sender: tabId } satisfies TabNotice);
}

// ---- Thumbnails ---------------------------------------------------------------

// A preview costs a render, an encode and an upload, so it does not ride
// every save — those fire ~1.5s after each edit. Once a minute per project
// keeps the library current without following every nudge.
const THUMBNAIL_EVERY_MS = 60_000;
const lastThumbnail = new Map<string, number>();

async function refreshThumbnail(projectId: string, token: string) {
  const last = lastThumbnail.get(projectId) ?? 0;
  if (Date.now() - last < THUMBNAIL_EVERY_MS) return;
  // The picture must be of this design: not of whatever the user has opened
  // since the save was queued.
  if (useScene.getState().docToken !== token) return;
  const image = sceneApi.captureThumbnail();
  if (!image) return; // no renderer (no WebGL, or nothing drawn yet)
  lastThumbnail.set(projectId, Date.now());
  try {
    await api.putThumbnail(projectId, image);
  } catch {
    // A missing preview is cosmetic — never let it fail the save.
    lastThumbnail.delete(projectId);
  }
}

/** Take a preview for a project that has none. Called when one is opened. */
export function captureIfMissing(projectId: string) {
  if (lastThumbnail.has(projectId)) return;
  const token = useScene.getState().docToken;
  // Two frames: one for the scene to mount, one for it to have drawn.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      void refreshThumbnail(projectId, token);
    }),
  );
}

// ---- Documents coming and going -----------------------------------------------

/**
 * Tells the engine about the design that was just loaded into the scene.
 * `synced` says the server holds exactly this project; a design opened from
 * the cloud is, one opened from a file or restored with unsent edits is not.
 */
export function declareDoc(opts: { account?: string; synced: boolean }) {
  const s = useScene.getState();
  const doc: Doc = {
    token: s.docToken,
    account: opts.account ?? currentAccount(),
    project: s.project,
    cloudId: s.cloudProjectId,
    revision: s.cloudRevision,
    acknowledged: opts.synced ? s.project : null,
  };
  docs.set(doc.token, doc);
  scheduleLocal(0);
  if (isDirty(doc)) scheduleCloud(doc.token);
}

/** Saves now, whatever is pending for the design on screen. Awaitable. */
export async function syncNow(): Promise<void> {
  if (cloudTimer) {
    clearTimeout(cloudTimer);
    cloudTimer = null;
  }
  const doc = activeDoc();
  if (doc) enqueue(doc.token);
  await drain();
}

/**
 * Before signing out: get the account's work to safety. Pending cloud saves
 * are given a few seconds; the browser copy is written regardless. Then the
 * scene is cleared so the next person to sign in on this browser starts
 * from nothing rather than from this account's design.
 */
export async function prepareSignOut(): Promise<void> {
  await Promise.race([syncNow(), new Promise((r) => setTimeout(r, 5_000))]);
  await flushLocal();
}

function afterSignOut() {
  const state = useScene.getState();
  state.clearClipboard();
  state.newProject();
  declareDoc({ account: accountKey(null), synced: true });
}

/**
 * Restores the design last on screen for the current account, then goes
 * looking for anything else that still needs saving.
 */
async function restore(): Promise<void> {
  const account = currentAccount();
  const anonymous = accountKey(null);

  // Designs saved by versions that used localStorage belong to nobody in
  // particular; treat them as anonymous work.
  const legacy = takeLegacyDoc();
  if (legacy) {
    try {
      const project = validateProject(legacy.project);
      if (project.rootOrder.length) {
        await writeDoc(`current:${anonymous}`, {
          token: `legacy-${Date.now()}`,
          account: anonymous,
          project,
          cloudId: legacy.cloudId,
          revision: null,
          synced: false,
          savedAt: Date.now(),
        });
      }
    } catch {
      /* unreadable; nothing to carry over */
    }
  }

  let own = await readDoc(`current:${account}`);
  const stray = account === anonymous ? null : await readDoc(`current:${anonymous}`);

  // Work done on this browser while signed out is adopted by whoever signs
  // in next: it is nobody else's. If it is the only design there is, it goes
  // on screen; otherwise it is saved to the account as its own project.
  if (stray && stray.project.rootOrder.length) {
    if (!own || !own.project.rootOrder.length) {
      own = { ...stray, account, cloudId: null, revision: null, synced: false };
    } else {
      const doc: Doc = {
        token: stray.token,
        account,
        project: stray.project,
        cloudId: null,
        revision: null,
        acknowledged: null,
      };
      docs.set(doc.token, doc);
      await persist(doc, false);
      enqueue(doc.token);
    }
    await deleteDoc(`current:${anonymous}`);
  }

  if (own && own.project.rootOrder.length) {
    let project: Project;
    try {
      project = validateProject(own.project);
    } catch {
      project = own.project;
    }
    useScene.getState().loadProject(project, own.cloudId, own.revision);
    declareDoc({ account, synced: own.synced });
    if (own.synced && own.cloudId) void reconcile(own.cloudId, own.revision, useScene.getState().docToken);
  } else {
    declareDoc({ account, synced: true });
  }

  // Designs with unsent edits, from earlier sessions of this account.
  await restorePendingFor(account);
  restoreDone?.();
}

/**
 * The restored design was in sync when last seen here. If another device
 * has saved it since, theirs is newer: show that instead of the stale copy,
 * which would otherwise overwrite theirs on the next edit.
 */
async function reconcile(cloudId: string, revision: number | null, token: string) {
  try {
    const listed = (await api.listProjects()).find((p) => p.id === cloudId);
    if (!listed || listed.revision <= (revision ?? 0)) return;
    if (useScene.getState().docToken !== token) return; // the user moved on
    const doc = docs.get(token);
    if (doc && isDirty(doc)) return; // edited meanwhile; the save will sort it out
    const full = await api.getProject(cloudId);
    if (useScene.getState().docToken !== token) return;
    useScene.getState().loadProject(validateProject(full.data), full.id, full.revision);
    declareDoc({ synced: true });
  } catch {
    /* offline; the local copy stands */
  }
}

// Restoring is done once per page, whoever asks; the subscriptions below
// are per call, since React mounts effects twice in development and the
// second call must work after the first was cleaned up.
let restoreStarted = false;
let restoreDone: (() => void) | null = null;
/** Resolves once the design for this page's account has been restored. */
export const restored: Promise<void> = new Promise((r) => {
  restoreDone = r;
});

/** Call at app startup; returns the matching stop. */
export function startCloudSync(): () => void {
  setSignOutHooks(prepareSignOut, afterSignOut);
  tabs(); // listen for other tabs from the start, not only after a save

  const unsubScene = useScene.subscribe((state, prev) => {
    if (state.docToken !== prev.docToken) {
      // The scene moved to another design. The previous one's unsent edits
      // are filed as pending and saved from there.
      const previous = docs.get(prev.docToken);
      if (previous) {
        previous.project = prev.project;
        if (isDirty(previous)) {
          void persist(previous, false);
          enqueue(previous.token);
        } else {
          void deleteDoc(`pending:${previous.token}`);
        }
      }
      // A new design not yet declared (a file open, "new project") is dirty
      // if it has content, and is saved as its own project.
      if (!docs.has(state.docToken)) {
        declareDoc({ synced: state.project.rootOrder.length === 0 && !state.cloudProjectId });
      }
      return;
    }
    const doc = docs.get(state.docToken);
    if (!doc) return;
    if (state.project !== prev.project) {
      doc.project = state.project;
      scheduleLocal();
      scheduleCloud(doc.token);
    }
    if (state.cloudProjectId !== prev.cloudProjectId && state.cloudProjectId === null) {
      // Deleted from the library while open: it is a fresh design now.
      doc.cloudId = null;
      doc.revision = null;
      doc.acknowledged = null;
      scheduleLocal();
    }
  });

  const unsubAuth = useAuth.subscribe((state, prev) => {
    if (state.status === "checking") return;
    if (!restoreStarted) {
      restoreStarted = true;
      void restore();
      return;
    }
    if (state.status === "signed-in" && prev.status !== "signed-in") {
      // Signed in: the design on screen (anonymous work, or this account's
      // own after a session expired) belongs to this account now.
      const doc = activeDoc();
      if (doc && doc.account === accountKey(null)) {
        doc.account = currentAccount();
        doc.acknowledged = null;
      }
      void restorePendingFor(currentAccount());
      if (doc && isDirty(doc)) enqueue(doc.token);
    }
    if (state.status !== "signed-in") {
      useCloudSync.setState({ status: "idle", detail: null });
    }
  });
  // Auth may already have settled by the time this runs.
  if (useAuth.getState().status !== "checking" && !restoreStarted) {
    restoreStarted = true;
    void restore();
  }

  const onHide = () => void flushLocal();
  const onVisibility = () => {
    if (document.visibilityState === "hidden") void flushLocal();
  };
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    unsubScene();
    unsubAuth();
    channel?.close();
    channel = null;
    window.removeEventListener("pagehide", onHide);
    document.removeEventListener("visibilitychange", onVisibility);
    if (cloudTimer) clearTimeout(cloudTimer);
    if (localTimer) clearTimeout(localTimer);
    if (retryTimer) clearTimeout(retryTimer);
  };
}

async function restorePendingFor(account: string) {
  for (const pending of await listPending()) {
    if (pending.account !== account || docs.has(pending.token)) continue;
    docs.set(pending.token, {
      token: pending.token,
      account,
      project: pending.project,
      cloudId: pending.cloudId,
      revision: pending.revision,
      acknowledged: null,
    });
    enqueue(pending.token);
  }
}

