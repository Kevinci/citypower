import { Tree } from "@dgreenheck/ez-tree";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildFrames } from "@/lib/city/road-geometry";
import { mulberry32 } from "@/lib/city/random";
import { useCity } from "@/lib/city/store";
import type { Profile } from "@/lib/city/grade";
import { sampleDepth, terrainHeight, WORLD_HALF, type DepthGrid } from "@/lib/city/terrain";
import { OUTER_HALF_WIDTH, type Path, type RoadKind } from "@/lib/city/types";
import { sizeOf, type Building } from "@/lib/city/economy";
import { useProfiles, useShapedGrid } from "./useProfiles";
import { useDepthGrid } from "./useWater";

/**
 * Tree variants generated with EZ-Tree (MIT). Each variant is generated once, normalised to
 * 1 m height and then instanced. `height` is the real height range in metres, `weight` how
 * often the variant is picked.
 */
const VARIANTS = [
  { preset: "Oak Medium", seed: 11, height: [10, 14], weight: 3 },
  { preset: "Oak Medium", seed: 42, height: [9, 13], weight: 3 },
  { preset: "Ash Medium", seed: 7, height: [11, 15], weight: 2 },
  { preset: "Oak Large", seed: 5, height: [13, 17], weight: 2 },
  { preset: "Ash Large", seed: 21, height: [14, 18], weight: 1 },
  { preset: "Pine Medium", seed: 3, height: [12, 17], weight: 3 },
  { preset: "Pine Large", seed: 9, height: [16, 21], weight: 1 },
  { preset: "Bush 1", seed: 2, height: [1.6, 2.6], weight: 2 },
  { preset: "Bush 2", seed: 4, height: [1.4, 2.2], weight: 2 },
] as const;

const WORLD_HALF_SIZE = 280;
const ATTEMPTS = 1800;
const CENTER_CLEARANCE = 16;
/** Distance from road centre line that must stay free of trees. */
const ROAD_CLEARANCE: Record<RoadKind, number> = { street: 15, highway: 23, bike: 5, ramp: 10 };

interface TreeVariant {
  branches: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  bark: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  foliageDepth: THREE.MeshDepthMaterial;
}

/** Shared wind clock for all foliage materials. */
const windTime = { value: 0 };

