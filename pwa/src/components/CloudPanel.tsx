import { useEffect, useState } from "react";
import { Cloud, KeyRound, LogOut, Trash2, UserPlus, X } from "lucide-react";
import { api, type AdminOverview, type ProjectMeta } from "../lib/api";
import { useScene } from "../state/store";
import { useAuth } from "../state/auth";
import { markSynced, syncNow, useCloudSync } from "../state/cloudSync";

// Cloud projects for the signed-in user: list/open/save/delete designs on the
// server; admins manage users here too. Sign-in itself happens at the gate
// (SignInGate) — this panel only exists once authenticated, and not at all in
// standalone (no-backend) mode.
export function CloudPanel() {
  const status = useAuth((s) => s.status);
  const me = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);

  const [open, setOpen] = useState(false);
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
  const sync = useCloudSync();

  useEffect(() => {
    if (open && status === "signed-in") {
      api.listProjects().then(setProjects).catch(() => setProjects([]));
      if (me?.is_admin) {
        api.adminUsers().then(setAdminData).catch(() => setAdminData(null));
      }
    }
  }, [open, status, me]);

  if (status !== "signed-in" || !me) return null;

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

  const openFromCloud = (id: string) =>
    run(async () => {
      const full = await api.getProject(id);
      loadProject(full.data, full.id);
      // Freshly opened = already in sync; don't immediately re-upload it.
      markSynced(useScene.getState().project);
      setOpen(false);
    });

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        title={`Cloud projects (${me.username}) — ${
          sync.status === "saving"
            ? "saving…"
            : sync.status === "error"
              ? `sync problem: ${sync.detail}`
              : "all changes saved automatically"
        }`}
        aria-label="Cloud projects"
        className={`relative rounded-md p-1.5 ${
          open ? "bg-neutral-800 text-white" : "text-neutral-700 hover:bg-neutral-200"
        }`}
      >
        <Cloud size={17} strokeWidth={1.8} />
        <span
          className={`absolute right-0.5 top-0.5 h-2 w-2 rounded-full ${
            sync.status === "error"
              ? "bg-red-500"
              : sync.status === "saving"
                ? "animate-pulse bg-amber-400"
                : sync.status === "saved"
                  ? "bg-green-500"
                  : "bg-neutral-300"
          }`}
        />
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
                        await signOut();
                        setCloudProjectId(null);
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

              <div
                className={`flex items-center justify-between rounded border px-2 py-1 text-xs ${
                  sync.status === "error"
                    ? "border-red-300 bg-red-50 text-red-700"
                    : "border-neutral-200 text-neutral-500"
                }`}
              >
                <span>
                  {sync.status === "saving"
                    ? "Saving…"
                    : sync.status === "error"
                      ? `Sync problem: ${sync.detail}`
                      : sync.status === "saved"
                        ? "All changes saved automatically"
                        : cloudProjectId
                          ? "In sync — changes save automatically"
                          : "Changes will save automatically as you work"}
                </span>
                {sync.status === "error" && (
                  <button
                    onClick={() => void syncNow()}
                    className="ml-2 rounded border border-red-300 px-1.5 py-0.5 hover:bg-red-100"
                  >
                    Retry
                  </button>
                )}
              </div>
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
                                !confirm(`Remove ${u.username} and all of their cloud projects?`)
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
            {notice && <p className="mt-2 text-xs text-neutral-500">{notice}</p>}
          </div>
        </>
      )}
    </div>
  );
}
