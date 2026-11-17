"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { INDUSTRY, levelName, sizeOf, type Building, type BuildingKind } from "@/lib/city/economy";
import { FactoryYard, GOODS_KINDS, GOODS_STRIP } from "./FactoryYard";
import { Fence, Herd, type Area } from "./Animals";
import { PackTannery } from "./TanneryPack";
import { kitMaterial, useKitParts, type Kit, type KitParts } from "./HousePack";

/**
 * Factories, bakery and butcher in the look of the Kenney City Kits (City Pack style, see the
 * admin switch). Every plot gets the kit model of its kind at the front (towards the street),
 * each upgrade a further hall in the strip the plot grew by, plus chimneys and tanks from the
 * industrial kit, a light yard and a name board. Models are fitted into their rectangle
 * (uniform scale, capped in height) and turned to face the street (kit models face +z).
 */

const ind = (f: string) => `/models/city/industrial/${f}.glb`;
const com = (f: string) => `/models/city/commercial/${f}.glb`;

interface Prop {
  url: string;
  /** Position as a share of the plot (−0.5…0.5; −z = street side). */
  fx: number;
  fz: number;
  /** Height in metres. */
  h: number;
  /** Only from / up to this level. */
  min?: number;
  max?: number;
}
interface PackSpec {
  kit: Kit;
  /** Colour variant of the kit atlas (industrial: 0 colormap, 1–3 variation a–c). */
  variant: number;
  /** Model at the front, or per level a model that fills the whole plot (overrides the halls). */
  main: string;
  /** `height`: stretch the model over the whole plot (x and z separately) to this height – a big box store. */
  whole?: Partial<Record<number, { url: string; kit: Kit; variant: number; height?: number }>>;
  /** Hall added at each level in the strip the plot grew by. */
  extra?: Partial<Record<number, string>>;
  /** Highest a main model may get (m): wide plots would otherwise make huge halls. */
  maxH?: number;
  props?: Prop[];
  /** Concrete base down into the slope (mines stand on mountain sides). */
  foundation?: boolean;
  /** Share of the plot depth the main (or whole) model may use at the front (rest: props behind). */
  mainDepth?: number;
  /** Height factor of the main model per level (buildings that grow upwards on the same plot). */
  grow?: number[];
  /** Rooftop landmark that makes the shop recognisable from the air. */
  roof?: RoofKind;
  /** Own Kenney-look model instead of kit halls (yard, fence, goods and sign stay). */
  custom?: boolean;
}

const chimneyL = ind("chimney-large");
const chimneyM = ind("chimney-medium");
const tankL = ind("detail-tank-large");
const tank = ind("detail-tank");

