import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { DEPTH_TEXTURE_SCALE, TERRAIN_N, WATER_LEVEL, WET_DEPTH, WORLD_HALF, WORLD_SIZE, type DepthGrid } from "@/lib/city/terrain";
import { useDepthGrid } from "./useWater";

const waterTime = { value: 0 };

/**
 * Water surface material. Colour and opacity come from the water column depth (read from
 * the depth grid texture): clear and turquoise at the shore, dark blue-green in the deep.
 * Small animated waves perturb the normal, so the sky HDRI reflects with a shimmer.
 */
function createWaterMaterial(depthTexture: THREE.Texture) {
  const material = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.06,
    metalness: 0.05,
    transparent: true,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterTime;
    shader.uniforms.uDepth = { value: depthTexture };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWaterWorld;")
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWaterWorld;
        uniform float uTime;
        uniform sampler2D uDepth;

        // Sum of directional waves; returns the height gradient (d/dx, d/dz).
        vec2 waveGrad(vec2 p) {
          vec2 g = vec2(0.0);
          vec4 dirs[4];
          dirs[0] = vec4(normalize(vec2(1.0, 0.3)), 0.55, 1.1);
          dirs[1] = vec4(normalize(vec2(-0.4, 1.0)), 0.9, 1.6);
          dirs[2] = vec4(normalize(vec2(0.7, -0.8)), 1.7, 2.3);
          dirs[3] = vec4(normalize(vec2(-1.0, -0.2)), 3.1, 3.4);
          for (int i = 0; i < 4; i++) {
            float k = dirs[i].z;
            float phase = dot(dirs[i].xy, p) * k + uTime * dirs[i].w;
            g += dirs[i].xy * k * cos(phase) * (0.05 / k);
          }
          return g;
        }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec2 depthUv = (vWaterWorld.xz + ${WORLD_HALF.toFixed(1)}) / ${WORLD_SIZE.toFixed(1)};
        float column = texture2D(uDepth, depthUv).r * ${DEPTH_TEXTURE_SCALE.toFixed(1)} - ${WET_DEPTH.toFixed(2)};
        float deep = smoothstep(0.0, 2.6, column);
        vec3 shallowCol = vec3(0.17, 0.33, 0.27);
        vec3 deepCol = vec3(0.025, 0.10, 0.12);
        diffuseColor.rgb = mix(shallowCol, deepCol, deep);
        // Soft shore line: transparent where the water is only centimetres deep.
        diffuseColor.a = mix(0.45, 0.95, smoothstep(0.0, 1.0, column)) * smoothstep(-0.05, 0.08, column);
        // Thin bright rim where water meets the bank.
        diffuseColor.rgb += vec3(0.08) * (1.0 - smoothstep(0.02, 0.15, column));`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        vec2 wg = waveGrad(vWaterWorld.xz) + 0.5 * waveGrad(vWaterWorld.xz * 2.7 + 13.0);
        vec3 waveN = normalize(vec3(-wg.x, 1.0, -wg.y));
        normal = normalize((viewMatrix * vec4(waveN, 0.0)).xyz);`,
      );
  };
  material.customProgramCacheKey = () => "city-water";
  return material;
}

/** Encodes the depth grid into the 8-bit texture the water shader reads. */
function writeDepthTexture(texture: THREE.DataTexture, grid: DepthGrid) {
  const data = texture.image.data as Uint8Array;
  for (let i = 0; i < grid.length; i++) {
    // Land above the plain has negative depth: clamp, bytes would wrap around.
    data[i] = Math.max(0, Math.min(255, Math.round((grid[i] / DEPTH_TEXTURE_SCALE) * 255)));
  }
  texture.needsUpdate = true;
}

/** One water plane over the whole world; terrain above WATER_LEVEL hides it. */
export function Water() {
  const grid = useDepthGrid();

  const texture = useMemo(() => {
    const t = new THREE.DataTexture(
      new Uint8Array(TERRAIN_N * TERRAIN_N),
      TERRAIN_N,
      TERRAIN_N,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.unpackAlignment = 1;
    return t;
  }, []);
  const material = useMemo(() => createWaterMaterial(texture), [texture]);

  useEffect(() => writeDepthTexture(texture, grid), [grid, texture]);

  useEffect(
    () => () => {
      texture.dispose();
      material.dispose();
    },
    [texture, material],
  );

  useFrame(({ clock }) => {
    waterTime.value = clock.getElapsedTime();
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, WATER_LEVEL, 0]} material={material} renderOrder={1}>
      <planeGeometry args={[WORLD_SIZE, WORLD_SIZE]} />
    </mesh>
  );
}
