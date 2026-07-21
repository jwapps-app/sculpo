import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { sceneApi, type ViewName } from "../lib/sceneApi";
import { workplaneMatrix, workplanePlane } from "../lib/workplane";
import { useScene } from "../state/store";

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

    return () => {
      sceneApi.setView = () => {};
      sceneApi.zoomToFit = () => {};
      sceneApi.dropShape = () => {};
      sceneApi.getNodeBounds = () => null;
      sceneApi.hitTestNodes = () => false;
      sceneApi.pickInRect = () => [];
    };
  }, [camera, controls, gl, scene]);

  return null;
}
