"use client";

import { useGLTF } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Building } from "@/lib/city/economy";
import { buildingGround } from "@/lib/city/placement";
import { sampleDepth, type DepthGrid } from "@/lib/city/terrain";
import { kenneyGrassTexture } from "./kenneyGround";

/**
 * Houses drawn with the Kenney City Kits (CC0, public/models/city/) instead of the built-in
 * box houses – the trial of the "City Pack" look (switch in the admin menu, `houseStyle`).
 *
 * Every model is one mesh with one material on a shared colour atlas, so each (model, colour
 * variant) pair is one InstancedMesh: a town of 1,000+ houses stays at a few dozen draw calls.
 * Models are fitted into the house plot of their level (uniform scale); towers are stretched
 * to the height of their level.
 */

export type Kit = "suburban" | "commercial" | "industrial";
export const VARIANTS: Record<Kit, string[]> = {
  suburban: ["colormap", "variation-a", "variation-b", "variation-c"],
  commercial: ["colormap", "variation-a", "variation-b"],
  industrial: ["colormap", "variation-a", "variation-b", "variation-c"],
};

/** Models per house level (picked per house from its id), sorted by the look of the level. */
const LEVEL_MODELS: Record<number, { kit: Kit; files: string[]; variants?: number[] }> = {
  // Bungalows and small one-and-a-half storey houses.
  1: { kit: "suburban", files: ["a", "c", "g", "h", "i", "m", "p", "q"].map((k) => `building-type-${k}`) },
  // Two-storey family and semi-detached houses with garages.
  2: { kit: "suburban", files: ["b", "d", "e", "f", "j", "k", "l", "n", "o", "r", "s", "t", "u"].map((k) => `building-type-${k}`) },
  // Town houses with three storeys.
  3: { kit: "commercial", files: ["a", "b", "c", "d", "e", "h"].map((k) => `building-${k}`) },
  // Apartment blocks.
  4: { kit: "commercial", files: ["f", "g", "i", "j", "k", "l"].map((k) => `building-${k}`) },
  // High-rises and towers: Kenney's skyscrapers, stretched to the height of the level; only the
  // grey-blue glass atlas (the warm variants turn a stretched tower into an orange column).
  5: { kit: "commercial", files: ["building-m", "building-skyscraper-a"], variants: [0] },
  6: { kit: "commercial", files: ["building-skyscraper-b", "building-skyscraper-c", "building-skyscraper-e"], variants: [0] },
  7: { kit: "commercial", files: ["building-skyscraper-d", "building-skyscraper-b"], variants: [0] },
};
/** Plot (w, d) and the total height towers are stretched to, per level (box houses: HOUSE_DIMS). */
const PLOT: Record<number, { w: number; d: number; height?: number }> = {
  1: { w: 9, d: 8 },
  2: { w: 10.5, d: 9.5 },
  3: { w: 11, d: 10 },
  4: { w: 11, d: 10 },
  5: { w: 11, d: 10, height: 40 },
  6: { w: 11, d: 10, height: 68 },
  7: { w: 11, d: 10, height: 112 },
};
/** Kenney's suburban houses face +z, the commercial buildings −z; ours face the street at local −z. */
const FACING: Record<Kit, number> = { suburban: Math.PI, commercial: 0, industrial: 0 };

const url = (kit: Kit, file: string) => `/models/city/${kit}/${file}.glb`;
const ALL = Object.values(LEVEL_MODELS).flatMap(({ kit, files }) => files.map((f) => url(kit, f)));
const UNIQUE_URLS = [...new Set(ALL)];
UNIQUE_URLS.forEach((u) => useGLTF.preload(u));

