import * as THREE from "three";
import type { PrimitiveKind, ShapeNode } from "../types/scene";
import { buildGeometry, DEFAULT_PARAMS, PALETTE_COLORS } from "./primitives";

// Palette icons are real renders of each primitive's geometry, generated once
// at startup with a small shared offscreen renderer.

const SIZE = 96; // rendered at 2x for crisp display at 48px
const cache = new Map<PrimitiveKind, string>();
let renderer: THREE.WebGLRenderer | null = null;

export function shapeIcon(kind: PrimitiveKind): string {
  const cached = cache.get(kind);
  if (cached) return cached;

  const params =
    kind === "text" ? { value: "A", size: 10, depth: 5 } : { ...DEFAULT_PARAMS[kind] };
  const geometry = buildGeometry({ kind, params } as ShapeNode);
  if (!geometry) return "";

  renderer ??= (() => {
    const r = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    r.setSize(SIZE, SIZE);
    return r;
  })();

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(60, -40, 80);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(-50, 60, 30);
  scene.add(fill);

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: PALETTE_COLORS[kind],
      roughness: 0.6,
      metalness: 0.05,
    }),
  );
  scene.add(mesh);

  geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere ?? new THREE.Sphere(new THREE.Vector3(), 15);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
  camera.up.set(0, 0, 1);
  camera.position
    .copy(sphere.center)
    .add(new THREE.Vector3(1, -1, 0.75).normalize().multiplyScalar(sphere.radius * 3.4));
  camera.lookAt(sphere.center);

  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL();

  geometry.dispose();
  (mesh.material as THREE.Material).dispose();
  cache.set(kind, url);
  return url;
}
