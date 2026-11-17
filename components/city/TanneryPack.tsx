"use client";

import * as THREE from "three";
import { GOODS_STRIP } from "./FactoryYard";

/**
 * Tannery in the City Pack style (Kenney look, like the farmyard in FarmPack): a brick
 * workshop with white trim and a chimney at the road, round wooden tanning vats and drying
 * racks with hides in the yard. Große Gerberei (level 2) adds an open drying shed full of
 * hanging hides and more vats in the strip the plot grew by, the Lederwerk (level 3) a leather
 * store with a loading door. Local coordinates, street at −z; the goods strip on the right stays free.
 */

type MatKey = "brick" | "trim" | "roof" | "ridge" | "door" | "glass" | "base" | "wood" | "band" | "liquor" | "lime" | "post" | "store" | "steel";
let mats: Record<MatKey, THREE.MeshStandardMaterial> | null = null;
const HIDES = ["#e8cfa0", "#7a4428", "#d9a86c", "#5c3420"].map((c) => new THREE.Color(c));
let hideMats: THREE.MeshStandardMaterial[] | null = null;
function materials() {
  mats ??= {
    brick: new THREE.MeshStandardMaterial({ color: "#b8614a", roughness: 0.85 }),
    trim: new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.8 }),
    roof: new THREE.MeshStandardMaterial({ color: "#4a4f57", roughness: 0.7, side: THREE.DoubleSide }),
    ridge: new THREE.MeshStandardMaterial({ color: "#363b44", roughness: 0.6 }),
    door: new THREE.MeshStandardMaterial({ color: "#6b4a2e", roughness: 0.8 }),
    glass: new THREE.MeshStandardMaterial({ color: "#9cc9e8", roughness: 0.2, metalness: 0.1 }),
    base: new THREE.MeshStandardMaterial({ color: "#8f8a82", roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ color: "#b0784a", roughness: 0.85 }),
    band: new THREE.MeshStandardMaterial({ color: "#5d4632", roughness: 0.6, metalness: 0.2 }),
    liquor: new THREE.MeshStandardMaterial({ color: "#4a2a12", roughness: 0.2 }),
    lime: new THREE.MeshStandardMaterial({ color: "#d9dccb", roughness: 0.4 }),
    post: new THREE.MeshStandardMaterial({ color: "#8a6242", roughness: 0.85 }),
    store: new THREE.MeshStandardMaterial({ color: "#e6dcc6", roughness: 0.85 }),
    steel: new THREE.MeshStandardMaterial({ color: "#7d8790", roughness: 0.5, metalness: 0.4 }),
  };
  return mats;
}
const hideMaterials = () => (hideMats ??= HIDES.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide })));

function B({ m, w, h, d, x = 0, y = 0, z = 0 }: { m: THREE.Material; w: number; h: number; d: number; x?: number; y?: number; z?: number }) {
  return (
    <mesh position={[x, y + h / 2, z]} material={m} castShadow receiveShadow>
      <boxGeometry args={[w, h, d]} />
    </mesh>
  );
}

/** Gable roof prism: ridge along x, eaves at y = 0, overhang included (cached per size). */
const gableCache = new Map<string, THREE.BufferGeometry>();
function gable(w: number, d: number, h: number) {
  const k = `${w}x${d}x${h}`;
  let g = gableCache.get(k);
  if (!g) {
    const hd = d / 2 + 0.5;
    const shape = new THREE.Shape([new THREE.Vector2(-hd, 0), new THREE.Vector2(0, h), new THREE.Vector2(hd, 0)]);
    g = new THREE.ExtrudeGeometry(shape, { depth: w + 1, bevelEnabled: false });
    g.translate(0, 0, -(w + 1) / 2);
    g.rotateY(Math.PI / 2);
    gableCache.set(k, g);
  }
  return g;
}

/** Kenney roof: grey prism, white boards along both gables, eave boards and a ridge cap. */
function GableRoof({ w, d, h, y }: { w: number; d: number; h: number; y: number }) {
  const m = materials();
  const hd = d / 2 + 0.5;
  const slope = Math.hypot(hd, h);
  const angle = Math.atan2(h, hd);
  return (
    <group position={[0, y, 0]}>
      <mesh geometry={gable(w, d, h)} material={m.roof} castShadow receiveShadow />
      {/* Gable walls under the roof. */}
      <mesh rotation={[0, Math.PI / 2, 0]} position={[-w / 2, 0, 0]} material={m.brick}>
        <extrudeGeometry args={[new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(0, h * (d / 2 / hd)), new THREE.Vector2(d / 2, 0)]), { depth: w, bevelEnabled: false }]} />
      </mesh>
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[(sx * (w + 1)) / 2, h / 2 + 0.1, (sz * hd) / 2]} rotation={[sz * angle, 0, 0]} material={m.trim} castShadow>
            <boxGeometry args={[0.35, 0.4, slope + 0.3]} />
          </mesh>
        )),
      )}
      {[-hd, hd].map((z) => (
        <B key={z} m={m.trim} w={w + 1.35} h={0.4} d={0.4} z={z} y={-0.2} />
      ))}
      <B m={m.ridge} w={w + 1.2} h={0.35} d={0.6} y={h - 0.15} />
    </group>
  );
}

