import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32 } from "@/lib/city/random";
import { useKitParts, type KitParts } from "./HousePack";
import { KitModel } from "./PackBuildings";

/**
 * The mayor's villa (Bürgermeistervilla → Luxusvilla → Traumvilla) on its fixed 56 × 48 m plot,
 * local coordinates with the street side at −z (gate in the middle of the front fence).
 *
 * Assembled from Kenney kits (CC0): the modern flat-roofed houses of the Suburban kit as main
 * house and wings (`building-type-p` two storeys, `q` bungalow with carport), parasols from the
 * Commercial kit, cypresses and oaks from the Nature kit, sports cars and a luxury SUV from the
 * Car kit. Pool, whirlpool, garage, rose garden and the ornate fence are simple boxes in the
 * Kenney colours. The plot stands on a stone base reaching 14 m down: on a mountain the
 * levelled plot is cut into the slope (`levelPads`) and the base shows as a retaining wall.
 */

const SUB = (k: string) => `/models/city/suburban/building-type-${k}.glb`;
const PARASOL = "/models/city/commercial/detail-parasol-a.glb";
// Flat-roofed models of the Suburban kit (measured: only p and q have a flat top).
const KIT_URLS = [SUB("p"), SUB("q"), PARASOL];
const CAR = (k: string) => `/models/vehicles/cars/${k}.glb`;
const TREE = (k: string) => `/models/nature/${k}.glb`;
/** Luxury cars per garage bay: length, width, height in metres (see VEHICLES in Traffic.tsx). */
const CARS: { url: string; size: [number, number, number] }[] = [
  { url: CAR("sedan-sports"), size: [4.5, 1.85, 1.3] },
  { url: CAR("suv-luxury"), size: [4.95, 1.95, 1.75] },
  { url: CAR("hatchback-sports"), size: [4.15, 1.78, 1.42] },
];
const PROP_URLS = [...CARS.map((c) => c.url), TREE("tree_pineTallA"), TREE("tree_oak"), TREE("plant_bushLarge")];

/* ---------- materials (module singletons) ---------- */

let mats: ReturnType<typeof makeMaterials> | null = null;
function makeMaterials() {
  const std = (color: string, roughness = 0.85, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  return {
    plinth: std("#a79d8b", 0.95),
    stone: std("#e2dccd", 0.8),
    lawn: std("#33956e", 0.95),
    paving: std("#ece5d3", 0.75),
    drive: std("#81869c", 0.9),
    gravel: std("#d8cdb3", 1),
    water: std("#38b6e6", 0.08, { emissive: new THREE.Color("#0b5a7a"), emissiveIntensity: 0.35 }),
    whirl: std("#8ee6f7", 0.15, { emissive: new THREE.Color("#2aa6c9"), emissiveIntensity: 0.4 }),
    iron: std("#22262b", 0.45, { metalness: 0.6 }),
    gold: std("#e0ad2a", 0.3, { metalness: 0.9 }),
    hedge: std("#2a6f45", 0.9, { flatShading: true }),
    white: std("#f4f6f8", 0.7),
    trim: std("#3d4650", 0.6),
    door: std("#5b6670", 0.5, { metalness: 0.3 }),
    lounger: std("#ffffff", 0.6),
    cushion: std("#1a8fc8", 0.8),
    lantern: new THREE.MeshStandardMaterial({ color: "#fff3c4", emissive: new THREE.Color("#ffd27a"), emissiveIntensity: 1.2, toneMapped: false }),
    flowers: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true }),
    leaves: std("#4f9a3a", 0.8, { flatShading: true }),
    bark: std("#7a5434", 0.9),
  };
}
const materials = () => (mats ??= makeMaterials());

/* ---------- geometry helpers ---------- */

const unitBox = new THREE.BoxGeometry(1, 1, 1);
/** Box: x/z centre, from y0 to y1, size w × d. */
type BoxSpec = [x: number, z: number, w: number, d: number, y0: number, y1: number];

/** Many boxes of one material merged into one geometry. */
function mergeBoxes(list: BoxSpec[]): THREE.BufferGeometry {
  if (list.length === 0) return new THREE.BufferGeometry();
  return mergeGeometries(
    list.map(([x, z, w, d, y0, y1]) => unitBox.clone().scale(w, y1 - y0, d).translate(x, (y0 + y1) / 2, z)),
  )!;
}

