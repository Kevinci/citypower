import { Grid } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { loadTiling } from "@/lib/city/materials";
import { useCity } from "@/lib/city/store";
import { TERRAIN_N, TERRAIN_RES, WATER_LEVEL, WORLD_HALF, type DepthGrid } from "@/lib/city/terrain";
import { useShapedGrid } from "./useProfiles";

/** Value noise and fbm of the ground shader (vertex and fragment stage use the same code). */
const GROUND_NOISE = /* glsl */ `
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
`;
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
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vGroundWorld;
        varying vec3 vGroundNormal;
        // Large-scale meadow fields (75 m … 1 km): computed per vertex (every 2 m) instead of per
        // pixel – they change far too slowly for the difference to show, and cost a fraction.
        varying vec2 vWarped;
        varying vec3 vFields;
${GROUND_NOISE}`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vGroundNormal = normalize(mat3(modelMatrix) * objectNormal);
        {
          vec2 wp = vGroundWorld.xz;
          vec2 warp = vec2(gFbm(wp / 140.0 + 4.1), gFbm(wp / 140.0 + 9.7)) - 0.5;
          vWarped = wp + warp * 90.0;
          // x: region (districts), y: macro, z: mid.
          vFields = vec3(gFbm(wp / 700.0 + 31.0), gFbm6(vWarped / 260.0), gFbm6(vWarped / 75.0 + 17.0));
        }`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vGroundWorld;
        varying vec3 vGroundNormal;
        varying vec2 vWarped;
        varying vec3 vFields;
        uniform float uDetailTile;
        uniform float uStylized;

