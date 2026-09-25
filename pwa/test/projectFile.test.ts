import { describe, expect, it, vi } from "vitest";

// The geometry engine is WebAssembly and irrelevant to validation.
vi.mock("../src/lib/manifold", () => ({
  manifoldLoaded: () => false,
  manifoldLib: () => null,
  manifoldReady: Promise.resolve(false),
  engineStatus: () => "failed",
  useEngineStatus: () => "failed",
  useManifoldLoaded: () => false,
  filletedBox: () => null,
  cutGroup: () => null,
  toManifold: () => null,
  fromManifold: () => null,
  weldCoincident: () => null,
  repairExtrusion: () => null,
  isClosedSolid: () => false,
  isFlatExtrusion: () => false,
  asClosedSolid: (g: unknown) => g,
}));

import { validateProject } from "../src/lib/projectFile";

const box = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "box",
  params: { w: 10, d: 10, h: 10, radius: 0 },
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  role: "solid",
  color: "#ff0000",
  ...extra,
});

const doc = (nodes: Record<string, unknown>, rootOrder: string[], extra: Record<string, unknown> = {}) => ({
  version: 1,
  name: "t",
  nodes,
  rootOrder,
  ...extra,
});

describe("validateProject", () => {
  it("refuses a kind that is only a prototype property", () => {
    expect(() => validateProject(doc({ a: box("a", { kind: "toString" }) }, ["a"]))).toThrow();
  });

  it("does not resolve a root through the prototype", () => {
    expect(validateProject(doc({}, ["constructor"])).rootOrder).toEqual([]);
  });

  it("drops nodes nothing refers to", () => {
    const p = validateProject(doc({ a: box("a"), b: box("b") }, ["a"]));
    expect(Object.keys(p.nodes)).toEqual(["a"]);
  });

  it("refuses a node referenced twice, and a cycle", () => {
    const g = { id: "g", type: "group", childIds: ["a"], position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
    expect(() => validateProject(doc({ g, a: box("a") }, ["g", "a"]))).toThrow(/more than once/);
    const loop = { ...g, childIds: ["g"] };
    expect(() => validateProject(doc({ g: loop }, ["g"]))).toThrow();
  });

  it("clamps counts and rejects non-numbers", () => {
    const p = validateProject(doc({ a: box("a", { kind: "sphere", params: { r: 10, segments: 1e9 } }) }, ["a"]));
    const sphere = p.nodes.a as { kind: string; params: Record<string, number | string> };
    expect(sphere.kind).toBe("sphere");
    expect(sphere.params.segments).toBe(256);
    expect(() => validateProject(doc({ a: box("a", { params: { w: NaN } }) }, ["a"]))).toThrow();
  });

  it("bounds the name and keeps the id", () => {
    const p = validateProject(doc({}, [], { name: "n".repeat(500), id: "keep-me" }));
    expect(p.name).toHaveLength(200);
    expect(p.id).toBe("keep-me");
  });

  it("copies only known fields", () => {
    const p = validateProject(doc({ a: box("a", { evil: { deep: true }, locked: "yes" }) }, ["a"]));
    expect("evil" in p.nodes.a).toBe(false);
    expect(p.nodes.a.locked).toBeUndefined();
  });
});
