import type { Project } from "../types/scene";

// Same-origin by default: in production nginx proxies /api, and the dev
// server proxies to the local backend. Packaged builds (the iPad app) have no
// server of their own, so they can be pointed at one — set a server URL and
// requests go there instead. Unset means standalone: every cloud feature
// degrades away and the app works entirely offline.
const SERVER_KEY = "server-url";
const TOKEN_KEY = "session-token";
// "Work offline" is a choice, not the absence of a server address: with no
// address the app would still use the API on its own origin, and the sign-in
// gate with it. This says: no API at all, whatever is reachable.
const MODE_KEY = "server-mode";

// The username last signed in on this browser. Not a credential — it only
// says whose local copy to show while the server cannot be reached, and a
// session token has to be present for that to happen at all.
const LAST_USER_KEY = "last-username";

export function lastUsername(): string | null {
  return localStorage.getItem(LAST_USER_KEY);
}

export function setLastUsername(name: string | null) {
  if (name) localStorage.setItem(LAST_USER_KEY, name);
  else localStorage.removeItem(LAST_USER_KEY);
}

/** True when this build ships with no server of its own: the packaged app.
 *  A page served over http(s) came from a Sculpo server and expects one. */
export function standaloneBuild(): boolean {
  return typeof location !== "undefined" && !/^https?:$/.test(location.protocol);
}

export function offlineMode(): boolean {
  return localStorage.getItem(MODE_KEY) === "offline";
}

export function setOfflineMode(on: boolean) {
  if (on) localStorage.setItem(MODE_KEY, "offline");
  else localStorage.removeItem(MODE_KEY);
  // A session belonged to the server we are no longer talking to.
  if (on) setToken(null);
}

export function getServerUrl(): string {
  return localStorage.getItem(SERVER_KEY) ?? "";
}

export function setServerUrl(url: string | null) {
  const clean = url?.trim().replace(/\/+$/, "");
  if (clean) localStorage.setItem(SERVER_KEY, clean);
  else localStorage.removeItem(SERVER_KEY);
  // Any session belonged to the previous server.
  setToken(null);
}

function base(): string {
  const server = getServerUrl();
  return server ? `${server}/api/v1` : "/api/v1";
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  /** The response's `detail`, when it was an object (a 409 carries the current revision). */
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

// Lets the auth store react when a session dies mid-use (401 anywhere).
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base()}${path}`, { ...init, headers });
  if (res.status === 401) {
    setToken(null);
    onUnauthorized?.();
  }
  if (!res.ok) {
    let message = res.statusText;
    let detail: unknown;
    try {
      detail = (await res.json()).detail;
      if (typeof detail === "string") message = detail;
      else if (detail && typeof detail === "object" && "message" in detail) {
        message = String((detail as { message: unknown }).message);
      }
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, message, detail);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface ProjectMeta {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  /** Save counter; a save names the revision it is built on, see updateProject. */
  revision: number;
  /** When the preview was last written; null means there isn't one. */
  thumbnail_at: string | null;
}

export interface UserInfo {
  id: string;
  username: string;
  is_admin: boolean;
}

export interface SessionInfo {
  session_token: string;
  user: UserInfo;
}

export interface AdminOverview {
  users: UserInfo[];
  invited: string[];
}

/** Returned once, when the invite is created. The server only keeps a hash,
 *  so a lost code cannot be looked up — re-invite to issue a fresh one. */
export interface InviteCreated {
  username: string;
  code: string;
  expires_at: string;
  overview: AdminOverview;
}

export const api = {
  async available(at: string = base()): Promise<boolean> {
    if (offlineMode()) return false;
    try {
      const res = await fetch(`${at}/health`);
      if (!res.ok) return false;
      // Insist on the real health payload. A packaged build serves its own
      // shell for unknown paths, and misconfigured proxies return login pages,
      // so a bare 200 is not proof that a Sculpo server is on the other end.
      const body = (await res.json()) as { status?: string };
      return body?.status === "ok";
    } catch {
      return false;
    }
  },
  login: (username: string, password: string) =>
    request<SessionInfo>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  register: (
    username: string,
    password: string,
    opts: { adminSecret?: string; inviteCode?: string } = {},
  ) =>
    request<SessionInfo>("/auth/register", {
      method: "POST",
      // invite_code is what proves an ordinary registration was invited;
      // admin_secret is only for claiming an ADMIN_USERS name on a server
      // that requires it. Each is omitted when empty.
      body: JSON.stringify({
        username,
        password,
        ...(opts.inviteCode ? { invite_code: opts.inviteCode } : {}),
        ...(opts.adminSecret ? { admin_secret: opts.adminSecret } : {}),
      }),
    }),
  me: () => request<UserInfo>("/auth/me"),
  // Returns a replacement session: changing the password revokes every
  // existing one, including the caller's.
  changePassword: (currentPassword: string, newPassword: string) =>
    request<SessionInfo>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }),
  putThumbnail: (id: string, dataUrl: string) =>
    request<void>(`/projects/${id}/thumbnail`, {
      method: "PUT",
      body: JSON.stringify({ image: dataUrl }),
    }),
  // The image endpoint needs the bearer token, which an <img src> cannot
  // send — so fetch the bytes and hand back a blob the caller turns into an
  // object URL.
  // `version` (the project's thumbnail_at) goes in the URL: the server marks
  // the image immutable and cacheable for a year, so a new picture must have
  // a new address or the browser keeps showing the old one.
  fetchThumbnail: async (id: string, version: string): Promise<Blob | null> => {
    const token = getToken();
    const res = await fetch(`${base()}/projects/${id}/thumbnail?v=${encodeURIComponent(version)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    return res.blob();
  },
  adminUsers: () => request<AdminOverview>("/admin/users"),
  adminInvite: (username: string) =>
    request<InviteCreated>("/admin/invites", {
      method: "POST",
      body: JSON.stringify({ username }),
    }),
  adminRevokeInvite: (username: string) =>
    request<AdminOverview>(`/admin/invites/${encodeURIComponent(username)}`, {
      method: "DELETE",
    }),
  adminDeleteUser: (id: string) =>
    request<AdminOverview>(`/admin/users/${id}`, { method: "DELETE" }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  listProjects: () => request<ProjectMeta[]>("/projects"),
  getProject: (id: string) =>
    request<ProjectMeta & { data: Project }>(`/projects/${id}`),
  createProject: (name: string, data: Project) =>
    request<ProjectMeta>("/projects", { method: "POST", body: JSON.stringify({ name, data }) }),
  // `expectedRevision` is the revision this save is built on; the server
  // refuses (409, with the current revision in the error's detail) if
  // another device has saved since. Omit to replace regardless.
  updateProject: (id: string, name: string, data: Project, expectedRevision?: number) =>
    request<ProjectMeta>(`/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, data, expected_revision: expectedRevision }),
    }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),
};
