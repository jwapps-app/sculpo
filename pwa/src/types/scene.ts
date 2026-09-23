import { newId } from "../lib/id";

export type Vec3 = [number, number, number];

export type PrimitiveKind =
  | "box"
  | "cylinder"
  | "sphere"
  | "cone"
  | "torus"
  | "text"
  | "wedge"
  | "roof"
  | "pyramid"
  | "hemisphere"
  | "polygon"
  | "tube"
  | "star"
  | "octagon"
  | "thread" // parametric screw thread
  | "gear" // involute spur gear
  | "sketch" // 2D profile extruded; profile stored in params
  | "revolve" // 2D profile lathed around the Z axis
  | "scribble" // freehand strokes, traced and extruded
  | "mesh"; // imported STL/OBJ/SVG geometry, stored in params

export interface ShapeNode {
  id: string;
  kind: PrimitiveKind;
  params: Record<string, number | string>;
  position: Vec3;
  rotation: Vec3; // Euler XYZ, radians
  scale: Vec3;
  role: "solid" | "hole";
  color: string; // hex, display only
  locked?: boolean;
  hidden?: boolean;
  transparent?: boolean; // see-through for checking internal fits
}

export interface GroupNode {
  id: string;
  type: "group";
  childIds: string[];
  // Identity at creation (children keep their own transforms); lets the
  // evaluated solid be moved as one object afterwards.
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  locked?: boolean;
  hidden?: boolean;
  transparent?: boolean;
  // Display color for the evaluated solid; unset = inherit the first solid
  // child's color (Tinkercad's default grouping behavior).
  color?: string;
}

export type SceneNode = ShapeNode | GroupNode;

export function isGroup(node: SceneNode): node is GroupNode {
  return (node as GroupNode).type === "group";
}

/** True if any shape inside this node, however deeply nested, is a solid. */
export function hasSolidContent(id: string, nodes: Project["nodes"]): boolean {
  const node = nodes[id];
  if (!node) return false;
  if (isGroup(node)) return node.childIds.some((c) => hasSolidContent(c, nodes));
  return node.role === "solid";
}

/**
 * Whether a node cuts or adds. A shape says so itself; a group is a hole when
 * nothing inside it is solid — Tinkercad's rule, so holes can be grouped into
 * one compound hole and then used to cut as a single piece.
 */
export function nodeRole(node: SceneNode, nodes: Project["nodes"]): "solid" | "hole" {
  if (!isGroup(node)) return node.role;
  return hasSolidContent(node.id, nodes) ? "solid" : "hole";
}

export interface Project {
  id: string;
  name: string;
  version: 1;
  nodes: Record<string, SceneNode>;
  rootOrder: string[];
}

export function emptyProject(): Project {
  return {
    id: newId(),
    name: "Untitled",
    version: 1,
    nodes: {},
    rootOrder: [],
  };
}
