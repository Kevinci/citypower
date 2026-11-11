import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { naturalDepthGrid, terrainHeight, WORLD_HALF } from "@/lib/city/terrain";

/** How far the orbit pivot may move away from the map centre, in metres. */
const PIVOT_LIMIT = WORLD_HALF - 140;
/** The camera never goes lower than this above the ground. */
const MIN_CAMERA_HEIGHT = 6;

const clamped = new THREE.Vector3();
const delta = new THREE.Vector3();

/**
 * Keeps the camera above the stage. Runs after OrbitControls has updated (drei updates the
 * controls at frame priority -1): the pivot is pinned to ground level and to the map
 * bounds, and the camera is moved by the same amount so the view does not jump.
 */
export function CameraBounds() {
  useFrame((state) => {
    const camera = state.camera;
    const controls = state.controls as unknown as { target: THREE.Vector3 } | null;
    if (!controls) return;
    const target = controls.target;

    clamped.set(
      THREE.MathUtils.clamp(target.x, -PIVOT_LIMIT, PIVOT_LIMIT),
      0,
      THREE.MathUtils.clamp(target.z, -PIVOT_LIMIT, PIVOT_LIMIT),
    );
    delta.subVectors(clamped, target);
    if (delta.lengthSq() > 0) {
      target.add(delta);
      camera.position.add(delta);
    }

    // Never inside a mountain: keep the camera above the terrain under it.
    const ground = Math.max(0, terrainHeight(naturalDepthGrid(), camera.position.x, camera.position.z));
    if (camera.position.y < ground + MIN_CAMERA_HEIGHT) camera.position.y = ground + MIN_CAMERA_HEIGHT;
  });

  return null;
}