export const PACK_SPECS: Partial<Record<BuildingKind, PackSpec>> = {
  steelworks: {
    kit: "industrial",
    variant: 0,
    main: ind("building-l"),
    maxH: 26,
    props: [
      { url: chimneyL, fx: 0.3, fz: 0.32, h: 26 },
      { url: chimneyL, fx: 0.4, fz: 0.32, h: 22 },
      { url: tankL, fx: -0.32, fz: 0.3, h: 8 },
      { url: tankL, fx: -0.16, fz: 0.3, h: 8 },
    ],
  },
  sawmill: { kit: "industrial", variant: 2, main: ind("building-h"), extra: { 2: ind("building-i"), 3: ind("building-k") }, maxH: 18 },
  furniture: { kit: "industrial", variant: 1, main: ind("building-p"), extra: { 2: ind("building-q"), 3: ind("building-t") }, maxH: 18 },
  slaughterhouse: {
    kit: "industrial",
    variant: 0,
    main: ind("building-g"),
    extra: { 2: ind("building-s"), 3: ind("building-r") },
    maxH: 16,
    props: [{ url: tank, fx: 0.4, fz: 0.05, h: 3 }],
  },
  // Own model (TanneryPack.tsx): workshop, vats, drying racks; drying shed and leather store per level.
  tannery: { kit: "industrial", variant: 3, main: ind("building-k"), custom: true },
  // Grows upwards on the same plot; a second latex tank from level 3.
  rubberfactory: {
    kit: "industrial",
    variant: 2,
    main: ind("building-c"),
    maxH: 18,
    grow: [1, 1, 1.4, 1.8],
    props: [
      { url: tankL, fx: 0.36, fz: 0.3, h: 9 },
      { url: tankL, fx: -0.3, fz: 0.34, h: 11, min: 3 },
    ],
  },
  shoefactory: { kit: "industrial", variant: 1, main: ind("building-b"), maxH: 18, grow: [1, 1, 1.6, 2.2] },
  spinning: { kit: "industrial", variant: 3, main: ind("building-m"), extra: { 2: ind("building-s"), 3: ind("building-k") }, maxH: 18 },
  clothing: { kit: "industrial", variant: 1, main: ind("building-t"), extra: { 2: ind("building-a"), 3: ind("building-r") }, maxH: 16 },
  foodfactory: {
    kit: "industrial",
    variant: 0,
    main: ind("building-e"),
    extra: { 2: ind("building-g"), 3: ind("building-q") },
    maxH: 20,
    props: [
      { url: tankL, fx: 0.42, fz: -0.05, h: 10 },
      { url: tankL, fx: 0.42, fz: 0.18, h: 10 },
    ],
  },
  goldsmelter: {
    kit: "industrial",
    variant: 2,
    main: ind("building-f"),
    extra: { 2: ind("building-n"), 3: ind("building-o") },
    maxH: 18,
    props: [{ url: chimneyM, fx: 0.38, fz: 0.3, h: 18 }],
  },
  bakery: {
    kit: "commercial",
    variant: 1,
    main: com("building-c"),
    maxH: 13,
    roof: "bakery",
    whole: { 2: { url: ind("building-g"), kit: "industrial", variant: 1 } },
  },
  butcher: { kit: "commercial", variant: 2, main: com("building-d"), extra: { 2: ind("building-k"), 3: ind("building-p") }, maxH: 13, roof: "butcher" },

  /* ---------- the rest of industry ---------- */
  mill: {
    kit: "industrial",
    variant: 2,
    main: ind("building-h"),
    extra: { 2: ind("building-k"), 3: ind("building-i"), 4: ind("building-q") },
    maxH: 12,
    props: [
      { url: tankL, fx: 0.38, fz: 0.25, h: 7, min: 2 },
      { url: tankL, fx: 0.38, fz: 0.0, h: 7, min: 4 },
    ],
  },
  powerplant: {
    kit: "industrial",
    variant: 0,
    main: ind("building-d"),
    whole: {
      2: { url: ind("building-l"), kit: "industrial", variant: 0 },
      3: { url: ind("building-o"), kit: "industrial", variant: 3 },
      4: { url: ind("building-o"), kit: "industrial", variant: 3 },
      5: { url: ind("building-o"), kit: "industrial", variant: 3 },
    },
    maxH: 16,
    mainDepth: 0.55,
    props: [
      // Coal: two stacks. Nuclear: a cooling tower per reactor block, side by side at the back.
      { url: chimneyL, fx: 0.3, fz: 0.26, h: 24, min: 2, max: 2 },
      { url: chimneyL, fx: 0.1, fz: 0.26, h: 20, min: 2, max: 2 },
      { url: chimneyL, fx: 0.0, fz: 0.25, h: 21, min: 3 },
      { url: chimneyL, fx: -0.33, fz: 0.25, h: 21, min: 4 },
      { url: chimneyL, fx: 0.33, fz: 0.25, h: 21, min: 5 },
    ],
  },
  coalmine: { kit: "industrial", variant: 0, main: ind("building-n"), maxH: 16, foundation: true, props: [{ url: tank, fx: 0.35, fz: 0.25, h: 3 }] },
  ironmine: { kit: "industrial", variant: 2, main: ind("building-n"), maxH: 16, foundation: true, props: [{ url: tank, fx: 0.35, fz: 0.25, h: 3 }] },
  uraniummine: { kit: "industrial", variant: 3, main: ind("building-n"), maxH: 16, foundation: true, props: [{ url: tankL, fx: 0.33, fz: 0.25, h: 5 }] },
  goldmine: { kit: "industrial", variant: 1, main: ind("building-n"), maxH: 16, foundation: true, props: [{ url: tank, fx: 0.35, fz: 0.25, h: 3 }] },
  // Hen house at the front, the fenced chick run behind it (ChickRun).
  chickenfarm: { kit: "industrial", variant: 2, main: ind("building-k"), maxH: 8, mainDepth: 0.45 },
  recycling: { kit: "industrial", variant: 3, main: ind("building-s"), extra: { 2: ind("building-k"), 3: ind("building-q") }, maxH: 10 },
  trader: { kit: "industrial", variant: 1, main: ind("building-j"), extra: { 2: ind("building-i"), 3: ind("building-h") }, maxH: 12 },
  warehouse: { kit: "industrial", variant: 0, main: ind("building-i"), extra: { 2: ind("building-h"), 3: ind("building-o") }, maxH: 12 },

  /* ---------- shops and leisure ---------- */
  // Grows to the back like the butcher: stock room (Schuhhaus), bigger sales hall (Schuhcenter).
  shoeshop: { kit: "commercial", variant: 0, main: com("building-a"), extra: { 2: ind("building-k"), 3: ind("building-p") }, maxH: 13, roof: "shoeshop" },
  fashion: { kit: "commercial", variant: 1, main: com("building-b"), maxH: 13 },
  jeweller: { kit: "commercial", variant: 2, main: com("building-h"), extra: { 2: ind("building-k"), 3: ind("building-p") }, maxH: 13, roof: "jeweller" },
  restaurant: { kit: "commercial", variant: 1, main: com("building-e"), maxH: 12 },
  cinema: { kit: "commercial", variant: 0, main: com("building-k"), maxH: 14 },
  discounter: { kit: "industrial", variant: 1, main: ind("building-s"), maxH: 9 },
  furniturestore: {
    kit: "industrial",
    variant: 3,
    main: ind("building-q"),
    whole: {
      2: { url: ind("building-r"), kit: "industrial", variant: 3 },
      3: { url: ind("building-t"), kit: "industrial", variant: 3 },
      // Möbelzentrum: the wide, low hall stretched over the whole plot (the narrow tower it had
      // came out smaller than the level-3 store).
      4: { url: ind("building-q"), kit: "industrial", variant: 1, height: 16 },
    },
    maxH: 12,
  },

  /* ---------- public buildings (landmarks – church, bank, town hall, exchange – stay) ---------- */
  waterworks: {
    kit: "industrial",
    variant: 0,
    main: ind("water-tower"),
    whole: { 2: { url: ind("building-k"), kit: "industrial", variant: 0 }, 3: { url: ind("building-a"), kit: "industrial", variant: 0 } },
    maxH: 16,
    props: [
      { url: ind("water-tower"), fx: 0.32, fz: 0.32, h: 16, min: 2 },
      { url: ind("water-tower"), fx: -0.32, fz: 0.32, h: 16, min: 3 },
    ],
  },
  hospital: { kit: "commercial", variant: 0, main: com("building-n"), maxH: 22 },
  school: {
    kit: "commercial",
    variant: 2,
    main: com("building-j"),
    whole: { 2: { url: com("building-k"), kit: "commercial", variant: 2 }, 3: { url: com("building-n"), kit: "commercial", variant: 2 } },
    maxH: 16,
  },
  taxoffice: { kit: "commercial", variant: 2, main: com("building-l"), maxH: 22 },
  jobcenter: {
    kit: "commercial",
    variant: 1,
    main: com("building-f"),
    whole: { 2: { url: com("building-g"), kit: "commercial", variant: 1 }, 3: { url: com("building-i"), kit: "commercial", variant: 1 } },
    maxH: 18,
  },
};

