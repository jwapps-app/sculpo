import * as THREE from "three";
import type { AlignMode, Axis } from "../state/store";

// One implementation of "where does everything go" for the align tool, used by
// the store when a dot is clicked and by the overlay to draw dots, grey out
// the ones that would do nothing, and preview the result on hover.

export interface AlignItem {
  id: string;
  box: THREE.Box3;
}

export interface AlignMove {
  id: string;
  shift: number;
}

export interface AlignPlan {
  /** The coordinate every moving shape's edge or center lands on. */
  target: number;
  /** Shapes that move, and by how much along the axis. Anchors never appear. */
  moves: AlignMove[];
  /** True if any shape would actually move by a visible amount. */
  changes: boolean;
}

// Below this a move is float noise, not an alignment worth offering.
const NEGLIGIBLE_MM = 0.05;

export function boundsValue(box: THREE.Box3, axis: Axis, mode: AlignMode): number {
  const min = box.min.getComponent(axis);
  const max = box.max.getComponent(axis);
  return mode === "min" ? min : mode === "max" ? max : (min + max) / 2;
}

/**
 * Plans an alignment. With anchors, their combined bounds are the reference:
 * anchors stay put and everything else lines up with them — Tinkercad's "key
 * object", extended to several so a pair can be the reference without being
 * grouped. Without anchors, the whole selection's bounds are the reference, so
 * the result lands exactly where the dot is drawn.
 *
 * Returns null when there is nothing to align: fewer than two shapes, or every
 * shape an anchor.
 */
export function planAlign(
  items: AlignItem[],
  anchorIds: readonly string[],
  axis: Axis,
  mode: AlignMode,
): AlignPlan | null {
  if (items.length < 2) return null;
  const anchors = items.filter((x) => anchorIds.includes(x.id));
  const movers = anchors.length ? items.filter((x) => !anchorIds.includes(x.id)) : items;
  if (movers.length === 0) return null;

  const reference = new THREE.Box3();
  for (const { box } of anchors.length ? anchors : items) reference.union(box);
  const target = boundsValue(reference, axis, mode);

  const moves = movers.map(({ id, box }) => ({ id, shift: target - boundsValue(box, axis, mode) }));
  return { target, moves, changes: moves.some((m) => Math.abs(m.shift) > NEGLIGIBLE_MM) };
}
