import * as THREE from "three";

/**
 * Photo-textured materials for buildings made of scaled boxes, cylinders and roof meshes
 * that have no UVs in metres. The texture is projected triplanar in the mesh's own axes,
 * with the mesh (and instance) scale applied, so one tile always covers `tile` metres –
 * a 2 m and a 20 m wall show bricks of the same size.
 *
 * Modes:
 *  - "photo": the photo is the surface colour (tinted by `color`).
 *  - "grain": only the photo's light/dark pattern is applied on top of the existing colour
 *    (`map` with painted windows, per-instance house colours), with `strength`.
 *
 * Textures: Poly Haven (CC0), see public/models/CREDITS.md.
 */

export interface PhotoOptions {
  /** Base name in /textures, e.g. "red_brick_03" (expects <name>_diff_1k.jpg). */
  texture: string;
  /** Metres per texture tile. */
  tile: number;
  mode?: "photo" | "grain";
  strength?: number;
  /** Extra file name if the texture does not follow the _diff_1k.jpg pattern. */
  file?: string;
}

/**
 * City Pack style: 1 = every photo shows only its average colour (lowest mip level), so
 * classic buildings read as flat-coloured like the Kenney kits. Shared by all photo materials.
 */
const PHOTO_FLAT = { value: 0 };
export function setPhotoFlat(flat: boolean) {
  PHOTO_FLAT.value = flat ? 1 : 0;
}

/**
 * Lets a material with its own photo `map` (church stone, slates …) flatten in the City Pack
 * style too: the map lookup blends to the texture's average colour. Keeps an existing
 * onBeforeCompile. Do not use on signs, windows or painted textures.
 */
export function flattenMap<T extends THREE.Material>(material: T): T {
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uPhotoFlat = PHOTO_FLAT;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uPhotoFlat;")
      .replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
          vec4 sampledDiffuseColor = mix(texture2D(map, vMapUv), textureLod(map, vMapUv, 12.0), uPhotoFlat);
          diffuseColor *= sampledDiffuseColor;
        #endif`,
      );
  };
  material.customProgramCacheKey = () => `${key ? key() : ""}:flat`;
  return material;
}

const cache = new Map<string, { texture: THREE.Texture; mean: { value: number } }>();

/** Loads a photo once; `mean` (linear luminance) is measured when the image arrives. */
function photo(name: string, file: string) {
  let entry = cache.get(file);
  if (entry) return entry;
  const mean = { value: 0.25 };
  const texture = new THREE.TextureLoader().load(`/textures/${file}`, (t) => {
    // Average brightness, so "grain" keeps the base colour's brightness.
    const c = document.createElement("canvas");
    c.width = c.height = 16;
    const g = c.getContext("2d");
    if (!g) return;
    g.drawImage(t.image as CanvasImageSource, 0, 0, 16, 16);
    const px = g.getImageData(0, 0, 16, 16).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) {
      const lin = [px[i], px[i + 1], px[i + 2]].map((v) => Math.pow(v / 255, 2.2));
      sum += 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    }
    mean.value = Math.max(0.02, sum / 256);
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  entry = { texture, mean };
  cache.set(file, entry);
  void name;
  return entry;
}

/** Adds the triplanar photo to a MeshStandardMaterial (returns the same material). */
export function withPhoto<T extends THREE.MeshStandardMaterial>(material: T, o: PhotoOptions): T {
  const file = o.file ?? `${o.texture}_diff_1k.jpg`;
  const { texture, mean } = photo(o.texture, file);
  const mode = o.mode ?? "photo";
  const strength = o.strength ?? 0.6;
  material.customProgramCacheKey = () => `photo:${file}:${mode}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.triMap = { value: texture };
    shader.uniforms.triTile = { value: o.tile };
    shader.uniforms.triMean = mean;
    shader.uniforms.triStrength = { value: strength };
    shader.uniforms.uPhotoFlat = PHOTO_FLAT;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNormal;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vec3 triScale = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
        #ifdef USE_INSTANCING
          triScale *= vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        #endif
        vTriPos = position * triScale;
        vTriNormal = normal / max(triScale, vec3(1e-4));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vTriPos;
        varying vec3 vTriNormal;
        uniform sampler2D triMap;
        uniform float triTile;
        uniform float triMean;
        uniform float triStrength;
        uniform float uPhotoFlat;
        vec3 triSample() {
          vec3 w = pow(abs(normalize(vTriNormal)), vec3(6.0));
          w /= (w.x + w.y + w.z);
          vec3 p = vTriPos / triTile;
          vec3 photo = texture2D(triMap, p.zy).rgb * w.x + texture2D(triMap, p.xz).rgb * w.y + texture2D(triMap, p.xy).rgb * w.z;
          // City Pack style: the photo's average colour only (flat, like the kits).
          return mix(photo, textureLod(triMap, vec2(0.5), 12.0).rgb, uPhotoFlat);
        }`,
      )
      .replace(
        "#include <map_fragment>",
        mode === "photo"
          ? "#include <map_fragment>\ndiffuseColor.rgb *= triSample();"
          : `#include <map_fragment>
          float triL = dot(triSample(), vec3(0.2126, 0.7152, 0.0722)) / triMean;
          diffuseColor.rgb *= mix(1.0, clamp(triL, 0.0, 2.5), triStrength);`,
      );
  };
  return material;
}

/** Shorthand: a new photo material. */
export function photoMaterial(o: PhotoOptions & THREE.MeshStandardMaterialParameters) {
  const { texture, tile, mode, strength, file, ...params } = o;
  return withPhoto(new THREE.MeshStandardMaterial(params), { texture, tile, mode, strength, file });
}
