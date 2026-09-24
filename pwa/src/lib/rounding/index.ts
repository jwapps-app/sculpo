import type * as THREE from "three";
import type { PickEdge, RoundSpec } from "./types";
import type { Picks } from "./picks";
import { BOX_EDGES, edgeEndpoints, maxFilletRadius } from "../boxEdges";
import { filletedBox } from "../manifold";
import { buildLathe, latheEdges } from "./lathe";
import { buildExtrusion, extrudeEdges } from "./extrude";
import { buildConvex, convexEdges } from "./convex";

export * from "./types";
export * from "./picks";

/**
 * The shape with the picked edges rounded, or null when that needs the
 * boolean engine and it has not loaded yet (the caller shows the plain
 * shape and rebuilds once it arrives).
 */
export function roundedGeometry(spec: RoundSpec, picks: Picks): THREE.BufferGeometry | null {
  switch (spec.family) {
    case "box": {
      const max = maxFilletRadius(...spec.size);
      const rounded = [...picks]
        .map(([id, r]) => ({ id: Number(id), r: Math.min(r, max) }))
        .filter((e) => Number.isInteger(e.id) && e.id >= 0 && e.id < 12);
      return filletedBox(spec.size, rounded);
    }
    case "lathe":
      return buildLathe(spec, picks);
    case "extrude":
      return buildExtrusion(spec, picks);
    case "convex":
      return buildConvex(spec, picks);
  }
}

/** Every line on the shape the rounding tool can pick, in the shape's frame. */
export function pickEdges(spec: RoundSpec): PickEdge[] {
  switch (spec.family) {
    case "box":
      return BOX_EDGES.map((e) => {
        const [a, b] = edgeEndpoints(e, spec.size);
        return { id: String(e.id), points: [...a, ...b] };
      });
    case "lathe":
      return latheEdges(spec);
    case "extrude":
      return extrudeEdges(spec);
    case "convex":
      return convexEdges(spec);
  }
}
