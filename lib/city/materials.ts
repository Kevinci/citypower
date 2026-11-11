import * as THREE from "three";

/** Surface types a road is made of. Each one gets its own material and draw call. */
export const ROAD_MATERIAL_KEYS = ["asphalt", "marking", "curb", "sidewalk", "median", "bikeway"] as const;
export type RoadMaterialKey = (typeof ROAD_MATERIAL_KEYS)[number];

const loader = typeof window !== "undefined" ? new THREE.TextureLoader() : null;

/**
 * Loads a tiling texture. Road UVs are in metres, so `tileMetres` is the real-world size
 * of one texture repeat.
 */
export function loadTiling(path: string, tileMetres: number, srgb: boolean): THREE.Texture | null {
  if (!loader) return null;
  const t = loader.load(path);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / tileMetres, 1 / tileMetres);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Crack-free asphalt: a narrow strip cut from Poly Haven "Asphalt 02" (the source photo has
 * a long crack that repeated every tile). Mirrored repeat keeps the strip seamless.
 */
function cleanAsphalt(uMetres: number, vMetres: number) {
  const load = (map: string, srgb: boolean) => {
    const t = loadTiling(`/textures/asphalt_clean_${map}.jpg`, 1, srgb);
    if (t) {
      t.wrapS = THREE.MirroredRepeatWrapping;
      t.wrapT = THREE.MirroredRepeatWrapping;
      t.repeat.set(1 / uMetres, 1 / vMetres);
    }
    return t;
  };
  return { map: load("diff", true), normalMap: load("nor", false), roughnessMap: load("rough", false) };
}

/** A PBR texture set from Poly Haven: colour, OpenGL normal and roughness maps. */
function pbr(name: string, tileMetres: number) {
  return {
    map: loadTiling(`/textures/${name}_diff_1k.jpg`, tileMetres, true),
    normalMap: loadTiling(`/textures/${name}_nor_1k.jpg`, tileMetres, false),
    roughnessMap: loadTiling(`/textures/${name}_rough_1k.jpg`, tileMetres, false),
  };
}

/**
 * Removes the colour cast of a photo texture so the material tint decides the final colour.
 * Used for the paving texture, which is brownish in the source photo.
 */
function desaturate(material: THREE.MeshStandardMaterial, amount: number, tint?: THREE.ColorRepresentation) {
  // The tint is applied after desaturating, otherwise desaturation would remove it again.
  const c = new THREE.Color(tint ?? "#ffffff");
  const tintGlsl = `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
      float grey = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(grey), ${amount.toFixed(2)}) * ${tintGlsl};`,
    );
  };
  // three caches programs by onBeforeCompile source, which is the same for every tint:
  // without a key all desaturated materials would share the first compiled tint.
  const key = `desaturate:${amount.toFixed(2)}:${c.getHexString()}`;
  material.customProgramCacheKey = () => key;
  return material;
}

function surface(params: THREE.MeshStandardMaterialParameters) {
  return new THREE.MeshStandardMaterial({
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    ...params,
  });
}

