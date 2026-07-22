// Everything internal (scene graph, STL, snapping) is millimeters; imperial
// is purely a display/input conversion.
export type Units = "mm" | "in";

export const MM_PER_INCH = 25.4;

export function toDisplay(mm: number, units: Units): number {
  return units === "mm" ? mm : mm / MM_PER_INCH;
}

export function fromDisplay(value: number, units: Units): number {
  return units === "mm" ? value : value * MM_PER_INCH;
}

export function formatLength(mm: number, units: Units): string {
  return units === "mm"
    ? `${Math.round(mm * 10) / 10}`
    : `${Math.round((mm / MM_PER_INCH) * 1000) / 1000}`;
}

// Snap-step choices per unit system (values are always mm).
export const SNAP_STEPS: Record<Units, { value: number; label: string }[]> = {
  mm: [0.1, 0.25, 0.5, 1, 2, 5].map((v) => ({ value: v, label: `${v}` })),
  in: [
    { value: MM_PER_INCH / 32, label: "1/32" },
    { value: MM_PER_INCH / 16, label: "1/16" },
    { value: MM_PER_INCH / 8, label: "1/8" },
    { value: MM_PER_INCH / 4, label: "1/4" },
    { value: MM_PER_INCH / 2, label: "1/2" },
    { value: MM_PER_INCH, label: "1" },
  ],
};

export const DEFAULT_STEP: Record<Units, number> = {
  mm: 1,
  in: MM_PER_INCH / 16,
};

// Param keys that are counts, not lengths — never converted.
export const COUNT_PARAMS = new Set(["segments", "sides", "points"]);