/** FNV hash of a building id: picks its model, stable for the life of the building. */
export function hash(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Colour atlases per kit and variant (matte, and glossy for the kits' "specular" parts: glass, metal). */
const atlasCache = new Map<string, THREE.MeshStandardMaterial>();
const textureCache = new Map<string, THREE.Texture>();
export function kitMaterial(kit: Kit, variant: number, glossy = false) {
  const key = `${kit}/${variant}/${glossy}`;
  let m = atlasCache.get(key);
  if (m) return m;
  const file = VARIANTS[kit][variant % VARIANTS[kit].length];
  let map = textureCache.get(`${kit}/${file}`);
  if (!map) {
    map = new THREE.TextureLoader().load(`/models/city/${kit}/Textures/${file}.png`);
    map.flipY = false; // glTF UV convention
    map.colorSpace = THREE.SRGBColorSpace;
    // A palette atlas: nearest sampling keeps the colour fields clean.
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestMipmapLinearFilter;
    textureCache.set(`${kit}/${file}`, map);
  }
  m = glossy
    ? new THREE.MeshStandardMaterial({ map, roughness: 0.25, metalness: 0.35 })
    : new THREE.MeshStandardMaterial({ map, roughness: 0.75, metalness: 0 });
  atlasCache.set(key, m);
  return m;
}
const packMaterials = () => ({
  suburban: VARIANTS.suburban.map((_, i) => kitMaterial("suburban", i)),
  commercial: VARIANTS.commercial.map((_, i) => kitMaterial("commercial", i)),
});

/** A kit model split into its parts (matte atlas, glossy "specular" atlas), centred on x/z, base at y = 0. */
export interface KitParts {
  parts: { geometry: THREE.BufferGeometry; glossy: boolean }[];
  size: THREE.Vector3;
  /** The roof: centre (x, z) and extent of the vertices in the top 12 % of the model (after centring). */
  roof: { x: number; z: number; w: number; d: number };
}

/** Loads kit models and returns their parts per url (the node scale of the files is ignored). */
export function useKitParts(urls: string[]): Map<string, KitParts> {
  const gltfs = useGLTF(urls);
  const out = useMemo(() => {
    const map = new Map<string, KitParts>();
    gltfs.forEach((g, i) => {
      const meshes: THREE.Mesh[] = [];
      g.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
      });
      const box = new THREE.Box3();
      for (const m of meshes) {
        m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox!);
      }
      const c = box.getCenter(new THREE.Vector3());
      const parts = meshes.map((m) => {
        const geometry = m.geometry.clone();
        geometry.translate(-c.x, -box.min.y, -c.z);
        const name = (Array.isArray(m.material) ? m.material[0] : m.material).name ?? "";
        return { geometry, glossy: name.includes("specular") };
      });
      const size = box.getSize(new THREE.Vector3());
      // Roof: the topmost part of the model (awnings and annexes lower down do not count).
      const top = new THREE.Box3();
      for (const p of parts) {
        const pos = p.geometry.attributes.position as THREE.BufferAttribute;
        for (let k = 0; k < pos.count; k++) if (pos.getY(k) > size.y * 0.88) top.expandByPoint(new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)));
      }
      const roof = top.isEmpty()
        ? { x: 0, z: 0, w: size.x, d: size.z }
        : { x: (top.min.x + top.max.x) / 2, z: (top.min.z + top.max.z) / 2, w: top.max.x - top.min.x, d: top.max.z - top.min.z };
      map.set(urls[i], { parts, size, roof });
    });
    return map;
  }, [gltfs, urls]);
  useEffect(() => () => out.forEach((k) => k.parts.forEach((p) => p.geometry.dispose())), [out]);
  return out;
}

interface ModelGeometry {
  geometry: THREE.BufferGeometry;
  size: THREE.Vector3;
}