function Boxes({ list, m, shadow = true }: { list: BoxSpec[]; m: THREE.Material; shadow?: boolean }) {
  const geometry = useMemo(() => mergeBoxes(list), [list]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} material={m} castShadow={shadow} receiveShadow />;
}

/** A loaded model (car, tree) cloned once, scaled to real size per axis (`size` = x, y, z in m) or to a height. */
function Prop({ url, x, z, y = 0, rot = 0, size, height, recolour }: { url: string; x: number; z: number; y?: number; rot?: number; size?: [number, number, number]; height?: number; recolour?: boolean }) {
  const { scene } = useGLTF(url);
  const object = useMemo(() => cloneScaled(scene, size, height, recolour), [scene, size, height, recolour]);
  return <primitive object={object} position={[x, y, z]} rotation={[0, rot, 0]} />;
}

function cloneScaled(scene: THREE.Object3D, size?: [number, number, number], height?: number, recolour?: boolean) {
  const inner = scene.clone(true);
  inner.position.set(0, 0, 0);
  inner.rotation.set(0, 0, 0);
  inner.scale.set(1, 1, 1);
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const s = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  // Cars lie along z in the kit; a model longer along x is turned so its length runs along z.
  const turn = size && s.x > s.z;
  const holder = new THREE.Group();
  const pivot = new THREE.Group();
  inner.position.set(-c.x, -box.min.y, -c.z);
  pivot.add(inner);
  if (turn) pivot.rotation.y = Math.PI / 2;
  const [lx, lz] = turn ? [s.z, s.x] : [s.x, s.z];
  if (size) holder.scale.set(size[1] / lx, size[2] / s.y, size[0] / lz);
  else if (height) holder.scale.setScalar(height / s.y);
  holder.add(pivot);
  const m = materials();
  holder.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (recolour) {
      // Nature kit: trunk by material name, everything else turns from kit turquoise to leaf green.
      const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name ?? "";
      mesh.material = /wood|bark|trunk/i.test(name) ? m.bark : m.leaves;
    }
  });
  return holder;
}

/** Rose and flower beds: small blossoms (merged, coloured per vertex) on green bushes. */
function flowerBed(beds: { x: number; z: number; w: number; d: number; roses?: boolean }[], seed: number) {
  const rnd = mulberry32(seed);
  const bush = new THREE.IcosahedronGeometry(0.42, 0);
  const bloom = new THREE.IcosahedronGeometry(0.16, 0);
  const ROSES = ["#c8102e", "#e0457b", "#f4f1ea", "#b0103a", "#f3a6c0"];
  const MIXED = ["#f2c230", "#e8732c", "#8e5bd0", "#f4f1ea", "#d63c5e", "#4a7fd6"];
  const parts: THREE.BufferGeometry[] = [];
  const colour = new THREE.Color();
  const tinted = (g: THREE.BufferGeometry, hex: string, x: number, y: number, z: number, s = 1) => {
    const p = g.clone().scale(s, s, s).translate(x, y, z);
    const n = p.attributes.position.count;
    colour.set(hex);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([colour.r, colour.g, colour.b], i * 3);
    p.setAttribute("color", new THREE.BufferAttribute(col, 3));
    parts.push(p);
  };
  for (const b of beds) {
    const palette = b.roses ? ROSES : MIXED;
    for (let x = b.x - b.w / 2 + 0.5; x <= b.x + b.w / 2 - 0.4; x += 0.9) {
      for (let z = b.z - b.d / 2 + 0.5; z <= b.z + b.d / 2 - 0.4; z += 0.9) {
        const jx = x + (rnd() - 0.5) * 0.3;
        const jz = z + (rnd() - 0.5) * 0.3;
        const s = 0.8 + rnd() * 0.4;
        tinted(bush, "#2f7d3c", jx, 0.35 * s, jz, s);
        const hex = palette[Math.floor(rnd() * palette.length)];
        for (let k = 0; k < 4; k++) tinted(bloom, hex, jx + (rnd() - 0.5) * 0.55, 0.55 * s + rnd() * 0.25, jz + (rnd() - 0.5) * 0.55);
      }
    }
  }
  const g = parts.length ? mergeGeometries(parts)! : new THREE.BufferGeometry();
  bush.dispose();
  bloom.dispose();
  return g;
}

