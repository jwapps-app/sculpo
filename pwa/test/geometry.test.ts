import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { bakeTransform, isDecomposable, worldNormal } from "../src/lib/transform";
import { decodeMeshGeometry, encodeMeshParams } from "../src/lib/meshData";
import { filletArc } from "../src/lib/rounding/fillet2d";
import { formatPicks, parsePicks, parseSinks } from "../src/lib/rounding/picks";
import { flaredProfile, rimEdges, RIM_BOTTOM, RIM_TOP, type RimSpec } from "../src/lib/rounding/rims";
import { planAlign } from "../src/lib/align";
import { clampParam } from "../src/lib/paramLimits";

function signedVolume(geo: THREE.BufferGeometry): number {
  const p = geo.getAttribute("position");
  const idx = geo.index ? Array.from(geo.index.array) : [...Array(p.count).keys()];
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p, idx[t]);
    const b = new THREE.Vector3().fromBufferAttribute(p, idx[t + 1]);
    const c = new THREE.Vector3().fromBufferAttribute(p, idx[t + 2]);
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return v;
}

describe("transforms", () => {
  it("keeps a mirrored solid facing outward", () => {
    const cube = new THREE.BoxGeometry(20, 20, 20);
    const mirrored = bakeTransform(cube, new THREE.Matrix4().makeScale(-1, 1, 1));
    expect(Math.round(signedVolume(mirrored))).toBe(8000);
  });

  it("transforms a normal by the normal matrix", () => {
    const n = worldNormal(new THREE.Vector3(1, 1, 0).normalize(), new THREE.Matrix4().makeScale(2, 1, 1));
    expect(n.x).toBeCloseTo(0.447, 3);
    expect(n.y).toBeCloseTo(0.894, 3);
  });

  it("knows when a matrix holds shear", () => {
    const parent = new THREE.Matrix4().makeScale(2, 1, 1);
    const child = new THREE.Matrix4().makeRotationZ(Math.PI / 4);
    expect(isDecomposable(parent.clone().multiply(child))).toBe(false);
    expect(isDecomposable(new THREE.Matrix4().makeScale(2, 1, 1).multiply(new THREE.Matrix4().makeTranslation(1, 2, 3)))).toBe(true);
  });
});

describe("mesh data", () => {
  const b64 = (buf: ArrayBufferLike) => btoa(String.fromCharCode(...new Uint8Array(buf)));

  it("round-trips a mesh", () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const back = decodeMeshGeometry(encodeMeshParams(geo));
    expect(back?.index?.count).toBe(geo.index?.count);
  });

  it("refuses an index past the vertices and a coordinate that is not a number", () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const good = encodeMeshParams(geo);
    const idx = new Uint32Array(geo.index!.array);
    idx[0] = 99999;
    expect(decodeMeshGeometry({ ...good, idx: b64(idx.buffer) })).toBeNull();
    const pos = new Float32Array(geo.getAttribute("position").array);
    pos[3] = NaN;
    expect(decodeMeshGeometry({ ...good, pos: b64(pos.buffer) })).toBeNull();
    expect(decodeMeshGeometry({ ...good, idx: b64(new Uint32Array([0, 1]).buffer) })).toBeNull();
  });
});

describe("rounding", () => {
  it("rounds a corner with an arc tangent to both edges", () => {
    const arc = filletArc([0, 10], [0, 0], [10, 0], 2)!;
    expect(arc.radius).toBeCloseTo(2);
    expect(arc.center[0]).toBeCloseTo(2);
    expect(arc.center[1]).toBeCloseTo(2);
    expect(arc.points[0][0]).toBeCloseTo(0);
    expect(arc.points[0][1]).toBeCloseTo(2);
    expect(arc.points[arc.points.length - 1][0]).toBeCloseTo(2);
    expect(arc.points[arc.points.length - 1][1]).toBeCloseTo(0);
  });

  it("limits a radius to the shorter edge", () => {
    const arc = filletArc([0, 1], [0, 0], [10, 0], 5)!;
    expect(arc.radius).toBeLessThanOrEqual(0.49);
  });

  it("reads old all-edge rounding and its own per-edge form", () => {
    expect(parsePicks("box", { radius: 3 }).size).toBe(12);
    expect(parsePicks("cylinder", { bevel: 1 }).size).toBe(2);
    const picks = parsePicks("box", { radius: 3, edges: "3@2,9" });
    expect(picks.get("3")).toBe(2);
    expect(picks.get("9")).toBe(3);
    expect(parsePicks("box", { edges: "" }).size).toBe(0);
    expect(formatPicks(new Map([["10", 1.5], ["2", 1]]))).toBe("2@1,10@1.5");
  });

  it("keeps a countersunk rim's angle beside its size", () => {
    const params = { edges: "c1@1,xt@8v90" };
    expect(parsePicks("cylinder", params).get("xt")).toBe(8);
    expect(parseSinks(params)).toEqual(new Map([["xt", 90]]));
    expect(formatPicks(parsePicks("cylinder", params), parseSinks(params))).toBe("c1@1,xt@8v90");
  });
});