${GROUND_NOISE}
        // Texture lookup without visible repetition (Inigo Quilez, "texture repetition",
        // technique 3): a smooth noise field picks one of eight random offsets per area and
        // neighbouring variants are blended, so tile borders never line up into a grid.
        // The variant choice depends only on the coordinates: computed once per uv and shared by
        // every texture read there (colour, grain, normal and roughness maps).
        struct NoTile { vec2 uv; vec2 offa; vec2 offb; float f; vec2 dx; vec2 dy; };
        NoTile noTileAt(vec2 uv) {
          // Rotated, two-octave field: variant borders follow no axis and stay soft.
          vec2 q = mat2(0.8, 0.6, -0.6, 0.8) * uv;
          float k = 0.65 * gNoise(q * 0.31) + 0.35 * gNoise(q * 0.83 + 5.2);
          float l = k * 8.0;
          float ia = floor(l);
          NoTile t;
          t.uv = uv;
          t.f = fract(l);
          t.offa = sin(vec2(3.0, 7.0) * ia);
          t.offb = sin(vec2(3.0, 7.0) * (ia + 1.0));
          t.dx = dFdx(uv);
          t.dy = dFdy(uv);
          return t;
        }
        vec4 noTileRead(sampler2D samp, NoTile t) {
          vec4 cola = textureGrad(samp, t.uv + t.offa, t.dx, t.dy);
          vec4 colb = textureGrad(samp, t.uv + t.offb, t.dx, t.dy);
          return mix(cola, colb, smoothstep(0.1, 0.9, t.f - 0.1 * dot(cola - colb, vec4(1.0))));
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
        NoTile tA = noTileAt(uvA);
        NoTile tB = noTileAt(uvB);
        vec3 colA = noTileRead(map, tA).rgb;
        vec3 colB = noTileRead(map, tB).rgb;
        vec3 detail = mix(colA, colB, 0.45);
        // Fine grain only: the deviation from the texture's mean brightness (smallest mip).
        float meanLum = dot(textureLod(map, vec2(0.5), 10.0).rgb, vec3(0.299, 0.587, 0.114));
        float grain = 0.6 * (dot(colA, vec3(0.299, 0.587, 0.114)) - meanLum) + 0.4 * (dot(colB, vec3(0.299, 0.587, 0.114)) - meanLum);
        // Brightness from the grain only (no tile-sized blotches), centred on a mid value.
        float lum = clamp(0.23 + grain * 1.7, 0.0, 1.0);

        // Large-scale palette without a recognisable motif: every scale is domain-warped
        // (shapes flow instead of forming round dots) and the dry patches change size and
        // density from region to region, so no two parts of a meadow look alike.
        // Warp, region, macro and mid come from the vertex shader (vWarped, vFields).
        vec2 ww = vWarped;
        float region = vFields.x;                        // whole districts: wetter or drier
        float macro = vFields.y;
        float mid = vFields.z;
        float fine = gFbm(ww / 12.0 + 3.0);
        float patches = mid;                             // used by mountains below
        // Strong detail contrast so the grass reads as texture.
        float detailContrast = pow(lum * 1.8, 1.4);

        // Banks, beds and mountains: masks shared by both looks.
        float h = vGroundWorld.y;
        float shore = smoothstep(-0.3, -0.75, h + (fine - 0.5) * 0.3);
        float bed = smoothstep(${(WATER_LEVEL - 0.3).toFixed(2)}, ${(WATER_LEVEL - 1.6).toFixed(2)}, h);
        float slope = 1.0 - clamp(vGroundNormal.y, 0.0, 1.0);
        float rockMask = max(smoothstep(0.22, 0.42, slope), smoothstep(48.0, 62.0, h + (patches - 0.5) * 14.0));
        float snowMask = smoothstep(60.0, 72.0, h + (fine - 0.5) * 10.0) * (1.0 - smoothstep(0.45, 0.65, slope));

        // Only the active look is computed (uniform branch); both only while blending.
        vec3 groundColor = vec3(0.0);
        if (uStylized < 1.0) {
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
          // A bit of photo colour.
          groundColor = mix(base * (0.35 + 1.25 * detailContrast), detail * 0.5, 0.1);
          // Grass gives way to sand near the water line and to mud below it.
          vec3 sand = vec3(0.36, 0.31, 0.21) * (0.6 + 0.8 * detailContrast);
          vec3 mud  = vec3(0.17, 0.14, 0.09) * (0.7 + 0.6 * detailContrast);
          groundColor = mix(groundColor, sand, shore);
          groundColor = mix(groundColor, mud, bed);
          // Mountains: alpine meadow higher up, bare rock on steep flanks and above the tree
          // line, snow on the summits (less on steep faces where it would slide off).
          float rocky = macro * 0.6 + fine * 0.4;
          vec3 alpine = mix(base, vec3(0.30, 0.31, 0.16), 0.5) * (0.4 + 1.2 * detailContrast);
          vec3 rock = mix(vec3(0.33, 0.31, 0.29), vec3(0.47, 0.45, 0.42), rocky) * (0.45 + 1.1 * detailContrast);
          vec3 snow = vec3(0.90, 0.92, 0.95) * (0.85 + 0.25 * detailContrast);
          groundColor = mix(groundColor, alpine, smoothstep(18.0, 40.0, h + (fine - 0.5) * 8.0));
          groundColor = mix(groundColor, rock, rockMask);
          groundColor = mix(groundColor, snow, snowMask);
        }
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
          k = mix(k, vec3(0.30, 0.23, 0.13), bed);
          k = mix(k, vec3(0.24, 0.38, 0.12), smoothstep(18.0, 40.0, h));
          k = mix(k, vec3(0.40, 0.40, 0.42), rockMask);
          k = mix(k, vec3(0.92, 0.94, 0.97), snowMask);
          groundColor = uStylized >= 1.0 ? k : mix(groundColor, k, uStylized);
        }
        diffuseColor.rgb *= groundColor;
        `,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `
        #ifdef USE_NORMALMAP
          vec3 mapN = noTileRead(normalMap, tA).xyz * 2.0 - 1.0;
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
          roughnessFactor *= mix(noTileRead(roughnessMap, tA).g, 0.9, uStylized);
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
