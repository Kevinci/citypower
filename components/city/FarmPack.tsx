"use client";

import * as THREE from "three";
import { useKitParts } from "./HousePack";
import { KitModel } from "./PackBuildings";

/**
 * Farmyard of the farm in the City Pack style (Kenney look): a family house from the
 * suburban kit, a red barn with white trim, gambrel roof and a big cross-braced door, a
 * silo with a red dome, hay bales; the estate (level 3) adds an open machine shed and a
 * second, taller silo. Same places as the classic yard (local coordinates, street at −z).
 */

const HOUSE = "/models/city/suburban/building-type-n.glb";
const URLS = [HOUSE];

let mats: Record<"barn" | "trim" | "roof" | "door" | "silo" | "cap" | "band" | "hay" | "shed" | "shedRoof" | "base" | "ridge" | "plank" | "water", THREE.MeshStandardMaterial> | null = null;
function farmMaterials() {
  mats ??= {
    barn: new THREE.MeshStandardMaterial({ color: "#c24a3a", roughness: 0.8 }),
    trim: new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.8 }),
    roof: new THREE.MeshStandardMaterial({ color: "#4a4f57", roughness: 0.7, side: THREE.DoubleSide }),
    door: new THREE.MeshStandardMaterial({ color: "#8e3328", roughness: 0.8 }),
    silo: new THREE.MeshStandardMaterial({ color: "#dfe4e8", roughness: 0.5, metalness: 0.2 }),
    cap: new THREE.MeshStandardMaterial({ color: "#c24a3a", roughness: 0.6 }),
    band: new THREE.MeshStandardMaterial({ color: "#9aa3aa", roughness: 0.5, metalness: 0.3 }),
    hay: new THREE.MeshStandardMaterial({ color: "#e3c25a", roughness: 0.95 }),
    shed: new THREE.MeshStandardMaterial({ color: "#5f6b73", roughness: 0.6, metalness: 0.3 }),
    shedRoof: new THREE.MeshStandardMaterial({ color: "#4f8a4f", roughness: 0.7, side: THREE.DoubleSide }),
    base: new THREE.MeshStandardMaterial({ color: "#8f8a82", roughness: 0.9 }),
    ridge: new THREE.MeshStandardMaterial({ color: "#363b44", roughness: 0.6 }),
    plank: new THREE.MeshStandardMaterial({ color: "#b0784a", roughness: 0.85 }),
    water: new THREE.MeshStandardMaterial({ color: "#5fb4d9", roughness: 0.15 }),
  };
  return mats;
}

function B({ m, w, h, d, x = 0, y = 0, z = 0, ry = 0 }: { m: THREE.Material; w: number; h: number; d: number; x?: number; y?: number; z?: number; ry?: number }) {
  return (
    <mesh position={[x, y + h / 2, z]} rotation={[0, ry, 0]} material={m} castShadow receiveShadow>
      <boxGeometry args={[w, h, d]} />
    </mesh>
  );
}

/** Gambrel roof (two slopes per side) over a w × d barn, ridge along z, eaves at y. */
function gambrelGeometry(w: number, d: number) {
  const hw = w / 2 + 0.4;
  // Profile: eave, knee, ridge.
  const prof: [number, number][] = [
    [-hw, 0],
    [-hw * 0.62, 2.6],
    [0, 4.4],
    [hw * 0.62, 2.6],
    [hw, 0],
  ];
  const shape = new THREE.Shape(prof.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: d + 0.8, bevelEnabled: false });
  g.translate(0, 0, -(d + 0.8) / 2);
  return g;
}
const gambrelCache = new Map<string, THREE.BufferGeometry>();
const gambrel = (w: number, d: number) => {
  const k = `${w}x${d}`;
  let g = gambrelCache.get(k);
  if (!g) gambrelCache.set(k, (g = gambrelGeometry(w, d)));
  return g;
};