function buildVariant(preset: string, seed: number): TreeVariant {
  const tree = new Tree();
  tree.loadPreset(preset);
  tree.options.seed = seed;
  // City-sim level of detail: trees are seen from far above, so branch rings and segments
  // can be much coarser than the close-up presets.
  const branch = tree.options.branch as unknown as {
    sections: Record<string, number>;
    segments: Record<string, number>;
  };
  for (const level of Object.keys(branch.sections)) {
    branch.sections[level] = Math.max(2, Math.round(branch.sections[level] * 0.5));
  }
  for (const level of Object.keys(branch.segments)) {
    branch.segments[level] = Math.max(3, Math.round(branch.segments[level] * 0.6));
  }
  // Fewer but larger leaf cards keep crowns full at a fraction of the triangles.
  tree.options.leaves.count = Math.max(4, Math.round(tree.options.leaves.count * 0.8));
  tree.options.leaves.size *= 1.6;
  tree.generate();

  const branches = tree.branchesMesh.geometry;
  const leaves = tree.leavesMesh.geometry;

  // Normalise: base on y = 0, trunk on x = z = 0, total height 1.
  const box = new THREE.Box3();
  branches.computeBoundingBox();
  leaves.computeBoundingBox();
  if (branches.boundingBox) box.union(branches.boundingBox);
  if (leaves.boundingBox) box.union(leaves.boundingBox);
  const height = box.max.y - box.min.y || 1;
  const normalise = new THREE.Matrix4()
    .makeScale(1 / height, 1 / height, 1 / height)
    .multiply(new THREE.Matrix4().makeTranslation(0, -box.min.y, 0));
  branches.applyMatrix4(normalise);
  leaves.applyMatrix4(normalise);

  const srcBark = tree.branchesMesh.material as THREE.MeshPhongMaterial;
  const srcLeaf = tree.leavesMesh.material as THREE.MeshPhongMaterial;

  // PBR versions of the generator's materials so they react to the environment lighting.
  const bark = new THREE.MeshStandardMaterial({
    map: srcBark.map,
    normalMap: srcBark.normalMap,
    // EZ-Tree sets this on its Phong material even though Phong does not use it.
    roughnessMap: (srcBark as unknown as { roughnessMap?: THREE.Texture | null }).roughnessMap ?? null,
    aoMap: srcBark.aoMap,
    color: srcBark.color,
    roughness: 0.95,
  });

  const foliage = new THREE.MeshStandardMaterial({
    map: srcLeaf.map,
    color: srcLeaf.color,
    side: THREE.DoubleSide,
    alphaTest: srcLeaf.alphaTest || 0.5,
    roughness: 0.75,
  });
  // Instancing-aware wind: leaf tips (uv.y) sway, phase offset per tree position.
  foliage.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 treeOrigin = instanceMatrix[3].xyz;
        #else
          vec3 treeOrigin = vec3(0.0);
        #endif
        float phase = treeOrigin.x * 0.13 + treeOrigin.z * 0.11;
        float sway = sin(uTime * 1.3 + phase + position.y * 3.0) * 0.6
                   + sin(uTime * 2.9 + position.x * 9.0 + phase) * 0.25;
        transformed.x += sway * 0.010 * uv.y;
        transformed.z += sway * 0.006 * uv.y;`,
      );
  };

  // Shadows from leaf cards follow the alpha cut-out instead of solid quads.
  const foliageDepth = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: srcLeaf.map,
    alphaTest: srcLeaf.alphaTest || 0.5,
  });

  return { branches, leaves, bark, foliage, foliageDepth };
}

/** Coarse tree for the distance: trunk plus one crown solid (< 200 triangles). */
interface LowVariant {
  branches: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  bark: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
}

/** Crown colours seen from afar (the leaf textures average to roughly these). */
const CROWN_COLOUR: Record<string, string> = { Oak: "#34491f", Ash: "#3b5022", Pine: "#22331c", Bush: "#3a4f22" };

/**
 * Distance model of a variant, sized from its full model: conifers get a cone, broadleaf
 * trees and bushes a lumpy sphere spanning the leaf bounds.
 */
/**
 * Vertex colours for a far crown: dark inside and at the bottom (self-shadowed), lighter at
 * the sunlit top, with leafy speckles – a flat colour reads as a plastic blob from afar.
 */
function shadeCrown(crown: THREE.BufferGeometry, rnd: () => number) {
  crown.computeBoundingBox();
  const box = crown.boundingBox!;
  const pos = crown.attributes.position;
  const colours = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const h = (pos.getY(i) - box.min.y) / (box.max.y - box.min.y || 1);
    const v = (0.55 + 0.6 * h ** 0.8) * (0.85 + rnd() * 0.3);
    colours[i * 3] = v * 0.97;
    colours[i * 3 + 1] = v;
    colours[i * 3 + 2] = v * 0.9;
  }
  crown.setAttribute("color", new THREE.BufferAttribute(colours, 3));
}

function buildLowVariant(preset: string, high: TreeVariant): LowVariant {
  high.leaves.computeBoundingBox();
  const box = high.leaves.boundingBox ?? new THREE.Box3(new THREE.Vector3(-0.3, 0.3, -0.3), new THREE.Vector3(0.3, 1, 0.3));
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.z) * (preset.startsWith("Pine") ? 0.3 : 0.32);
  const conifer = preset.startsWith("Pine");
  let crown: THREE.BufferGeometry;
  if (conifer) {
    crown = new THREE.ConeGeometry(radius, size.y, 9, 1).translate(0, box.min.y + size.y / 2, 0);
  } else {
    // Shared vertices, so the crown is shaded smoothly instead of in facets.
    const ico = new THREE.IcosahedronGeometry(1, 2);
    ico.deleteAttribute("normal");
    ico.deleteAttribute("uv");
    crown = mergeVertices(ico);
    ico.dispose();
    // Lumpy, deterministic: push vertices in and out a little.
    const pos = crown.attributes.position;
    const rnd = mulberry32(preset.length * 97 + Math.round(size.y * 1000));
    for (let i = 0; i < pos.count; i++) {
      const f = 0.86 + rnd() * 0.24;
      pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f);
    }
    crown.scale(radius, size.y * 0.42, radius).translate(centre.x, centre.y, centre.z);
    crown.computeVertexNormals();
  }
  shadeCrown(crown, mulberry32(preset.length * 31 + 7));
  const trunkTop = box.min.y + size.y * 0.3;
  const trunk = new THREE.CylinderGeometry(0.012, 0.02, trunkTop, 5, 1, true).translate(0, trunkTop / 2, 0);
  const family = Object.keys(CROWN_COLOUR).find((k) => preset.startsWith(k)) ?? "Oak";
  return {
    branches: trunk,
    leaves: crown,
    bark: new THREE.MeshStandardMaterial({ color: "#4a3a2c", roughness: 1 }),
    foliage: new THREE.MeshStandardMaterial({ color: CROWN_COLOUR[family], roughness: 1, vertexColors: true }),
  };
}

/* ---------- City Pack style: Kenney Nature Kit trees (CC0) ---------- */

/** One Kenney model per variant above (same order: broadleaf, pines, bushes). */
const KENNEY_TREES = ["tree_default", "tree_oak", "tree_detailed", "tree_fat", "tree_tall", "tree_pineRoundA", "tree_pineTallA", "plant_bushDetailed", "plant_bushLarge"].map(
  (f) => `/models/nature/${f}.glb`,
);
KENNEY_TREES.forEach((u) => useGLTF.preload(u));
/** Leaf colours per variant: the kit's teal replaced by greens that match the lawn. */
const KENNEY_LEAVES = ["#4f9a3a", "#5aa63e", "#4a8f3a", "#58a040", "#468a36", "#2f6e3a", "#2a6534", "#4f9a3a", "#56a03e"];

/** Merges the meshes of a model (world transforms applied), keeping positions and normals only. */
function mergeParts(parts: THREE.BufferGeometry[]) {
  const clean = parts.map((g) => {
    const c = new THREE.BufferGeometry();
    c.setAttribute("position", g.attributes.position);
    c.setAttribute("normal", g.attributes.normal);
    if (g.index) c.setIndex(g.index);
    return c.index ? c.toNonIndexed() : c;
  });
  return clean.length ? mergeGeometries(clean) : null;
}

/** Kenney trees as forest variants: trunk and crown split by material, normalised to 1 m height. */
function useKenneyVariants() {
  const gltfs = useGLTF(KENNEY_TREES);
  const variants = useMemo(
    () =>
      gltfs.map((g, i) => {
        const bark: THREE.BufferGeometry[] = [];
        const leaves: THREE.BufferGeometry[] = [];
        g.scene.updateMatrixWorld(true);
        g.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
          const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name ?? "";
          (/wood|bark/i.test(name) ? bark : leaves).push(geo);
        });
        const crown = mergeParts(leaves) ?? new THREE.IcosahedronGeometry(0.4, 0);
        const trunk = mergeParts(bark) ?? new THREE.CylinderGeometry(0.03, 0.04, 0.3, 6).translate(0, 0.15, 0);
        const box = new THREE.Box3().setFromBufferAttribute(crown.attributes.position as THREE.BufferAttribute);
        box.union(new THREE.Box3().setFromBufferAttribute(trunk.attributes.position as THREE.BufferAttribute));
        const c = box.getCenter(new THREE.Vector3());
        const h = box.max.y - box.min.y || 1;
        for (const geo of [crown, trunk]) {
          geo.translate(-c.x, -box.min.y, -c.z);
          geo.scale(1 / h, 1 / h, 1 / h);
          geo.computeBoundingSphere();
        }
        const barkMat = new THREE.MeshStandardMaterial({ color: "#7a5236", roughness: 0.9 });
        const foliage = new THREE.MeshStandardMaterial({ color: KENNEY_LEAVES[i], roughness: 0.8, flatShading: true });
        const high: TreeVariant = {
          branches: trunk,
          leaves: crown,
          bark: barkMat,
          foliage,
          foliageDepth: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
        };
        // Low-poly already: the same model near and far.
        const low: LowVariant = { branches: trunk, leaves: crown, bark: barkMat, foliage };
        return { high, low };
      }),
    [gltfs],
  );
  useEffect(
    () => () => {
      for (const { high } of variants) {
        high.branches.dispose();
        high.leaves.dispose();
        high.bark.dispose();
        high.foliage.dispose();
        high.foliageDepth.dispose();
      }
    },
    [variants],
  );
  return variants;
}

function KenneyForest({ forests, capacities }: { forests: Forest[]; capacities: number[] }) {
  const variants = useKenneyVariants();
  return (
    <group>
      {variants.map((v, i) => (
        <VariantForest key={i} high={v.high} low={v.low} forest={forests[i]} capacity={capacities[i]} />
      ))}
    </group>
  );
}

interface Placement {
  x: number;
  y: number;
  z: number;
  variant: number;
  height: number;
  rot: number;
}

/** Mountain forest: extra attempts over the whole map, kept only on hills and mountains. */
const MOUNTAIN_ATTEMPTS = 4200;
/** Half size of the original map, whose trees keep their places when the world grows. */
const INNER_HALF = 700;
/** No trees above this height (tree line) … */
const TREE_LINE = 46;
/** … or on slopes steeper than this (rise per metre). */
const MAX_TREE_SLOPE = 0.85;
/** Variant indices of the conifers that dominate mountain forests. */
const CONIFERS = [5, 6, 5, 2];

/** Trunks keep this distance from the bank so crowns do not hang over the water. */
const WATER_MARGIN = 5;
/** Extra room between a track or canal edge and the nearest trunk. */
const PATH_MARGIN = 6;

/** Square cells of the obstacle hash (metres). */
const HASH_CELL = 24;

/**
 * Obstacles (paths incl. embankments, building plots) as circles in a spatial hash, so a
 * tree only tests the circles of its own cell instead of every obstacle of the map.
 */
function obstacleHash(paths: Path[], grid: DepthGrid, profiles: Map<string, Profile>, buildings: Building[]) {
  const cells = new Map<number, { x: number; z: number; r: number }[]>();
  const key = (cx: number, cz: number) => cx * 100003 + cz;
  const add = (x: number, z: number, r: number) => {
    const o = { x, z, r };
    for (let cx = Math.floor((x - r) / HASH_CELL); cx <= Math.floor((x + r) / HASH_CELL); cx++)
      for (let cz = Math.floor((z - r) / HASH_CELL); cz <= Math.floor((z + r) / HASH_CELL); cz++) {
        const k = key(cx, cz);
        const list = cells.get(k);
        if (list) list.push(o);
        else cells.set(k, [o]);
      }
  };
  for (const path of paths) {
    const r =
      path.kind in ROAD_CLEARANCE
        ? ROAD_CLEARANCE[path.kind as RoadKind]
        : OUTER_HALF_WIDTH[path.kind] + PATH_MARGIN;
    // Lifted paths need room for their embankment slopes (1:1.5).
    for (const f of buildFrames(path.points, path.kind, profiles.get(path.id))) {
      const lift = Math.max(0, f.p.y - terrainHeight(grid, f.p.x, f.p.z));
      add(f.p.x, f.p.z, r + lift * 1.5);
    }
  }
  // Buildings (farms incl. their fields) keep their plots free.
  for (const b of buildings) {
    const [w, d] = sizeOf(b);
    add(b.x, b.z, Math.hypot(w, d) / 2 + 3);
  }
  return (x: number, z: number) =>
    (cells.get(key(Math.floor(x / HASH_CELL), Math.floor(z / HASH_CELL))) ?? []).some((o) => (x - o.x) ** 2 + (z - o.z) ** 2 < o.r * o.r);
}

interface Standing {
  list: Placement[];
  /** Tree indices per grid cell (HASH_CELL). */
  cells: Map<number, number[]>;
  /** Trees on each building's plot (buildings are immutable objects). */
  hits: WeakMap<Building, number[]>;
}
const cellKey = (cx: number, cz: number) => cx * 100003 + cz;

function standingTrees(candidates: Placement[], paths: Path[], grid: DepthGrid, profiles: Map<string, Profile>, shaped: DepthGrid): Standing {
  const blocked = obstacleHash(paths, grid, profiles, []);
  const reshaped = (x: number, z: number) => shaped !== grid && Math.abs(sampleDepth(shaped, x, z) - sampleDepth(grid, x, z)) > 0.4;
  const list = candidates.filter((p) => !blocked(p.x, p.z) && !reshaped(p.x, p.z));
  const cells = new Map<number, number[]>();
  list.forEach((p, i) => {
    const k = cellKey(Math.floor(p.x / HASH_CELL), Math.floor(p.z / HASH_CELL));
    const c = cells.get(k);
    if (c) c.push(i);
    else cells.set(k, [i]);
  });
  return { list, cells, hits: new WeakMap() };
}

/** Sorted indices (as a string key) of the standing trees that lie on a building's plot. */
function felledBy(standing: Standing, buildings: Building[]): string {
  const all = new Set<number>();
  for (const b of buildings) {
    let hit = standing.hits.get(b);
    if (!hit) {
      hit = [];
      const [w, d] = sizeOf(b);
      const r = Math.hypot(w, d) / 2 + 3;
      for (let cx = Math.floor((b.x - r) / HASH_CELL); cx <= Math.floor((b.x + r) / HASH_CELL); cx++)
        for (let cz = Math.floor((b.z - r) / HASH_CELL); cz <= Math.floor((b.z + r) / HASH_CELL); cz++)
          for (const i of standing.cells.get(cellKey(cx, cz)) ?? []) {
            const p = standing.list[i];
            if ((p.x - b.x) ** 2 + (p.z - b.z) ** 2 < r * r) hit.push(i);
          }
      standing.hits.set(b, hit);
    }
    for (const i of hit) all.add(i);
  }
  return [...all].sort((a, b) => a - b).join(",");
}

/**
 * Where trees grow in the natural world (woods, mountain forests). Depends only on the
 * terrain: what is built later only removes trees, it never reshuffles the others.
 */
function treeCandidates(grid: DepthGrid): Placement[] {
  const rnd = mulberry32(1337);
  const totalWeight = VARIANTS.reduce((sum, v) => sum + v.weight, 0);
  const pick = (r: number) => {
    let acc = 0;
    for (let i = 0; i < VARIANTS.length; i++) {
      acc += VARIANTS[i].weight / totalWeight;
      if (r <= acc) return i;
    }
    return VARIANTS.length - 1;
  };

  const out: Placement[] = [];
  for (let i = 0; i < ATTEMPTS; i++) {
    const x = (rnd() * 2 - 1) * WORLD_HALF_SIZE;
    const z = (rnd() * 2 - 1) * WORLD_HALF_SIZE;
    const keepRoll = rnd();
    const variant = pick(rnd());
    const sizeRoll = rnd();
    const rot = rnd() * Math.PI * 2;

    // Woods and clearings: smooth density field, trees only where it is high enough.
    const density = 0.5 + 0.5 * Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.013 - 0.4);
    // Squared density makes woods dense and leaves open meadows in between.
    if (keepRoll > density * density * 1.4) continue;
    if (Math.hypot(x, z) < CENTER_CLEARANCE) continue;
    // No trees in water or on the lower banks.
    if (
      [
        [0, 0],
        [WATER_MARGIN, 0],
        [-WATER_MARGIN, 0],
        [0, WATER_MARGIN],
        [0, -WATER_MARGIN],
      ].some(([dx, dz]) => sampleDepth(grid, x + dx, z + dz) > 0.05)
    )
      continue;
    const [hMin, hMax] = VARIANTS[variant].height;
    out.push({ x, y: terrainHeight(grid, x, z), z, variant, height: hMin + sizeRoll * (hMax - hMin), rot });
  }

  // Mountain forests: mostly conifers on hills and mountain flanks, thinning out towards
  // the tree line, none on bare rock (steep) or snow.
  // The original map (1.400 m) keeps its trees exactly; the land around it gets the same
  // density from its own random stream.
  const inner = INNER_HALF - 20;
  const outerHalf = WORLD_HALF - 20;
  const outerRnd = mulberry32(4711);
  const outerAttempts = Math.round(MOUNTAIN_ATTEMPTS * ((outerHalf * outerHalf) / (inner * inner) - 1));
  for (let i = 0; i < MOUNTAIN_ATTEMPTS + outerAttempts; i++) {
    const r = i < MOUNTAIN_ATTEMPTS ? rnd : outerRnd;
    const half = i < MOUNTAIN_ATTEMPTS ? inner : outerHalf;
    const x = (r() * 2 - 1) * half;
    const z = (r() * 2 - 1) * half;
    const keepRoll = r();
    const variant = CONIFERS[Math.floor(r() * CONIFERS.length)];
    const sizeRoll = r();
    const rot = r() * Math.PI * 2;
    if (i >= MOUNTAIN_ATTEMPTS && Math.abs(x) < inner && Math.abs(z) < inner) continue;
    const h = terrainHeight(grid, x, z);
    if (h < 2 || h > TREE_LINE) continue;
    const gx = (terrainHeight(grid, x + 2, z) - terrainHeight(grid, x - 2, z)) / 4;
    const gz = (terrainHeight(grid, x, z + 2) - terrainHeight(grid, x, z - 2)) / 4;
    if (Math.hypot(gx, gz) > MAX_TREE_SLOPE) continue;
    // Denser in the lower forest belt, sparse near the tree line, patchy overall.
    const belt = 1 - Math.max(0, (h - 25) / (TREE_LINE - 25));
    const patch = 0.5 + 0.5 * Math.sin(x * 0.017 + 0.7) * Math.cos(z * 0.019 + 2.1);
    if (keepRoll > belt * (0.35 + 0.65 * patch)) continue;
    const [hMin, hMax] = VARIANTS[variant].height;
    out.push({ x, y: h, z, variant, height: (hMin + sizeRoll * (hMax - hMin)) * (1 - 0.3 * (h / TREE_LINE)), rot });
  }
  return out;
}

/** All trees of one variant: instance matrices and bounding spheres (x, y, z, r). */
interface Forest {
  matrices: Float32Array;
  spheres: Float32Array;
  count: number;
}

/** Trees nearer than this to the camera use the full model (and cast shadows). */
const LOD_DISTANCE = 340;
/** Trees just outside the view still cast shadows into it. */
const CULL_MARGIN = 25;

const frustum = new THREE.Frustum();
const viewProj = new THREE.Matrix4();
const sphere = new THREE.Sphere();

type MeshRef = RefObject<THREE.InstancedMesh | null>;
interface ForestMeshes {
  highBranches: MeshRef;
  highLeaves: MeshRef;
  lowBranches: MeshRef;
  lowLeaves: MeshRef;
}
/** Camera matrix and forest of the last update (skip when nothing changed). */
interface ForestState {
  last: Float32Array;
  forest: Forest | null;
}

/** Frustum culling and level of detail per tree (per frame, outside the component for the React compiler). */
function updateForest(refs: ForestMeshes, m: ForestState, forest: Forest, camera: THREE.Camera) {
  const highBranches = refs.highBranches.current;
  const highLeaves = refs.highLeaves.current;
  const lowBranches = refs.lowBranches.current;
  const lowLeaves = refs.lowLeaves.current;
  if (!highBranches || !highLeaves || !lowBranches || !lowLeaves) return;
  const e = camera.matrixWorld.elements;
  let same = m.forest === forest;
  for (let i = 0; i < 16 && same; i++) same = Math.abs(m.last[i] - e[i]) < 1e-4;
  if (same) return;
  m.last.set(e);
  m.forest = forest;
  viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(viewProj);
  const cam = camera.position;
  const hi = highBranches.instanceMatrix.array as Float32Array;
  const lo = lowBranches.instanceMatrix.array as Float32Array;
  let nh = 0;
  let nl = 0;
  const { spheres, matrices } = forest;
  for (let i = 0; i < forest.count; i++) {
    const x = spheres[i * 4];
    const y = spheres[i * 4 + 1];
    const z = spheres[i * 4 + 2];
    const r = spheres[i * 4 + 3];
    sphere.center.set(x, y, z);
    sphere.radius = r + CULL_MARGIN;
    if (!frustum.intersectsSphere(sphere)) continue;
    const near = (x - cam.x) ** 2 + (y - cam.y) ** 2 + (z - cam.z) ** 2 < LOD_DISTANCE * LOD_DISTANCE;
    if (near) hi.set(matrices.subarray(i * 16, i * 16 + 16), nh++ * 16);
    else lo.set(matrices.subarray(i * 16, i * 16 + 16), nl++ * 16);
  }
  for (const [mesh, n] of [
    [highBranches, nh],
    [highLeaves, nh],
    [lowBranches, nl],
    [lowLeaves, nl],
  ] as [THREE.InstancedMesh, number][]) {
    mesh.count = n;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, n * 16);
    mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * One tree variant: full and coarse model, each as branches + leaves. Both levels share
 * one instance buffer each between branches and leaves; `updateForest` fills them with
 * the visible trees every time the camera moves.
 */
function VariantForest({ high, low, forest, capacity: max }: { high: TreeVariant; low: LowVariant; forest: Forest; capacity: number }) {
  const highBranches = useRef<THREE.InstancedMesh>(null);
  const highLeaves = useRef<THREE.InstancedMesh>(null);
  const lowBranches = useRef<THREE.InstancedMesh>(null);
  const lowLeaves = useRef<THREE.InstancedMesh>(null);
  const state = useRef<ForestState>({ last: new Float32Array(16), forest: null });
  // Fixed per world (all candidate spots of this variant): a felled tree must not change it,
  // or the instanced meshes are recreated (a hitch whenever a new house cleared a tree).
  const capacity = Math.max(1, max, forest.count);
  useLayoutEffect(
    () => linkForest({ highBranches, highLeaves, lowBranches, lowLeaves }, state.current, high),
    [high, low, capacity],
  );
  useFrame(({ camera }) => updateForest({ highBranches, highLeaves, lowBranches, lowLeaves }, state.current, forest, camera));
  return (
    <group>
      <instancedMesh key={`hb${capacity}`} ref={highBranches} args={[high.branches, high.bark, capacity]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh key={`hl${capacity}`} ref={highLeaves} args={[high.leaves, high.foliage, capacity]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh key={`lb${capacity}`} ref={lowBranches} args={[low.branches, low.bark, capacity]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh key={`ll${capacity}`} ref={lowLeaves} args={[low.leaves, low.foliage, capacity]} castShadow receiveShadow frustumCulled={false} />
    </group>
  );
}

/** Leaves share the branches' instance buffer; leaf shadows use the alpha cut-out. */
function linkForest(refs: ForestMeshes, state: ForestState, high: TreeVariant) {
  const hb = refs.highBranches.current;
  const hl = refs.highLeaves.current;
  const lb = refs.lowBranches.current;
  const ll = refs.lowLeaves.current;
  if (!hb || !hl || !lb || !ll) return;
  hl.instanceMatrix = hb.instanceMatrix;
  ll.instanceMatrix = lb.instanceMatrix;
  hl.customDepthMaterial = high.foliageDepth;
  for (const mesh of [hb, hl, lb, ll]) mesh.count = 0;
  state.forest = null;
}

/**
 * Realistic forest: EZ-Tree variants with textured bark and alpha-cut leaves, instanced,
 * culled to the view and with a coarse level of detail in the distance. Trees are cleared
 * from everything built; the remaining ones never change.
 */
export function Trees() {
  const roads = useCity((s) => s.roads);
  const rails = useCity((s) => s.rails);
  const canals = useCity((s) => s.canals);
  const grid = useDepthGrid();
  const profiles = useProfiles();
  // Deferred: felling trees for a new house is rendered after the tick's own frame.
  const buildings = useDeferredValue(useCity((s) => s.buildings));
  // Cuttings and levelled plots (airport): trees on reshaped ground are gone.
  const shaped = useShapedGrid();

  const variants = useMemo(
    () =>
      VARIANTS.map((v) => {
        const high = buildVariant(v.preset, v.seed);
        return { high, low: buildLowVariant(v.preset, high) };
      }),
    [],
  );
  useEffect(() => {
    return () => {
      for (const { high, low } of variants) {
        high.branches.dispose();
        high.leaves.dispose();
        high.bark.dispose();
        high.foliage.dispose();
        high.foliageDepth.dispose();
        low.branches.dispose();
        low.leaves.dispose();
        low.bark.dispose();
        low.foliage.dispose();
      }
    };
  }, [variants]);

  // The natural forest of this world (once per terrain).
  const candidates = useMemo(() => treeCandidates(grid), [grid]);
  const capacities = useMemo(() => VARIANTS.map((_, i) => candidates.filter((p) => p.variant === i).length), [candidates]);
  // Trees left by roads, tracks, canals and reshaped ground (changes rarely), in a coarse grid
  // so a building finds the trees on its plot without scanning the forest.
  const standing = useMemo(() => standingTrees(candidates, [...roads, ...rails, ...canals], grid, profiles, shaped), [candidates, roads, rails, canals, grid, profiles, shaped]);
  // Which of them the buildings fell. Most new houses fell none: the key (and with it the
  // forests and their GPU buffers) then stays the same – it was a full rebuild per house.
  const felledKey = useMemo(() => felledBy(standing, buildings), [standing, buildings]);
  const forests = useMemo(() => {
    const felled = new Set(felledKey ? felledKey.split(",").map(Number) : []);
    const kept = VARIANTS.map(() => [] as Placement[]);
    standing.list.forEach((p, i) => {
      if (!felled.has(i)) kept[p.variant].push(p);
    });
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4();
    return kept.map((list): Forest => {
      const matrices = new Float32Array(list.length * 16);
      const spheres = new Float32Array(list.length * 4);
      list.forEach((p, i) => {
        position.set(p.x, p.y - 0.2, p.z);
        quaternion.setFromAxisAngle(yAxis, p.rot);
        scale.setScalar(p.height);
        m.compose(position, quaternion, scale).toArray(matrices, i * 16);
        spheres.set([p.x, p.y + p.height * 0.5, p.z, p.height * 0.6], i * 4);
      });
      return { matrices, spheres, count: list.length };
    });
  }, [standing, felledKey]);

  useFrame(({ clock }) => {
    windTime.value = clock.getElapsedTime();
  });

  const style = useCity((s) => s.houseStyle);
  const realistic = (
    <group>
      {variants.map((v, i) => (
        <VariantForest key={i} high={v.high} low={v.low} forest={forests[i]} capacity={capacities[i]} />
      ))}
    </group>
  );
  // City Pack style: Kenney trees on the same spots (the realistic forest stands in while they load).
  return style === "pack" ? (
    <Suspense fallback={realistic}>
      <KenneyForest forests={forests} capacities={capacities} />
    </Suspense>
  ) : (
    realistic
  );
}
