import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { flipWinding } from "./transform";
import { encodeMeshParams } from "./meshData";

export interface ImportedMesh {
  params: Record<string, string>;
  name: string;
  triangles: number;
}

const MAX_TRIANGLES = 300_000;

function stripToPosition(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", geo.getAttribute("position"));
  if (geo.index) g.setIndex(geo.index);
  return g;
}

function finalize(geoIn: THREE.BufferGeometry, name: string): ImportedMesh {
  // Weld duplicate vertices so booleans see a connected surface, then center
  // on the origin (the node transform handles placement).
  let geo = mergeVertices(stripToPosition(geoIn), 1e-4);
  geo.center();
  const triangles = (geo.index ? geo.index.count : geo.getAttribute("position").count) / 3;
  if (triangles > MAX_TRIANGLES) {
    throw new Error(
      `Mesh has ${Math.round(triangles).toLocaleString()} triangles — too heavy for interactive booleans (limit ${MAX_TRIANGLES.toLocaleString()}).`,
    );
  }
  if (triangles < 1) throw new Error("No triangles found in the imported file.");
  return { params: encodeMeshParams(geo), name, triangles: Math.round(triangles) };
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
