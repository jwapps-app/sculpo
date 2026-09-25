import { useState } from "react";
import { getServerUrl, setOfflineMode, setServerUrl } from "../lib/api";
import { useAuth } from "../state/auth";

// Points the app at a Sculpo server (or clears it, returning to standalone).
// Packaged builds — the iPad app — ship with no server of their own, so this
// is how cloud sync gets switched on; on the web the app is already served
// alongside its API and this is rarely needed.
export function ServerSettings({ onDone }: { onDone?: () => void }) {
  const [url, setUrl] = useState(getServerUrl());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setNotice(null);
    const trimmed = url.trim();
    setOfflineMode(false);
    setServerUrl(trimmed || null);
    await useAuth.getState().init();
    setBusy(false);
    if (trimmed && useAuth.getState().status === "offline") {
      setNotice("Couldn't reach that server. Check the address and that it's running.");
      return;
    }
    onDone?.();
  };

  const workOffline = async () => {
    setBusy(true);
    setUrl("");
    setServerUrl(null);
    setOfflineMode(true);
    await useAuth.getState().init();
    setBusy(false);
    onDone?.();
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-neutral-500">
        Sculpo works fully offline. Add a server address to sync projects across
        devices — or leave it empty to use the server this page came from.
      </p>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") connect();
        }}
        placeholder="https://sculpo.example.com"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        inputMode="url"
        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
      />
      <div className="flex gap-1">
        <button
          onClick={connect}
          disabled={busy}
          className="flex-1 rounded bg-blue-600 px-2 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
        >
          Connect
        </button>
        <button
          onClick={workOffline}
          disabled={busy}
          className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-100 disabled:opacity-40"
        >
          Work offline
        </button>
      </div>
      {notice && <p className="text-xs text-red-600">{notice}</p>}
    </div>
  );
}
