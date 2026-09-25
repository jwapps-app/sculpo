import type { Project } from "../types/scene";

// Where the browser keeps designs between visits: IndexedDB, which takes a
// 30 MB imported mesh in its stride. localStorage, the previous home, caps
// out around 5 MB and was silently skipping anything larger.
//
// Two kinds of record. `current:<account>` is the design on screen for an
// account, one per account so signing out and in as someone else never
// shows them another person's work. `pending:<token>` is a design with edits
// the server has not yet acknowledged, kept until it has — switching to
// another design mid-save, or closing the tab offline, must not lose them.

export interface StoredDoc {
  token: string;
  account: string;
  project: Project;
  cloudId: string | null;
  revision: number | null;
  /** True when the server holds exactly this `project`. */
  synced: boolean;
  savedAt: number;
}

export type LocalSaveState = "ok" | "failed" | "unsupported";

const DB_NAME = "sculpo";
const DB_VERSION = 2;
const STORE = "docs";
// A request that has not answered in this long is stuck — another tab
// holding an upgrade, a browser in a bad way. Report it as failed instead
// of leaving the caller waiting forever.
const OPEN_TIMEOUT_MS = 8_000;
const STATE_KEY = "local-save-state";
const LEGACY_KEY = "autosave-project";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      noteState("unsupported");
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      noteState("unsupported");
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      noteState("failed");
      resolve(null);
    }, OPEN_TIMEOUT_MS);
    req.onupgradeneeded = () => {
      // Also repairs a database something else created without the store.
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // Older than our version somehow, or made by another opener at the
        // same version: bump past it so an upgrade runs and adds the store.
        db.close();
        dbPromise = null;
        const bump = indexedDB.open(DB_NAME, db.version + 1);
        bump.onupgradeneeded = () => bump.result.createObjectStore(STORE);
        bump.onsuccess = () => resolve(bump.result);
        bump.onerror = () => {
          noteState("failed");
          resolve(null);
        };
        return;
      }
      // Another tab upgrading: let go so it can, and reopen next time.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      clearTimeout(timer);
      noteState("unsupported");
      resolve(null);
    };
  });
  return dbPromise;
}

// The last outcome, kept where the error screen can read it without going
// through IndexedDB again: it has to say truthfully whether work is safe.
function noteState(state: LocalSaveState) {
  try {
    localStorage.setItem(STATE_KEY, state);
  } catch {
    /* nothing to be done */
  }
}

export function localSaveState(): LocalSaveState {
  try {
    return (localStorage.getItem(STATE_KEY) as LocalSaveState | null) ?? "ok";
  } catch {
    return "unsupported";
  }
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        if (!db) {
          resolve(undefined);
          return;
        }
        let tx: IDBTransaction;
        try {
          tx = db.transaction(STORE, mode);
        } catch (err) {
          reject(err);
          return;
        }
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export async function readDoc(key: string): Promise<StoredDoc | null> {
  try {
    return ((await run("readonly", (s) => s.get(key))) as StoredDoc | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Writes a record. Resolves true when it is durably stored. */
export async function writeDoc(key: string, doc: StoredDoc): Promise<boolean> {
  try {
    await run("readwrite", (s) => s.put(doc, key));
    if ((await openDb()) === null) return false;
    noteState("ok");
    return true;
  } catch (err) {
    console.warn("Could not save locally", err);
    noteState("failed");
    return false;
  }
}

export async function deleteDoc(key: string): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(key));
  } catch {
    /* already gone, or nowhere to be */
  }
}

/** Every pending record, whatever its account. */
export async function listPending(): Promise<StoredDoc[]> {
  try {
    const keys = ((await run("readonly", (s) => s.getAllKeys())) as IDBValidKey[] | undefined) ?? [];
    const out: StoredDoc[] = [];
    for (const key of keys) {
      if (typeof key === "string" && key.startsWith("pending:")) {
        const doc = await readDoc(key);
        if (doc) out.push(doc);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * The record left by versions that saved to localStorage, as a StoredDoc for
 * the anonymous account, or null. Removed once read: it is either restored
 * and rewritten by the new store, or it was empty.
 */
export function takeLegacyDoc(): { project: unknown; cloudId: string | null } | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_KEY);
    if (raw) localStorage.removeItem(LEGACY_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { project?: unknown; cloudId?: unknown };
    if (parsed && typeof parsed === "object" && "project" in parsed) {
      return {
        project: parsed.project,
        cloudId: typeof parsed.cloudId === "string" ? parsed.cloudId : null,
      };
    }
    return { project: parsed, cloudId: null };
  } catch {
    return null;
  }
}
