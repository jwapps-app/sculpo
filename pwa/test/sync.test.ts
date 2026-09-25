// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The scenarios the audit reproduced by hand (F01–F06) and the sign-in
// states, run against a fake server in this process: a page "loads" by
// resetting the modules, with the browser's storage carried across.

vi.mock("../src/lib/manifold", () => ({
  manifoldLoaded: () => false,
  manifoldLib: () => null,
  manifoldReady: Promise.resolve(false),
  engineStatus: () => "failed",
  useEngineStatus: () => "failed",
  useManifoldLoaded: () => false,
  filletedBox: () => null,
  cutGroup: () => null,
  toManifold: () => null,
  fromManifold: () => null,
  weldCoincident: () => null,
  repairExtrusion: () => null,
  isClosedSolid: () => false,
  isFlatExtrusion: () => false,
  asClosedSolid: (g: unknown) => g,
}));

import type { Project } from "../src/types/scene";

type Row = { id: string; owner: string; name: string; data: Project; revision: number; updated_at: string };

/** A Sculpo server, as far as the client can tell. */
class FakeServer {
  down = false;
  createDelayMs = 0;
  users = new Map<string, string>();
  sessions = new Map<string, string>();
  projects = new Map<string, Row>();
  private seq = 0;

  private meta(r: Row) {
    return { id: r.id, name: r.name, created_at: r.updated_at, updated_at: r.updated_at, thumbnail_at: null, revision: r.revision };
  }

  private json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  /** A save made by another device, straight into the store. */
  saveFromElsewhere(id: string, data: Project) {
    const r = this.projects.get(id)!;
    r.data = data;
    r.revision += 1;
    r.updated_at = new Date().toISOString();
  }