function Barn({ x, z }: { x: number; z: number }) {
  const m = farmMaterials();
  const w = 13;
  const d = 16;
  const h = 7;
  return (
    <group position={[x, 0, z]}>
      <B m={m.barn} w={w} h={h} d={d} />
      {/* White corner trim and eave band. */}
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <B key={`${sx}${sz}`} m={m.trim} w={0.5} h={h} d={0.5} x={(sx * w) / 2} z={(sz * d) / 2} />))}
      <B m={m.trim} w={w + 0.6} h={0.4} d={d + 0.6} y={h - 0.2} />
      {/* Gable end walls follow the roof: a red box up to the knee, the roof covers the rest. */}
      <mesh geometry={gambrel(w, d)} material={m.roof} position={[0, h, 0]} castShadow receiveShadow />
      <mesh position={[0, h, -(d - 0.1) / 2]} material={m.barn}>
        <extrudeGeometry
          args={[
            new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(-w * 0.31, 2.5), new THREE.Vector2(0, 4.2), new THREE.Vector2(w * 0.31, 2.5), new THREE.Vector2(w / 2, 0)]),
            { depth: d - 0.1, bevelEnabled: false },
          ]}
        />
      </mesh>
      <RoofRims w={w} d={d} y={h} />
      {/* Dark plinth along the bottom of the walls. */}
      <B m={m.base} w={w + 0.15} h={0.6} d={d + 0.15} />
      {/* Big door with white frame and cross brace on the street side, hay loft hatch above. */}
      <group position={[0, 0, -d / 2 - 0.06]}>
        <B m={m.trim} w={6.2} h={5.4} d={0.1} />
        <B m={m.door} w={5.6} h={5} d={0.14} z={-0.02} />
        {[0.7, -0.7].map((r) => (
          <mesh key={r} position={[0, 2.5, -0.12]} rotation={[0, 0, r]} material={m.trim}>
            <boxGeometry args={[0.35, 7.2, 0.06]} />
          </mesh>
        ))}
        <B m={m.trim} w={2.6} h={2.2} d={0.12} y={h + 0.5} />
        <B m={m.door} w={1.9} h={1.6} d={0.16} y={h + 0.8} z={-0.02} />
        <B m={m.trim} w={2.9} h={0.25} d={0.4} y={h + 0.4} z={-0.12} />
      </group>
    </group>
  );
}

/**
 * Rims of the gambrel roof (Kenney look): white boards along both gable outlines, thick eave
 * boards along the long sides and a ridge cap.
 */
function RoofRims({ w, d, y }: { w: number; d: number; y: number }) {
  const m = farmMaterials();
  const hw = w / 2 + 0.4;
  const prof: [number, number][] = [
    [-hw, 0],
    [-hw * 0.62, 2.6],
    [0, 4.4],
    [hw * 0.62, 2.6],
    [hw, 0],
  ];
  const len = d + 0.8;
  return (
    <group position={[0, y, 0]}>
      {[-1, 1].map((side) =>
        prof.slice(1).map(([x1, y1], i) => {
          const [x0, y0] = prof[i];
          const l = Math.hypot(x1 - x0, y1 - y0);
          return (
            <mesh key={`${side}${i}`} position={[(x0 + x1) / 2, (y0 + y1) / 2 + 0.12, (side * len) / 2]} rotation={[0, 0, Math.atan2(y1 - y0, x1 - x0)]} material={m.trim} castShadow>
              <boxGeometry args={[l + 0.35, 0.4, 0.35]} />
            </mesh>
          );
        }),
      )}
      {[-hw, hw].map((x) => (
        <B key={x} m={m.trim} w={0.4} h={0.4} d={len + 0.35} x={x} y={-0.1} />
      ))}
      <B m={m.ridge} w={0.6} h={0.35} d={len + 0.2} y={4.3} />
    </group>
  );
}

/** Ladder up a silo (rails and rungs merged once per height). */
const ladderCache = new Map<number, THREE.BufferGeometry>();
function ladderGeometry(h: number) {
  let g = ladderCache.get(h);
  if (g) return g;
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-0.3, 0.3]) parts.push(new THREE.BoxGeometry(0.08, h, 0.08).translate(x, h / 2, 0));
  for (let y = 0.6; y < h; y += 0.6) parts.push(new THREE.BoxGeometry(0.6, 0.06, 0.06).translate(0, y, 0));
  const pos: number[] = [];
  const nor: number[] = [];
  for (const p of parts) {
    const n = p.toNonIndexed();
    pos.push(...(n.attributes.position.array as Float32Array));
    nor.push(...(n.attributes.normal.array as Float32Array));
    n.dispose();
    p.dispose();
  }
  g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  ladderCache.set(h, g);
  return g;
}

