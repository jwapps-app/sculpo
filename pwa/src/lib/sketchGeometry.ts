import * as THREE from "three";
import { contours } from "d3-contour";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

// Geometry builders for the sketch tools. Profiles and strokes live in node
// params as JSON strings (mm coordinates), so these shapes regenerate from the
// scene graph like every other primitive.

export type Pt = [number, number];

export function parsePoints(value: number | string | undefined): Pt[] {
  if (typeof value !== "string") return [];
  try {
    const v = JSON.parse(value);
    return Array.isArray(v) ? (v as Pt[]) : [];
  } catch {
    return [];
  }
}

export function parsePaths(value: number | string | undefined): Pt[][] {
  if (typeof value !== "string") return [];
  try {
    const v = JSON.parse(value);
    return Array.isArray(v) ? (v as Pt[][]) : [];
  } catch {
    return [];
  }
}

export function extrudeSketchGeometry(points: Pt[], depth: number): THREE.BufferGeometry | null {
  if (points.length < 3) return null;
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 });
  geo.center();
  return geo;
}

export function revolveSketchGeometry(
  points: Pt[],
  segments: number,
): THREE.BufferGeometry | null {
  if (points.length < 3) return null;
  // Closed CCW loop, radii clamped non-negative, lathed about Z.
  const pts = points.map(([x, y]) => [Math.max(0, x), y] as Pt);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    area += x1 * y2 - x2 * y1;
  }
  const loop = area < 0 ? [...pts].reverse() : [...pts];
  loop.push(loop[0]);
  const lathe = new THREE.LatheGeometry(
    loop.map(([x, y]) => new THREE.Vector2(x, y)),
    Math.min(128, Math.max(8, Math.round(segments))),
  );
  const geo = mergeVertices(lathe, 1e-4);
  geo.computeVertexNormals();
  geo.rotateX(Math.PI / 2);
  geo.center();
  return geo;
}

export function scribbleGeometry(
  paths: Pt[][],
  brush: number,
  depth: number,
): THREE.BufferGeometry | null {
  const flat = paths.flat();
  if (flat.length === 0) return null;
  const r = Math.max(0.5, brush) / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of flat) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  minX -= r + 1;
  minY -= r + 1;
  maxX += r + 1;
  maxY += r + 1;
  const w = maxX - minX;
  const h = maxY - minY;
  // Rasterize the strokes, then trace the ink outline back into polygons.
  const scale = Math.min(3, 600 / Math.max(w, h));
  const cw = Math.max(8, Math.ceil(w * scale));
  const ch = Math.max(8, Math.ceil(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = brush * scale;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const path of paths) {
    if (path.length === 0) continue;
    if (path.length === 1) {
      const [x, y] = path[0];
      ctx.beginPath();
      ctx.arc((x - minX) * scale, (maxY - y) * scale, Math.max(1, r * scale), 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    path.forEach(([x, y], i) => {
      const px = (x - minX) * scale;
      const py = (maxY - y) * scale;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }
  const img = ctx.getImageData(0, 0, cw, ch).data;
  const values: number[] = new Array(cw * ch);
  for (let i = 0; i < cw * ch; i++) values[i] = img[i * 4 + 3] / 255;
  const bands = contours().size([cw, ch]).thresholds([0.5])(values);
  const multi = bands[0];
  if (!multi || multi.coordinates.length === 0) return null;
  const toWorld = (p: number[]) => new THREE.Vector2(minX + p[0] / scale, maxY - p[1] / scale);
  const shapes: THREE.Shape[] = [];
  for (const polygon of multi.coordinates) {
    const [outer, ...holes] = polygon;
    if (!outer || outer.length < 3) continue;
    const shape = new THREE.Shape(outer.map(toWorld));
    for (const ring of holes) {
      if (ring.length >= 3) shape.holes.push(new THREE.Path(ring.map(toWorld)));
    }
    shapes.push(shape);
  }
  if (shapes.length === 0) return null;
  const geo = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 4 });
  geo.center();
  return geo;
}
