import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Building } from "@/lib/city/economy";
import { mulberry32 } from "@/lib/city/random";
import { useCity } from "@/lib/city/store";
import { sampleDepth, type DepthGrid } from "@/lib/city/terrain";
import { PIG_URL, pigClips, rigPig } from "./Pig";

/**
 * Farm animals and their enclosures, modelled on livestock in farming games: cows graze
 * on a fenced pasture (post-and-rail fence, water trough, shelter), pigs root around in a
 * muddy run with wallows and pig arks. Animals are rigged, animated Quaternius models
 * (CC0) that wander inside their area, alternating between walking, grazing and idling.
 */

const COW = "/models/animals/cow.glb";
const SHEEP = "/models/animals/sheep.glb";
useGLTF.preload(COW);
useGLTF.preload(SHEEP);
useGLTF.preload(PIG_URL);
/** Kenney Cube Pets (CC0): cow and pig of the City Pack style, animated by node clips (idle, walk, eat). */
const CUBE_COW = "/models/animals/cubepets/animal-cow.glb";
const CUBE_PIG = "/models/animals/cubepets/animal-pig.glb";
const CUBE_CHICK = "/models/animals/cubepets/animal-chick.glb";
useGLTF.preload(CUBE_CHICK);
useGLTF.preload(CUBE_COW);
useGLTF.preload(CUBE_PIG);
/** Classic pigs: the player's model (Pig.tsx, rigged when loaded). */
const MODEL = { cow: COW, pig: PIG_URL, sheep: SHEEP, cowCube: CUBE_COW, pigCube: CUBE_PIG, chick: CUBE_CHICK } as const;
/** Body proportions per species on top of the length scale (width, height, length). */
const SHAPE: Record<keyof typeof MODEL, [number, number, number]> = { cow: [1, 1, 1], pig: [1, 1, 1], sheep: [1, 1, 1], cowCube: [1, 1, 1], pigCube: [1, 1, 1], chick: [1, 1, 1] };
/** Default coat per species (material name → colour; "hidden" hides the part). */
const DEFAULT_COAT: Partial<Record<keyof typeof MODEL, Record<string, string>>> = {};

/** Length of the animals in metres (slightly generous so they read from afar). */
const LENGTH = { cow: 2.6, pig: 1.6, sheep: 1.5, cowCube: 2.2, pigCube: 1.5, chick: 1.25 } as const;
const WALK_SPEED = { cow: 0.8, pig: 0.7, sheep: 0.6, cowCube: 0.8, pigCube: 0.7, chick: 0.6 } as const;
/** Animations are only advanced near the camera. */
const ANIMATE_DISTANCE = 450;

export interface Area {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Terrain height in a farm's local frame, relative to the farm's base height y. */
export function localHeight(b: Building, grid: DepthGrid, y: number) {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  return (lx: number, lz: number) => Math.max(0, -sampleDepth(grid, b.x + lx * c + lz * s, b.z - lx * s + lz * c)) - y;
}

/* ---------- animals ---------- */

type Species = keyof typeof LENGTH;

function useSpecies(species: Species) {
  const gltf = useGLTF(MODEL[species]);
  return useMemo(() => {
    if (species === "pig") {
      const scene = rigPig(gltf.scene);
      const clips = pigClips();
      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      return { scene, scale: LENGTH.pig / Math.max(size.x, size.z, 1e-6), lift: -box.min.y, walk: clips.walk, eat: clips.eat, idle: clips.idle };
    }
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const clip = (re: RegExp) => gltf.animations.find((a) => re.test(a.name));
    return {
      scene: gltf.scene,
      // Model is long along z (facing +z).
      scale: LENGTH[species] / Math.max(size.x, size.z, 1e-6),
      lift: -box.min.y,
      // Quaternius: Walk / Eating / Idle; Kenney Cube Pets: walk / eat / idle.
      walk: clip(/(^|\|)walk$/i),
      eat: clip(/(eating|^eat)$/i),
      idle: clip(/(^|\|)idle$/i),
    };
  }, [gltf, species]);
}

interface Animal {
  object: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: { walk?: THREE.AnimationAction; eat?: THREE.AnimationAction; idle?: THREE.AnimationAction };
  state: "walk" | "eat" | "idle";
  timer: number;
  target: THREE.Vector2;
  speed: number;
  rnd: () => number;
}

const pickTarget = (a: Animal, area: Area) =>
  a.target.set(area.x0 + a.rnd() * (area.x1 - area.x0), area.z0 + a.rnd() * (area.z1 - area.z0));

function setState(a: Animal, state: Animal["state"]) {
  const next = a.actions[state] ?? a.actions.idle;
  const prev = a.actions[a.state] ?? a.actions.idle;
  a.state = state;
  if (next && prev && next !== prev) {
    next.reset().play();
    prev.crossFadeTo(next, 0.4, false);
  }
}

/** Wandering: walk to a random point, then graze or stand for a while. */
function stepHerd(animals: Animal[], area: Area, dt: number, height: (x: number, z: number) => number, animate: boolean) {
  for (const a of animals) {
    a.timer -= dt;
    const p = a.object.position;
    if (a.state === "walk") {
      const dx = a.target.x - p.x;
      const dz = a.target.y - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3) {
        setState(a, a.rnd() < 0.7 ? "eat" : "idle");
        a.timer = 6 + a.rnd() * 14;
      } else {
        const step = Math.min(d, a.speed * dt);
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
        // Turn smoothly towards the walking direction.
        const yaw = Math.atan2(dx, dz);
        let diff = yaw - a.object.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        a.object.rotation.y += diff * Math.min(1, dt * 3);
      }
    } else if (a.timer <= 0) {
      pickTarget(a, area);
      setState(a, "walk");
    }
    p.y = height(p.x, p.z);
    if (animate) a.mixer.update(dt);
  }
}

