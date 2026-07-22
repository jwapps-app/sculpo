import type { Project } from "../types/scene";

// Same-origin in production (nginx proxies /api); the dev server proxies to
// the local backend. All cloud features degrade away if the API is absent.
const BASE = "/api/v1";
const TOKEN_KEY = "session-token";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 401) setToken(null);
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
      const res = await fetch(`${BASE}/health`);
      return res.ok;
    } catch {
      return false;
    }
  },
  login: (username: string, password: string) =>
    request<SessionInfo>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  register: (username: string, password: string) =>
    request<SessionInfo>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  me: () => request<UserInfo>("/auth/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/auth/change-password", {
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
