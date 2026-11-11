import { Grid } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { loadTiling } from "@/lib/city/materials";
import { useCity } from "@/lib/city/store";
import { TERRAIN_N, TERRAIN_RES, WATER_LEVEL, WORLD_HALF, type DepthGrid } from "@/lib/city/terrain";
import { useShapedGrid } from "./useProfiles";
/** Real-world size of one repeat of the grass detail texture. */
const DETAIL_TILE = 9;

/**
 * Terrain material: the Poly Haven grass texture is used as fine detail only. Colour comes
 * from a palette driven by large-scale world-space noise (meadow, lush and dry patches),
 * and the detail texture is sampled twice at different scales and rotations so no tiling
 * pattern is visible from the usual camera heights.
 */
function createGroundMaterial() {
  const map = loadTiling("/textures/aerial_grass_rock_diff_1k.jpg", 1, true);
  const normalMap = loadTiling("/textures/aerial_grass_rock_nor_1k.jpg", 1, false);
  const roughnessMap = loadTiling("/textures/aerial_grass_rock_rough_1k.jpg", 1, false);

  const material = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    roughnessMap,
    normalScale: new THREE.Vector2(0.8, 0.8),
  });

  // 0 = realistic meadow, 1 = City Pack style (flat Kenney-like colours, no grain or relief).
  const stylized = { value: 0 };
  material.userData.stylized = stylized;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDetailTile = { value: DETAIL_TILE };
    shader.uniforms.uStylized = stylized;

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGroundWorld;\nvarying vec3 vGroundNormal;")
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGroundNormal = normalize(mat3(modelMatrix) * objectNormal);",
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vGroundWorld;
        varying vec3 vGroundNormal;
        uniform float uDetailTile;
        uniform float uStylized;

        float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x),
                     mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        // Each octave is rotated (~37°) and shifted, so the value noise never lines up with
        // the axes – otherwise faint square blotches show on large meadows.
        float gFbm(vec2 p) {
          const mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
          float v = 0.0;
          float a = 0.5;
          for (int k = 0; k < 4; k++) { v += a * gNoise(p); p = rot * p * 2.03 + vec2(17.3, 9.1); a *= 0.5; }
          return v;
        }
        // Six octaves for the large meadow structure (smooth from 1 km down to a few metres).
        float gFbm6(vec2 p) {
          const mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
          float v = 0.0;
          float a = 0.5;
          for (int k = 0; k < 6; k++) { v += a * gNoise(p); p = rot * p * 2.07 + vec2(11.7, 23.3); a *= 0.5; }
          return v / 0.984;
        }
        // Texture lookup without visible repetition (Inigo Quilez, "texture repetition",
        // technique 3): a smooth noise field picks one of eight random offsets per area and
        // neighbouring variants are blended, so tile borders never line up into a grid.
        vec4 noTile(sampler2D samp, vec2 uv) {
          // Rotated, two-octave field: variant borders follow no axis and stay soft.
          vec2 q = mat2(0.8, 0.6, -0.6, 0.8) * uv;
          float k = 0.65 * gNoise(q * 0.31) + 0.35 * gNoise(q * 0.83 + 5.2);
          float l = k * 8.0;
          float f = fract(l);
          float ia = floor(l);
          float ib = ia + 1.0;
          vec2 offa = sin(vec2(3.0, 7.0) * ia);
          vec2 offb = sin(vec2(3.0, 7.0) * ib);
          vec2 dx = dFdx(uv);
          vec2 dy = dFdy(uv);
          vec4 cola = textureGrad(samp, uv + offa, dx, dy);
          vec4 colb = textureGrad(samp, uv + offb, dx, dy);
          return mix(cola, colb, smoothstep(0.1, 0.9, f - 0.1 * dot(cola - colb, vec4(1.0))));
        }
        /** Same, but only the fine grain: the tile's own large-scale brightness is removed. */
        float noTileGrain(sampler2D samp, vec2 uv) {
          vec3 c = noTile(samp, uv).rgb;
          float lum = dot(c, vec3(0.299, 0.587, 0.114));
          // Mean brightness of the whole texture (smallest mip): grain = deviation from it.
          float mean = dot(textureLod(samp, vec2(0.5), 10.0).rgb, vec3(0.299, 0.587, 0.114));
          return lum - mean;
        }
        vec2 gUv(float scale, float angle) {
          float c = cos(angle);
          float s = sin(angle);
          vec2 p = vGroundWorld.xz / scale;
          return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
        }`,
      )
      // Two detail samples at different scale/rotation, blended by noise, to hide tiling.
      .replace(
        "#include <map_fragment>",
        `
        // Grass grain from two non-repeating lookups at different scale and rotation.
        vec2 uvA = gUv(uDetailTile, 0.0);
        vec2 uvB = gUv(uDetailTile * 2.7, 1.1);
        vec3 detail = mix(noTile(map, uvA).rgb, noTile(map, uvB).rgb, 0.45);
        float grain = 0.6 * noTileGrain(map, uvA) + 0.4 * noTileGrain(map, uvB);
        // Brightness from the grain only (no tile-sized blotches), centred on a mid value.
        float lum = clamp(0.23 + grain * 1.7, 0.0, 1.0);

        // Large-scale palette without a recognisable motif: every scale is domain-warped
        // (shapes flow instead of forming round dots) and the dry patches change size and
        // density from region to region, so no two parts of a meadow look alike.
        vec2 wp = vGroundWorld.xz;
        vec2 warp = vec2(gFbm(wp / 140.0 + 4.1), gFbm(wp / 140.0 + 9.7)) - 0.5;
        vec2 ww = wp + warp * 90.0;
        float region = gFbm(wp / 700.0 + 31.0);          // whole districts: wetter or drier
        float macro = gFbm6(ww / 260.0);
        float mid = gFbm6(ww / 75.0 + 17.0);
        float fine = gFbm(ww / 12.0 + 3.0);
        float patches = mid;                             // used by mountains below
        vec3 lush  = vec3(0.055, 0.165, 0.022);
        vec3 fresh = vec3(0.12, 0.27, 0.04);
        vec3 olive = vec3(0.17, 0.25, 0.05);
        vec3 dry   = vec3(0.33, 0.31, 0.14);
        vec3 base = mix(lush, fresh, smoothstep(0.2, 0.8, macro * 0.7 + mid * 0.3));
        // Slight hue drift over hundreds of metres (yellowish vs. bluish green).
        base = mix(base, olive, smoothstep(0.45, 0.85, region) * 0.35);
        // Dry ground: threshold follows the region, edges are ragged from the fine noise.
        float dryness = mid * 0.7 + fine * 0.15 + macro * 0.15;
        float threshold = mix(0.78, 0.52, smoothstep(0.3, 0.75, region));
        base = mix(base, dry, smoothstep(threshold, threshold + 0.14, dryness) * 0.45);
        // Clumps at metre scale.
        base *= 0.86 + 0.28 * fine;

        // Strong detail contrast so the grass reads as texture, plus a bit of photo colour.
        float detailContrast = pow(lum * 1.8, 1.4);
        vec3 groundColor = mix(base * (0.35 + 1.25 * detailContrast), detail * 0.5, 0.1);

        // Banks and beds: grass gives way to sand near the water line and to mud below it.
        float h = vGroundWorld.y;
        vec3 sand = vec3(0.36, 0.31, 0.21) * (0.6 + 0.8 * detailContrast);
        vec3 mud  = vec3(0.17, 0.14, 0.09) * (0.7 + 0.6 * detailContrast);
        float shore = smoothstep(-0.3, -0.75, h + (fine - 0.5) * 0.3);
        groundColor = mix(groundColor, sand, shore);
        groundColor = mix(groundColor, mud, smoothstep(${(WATER_LEVEL - 0.3).toFixed(2)}, ${(WATER_LEVEL - 1.6).toFixed(2)}, h));

        // Mountains: alpine meadow higher up, bare rock on steep flanks and above the tree
        // line, snow on the summits (less on steep faces where it would slide off).
        float slope = 1.0 - clamp(vGroundNormal.y, 0.0, 1.0);
        float rocky = macro * 0.6 + fine * 0.4;
        vec3 alpine = mix(base, vec3(0.30, 0.31, 0.16), 0.5) * (0.4 + 1.2 * detailContrast);
        vec3 rock = mix(vec3(0.33, 0.31, 0.29), vec3(0.47, 0.45, 0.42), rocky) * (0.45 + 1.1 * detailContrast);
        vec3 snow = vec3(0.90, 0.92, 0.95) * (0.85 + 0.25 * detailContrast);
        groundColor = mix(groundColor, alpine, smoothstep(18.0, 40.0, h + (fine - 0.5) * 8.0));
        float rockMask = max(smoothstep(0.22, 0.42, slope), smoothstep(48.0, 62.0, h + (patches - 0.5) * 14.0));
        groundColor = mix(groundColor, rock, rockMask);
        float snowMask = smoothstep(60.0, 72.0, h + (fine - 0.5) * 10.0) * (1.0 - smoothstep(0.45, 0.65, slope));
        groundColor = mix(groundColor, snow, snowMask);
        // City Pack style: soft flat lawn like the Kenney kits, broad gentle variation only,
        // light sand at the water, flat rock and snow in the mountains.
        if (uStylized > 0.0) {
          // Kenney Starter Kit grass tile: mint #37a076 (linear) with light tufts #5ac487 in small clumps.
          // A touch darker than the kit (user wish), same hue.
          vec3 kLawn = vec3(0.038, 0.352, 0.181) * 0.86 * (0.95 + 0.1 * macro);
          float tuft = smoothstep(0.62, 0.7, gNoise(vGroundWorld.xz * 0.9 + 3.7)) * smoothstep(0.45, 0.6, gNoise(vGroundWorld.xz * 0.23));
          kLawn = mix(kLawn, vec3(0.102, 0.552, 0.242) * 0.86, tuft * 0.85);
          // Some grass texture: grain from the photo detail, clumps at metre scale.
          kLawn *= (0.85 + 0.3 * clamp(detailContrast, 0.0, 1.0)) * (0.95 + 0.1 * fine);
          vec3 k = kLawn;
          k = mix(k, vec3(0.62, 0.53, 0.32), shore);
          k = mix(k, vec3(0.30, 0.23, 0.13), smoothstep(${(WATER_LEVEL - 0.3).toFixed(2)}, ${(WATER_LEVEL - 1.6).toFixed(2)}, h));
          k = mix(k, vec3(0.24, 0.38, 0.12), smoothstep(18.0, 40.0, h));
          k = mix(k, vec3(0.40, 0.40, 0.42), rockMask);
          k = mix(k, vec3(0.92, 0.94, 0.97), snowMask);
          groundColor = mix(groundColor, k, uStylized);
        }
        diffuseColor.rgb *= groundColor;
        `,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `
        #ifdef USE_NORMALMAP
          vec3 mapN = noTile(normalMap, gUv(uDetailTile, 0.0)).xyz * 2.0 - 1.0;
          mapN.xy *= normalScale * (1.0 - 0.4 * uStylized);
          normal = normalize(tbn * mapN);
        #endif
        `,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `
        float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          roughnessFactor *= mix(noTile(roughnessMap, gUv(uDetailTile, 0.0)).g, 0.9, uStylized);
        #endif
        `,
      );
  };

  return material;
}

/** Ground tiles per side: each is its own mesh, so tiles outside the view are not drawn. */
const GROUND_TILES = 10;

/** Switches the ground shader between the realistic meadow and the City Pack look (uniform, no recompile). */
function setGroundStyle(material: THREE.Material, stylized: boolean) {
  (material.userData.stylized as { value: number }).value = stylized ? 1 : 0;
}

/** One tile of the 2 m terrain grid: columns c0…c0+n, rows r0…r0+n of the depth grid. */
function tileGeometry(c0: number, r0: number, n: number) {
  const g = new THREE.PlaneGeometry(n * TERRAIN_RES, n * TERRAIN_RES, n, n);
  // Plane lies in x/y with +y first; rotating by -90° around x maps row 0 to z = min.
  g.rotateX(-Math.PI / 2);
  g.translate(-WORLD_HALF + (c0 + n / 2) * TERRAIN_RES, 0, -WORLD_HALF + (r0 + n / 2) * TERRAIN_RES);
  return g;
}

/**
 * Writes terrain heights from the depth grid into a tile, with normals from the whole grid
 * (central differences), so neighbouring tiles light seamlessly.
 */
function applyDepth(geometry: THREE.BufferGeometry, grid: DepthGrid, c0: number, r0: number, n: number) {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const nor = geometry.attributes.normal as THREE.BufferAttribute;
  const h = (c: number, r: number) => -grid[Math.min(TERRAIN_N - 1, Math.max(0, r)) * TERRAIN_N + Math.min(TERRAIN_N - 1, Math.max(0, c))];
  for (let iy = 0; iy <= n; iy++) {
    for (let ix = 0; ix <= n; ix++) {
      const c = c0 + ix;
      const r = r0 + iy;
      const i = iy * (n + 1) + ix;
      pos.setY(i, h(c, r) - 0.01);
      const dx = (h(c + 1, r) - h(c - 1, r)) / (2 * TERRAIN_RES);
      const dz = (h(c, r + 1) - h(c, r - 1)) / (2 * TERRAIN_RES);
      const len = Math.hypot(dx, 1, dz);
      nor.setXYZ(i, -dx / len, 1 / len, -dz / len);
    }
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

/**
 * Terrain: a 2 m grid over the whole world, flat at y = 0 and carved by the depth grid
 * (rivers, lakes, finished canals), split into tiles so the GPU only draws what is in view
 * (one mesh of 1.1 M vertices cost ~11 ms per frame on the 2.1 km map).
 */
export function Ground() {
  const material = useMemo(() => createGroundMaterial(), []);
  const tiles = useMemo(() => {
    const n = (TERRAIN_N - 1) / GROUND_TILES;
    const list: { geometry: THREE.BufferGeometry; c0: number; r0: number; n: number }[] = [];
    for (let tr = 0; tr < GROUND_TILES; tr++)
      for (let tc = 0; tc < GROUND_TILES; tc++) list.push({ geometry: tileGeometry(tc * n, tr * n, n), c0: tc * n, r0: tr * n, n });
    return list;
  }, []);
  // Terrain including cuttings where roads and tracks are laid into slopes.
  const grid = useShapedGrid();
  const style = useCity((s) => s.houseStyle);
  useEffect(() => setGroundStyle(material, style === "pack"), [material, style]);

  useEffect(() => {
    for (const t of tiles) applyDepth(t.geometry, grid, t.c0, t.r0, t.n);
  }, [tiles, grid]);

  useEffect(
    () => () => {
      material.dispose();
      for (const t of tiles) t.geometry.dispose();
    },
    [material, tiles],
  );

  return (
    <group>
      {tiles.map((t, i) => (
        <mesh key={i} geometry={t.geometry} material={material} receiveShadow />
      ))}
    </group>
  );
}

/** Build grid, only visible while a road tool is active. */
export function BuildGrid() {
  const active = useCity((s) => s.tool !== null);
  return (
    <Grid
      visible={active}
      position={[0, 0.04, 0]}
      args={[900, 900]}
      cellSize={2}
      cellThickness={0.6}
      cellColor="#ffffff"
      sectionSize={10}
      sectionThickness={1}
      sectionColor="#ffe9a8"
      fadeDistance={170}
      fadeStrength={1.6}
      infiniteGrid
    />
  );
}