function Flowers({ beds, seed }: { beds: { x: number; z: number; w: number; d: number; roses?: boolean }[]; seed: number }) {
  const geometry = useMemo(() => flowerBed(beds, seed), [beds, seed]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} material={materials().flowers} castShadow receiveShadow />;
}

/* ---------- layout ---------- */

const W = 56;
const D = 48;
/** Fence line (inset from the plot edge) and the gate opening in the front fence. */
const FX = W / 2 - 0.6;
const FZ = D / 2 - 0.6;
const GATE = 4;

/** Ornate fence: stone pillars, iron bars between them, gold caps from level 2, the gate with lanterns. */
function fenceParts(level: number) {
  const pillars: BoxSpec[] = [];
  const iron: BoxSpec[] = [];
  const gold: BoxSpec[] = [];
  const lamps: BoxSpec[] = [];
  const h = level >= 3 ? 2.2 : 1.9;
  const run = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 5.5));
    const along = x0 === x1 ? "z" : "x";
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      pillars.push([x, z, 0.7, 0.7, 0, h + 0.2]);
      if (level >= 2) gold.push([x, z, 0.5, 0.5, h + 0.2, h + 0.45]);
      if (level >= 3) gold.push([x, z, 0.22, 0.22, h + 0.45, h + 0.75]);
      if (i === n) continue;
      // Bars and two rails to the next pillar.
      const x2 = x0 + (x1 - x0) * ((i + 1) / n);
      const z2 = z0 + (z1 - z0) * ((i + 1) / n);
      const seg = Math.hypot(x2 - x, z2 - z) - 0.7;
      const cx = (x + x2) / 2;
      const cz = (z + z2) / 2;
      for (const y of [0.25, h - 0.15]) iron.push(along === "x" ? [cx, cz, seg, 0.08, y, y + 0.08] : [cx, cz, 0.08, seg, y, y + 0.08]);
      const bars = Math.floor(seg / 0.24);
      for (let k = 0; k < bars; k++) {
        const f = (k + 0.5) / bars - 0.5;
        const bx = along === "x" ? cx + f * seg : cx;
        const bz = along === "z" ? cz + f * seg : cz;
        iron.push([bx, bz, 0.05, 0.05, 0.1, h]);
        // Gold spear tips on the Traumvilla.
        if (level >= 3) gold.push([bx, bz, 0.09, 0.09, h, h + 0.12]);
      }
    }
  };
  run(-FX, FZ, FX, FZ);
  run(-FX, -FZ, -FX, FZ);
  run(FX, -FZ, FX, FZ);
  run(-FX, -FZ, -GATE - 0.6, -FZ);
  run(GATE + 0.6, -FZ, FX, -FZ);
  // Gate: two big pillars with lanterns (and gold balls), two iron leaves with a gold top rail.
  const gh = level >= 3 ? 3.6 : 3;
  for (const x of [-GATE - 0.6, GATE + 0.6]) {
    pillars.push([x, -FZ, 1.2, 1.2, 0, gh]);
    pillars.push([x, -FZ, 1.45, 1.45, gh, gh + 0.25]);
    lamps.push([x, -FZ, 0.45, 0.45, gh + 0.25, gh + 0.85]);
    if (level >= 2) gold.push([x, -FZ, 0.6, 0.6, gh + 0.85, gh + 1]);
  }
  for (const side of [-1, 1]) {
    const cx = side * GATE / 2;
    iron.push([cx, -FZ, GATE - 0.1, 0.1, 0.15, 0.3]);
    iron.push([cx, -FZ, GATE - 0.1, 0.1, gh - 0.6, gh - 0.45]);
    for (let k = 0; k < 15; k++) {
      const bx = cx + ((k + 0.5) / 15 - 0.5) * (GATE - 0.2);
      // Leaves rise towards the middle (an arch).
      const top = gh - 0.45 + Math.sin(((k + 0.5) / 15) * Math.PI * 0.5 * (side < 0 ? 1 : -1) + (side < 0 ? 0 : Math.PI / 2)) * 0.6;
      iron.push([bx, -FZ, 0.06, 0.06, 0.15, top]);
      gold.push([bx, -FZ, 0.11, 0.11, top, top + 0.12]);
    }
    gold.push([cx, -FZ, GATE - 0.1, 0.12, gh - 0.75, gh - 0.62]);
    // Emblem in the middle of each leaf.
    gold.push([cx, -FZ, 0.9, 0.14, 1.2, 2.1]);
  }
  return { pillars, iron, gold, lamps };
}

