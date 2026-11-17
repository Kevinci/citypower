import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Zeitungsverlag (30 × 24 m plot, street at −z): a brick editorial building at the front left
 * with rows of windows and a RUNDSCHAU sign on the roof, the printing hall with a sawtooth roof
 * behind on the right, giant paper rolls and a delivery van in the yard.
 */

let mats: ReturnType<typeof makeMaterials> | null = null;
function makeMaterials() {
  const std = (color: string, roughness = 0.8, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  return {
    brick: std("#9a4a36"),
    trim: std("#ece6da", 0.6),
    glass: std("#2a3a4c", 0.12, { metalness: 0.4, emissive: new THREE.Color("#ffcf7a"), emissiveIntensity: 0.25 }),
    hall: std("#a9b0b8", 0.7),
    roof: std("#4a525b", 0.6),
    skylight: std("#9cc9e6", 0.1, { metalness: 0.3 }),
    yard: std("#c9bfa8", 0.95),
    paper: std("#f4f1ea", 0.6),
    core: std("#8a6a44", 0.8),
    van: std("#1a3d7a", 0.5),
    tyre: std("#22262b", 0.8),
    sign: signMaterial(),
  };
}
const materials = () => (mats ??= makeMaterials());

function signMaterial() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 96;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f6f0e1";
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = "#22201c";
  g.font = "bold 64px Georgia, 'Times New Roman', serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("RUNDSCHAU", 256, 52);
  g.fillRect(16, 8, 480, 4);
  g.fillRect(16, 84, 480, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, emissive: new THREE.Color("#ffffff"), emissiveMap: t, emissiveIntensity: 0.35, toneMapped: false });
}

const unit = new THREE.BoxGeometry(1, 1, 1);
type B = [x: number, z: number, w: number, d: number, y0: number, y1: number];
function Boxes({ list, m, shadow = true }: { list: B[]; m: THREE.Material; shadow?: boolean }) {
  const geometry = useMemo(() => mergeGeometries(list.map(([x, z, w, d, y0, y1]) => unit.clone().scale(w, y1 - y0, d).translate(x, (y0 + y1) / 2, z)))!, [list]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} material={m} castShadow={shadow} receiveShadow />;
}

// Editorial building: x −14..−2, z −11..−1, three storeys of 3.3 m.
const OFFICE: B[] = [[-8, -6, 12, 10, 0, 10]];
const CORNICE: B[] = [
  [-8, -6, 12.4, 10.4, 10, 10.5],
  [-8, -6, 12.2, 10.2, 3.2, 3.45],
  [-8, -6, 12.2, 10.2, 6.5, 6.75],
];
const WINDOWS: B[] = [];
const FRAMES: B[] = [];
for (let floor = 0; floor < 3; floor++) {
  const y0 = 0.9 + floor * 3.3;
  for (let i = 0; i < 4; i++) {
    const x = -12.5 + i * 3;
    // Ground floor: the entrance in the middle instead of two windows.
    if (floor === 0 && (i === 1 || i === 2)) continue;
    WINDOWS.push([x, -11.08, 1.6, 0.1, y0, y0 + 1.7]);
    FRAMES.push([x, -11.04, 1.85, 0.08, y0 - 0.12, y0 + 1.82]);
  }
  for (let i = 0; i < 3; i++) WINDOWS.push([-14.08, -9 + i * 3, 0.1, 1.6, y0, y0 + 1.7]);
}
const ENTRANCE: B[] = [[-8, -11.08, 3.6, 0.1, 0.05, 2.8]];
const CANOPY: B[] = [[-8, -11.8, 4.6, 1.6, 2.9, 3.1]];
// Printing hall: x 0..14, z −4..11, sawtooth roof as tilted strips.
const HALL: B[] = [[7, 3.5, 14, 15, 0, 6.5]];
const ROLLS = [
  [-11, 4],
  [-8.5, 4],
  [-11, 6.8],
  [-6, 4],
];
const VAN: B[] = [[-3.5, -6.5, 2, 5, 0.5, 2.6]];

export function NewspaperHouse() {
  const m = materials();
  return (
    <group>
      <mesh geometry={unit} material={m.yard} position={[0, 0.02, 0]} scale={[30, 0.04, 24]} receiveShadow />
      <Boxes list={OFFICE} m={m.brick} />
      <Boxes list={CORNICE} m={m.trim} />
      <Boxes list={FRAMES} m={m.trim} shadow={false} />
      <Boxes list={WINDOWS} m={m.glass} shadow={false} />
      <Boxes list={ENTRANCE} m={m.glass} shadow={false} />
      <Boxes list={CANOPY} m={m.trim} />
      <Boxes list={HALL} m={m.hall} />
      {/* Sawtooth roof: four sloped bays with skylights facing north. */}
      {[0, 1, 2, 3].map((i) => (
        <group key={i} position={[7, 6.5, -2.2 + i * 3.75]}>
          <mesh geometry={unit} material={m.roof} position={[0, 0.9, 0]} rotation={[0.45, 0, 0]} scale={[14, 0.15, 3.9]} castShadow />
          <mesh geometry={unit} material={m.skylight} position={[0, 0.9, 1.75]} scale={[13.6, 1.8, 0.1]} />
        </group>
      ))}
      {/* Sign on the roof of the editorial building, facing the street. */}
      <mesh geometry={unit} material={m.roof} position={[-8, 11.6, -9.5]} scale={[9.4, 2.2, 0.2]} castShadow />
      <mesh material={m.sign} position={[-8, 11.6, -9.62]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[9, 1.7]} />
      </mesh>
      {/* Giant paper rolls in the yard and the delivery van. */}
      {ROLLS.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh material={m.paper} position={[0, 1.1, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[1.1, 1.1, 1.6, 20]} />
          </mesh>
          <mesh material={m.core} position={[0, 1.1, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.25, 0.25, 1.62, 10]} />
          </mesh>
        </group>
      ))}
      <Boxes list={VAN} m={m.van} />
      {[-2.2, 2.2].flatMap((dz) => [-1, 1].map((dx) => [dx, dz])).map(([dx, dz], i) => (
        <mesh key={i} material={m.tyre} position={[-3.5 + dx, 0.4, -6.5 + dz]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.4, 0.4, 0.3, 12]} />
        </mesh>
      ))}
    </group>
  );
}
