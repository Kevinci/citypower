"use client";

import * as THREE from "three";
import { useCity } from "@/lib/city/store";
import { useKitParts } from "./HousePack";
import { KitModel } from "./PackBuildings";
import { signGlow } from "./nightGlow";

/**
 * Bank and town hall in the City Pack style: grand Kenney-look landmarks that keep their
 * growth stages – the bank is a modern high-rise that grows with every wealth tier (banknote on the roof), the town hall's
 * main building two more floors with every residents tier (clock tower always above it). Flat colours, chunky trims, gold accents.
 */

/** Money for the bank's tower tiers (1, 2, 3) and residents for the town hall's tiers (1, 2). */
export const BANK_WEALTH = [1_000_000, 5_000_000, 20_000_000];
export const TOWNHALL_RESIDENTS = [1500, 4000];

const TOWERS = ["building-skyscraper-a", "building-skyscraper-c", "building-skyscraper-d", "building-skyscraper-e"].map((f) => `/models/city/commercial/${f}.glb`);

let mats: Record<"stone" | "white" | "gold" | "roof" | "glass" | "cream" | "trim" | "window" | "pane" | "red" | "flag" | "water" | "dark" | "eave" | "door" | "frame" | "doorDark" | "shine", THREE.MeshStandardMaterial> | null = null;
function m() {
  mats ??= {
    stone: new THREE.MeshStandardMaterial({ color: "#d9d4ca", roughness: 0.85 }),
    white: new THREE.MeshStandardMaterial({ color: "#f6f4ee", roughness: 0.7 }),
    gold: new THREE.MeshStandardMaterial({ color: "#f2c230", roughness: 0.3, metalness: 0.85 }),
    roof: new THREE.MeshStandardMaterial({ color: "#56607a", roughness: 0.6, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: "#7fb3d9", roughness: 0.15, metalness: 0.3 }),
    cream: new THREE.MeshStandardMaterial({ color: "#f1e2c2", roughness: 0.8 }),
    trim: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.7 }),
    window: new THREE.MeshStandardMaterial({ color: "#3e5a78", roughness: 0.2, metalness: 0.3 }),
    pane: new THREE.MeshStandardMaterial({ color: "#8ec7ea", roughness: 0.08, metalness: 0.25, emissive: "#bfe6ff", emissiveIntensity: 0.12 }),
    red: new THREE.MeshStandardMaterial({ color: "#b8443a", roughness: 0.7 }),
    flag: new THREE.MeshStandardMaterial({ color: "#2f6fb5", roughness: 0.7, side: THREE.DoubleSide }),
    water: new THREE.MeshStandardMaterial({ color: "#5fb4d9", roughness: 0.1 }),
    dark: new THREE.MeshStandardMaterial({ color: "#3d4650", roughness: 0.6 }),
    eave: new THREE.MeshStandardMaterial({ color: "#3f475c", roughness: 0.6 }),
    door: new THREE.MeshStandardMaterial({ color: "#7a4a2e", roughness: 0.8 }),
    // Kenney house details: grey-blue frames, dark door panels, glass highlight.
    frame: new THREE.MeshStandardMaterial({ color: "#9097b5", roughness: 0.7 }),
    doorDark: new THREE.MeshStandardMaterial({ color: "#4a4f63", roughness: 0.7 }),
    shine: new THREE.MeshStandardMaterial({ color: "#d6f0ff", roughness: 0.1, emissive: "#d6f0ff", emissiveIntensity: 0.15 }),
  };
  return mats;
}

/** Box from its base (y) upwards. */
function B({ mat, w, h, d, x = 0, y = 0, z = 0 }: { mat: THREE.Material; w: number; h: number; d: number; x?: number; y?: number; z?: number }) {
  return (
    <mesh position={[x, y + h / 2, z]} material={mat} castShadow receiveShadow>
      <boxGeometry args={[w, h, d]} />
    </mesh>
  );
}