describe("hole rims", () => {
  const identity = Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0));
  const hole = (t: Partial<RimSpec>): RimSpec => ({ frame: identity, r: 2, z0: -10, z1: 10, segments: 12, ...t });

  it("does nothing to a hole with no treated rim, or none found", () => {
    expect(flaredProfile(hole({}), { top: 5, bottom: -5 })).toBeNull();
    expect(flaredProfile(hole({ top: { size: 8, angle: 90 } }), { top: null, bottom: -5 })).toBeNull();
  });

  it("cuts a 90° countersink as deep as it is wide", () => {
    const p = flaredProfile(hole({ top: { size: 8, angle: 90 } }), { top: 5, bottom: -5 })!;
    // Wall up to the flare, the cone out to the surface, the wider bore on
    // to the hole's own top, then the axis.
    const expected = [[0, -10], [2, -10], [2, 3], [4, 5], [4, 10], [0, 10]];
    expect(p.length).toBe(expected.length);
    p.forEach(([rho, z], i) => {
      expect(rho).toBeCloseTo(expected[i][0]);
      expect(z).toBeCloseTo(expected[i][1]);
    });
  });

  it("carries a flush end past the face so the flare cuts through", () => {
    const p = flaredProfile(hole({ bottom: { size: 6, angle: 90 } }), { top: null, bottom: -10 })!;
    expect(p[0][1]).toBeLessThan(-10);
    expect(p[1]).toEqual([3, p[0][1]]);
    expect(p[p.length - 1]).toEqual([0, 10]);
  });

  it("rounds a rim over with a quarter circle tangent to wall and face", () => {
    const p = flaredProfile(hole({ top: { size: 1 } }), { top: 5, bottom: null })!;
    const arc = p.slice(2, 11);
    expect(arc[0]).toEqual([2, 4]);
    expect(arc[arc.length - 1]).toEqual([3, 5]);
    for (const [rho, z] of arc) {
      expect(Math.hypot(rho - 3, z - 4)).toBeCloseTo(1);
      // On the corner's side of the centre: outside the wall, below the face.
      expect(rho).toBeGreaterThanOrEqual(2);
      expect(rho).toBeLessThanOrEqual(3);
      expect(z).toBeGreaterThanOrEqual(4);
      expect(z).toBeLessThanOrEqual(5);
    }
    // The material a quarter-round removes: the corner square less the
    // quarter disc, swept round the hole.
    const [mr, mz] = arc[4];
    expect(Math.hypot(mr - 2, mz - 5)).toBeLessThan(1);
  });

  it("offers a line at each found rim, on the flare's outer edge once treated", () => {
    const plain = rimEdges(hole({}), { top: 5, bottom: -5 });
    expect(plain.map((e) => e.id)).toEqual([RIM_TOP, RIM_BOTTOM]);
    expect(plain[0].points.slice(0, 3)).toEqual([2, 0, 5]);
    const sunk = rimEdges(hole({ top: { size: 8, angle: 90 } }), { top: 5, bottom: null });
    expect(sunk.map((e) => e.id)).toEqual([RIM_TOP]);
    expect(sunk[0].points.slice(0, 3)).toEqual([4, 0, 5]);
  });
});

describe("align", () => {
  const item = (id: string, x0: number, x1: number) => ({ id, box: new THREE.Box3(new THREE.Vector3(x0, 0, 0), new THREE.Vector3(x1, 1, 1)) });

  it("lines everything up with the anchors and leaves the anchors still", () => {
    const plan = planAlign([item("a", 0, 10), item("b", 20, 24), item("c", 50, 60)], ["a", "b"], 0, "center")!;
    expect(plan.moves.map((m) => m.id)).toEqual(["c"]);
    expect(plan.moves[0].shift).toBeCloseTo(12 - 55);
  });

  it("centres on the whole selection when nothing is anchored", () => {
    const plan = planAlign([item("a", 0, 10), item("b", 20, 40)], [], 0, "center")!;
    expect(plan.target).toBe(20);
  });
});

describe("limits", () => {
  it("clamps counts, switches and lengths", () => {
    expect(clampParam("segments", 1e9)).toBe(256);
    expect(clampParam("internal", 7)).toBe(1);
    expect(clampParam("w", 1e9)).toBe(1000);
    expect(clampParam("h", NaN)).toBe(0);
  });
});