/** Brick workshop with white corner trim, windows with frames, a door and the chimney. */
function Workshop({ x, z }: { x: number; z: number }) {
  const m = materials();
  const w = 12;
  const d = 9;
  const h = 6;
  return (
    <group position={[x, 0, z]}>
      <B m={m.base} w={w + 0.15} h={0.6} d={d + 0.15} />
      <B m={m.brick} w={w} h={h} d={d} />
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <B key={`${sx}${sz}`} m={m.trim} w={0.45} h={h} d={0.45} x={(sx * w) / 2} z={(sz * d) / 2} />))}
      <B m={m.trim} w={w + 0.5} h={0.4} d={d + 0.5} y={h - 0.3} />
      <GableRoof w={w} d={d} h={3.2} y={h} />
      {/* Street side: two windows and the door (right, clear of the name board). */}
      <group position={[0, 0, -d / 2 - 0.06]}>
        {[-3.6, -0.6].map((wx) => (
          <group key={wx} position={[wx, 2.2, 0]}>
            <B m={m.trim} w={2} h={2} d={0.1} />
            <B m={m.glass} w={1.6} h={1.6} d={0.14} y={0.2} z={-0.02} />
            <B m={m.trim} w={0.12} h={1.6} d={0.18} y={0.2} z={-0.04} />
            <B m={m.trim} w={2.3} h={0.22} d={0.35} y={-0.12} z={-0.1} />
          </group>
        ))}
        <B m={m.trim} w={2.4} h={3.4} d={0.1} x={3} />
        <B m={m.door} w={2} h={3.1} d={0.14} x={3} z={-0.02} />
        <B m={m.trim} w={0.25} h={0.25} d={0.2} x={3.6} y={1.5} z={-0.1} />
      </group>
      {/* Chimney of the boiler room with a white cap. */}
      <B m={m.brick} w={1.3} h={h + 6} d={1.3} x={-w / 2 + 1.4} z={d / 2 - 1.4} />
      <B m={m.trim} w={1.6} h={0.4} d={1.6} x={-w / 2 + 1.4} y={h + 6} z={d / 2 - 1.4} />
    </group>
  );
}

/** Round wooden tanning vat with metal hoops, filled with tan liquor (or lime). */
function Vat({ x, z, lime = false }: { x: number; z: number; lime?: boolean }) {
  const m = materials();
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.6, 0]} material={m.wood} castShadow receiveShadow>
        <cylinderGeometry args={[1.35, 1.25, 1.2, 16]} />
      </mesh>
      {[0.25, 0.95].map((y) => (
        <mesh key={y} position={[0, y, 0]} material={m.band}>
          <cylinderGeometry args={[1.39, 1.37, 0.14, 16]} />
        </mesh>
      ))}
      {/* Liquor surface just above the rim of the solid vat, the wooden edge stays visible. */}
      <mesh position={[0, 1.22, 0]} material={lime ? m.lime : m.liquor}>
        <cylinderGeometry args={[1.08, 1.08, 0.04, 16]} />
      </mesh>
    </group>
  );
}

/** Wooden drying rack with hides hanging over the bar. */
function Rack({ x, z, len = 6, seed = 0 }: { x: number; z: number; len?: number; seed?: number }) {
  const m = materials();
  const hm = hideMaterials();
  const n = Math.max(2, Math.floor(len / 1.5));
  return (
    <group position={[x, 0, z]}>
      {[-len / 2, len / 2].map((px) => (
        <B key={px} m={m.post} w={0.25} h={3} d={0.25} x={px} />
      ))}
      <B m={m.post} w={len + 0.3} h={0.2} d={0.2} y={2.85} />
      {Array.from({ length: n }, (_, i) => (
        <B key={i} m={hm[(i + seed) % hm.length]} w={1.2} h={1.6} d={0.06} x={-len / 2 + (len / n) * (i + 0.5)} y={1.2} />
      ))}
    </group>
  );
}