/** Geometry of every model, centred on x/z with its base at y = 0. */
function useModels(): Map<string, ModelGeometry> {
  const gltfs = useGLTF(UNIQUE_URLS);
  return useMemo(() => {
    const out = new Map<string, ModelGeometry>();
    gltfs.forEach((g, i) => {
      let mesh: THREE.Mesh | null = null;
      g.scene.traverse((o) => {
        if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
      });
      if (!mesh) return;
      const geometry = (mesh as THREE.Mesh).geometry.clone();
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const centre = box.getCenter(new THREE.Vector3());
      geometry.translate(-centre.x, -box.min.y, -centre.z);
      out.set(UNIQUE_URLS[i], { geometry, size: box.getSize(new THREE.Vector3()) });
    });
    return out;
  }, [gltfs]);
}

interface Group {
  key: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrices: THREE.Matrix4[];
}

function PackInstances({ group }: { group: Group }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    group.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.count = group.matrices.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [group]);
  return <instancedMesh ref={ref} args={[group.geometry, group.material, group.matrices.length]} castShadow receiveShadow />;
}

/** All houses as City Kit models, one InstancedMesh per (model, colour variant). */
export function HousePack({ houses, grid }: { houses: Building[]; grid: DepthGrid }) {
  const models = useModels();
  const groups = useMemo(() => {
    const byKey = new Map<string, Group>();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const b of houses) {
      const spec = LEVEL_MODELS[b.level] ?? LEVEL_MODELS[1];
      const plot = PLOT[b.level] ?? PLOT[1];
      const h = hash(b.id);
      const file = spec.files[h % spec.files.length];
      const model = models.get(url(spec.kit, file));
      if (!model) continue;
      const choices = spec.variants ?? VARIANTS[spec.kit].map((_, i) => i);
      const variant = choices[(b.variant + (h >>> 8)) % choices.length];
      // Fit into the plot, keep proportions; towers get the height of their level.
      const s = Math.min(plot.w / model.size.x, plot.d / model.size.z);
      const sy = plot.height ? plot.height / model.size.y : s;
      q.setFromAxisAngle(up, b.rot + FACING[spec.kit]);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(b.x, buildingGround(b, grid), b.z), q, new THREE.Vector3(s, sy, s));
      const key = `${spec.kit}/${file}/${variant}`;
      let g = byKey.get(key);
      if (!g) {
        g = { key, geometry: model.geometry, material: kitMaterial(spec.kit, variant), matrices: [] };
        byKey.set(key, g);
      }
      g.matrices.push(m);
    }
    return [...byKey.values()];
  }, [houses, grid, models]);
  useEffect(() => () => models.forEach((m) => m.geometry.dispose()), [models]);
  return (
    <group>
      {groups.map((g) => (
        // Remount when the instance count changes (InstancedMesh capacity is fixed).
        <PackInstances key={`${g.key}:${g.matrices.length}`} group={g} />
      ))}
    </group>
  );
}

/* ---------- gardens: lawn, fence, trees, path (houses of level 1 and 2) ---------- */

/**
 * The City Kits bring paths, stepping stones and driveways but no grass tiles, so the lawn is
 * made here: a mown lawn with light/dark stripes (canvas texture) and a few clover spots.
 */
function lawnTexture() {
  return kenneyGrassTexture();
}

/** Garden in local house coordinates (front −z towards the street, house 10 m deep around 0). */
const GARDEN = { x0: -6.6, x1: 6.6, z0: -6.8, z1: 9 };
/** Lawn top above the house base; the slab reaches this far down (shows as a low garden edge on slopes). */
const LAWN_TOP = 0.05;
const LAWN_DEPTH = 0.6;

