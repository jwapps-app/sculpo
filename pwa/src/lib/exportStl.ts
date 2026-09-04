import * as THREE from "three";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import type { Project } from "../types/scene";
import { isGroup } from "../types/scene";
import { buildGeometry } from "./primitives";
import { evaluateGroup } from "./csg";
import { asClosedSolid, manifoldLoaded } from "./manifold";
import { downloadBlob, safeFilename } from "./download";

export type ExportFormat = "stl" | "obj";

export interface ExportOptions {
  format?: ExportFormat;
  // When set, only these top-level nodes are exported.
  onlyIds?: string[];
}

export interface ExportResult {
  exported: number;
  skippedHoles: number;
}

// Exports top-level nodes: groups as their evaluated CSG solid, lone solid
// shapes as-is. Lone holes are skipped (nothing to cut). All compute is
// client-side; the file downloads straight from the browser.
export function exportSceneStl(project: Project, options: ExportOptions = {}): ExportResult {
  const { format = "stl", onlyIds } = options;
  const scene = new THREE.Scene();
  let exported = 0;
  let skippedHoles = 0;

  const ids = onlyIds?.length
    ? project.rootOrder.filter((id) => onlyIds.includes(id))
    : project.rootOrder;

  for (const id of ids) {
    const node = project.nodes[id];
    if (!node || node.hidden) continue;

    let geometry: THREE.BufferGeometry | null;
    if (isGroup(node)) {
      geometry = evaluateGroup(node, project.nodes);
    } else if (node.role === "hole") {
      skippedHoles++;
      continue;
    } else {
      geometry = buildGeometry(node);
      // Lone text and SVG shapes get the same outline repair groups do.
      if (geometry && manifoldLoaded()) geometry = asClosedSolid(geometry);
    }
    if (!geometry || !geometry.getAttribute("position")?.count) continue;

    const mesh = new THREE.Mesh(geometry);
    mesh.position.set(...node.position);
    mesh.rotation.set(...node.rotation);
    mesh.scale.set(...node.scale);
    scene.add(mesh);
    exported++;
  }

  if (exported === 0) return { exported, skippedHoles };

  scene.updateMatrixWorld(true);
  const base = safeFilename(project.name);
  if (format === "obj") {
    const text = new OBJExporter().parse(scene);
    downloadBlob(new Blob([text], { type: "model/obj" }), `${base}.obj`);
  } else {
    const data = new STLExporter().parse(scene, { binary: true }) as DataView;
    const bytes = new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    downloadBlob(new Blob([bytes], { type: "model/stl" }), `${base}.stl`);
  }
  return { exported, skippedHoles };
}
