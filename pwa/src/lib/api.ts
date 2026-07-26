import type { Project } from "../types/scene";

// Same-origin by default: in production nginx proxies /api, and the dev
// server proxies to the local backend. Packaged builds (the iPad app) have no
// server of their own, so they can be pointed at one — set a server URL and
// requests go there instead. Unset means standalone: every cloud feature
// degrades away and the app works entirely offline.
const SERVER_KEY = "server-url";
const TOKEN_KEY = "session-token";

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
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, detail);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface ProjectMeta {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
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

export const api = {
  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${base()}/health`);
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
  register: (username: string, password: string, adminSecret?: string) =>
    request<SessionInfo>("/auth/register", {
      method: "POST",
      // admin_secret is only consulted when claiming an ADMIN_USERS name on a
      // server that requires it; omitted otherwise.
      body: JSON.stringify(
        adminSecret ? { username, password, admin_secret: adminSecret } : { username, password },
      ),
    }),
  me: () => request<UserInfo>("/auth/me"),
  // Returns a replacement session: changing the password revokes every
  // existing one, including the caller's.
  changePassword: (currentPassword: string, newPassword: string) =>
    request<SessionInfo>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }),
  adminUsers: () => request<AdminOverview>("/admin/users"),
  adminInvite: (username: string) =>
    request<AdminOverview>("/admin/invites", {
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
  updateProject: (id: string, name: string, data: Project) =>
    request<ProjectMeta>(`/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, data }),
    }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),
};
