import * as THREE from "three";
import type { PrimitiveKind, ShapeNode } from "../types/scene";
import { buildGeometry, DEFAULT_PARAMS, PALETTE_COLORS } from "./primitives";

// Palette icons are real renders of each primitive's geometry, generated once
// at startup with a small shared offscreen renderer.

const SIZE = 96; // rendered at 2x for crisp display at 48px
const cache = new Map<PrimitiveKind, string>();
let renderer: THREE.WebGLRenderer | null = null;

// Flat-profile shapes read better nearly face-on than from the default iso.
const ICON_VIEW: Partial<Record<PrimitiveKind, THREE.Vector3>> = {
  text: new THREE.Vector3(0.15, -1, 0.35),
  star: new THREE.Vector3(0.15, -0.45, 1),
};
const DEFAULT_VIEW = new THREE.Vector3(1, -1, 0.75);

// Once WebGL has refused us, every icon falls back: no point asking again
// and no point letting the palette throw where the viewport's own fallback
// would have kept the rest of the app usable.
let unavailable = false;

/** A flat stand-in when the renderer is not available: the shape's colour
 *  and its initial, as an SVG data URL. */
export function fallbackIcon(kind: PrimitiveKind, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect x="6" y="6" width="36" height="36" rx="8" fill="${PALETTE_COLORS[kind]}"/><text x="24" y="31" font-family="system-ui,sans-serif" font-size="20" font-weight="700" fill="#fff" text-anchor="middle">${label.charAt(0).toUpperCase()}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Frees the offscreen renderer and its GPU context; icons are cached as
 *  images and never re-rendered, so it has nothing left to do. */
export function releaseIconRenderer() {
  if (!renderer) return;
  renderer.dispose();
  renderer.forceContextLoss();
  renderer = null;
}

export function shapeIcon(kind: PrimitiveKind): string {
  const cached = cache.get(kind);
  if (cached) return cached;
  if (unavailable) return "";

  const params =
    kind === "text" ? { value: "A", size: 10, depth: 5 } : { ...DEFAULT_PARAMS[kind] };
  const geometry = buildGeometry({ kind, params } as ShapeNode);
  if (!geometry) return "";

  try {
    renderer ??= (() => {
      const r = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
      r.setSize(SIZE, SIZE);
      return r;
    })();
  } catch (err) {
    console.warn("No WebGL for palette icons; using flat stand-ins", err);
    unavailable = true;
    geometry.dispose();
    return "";
  }

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
  // The letter lies flat on the workplane in the scene; stand it up in the
  // icon so it reads as an "A".
  if (kind === "text") mesh.rotation.x = Math.PI / 2;
  scene.add(mesh);

  geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere ?? new THREE.Sphere(new THREE.Vector3(), 15);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
  camera.up.set(0, 0, 1);
  camera.position
    .copy(sphere.center)
    .add((ICON_VIEW[kind] ?? DEFAULT_VIEW).clone().normalize().multiplyScalar(sphere.radius * 3.4));
  camera.lookAt(sphere.center);

  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL();

  geometry.dispose();
  (mesh.material as THREE.Material).dispose();
  cache.set(kind, url);
  return url;
}
