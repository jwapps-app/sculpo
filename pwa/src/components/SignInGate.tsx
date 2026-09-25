import { useState } from "react";
import { APP_NAME } from "../constants/branding";
import { useAuth } from "../state/auth";
import { ServerSettings } from "./ServerSettings";

// Full-screen sign-in gate, shown instead of the workspace whenever a backend
// is present and nobody is signed in.
export function SignInGate() {
  const authenticate = useAuth((s) => s.authenticate);
  const status = useAuth((s) => s.status);
  const init = useAuth((s) => s.init);
  const unreachable = status === "unreachable";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showServer, setShowServer] = useState(false);
  const [adminSecret, setAdminSecret] = useState("");
  const [showAdminSecret, setShowAdminSecret] = useState(false);
  const [inviteCode, setInviteCode] = useState("");

  const canSubmit = username.trim().length >= 3 && password.length >= 8 && !busy;
  // Say WHY the buttons are disabled instead of leaving them mysteriously gray.
  const hint =
    username.trim().length > 0 && username.trim().length < 3
      ? "Usernames need at least 3 characters."
      : password.length > 0 && password.length < 8
        ? "Passwords need at least 8 characters."
        : null;

  const submit = async (mode: "login" | "register") => {
    setBusy(true);
    setNotice(null);
    try {
      await authenticate(mode, username.trim(), password, {
        adminSecret: adminSecret.trim() || undefined,
        inviteCode: inviteCode.trim() || undefined,
      });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-neutral-100">
      <form
        className="w-72 space-y-3 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) submit("login");
        }}
      >
        <div className="flex items-center justify-center gap-2">
          <img src="/icon.svg" alt="" className="h-8 w-8 rounded" />
          <span className="text-lg font-bold">{APP_NAME}</span>
        </div>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username"
          autoComplete="username"
          autoFocus
          className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password (8+ characters)"
          autoComplete="current-password"
          className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded bg-blue-600 px-2 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
        >
          Sign in
        </button>
        <input
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          placeholder="invite code (to create an account)"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={() => submit("register")}
          disabled={!canSubmit}
          title="Paste the invite code you were sent, pick a password, and this creates your account"
          className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40"
        >
          Create account
        </button>
        {showAdminSecret ? (
          <input
            type="password"
            value={adminSecret}
            onChange={(e) => setAdminSecret(e.target.value)}
            placeholder="admin setup secret"
            autoComplete="off"
            className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowAdminSecret(true)}
            className="w-full text-center text-xs text-neutral-500 hover:text-neutral-800"
          >
            Setting up the admin account?
          </button>
        )}
        {unreachable && (
          <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
            The server is not answering, so signing in is not possible right now.
            It is retried automatically.
            <button
              type="button"
              onClick={() => void init()}
              className="ml-2 rounded border border-amber-400 px-1.5 py-0.5 hover:bg-amber-100"
            >
              Try now
            </button>
          </div>
        )}
        {hint && <p className="text-xs text-neutral-500">{hint}</p>}
        {notice && <p className="text-xs text-red-600">{notice}</p>}
        {showServer ? (
          <div className="border-t border-neutral-200 pt-3">
            <ServerSettings onDone={() => setShowServer(false)} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowServer(true)}
            className="w-full text-center text-xs text-neutral-500 hover:text-neutral-800"
          >
            Change server or work offline
          </button>
        )}
      </form>
    </div>
  );
}
