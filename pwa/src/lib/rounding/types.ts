import type * as THREE from "three";

// What each rounding builder needs to know about a shape, produced by
// roundingSpec() in primitives.ts from the same numbers the shape's own
// builder uses, so the rounded version and the pickable lines sit exactly on
// the geometry the user sees.

export type Pt = [number, number];
export type V3 = [number, number, number];

/** A box, centered on the origin: its own builder, edges 0-11. */
export interface BoxSpec {
  family: "box";
  size: V3;
}

/**
 * A solid turned about an axis: `profile` in (radius, height), lathed and
 * then moved by `post`. Open profiles start and end on the axis; closed ones
 * are a loop (a tube's wall, a revolved sketch). Edges are the profile's
 * corners off the axis, ids "c<index>".
 */
export interface LatheSpec {
  family: "lathe";
  profile: Pt[];
  closed: boolean;
  segments: number;
  post: THREE.Matrix4;
  /** A hemisphere's radius: its rim is a line meeting an arc, rounded exactly. */
  hemisphere?: number;
}

/**
 * A 2D outline pushed straight up from z0 to z1, then moved by `post`.
 * Edges: the upright edges at sharp corners ("s<contour>.<vertex>") and the
 * top and bottom rims ("t…"/"b…"), which run as one line around smooth
 * curves — a vertex turning less than `sharpAngle` is not a corner.
 */
export interface ExtrudeSpec {
  family: "extrude";
  contours: Pt[][];
  z0: number;
  z1: number;
  post: THREE.Matrix4;
  sharpAngle: number;
}

/** A convex polyhedron given by its corners and faces (CCW from outside). */
export interface ConvexSpec {
  family: "convex";
  vertices: V3[];
  faces: number[][];
  edges: { id: string; a: number; b: number }[];
  maxRadius: number;
}

export type RoundSpec = BoxSpec | LatheSpec | ExtrudeSpec | ConvexSpec;

/** A line the rounding tool can pick: segment endpoints, flat xyz pairs. */
export interface PickEdge {
  id: string;
  points: number[];
}