function createRoadMaterials(): Record<RoadMaterialKey, THREE.MeshStandardMaterial> {
  return {
    // Dark asphalt with cracks and grain; tinted down so lane markings stay crisp.
    asphalt: surface({
      ...cleanAsphalt(1.75, 7),
      color: "#8d8f94",
      normalScale: new THREE.Vector2(0.9, 0.9),
    }),
    // Markings sit 2 cm above the asphalt; a stronger depth offset keeps them on top at any distance.
    marking: surface({ color: "#f3f0e7", roughness: 0.55, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    curb: surface({ color: "#c9ccd0", roughness: 0.75 }),
    // Concrete slabs, ~3 m per texture repeat so slabs are roughly 50 cm.
    sidewalk: desaturate(
      surface({
        ...pbr("concrete_pavers_02", 3),
        color: "#e4e4e2",
      }),
      0.9,
    ),
    median: surface({
      ...pbr("aerial_grass_rock", 6),
      color: "#9fc47a",
    }),
    // Red cycle path asphalt (as in Germany): the asphalt photo tinted brick red.
    bikeway: desaturate(
      surface({
        ...cleanAsphalt(1.25, 5),
        normalScale: new THREE.Vector2(0.7, 0.7),
      }),
      0.9,
      "#c4604a",
    ),
  };
}

function createPreviewMaterials(): Record<RoadMaterialKey, THREE.MeshStandardMaterial> {
  const colors: Record<RoadMaterialKey, string> = {
    asphalt: "#3a3d42",
    marking: "#f5f2e9",
    curb: "#aab0b8",
    sidewalk: "#d4d8dd",
    median: "#5f9a48",
    bikeway: "#b65a45",
  };
  return Object.fromEntries(
    ROAD_MATERIAL_KEYS.map((k) => [
      k,
      surface({ color: colors[k], transparent: true, opacity: 0.55, depthWrite: false }),
    ]),
  ) as Record<RoadMaterialKey, THREE.MeshStandardMaterial>;
}

/**
 * City Pack style for roads: the colours of Kenney's road tiles (Starter Kit City Builder,
 * read from its colormap): asphalt #36363a, light blue-grey markings, curb #6d738a, pavement
 * #81869c. One shared uniform switches all road materials (and their construction clones,
 * which reuse the base onBeforeCompile) between photo PBR and flat kit colours, no rebuild.
 */
const ROAD_PACK = { value: 0 };
export function setRoadPack(pack: boolean) {
  ROAD_PACK.value = pack ? 1 : 0;
}
const KENNEY_ROAD: Record<RoadMaterialKey, string> = {
  asphalt: "#36363a",
  marking: "#c3cae6",
  curb: "#6d738a",
  sidewalk: "#81869c",
  median: "#33956e",
  bikeway: "#b0584a",
};
function kenneyable(material: THREE.MeshStandardMaterial, key: RoadMaterialKey) {
  const previous = material.onBeforeCompile;
  const baseKey = material.customProgramCacheKey();
  const c = new THREE.Color(KENNEY_ROAD[key]);
  const flat = `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uRoadPack = ROAD_PACK;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uRoadPack;")
      .replace("#include <map_fragment>", `#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, ${flat}, uRoadPack);`)
      // Flat like the kit: no relief from the photo normal map.
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, uRoadPack));");
  };
  material.customProgramCacheKey = () => `kenney-road:${key}:${baseKey}`;
  return material;
}

export const ROAD_MATERIALS = Object.fromEntries(
  Object.entries(createRoadMaterials()).map(([k, m]) => [k, kenneyable(m, k as RoadMaterialKey)]),
) as Record<RoadMaterialKey, THREE.MeshStandardMaterial>;
export const PREVIEW_MATERIALS = createPreviewMaterials();

/* ---------- progressive reveal ---------- */

/** Visible range along a road in metres; the uniforms are shared with the shader. */
export interface AlongRange {
  from: { value: number };
  to: { value: number };
}

export const createAlongRange = (from = 0, to = 0): AlongRange => ({
  from: { value: from },
  to: { value: to },
});

/**
 * Clone of a material that only draws fragments whose `along` attribute (distance from the
 * road start) lies inside `range`. Keeps any shader tweak the base material already has.
 * `cacheKey` must be unique per base material so different bases never share a program.
 */
export function clipAlong<T extends THREE.Material>(base: T, range: AlongRange, cacheKey: string): T {
  const material = base.clone() as T;
  const baseCompile = base.onBeforeCompile.bind(base);
  material.onBeforeCompile = (shader, renderer) => {
    baseCompile(shader, renderer);
    shader.uniforms.uAlongFrom = range.from;
    shader.uniforms.uAlongTo = range.to;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float along;\nvarying float vAlong;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvAlong = along;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vAlong;\nuniform float uAlongFrom;\nuniform float uAlongTo;",
      )
      .replace("void main() {", "void main() {\n  if (vAlong < uAlongFrom || vAlong > uAlongTo) discard;");
  };
  const baseKey = base.customProgramCacheKey();
  material.customProgramCacheKey = () => `along-clip:${cacheKey}:${baseKey}`;
  return material;
}

/* ---------- construction site ---------- */

