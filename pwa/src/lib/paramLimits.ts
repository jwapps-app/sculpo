// Bounds on shape parameters, applied wherever a value comes in: a project
// file, a cloud load, the inspector, and the builders themselves. Without
// them a tessellation count of a billion is accepted as valid and then
// allocated — on the UI thread — when the shape is drawn.

/** Longest any length parameter can be, in mm: a metre, well past any bed. */
export const MAX_LENGTH_MM = 1_000;

/** Longest a text shape's string can be. */
export const MAX_TEXT_CHARS = 200;

// Counts: [min, max]. Anything not listed is a length or a switch.
export const COUNT_LIMITS: Record<string, [number, number]> = {
  segments: [3, 256],
  sides: [3, 64],
  points: [3, 64],
  teeth: [6, 200],
};

// Keys whose value is not a length and not a count.
const SWITCHES = new Set(["internal"]);
// Keys that hold encoded data, not numbers.
export const DATA_PARAMS = new Set(["pos", "idx", "profile", "paths", "edges", "name", "value", "font"]);

/** A numeric parameter clamped into its allowed range. */
export function clampParam(key: string, value: number): number {
  if (!Number.isFinite(value)) return 0;
  const count = COUNT_LIMITS[key];
  if (count) return Math.min(count[1], Math.max(count[0], Math.round(value)));
  if (SWITCHES.has(key)) return value > 0.5 ? 1 : 0;
  return Math.min(MAX_LENGTH_MM, Math.max(-MAX_LENGTH_MM, value));
}
