import * as THREE from "three";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import type { Project } from "../types/scene";
import { isGroup } from "../types/scene";
import { buildGeometry } from "./primitives";
import { evaluateGroup } from "./csg";
import { downloadBlob, safeFilename } from "./download";

export interface ExportResult {
  exported: number;
  skippedHoles: number;
}

// Exports every top-level node: groups as their evaluated CSG solid, lone
// solid shapes as-is. Lone holes are skipped (nothing to cut). All compute is
// client-side; the file downloads straight from the browser.
export function exportSceneStl(project: Project): ExportResult {
  const scene = new THREE.Scene();
  let exported = 0;
  let skippedHoles = 0;

  for (const id of project.rootOrder) {
    const node = project.nodes[id];
    if (!node) continue;

    let geometry: THREE.BufferGeometry | null;
    if (isGroup(node)) {
      geometry = evaluateGroup(node, project.nodes);
    } else if (node.role === "hole") {
      skippedHoles++;
      continue;
    } else {
      geometry = buildGeometry(node);
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
  const data = new STLExporter().parse(scene, { binary: true }) as DataView;
  const bytes = new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  downloadBlob(
    new Blob([bytes], { type: "model/stl" }),
    `${safeFilename(project.name)}.stl`,
  );
  return { exported, skippedHoles };
}