/** Hip roof over w × d (base at y = 0, ridge along the longer side; equal sides give a pyramid), flat-shaded. */
const hipCache = new Map<string, THREE.BufferGeometry>();
function hipGeometry(w: number, d: number, h: number) {
  const key = `${w}:${d}:${h}`;
  const cached = hipCache.get(key);
  if (cached) return cached;
  const x = w / 2;
  const z = d / 2;
  // Ridge ends (a point for a square plan).
  const along = d >= w;
  const r = Math.abs(d - w) / 2;
  const r0 = along ? [0, h, -r] : [-r, h, 0];
  const r1 = along ? [0, h, r] : [r, h, 0];
  const c = [
    [-x, 0, -z],
    [x, 0, -z],
    [x, 0, z],
    [-x, 0, z],
  ];
  const tri: number[][] = along
    ? [
        [c[0], c[1], r0], // front
        [c[2], c[3], r1], // back
        [c[1], c[2], r1], [c[1], r1, r0], // right
        [c[3], c[0], r0], [c[3], r0, r1], // left
      ].flat()
    : [
        [c[3], c[0], r0], // left
        [c[1], c[2], r1], // right
        [c[0], c[1], r1], [c[0], r1, r0], // front
        [c[2], c[3], r0], [c[2], r0, r1], // back
      ].flat();
  // Every triangle wound so its normal points up and out.
  const pos: number[] = [];
  for (let i = 0; i < tri.length; i += 3) {
    const [a, b2, c2] = [tri[i], tri[i + 1], tri[i + 2]];
    const u = [b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]];
    const v = [c2[0] - a[0], c2[1] - a[1], c2[2] - a[2]];
    const ny = u[2] * v[0] - u[0] * v[2];
    pos.push(...a, ...(ny >= 0 ? [...b2, ...c2] : [...c2, ...b2]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  hipCache.set(key, g);
  return g;
}

/**
 * Kenney-style roof: thick dark eave band with an overhang, hip roof above it and a ridge
 * cap – over a w × d block whose top is at y.
 */
function KRoof({ w, d, h, y, x = 0, z = 0 }: { w: number; d: number; h: number; y: number; x?: number; z?: number }) {
  const c = m();
  const ow = w + 1;
  const od = d + 1;
  const along = od >= ow;
  const ridge = Math.abs(od - ow);
  return (
    <group position={[x, y, z]}>
      <B mat={c.eave} w={ow + 0.1} h={0.45} d={od + 0.1} />
      <mesh geometry={hipGeometry(ow, od, h)} position={[0, 0.45, 0]} material={c.roof} castShadow receiveShadow />
      {ridge > 0.2 && <B mat={c.eave} w={along ? 0.35 : ridge} h={0.3} d={along ? ridge : 0.35} y={0.45 + h - 0.12} />}
    </group>
  );
}

/** Triangular gable (pediment) w wide, h high, d deep, base at y. */
function Gable({ mat, w, h, d, x = 0, y = 0, z = 0 }: { mat: THREE.Material; w: number; h: number; d: number; x?: number; y?: number; z?: number }) {
  const shape = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(0, h), new THREE.Vector2(w / 2, 0)]);
  return (
    <mesh position={[x, y, z - d / 2]} material={mat} castShadow receiveShadow>
      <extrudeGeometry args={[shape, { depth: d, bevelEnabled: false }]} />
    </mesh>
  );
}


/** Bank tower height per wealth tier (m): 4, 6, 12, 20 floors. */
const BANK_HEIGHT = [16, 22, 43, 72];

/** A giant banknote: green, "100 €", printed on both sides (canvas texture, once). */
let noteMat: THREE.MeshStandardMaterial | null = null;
function banknoteMaterial() {
  if (noteMat) return noteMat;
  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = 256;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#7fbf7a";
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = "#5aa35a";
  g.fillRect(14, 14, 484, 228);
  g.fillStyle = "#9fd49a";
  g.fillRect(26, 26, 460, 204);
  // Portrait oval and the value.
  g.fillStyle = "#5aa35a";
  g.beginPath();
  g.ellipse(150, 128, 70, 82, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#eaf6e6";
  g.beginPath();
  g.ellipse(150, 128, 52, 64, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#2f6f33";
  g.font = "bold 120px Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("€", 150, 132);
  g.font = "bold 92px Arial, sans-serif";
  g.fillText("100", 360, 120);
  g.font = "bold 28px Arial, sans-serif";
  g.fillText("CITYPOWER BANK", 360, 192);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  noteMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.7, side: THREE.DoubleSide });
  // Floodlit at night.
  signGlow(noteMat, 1.2);
  return noteMat;
}

