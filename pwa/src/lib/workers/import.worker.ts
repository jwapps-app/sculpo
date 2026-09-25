import { finishImport, parseMeshFile, type ParsedMesh } from "../importMesh";

// Mesh import off the UI thread: parsing a 250 MB STL, welding a million
// vertices and decimating them used to freeze the page for as long as it
// took. Two steps, because the user gets a say in the middle: parse and
// report the size; then finish, with or without simplification.

type In = { type: "parse"; file: File } | { type: "finish"; simplify: boolean };

const ctx = self as unknown as {
  postMessage: (message: unknown) => void;
  onmessage: ((e: MessageEvent<In>) => void) | null;
};

let parsed: ParsedMesh | null = null;

ctx.onmessage = async (e) => {
  try {
    if (e.data.type === "parse") {
      parsed = await parseMeshFile(e.data.file);
      ctx.postMessage({
        type: "parsed",
        triangles: parsed.triangles,
        maySimplify: parsed.maySimplify,
        mustSimplify: parsed.mustSimplify,
      });
    } else if (parsed) {
      ctx.postMessage({ type: "done", result: await finishImport(parsed, e.data.simplify) });
    }
  } catch (err) {
    ctx.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