/** Wooden fence round the back garden: posts and two rails, merged into one geometry. */
function fenceGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const add = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const b = new THREE.BoxGeometry(w, h, d);
    b.translate(x, y, z);
    parts.push(b);
  };
  const { x0, x1, z1 } = GARDEN;
  const zs = 0.5; // the fence starts at the house's back half
  // Back side and both sides.
  for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / 8) add(0.12, 1.1, 0.12, x, 0.55, z1);
  for (const x of [x0, x1]) for (let z = zs; z < z1; z += (z1 - zs) / 5) add(0.12, 1.1, 0.12, x, 0.55, z);
  for (const y of [0.4, 0.85]) {
    add(x1 - x0, 0.08, 0.05, 0, y, z1);
    for (const x of [x0, x1]) add(0.05, 0.08, z1 - zs, x, y, (zs + z1) / 2);
  }
  const merged = mergeBoxes(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

/** Merges non-indexed copies of box geometries (positions and normals only). */
function mergeBoxes(parts: THREE.BufferGeometry[]) {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const p of parts) {
    const g = p.toNonIndexed();
    pos.push(...(g.attributes.position.array as Float32Array));
    nor.push(...(g.attributes.normal.array as Float32Array));
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}

const DECO = {
  treeLarge: "/models/city/suburban/tree-large.glb",
  treeSmall: "/models/city/suburban/tree-small.glb",
  path: "/models/city/suburban/path-stones-long.glb",
  planter: "/models/city/suburban/planter.glb",
};
const DECO_URLS = Object.values(DECO);
DECO_URLS.forEach((u) => useGLTF.preload(u));

let gardenMats: { lawn: THREE.MeshStandardMaterial; fence: THREE.MeshStandardMaterial } | null = null;
function gardenMaterials() {
  gardenMats ??= {
    lawn: new THREE.MeshStandardMaterial({ map: lawnTexture(), roughness: 0.95 }),
    fence: new THREE.MeshStandardMaterial({ color: "#9a6440", roughness: 0.85 }),
  };
  return gardenMats;
}

/** Lawn slab: unit box from y = −1 to 0, scaled per garden; the texture repeats a few times across it. */
function lawnGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, -0.5, 0);
  // Stripes run front to back: repeat the texture about every 4 m of a 13 m garden.
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3.3, uv.getY(i) * 4);
  return g;
}

interface Inst {
  m: THREE.Matrix4;
}

