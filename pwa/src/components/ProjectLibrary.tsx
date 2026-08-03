import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import { api, type ProjectMeta } from "../lib/api";

/** Fetches a project's preview and hands back an object URL, revoking the
 *  previous one. The image endpoint needs a bearer token, so this cannot just
 *  be an <img src>. */
function useThumbnail(project: ProjectMeta): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const stamp = project.thumbnail_at;

  useEffect(() => {
    if (!stamp) {
      setUrl(null);
      return;
    }
    let dead = false;
    let objectUrl: string | null = null;
    void api.fetchThumbnail(project.id).then((blob) => {
      if (dead || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      dead = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // stamp changes whenever the picture is rewritten, which is the cue to refetch.
  }, [project.id, stamp]);

  return url;
}

function whenText(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function Card({
  project,
  current,
  onOpen,
  onDelete,
  busy,
}: {
  project: ProjectMeta;
  current: boolean;
  onOpen: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const url = useThumbnail(project);
  return (
    <div
      className={`group relative overflow-hidden rounded-lg border bg-white text-left shadow-sm transition hover:shadow-md ${
        current ? "border-blue-500 ring-1 ring-blue-500" : "border-neutral-200"
      }`}
    >
      <button onClick={onOpen} disabled={busy} className="block w-full text-left">
        <div className="flex aspect-4/3 items-center justify-center overflow-hidden bg-neutral-100">
          {url ? (
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs text-neutral-400">
              {project.thumbnail_at ? "Loading…" : "No preview yet"}
            </span>
          )}
        </div>
        <div className="px-2.5 py-2">
          <div className="truncate text-sm font-medium text-neutral-800">{project.name}</div>
          <div className="text-xs text-neutral-500">
            {current ? "Open now" : whenText(project.updated_at)}
          </div>
        </div>
      </button>
      <button
        onClick={onDelete}
        disabled={busy}
        title={`Delete ${project.name}`}
        className="hover-reveal absolute right-1.5 top-1.5 rounded bg-white/90 p-1.5 text-neutral-500 opacity-0 shadow-sm transition group-hover:opacity-100 hover:text-red-600 focus:opacity-100"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

/** Full-window grid of the signed-in user's cloud projects. */
export function ProjectLibrary({
  projects,
  currentId,
  busy,
  onOpen,
  onDelete,
  onClose,
}: {
  projects: ProjectMeta[] | null;
  currentId: string | null;
  busy: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2.5">
        <div>
          <h2 className="text-base font-bold">Your projects</h2>
          <p className="text-xs text-neutral-500">
            {projects === null
              ? "Loading…"
              : `${projects.length} saved in the cloud — previews update as you work`}
          </p>
        </div>
        <button
          onClick={onClose}
          title="Close (Esc)"
          className="rounded-md p-2 text-neutral-600 hover:bg-neutral-100"
        >
          <X size={18} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {projects !== null && projects.length === 0 ? (
          <p className="mt-16 text-center text-sm text-neutral-500">
            Nothing saved yet. Anything you build is saved here automatically.
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {(projects ?? []).map((p) => (
              <Card
                key={p.id}
                project={p}
                current={p.id === currentId}
                busy={busy}
                onOpen={() => onOpen(p.id)}
                onDelete={() => onDelete(p.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
