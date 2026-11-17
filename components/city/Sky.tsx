"use client";

import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { daylightAt, type SkyName } from "@/lib/city/daylight";
import { setNight } from "@/lib/city/night";
import { clockMinutes } from "@/lib/city/store";
import { setLampGlow } from "./Roads";

/**
 * Sky dome from Kenney's "Skyboxes" (CC0, equirectangular panoramas: day, morning, night;
 * see public/models/CREDITS.md), blended by the game clock. The dome follows the camera and
 * is drawn behind everything. The same clock sets the sky-light strength (HDRI environment),
 * the haze colour and the street-lamp glow; the sun itself lives in Sun.tsx.
 */

const SKY_URL: Record<SkyName, string> = {
  day: "/sky/skybox-day.jpg",
  morning: "/sky/skybox-morning.jpg",
  night: "/sky/skybox-night.jpg",
};
const NAMES: SkyName[] = ["day", "morning", "night"];

const VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Always on the far plane.
    gl_Position = p.xyww;
  }
`;
const FRAGMENT = /* glsl */ `
  uniform sampler2D tA;
  uniform sampler2D tB;
  uniform float uMix;
  uniform float uYaw;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float u = atan(d.z, d.x) / 6.2831853 + 0.5 + uYaw;
    float v = asin(clamp(d.y, -1.0, 1.0)) / 3.1415926 + 0.5;
    vec2 uv = vec2(fract(u), v);
    vec4 a = texture2D(tA, uv);
    vec4 b = texture2D(tB, uv);
    gl_FragColor = mix(a, b, uMix);
    #include <colorspace_fragment>
  }
`;

/** Per-frame update outside the component (React compiler rule). */
function updateSky(
  mesh: THREE.Mesh,
  material: THREE.ShaderMaterial,
  textures: Record<SkyName, THREE.Texture>,
  scene: THREE.Scene,
  camera: THREE.Camera,
  gameMinutes: number,
) {
  const d = daylightAt(gameMinutes);
  mesh.position.copy(camera.position);
  material.uniforms.tA.value = textures[d.sky.a];
  material.uniforms.tB.value = textures[d.sky.b];
  material.uniforms.uMix.value = d.sky.t;
  scene.environmentIntensity = d.environment;
  if (scene.fog) scene.fog.color.setRGB(d.haze[0], d.haze[1], d.haze[2]);
  setLampGlow(d.lamps);
  setNight(d.lights);
}

/** Colour space and wrapping of the loaded panoramas (mutation outside the component for the React compiler). */
function prepareTextures(loaded: THREE.Texture[]): Record<SkyName, THREE.Texture> {
  const out = {} as Record<SkyName, THREE.Texture>;
  NAMES.forEach((n, i) => {
    loaded[i].colorSpace = THREE.SRGBColorSpace;
    loaded[i].wrapS = THREE.RepeatWrapping;
    loaded[i].needsUpdate = true;
    out[n] = loaded[i];
  });
  return out;
}

export function Sky() {
  const loaded = useLoader(THREE.TextureLoader, NAMES.map((n) => SKY_URL[n]));
  const textures = useMemo(() => prepareTextures(loaded), [loaded]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { tA: { value: textures.day }, tB: { value: textures.day }, uMix: { value: 0 }, uYaw: { value: 0.25 } },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    [textures],
  );
  const mesh = useRef<THREE.Mesh>(null);
  const scene = useThree((s) => s.scene);
  useFrame((state) => {
    if (mesh.current) updateSky(mesh.current, material, textures, scene, state.camera, clockMinutes());
  });
  return (
    <mesh ref={mesh} material={material} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[10, 32, 16]} />
    </mesh>
  );
}
