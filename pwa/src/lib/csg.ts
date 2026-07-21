import * as THREE from "three";
import { Brush, Evaluator, ADDITION, SUBTRACTION } from "three-bvh-csg";
import type { GroupNode, Project, ShapeNode } from "../types/scene";
import { isGroup } from "../types/scene";
import { buildGeometry } from "./primitives";
import { composeMatrix } from "./transform";

const evaluator = new Evaluator();
evaluator.attributes = ["position", "normal"];

// Evaluates a group per the Tinkercad rule: union of solid children minus the
// union of hole children. Nested groups evaluate innermost-first and count as
// solid children. The result is in the group's local space (children keep
// their own transforms; the group's transform is applied at render/export).
// Returns null when the group has no solid contribution.
export function evaluateGroup(
  group: GroupNode,
  nodes: Project["nodes"],
): THREE.BufferGeometry | null {
  let solid: Brush | null = null;
  const holes: Brush[] = [];

  for (const childId of group.childIds) {
    const child = nodes[childId];
    if (!child) continue;

    let geo: THREE.BufferGeometry | null;
    let role: "solid" | "hole";
    if (isGroup(child)) {
      geo = evaluateGroup(child, nodes);
      role = "solid";
    } else {
      geo = buildGeometry(child);
      role = child.role;
    }
    if (!geo) continue;

    // Bake the child's full transform (including non-uniform scale) into the
    // geometry so the boolean runs on clean world-space meshes.
    const baked = geo
      .clone()
      .applyMatrix4(composeMatrix(child.position, child.rotation, child.scale));
    const brush = new Brush(baked);
    brush.updateMatrixWorld();

    if (role === "solid") {
      solid = solid ? evaluator.evaluate(solid, brush, ADDITION) : brush;
    } else {
      holes.push(brush);
    }
  }

  if (!solid) return null;
  for (const hole of holes) {
    solid = evaluator.evaluate(solid, hole, SUBTRACTION);
  }
  return solid.geometry;
}

// Signature of everything that affects a group's evaluated geometry. The
// group's own transform is deliberately excluded so moving a group never
// re-runs the boolean.
export function subtreeSignature(group: GroupNode, nodes: Project["nodes"]): string {
  const parts: string[] = [group.childIds.join(",")];
  const visit = (id: string) => {
    const n = nodes[id];
    if (!n) return;
    parts.push(JSON.stringify(n));
    if (isGroup(n)) n.childIds.forEach(visit);
  };
  group.childIds.forEach(visit);
  return parts.join("|");
}

export function firstSolidColor(group: GroupNode, nodes: Project["nodes"]): string {
  for (const childId of group.childIds) {
    const child = nodes[childId];
    if (!child) continue;
    if (isGroup(child)) {
      const c = firstSolidColor(child, nodes);
      if (c) return c;
    } else if ((child as ShapeNode).role === "solid") {
      return (child as ShapeNode).color;
    }
  }
  return "#b0b0b0";
}