function GardenInstances({ geometry, material, items, shadow = true }: { geometry: THREE.BufferGeometry; material: THREE.Material; items: Inst[]; shadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((it, i) => mesh.setMatrixAt(i, it.m));
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  if (items.length === 0) return null;
  return <instancedMesh key={items.length} ref={ref} args={[geometry, material, items.length]} castShadow={shadow} receiveShadow />;
}

/**
 * Gardens round the small houses (levels 1 and 2): a mown lawn, on most a wooden fence round
 * the back garden, one or two trees, stepping stones to the street, sometimes a planter.
 * Gardens on slopes the lawn cannot cover (> 0.5 m below, or ground above it) keep the meadow.
 */
export function Gardens({ houses, grid }: { houses: Building[]; grid: DepthGrid }) {
  const gltfs = useGLTF(DECO_URLS);
  const deco = useMemo(() => {
    const out: Record<string, { geometry: THREE.BufferGeometry; size: THREE.Vector3 }> = {};
    gltfs.forEach((g, i) => {
      let mesh: THREE.Mesh | null = null;
      g.scene.traverse((o) => {
        if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
      });
      if (!mesh) return;
      const geometry = (mesh as THREE.Mesh).geometry.clone();
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const c = box.getCenter(new THREE.Vector3());
      geometry.translate(-c.x, -box.min.y, -c.z);
      out[DECO_URLS[i]] = { geometry, size: box.getSize(new THREE.Vector3()) };
    });
    return out;
  }, [gltfs]);
  const shared = useMemo(() => ({ lawn: lawnGeometry(), fence: fenceGeometry() }), []);
  useEffect(
    () => () => {
      shared.lawn.dispose();
      shared.fence.dispose();
      Object.values(deco).forEach((d) => d.geometry.dispose());
    },
    [shared, deco],
  );

  const sets = useMemo(() => {
    const lawns: Inst[] = [];
    const fences: Inst[] = [];
    const trees: Record<string, Inst[]> = { [DECO.treeLarge]: [], [DECO.treeSmall]: [] };
    const paths: Inst[] = [];
    const planters: Inst[] = [];
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const { x0, x1, z0, z1 } = GARDEN;
    for (const b of houses) {
      if (b.level > 2) continue;
      const base = buildingGround(b, grid);
      const cos = Math.cos(b.rot);
      const sin = Math.sin(b.rot);
      const world = (lx: number, lz: number) => ({ x: b.x + lx * cos + lz * sin, z: b.z - lx * sin + lz * cos });
      // The lawn only where the ground stays within reach of a flat slab.
      const corners = [world(x0, z0), world(x1, z0), world(x0, z1), world(x1, z1), world(0, z1)];
      const heights = corners.map((p) => -sampleDepth(grid, p.x, p.z));
      if (heights.some((h) => h > base + LAWN_TOP - 0.02 || h < base - LAWN_DEPTH + 0.1)) continue;
      const h = hash(b.id);
      q.setFromAxisAngle(up, b.rot);
      const at = (lx: number, lz: number, y: number) => {
        const p = world(lx, lz);
        return new THREE.Vector3(p.x, y, p.z);
      };
      // Tiny height jitter: neighbouring lawns that touch do not flicker.
      const top = base + LAWN_TOP + (h % 7) * 0.002;
      lawns.push({ m: new THREE.Matrix4().compose(at((x0 + x1) / 2, (z0 + z1) / 2, top), q, new THREE.Vector3(x1 - x0, LAWN_DEPTH, z1 - z0)) });
      if (h % 10 < 7) fences.push({ m: new THREE.Matrix4().compose(at(0, 0, top), q, new THREE.Vector3(1, 1, 1)) });
      // One or two trees in the back garden.
      const tl = deco[DECO.treeLarge];
      const ts = deco[DECO.treeSmall];
      const spots: [number, number][] = [
        [-3.8, 6.5],
        [3.6, 7],
      ];
      spots.slice(0, 1 + ((h >>> 4) % 2)).forEach(([lx, lz], i) => {
        const large = ((h >>> (6 + i)) & 1) === 1;
        const model = large ? tl : ts;
        if (!model) return;
        const s = (large ? 6.5 : 5.5) / model.size.y;
        const spin = new THREE.Quaternion().setFromAxisAngle(up, (h % 360) * 0.0174);
        (large ? trees[DECO.treeLarge] : trees[DECO.treeSmall]).push({ m: new THREE.Matrix4().compose(at(lx, lz, top), spin, new THREE.Vector3(s, s, s)) });
      });
      // Stepping stones from the front door to the pavement.
      const path = deco[DECO.path];
      if (path) {
        const len = -5 - z0; // from the house front to the garden edge
        paths.push({ m: new THREE.Matrix4().compose(at(0, (z0 - 5) / 2, top + 0.01), q, new THREE.Vector3(1.4 / path.size.x, 1, len / path.size.z)) });
      }
      const planter = deco[DECO.planter];
      if (planter && h % 3 === 0) planters.push({ m: new THREE.Matrix4().compose(at(2.6, -6, top), q, new THREE.Vector3(3.5, 3.5, 3.5)) });
    }
    return { lawns, fences, trees, paths, planters };
  }, [houses, grid, deco]);

  const mats = gardenMaterials();
  const atlas = packMaterials().suburban[0];
  return (
    <group>
      <GardenInstances geometry={shared.lawn} material={mats.lawn} items={sets.lawns} shadow={false} />
      <GardenInstances geometry={shared.fence} material={mats.fence} items={sets.fences} />
      {Object.entries(sets.trees).map(([u, items]) =>
        deco[u] ? <GardenInstances key={u} geometry={deco[u].geometry} material={atlas} items={items} /> : null,
      )}
      {deco[DECO.path] && <GardenInstances geometry={deco[DECO.path].geometry} material={atlas} items={sets.paths} shadow={false} />}
      {deco[DECO.planter] && <GardenInstances geometry={deco[DECO.planter].geometry} material={atlas} items={sets.planters} />}
    </group>
  );
}
