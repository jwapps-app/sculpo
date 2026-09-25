import { create } from "zustand";
import {
  api,
  getServerUrl,
  getToken,
  setServerUrl,
  setToken,
  setUnauthorizedHandler,
  type UserInfo,
} from "../lib/api";

// Shared auth state. When a backend is reachable the workspace is gated
// behind sign-in; with no backend ("offline") the standalone tool is open.
type Status = "checking" | "offline" | "signed-out" | "signed-in";

interface AuthState {
  status: Status;
  user: UserInfo | null;
  init: () => Promise<void>;
  authenticate: (
    mode: "login" | "register",
    username: string,
    password: string,
    secrets?: { adminSecret?: string; inviteCode?: string },
  ) => Promise<void>;
  signOut: () => Promise<void>;
}

// Sign-out is a two-step affair for the sync engine: get the account's work
// to safety first, then clear the scene so the next sign-in on this browser
// starts from nothing. Registered from there to keep this module free of a
// circular import.
let beforeSignOut: (() => Promise<void>) | null = null;
let afterSignOutHook: (() => void) | null = null;
export function setSignOutHooks(before: () => Promise<void>, after: () => void) {
  beforeSignOut = before;
  afterSignOutHook = after;
}

export const useAuth = create<AuthState>()((set) => ({
  status: "checking",
  user: null,

  init: async () => {
    setUnauthorizedHandler(() => set({ status: "signed-out", user: null }));
    if (!(await api.available())) {
      // A saved server URL that no longer answers must not strand a browser
      // that is itself being served by a Sculpo server. The usual way in:
      // the public hostname saved while on the LAN address, which the
      // browser's cross-origin rules then refuse — same server, same
      // database, but every request bounced. Prefer the origin we came from.
      if (getServerUrl() && (await api.available("/api/v1"))) {
        console.info(`Server ${getServerUrl()} unreachable from here; using this origin's own API.`);
        setServerUrl(null);
      } else {
        set({ status: "offline" });
        return;
      }
    }
    if (getToken()) {
      try {
        set({ status: "signed-in", user: await api.me() });
        return;
      } catch {
        /* expired */
      }
    }
    set({ status: "signed-out" });
  },

  authenticate: async (mode, username, password, secrets) => {
    const session =
      mode === "login"
        ? await api.login(username, password)
        : await api.register(username, password, secrets ?? {});
    setToken(session.session_token);
    set({ status: "signed-in", user: session.user });
  },

  signOut: async () => {
    await beforeSignOut?.();
    try {
      await api.logout();
    } catch {
      /* already dead */
    }
    setToken(null);
    set({ status: "signed-out", user: null });
    afterSignOutHook?.();
  },
}));

declare global {
  interface Window {
    __auth?: typeof useAuth;
  }
}
if (import.meta.env.DEV) window.__auth = useAuth;
