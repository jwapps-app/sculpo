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
  // Set when the mesh was decimated on import: the original triangle count.
  simplifiedFrom?: number;
}

// Above SOFT_LIMIT triangles, imports are decimated toward TARGET so booleans
// stay interactive and projects stay saveable. HARD_LIMIT guards the browser
// itself from running out of memory while parsing.
const SOFT_LIMIT = 300_000;
const TARGET_TRIANGLES = 250_000;
const HARD_LIMIT = 5_000_000;

async function decimate(geo: THREE.BufferGeometry): Promise<THREE.BufferGeometry> {
  await MeshoptSimplifier.ready;
  const positions = geo.getAttribute("position").array as Float32Array;
  let indices: Uint32Array;
  if (geo.index) {
    indices = new Uint32Array(geo.index.array);
  } else {
    indices = new Uint32Array(positions.length / 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
  }
  const [simplified] = MeshoptSimplifier.simplify(
    indices,
    positions,
    3,
    TARGET_TRIANGLES * 3,
    0.01, // allow up to ~1% shape deviation to hit the budget
    [],
  );
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
  return mergeVertices(out, 1e-4);
}

function stripToPosition(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", geo.getAttribute("position"));
  if (geo.index) g.setIndex(geo.index);
  return g;
}

const triCount = (geo: THREE.BufferGeometry) =>
  Math.round((geo.index ? geo.index.count : geo.getAttribute("position").count) / 3);

async function finalize(geoIn: THREE.BufferGeometry, name: string): Promise<ImportedMesh> {
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
  if (triangles > SOFT_LIMIT) {
    simplifiedFrom = triangles;
    geo = await decimate(geo);
    geo.center();
    triangles = triCount(geo);
    if (triangles < 1) throw new Error("Simplification failed — the mesh may be degenerate.");
  }
  return { params: encodeMeshParams(geo), name, triangles, simplifiedFrom };
}

export async function importMeshFile(file: File): Promise<ImportedMesh> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  const baseName = file.name.replace(/\.[^.]+$/, "");
  if (ext === "stl") {
    const geo = new STLLoader().parse(await file.arrayBuffer());
    return finalize(geo, baseName);
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
    return finalize(merged, baseName);
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
    return finalize(geo, baseName);
  }
  throw new Error("Unsupported file type — import .stl, .obj, or .svg.");
}