/** Silo: concrete plinth, bands, a thick rim under the red dome, vent on top, ladder at the side. */
function Silo({ x, z, h, r }: { x: number; z: number; h: number; r: number }) {
  const m = farmMaterials();
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.35, 0]} material={m.base} castShadow receiveShadow>
        <cylinderGeometry args={[r + 0.5, r + 0.6, 0.7, 20]} />
      </mesh>
      <mesh position={[0, h / 2, 0]} material={m.silo} castShadow receiveShadow>
        <cylinderGeometry args={[r, r, h, 20]} />
      </mesh>
      {[0.2, 0.4, 0.6, 0.8].map((f) => (
        <mesh key={f} position={[0, h * f, 0]} material={m.band}>
          <cylinderGeometry args={[r + 0.12, r + 0.12, 0.45, 20]} />
        </mesh>
      ))}
      <mesh position={[0, h - 0.1, 0]} material={m.trim} castShadow>
        <cylinderGeometry args={[r + 0.3, r + 0.3, 0.55, 20]} />
      </mesh>
      <mesh position={[0, h + 0.15, 0]} material={m.cap} castShadow>
        <sphereGeometry args={[r * 1.04, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <mesh position={[0, h + 0.15 + r * 1.04 - 0.1, 0]} material={m.trim}>
        <cylinderGeometry args={[0.45, 0.5, 0.7, 12]} />
      </mesh>
      <mesh position={[0, h + 0.15 + r * 1.04 + 0.3, 0]} material={m.cap}>
        <cylinderGeometry args={[0.6, 0.6, 0.15, 12]} />
      </mesh>
      <mesh geometry={ladderGeometry(h)} position={[0, 0.7, -r - 0.18]} material={m.band} castShadow />
    </group>
  );
}

function HayBale({ x, z, ry = 0 }: { x: number; z: number; ry?: number }) {
  const m = farmMaterials();
  return (
    <mesh position={[x, 0.75, z]} rotation={[Math.PI / 2, 0, ry]} material={m.hay} castShadow>
      <cylinderGeometry args={[0.75, 0.75, 1.3, 14]} />
    </mesh>
  );
}

export function PackFarmyard({ front, level }: { front: number; level: number }) {
  const models = useKitParts(URLS);
  const house = models.get(HOUSE);
  const m = farmMaterials();
  return (
    <group>
      {house && <KitModel model={house} kit="suburban" variant={2} x={-15} z={front + 8} s={Math.min(12 / house.size.x, 10 / house.size.z)} />}
      <Barn x={6} z={front + 10} />
      <Silo x={20} z={front + 9} h={14} r={2.6} />
      <HayBale x={-4} z={front + 4} ry={0.3} />
      <HayBale x={-2.4} z={front + 3.4} ry={-0.2} />
      <HayBale x={-3.2} z={front + 5.2} ry={1.2} />
      {level >= 3 && (
        <>
          {/* Open machine shed with a green roof, a second, taller silo. */}
          {[-8.7, -2.3].map((x) => (
            <B key={x} m={m.shed} w={0.3} h={5} d={13} x={x} z={front + 10} />
          ))}
          <B m={m.shed} w={6.6} h={5} d={0.3} x={-5.5} z={front + 16.4} />
          <B m={m.shedRoof} w={7.4} h={0.35} d={13.8} x={-5.5} y={5} z={front + 10} />
          {/* Rim round the shed roof. */}
          {[-1, 1].map((s) => (
            <B key={`x${s}`} m={m.trim} w={0.3} h={0.5} d={14.1} x={-5.5 + s * 3.75} y={4.95} z={front + 10} />
          ))}
          {[-1, 1].map((s) => (
            <B key={`z${s}`} m={m.trim} w={7.8} h={0.5} d={0.3} x={-5.5} y={4.95} z={front + 10 + s * 7.05} />
          ))}
          <Silo x={25.3} z={front + 9} h={17} r={2.2} />
        </>
      )}
    </group>
  );
}

/* ---------- fields and enclosures of the City Pack farm ---------- */

