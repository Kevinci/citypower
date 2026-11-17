import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Spielbank (34 × 28 m plot, street at −z): a dark red hall with a gold band and a gold dome,
 * a portico with white columns over a red carpet, a glowing CASINO sign with bulbs and a
 * fountain with two palms in front. Same look in both house styles.
 */

let mats: ReturnType<typeof makeMaterials> | null = null;
function makeMaterials() {
  const std = (color: string, roughness = 0.7, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  return {
    wall: std("#7a1622", 0.75),
    dark: std("#1b1d22", 0.6),
    gold: std("#e0ad2a", 0.3, { metalness: 0.9 }),
    white: std("#f2efe6", 0.6),
    glass: std("#2a3a4c", 0.15, { metalness: 0.4, emissive: new THREE.Color("#ffcf7a"), emissiveIntensity: 0.25 }),
    carpet: std("#b3121f", 0.95),
    paving: std("#d9d2c1", 0.85),
    water: std("#38b6e6", 0.08, { emissive: new THREE.Color("#0b5a7a"), emissiveIntensity: 0.35 }),
    trunk: std("#8a6a44", 0.9),
    palm: std("#3f8f3a", 0.8, { flatShading: true }),
    bulbs: new THREE.MeshStandardMaterial({ color: "#fff3c4", emissive: new THREE.Color("#ffd27a"), emissiveIntensity: 1.6, toneMapped: false }),
    sign: signMaterial(),
  };
}
const materials = () => (mats ??= makeMaterials());

/** CASINO in gold on red with a frame of bulbs (glows, not tone-mapped). */
function signMaterial() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#8a0f1c";
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = "#ffd36b";
  for (let x = 12; x < 512; x += 24) {
    g.beginPath();
    g.arc(x, 10, 5, 0, Math.PI * 2);
    g.arc(x, 118, 5, 0, Math.PI * 2);
    g.fill();
  }
  g.font = "bold 78px Bungee, Impact, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = "#ffb000";
  g.shadowBlur = 18;
  g.fillText("CASINO", 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, emissive: new THREE.Color("#ffffff"), emissiveMap: t, emissiveIntensity: 0.9, toneMapped: false });
}

const unit = new THREE.BoxGeometry(1, 1, 1);
type B = [x: number, z: number, w: number, d: number, y0: number, y1: number];
function merged(list: B[]) {
  return mergeGeometries(list.map(([x, z, w, d, y0, y1]) => unit.clone().scale(w, y1 - y0, d).translate(x, (y0 + y1) / 2, z)))!;
}
function Boxes({ list, m, shadow = true }: { list: B[]; m: THREE.Material; shadow?: boolean }) {
  const geometry = useMemo(() => merged(list), [list]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} material={m} castShadow={shadow} receiveShadow />;
}

// Hall at the back, portico at the front edge of the hall (z = −5), forecourt before it.
const HALL: B[] = [[0, 4, 28, 16, 0, 9]];
const ROOF: B[] = [[0, 4, 28.6, 16.6, 9, 9.6]];
const BAND: B[] = [
  [0, 4, 28.3, 16.3, 7.6, 8.4],
  [0, 4, 28.3, 16.3, 0, 0.5],
];
const WINDOWS: B[] = [-11, -7, 7, 11].map((x) => [x, -4.05, 2.2, 0.15, 1.5, 6.5] as B);
const PORTICO_ROOF: B[] = [[0, -7.5, 14, 5.5, 6.2, 6.9]];
const PORTICO_GOLD: B[] = [[0, -7.5, 14.3, 5.8, 6.9, 7.2]];
const COLUMNS: B[] = [-6, -2, 2, 6].map((x) => [x, -9.6, 0.7, 0.7, 0, 6.2] as B);
const ENTRANCE: B[] = [[0, -4.05, 6, 0.2, 0.1, 4.8]];
const CARPET: B[] = [[0, -10.5, 3, 7, 0, 0.06]];
const COURT: B[] = [[0, -9.5, 34, 9, 0, 0.04]];
const STEPS: B[] = [
  [0, -10.2, 9, 1, 0, 0.18],
  [0, -9.4, 9, 0.8, 0, 0.32],
];
const BULBS: B[] = [
  [0, -10.3, 14.4, 0.15, 7.15, 7.3],
  ...[-6, -2, 2, 6].map((x) => [x, -10.0, 0.15, 0.15, 6.0, 6.2] as B),
];

export function Casino() {
  const m = materials();
  return (
    <group>
      <Boxes list={COURT} m={m.paving} shadow={false} />
      <Boxes list={CARPET} m={m.carpet} shadow={false} />
      <Boxes list={STEPS} m={m.white} />
      <Boxes list={HALL} m={m.wall} />
      <Boxes list={ROOF} m={m.dark} />
      <Boxes list={BAND} m={m.gold} />
      <Boxes list={WINDOWS} m={m.glass} shadow={false} />
      <Boxes list={ENTRANCE} m={m.glass} shadow={false} />
      <Boxes list={COLUMNS} m={m.white} />
      <Boxes list={PORTICO_ROOF} m={m.white} />
      <Boxes list={PORTICO_GOLD} m={m.gold} />
      <Boxes list={BULBS} m={m.bulbs} shadow={false} />
      {/* Sign on the portico, facing the street. */}
      <mesh material={m.sign} position={[0, 8.4, -10.45]}>
        <planeGeometry args={[11, 2.75]} />
      </mesh>
      <mesh geometry={unit} material={m.dark} position={[0, 8.4, -10.3]} scale={[11.4, 3.1, 0.2]} castShadow />
      {/* Gold dome on a drum. */}
      <mesh material={m.dark} position={[0, 10.4, 4]} castShadow>
        <cylinderGeometry args={[4, 4, 1.6, 24]} />
      </mesh>
      <mesh material={m.gold} position={[0, 11.2, 4]} castShadow>
        <sphereGeometry args={[4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <mesh material={m.gold} position={[0, 15.6, 4]} castShadow>
        <coneGeometry args={[0.35, 1.6, 8]} />
      </mesh>
      {/* Fountain and palms on the forecourt. */}
      {[-11, 11].map((x) => (
        <group key={x} position={[x, 0, -9.5]}>
          <mesh material={m.white} position={[0, 0.3, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[2.2, 2.4, 0.6, 20]} />
          </mesh>
          <mesh material={m.water} position={[0, 0.58, 0]}>
            <cylinderGeometry args={[1.9, 1.9, 0.06, 20]} />
          </mesh>
          <mesh material={m.trunk} position={[0, 2.8, 0]} rotation={[0, 0, x < 0 ? 0.08 : -0.08]} castShadow>
            <cylinderGeometry args={[0.18, 0.28, 5, 8]} />
          </mesh>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <mesh key={i} material={m.palm} position={[Math.cos((i / 6) * Math.PI * 2) * 1.2, 5.2, Math.sin((i / 6) * Math.PI * 2) * 1.2]} rotation={[0, -(i / 6) * Math.PI * 2, 0.5]} castShadow>
              <boxGeometry args={[2.6, 0.08, 0.6]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}
