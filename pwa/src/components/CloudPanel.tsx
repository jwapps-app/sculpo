import { useEffect, useState } from "react";
import { Cloud, CloudOff, KeyRound, LogOut, Trash2, UserPlus, X } from "lucide-react";
import {
  api,
  getToken,
  setToken,
  type AdminOverview,
  type ProjectMeta,
  type UserInfo,
} from "../lib/api";
import { useScene } from "../state/store";

type AuthState =
  | { kind: "checking" }
  | { kind: "offline" }
  | { kind: "signed-out" }
  | { kind: "signed-in"; user: UserInfo };

// Cloud projects: sign in with username + password, list/open/save/delete
// designs on the server; admins manage users here too. Invisible when no
// backend is reachable — the standalone tool keeps working without it.
export function CloudPanel() {
  const [auth, setAuth] = useState<AuthState>({ kind: "checking" });
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [adminData, setAdminData] = useState<AdminOverview | null>(null);
  const [inviteName, setInviteName] = useState("");
  const [showPwForm, setShowPwForm] = useState(false);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");

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
          setAuth({ kind: "signed-in", user: await api.me() });
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
      if (auth.user.is_admin) {
        api.adminUsers().then(setAdminData).catch(() => setAdminData(null));
      }
    }
  }, [open, auth]);

  if (auth.kind === "offline" || auth.kind === "checking") return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const submit = (mode: "login" | "register") =>
    run(async () => {
      const session =
        mode === "login"
          ? await api.login(username.trim(), password)
          : await api.register(username.trim(), password);
      setToken(session.session_token);
      setAuth({ kind: "signed-in", user: session.user });
      setPassword("");
    });

  const saveToCloud = () =>
    run(async () => {
      const project = useScene.getState().project;
      if (cloudProjectId) {
        await api.updateProject(cloudProjectId, project.name, project);
      } else {
        const meta = await api.createProject(project.name, project);
        setCloudProjectId(meta.id);
      }
      setProjects(await api.listProjects());
      setNotice("Saved.");
    });

  const openFromCloud = (id: string) =>
    run(async () => {
      const full = await api.getProject(id);
      loadProject(full.data, full.id);
      setOpen(false);
    });

  const canSubmit = username.trim().length >= 3 && password.length >= 8 && !busy;
  const me = auth.kind === "signed-in" ? auth.user : null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        title={me ? `Cloud projects (${me.username})` : "Cloud projects — sign in"}
        aria-label="Cloud projects"
        className={`rounded-md p-1.5 ${
          open ? "bg-neutral-800 text-white" : "text-neutral-700 hover:bg-neutral-200"
        }`}
      >
        {me ? <Cloud size={17} strokeWidth={1.8} /> : <CloudOff size={17} strokeWidth={1.8} />}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-80 rounded-md border border-neutral-200 bg-white p-3 shadow-lg">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">Cloud projects</span>
              <button onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-700">
                <X size={14} />
              </button>
            </div>

            {!me ? (
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
                  <span>
                    {me.username}
                    {me.is_admin && <span className="ml-1 text-blue-600">(admin)</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <button
                      onClick={() => setShowPwForm(!showPwForm)}
                      title="Change password"
                      className="flex items-center gap-1 hover:text-neutral-800"
                    >
                      <KeyRound size={12} /> Password
                    </button>
                    <button
                      onClick={() =>
                        run(async () => {
                          try {
                            await api.logout();
                          } catch {
                            /* already dead */
                          }
                          setToken(null);
                          setAuth({ kind: "signed-out" });
                          setCloudProjectId(null);
                          setProjects(null);
                          setAdminData(null);
                        })
                      }
                      title="Sign out"
                      className="flex items-center gap-1 hover:text-neutral-800"
                    >
                      <LogOut size={12} /> Sign out
                    </button>
                  </span>
                </div>

                {showPwForm && (
                  <form
                    className="space-y-1 rounded border border-neutral-200 p-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(async () => {
                        await api.changePassword(pwCurrent, pwNew);
                        setPwCurrent("");
                        setPwNew("");
                        setShowPwForm(false);
                        setNotice("Password changed.");
                      });
                    }}
                  >
                    <input
                      type="password"
                      value={pwCurrent}
                      onChange={(e) => setPwCurrent(e.target.value)}
                      placeholder="current password"
                      autoComplete="current-password"
                      className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
                    />
                    <input
                      type="password"
                      value={pwNew}
                      onChange={(e) => setPwNew(e.target.value)}
                      placeholder="new password (8+ characters)"
                      autoComplete="new-password"
                      className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={busy || pwCurrent.length < 8 || pwNew.length < 8}
                      className="w-full rounded bg-neutral-800 px-2 py-1 text-xs text-white hover:bg-neutral-700 disabled:opacity-40"
                    >
                      Change password
                    </button>
                  </form>
                )}

                <button
                  onClick={saveToCloud}
                  disabled={busy}
                  className="w-full rounded bg-blue-600 px-2 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  {cloudProjectId ? "Save (update cloud copy)" : "Save to cloud"}
                </button>
                <div className="max-h-44 space-y-1 overflow-y-auto">
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
                          onClick={() =>
                            run(async () => {
                              if (!confirm(`Delete “${p.name}” from the cloud?`)) return;
                              await api.deleteProject(p.id);
                              if (p.id === cloudProjectId) setCloudProjectId(null);
                              setProjects(await api.listProjects());
                            })
                          }
                          title="Delete from cloud"
                          className="ml-2 text-neutral-400 hover:text-red-600"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {me.is_admin && (
                  <div className="space-y-1 border-t border-neutral-200 pt-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Users
                    </div>
                    {adminData?.users.map((u) => (
                      <div
                        key={u.id}
                        className="flex items-center justify-between rounded border border-neutral-200 px-2 py-0.5 text-xs"
                      >
                        <span>
                          {u.username}
                          {u.is_admin && <span className="ml-1 text-blue-600">(admin)</span>}
                        </span>
                        {u.id !== me.id && (
                          <button
                            onClick={() =>
                              run(async () => {
                                if (
                                  !confirm(
                                    `Remove ${u.username} and all of their cloud projects?`,
                                  )
                                )
                                  return;
                                setAdminData(await api.adminDeleteUser(u.id));
                              })
                            }
                            title="Remove user and their projects"
                            className="text-neutral-400 hover:text-red-600"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                    {adminData?.invited.map((name) => (
                      <div
                        key={name}
                        className="flex items-center justify-between rounded border border-dashed border-neutral-300 px-2 py-0.5 text-xs text-neutral-500"
                      >
                        <span>{name} — invited, not registered yet</span>
                        <button
                          onClick={() =>
                            run(async () => {
                              setAdminData(await api.adminRevokeInvite(name));
                            })
                          }
                          title="Revoke invite"
                          className="text-neutral-400 hover:text-red-600"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    <form
                      className="flex gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (inviteName.trim().length >= 3) {
                          run(async () => {
                            setAdminData(await api.adminInvite(inviteName.trim()));
                            setInviteName("");
                          });
                        }
                      }}
                    >
                      <input
                        value={inviteName}
                        onChange={(e) => setInviteName(e.target.value)}
                        placeholder="username to invite"
                        className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
                      />
                      <button
                        type="submit"
                        disabled={busy || inviteName.trim().length < 3}
                        title="Invite — they choose their password when they register"
                        className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40"
                      >
                        <UserPlus size={13} />
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}
            {notice && <p className="mt-2 text-xs text-neutral-500">{notice}</p>}
          </div>
        </>
      )}
    </div>
  );
}
