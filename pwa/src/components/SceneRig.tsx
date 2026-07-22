import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { sceneApi, type ViewName } from "../lib/sceneApi";
import { workplaneMatrix, workplanePlane, workplaneNormal } from "../lib/workplane";
import { placementState } from "../lib/placement";
import { footprint, type Footprint } from "../lib/primitives";
import { DEFAULT_PARAMS } from "../lib/primitives";
import type { PrimitiveKind } from "../types/scene";
import { useScene } from "../state/store";

// How close (mm) a placed shape's edge must come to a neighbor's edge before
// it snaps flush against it.
const MAGNET_RANGE = 4;

const VIEW_DIRS: Record<ViewName, THREE.Vector3> = {
  // Slight offset on "top" keeps OrbitControls away from the pole.
  top: new THREE.Vector3(0.02, -0.02, 1),
  front: new THREE.Vector3(0, -1, 0.001),
  right: new THREE.Vector3(1, 0, 0.001),
  iso: new THREE.Vector3(1, -1, 0.8),
};

export function SceneRig() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    if (!controls) return;

    const findNodeObject = (id: string): THREE.Object3D | null => {
      let found: THREE.Object3D | null = null;
      scene.traverse((o) => {
        if (!found && o.userData.nodeId === id) found = o;
      });
      return found;
    };

    const nodeMeshes = (): THREE.Object3D[] => {
      const out: THREE.Object3D[] = [];
      scene.traverse((o) => {
        if (o.userData.nodeId && (o as THREE.Mesh).isMesh) out.push(o);
      });
      return out;
    };

    const clientToNdc = (clientX: number, clientY: number): THREE.Vector2 => {
      const rect = gl.domElement.getBoundingClientRect();
      return new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1),
      );
    };

    sceneApi.setView = (view) => {
      const distance = camera.position.distanceTo(controls.target);
      camera.position
        .copy(controls.target)
        .addScaledVector(VIEW_DIRS[view].clone().normalize(), distance);
      controls.update();
    };

    sceneApi.zoomToFit = () => {
      const box = new THREE.Box3();
      let any = false;
      for (const o of nodeMeshes()) {
        box.expandByObject(o);
        any = true;
      }
      if (!any) return;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      const dir = camera.position.clone().sub(controls.target).normalize();
      if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
        const ortho = camera as THREE.OrthographicCamera;
        const rect = gl.domElement.getBoundingClientRect();
        ortho.zoom = Math.min(rect.width, rect.height) / (size * 1.3);
        ortho.updateProjectionMatrix();
        controls.target.copy(center);
        camera.position.copy(center).addScaledVector(dir, 200);
      } else {
        const fov = (camera as THREE.PerspectiveCamera).fov;
        const distance =
          Math.max(size / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)), 30) * 1.3;
        controls.target.copy(center);
        camera.position.copy(center).addScaledVector(dir, distance);
      }
      controls.update();
    };

    sceneApi.dropShape = (kind, clientX, clientY) => {
      const s = useScene.getState();
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(clientToNdc(clientX, clientY), camera);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(workplanePlane(s.workplane), hit)) return;

      const rotation = s.workplane ? s.workplane.rotation : ([0, 0, 0] as const);
      if (s.snap) {
        // Snap in the plane's own frame so grids stay honest on tilted planes.
        if (s.workplane) {
          const m = workplaneMatrix(s.workplane);
          const local = hit.clone().applyMatrix4(m.clone().invert());
          local.x = Math.round(local.x / s.snapStep) * s.snapStep;
          local.y = Math.round(local.y / s.snapStep) * s.snapStep;
          local.z = 0;
          hit.copy(local.applyMatrix4(m));
        } else {
          hit.x = Math.round(hit.x / s.snapStep) * s.snapStep;
          hit.y = Math.round(hit.y / s.snapStep) * s.snapStep;
          hit.z = 0;
        }
      }
      s.addShape(kind, {
        position: [hit.x, hit.y, hit.z],
        rotation: [rotation[0], rotation[1], rotation[2]],
      });
    };

    sceneApi.getNodeBounds = (id) => {
      const o = findNodeObject(id);
      if (!o) return null;
      o.updateWorldMatrix(true, true);
      return new THREE.Box3().setFromObject(o);
    };

    sceneApi.hitTestNodes = (clientX, clientY) => {
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(clientToNdc(clientX, clientY), camera);
      return raycaster.intersectObjects(nodeMeshes(), false).length > 0;
    };

    sceneApi.pickInRect = (x1, y1, x2, y2) => {
      const [minX, maxX] = x1 < x2 ? [x1, x2] : [x2, x1];
      const [minY, maxY] = y1 < y2 ? [y1, y2] : [y2, y1];
      const rect = gl.domElement.getBoundingClientRect();
      const s = useScene.getState();
      const editing = s.editingGroupId ? s.project.nodes[s.editingGroupId] : null;
      const candidates =
        editing && "childIds" in editing ? editing.childIds : s.project.rootOrder;
      const picked: string[] = [];
      for (const id of candidates) {
        const node = s.project.nodes[id];
        if (!node || node.hidden || node.locked) continue;
        const bounds = sceneApi.getNodeBounds(id);
        if (!bounds) continue;
        const center = bounds.getCenter(new THREE.Vector3()).project(camera);
        if (center.z > 1) continue; // behind the camera
        const sx = rect.left + ((center.x + 1) / 2) * rect.width;
        const sy = rect.top + ((1 - center.y) / 2) * rect.height;
        if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) picked.push(id);
      }
      return picked;
    };

    sceneApi.hitNodeAt = (clientX, clientY) => {
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(clientToNdc(clientX, clientY), camera);
      const hits = raycaster.intersectObjects(nodeMeshes(), false);
      return hits.length > 0 ? (hits[0].object.userData.nodeId as string) : null;
    };

    sceneApi.cruiseMove = (id, clientX, clientY) => {
      const obj = findNodeObject(id);
      if (!obj) return;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(clientToNdc(clientX, clientY), camera);
      const others = nodeMeshes().filter((o) => o.userData.nodeId !== id);
      const hit = raycaster.intersectObjects(others, false).find((h) => h.face);

      const geo = (obj as THREE.Mesh).geometry;
      geo.computeBoundingBox();
      const bottom = geo.boundingBox ? -geo.boundingBox.min.z * obj.scale.z : 0;
      const s = useScene.getState();

      if (hit && hit.face) {
        // Glide along the face: seat the shape's bottom on the surface,
        // oriented to the face normal, but never sunk below the floor.
        const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
        obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        obj.position.copy(hit.point).addScaledVector(normal, bottom);
        if (geo.boundingBox) {
          const bb = geo.boundingBox;
          const hx = ((bb.max.x - bb.min.x) / 2) * Math.abs(obj.scale.x);
          const hy = ((bb.max.y - bb.min.y) / 2) * Math.abs(obj.scale.y);
          const m = new THREE.Matrix4().makeRotationFromQuaternion(obj.quaternion).elements;
          const halfZ = Math.abs(m[2]) * hx + Math.abs(m[6]) * hy + Math.abs(m[10]) * bottom;
          if (obj.position.z < halfZ) obj.position.z = halfZ;
        }
      } else {
        // Back on the floor: upright, resting on the plane.
        const p = new THREE.Vector3();
        if (
          !raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), p)
        ) {
          return;
        }
        if (s.snap) {
          p.x = Math.round(p.x / s.snapStep) * s.snapStep;
          p.y = Math.round(p.y / s.snapStep) * s.snapStep;
        }
        obj.rotation.set(0, 0, 0);
        obj.position.set(p.x, p.y, bottom);
      }
      obj.updateMatrixWorld(true);
    };

    const footprints = new Map<PrimitiveKind, Footprint>();
    const footprintFor = (kind: PrimitiveKind): Footprint => {
      let fp = footprints.get(kind);
      if (!fp) {
        fp = footprint(kind, DEFAULT_PARAMS[kind]);
        footprints.set(kind, fp);
      }
      return fp;
    };

    sceneApi.placementMove = (clientX, clientY) => {
      const s = useScene.getState();
      if (!s.placing) {
        placementState.valid = false;
        return;
      }
      const fp = footprintFor(s.placing);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(clientToNdc(clientX, clientY), camera);
      const hit = raycaster.intersectObjects(nodeMeshes(), false).find((h) => h.face);

      if (hit && hit.face) {
        // Seat the ghost on the hovered face, oriented to its normal, but
        // never sunk below the floor.
        const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
        placementState.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        placementState.position.copy(hit.point).addScaledVector(normal, fp.bottom);
        const m = new THREE.Matrix4().makeRotationFromQuaternion(placementState.quaternion).elements;
        const halfZ =
          Math.abs(m[2]) * fp.halfW + Math.abs(m[6]) * fp.halfD + Math.abs(m[10]) * fp.bottom;
        if (placementState.position.z < halfZ) placementState.position.z = halfZ;
        placementState.valid = true;
        return;
      }

      // Floor (or active workplane) placement.
      const p = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(workplanePlane(s.workplane), p)) {
        placementState.valid = false;
        return;
      }
      if (s.workplane) {
        placementState.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          workplaneNormal(s.workplane),
        );
        placementState.position
          .copy(p)
          .addScaledVector(workplaneNormal(s.workplane), fp.bottom);
        placementState.valid = true;
        return;
      }

      if (s.snap) {
        p.x = Math.round(p.x / s.snapStep) * s.snapStep;
        p.y = Math.round(p.y / s.snapStep) * s.snapStep;
      }
      // Magnetic snap: pull flush against nearby objects' bounds.
      const boxes: THREE.Box3[] = [];
      for (const id of s.project.rootOrder) {
        const node = s.project.nodes[id];
        if (!node || node.hidden) continue;
        const b = sceneApi.getNodeBounds(id);
        if (b) boxes.push(b);
      }
      for (const b of boxes) {
        const yOverlap = p.y - fp.halfD < b.max.y && p.y + fp.halfD > b.min.y;
        if (yOverlap) {
          if (Math.abs(p.x - fp.halfW - b.max.x) <= MAGNET_RANGE) p.x = b.max.x + fp.halfW;
          else if (Math.abs(p.x + fp.halfW - b.min.x) <= MAGNET_RANGE) p.x = b.min.x - fp.halfW;
        }
        const xOverlap = p.x - fp.halfW < b.max.x && p.x + fp.halfW > b.min.x;
        if (xOverlap) {
          if (Math.abs(p.y - fp.halfD - b.max.y) <= MAGNET_RANGE) p.y = b.max.y + fp.halfD;
          else if (Math.abs(p.y + fp.halfD - b.min.y) <= MAGNET_RANGE) p.y = b.min.y - fp.halfD;
        }
      }
      placementState.quaternion.identity();
      placementState.position.set(p.x, p.y, fp.bottom);
      placementState.valid = true;
    };

    // 27 bounding-box feature points per object: corners, edge midpoints,
    // face centers, and the center itself.
    const boxFeaturePoints = (b: THREE.Box3): THREE.Vector3[] => {
      const xs = [b.min.x, (b.min.x + b.max.x) / 2, b.max.x];
      const ys = [b.min.y, (b.min.y + b.max.y) / 2, b.max.y];
      const zs = [b.min.z, (b.min.z + b.max.z) / 2, b.max.z];
      const pts: THREE.Vector3[] = [];
      for (const x of xs) for (const y of ys) for (const z of zs) pts.push(new THREE.Vector3(x, y, z));
      return pts;
    };

    sceneApi.measureSnap = (clientX, clientY) => {
      const s = useScene.getState();
      const rect = gl.domElement.getBoundingClientRect();
      const SNAP_PX = 14;
      let best: THREE.Vector3 | null = null;
      let bestDist = SNAP_PX;
      const v = new THREE.Vector3();
      for (const id of s.project.rootOrder) {
        const node = s.project.nodes[id];
        if (!node || node.hidden) continue;
        const b = sceneApi.getNodeBounds(id);
        if (!b) continue;
        for (const p of boxFeaturePoints(b)) {
          v.copy(p).project(camera);
          if (v.z > 1) continue; // behind the camera
          const sx = rect.left + ((v.x + 1) / 2) * rect.width;
          const sy = rect.top + ((1 - v.y) / 2) * rect.height;
          const d = Math.hypot(sx - clientX, sy - clientY);
          if (d < bestDist) {
            bestDist = d;
            best = p.clone();
          }
        }
      }
      if (best) return { point: best.toArray() as [number, number, number], snapped: true };

      // No feature nearby: fall back to the surface under the cursor, then
      // the floor plane (grid-snapped when snapping is on).
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(clientToNdc(clientX, clientY), camera);
      const hit = raycaster.intersectObjects(nodeMeshes(), false).find((h) => h.face);
      if (hit) return { point: hit.point.toArray() as [number, number, number], snapped: false };
      const p = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), p)) {
        return null;
      }
      if (s.snap) {
        p.x = Math.round(p.x / s.snapStep) * s.snapStep;
        p.y = Math.round(p.y / s.snapStep) * s.snapStep;
      }
      return { point: p.toArray() as [number, number, number], snapped: false };
    };

    sceneApi.readNodeTransform = (id) => {
      const obj = findNodeObject(id);
      if (!obj) return null;
      return {
        position: obj.position.toArray() as [number, number, number],
        rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
        scale: obj.scale.toArray() as [number, number, number],
      };
    };

    return () => {
      sceneApi.setView = () => {};
      sceneApi.zoomToFit = () => {};
      sceneApi.dropShape = () => {};
      sceneApi.getNodeBounds = () => null;
      sceneApi.hitTestNodes = () => false;
      sceneApi.pickInRect = () => [];
      sceneApi.hitNodeAt = () => null;
      sceneApi.cruiseMove = () => {};
      sceneApi.readNodeTransform = () => null;
      sceneApi.placementMove = () => {};
      sceneApi.measureSnap = () => null;
    };
  }, [camera, controls, gl, scene]);

  return null;
}
