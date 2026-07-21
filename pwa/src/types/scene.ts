export type Vec3 = [number, number, number];

export type PrimitiveKind =
  | "box"
  | "cylinder"
  | "sphere"
  | "cone"
  | "torus"
  | "text";

export interface ShapeNode {
  id: string;
  kind: PrimitiveKind;
  params: Record<string, number | string>;
  position: Vec3;
  rotation: Vec3; // Euler XYZ, radians
  scale: Vec3;
  role: "solid" | "hole";
  color: string; // hex, display only
}

export interface GroupNode {
  id: string;
  type: "group";
  childIds: string[];
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
    id: crypto.randomUUID(),
    name: "Untitled",
    version: 1,
    nodes: {},
    rootOrder: [],
  };
}
