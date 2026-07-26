import { create } from "zustand";
import { api, getToken, setToken, setUnauthorizedHandler, type UserInfo } from "../lib/api";

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
    adminSecret?: string,
  ) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthState>()((set) => ({
  status: "checking",
  user: null,

  init: async () => {
    setUnauthorizedHandler(() => set({ status: "signed-out", user: null }));
    if (!(await api.available())) {
      set({ status: "offline" });
      return;
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

  authenticate: async (mode, username, password, adminSecret) => {
    const session =
      mode === "login"
        ? await api.login(username, password)
        : await api.register(username, password, adminSecret);
    setToken(session.session_token);
    set({ status: "signed-in", user: session.user });
  },

  signOut: async () => {
    try {
      await api.logout();
    } catch {
      /* already dead */
    }
    setToken(null);
    set({ status: "signed-out", user: null });
  },
}));
