import { useEffect, useState } from "react";
import { Cloud, CloudOff, LogOut, Trash2, X } from "lucide-react";
import { api, getToken, setToken, type ProjectMeta } from "../lib/api";
import { useScene } from "../state/store";

type AuthState =
  | { kind: "checking" }
  | { kind: "offline" }
  | { kind: "signed-out" }
  | { kind: "signed-in"; username: string };

// Cloud projects: sign in with username + password, then list/open/save/
// delete designs stored on the server. Invisible when no backend is
// reachable — the standalone tool keeps working without it.
export function CloudPanel() {
  const [auth, setAuth] = useState<AuthState>({ kind: "checking" });
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);

  const cloudProjectId = useScene((s) => s.cloudProjectId);
  const setCloudProjectId = useScene((s) => s.setCloudProjectId);
  const loadProject = useScene((s) => s.loadProject);

  useEffect(() => {
    (async () => {
      if (!(await api.available())) {
        setAuth({ kind: "offline" });
        return;
      }
      if (getToken()) {
        try {
          const user = await api.me();
          setAuth({ kind: "signed-in", username: user.username });
          return;
        } catch {
          /* expired */
        }
      }
      setAuth({ kind: "signed-out" });
    })();
  }, []);

  useEffect(() => {
    if (open && auth.kind === "signed-in") {
      api.listProjects().then(setProjects).catch(() => setProjects([]));
    }
  }, [open, auth]);

  if (auth.kind === "offline" || auth.kind === "checking") return null;

  const submit = async (mode: "login" | "register") => {
    setBusy(true);
    setNotice(null);
    try {
      const session =
        mode === "login"
          ? await api.login(username.trim(), password)
          : await api.register(username.trim(), password);
      setToken(session.session_token);
      setAuth({ kind: "signed-in", username: session.user.username });
      setPassword("");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const saveToCloud = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const project = useScene.getState().project;
      if (cloudProjectId) {
        await api.updateProject(cloudProjectId, project.name, project);
      } else {
        const meta = await api.createProject(project.name, project);
        setCloudProjectId(meta.id);
      }
      setProjects(await api.listProjects());
      setNotice("Saved.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const openFromCloud = async (id: string) => {
    setBusy(true);
    try {
      const full = await api.getProject(id);
      loadProject(full.data, full.id);
      setOpen(false);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not open the project.");
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = username.trim().length >= 3 && password.length >= 8 && !busy;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        title={
          auth.kind === "signed-in" ? `Cloud projects (${auth.username})` : "Cloud projects — sign in"
        }
        aria-label="Cloud projects"
        className={`rounded-md p-1.5 ${
          open ? "bg-neutral-800 text-white" : "text-neutral-700 hover:bg-neutral-200"
        }`}
      >
        {auth.kind === "signed-in" ? (
          <Cloud size={17} strokeWidth={1.8} />
        ) : (
          <CloudOff size={17} strokeWidth={1.8} />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-md border border-neutral-200 bg-white p-3 shadow-lg">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">Cloud projects</span>
              <button onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-700">
                <X size={14} />
              </button>
            </div>

            {auth.kind === "signed-out" ? (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canSubmit) submit("login");
                }}
              >
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="username"
                  autoComplete="username"
                  className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="password (8+ characters)"
                  autoComplete="current-password"
                  className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                />
                <div className="flex gap-1">
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="flex-1 rounded bg-blue-600 px-2 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    onClick={() => submit("register")}
                    disabled={!canSubmit}
                    title="First time? Create your account"
                    className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-100 disabled:opacity-40"
                  >
                    Create account
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-neutral-500">
                  <span>{auth.kind === "signed-in" ? auth.username : ""}</span>
                  <button
                    onClick={async () => {
                      try {
                        await api.logout();
                      } catch {
                        /* already dead */
                      }
                      setToken(null);
                      setAuth({ kind: "signed-out" });
                      setCloudProjectId(null);
                      setProjects(null);
                    }}
                    title="Sign out"
                    className="flex items-center gap-1 hover:text-neutral-800"
                  >
                    <LogOut size={12} /> Sign out
                  </button>
                </div>
                <button
                  onClick={saveToCloud}
                  disabled={busy}
                  className="w-full rounded bg-blue-600 px-2 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  {cloudProjectId ? "Save (update cloud copy)" : "Save to cloud"}
                </button>
                <div className="max-h-56 space-y-1 overflow-y-auto">
                  {projects === null ? (
                    <p className="text-xs text-neutral-400">Loading…</p>
                  ) : projects.length === 0 ? (
                    <p className="text-xs text-neutral-400">No cloud projects yet.</p>
                  ) : (
                    projects.map((p) => (
                      <div
                        key={p.id}
                        className={`flex items-center justify-between rounded border px-2 py-1 text-sm ${
                          p.id === cloudProjectId
                            ? "border-blue-300 bg-blue-50"
                            : "border-neutral-200"
                        }`}
                      >
                        <button
                          onClick={() => openFromCloud(p.id)}
                          className="flex-1 truncate text-left hover:text-blue-700"
                          title={`Open “${p.name}”`}
                        >
                          {p.name}
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm(`Delete “${p.name}” from the cloud?`)) return;
                            await api.deleteProject(p.id);
                            if (p.id === cloudProjectId) setCloudProjectId(null);
                            setProjects(await api.listProjects());
                          }}
                          title="Delete from cloud"
                          className="ml-2 text-neutral-400 hover:text-red-600"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
            {notice && <p className="mt-2 text-xs text-neutral-500">{notice}</p>}
          </div>
        </>
      )}
    </div>
  );
}
