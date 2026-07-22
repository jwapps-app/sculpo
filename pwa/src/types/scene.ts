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
}

export type SceneNode = ShapeNode | GroupNode;

export function isGroup(node: SceneNode): node is GroupNode {
  return (node as GroupNode).type === "group";
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
