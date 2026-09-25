import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { MeshoptSimplifier } from "meshoptimizer";
import { flipWinding } from "./transform";
import { encodeMeshParams } from "./meshData";

export interface ImportedMesh {
  params: Record<string, string>;
  name: string;
  triangles: number;
  // Set when the mesh was decimated on import: the original triangle count
  // and the simplifier's measured worst-case surface deviation in mm.
  simplifiedFrom?: number;
  deviationMm?: number;
}

// Above SOFT_LIMIT triangles the importer offers decimation toward TARGET
// (mandatory above KEEP_LIMIT — booleans and saving stop being practical).
// HARD_LIMIT guards the browser itself from running out of memory.
const SOFT_LIMIT = 300_000;
const TARGET_TRIANGLES = 250_000;
export const KEEP_LIMIT = 1_500_000;
const HARD_LIMIT = 5_000_000;
// Read nothing bigger than this: a binary STL at the triangle limit is
// 250 MB, and text formats are far less dense than that.
const MAX_FILE_BYTES = 400_000_000;

/** Refuses a file by its size, or by a binary STL's own triangle count,
 *  before any of it is parsed — parsing is what runs the browser out of
 *  memory, and it happens on the UI thread. */
async function checkBeforeParsing(file: File, ext: string): Promise<void> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `File is ${(file.size / 1e6).toFixed(0)} MB — beyond what the browser can process (limit ${MAX_FILE_BYTES / 1e6} MB).`,
    );
  }
  if (ext === "stl" && file.size >= 84) {
    // A binary STL says how many triangles it holds at byte 80. ASCII
    // files start with "solid"; a binary one can too, so only trust the
    // count when it matches the file's length exactly.
    const head = new DataView(await file.slice(0, 84).arrayBuffer());
    const declared = head.getUint32(80, true);
    if (84 + declared * 50 === file.size && declared > HARD_LIMIT) {
      throw new Error(
        `Mesh has ${declared.toLocaleString()} triangles — beyond what the browser can process (limit ${HARD_LIMIT.toLocaleString()}).`,
      );
    }
  }
}

async function decimate(
  geo: THREE.BufferGeometry,
): Promise<{ geo: THREE.BufferGeometry; deviationMm: number }> {
  await MeshoptSimplifier.ready;
  const positions = geo.getAttribute("position").array as Float32Array;
  let indices: Uint32Array;
  if (geo.index) {
    indices = new Uint32Array(geo.index.array);
  } else {
    indices = new Uint32Array(positions.length / 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
  }
  const [simplified, relativeError] = MeshoptSimplifier.simplify(
    indices,
    positions,
    3,
    TARGET_TRIANGLES * 3,
    0.01, // error ceiling; the measured result is usually far below it
    [],
  );
  // The simplifier's error is relative to the mesh extent; convert to mm.
  geo.computeBoundingBox();
  const size = geo.boundingBox
    ? geo.boundingBox.getSize(new THREE.Vector3())
    : new THREE.Vector3(1, 1, 1);
  const extent = Math.max(size.x, size.y, size.z);
  const deviationMm = relativeError * extent;
  // Rebuild compactly: expand to a triangle soup of only the surviving
  // triangles, then weld — drops the vertices simplification orphaned.
  const soup = new Float32Array(simplified.length * 3);
  for (let i = 0; i < simplified.length; i++) {
    const v = simplified[i] * 3;
    soup[i * 3] = positions[v];
    soup[i * 3 + 1] = positions[v + 1];
    soup[i * 3 + 2] = positions[v + 2];
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(soup, 3));
  return { geo: mergeVertices(out, 1e-4), deviationMm };
}

function stripToPosition(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", geo.getAttribute("position"));
  if (geo.index) g.setIndex(geo.index);
  return g;
}

const triCount = (geo: THREE.BufferGeometry) =>
  Math.round((geo.index ? geo.index.count : geo.getAttribute("position").count) / 3);

// decideSimplify: asked when the mesh is heavy but keepable — return false to
// keep the original resolution. Above KEEP_LIMIT decimation is mandatory.
async function finalize(
  geoIn: THREE.BufferGeometry,
  name: string,
  decideSimplify?: (triangles: number) => boolean,
): Promise<ImportedMesh> {
  // Weld duplicate vertices so booleans see a connected surface, then center
  // on the origin (the node transform handles placement).
  let geo = mergeVertices(stripToPosition(geoIn), 1e-4);
  geo.center();
  let triangles = triCount(geo);
  if (triangles > HARD_LIMIT) {
    throw new Error(
      `Mesh has ${triangles.toLocaleString()} triangles — beyond what the browser can process (limit ${HARD_LIMIT.toLocaleString()}).`,
    );
  }
  if (triangles < 1) throw new Error("No triangles found in the imported file.");

  let simplifiedFrom: number | undefined;
  let deviationMm: number | undefined;
  if (triangles > SOFT_LIMIT) {
    const mustSimplify = triangles > KEEP_LIMIT;
    const wantSimplify = mustSimplify || !decideSimplify || decideSimplify(triangles);
    if (wantSimplify) {
      simplifiedFrom = triangles;
      const result = await decimate(geo);
      geo = result.geo;
      deviationMm = result.deviationMm;
      geo.center();
      triangles = triCount(geo);
      if (triangles < 1) {
        throw new Error("Simplification failed — the mesh may be degenerate.");
      }
    }
  }
  return { params: encodeMeshParams(geo), name, triangles, simplifiedFrom, deviationMm };
}

export async function importMeshFile(
  file: File,
  decideSimplify?: (triangles: number) => boolean,
): Promise<ImportedMesh> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const baseName = file.name.replace(/\.[^.]+$/, "");
  await checkBeforeParsing(file, ext);
  if (ext === "stl") {
    const geo = new STLLoader().parse(await file.arrayBuffer());
    return finalize(geo, baseName, decideSimplify);
  }
  if (ext === "obj") {
    const root = new OBJLoader().parse(await file.text());
    const parts: THREE.BufferGeometry[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) parts.push(stripToPosition(mesh.geometry));
    });
    if (parts.length === 0) throw new Error("No meshes found in the OBJ file.");
    const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()));
    if (!merged) throw new Error("Could not merge the OBJ meshes.");
    return finalize(merged, baseName, decideSimplify);
  }
  if (ext === "svg") {
    const { paths } = new SVGLoader().parse(await file.text());
    const shapes = paths.flatMap((p) => SVGLoader.createShapes(p));
    if (shapes.length === 0) throw new Error("No closed paths found in the SVG.");
    const geo = new THREE.ExtrudeGeometry(shapes, {
      depth: 5,
      bevelEnabled: false,
      curveSegments: 8,
    });
    // SVG is Y-down; mirror it upright and restore winding.
    geo.applyMatrix4(new THREE.Matrix4().makeScale(1, -1, 1));
    flipWinding(geo);
    return finalize(geo, baseName, decideSimplify);
  }
  throw new Error("Unsupported file type — import .stl, .obj, or .svg.");
}
