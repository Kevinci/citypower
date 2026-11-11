import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

/** Direction towards the sun (afternoon, from the south-east). */
const SUN_DIR = new THREE.Vector3(140, 160, 60).normalize();
const SHADOW_MAP = 2048;
/** Distance of the light from the shadow centre; the shadow camera spans twice that. */
const LIGHT_DISTANCE = 450;
/** Half-size of the shadow box relative to the camera distance, and its limits (m). */
const EXTENT_PER_DISTANCE = 0.85;
const MIN_EXTENT = 50;
const MAX_EXTENT = 190;
/** Extent changes in steps, so zooming does not resize the shadow texels every frame. */
const EXTENT_STEP = 1.15;

const right = new THREE.Vector3();
const up = new THREE.Vector3();
const centre = new THREE.Vector3();
const toCamera = new THREE.Vector3();

/**
 * Moves the sun's shadow box with the view: it is centred a little in front of the orbit
 * pivot (towards the camera, where the foreground is), sized by the zoom, and snapped to
 * whole shadow texels in light space so shadows do not shimmer while panning.
 */
function followView(light: THREE.DirectionalLight, camera: THREE.Camera, target: THREE.Vector3) {
  toCamera.subVectors(camera.position, target);
  const distance = toCamera.length();
  toCamera.y = 0;
  centre.copy(target).addScaledVector(toCamera, 0.3);

  const raw = THREE.MathUtils.clamp(distance * EXTENT_PER_DISTANCE, MIN_EXTENT, MAX_EXTENT);
  const extent = EXTENT_STEP ** Math.round(Math.log(raw) / Math.log(EXTENT_STEP));
  const cam = light.shadow.camera;
  if (cam.right !== extent) {
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 1;
    cam.far = LIGHT_DISTANCE * 2;
    cam.updateProjectionMatrix();
  }

  // Light-space axes as three's lookAt builds them (z = towards the sun, world up).
  right.crossVectors(THREE.Object3D.DEFAULT_UP, SUN_DIR).normalize();
  up.crossVectors(SUN_DIR, right);
  const texel = (2 * extent) / SHADOW_MAP;
  const r = Math.round(centre.dot(right) / texel) * texel;
  const u = Math.round(centre.dot(up) / texel) * texel;
  const f = centre.dot(SUN_DIR);
  centre.copy(right).multiplyScalar(r).addScaledVector(up, u).addScaledVector(SUN_DIR, f);

  light.target.position.copy(centre);
  light.target.updateMatrixWorld();
  light.position.copy(centre).addScaledVector(SUN_DIR, LIGHT_DISTANCE);
}

/** The sun: one shadow-casting directional light whose shadows follow the camera. */
export function Sun() {
  const light = useRef<THREE.DirectionalLight>(null);

  useFrame((state) => {
    const controls = state.controls as unknown as { target: THREE.Vector3 } | null;
    if (light.current && controls) followView(light.current, state.camera, controls.target);
  });

  return (
    <directionalLight
      ref={light}
      position={SUN_DIR.clone().multiplyScalar(LIGHT_DISTANCE)}
      intensity={3.3}
      // Warm afternoon sun; the sky light from the HDRI stays cool, which gives the contrast.
      color="#ffe4bf"
      castShadow
      shadow-mapSize={[SHADOW_MAP, SHADOW_MAP]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.04}
    />
  );
}