/** Bank: modern glass high-rise growing with the town's money, a glass lobby, a banknote on the roof. */
export function PackBank() {
  const c = m();
  const tier = useCity((s) => BANK_WEALTH.filter((w) => s.money >= w).length);
  const towers = useKitParts(TOWERS);
  const tower = towers.get(TOWERS[Math.min(tier, 2)]);
  const H = BANK_HEIGHT[tier];
  return (
    <group>
      {/* Forecourt and plinth. */}
      <B mat={c.stone} w={20} h={0.1} d={16} />
      {tower && <KitModel model={tower} kit="commercial" variant={0} x={0} z={2} s={Math.min(13 / tower.size.x, 11 / tower.size.z)} sy={H / tower.size.y} y={0.1} />}
      {/* Glass lobby at the front with the name. */}
      <B mat={c.pane} w={11} h={4.2} d={3} y={0.1} z={-5.4} />
      <B mat={c.dark} w={11.6} h={0.5} d={3.4} y={4.3} z={-5.4} />
      <B mat={c.dark} w={2} h={3} d={0.15} y={0.1} z={-6.95} />
      <mesh geometry={bankSign()} material={bankSignMaterial()} position={[0, 5.1, -7.15]} />
      {/* The banknote on the roof, standing straight on a stand, facing the street. */}
      <group position={[0, H + 0.1, 2]}>
        <B mat={c.dark} w={7} h={0.5} d={4} />
        {[-2.6, 2.6].map((x) => (
          <B key={x} mat={c.dark} w={0.25} h={2.6} d={0.25} x={x} y={0.5} z={0.6} />
        ))}
        <mesh position={[0, 3.2, 0.6]} material={banknoteMaterial()} castShadow>
          <boxGeometry args={[7.6, 3.8, 0.12]} />
        </mesh>
      </group>
    </group>
  );
}

let signGeo: THREE.BufferGeometry | null = null;
const bankSign = () => (signGeo ??= new THREE.BoxGeometry(5, 1.1, 0.15));
let signMat: THREE.MeshStandardMaterial | null = null;
function bankSignMaterial() {
  if (signMat) return signMat;
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 56;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#1f3b5c";
  g.fillRect(0, 0, 256, 56);
  g.fillStyle = "#ffffff";
  g.font = "bold 36px Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("BANK", 128, 30);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  signMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 });
  signGlow(signMat, 1.6);
  return signMat;
}

/**
 * Kenney-style window on a facade facing −z (bottom at y): white frame standing proud of the
 * wall, light blue glass with a cross, a sill below and a lintel above; `grand` adds a small
 * pediment (ground floor of the town hall).
 */
function TownWindow({ x, y, z, grand }: { x: number; y: number; z: number; grand?: boolean }) {
  const c = m();
  return (
    <group position={[x, y, z]}>
      <B mat={c.trim} w={1.7} h={2.2} d={0.2} z={-0.05} />
      <B mat={c.pane} w={1.3} h={1.8} d={0.12} y={0.2} z={-0.13} />
      <B mat={c.trim} w={0.1} h={1.8} d={0.08} y={0.2} z={-0.2} />
      <B mat={c.trim} w={1.3} h={0.1} d={0.08} y={1.25} z={-0.2} />
      <B mat={c.trim} w={2.0} h={0.18} d={0.45} y={-0.12} z={-0.2} />
      <B mat={c.trim} w={1.95} h={0.22} d={0.3} y={2.2} z={-0.12} />
      {grand && <Gable mat={c.trim} w={2.2} h={0.6} d={0.3} y={2.42} z={-0.12} />}
    </group>
  );
}

/** Annex at the back middle: glazed front with a door, flat roof with an eave band. */
function TownAnnex() {
  const c = m();
  return (
    <group position={[0, 0, 8]}>
      <B mat={c.cream} w={6.4} h={3.6} d={3} />
      <B mat={c.pane} w={5} h={2.4} d={0.12} y={0.6} z={1.52} />
      {[-1.25, 0, 1.25].map((x) => (
        <B key={x} mat={c.trim} w={0.12} h={2.4} d={0.16} x={x} y={0.6} z={1.56} />
      ))}
      <B mat={c.dark} w={1.2} h={2.4} d={0.14} y={0} z={1.6} />
      <B mat={c.eave} w={7} h={0.45} d={3.6} y={3.6} />
      <B mat={c.roof} w={6.6} h={0.2} d={3.2} y={4.05} />
    </group>
  );
}