function Fence({ level }: { level: number }) {
  const m = materials();
  const parts = useMemo(() => fenceParts(level), [level]);
  return (
    <>
      <Boxes list={parts.pillars} m={m.stone} />
      <Boxes list={parts.iron} m={m.iron} />
      <Boxes list={parts.gold} m={m.gold} />
      <Boxes list={parts.lamps} m={m.lantern} shadow={false} />
    </>
  );
}

/** Rectangular pool: stone rim round the water, top at y = 0.3. */
function poolBoxes(cx: number, cz: number, w: number, d: number): { rim: BoxSpec[]; water: BoxSpec[] } {
  const r = 0.6;
  return {
    rim: [
      [cx, cz - d / 2 - r / 2, w + 2 * r, r, 0, 0.32],
      [cx, cz + d / 2 + r / 2, w + 2 * r, r, 0, 0.32],
      [cx - w / 2 - r / 2, cz, r, d, 0, 0.32],
      [cx + w / 2 + r / 2, cz, r, d, 0, 0.32],
    ],
    water: [[cx, cz, w, d, 0, 0.24]],
  };
}

const POOL: Record<number, [number, number, number, number]> = { 1: [16, -7, 10, 5], 2: [17, -6.5, 12, 6], 3: [18.5, -6.5, 15, 7] };
const BAYS = [0, 1, 2, 3];
/** Cypresses evenly along the back fence: 4 / 6 / 9 per level. */
const CYPRESSES: Record<number, number[]> = Object.fromEntries(
  [1, 2, 3].map((l) => {
    const n = [0, 4, 6, 9][l];
    return [l, Array.from({ length: n }, (_, i) => -FX + 2 + (i * (2 * FX - 4)) / (n - 1))];
  }),
);