function createSiteMaterials() {
  // Opened ground: the grass photo, desaturated and tinted to soil, keeps a natural grain.
  const dirt = desaturate(
    new THREE.MeshStandardMaterial({
      map: loadTiling("/textures/aerial_grass_rock_diff_1k.jpg", 5, true),
      normalMap: loadTiling("/textures/aerial_grass_rock_nor_1k.jpg", 5, false),
      roughness: 1,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
    1,
    // Brightened soil brown; the photo's luminance (about 0.3) darkens it back down.
    "#e0a070",
  );
  return {
    dirt,
    trench: new THREE.MeshStandardMaterial({ color: "#2e2015", roughness: 1, side: THREE.DoubleSide }),
    spoil: new THREE.MeshStandardMaterial({ color: "#6b4a2f", roughness: 1, side: THREE.DoubleSide, flatShading: true }),
    waterPipe: new THREE.MeshStandardMaterial({ color: "#2f6fd6", roughness: 0.45, metalness: 0.1 }),
    gasPipe: new THREE.MeshStandardMaterial({ color: "#f2c230", roughness: 0.45, metalness: 0.1 }),
  };
}

export const SITE_MATERIALS = createSiteMaterials();

/* ---------- railways ---------- */

export const RAIL_MATERIAL_KEYS = ["ballast", "sleeper", "rail", "plate", "mast"] as const;
export type RailMaterialKey = (typeof RAIL_MATERIAL_KEYS)[number];

function createRailMaterials(): Record<RailMaterialKey, THREE.MeshStandardMaterial> {
  return {
    // Gravel: the rocky aerial photo, desaturated and tinted to grey-brown crushed stone.
    ballast: desaturate(
      surface({
        ...pbr("aerial_grass_rock", 2.5),
        // Above 1 on purpose: the photo is dark, crushed stone is light grey.
        color: new THREE.Color(2.1, 2.05, 2.0),
        roughness: 1,
        normalScale: new THREE.Vector2(1.4, 1.4),
      }),
      1,
      "#d9d5cf",
    ),
    sleeper: new THREE.MeshStandardMaterial({ color: "#a29d95", roughness: 0.85 }),
    // Depth offset so the rail heads stay visible where they lie flush in a crossing plate.
    rail: new THREE.MeshStandardMaterial({
      color: "#8d8a86",
      roughness: 0.3,
      metalness: 0.85,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -6,
    }),
    plate: desaturate(surface({ ...pbr("concrete_pavers_02", 4), color: "#bdbab4" }), 0.9),
    mast: new THREE.MeshStandardMaterial({ color: "#7d8389", roughness: 0.5, metalness: 0.6 }),
  };
}

export const RAIL_MATERIALS = createRailMaterials();

/* ---------- waterways and bridges ---------- */

export const WATER_MATERIAL_KEYS = ["quay", "towpath"] as const;
export type WaterMaterialKey = (typeof WATER_MATERIAL_KEYS)[number];

function createWaterMaterials(): Record<WaterMaterialKey, THREE.MeshStandardMaterial> {
  return {
    // Quay wall: paving texture at a larger scale reads as dressed stone blocks.
    quay: desaturate(surface({ ...pbr("concrete_pavers_02", 5), roughness: 0.95 }), 0.8, "#b8ab98"),
    towpath: desaturate(surface({ ...pbr("concrete_pavers_02", 3), color: "#d9d5cc" }), 0.9),
  };
}

export const WATER_MATERIALS = createWaterMaterials();

export const BRIDGE_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#b7b3ab",
  roughness: 0.85,
  side: THREE.DoubleSide,
});

/** Translucent ghost material for drafting rails and canals. */
export const GHOST_MATERIALS = {
  rail: surface({ color: "#8a7f72", transparent: true, opacity: 0.6, depthWrite: false }),
  water: surface({ color: "#3d8fb8", transparent: true, opacity: 0.6, depthWrite: false }),
  edge: surface({ color: "#f5f2e9", transparent: true, opacity: 0.8, depthWrite: false }),
  /** Placement preview: fits (green) / does not fit (red). */
  valid: surface({ color: "#35d06b", transparent: true, opacity: 0.55, depthWrite: false, depthTest: false }),
  invalid: surface({ color: "#ef4444", transparent: true, opacity: 0.55, depthWrite: false, depthTest: false }),
};

/** Galvanised steel for guardrails and railings. */
export const BARRIER_MATERIAL = new THREE.MeshStandardMaterial({
  color: "#c3c8cd",
  roughness: 0.35,
  metalness: 0.75,
  side: THREE.DoubleSide,
});

/* ---------- grade-separation structures ---------- */

/** Painted steel for arches and railings: white for road bridges, oxide red for railway bridges. */
export const STEEL_MATERIALS = {
  road: new THREE.MeshStandardMaterial({ color: "#e4e6e8", roughness: 0.4, metalness: 0.55, side: THREE.DoubleSide }),
  rail: new THREE.MeshStandardMaterial({ color: "#8a2e24", roughness: 0.5, metalness: 0.45, side: THREE.DoubleSide }),
};

/** Grass on embankment slopes; same photo as the meadow, a bit lusher. */
export const EMBANKMENT_MATERIAL = new THREE.MeshStandardMaterial({
  ...pbr("aerial_grass_rock", 6),
  color: "#93c063",
  roughness: 1,
  side: THREE.DoubleSide,
});

/** Bridge concrete with the paver texture at a large scale as subtle formwork pattern. */
export const STRUCTURE_CONCRETE = desaturate(
  new THREE.MeshStandardMaterial({
    ...pbr("concrete_pavers_02", 8),
    // Above 1 on purpose: the paver photo is dark, bridge concrete is light.
    color: new THREE.Color(2.3, 2.3, 2.25),
    roughness: 0.9,
    side: THREE.DoubleSide,
    normalScale: new THREE.Vector2(0.25, 0.25),
  }),
  1,
  "#dedbd5",
);