/** Small garden behind the wings: lawn with a low hedge, a fountain on one side, bushes and a bench on the other. */
function TownGarden() {
  const c = m();
  const g = garden();
  return (
    <group position={[0, 0, 8.8]}>
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * 9.5, 0, 0]}>
          <B mat={g.lawn} w={8.5} h={0.1} d={4} />
          {/* Low hedge round the back and the sides. */}
          <B mat={g.hedge} w={8.5} h={0.7} d={0.5} z={1.8} />
          <B mat={g.hedge} w={0.5} h={0.7} d={4} x={sx * 4} />
        </group>
      ))}
      {/* Fountain in the left garden. */}
      <group position={[-9.5, 0, -0.1]}>
        <mesh position={[0, 0.3, 0]} material={c.stone} castShadow>
          <cylinderGeometry args={[1.4, 1.5, 0.6, 20]} />
        </mesh>
        <mesh position={[0, 0.62, 0]} material={c.water}>
          <cylinderGeometry args={[1.2, 1.2, 0.04, 20]} />
        </mesh>
        <mesh position={[0, 1.0, 0]} material={c.white}>
          <cylinderGeometry args={[0.18, 0.25, 0.9, 10]} />
        </mesh>
        <mesh position={[0, 1.5, 0]} material={c.water}>
          <sphereGeometry args={[0.35, 12, 8]} />
        </mesh>
      </group>
      {/* Bushes and a bench in the right garden. */}
      {[[7, 0.6], [11.5, 0.2], [9.2, 1]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.8, z]} material={g.bush} castShadow>
          <sphereGeometry args={[0.85, 12, 8]} />
        </mesh>
      ))}
      <group position={[9.3, 0, -1.1]}>
        <B mat={g.wood} w={2} h={0.12} d={0.6} y={0.45} />
        <B mat={g.wood} w={2} h={0.5} d={0.1} y={0.55} z={0.28} />
        {[-0.85, 0.85].map((x) => (
          <B key={x} mat={c.dark} w={0.1} h={0.45} d={0.5} x={x} />
        ))}
      </group>
    </group>
  );
}

let gardenMats: Record<"lawn" | "hedge" | "bush" | "wood", THREE.MeshStandardMaterial> | null = null;
function garden() {
  gardenMats ??= {
    lawn: new THREE.MeshStandardMaterial({ color: "#33956e", roughness: 0.95 }),
    hedge: new THREE.MeshStandardMaterial({ color: "#20896b", roughness: 0.9 }),
    bush: new THREE.MeshStandardMaterial({ color: "#4f9a5a", roughness: 0.85 }),
    wood: new THREE.MeshStandardMaterial({ color: "#a9744a", roughness: 0.8 }),
  };
  return gardenMats;
}

