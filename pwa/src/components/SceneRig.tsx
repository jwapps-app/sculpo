import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { sceneApi, type ViewName } from "../lib/sceneApi";
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
      scene.traverse((o) => {
        if (o.userData.nodeId && (o as THREE.Mesh).isMesh) {
          box.expandByObject(o);
          any = true;
        }
      });
      if (!any) return;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      const fov = (camera as THREE.PerspectiveCamera).fov;
      const distance = Math.max(size / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)), 30) * 1.3;
      const dir = camera.position.clone().sub(controls.target).normalize();
      controls.target.copy(center);
      camera.position.copy(center).addScaledVector(dir, distance);
      controls.update();
    };

    sceneApi.dropShape = (kind, clientX, clientY) => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1),
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit)) {
        return;
      }
      const s = useScene.getState();
      s.addShape(kind, [
        s.snap ? Math.round(hit.x) : hit.x,
        s.snap ? Math.round(hit.y) : hit.y,
        0,
      ]);
    };

    return () => {
      sceneApi.setView = () => {};
      sceneApi.zoomToFit = () => {};
      sceneApi.dropShape = () => {};
    };
  }, [camera, controls, gl, scene]);

  return null;
}
