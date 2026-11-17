import * as THREE from "three";
import { NIGHT } from "@/lib/city/night";

/**
 * Night lighting on materials, driven by the shared `NIGHT` uniform:
 *  - `windowGlow`: window glass texels (light blue in the Kenney atlases, dark slate in the
 *    classic facade texture) glow warm yellow in some windows only – which ones is a hash of
 *    the window's place in the world, and they switch on one after another as it gets dark.
 *  - `signGlow`: the whole texture lights up (illuminated signs).
 */

const GLOW_VERTEX = /* glsl */ `
  varying vec3 vGlowPos;
`;
const GLOW_VERTEX_BODY = /* glsl */ `
  {
    vec4 gp = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      gp = instanceMatrix * gp;
    #endif
    #ifdef USE_BATCHING
      gp = batchingMatrix * gp;
    #endif
    vGlowPos = (modelMatrix * gp).xyz;
  }
`;

/** Which texels are glass, in linear colour. */
const MASKS = {
  kit: /* glsl */ `
    float glass = step(0.25, c.r) * step(0.45, c.g) * step(0.65, c.b) * step(0.25, c.b - c.r) * step(0.12, c.g - c.r);
  `,
  slate: /* glsl */ `
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    float glass = step(0.05, c.b) * step(c.b, 0.17) * step(0.025, c.b - c.r) * (1.0 - step(0.13, lum));
  `,
};

type Hooked = THREE.Material & { onBeforeCompile: (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void };

function chain(material: Hooked, add: (shader: THREE.WebGLProgramParametersWithUniforms) => void, key: string) {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    add(shader);
  };
  material.customProgramCacheKey = () => `${prevKey ? prevKey.call(material) : ""}|${key}`;
  material.needsUpdate = true;
}

/** Lit windows at night; `share` = share of windows that are lit. */
export function windowGlow<M extends THREE.MeshStandardMaterial>(material: M, mode: keyof typeof MASKS, share = 0.4): M {
  chain(
    material,
    (shader) => {
      shader.uniforms.uNight = NIGHT;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${GLOW_VERTEX}`)
        .replace("#include <worldpos_vertex>", `#include <worldpos_vertex>\n${GLOW_VERTEX_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\nuniform float uNight;\nvarying vec3 vGlowPos;\nfloat glowHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          {
            vec3 c = diffuseColor.rgb;
            ${MASKS[mode]}
            // One cell per window-ish patch of wall; a second hash staggers when it switches on.
            vec2 cell = vec2(floor((vGlowPos.x + vGlowPos.z) * 0.7), floor(vGlowPos.y / 1.4));
            float h1 = glowHash(cell);
            float h2 = glowHash(cell + 17.3);
            float lit = step(h1, ${share.toFixed(2)}) * smoothstep(0.2 + 0.6 * h2, 0.3 + 0.6 * h2, uNight);
            vec3 warm = mix(vec3(1.0, 0.82, 0.5), vec3(1.0, 0.95, 0.8), h2);
            totalEmissiveRadiance += warm * 2.4 * glass * lit;
          }`,
        );
    },
    `window-glow:${mode}:${share}`,
  );
  return material;
}

/** Illuminated sign: the texture itself shines at night. */
export function signGlow<M extends THREE.MeshStandardMaterial>(material: M, strength = 1.4): M {
  chain(
    material,
    (shader) => {
      shader.uniforms.uNight = NIGHT;
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uNight;")
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uNight * ${strength.toFixed(2)};`);
    },
    `sign-glow:${strength}`,
  );
  return material;
}