function canvasTex(draw: (g: CanvasRenderingContext2D) => void, repeat: number) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

let fields: Record<"wheat" | "pasture" | "mud", THREE.MeshStandardMaterial> | null = null;
/** Flat Kenney-look surfaces for the farm: wheat rows, pasture with tufts, mud with puddles. */
export function packFieldMaterials() {
  if (fields) return fields;
  const wheat = canvasTex((g) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? "#e9b949" : "#f6cf5c";
      g.fillRect(i * 16, 0, 16, 128);
    }
  }, 5);
  const pasture = canvasTex((g) => {
    g.fillStyle = "#2f9a6c";
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = "#4fb87e";
    let r = 3;
    const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 10; i++) {
      const x = rnd() * 128;
      const y = rnd() * 128;
      g.beginPath();
      g.ellipse(x, y, 5, 3, 0, 0, Math.PI * 2);
      g.ellipse(x + 6, y + 2, 4, 2.5, 0, 0, Math.PI * 2);
      g.fill();
    }
  }, 6);
  const mud = canvasTex((g) => {
    g.fillStyle = "#8f5f3c";
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = "#6e4429";
    let r = 9;
    const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.ellipse(rnd() * 128, rnd() * 128, 10 + rnd() * 10, 6 + rnd() * 6, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }, 4);
  fields = {
    wheat: new THREE.MeshStandardMaterial({ map: wheat, roughness: 0.9 }),
    pasture: new THREE.MeshStandardMaterial({ map: pasture, roughness: 0.95 }),
    mud: new THREE.MeshStandardMaterial({ map: mud, roughness: 0.95 }),
  };
  return fields;
}

/** Open shelter on the pasture: red roof with white rims on chunky posts. */
export function PackShelter({ y }: { y: number }) {
  const m = farmMaterials();
  return (
    <group position={[-22.5, y, 26.5]}>
      {[
        [-3.5, -2],
        [3.5, -2],
        [-3.5, 2],
        [3.5, 2],
      ].map(([x, z]) => (
        <B key={`${x}${z}`} m={m.trim} w={0.45} h={3} d={0.45} x={x} z={z} />
      ))}
      <B m={m.barn} w={7.6} h={2.4} d={0.3} y={0.4} z={2.1} />
      <B m={m.trim} w={8.4} h={0.35} d={5.2} y={3} />
      <mesh position={[0, 3.35, 0]} rotation={[0, Math.PI / 2, 0]} material={m.barn} castShadow>
        <extrudeGeometry args={[new THREE.Shape([new THREE.Vector2(-2.6, 0), new THREE.Vector2(0, 1.3), new THREE.Vector2(2.6, 0)]), { depth: 8.4, bevelEnabled: false }]} />
      </mesh>
    </group>
  );
}

/** Wooden trough with water (pasture) or feed (pig run). */
export function PackTrough({ x, z, y, w, feed }: { x: number; z: number; y: number; w: number; feed?: boolean }) {
  const m = farmMaterials();
  return (
    <group position={[x, y, z]}>
      <B m={m.plank} w={w} h={0.6} d={1} />
      <B m={feed ? m.hay : m.water} w={w - 0.3} h={0.06} d={0.7} y={0.52} />
    </group>
  );
}

/** Pig hut: red half-tube with white end rims, straw at the entrance (open towards −z). */
export function PackPigHut({ x, z, y }: { x: number; z: number; y: number }) {
  const m = farmMaterials();
  return (
    <group position={[x, y, z]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={m.barn} castShadow receiveShadow>
        <cylinderGeometry args={[1.3, 1.3, 3.2, 14, 1, true, Math.PI / 2, Math.PI]} />
      </mesh>
      {[-1.6, 1.6].map((dz) => (
        <mesh key={dz} position={[0, 0, dz]} material={m.trim} castShadow>
          <torusGeometry args={[1.3, 0.14, 6, 14, Math.PI]} />
        </mesh>
      ))}
      <mesh position={[0, 0, 1.55]} material={m.door}>
        <circleGeometry args={[1.25, 14, 0, Math.PI]} />
      </mesh>
      <B m={m.hay} w={2.2} h={0.1} d={1.2} z={-2.1} />
    </group>
  );
}
