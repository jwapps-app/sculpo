import type { Project, SceneNode, Vec3 } from "../types/scene";
import { isGroup } from "../types/scene";
import { DEFAULT_PARAMS } from "./primitives";
import { downloadBlob, safeFilename } from "./download";

export function saveProjectFile(project: Project) {
  downloadBlob(
    new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }),
    `${safeFilename(project.name)}.json`,
  );
}

const MAX_GROUP_DEPTH = 64;

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
}

function isValidNode(n: unknown): n is SceneNode {
  if (typeof n !== "object" || n === null) return false;
  const node = n as Record<string, unknown>;
  if (typeof node.id !== "string") return false;
  if (!isVec3(node.position) || !isVec3(node.rotation) || !isVec3(node.scale)) return false;
  if (node.type === "group") {
    return Array.isArray(node.childIds) && node.childIds.every((c) => typeof c === "string");
  }
  return (
    typeof node.kind === "string" &&
    node.kind in DEFAULT_PARAMS &&
    typeof node.params === "object" &&
    node.params !== null &&
    (node.role === "solid" || node.role === "hole") &&
    typeof node.color === "string"
  );
}

// The scene graph must be a forest: every node referenced at most once, no
// cycles, bounded nesting. Everything downstream (CSG evaluation, delete,
// duplicate) recurses over childIds and relies on this.
function validateGraph(project: Project) {
  const seen = new Set<string>();
  const visit = (id: string, depth: number) => {
    if (depth > MAX_GROUP_DEPTH) {
      throw new Error("Not a valid project file: groups nested too deeply.");
    }
    const node = project.nodes[id];
    if (!node) return;
    if (seen.has(id)) {
      throw new Error("Not a valid project file: node referenced more than once.");
    }
    seen.add(id);
    if (isGroup(node)) node.childIds.forEach((c) => visit(c, depth + 1));
  };
  project.rootOrder.forEach((id) => visit(id, 0));
}

export function parseProjectFile(text: string): Project {
  const data = JSON.parse(text) as Project;
  if (
    data?.version !== 1 ||
    typeof data.nodes !== "object" ||
    data.nodes === null ||
    !Array.isArray(data.rootOrder) ||
    !data.rootOrder.every((id) => typeof id === "string")
  ) {
    throw new Error("Not a valid project file.");
  }
  for (const [id, node] of Object.entries(data.nodes)) {
    if (!isValidNode(node) || node.id !== id) {
      throw new Error("Not a valid project file: malformed node.");
    }
  }
  // Drop dangling references rather than failing outright.
  data.rootOrder = data.rootOrder.filter((id) => id in data.nodes);
  for (const node of Object.values(data.nodes)) {
    if (isGroup(node)) node.childIds = node.childIds.filter((c) => c in data.nodes);
  }
  validateGraph(data);
  if (typeof data.name !== "string" || !data.name) data.name = "Untitled";
  return data;
}