function makeAnimal(
  species: ReturnType<typeof useSpecies>,
  kind: Species,
  area: Area,
  rnd: () => number,
  coat?: Record<string, string>,
): Animal {
  const object = cloneSkinned(species.scene);
  object.rotation.set(0, rnd() * Math.PI * 2, 0);
  const size = species.scale * (0.9 + rnd() * 0.2);
  object.scale.set(size * SHAPE[kind][0], size * SHAPE[kind][1], size * SHAPE[kind][2]);
  coat = coat ?? DEFAULT_COAT[kind];
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    // Coat colours per material name (e.g. black-and-white dairy cows).
    if (coat) {
      const paint = (m: THREE.Material) => {
        const colour = coat![m.name];
        if (!colour) return m;
        const c = (m as THREE.MeshStandardMaterial).clone();
        if (colour === "hidden") c.visible = false;
        else c.color.set(colour);
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(paint) : paint(mesh.material);
    }
  });
  const mixer = new THREE.AnimationMixer(object);
  const actions = {
    walk: species.walk && mixer.clipAction(species.walk),
    eat: species.eat && mixer.clipAction(species.eat),
    idle: species.idle && mixer.clipAction(species.idle),
  };
  const a: Animal = {
    object,
    mixer,
    actions,
    state: "eat",
    timer: rnd() * 10,
    target: new THREE.Vector2(),
    speed: WALK_SPEED[kind] * (0.85 + rnd() * 0.3),
    rnd,
  };
  object.position.set(area.x0 + rnd() * (area.x1 - area.x0), 0, area.z0 + rnd() * (area.z1 - area.z0));
  (actions.eat ?? actions.idle)?.play();
  mixer.update(rnd() * 3);
  return a;
}

const tmp = new THREE.Vector3();
/** Animals and people farther from the camera than this are hidden (m). */
export const FIGURE_DISTANCE = 280;

/** Coats: black-and-white Holstein dairy cows; beef cattle keep the model's brown. */
export const DAIRY_COAT = { Main: "#1d1c1b", Main_Light: "#f2f0ea" };
export const BEEF_COAT = { Main: "#7a4126", Main_Light: "#c9a27a" };

/** Far herds are a few pixels: not drawn at all (every animal is several skinned draw calls). */
function updateHerd(group: THREE.Group, animals: Animal[], area: Area, dt: number, height: (x: number, z: number) => number, camera: THREE.Vector3) {
  group.getWorldPosition(tmp);
  const d = tmp.distanceTo(camera);
  group.visible = d < FIGURE_DISTANCE;
  if (group.visible) stepHerd(animals, area, dt, height, d < ANIMATE_DISTANCE);
}

/** A herd wandering inside `area` (farm-local coordinates). */
export function Herd({
  kind,
  count,
  area,
  seed,
  height,
  coat,
}: {
  kind: Species;
  count: number;
  area: Area;
  seed: number;
  height: (x: number, z: number) => number;
  coat?: Record<string, string>;
}) {
  // City Pack style: Kenney Cube Pets instead of the realistic cow and pig (coats do not apply).
  const style = useCity((s) => s.houseStyle);
  const actual: Species = style === "pack" && kind === "cow" ? "cowCube" : style === "pack" && kind === "pig" ? "pigCube" : kind;
  const species = useSpecies(actual);
  const group = useMemo(() => new THREE.Group(), []);
  const animals = useMemo(() => {
    const rnd = mulberry32(seed);
    const cube = actual !== kind;
    return Array.from({ length: count }, () => makeAnimal(species, actual, area, rnd, cube ? undefined : coat));
  }, [species, actual, kind, count, area, seed, coat]);

  useEffect(() => {
    for (const a of animals) group.add(a.object);
    return () => {
      for (const a of animals) {
        group.remove(a.object);
        a.mixer.stopAllAction();
      }
    };
  }, [animals, group]);

  useFrame(({ camera }, dt) => updateHerd(group, animals, area, Math.min(dt, 0.1), height, camera.position));

  return <primitive object={group} />;
}

/* ---------- enclosures ---------- */