export function Villa({ level }: { level: number }) {
  const lv = Math.max(1, Math.min(3, level));
  const m = materials();
  const kit = useKitParts(KIT_URLS);
  const [house, bungalow, parasol] = KIT_URLS.map((u) => kit.get(u)) as (KitParts | undefined)[];

  const flat = useMemo(() => {
    const [pcx, pcz, pw, pd] = POOL[lv];
    const pool = poolBoxes(pcx, pcz, pw, pd);
    const bays = BAYS[lv];
    const gw = bays * 4.4 + 0.8;
    const gx = -FX + 0.8 + gw / 2;
    const paving: BoxSpec[] = [
      // Pool deck, terrace in front of the house (from level 2).
      [16, -7.5, 22, 15, 0, 0.06],
      ...(lv >= 2 ? ([[6, 4.8, 32, 4.4, 0, 0.06]] as BoxSpec[]) : []),
    ];
    const drive: BoxSpec[] = [
      [0, -FZ / 2 - 1.5, 6, FZ - 3, 0, 0.05],
      [(-FX + 3) / 2, -1, FX + 3, 7, 0, 0.05],
    ];
    // Garage: white box with a dark roof slab and one door per bay.
    const garage: BoxSpec[] = [[gx, 6.5, gw, 7, 0, 3.2]];
    const garageTrim: BoxSpec[] = [[gx, 6.5, gw + 0.5, 7.5, 3.2, 3.5]];
    const doors: BoxSpec[] = [];
    for (let i = 0; i < bays; i++) doors.push([-FX + 0.8 + 0.4 + 2.2 + i * 4.4, 2.97, 3.6, 0.1, 0.05, 2.6]);
    // Loungers along the pool, cushions on them.
    const loungers: BoxSpec[] = [];
    const cushions: BoxSpec[] = [];
    const nLoungers = lv * 2;
    for (let i = 0; i < nLoungers; i++) {
      const x = pcx - pw / 2 + 0.8 + i * ((pw - 1.6) / Math.max(1, nLoungers - 1));
      const z = pcz + pd / 2 + 2.3;
      loungers.push([x, z, 0.8, 2, 0, 0.35]);
      cushions.push([x, z + 0.1, 0.7, 1.6, 0.35, 0.45]);
    }
    // Whirlpool (round: a short cylinder approximated with boxes would look poor – see below).
    // Rose garden with hedges and gravel paths (levels 2–3), flower strips along the drive.
    const hedges: BoxSpec[] = [];
    const gravel: BoxSpec[] = [];
    const beds: { x: number; z: number; w: number; d: number; roses?: boolean }[] = [
      { x: -4.6, z: -14, w: 1.6, d: 16 },
      { x: 4.6, z: -14, w: 1.6, d: 16 },
    ];
    if (lv >= 2) {
      const x0 = -FX + 1.5;
      const x1 = lv >= 3 ? -6.5 : -9;
      const z0 = -FZ + 1.5;
      const z1 = -6;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const hw = x1 - x0;
      const hd = z1 - z0;
      // Low box hedge round the garden with an opening to the drive, gravel cross.
      hedges.push([cx, z0, hw, 0.7, 0, 0.8], [cx, z1, hw, 0.7, 0, 0.8], [x0, cz, 0.7, hd, 0, 0.8], [x1, cz - hd / 4 - 1, 0.7, hd / 2 - 2, 0, 0.8], [x1, cz + hd / 4 + 1, 0.7, hd / 2 - 2, 0, 0.8]);
      gravel.push([cx, cz, hw - 1, 1.6, 0, 0.04], [cx, cz, 1.6, hd - 1, 0, 0.04]);
      const qw = (hw - 3.4) / 2;
      const qd = (hd - 3.4) / 2;
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) beds.push({ x: cx + sx * (qw / 2 + 0.9), z: cz + sz * (qd / 2 + 0.9), w: qw, d: qd, roses: true });
      if (lv >= 3) {
        // Flower beds in front of the house and along the terrace.
        beds.push({ x: -2, z: 1.3, w: 10, d: 1.4 }, { x: 9, z: 1.3, w: 6, d: 1.4 });
      }
    }
    return { pool, paving, drive, garage, garageTrim, doors, loungers, cushions, hedges, gravel, beds, bays, gx };
  }, [lv]);

  const [pcx, pcz, pw, pd] = POOL[lv];
  // Rose garden centre (fountain and rose arch on the Traumvilla).
  const gardenX = (-FX + 1.5 + (lv >= 3 ? -6.5 : -9)) / 2;
  const gardenZ = (-FZ + 1.5 - 6) / 2;

  return (
    <group>
      {/* Stone base: on a slope it shows as a retaining wall below the levelled plot. */}
      <mesh geometry={unitBox} material={m.plinth} position={[0, -7, 0]} scale={[W + 0.6, 14, D + 0.6]} receiveShadow />
      <mesh material={m.lawn} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
      </mesh>
      <Boxes list={flat.drive} m={m.drive} shadow={false} />
      <Boxes list={flat.paving} m={m.paving} shadow={false} />
      <Boxes list={flat.pool.rim} m={m.stone} />
      <Boxes list={flat.pool.water} m={m.water} shadow={false} />
      <Boxes list={flat.loungers} m={m.lounger} />
      <Boxes list={flat.cushions} m={m.cushion} />
      {flat.hedges.length > 0 && <Boxes list={flat.hedges} m={m.hedge} />}
      {flat.gravel.length > 0 && <Boxes list={flat.gravel} m={m.gravel} shadow={false} />}
      <Flowers beds={flat.beds} seed={17 + lv} />
      <Fence level={lv} />

      {/* Garage with the luxury cars parked in front, nose in. */}
      <Boxes list={flat.garage} m={m.white} />
      <Boxes list={flat.garageTrim} m={m.trim} />
      <Boxes list={flat.doors} m={m.door} shadow={false} />
      {CARS.slice(0, flat.bays).map((c, i) => (
        <Prop key={c.url} url={c.url} x={-FX + 0.8 + 0.4 + 2.2 + i * 4.4} z={-0.6} size={c.size} />
      ))}

      {/* Main house (modern, flat roof) and its wing. */}
      {house && <KitModel model={house} kit="suburban" variant={0} x={lv >= 3 ? -1 : 0} z={14} s={[0, 11.5, 13.5, 15][lv]} sy={[0, 11.5, 13.5, 15][lv] * 0.85} />}
      {lv === 2 && bungalow && <KitModel model={bungalow} kit="suburban" variant={0} x={15} z={14} s={8} />}
      {lv >= 3 && house && <KitModel model={house} kit="suburban" variant={0} x={16.5} z={14.5} s={9} sy={9 * 0.85} />}

      {/* Pool house next to the pool (from level 2), whirlpool, parasols. */}
      {lv >= 2 && bungalow && <KitModel model={bungalow} kit="suburban" variant={2} x={22.5} z={-FZ + 4.4} s={4.8} />}
      {lv >= 2 && (
        <group position={[8.2, 0, -12.6]}>
          <mesh material={m.stone} position={[0, 0.25, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[2.2, 2.2, 0.5, 24]} />
          </mesh>
          <mesh material={m.whirl} position={[0, 0.48, 0]}>
            <cylinderGeometry args={[1.75, 1.75, 0.08, 24]} />
          </mesh>
        </group>
      )}
      {parasol &&
        Array.from({ length: lv }, (_, i) => (
          <KitModel key={i} model={parasol} kit="commercial" variant={0} x={pcx - pw / 2 + 2 + i * ((pw - 4) / Math.max(1, lv - 1))} z={pcz + pd / 2 + 4.2} s={3 / parasol.size.y} />
        ))}

      {/* Rose garden: fountain and rose arch on the Traumvilla. */}
      {lv >= 3 && (
        <group position={[gardenX, 0, gardenZ]}>
          <mesh material={m.stone} position={[0, 0.3, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[1.6, 1.8, 0.6, 20]} />
          </mesh>
          <mesh material={m.water} position={[0, 0.58, 0]}>
            <cylinderGeometry args={[1.35, 1.35, 0.06, 20]} />
          </mesh>
          <mesh material={m.stone} position={[0, 1.1, 0]} castShadow>
            <cylinderGeometry args={[0.18, 0.25, 1.4, 10]} />
          </mesh>
          <mesh material={m.gold} position={[0, 1.95, 0]} castShadow>
            <sphereGeometry args={[0.3, 12, 8]} />
          </mesh>
          <RoseArch x={(-FX + 1.5 - gardenX) / 2 + 2} />
        </group>
      )}

      {/* Cypresses along the back fence, an oak and bushes at the side. */}
      {CYPRESSES[lv].map((x) => (
        <Prop key={`c${x}`} url={TREE("tree_pineTallA")} x={x} z={FZ - 1.6} height={lv >= 3 ? 9 : 7.5} recolour />
      ))}
      <Prop url={TREE("tree_oak")} x={-FX + 4} z={14} height={10} recolour />
      {lv >= 2 && <Prop url={TREE("tree_oak")} x={FX - 3.5} z={2} height={9} recolour />}
      {[-1, 1].map((s) => (
        <Prop key={`b${s}`} url={TREE("plant_bushLarge")} x={s * (GATE + 2.2)} z={-FZ + 1.4} height={1.4} recolour />
      ))}
    </group>
  );
}

/** White rose arch over the garden path, covered in roses. */
function RoseArch({ x }: { x: number }) {
  const m = materials();
  const posts = useMemo<BoxSpec[]>(
    () => [
      [x, -1.1, 0.15, 0.15, 0, 2.6],
      [x, 1.1, 0.15, 0.15, 0, 2.6],
      [x, 0, 0.15, 2.4, 2.5, 2.7],
    ],
    [x],
  );
  const roses = useMemo(
    () => [
      { x, z: -1.1, w: 0.6, d: 0.6, roses: true },
      { x, z: 1.1, w: 0.6, d: 0.6, roses: true },
    ],
    [x],
  );
  return (
    <>
      <Boxes list={posts} m={m.white} />
      <group position={[0, 1.9, 0]}>
        <Flowers beds={roses} seed={5} />
      </group>
    </>
  );
}

useGLTF.preload(PROP_URLS);
