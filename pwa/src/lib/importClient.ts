import type { ImportedMesh } from "./importMesh";

// Runs a mesh import in a worker, with a cancel that stops it dead. The
// decision to simplify is asked of the caller between the two steps.

export interface ImportHandle {
  result: Promise<ImportedMesh>;
  cancel: () => void;
}

type Reply =
  | { type: "parsed"; triangles: number; maySimplify: boolean; mustSimplify: boolean }
  | { type: "done"; result: ImportedMesh }
  | { type: "error"; message: string };

export function importMesh(file: File, decideSimplify: (triangles: number) => boolean): ImportHandle {
  // SVG parsing needs the DOM, which a worker does not have; an SVG is small
  // enough to parse in place. Everything heavy is STL or OBJ.
  const svg = /\.svg$/i.test(file.name);
  if (typeof Worker === "undefined" || svg) {
    return {
      result: import("./importMesh").then((m) => m.importMeshFile(file, decideSimplify)),
      cancel: () => {},
    };
  }
  const worker = new Worker(new URL("./workers/import.worker.ts", import.meta.url), { type: "module" });
  let settled = false;
  const result = new Promise<ImportedMesh>((resolve, reject) => {
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      fn();
    };
    worker.onmessage = (e: MessageEvent<Reply>) => {
      const msg = e.data;
      if (msg.type === "parsed") {
        const simplify = msg.mustSimplify || (msg.maySimplify && decideSimplify(msg.triangles));
        if (!settled) worker.postMessage({ type: "finish", simplify });
      } else if (msg.type === "done") {
        finish(() => resolve(msg.result));
      } else {
        finish(() => reject(new Error(msg.message)));
      }
    };
    worker.onerror = (err) => finish(() => reject(new Error(err.message || "The import failed.")));
    worker.postMessage({ type: "parse", file });
  });
  let rejectCancelled: (() => void) | null = null;
  const cancellable = new Promise<ImportedMesh>((resolve, reject) => {
    rejectCancelled = () => reject(new DOMException("Import cancelled.", "AbortError"));
    result.then(resolve, reject);
  });
  return {
    result: cancellable,
    cancel: () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      rejectCancelled?.();
    },
  };
}