const ALL_URLS = [
  ...new Set(
    Object.values(PACK_SPECS).flatMap((s) => [
      s!.main,
      ...Object.values(s!.extra ?? {}),
      ...Object.values(s!.whole ?? {}).map((w) => w!.url),
      ...(s!.props ?? []).map((p) => p.url),
    ]),
  ),
] as string[];

/* ---------- rooftop landmarks: bakery and butcher must be recognisable from the air ---------- */

type RoofKind = "bakery" | "butcher" | "jeweller" | "shoeshop";

let landmarkMats: Record<"dough" | "salt" | "sausage" | "string" | "gold" | "diamond" | "plinth" | "sole" | "shoe" | "lace", THREE.MeshStandardMaterial> | null = null;
function landmarkMaterials() {
  landmarkMats ??= {
    dough: new THREE.MeshStandardMaterial({ color: "#b8682e", roughness: 0.55 }),
    salt: new THREE.MeshStandardMaterial({ color: "#fff4d6", roughness: 0.8 }),
    sausage: new THREE.MeshStandardMaterial({ color: "#c2463c", roughness: 0.45 }),
    string: new THREE.MeshStandardMaterial({ color: "#f2e6c8", roughness: 0.9 }),
    gold: new THREE.MeshStandardMaterial({ color: "#f2c230", roughness: 0.25, metalness: 0.9 }),
    diamond: new THREE.MeshStandardMaterial({ color: "#c9f0ff", roughness: 0.05, metalness: 0.2, emissive: "#6fd3ff", emissiveIntensity: 0.25, flatShading: true }),
    plinth: new THREE.MeshStandardMaterial({ color: "#3d4650", roughness: 0.7 }),
    sole: new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.8 }),
    shoe: new THREE.MeshStandardMaterial({ color: "#e0533a", roughness: 0.6 }),
    lace: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8 }),
  };
  return landmarkMats;
}