/** Town hall: cream hall with wings, a clock tower in the middle, flags and a fountain. */
export function PackTownHall() {
  const c = m();
  const tier = useCity((s) => TOWNHALL_RESIDENTS.filter((r) => (s.economy?.residents ?? 0) >= r).length);
  // The town hall grows in height (no separate tower): 2, 4, 6 floors; wings one floor lower.
  const floors = 2 + tier * 2;
  const hall = floors * 3.6 + 1;
  const wing = hall - 3.6;
  // The clock tower stands well clear of the roof (ridge ~4.4 m above the eaves).
  const towerH = hall + 11;
  return (
    <group>
      {/* Forecourt with a round fountain. */}
      <B mat={c.stone} w={26} h={0.08} d={6} z={-8} />
      <mesh position={[-8, 0.4, -8]} material={c.stone} castShadow>
        <cylinderGeometry args={[2, 2.2, 0.8, 24]} />
      </mesh>
      <mesh position={[-8, 0.82, -8]} material={c.water}>
        <cylinderGeometry args={[1.7, 1.7, 0.05, 24]} />
      </mesh>
      <mesh position={[-8, 1.4, -8]} material={c.white}>
        <cylinderGeometry args={[0.25, 0.35, 1.4, 10]} />
      </mesh>
      {/* Main hall and side wings, white cornices, window rows per floor. */}
      <B mat={c.cream} w={14} h={hall} d={10} z={1.5} />
      <B mat={c.trim} w={14.4} h={0.5} d={10.4} y={hall} z={1.5} />
      <KRoof w={14.4} d={10.4} h={3.4} y={hall + 0.5} z={1.5} />
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * 10.5, 0, 2]}>
          <B mat={c.cream} w={7} h={wing} d={9} />
          <B mat={c.trim} w={7.4} h={0.45} d={9.4} y={wing} />
          <KRoof w={7.4} d={9.4} h={2.6} y={wing + 0.45} />
        </group>
      ))}
      {/* Back: windows on every floor (not behind the annex), the annex, a small garden. */}
      <group rotation={[0, Math.PI, 0]}>
        {Array.from({ length: floors }, (_, f) =>
          [-11.5, -9, -4.5, -2, 2, 4.5, 9, 11.5]
            .filter((x) => (Math.abs(x) < 4.6 || f < floors - 1) && !(f === 0 && Math.abs(x) < 3))
            .map((x) => <TownWindow key={`b${f}${x}`} x={x} y={1.2 + f * 3.6} z={-6.5} />),
        )}
      </group>
      <TownAnnex />
      <TownGarden />
      {Array.from({ length: floors }, (_, f) =>
        [-11.5, -9, -4.5, -2, 2, 4.5, 9, 11.5]
          .filter((x) => Math.abs(x) < 4.6 || f < floors - 1)
          .map((x) => <TownWindow key={`${f}${x}`} x={x} y={1.2 + f * 3.6} z={Math.abs(x) > 7 ? -2.5 : -3.5} grand={f === 0} />),
      )}
      {/* Entrance with steps and a red-roofed porch. */}
      <B mat={c.stone} w={7} h={0.5} d={2} z={-4.4} />
      <B mat={c.dark} w={2.6} h={3.2} d={0.2} y={0.5} z={-3.6} />
      <B mat={c.red} w={6} h={0.4} d={2.4} y={3.8} z={-4.4} />
      {/* Clock tower in the middle front. */}
      <group position={[0, 0, -1]}>
        <B mat={c.cream} w={5} h={towerH} d={5} y={0} />
        <B mat={c.trim} w={5.4} h={0.5} d={5.4} y={towerH} />
        {[0, Math.PI / 2, Math.PI, -Math.PI / 2].map((r) => (
          <group key={r} rotation={[0, r, 0]}>
            <mesh position={[0, towerH - 2.6, -2.56]} rotation={[Math.PI / 2, 0, 0]} material={c.gold}>
              <cylinderGeometry args={[1.5, 1.5, 0.15, 24]} />
            </mesh>
            <mesh position={[0, towerH - 2.6, -2.65]} rotation={[Math.PI / 2, 0, 0]} material={c.white}>
              <cylinderGeometry args={[1.25, 1.25, 0.1, 24]} />
            </mesh>
            <B mat={c.dark} w={0.15} h={1} d={0.05} y={towerH - 2.6} z={-2.72} />
          </group>
        ))}
        {/* Pyramid roof square on the tower, gold lantern and spire on top. */}
        <KRoof w={5.4} d={5.4} h={4.6} y={towerH + 0.5} />
        <B mat={c.gold} w={0.9} h={0.9} d={0.9} y={towerH + 0.5 + 0.45 + 4.2} />
        <B mat={c.gold} w={0.25} h={2.2} d={0.25} y={towerH + 0.5 + 0.45 + 5.1} />
        <mesh position={[0, towerH + 0.5 + 0.45 + 7.5, 0]} material={c.gold}>
          <sphereGeometry args={[0.45, 12, 8]} />
        </mesh>
      </group>
      {/* Flags at the forecourt. */}
      {[-12, 12].map((x) => (
        <group key={x} position={[x, 0, -10]}>
          <B mat={c.trim} w={0.18} h={9} d={0.18} />
          <mesh position={[1.1, 8, 0]} material={c.flag}>
            <planeGeometry args={[2.2, 1.4]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ---------- church ---------- */

/**
 * Tall arched window on a side wall (Kenney look, facing +z before rotation): thick grey-blue
 * frame standing proud, glass set back with a cross of glazing bars, a diagonal highlight, a sill.
 */
function ArchWindow({ x, y, z, side }: { x: number; y: number; z: number; side: 1 | -1 }) {
  const c = m();
  const half = (r: number, depth: number, mat: THREE.Material, dz: number, yy: number) => (
    <mesh position={[0, yy, dz]} rotation={[Math.PI / 2, 0, 0]} material={mat}>
      <cylinderGeometry args={[r, r, depth, 16, 1, false, -Math.PI / 2, Math.PI]} />
    </mesh>
  );
  return (
    <group position={[x, y, z]} rotation={[0, side * (Math.PI / 2), 0]}>
      {/* Frame. */}
      <B mat={c.frame} w={1.9} h={3.2} d={0.3} />
      {half(0.95, 0.3, c.frame, 0, 3.2)}
      {/* Glass, set back a little. */}
      <B mat={c.pane} w={1.35} h={3.0} d={0.1} y={0.1} z={0.12} />
      {half(0.67, 0.1, c.pane, 0.12, 3.1)}
      {/* Glazing bars and a highlight. */}
      <B mat={c.frame} w={0.12} h={3.6} d={0.12} y={0.1} z={0.2} />
      <B mat={c.frame} w={1.35} h={0.12} d={0.12} y={2.2} z={0.2} />
      <mesh position={[-0.3, 1.2, 0.19]} rotation={[0, 0, 0.6]} material={c.shine}>
        <boxGeometry args={[0.14, 1.1, 0.02]} />
      </mesh>
      {/* Sill. */}
      <B mat={c.trim} w={2.2} h={0.22} d={0.55} y={-0.2} z={0.15} />
    </group>
  );
}

/** Kenney house door on a wall facing −z (bottom at y = 0): frame, two-panel door with a fanlight, handle, step. */
function KenneyDoor({ z, w = 1.9, h = 3 }: { z: number; w?: number; h?: number }) {
  const c = m();
  return (
    <group position={[0, 0, z]}>
      <B mat={c.stone} w={w + 1.2} h={0.25} d={1.2} z={-0.6} />
      <B mat={c.frame} w={w + 0.6} h={h + 0.5} d={0.3} y={0.2} />
      <B mat={c.doorDark} w={w} h={h - 0.6} d={0.32} y={0.25} z={-0.04} />
      {[0.3, 1.3].map((yy) => (
        <B key={yy} mat={c.frame} w={w * 0.7} h={0.8} d={0.06} y={0.25 + yy} z={-0.21} />
      ))}
      <B mat={c.pane} w={w} h={0.45} d={0.32} y={h - 0.3} z={-0.04} />
      <mesh position={[w * 0.32, 1.35, -0.26]} material={c.gold}>
        <sphereGeometry args={[0.08, 8, 6]} />
      </mesh>
    </group>
  );
}

/** Gable roof over w × d (ridge along z, eaves at y = 0) with white rim boards on both gables and the eaves. */
function GableRoof({ w, d, h }: { w: number; d: number; h: number }) {
  const c = m();
  const hw = w / 2 + 0.5;
  const len = d + 0.8;
  const slope = Math.atan2(h, hw);
  const side = Math.hypot(hw, h);
  return (
    <group>
      <mesh position={[0, 0, -len / 2]} material={c.roof} castShadow receiveShadow>
        <extrudeGeometry args={[new THREE.Shape([new THREE.Vector2(-hw, 0), new THREE.Vector2(0, h), new THREE.Vector2(hw, 0)]), { depth: len, bevelEnabled: false }]} />
      </mesh>
      {[-1, 1].flatMap((s) =>
        [-1, 1].map((g) => (
          <mesh key={`${s}${g}`} position={[(s * hw) / 2, h / 2 + 0.15, (g * len) / 2]} rotation={[0, 0, -s * slope]} material={c.trim} castShadow>
            <boxGeometry args={[side + 0.3, 0.4, 0.35]} />
          </mesh>
        )),
      )}
      {[-1, 1].map((s) => (
        <B key={s} mat={c.trim} w={0.4} h={0.4} d={len + 0.35} x={s * hw} y={-0.15} />
      ))}
      <B mat={c.eave} w={0.5} h={0.35} d={len + 0.2} y={h - 0.1} />
    </group>
  );
}

/**
 * Church in the City Pack style (same footprint as the classic one): light nave with a gable
 * roof and white rims, tall arched windows, round choir at the back; the tower in front with
 * sound openings, gold clocks, a pyramid spire and a gold cross.
 */
export function PackChurch() {
  const c = m();
  const naveZ0 = -6.2;
  const naveZ1 = 9;
  const naveW = 10.5;
  const naveH = 8;
  const naveZ = (naveZ0 + naveZ1) / 2;
  const towerZ = -9;
  const T = 5.6;
  const towerH = 17;
  return (
    <group>
      {/* Nave with plinth and the roof. */}
      <B mat={c.stone} w={naveW + 0.3} h={0.6} d={naveZ1 - naveZ0 + 0.2} z={naveZ} />
      <B mat={c.cream} w={naveW} h={naveH} d={naveZ1 - naveZ0} z={naveZ} />
      <group position={[0, naveH, naveZ]}>
        <GableRoof w={naveW} d={naveZ1 - naveZ0} h={4.6} />
      </group>
      {[-2.6, 1.6, 5.8].flatMap((z) => [-1, 1].map((s) => <ArchWindow key={`${z}${s}`} x={s * (naveW / 2 + 0.05)} y={2.2} z={z} side={s as 1 | -1} />))}
      {/* Choir at the back: half of a six-sided tower with a half-cone roof and a white rim. */}
      <mesh position={[0, 3.3, naveZ1]} material={c.cream} castShadow receiveShadow>
        <cylinderGeometry args={[4.4, 4.4, 6.6, 6, 1, false, -Math.PI / 2, Math.PI]} />
      </mesh>
      <mesh position={[0, 6.75, naveZ1]} material={c.trim} castShadow>
        <cylinderGeometry args={[4.75, 4.75, 0.35, 6, 1, false, -Math.PI / 2, Math.PI]} />
      </mesh>
      <mesh position={[0, 6.9 + 1.6, naveZ1]} material={c.roof} castShadow>
        <coneGeometry args={[4.8, 3.2, 6, 1, false, -Math.PI / 2, Math.PI]} />
      </mesh>
      {/* Tower: white corners, door, sound openings, clocks, spire, cross. */}
      <group position={[0, 0, towerZ]}>
        <B mat={c.cream} w={T} h={towerH} d={T} />
        {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <B key={`${sx}${sz}`} mat={c.trim} w={0.45} h={towerH} d={0.45} x={(sx * T) / 2} z={(sz * T) / 2} />))}
        {[6, towerH - 0.4].map((y) => (
          <B key={y} mat={c.trim} w={T + 0.4} h={0.4} d={T + 0.4} y={y} />
        ))}
        <KenneyDoor z={-T / 2 - 0.15} />
        {[0, Math.PI / 2, Math.PI, -Math.PI / 2].map((r) => (
          <group key={r} rotation={[0, r, 0]}>
            <B mat={c.dark} w={1.3} h={2.2} d={0.1} y={towerH - 3.4} z={-T / 2 - 0.02} />
            <mesh position={[0, towerH - 5.4, -T / 2 - 0.05]} rotation={[Math.PI / 2, 0, 0]} material={c.gold}>
              <cylinderGeometry args={[1, 1, 0.15, 24]} />
            </mesh>
            <mesh position={[0, towerH - 5.4, -T / 2 - 0.12]} rotation={[Math.PI / 2, 0, 0]} material={c.white}>
              <cylinderGeometry args={[0.8, 0.8, 0.1, 24]} />
            </mesh>
          </group>
        ))}
        <KRoof w={T + 0.2} d={T + 0.2} h={8} y={towerH} />
        <B mat={c.gold} w={0.25} h={2.2} d={0.25} y={towerH + 8.4} />
        <B mat={c.gold} w={1.2} h={0.25} d={0.25} y={towerH + 9.8} />
      </group>
    </group>
  );
}