  async handle(url: string, init?: RequestInit): Promise<Response> {
    if (this.down) throw new TypeError("Failed to fetch");
    const path = url.replace(/^\/api\/v1/, "").split("?")[0];
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization?.replace("Bearer ", "");
    const user = auth ? this.sessions.get(auth) : undefined;

    if (path === "/health") return this.json(200, { status: "ok" });
    if (path === "/auth/login" || path === "/auth/register") {
      if (path === "/auth/register") this.users.set(body.username, body.password);
      if (this.users.get(body.username) !== body.password) return this.json(401, { detail: "Invalid username or password." });
      const token = `tok-${++this.seq}`;
      this.sessions.set(token, body.username);
      return this.json(200, { session_token: token, user: { id: body.username, username: body.username, is_admin: false } });
    }
    if (!user) return this.json(401, { detail: "Not signed in." });
    if (path === "/auth/me") return this.json(200, { id: user, username: user, is_admin: false });
    if (path === "/auth/logout") {
      for (const [t, u] of this.sessions) if (u === user) this.sessions.delete(t);
      return new Response(null, { status: 204 });
    }
    if (path === "/projects" && method === "GET") {
      return this.json(200, [...this.projects.values()].filter((r) => r.owner === user).map((r) => this.meta(r)));
    }
    if (path === "/projects" && method === "POST") {
      if (this.createDelayMs) await new Promise((r) => setTimeout(r, this.createDelayMs));
      const row: Row = { id: `p-${++this.seq}`, owner: user, name: body.name, data: body.data, revision: 1, updated_at: new Date().toISOString() };
      this.projects.set(row.id, row);
      return this.json(201, this.meta(row));
    }
    const m = path.match(/^\/projects\/([^/]+)(\/thumbnail)?$/);
    if (m) {
      const row = this.projects.get(m[1]);
      if (!row || row.owner !== user) return this.json(404, { detail: "Project not found." });
      if (m[2]) return method === "PUT" ? new Response(null, { status: 204 }) : this.json(404, { detail: "No thumbnail." });
      if (method === "GET") return this.json(200, { ...this.meta(row), data: row.data });
      if (method === "PUT") {
        if (body.expected_revision != null && body.expected_revision !== row.revision) {
          return this.json(409, { detail: { message: "saved elsewhere", revision: row.revision, updated_at: row.updated_at } });
        }
        row.name = body.name;
        row.data = body.data;
        row.revision += 1;
        return this.json(200, this.meta(row));
      }
      if (method === "DELETE") {
        this.projects.delete(row.id);
        return new Response(null, { status: 204 });
      }
    }
    return this.json(404, { detail: "no route" });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let server: FakeServer;

/** A page load: fresh modules, the browser's storage kept. */
async function boot() {
  vi.resetModules();
  const store = await import("../src/state/store");
  const auth = await import("../src/state/auth");
  const sync = await import("../src/state/cloudSync");
  sync.SYNC_DELAYS.local = 5;
  sync.SYNC_DELAYS.cloud = 10;
  const stop = sync.startCloudSync();
  await auth.useAuth.getState().init();
  if (auth.useAuth.getState().status !== "unreachable") await sync.restored;
  return { store, auth, sync, stop };
}

async function signIn(username: string) {
  server.users.set(username, `pw-${username}`);
  const r = await server.handle("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username, password: `pw-${username}` }) });
  const { session_token } = await r.json();
  localStorage.setItem("session-token", session_token);
}

let stop: (() => void) | null = null;

beforeEach(() => {
  server = new FakeServer();
  globalThis.fetch = (u, i) => server.handle(String(u), i);
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
});
afterEach(() => stop?.());

async function untilSaved(sync: Awaited<ReturnType<typeof boot>>["sync"], ms = 300) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    await sleep(15);
    if (sync.useCloudSync.getState().status === "saved") return;
  }
}

describe("keeping designs safe", () => {
  it("restores the design after a reload, from the browser's own copy", async () => {
    let page = await boot();
    stop = page.stop;
    page.store.useScene.getState().addShapeWithParams("box", { w: 10, d: 10, h: 10, radius: 0 });
    page.store.useScene.getState().setProjectName("kept");
    await sleep(60);
    stop();
    page = await boot();
    stop = page.stop;
    expect(page.store.useScene.getState().project.name).toBe("kept");
    expect(page.store.useScene.getState().project.rootOrder).toHaveLength(1);
  });

  it("uploads on sign-in, and a copy restored with unsent edits uploads too (F03)", async () => {
    await signIn("ann");
    let page = await boot();
    stop = page.stop;
    page.store.useScene.getState().addShapeWithParams("box", { w: 10, d: 10, h: 10, radius: 0 });
    await untilSaved(page.sync);
    const id = page.store.useScene.getState().cloudProjectId!;
    expect(server.projects.get(id)?.data.rootOrder).toHaveLength(1);

    // An edit, then the page goes away before the cloud save fires.
    page.sync.SYNC_DELAYS.cloud = 10_000;
    page.store.useScene.getState().addShapeWithParams("sphere", { r: 3, segments: 8 });
    await sleep(40); // the browser copy is written; the cloud one is not
    stop();
    expect(server.projects.get(id)?.data.rootOrder).toHaveLength(1);

    page = await boot();
    stop = page.stop;
    await untilSaved(page.sync);
    expect(server.projects.get(id)?.data.rootOrder).toHaveLength(2);
    expect(server.projects.get(id)?.revision).toBe(2);
  });

  it("credits a late create to the design it was for (F02)", async () => {
    await signIn("ann");
    const page = await boot();
    stop = page.stop;
    const st = page.store.useScene.getState;
    // B already exists in the cloud.
    server.projects.set("p-B", { id: "p-B", owner: "ann", name: "B", data: { id: "b", name: "B", version: 1, nodes: {}, rootOrder: [] }, revision: 1, updated_at: new Date().toISOString() });
    server.createDelayMs = 120;
    st().addShapeWithParams("box", { w: 10, d: 10, h: 10, radius: 0 });
    st().setProjectName("A");
    await sleep(40); // A's create is in flight
    st().loadProject(server.projects.get("p-B")!.data, "p-B", 1);
    page.sync.declareDoc({ synced: true });
    await sleep(300);
    expect(st().cloudProjectId).toBe("p-B");
    const a = [...server.projects.values()].find((r) => r.name === "A");
    expect(a?.data.rootOrder).toHaveLength(1);
    expect(server.projects.get("p-B")?.revision).toBe(1);
  });

  it("saves the edits of a design switched away from at once (F05)", async () => {
    await signIn("ann");
    const page = await boot();
    stop = page.stop;
    const st = page.store.useScene.getState;
    st().addShapeWithParams("box", { w: 10, d: 10, h: 10, radius: 0 });
    await untilSaved(page.sync);
    const id = st().cloudProjectId!;
    st().addShapeWithParams("sphere", { r: 3, segments: 8 });
    st().newProject(); // at once, inside the save delay
    await sleep(200);
    expect(server.projects.get(id)?.data.rootOrder).toHaveLength(2);
  });

  it("keeps the local version as a copy when another device saved first (F06)", async () => {
    await signIn("ann");
    const page = await boot();
    stop = page.stop;
    const st = page.store.useScene.getState;
    st().addShapeWithParams("box", { w: 10, d: 10, h: 10, radius: 0 });
    st().setProjectName("shared");
    await untilSaved(page.sync);
    const id = st().cloudProjectId!;
    server.saveFromElsewhere(id, { ...st().project, nodes: {}, rootOrder: [] });
    st().addShapeWithParams("sphere", { r: 3, segments: 8 });
    await sleep(200);
    expect(server.projects.get(id)?.data.rootOrder).toHaveLength(0); // theirs stands
    const copy = [...server.projects.values()].find((r) => r.name === "shared (copy)");
    expect(copy?.data.rootOrder).toHaveLength(2);
    expect(st().cloudProjectId).toBe(copy?.id);
    expect(page.sync.useCloudSync.getState().detail).toMatch(/saved as/);
  });

  it("shows another account nothing of the last one's (F01)", async () => {
    await signIn("ann");
    let page = await boot();
    stop = page.stop;
    page.store.useScene.getState().addShapeWithParams("box", { w: 10, d: 10, h: 10, radius: 0 });
    page.store.useScene.getState().setProjectName("ann's");
    await untilSaved(page.sync);
    localStorage.setItem("clipboard", "{}");
    await page.auth.useAuth.getState().signOut();
    expect(page.store.useScene.getState().project.rootOrder).toHaveLength(0);
    expect(localStorage.getItem("clipboard")).toBeNull();
    stop();

    await signIn("bob");
    page = await boot();
    stop = page.stop;
    expect(page.store.useScene.getState().project.rootOrder).toHaveLength(0);
    expect([...server.projects.values()].filter((r) => r.owner === "bob")).toHaveLength(0);
    stop();

    // And ann gets her own design back.
    await signIn("ann");
    page = await boot();
    stop = page.stop;
    expect(page.store.useScene.getState().project.name).toBe("ann's");
  });

  it("adopts work done while signed out into the account that signs in next", async () => {
    let page = await boot();
    stop = page.stop;
    expect(page.auth.useAuth.getState().status).toBe("signed-out");
    page.store.useScene.getState().addShapeWithParams("box", { w: 10, d: 10, h: 10, radius: 0 });
    page.store.useScene.getState().setProjectName("before signing in");
    await sleep(60);
    stop();
    await signIn("ann");
    page = await boot();
    stop = page.stop;
    await untilSaved(page.sync);
    expect(page.store.useScene.getState().project.name).toBe("before signing in");
    expect([...server.projects.values()].map((r) => r.name)).toEqual(["before signing in"]);
  });
});

describe("a server that does not answer", () => {
  it("shows the sign-in screen with no session, and nothing of anyone's", async () => {
    await signIn("ann");
    let page = await boot();
    stop = page.stop;
    page.store.useScene.getState().addShapeWithParams("box", { w: 10, d: 10, h: 10, radius: 0 });
    await untilSaved(page.sync);
    await page.auth.useAuth.getState().signOut();
    stop();
    server.down = true;
    page = await boot();
    stop = page.stop;
    expect(page.auth.useAuth.getState().status).toBe("unreachable");
  });

  it("opens the editor for an existing session, with that account's copy, and recovers", async () => {
    await signIn("ann");
    let page = await boot();
    stop = page.stop;
    page.store.useScene.getState().addShapeWithParams("box", { w: 10, d: 10, h: 10, radius: 0 });
    page.store.useScene.getState().setProjectName("ann's own");
    await untilSaved(page.sync);
    stop();
    server.down = true;
    page = await boot();
    stop = page.stop;
    expect(page.auth.useAuth.getState().status).toBe("disconnected");
    expect(page.store.useScene.getState().project.name).toBe("ann's own");
    // An edit while disconnected, then the server returns.
    page.store.useScene.getState().addShapeWithParams("sphere", { r: 3, segments: 8 });
    await sleep(60);
    server.down = false;
    await page.auth.useAuth.getState().init();
    await untilSaved(page.sync);
    expect(page.auth.useAuth.getState().status).toBe("signed-in");
    const row = [...server.projects.values()][0];
    expect(row.data.rootOrder).toHaveLength(2);
  });

  it("is offline only when told to be", async () => {
    server.down = true;
    localStorage.setItem("server-mode", "offline");
    const page = await boot();
    stop = page.stop;
    expect(page.auth.useAuth.getState().status).toBe("offline");
  });
});