/**
 * Giant sign object on the shop roof (top at `top`, roof about `size` m across), level and
 * centred on a low plinth, aligned with the building: a pretzel (bakery), a sausage (butcher),
 * a ring with a diamond (jeweller), a trainer (shoe shop) – each reads from the air.
 */
function RoofLandmark({ kind, top, size }: { kind: RoofKind; top: number; size: number }) {
  const m = landmarkMaterials();
  // Unit size of the figure: about half the roof.
  const u = Math.min(5, size * 0.42) / 4;
  return (
    <group position={[0, top, 0]}>
      <mesh position={[0, 0.2, 0]} material={m.plinth} castShadow receiveShadow>
        <boxGeometry args={[u * 4.6, 0.4, u * 3.6]} />
      </mesh>
      <group position={[0, 0.4, 0]} scale={u}>
        {kind === "bakery" && (
          // Pretzel lying flat: two loops and the knotted band below, salt on top.
          <group position={[0, 0.45, 0]}>
            {[-0.95, 0.95].map((x) => (
              <mesh key={x} position={[x, 0, -0.25]} rotation={[Math.PI / 2, 0, 0]} material={m.dough} castShadow>
                <torusGeometry args={[1.05, 0.42, 12, 28]} />
              </mesh>
            ))}
            <mesh position={[0, 0, 1.05]} rotation={[0, 0, Math.PI / 2]} material={m.dough} castShadow>
              <capsuleGeometry args={[0.42, 2.6, 6, 14]} />
            </mesh>
            {[[-1.5, -0.9], [-0.5, -1.2], [0.6, -1.15], [1.5, -0.6], [0.2, 1.05], [-1.0, 1.0]].map(([x, z], i) => (
              <mesh key={i} position={[x, 0.42, z]} material={m.salt}>
                <boxGeometry args={[0.16, 0.16, 0.16]} />
              </mesh>
            ))}
          </group>
        )}
        {kind === "butcher" && (
          // One straight sausage lying along the roof, tied at both ends.
          <group position={[0, 0.85, 0]}>
            <mesh rotation={[0, 0, Math.PI / 2]} material={m.sausage} castShadow>
              <capsuleGeometry args={[0.85, 3.2, 8, 18]} />
            </mesh>
            {[-2.55, 2.55].map((x) => (
              <mesh key={x} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={m.string}>
                <cylinderGeometry args={[0.18, 0.18, 0.5, 8]} />
              </mesh>
            ))}
          </group>
        )}
        {kind === "jeweller" && (
          // Gold ring standing upright, the diamond on top.
          <group position={[0, 1.6, 0]}>
            <mesh material={m.gold} castShadow>
              <torusGeometry args={[1.25, 0.28, 14, 36]} />
            </mesh>
            <mesh position={[0, 1.45, 0]} material={m.gold}>
              <cylinderGeometry args={[0.35, 0.25, 0.3, 8]} />
            </mesh>
            <mesh position={[0, 2.05, 0]} rotation={[0, Math.PI / 8, 0]} scale={[0.75, 0.9, 0.75]} material={m.diamond} castShadow>
              <octahedronGeometry args={[1, 0]} />
            </mesh>
          </group>
        )}
        {kind === "shoeshop" && (
          // Trainer: white sole, red upper with a rounded toe, laces.
          <group position={[0, 0, 0]}>
            <mesh position={[0, 0.2, 0]} material={m.sole} castShadow>
              <boxGeometry args={[3.6, 0.4, 1.4]} />
            </mesh>
            <mesh position={[-0.55, 0.95, 0]} material={m.shoe} castShadow>
              <boxGeometry args={[2.4, 1.1, 1.3]} />
            </mesh>
            <mesh position={[1.05, 0.62, 0]} rotation={[0, 0, Math.PI / 2]} material={m.shoe} castShadow>
              <capsuleGeometry args={[0.45, 0.5, 6, 12]} />
            </mesh>
            <mesh position={[-1.3, 1.65, 0]} material={m.shoe} castShadow>
              <boxGeometry args={[0.9, 0.5, 1.2]} />
            </mesh>
            {[-0.4, 0.0, 0.4].map((x) => (
              <mesh key={x} position={[x, 1.52, 0]} material={m.lace}>
                <boxGeometry args={[0.12, 0.06, 1.0]} />
              </mesh>
            ))}
          </group>
        )}
      </group>
    </group>
  );
}