const fenceWood = new THREE.MeshStandardMaterial({ color: "#7d5b3d", roughness: 0.9 });
const fenceMetal = new THREE.MeshStandardMaterial({ color: "#9aa3aa", roughness: 0.5, metalness: 0.6 });
const fencePackWhite = new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.8 });
const fencePackWood = new THREE.MeshStandardMaterial({ color: "#b0784a", roughness: 0.85 });

/**
 * Fence around `area`: posts every 2.5 m following the terrain, `rails` horizontal rails,
 * and a gate gap of 4 m in the middle of the front side (−z). One merged geometry.
 */
function fenceGeometry(area: Area, height: (x: number, z: number) => number, postH: number, rails: number[], thick = 1) {
  const parts: THREE.BufferGeometry[] = [];
  const corners: [number, number][] = [
    [area.x0, area.z0],
    [area.x1, area.z0],
    [area.x1, area.z1],
    [area.x0, area.z1],
  ];
  const gate = { x: (area.x0 + area.x1) / 2, half: 2 };
  for (let side = 0; side < 4; side++) {
    const [ax, az] = corners[side];
    const [bx, bz] = corners[(side + 1) % 4];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 2.5));
    const pts = Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      return { x, z, y: height(x, z) };
    });
    for (let i = 0; i <= n; i++) {
      const p = pts[i];
      const post = new THREE.BoxGeometry(0.16 * thick, postH, 0.16 * thick).translate(p.x, p.y + postH / 2, p.z);
      parts.push(post);
      if (i === n) continue;
      const q = pts[i + 1];
      const mid = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
      if (side === 0 && Math.abs(mid.x - gate.x) < gate.half) continue;
      const seg = Math.hypot(q.x - p.x, q.z - p.z);
      const slope = Math.atan2(q.y - p.y, seg);
      for (const r of rails) {
        const rail = new THREE.BoxGeometry(seg, 0.09 * thick, 0.05 * thick);
        rail.rotateZ(slope);
        rail.rotateY(-Math.atan2(q.z - p.z, q.x - p.x));
        rail.translate(mid.x, (p.y + q.y) / 2 + r, mid.z);
        parts.push(rail);
      }
    }
  }
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  parts.forEach((g) => g.dispose());
  return merged;
}

export function Fence({
  area,
  height,
  kind,
}: {
  area: Area;
  height: (x: number, z: number) => number;
  kind: "pasture" | "pigs";
}) {
  // City Pack style: chunky white (pasture) and wooden (pig run) fences like the Kenney kits.
  const pack = useCity((s) => s.houseStyle) === "pack";
  const geometry = useMemo(
    () =>
      kind === "pasture"
        ? fenceGeometry(area, height, 1.35, [0.55, 1.15], pack ? 1.8 : 1)
        : fenceGeometry(area, height, 1.0, pack ? [0.35, 0.8] : [0.3, 0.6, 0.9], pack ? 1.8 : 1),
    [area, height, kind, pack],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = pack ? (kind === "pasture" ? fencePackWhite : fencePackWood) : kind === "pasture" ? fenceWood : fenceMetal;
  return <mesh geometry={geometry} material={material} castShadow receiveShadow />;
}

/**
 * Mud for the pig run: trampled brown earth with glossy dark puddles (wallows) and a few
 * remaining tufts of grass at the edges. Puddles reflect the sky (low roughness).
 */
let mud: THREE.MeshStandardMaterial | null = null;
export function mudMaterial() {
  if (mud) return mud;
  const m = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vMudWorld;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvMudWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vMudWorld;
        float mHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float mNoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(mHash(i), mHash(i + vec2(1, 0)), u.x), mix(mHash(i + vec2(0, 1)), mHash(i + vec2(1, 1)), u.x), u.y);
        }
        float mFbm(vec2 p) {
          float v = 0.0; float a = 0.5;
          for (int k = 0; k < 5; k++) { v += a * mNoise(p); p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.1 + 7.3; a *= 0.5; }
          return v;
        }
        float mudPuddle;`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        vec2 mp = vMudWorld.xz;
        float body = mFbm(mp * 0.18);
        float grain = mFbm(mp * 0.9) * 0.6 + mFbm(mp * 4.3) * 0.4;
        // Hoof prints and ruts: small dark speckles.
        float prints = smoothstep(0.62, 0.7, mNoise(mp * 3.1)) * 0.25;
        mudPuddle = smoothstep(0.53, 0.57, body + grain * 0.08);
        vec3 dryMud = mix(vec3(0.085, 0.056, 0.032), vec3(0.12, 0.082, 0.048), grain);
        vec3 wetMud = vec3(0.04, 0.026, 0.015);
        vec3 col = mix(dryMud, wetMud, smoothstep(0.42, 0.56, body)) * (1.0 - prints);
        // Water in the wallows: dark, slightly brown.
        col = mix(col, vec3(0.018, 0.014, 0.01), mudPuddle);
        diffuseColor.rgb = col;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `float roughnessFactor = mix(0.95, 0.06, mudPuddle);`,
      );
  };
  m.customProgramCacheKey = () => "pig-mud";
  mud = m;
  return m;
}
