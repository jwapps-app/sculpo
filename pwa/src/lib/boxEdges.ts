// The twelve edges of a box, numbered once and shared by everything that
// rounds them: the geometry builder, the click-to-round overlay, and the
// inspector. A box is centered on its origin, w along x, d along y, h along z.
//
// Edge id = axis * 4 + (first other axis on its + side ? 1 : 0)
//                    + (second other axis on its + side ? 2 : 0),
// with the other two axes taken in x < y < z order. So ids 0-3 run along x,
// 4-7 along y, 8-11 along z. The ids are stored in project files; never
// renumber them.

export type BoxAxis = 0 | 1 | 2;

export interface BoxEdge {
  id: number;
  /** The axis the edge runs along. */
  axis: BoxAxis;
  /** The two perpendicular axes, ascending. */
  others: [BoxAxis, BoxAxis];
  /** Which side of each perpendicular axis the edge sits on: +1 or -1. */
  signs: [1 | -1, 1 | -1];
}

const OTHERS: Record<BoxAxis, [BoxAxis, BoxAxis]> = { 0: [1, 2], 1: [0, 2], 2: [0, 1] };

export const BOX_EDGES: BoxEdge[] = ([0, 1, 2] as BoxAxis[]).flatMap((axis) =>
  [0, 1, 2, 3].map((k) => ({
    id: axis * 4 + k,
    axis,
    others: OTHERS[axis],
    signs: [k & 1 ? 1 : -1, k & 2 ? 1 : -1] as [1 | -1, 1 | -1],
  })),
);

export const ALL_BOX_EDGES: number[] = BOX_EDGES.map((e) => e.id);

/** Where the edge sits on one perpendicular axis: +1, -1, or 0 for its own axis. */
export function edgeSign(edge: BoxEdge, axis: BoxAxis): number {
  if (axis === edge.axis) return 0;
  return edge.others[0] === axis ? edge.signs[0] : edge.signs[1];
}

/** The id of the edge along `axis` at the given corner (signs per x, y, z). */
export function edgeAtCorner(axis: BoxAxis, corner: [number, number, number]): number {
  const [b, c] = OTHERS[axis];
  return axis * 4 + (corner[b] > 0 ? 1 : 0) + (corner[c] > 0 ? 2 : 0);
}

/** Corners (signs per x, y, z) where all three meeting edges are rounded. */
export function fullyRoundedCorners(edges: readonly number[]): [number, number, number][] {
  const set = new Set(edges);
  const out: [number, number, number][] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const corner: [number, number, number] = [sx, sy, sz];
        if (([0, 1, 2] as BoxAxis[]).every((a) => set.has(edgeAtCorner(a, corner)))) {
          out.push(corner);
        }
      }
  return out;
}

/** Endpoints of an edge in the box's local frame. */
export function edgeEndpoints(
  edge: BoxEdge,
  size: [number, number, number],
): [[number, number, number], [number, number, number]] {
  const a: [number, number, number] = [0, 0, 0];
  const b: [number, number, number] = [0, 0, 0];
  for (const axis of [0, 1, 2] as BoxAxis[]) {
    const half = size[axis] / 2;
    if (axis === edge.axis) {
      a[axis] = -half;
      b[axis] = half;
    } else {
      a[axis] = b[axis] = edgeSign(edge, axis) * half;
    }
  }
  return [a, b];
}

/**
 * Reads the `edges` param: null when absent, which means the box predates
 * per-edge rounding and its radius applies to every edge. An empty string
 * means no edge is rounded.
 */
export function parseEdges(value: unknown): number[] | null {
  if (typeof value !== "string") return null;
  // Number("") is 0, so blanks must go before the conversion or an empty
  // list would read as edge 0.
  const ids = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n < 12);
  return [...new Set(ids)].sort((x, y) => x - y);
}

export function formatEdges(ids: readonly number[]): string {
  return [...new Set(ids)].sort((x, y) => x - y).join(",");
}

/** The edges a box's radius currently applies to. */
export function roundedEdges(params: Record<string, number | string>): number[] {
  const radius = typeof params.radius === "number" ? params.radius : 0;
  const explicit = parseEdges(params.edges);
  if (explicit) return explicit;
  return radius > 0.01 ? ALL_BOX_EDGES : [];
}

/** Largest radius a box of this size can take without faces vanishing. */
export function maxFilletRadius(w: number, d: number, h: number): number {
  return Math.max(0, Math.min(w, d, h) / 2 - 0.01);
}

/** Radius given to the first edge picked on a box that had none. */
export const DEFAULT_FILLET_RADIUS = 2;