/** Board with the building's name (canvas texture, cached per text). */
const signCache = new Map<string, THREE.MeshStandardMaterial>();
function signMaterial(text: string) {
  let m = signCache.get(text);
  if (m) return m;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 96;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2c3640";
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = "#f2b33d";
  g.fillRect(0, 84, 512, 12);
  g.fillStyle = "#ffffff";
  let size = 52;
  g.font = `bold ${size}px Arial, sans-serif`;
  while (g.measureText(text).width > 480 && size > 20) g.font = `bold ${(size -= 2)}px Arial, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 44);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 });
  signCache.set(text, m);
  return m;
}
let shared: { yard: THREE.MeshStandardMaterial; post: THREE.MeshStandardMaterial; box: THREE.BoxGeometry } | null = null;
function sharedAssets() {
  shared ??= {
    yard: new THREE.MeshStandardMaterial({ color: "#c9bfa8", roughness: 0.95 }),
    post: new THREE.MeshStandardMaterial({ color: "#5b6670", roughness: 0.6, metalness: 0.4 }),
    box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  };
  return shared;
}

/** Turn that makes a kit model face the street (local −z): suburban houses face +z, commercial and industrial models −z. */
const FACING: Record<Kit, number> = { suburban: Math.PI, commercial: 0, industrial: 0 };

/** One kit model (all its parts) at local (x, z), scaled (uniformly unless sx/sy/sz are given), facing the street. */
export function KitModel({ model, kit, variant, x, z, s, sx, sy, sz, y = 0 }: { model: KitParts; kit: Kit; variant: number; x: number; z: number; s: number; sx?: number; sy?: number; sz?: number; y?: number }) {
  return (
    <group position={[x, y, z]} rotation={[0, FACING[kit], 0]} scale={[sx ?? s, sy ?? s, sz ?? s]}>
      {model.parts.map((p, i) => (
        <mesh key={i} geometry={p.geometry} material={kitMaterial(kit, variant, p.glossy)} castShadow receiveShadow />
      ))}
    </group>
  );
}

/** Scale that fits a model into w × d (with a margin) and at most maxH tall. */
const fit = (m: KitParts, w: number, d: number, maxH = Infinity) => Math.min((w - 1.5) / m.size.x, (d - 1.5) / m.size.z, maxH / m.size.y);

let lawnMat: THREE.MeshStandardMaterial | null = null;
const runLawn = () => (lawnMat ??= new THREE.MeshStandardMaterial({ color: "#33956e", roughness: 0.95 }));
let strawMat: THREE.MeshStandardMaterial | null = null;
const runStraw = () => (strawMat ??= new THREE.MeshStandardMaterial({ color: "#e3c25a", roughness: 0.95 }));

/** Fenced run behind the hen house with Kenney Cube Pets chicks pecking around. */
const RUN_HEIGHT = () => 0.07;
function ChickRun({ w, d, strip }: { w: number; d: number; strip: number }) {
  const area = useMemo<Area>(() => ({ x0: -w / 2 + 1.5, x1: w / 2 - strip - 1, z0: -d / 2 + d * 0.45 + 2, z1: d / 2 - 1.5 }), [w, d, strip]);
  const inner = useMemo<Area>(() => ({ x0: area.x0 + 0.8, x1: area.x1 - 0.8, z0: area.z0 + 0.8, z1: area.z1 - 0.8 }), [area]);
  return (
    <group>
      {/* Grass with a few straw patches inside the run (Kenney lawn colours). */}
      <mesh position={[(area.x0 + area.x1) / 2, 0.075, (area.z0 + area.z1) / 2]} rotation={[-Math.PI / 2, 0, 0]} material={runLawn()} receiveShadow>
        <planeGeometry args={[area.x1 - area.x0, area.z1 - area.z0]} />
      </mesh>
      {[
        [0.3, 0.3],
        [0.7, 0.6],
        [0.4, 0.8],
      ].map(([fx, fz], i) => (
        <mesh key={i} position={[area.x0 + (area.x1 - area.x0) * fx, 0.085, area.z0 + (area.z1 - area.z0) * fz]} rotation={[-Math.PI / 2, 0, 0]} material={runStraw()}>
          <circleGeometry args={[1.4, 10]} />
        </mesh>
      ))}
      <Fence area={area} height={RUN_HEIGHT} kind="pigs" />
      <Herd kind="chick" count={14} area={inner} seed={31} height={RUN_HEIGHT} />
    </group>
  );
}

/** A building of PACK_SPECS in the City Pack look (local coordinates, front at −z). */
export function PackBuilding({ b }: { b: Building }) {
  const spec = PACK_SPECS[b.kind]!;
  const models = useKitParts(ALL_URLS);
  const [w, d] = sizeOf(b);
  const front = -d / 2;
  // Industry gets a fenced yard; most factories show their goods on it.
  const industrial = spec.kit === "industrial" || INDUSTRY.includes(b.kind);
  const hasGoods = GOODS_KINDS.includes(b.kind) && w >= 24;
  const items = useMemo(() => {
    const out: { model: KitParts; kit: Kit; variant: number; x: number; z: number; s: number; sx?: number; sy?: number; sz?: number }[] = [];
    if (spec.custom) return out;
    const whole = spec.whole?.[b.level];
    if (whole) {
      const m = models.get(whole.url);
      const dd = d * (spec.mainDepth ?? 1);
      if (m && whole.height) {
        const sx = (w - 2) / m.size.x;
        const sz = (dd - 4) / m.size.z;
        out.push({ model: m, kit: whole.kit, variant: whole.variant, x: 0, z: front + dd / 2, s: Math.min(sx, sz), sx, sy: whole.height / m.size.y, sz });
      } else if (m) out.push({ model: m, kit: whole.kit, variant: whole.variant, x: 0, z: front + dd / 2 + (spec.mainDepth ? 0.5 : 0), s: fit(m, w, dd - (spec.mainDepth ? 1 : 4), (spec.maxH ?? 14) * 1.2) });
      return out;
    }
    // Front hall in the level-1 plot, a hall per upgrade in the strip the plot grew by.
    const [w1full, d1full] = sizeOf({ kind: b.kind, level: 1 });
    const d1 = d1full * (spec.mainDepth ?? 1);
    // Factories keep a strip at the right side free for their goods.
    const strip = hasGoods ? GOODS_STRIP + 1 : 0;
    const w1 = w1full - strip;
    const main = models.get(spec.main);
    if (main) {
      const s0 = fit(main, w1, d1 - 2, spec.maxH);
      out.push({ model: main, kit: spec.kit, variant: spec.variant, x: -strip / 2, z: front + d1 / 2 + 1, s: s0, sy: s0 * (spec.grow?.[b.level] ?? 1) });
    }
    for (let l = 2; l <= b.level; l++) {
      const url = spec.extra?.[l];
      const m = url ? models.get(url) : undefined;
      if (!m) continue;
      const z0 = front + sizeOf({ kind: b.kind, level: l - 1 })[1];
      const z1 = front + sizeOf({ kind: b.kind, level: l })[1];
      if (z1 - z0 < 5) continue;
      out.push({ model: m, kit: "industrial", variant: spec.variant, x: -strip / 2, z: (z0 + z1) / 2, s: fit(m, w - strip, z1 - z0, (spec.maxH ?? 12) * 0.9) });
    }
    return out;
  }, [b.kind, b.level, spec, models, w, d, front, hasGoods]);
  const props = (spec.props ?? []).flatMap((p, i) => {
    if ((p.min && b.level < p.min) || (p.max && b.level > p.max)) return [];
    const m = models.get(p.url);
    return m ? [{ key: i, model: m, x: p.fx * w, z: p.fz * d, s: p.h / m.size.y }] : [];
  });
  const a = sharedAssets();
  const sign = signMaterial(levelName(b).toUpperCase());
  // Name board on two posts at the front corner of the plot.
  const sx = -w / 2 + Math.min(5, w * 0.3);
  return (
    <group>
      {industrial ? (
        <FactoryYard kind={b.kind} w={w} d={d} fence goods={hasGoods} />
      ) : (
        <FactoryYard kind={b.kind} w={w} d={d} fence={false} goods={false} />
      )}
      {b.kind === "tannery" && <PackTannery w={w} d={d} level={b.level} />}
      {b.kind === "chickenfarm" && <ChickRun w={w} d={d} strip={hasGoods ? GOODS_STRIP + 1 : 0} />}
      {spec.foundation && <mesh geometry={a.box} material={a.post} scale={[w, 10, d]} position={[0, -10, 0]} receiveShadow />}
      {items.map((it, i) => (
        <KitModel key={i} {...it} />
      ))}
      {spec.roof && items[0] && (
        // On the centre of the actual roof (model turned by FACING: a half turn mirrors x and z).
        <group
          position={[
            items[0].x + items[0].model.roof.x * items[0].s * (FACING[items[0].kit] ? -1 : 1),
            0,
            items[0].z + items[0].model.roof.z * items[0].s * (FACING[items[0].kit] ? -1 : 1),
          ]}
        >
          <RoofLandmark kind={spec.roof} top={(items[0].sy ?? items[0].s) * items[0].model.size.y} size={Math.min(items[0].model.roof.w, items[0].model.roof.d) * items[0].s} />
        </group>
      )}
      {props.map((p) => (
        <KitModel key={`p${p.key}`} model={p.model} kit="industrial" variant={spec.kit === "industrial" ? spec.variant : 0} x={p.x} z={p.z} s={p.s} />
      ))}
      {w >= 20 ? (
        <>
          {[-1.6, 1.6].map((dx) => (
            <mesh key={dx} geometry={a.box} material={a.post} scale={[0.15, 3.4, 0.15]} position={[sx + dx, 0, front + 0.8]} castShadow />
          ))}
          <mesh geometry={a.box} material={sign} scale={[4.2, 0.8, 0.12]} position={[sx, 2.6, front + 0.72]} castShadow />
        </>
      ) : (
        // Narrow shops: a small, low board parallel to the street at the front corner.
        <group position={[-w / 2 + 1.6, 0, front + 0.6]}>
          {[-1.05, 1.05].map((dx) => (
            <mesh key={dx} geometry={a.box} material={a.post} scale={[0.1, 1.9, 0.1]} position={[dx, 0, 0.06]} castShadow />
          ))}
          <mesh geometry={a.box} material={sign} scale={[2.6, 0.5, 0.1]} position={[0, 1.45, 0]} castShadow />
        </group>
      )}
    </group>
  );
}