/** Open drying shed (level 2): posts, a gable roof with white rims, rows of hanging hides. */
function DryingShed({ x, z }: { x: number; z: number }) {
  const m = materials();
  const w = 13;
  const d = 6;
  const h = 4.2;
  return (
    <group position={[x, 0, z]}>
      {[-w / 2, 0, w / 2].flatMap((px) => [-d / 2, d / 2].map((pz) => <B key={`${px}${pz}`} m={m.trim} w={0.35} h={h} d={0.35} x={px} z={pz} />))}
      <B m={m.trim} w={w + 0.4} h={0.35} d={d + 0.4} y={h - 0.35} />
      <group position={[0, h, 0]}>
        <mesh geometry={gable(w, d, 2)} material={m.roof} castShadow receiveShadow />
        {[-(d / 2 + 0.5), d / 2 + 0.5].map((rz) => (
          <B key={rz} m={m.trim} w={w + 1.35} h={0.35} d={0.35} z={rz} y={-0.15} />
        ))}
        <B m={m.ridge} w={w + 1.2} h={0.3} d={0.5} y={1.85} />
      </group>
      {[-1.4, 1.4].map((rz, i) => (
        <Rack key={rz} x={0} z={rz} len={w - 1.5} seed={i * 2} />
      ))}
    </group>
  );
}

/** Leather store (level 3): cream hall with flat roof rim, roller door and loading ramp. */
function LeatherStore({ x, z }: { x: number; z: number }) {
  const m = materials();
  const w = 15;
  const d = 6.5;
  const h = 5.5;
  return (
    <group position={[x, 0, z]}>
      <B m={m.base} w={w + 0.15} h={0.6} d={d + 0.15} />
      <B m={m.store} w={w} h={h} d={d} />
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <B key={`${sx}${sz}`} m={m.trim} w={0.45} h={h} d={0.45} x={(sx * w) / 2} z={(sz * d) / 2} />))}
      {/* Flat roof with a thick white parapet. */}
      <B m={m.roof} w={w} h={0.3} d={d} y={h} />
      <B m={m.trim} w={w + 0.5} h={0.6} d={0.4} y={h} z={-d / 2} />
      <B m={m.trim} w={w + 0.5} h={0.6} d={0.4} y={h} z={d / 2} />
      <B m={m.trim} w={0.4} h={0.6} d={d + 0.5} y={h} x={-w / 2} />
      <B m={m.trim} w={0.4} h={0.6} d={d + 0.5} y={h} x={w / 2} />
      {/* Roller door to the side yard with a ramp; ribbed door. */}
      <group position={[w / 2 + 0.06, 0, 0]}>
        <B m={m.trim} w={0.1} h={4} d={4} />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <B key={i} m={m.steel} w={0.14} h={0.55} d={3.5} y={0.25 + i * 0.6} x={0.02} />
        ))}
        <B m={m.base} w={2.2} h={0.9} d={4.4} x={1.1} />
      </group>
      {/* Windows on the yard side. */}
      {[-4.5, -1.5].map((wx) => (
        <group key={wx} position={[wx, 2.6, -d / 2 - 0.06]}>
          <B m={m.trim} w={2} h={1.5} d={0.1} />
          <B m={m.glass} w={1.6} h={1.1} d={0.14} y={0.2} z={-0.02} />
        </group>
      ))}
    </group>
  );
}

/** The whole tannery for plot w × d at its level (only the hall area; yard and fence come from FactoryYard). */
export function PackTannery({ w, d, level }: { w: number; d: number; level: number }) {
  const front = -d / 2;
  // Area left of the goods strip.
  const right = w / 2 - GOODS_STRIP - 1;
  const left = -w / 2 + 1.5;
  const mid = (left + right) / 2;
  return (
    <group>
      <Workshop x={left + 6.2} z={front + 6.5} />
      {/* Tanning pits: two rows of vats, one with lime (de-hairing). */}
      {[0, 1, 2].flatMap((i) =>
        [0, 1].map((k) => <Vat key={`${i}${k}`} x={left + 2 + i * 3.2} z={front + 14.5 + k * 3.2} lime={i === 0 && k === 0} />),
      )}
      <Rack x={right - 3.4} z={front + 13.5} len={5.6} />
      <Rack x={right - 3.4} z={front + 18} len={5.6} seed={1} />
      {/* Barrels of tanning extract next to the workshop. */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[right - 4.5 + i * 1.4, 0.6, front + 4]} material={materials().wood} castShadow>
          <cylinderGeometry args={[0.55, 0.5, 1.2, 12]} />
        </mesh>
      ))}
      {level >= 2 && (
        <>
          <DryingShed x={mid - 1.5} z={front + 28} />
          <Vat x={right - 1.6} z={front + 26.5} />
          <Vat x={right - 1.6} z={front + 29.7} />
        </>
      )}
      {level >= 3 && <LeatherStore x={mid - 2.2} z={front + 36} />}
    </group>
  );
}
