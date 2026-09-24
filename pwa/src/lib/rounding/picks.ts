import type { PrimitiveKind } from "../../types/scene";

// Which edges of a shape are rounded, and how much. Stored in the shape's
// `edges` param as "id@radius" tokens, so each edge keeps its own radius.
//
// Two older forms still load. Boxes saved before per-edge rounding carry a
// `radius` that applies to every edge; cylinders carry a `bevel` for both
// rims. A token without "@radius" (boxes from before radii were per edge)
// takes that same shared value.

export type Picks = Map<string, number>;

export type RoundFamily = "box" | "lathe" | "extrude" | "convex";

const FAMILY: Partial<Record<PrimitiveKind, RoundFamily>> = {
  box: "box",
  cylinder: "lathe",
  cone: "lathe",
  hemisphere: "lathe",
  tube: "lathe",
  revolve: "lathe",
  polygon: "extrude",
  octagon: "extrude",
  star: "extrude",
  wedge: "extrude",
  roof: "extrude",
  sketch: "extrude",
  gear: "extrude",
  text: "extrude",
  scribble: "extrude",
  pyramid: "convex",
};

/** How a kind of shape is rounded, or null if it has no edges that can be. */
export function roundFamily(kind: PrimitiveKind): RoundFamily | null {
  return FAMILY[kind] ?? null;
}

const LEGACY_KEY: Partial<Record<PrimitiveKind, string>> = { box: "radius", cylinder: "bevel" };

function legacyRadius(kind: PrimitiveKind, params: Record<string, number | string>): number {
  const key = LEGACY_KEY[kind];
  const v = key ? params[key] : undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** True while a shape still uses its pre-per-edge rounding (no `edges`). */
export function isLegacyRounding(kind: PrimitiveKind, params: Record<string, number | string>): boolean {
  return typeof params.edges !== "string" && legacyRadius(kind, params) > 0.01;
}

export function parsePicks(kind: PrimitiveKind, params: Record<string, number | string>): Picks {
  const out: Picks = new Map();
  const shared = legacyRadius(kind, params);
  const raw = params.edges;
  if (typeof raw !== "string") {
    if (shared > 0.01) {
      if (kind === "box") for (let i = 0; i < 12; i++) out.set(String(i), shared);
      if (kind === "cylinder") {
        out.set("c1", shared);
        out.set("c2", shared);
      }
    }
    return out;
  }
  for (const token of raw.split(",")) {
    const t = token.trim();
    if (!t) continue;
    const at = t.indexOf("@");
    const id = at < 0 ? t : t.slice(0, at);
    const r = at < 0 ? shared : Number(t.slice(at + 1));
    if (id && Number.isFinite(r) && r > 0.01) out.set(id, r);
  }
  return out;
}

export function formatPicks(picks: Picks): string {
  return [...picks]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([id, r]) => `${id}@${Number(r.toFixed(4))}`)
    .join(",");
}
