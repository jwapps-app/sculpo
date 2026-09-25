import type { GroupNode, Project, SceneNode, ShapeNode, Vec3 } from "../types/scene";
import { isGroup } from "../types/scene";
import { DEFAULT_PARAMS } from "./primitives";
import { downloadBlob, safeFilename } from "./download";
import { clampParam, DATA_PARAMS, MAX_TEXT_CHARS } from "./paramLimits";
import { newId } from "./id";

export function saveProjectFile(project: Project) {
  downloadBlob(
    new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }),
    `${safeFilename(project.name)}.json`,
  );
}

const MAX_GROUP_DEPTH = 64;
export const MAX_NAME_CHARS = 200; // the server's ceiling for a project name
// Encoded mesh data and sketch outlines can be long; nothing else should be.
const MAX_PLAIN_STRING = 10_000;

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
}

function isHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

/**
 * A shape's params, checked and copied. Numbers are clamped into range,
 * strings bounded, anything else dropped. Returns null when a value cannot
 * be made sense of.
 */
function cleanParams(kind: string, raw: unknown): Record<string, number | string> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const out: Record<string, number | string> = {};
  for (const key of Object.keys(raw)) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return null;
      out[key] = DATA_PARAMS.has(key) ? v : clampParam(key, v);
    } else if (typeof v === "string") {
      const cap = key === "value" ? MAX_TEXT_CHARS : DATA_PARAMS.has(key) ? Infinity : MAX_PLAIN_STRING;
      out[key] = v.length > cap ? v.slice(0, cap) : v;
    }
    // Anything else (objects, booleans, null) is not a parameter; dropped.
  }
  // Encoded mesh data must at least be base64 of whole 32-bit words.
  if (kind === "mesh") {
    for (const key of ["pos", "idx"]) {
      const v = out[key];
      if (v !== undefined && (typeof v !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(v) || v.length % 4 !== 0)) {
        return null;
      }
    }
  }
  return out;
}

function cleanNode(id: string, n: unknown): SceneNode | null {
  if (typeof n !== "object" || n === null) return null;
  const node = n as Record<string, unknown>;
  if (node.id !== id) return null;
  if (!isVec3(node.position) || !isVec3(node.rotation) || !isVec3(node.scale)) return null;
  const common = {
    id,
    position: [...node.position] as Vec3,
    rotation: [...node.rotation] as Vec3,
    scale: [...node.scale] as Vec3,
    ...(node.locked === true ? { locked: true } : {}),
    ...(node.hidden === true ? { hidden: true } : {}),
    ...(node.transparent === true ? { transparent: true } : {}),
  };
  if (node.type === "group") {
    if (!Array.isArray(node.childIds) || !node.childIds.every((c) => typeof c === "string")) return null;
    const group: GroupNode = {
      ...common,
      type: "group",
      childIds: [...(node.childIds as string[])],
      ...(isHexColor(node.color) ? { color: node.color } : {}),
    };
    return group;
  }
  if (typeof node.kind !== "string" || !has(DEFAULT_PARAMS, node.kind)) return null;
  const params = cleanParams(node.kind, node.params);
  if (!params) return null;
  if (node.role !== "solid" && node.role !== "hole") return null;
  const shape: ShapeNode = {
    ...common,
    kind: node.kind as ShapeNode["kind"],
    params,
    role: node.role,
    color: isHexColor(node.color) ? node.color : "#b0b0b0",
  };
  return shape;
}

/**
 * Checks a decoded project document — from a file, the cloud, or the
 * browser's own store — and returns a clean copy: own properties only, so a
 * key like "constructor" cannot smuggle in a prototype's value; every node
 * of a known kind with bounded parameters; a forest (each node reachable
 * once, from a root or a group, no cycles, bounded depth). Nodes nothing
 * refers to are dropped rather than failing the whole project.
 */
export function validateProject(data: unknown): Project {
  if (typeof data !== "object" || data === null) throw new Error("Not a valid project file.");
  const doc = data as Record<string, unknown>;
  if (
    doc.version !== 1 ||
    typeof doc.nodes !== "object" ||
    doc.nodes === null ||
    !Array.isArray(doc.rootOrder) ||
    !doc.rootOrder.every((id) => typeof id === "string")
  ) {
    throw new Error("Not a valid project file.");
  }
  const rawNodes = doc.nodes as Record<string, unknown>;
  const nodes: Record<string, SceneNode> = {};
  for (const id of Object.keys(rawNodes)) {
    const node = cleanNode(id, rawNodes[id]);
    if (!node) throw new Error("Not a valid project file: malformed node.");
    nodes[id] = node;
  }
  // Drop dangling references rather than failing outright.
  const rootOrder = (doc.rootOrder as string[]).filter((id) => has(nodes, id));
  for (const node of Object.values(nodes)) {
    if (isGroup(node)) node.childIds = node.childIds.filter((c) => has(nodes, c));
  }
  // The scene graph must be a forest: every node referenced at most once, no
  // cycles, bounded nesting. Everything downstream (CSG evaluation, delete,
  // duplicate) recurses over childIds and relies on this.
  const seen = new Set<string>();
  const visit = (id: string, depth: number) => {
    if (depth > MAX_GROUP_DEPTH) {
      throw new Error("Not a valid project file: groups nested too deeply.");
    }
    if (seen.has(id)) {
      throw new Error("Not a valid project file: node referenced more than once.");
    }
    seen.add(id);
    const node = nodes[id];
    if (isGroup(node)) node.childIds.forEach((c) => visit(c, depth + 1));
  };
  rootOrder.forEach((id) => visit(id, 0));
  // Orphans — nodes neither a root nor inside a reachable group — are
  // unreachable in every sense, and an orphaned cycle would otherwise
  // escape the check above.
  for (const id of Object.keys(nodes)) if (!seen.has(id)) delete nodes[id];

  const name =
    typeof doc.name === "string" && doc.name.trim() ? doc.name.trim().slice(0, MAX_NAME_CHARS) : "Untitled";
  const id = typeof doc.id === "string" && doc.id ? doc.id.slice(0, 64) : newId();
  return { id, version: 1, name, nodes, rootOrder };
}

export function parseProjectFile(text: string): Project {
  return validateProject(JSON.parse(text));
}
