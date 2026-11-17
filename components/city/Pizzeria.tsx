import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Pizzeria (14 × 14 m plot, street at −z): a small terracotta trattoria with a flat roof,
 * green-white-red awning, a PIZZA sign that glows at night, the wood-oven chimney and tables
 * with parasols on the terrace in front. Same look in both house styles.
 */

let mats: ReturnType<typeof makeMaterials> | null = null;
function makeMaterials() {
  const std = (color: string, roughness = 0.8, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  return {
    wall: std("#d9825b"),
    trim: std("#f2e8d5"),
    roof: std("#5b4a42"),
    glass: std("#2a3a4c", 0.15, { metalness: 0.4, emissive: new THREE.Color("#ffcf7a"), emissiveIntensity: 0.3 }),
    green: std("#1f8a4c"),
    white: std("#f6f3ea"),
    red: std("#c8282e"),
    brick: std("#8e3b2a", 0.9),
    terrace: std("#d9cbb0", 0.9),
    table: std("#f4f1ea", 0.6),
    sign: signMaterial(),
  };
}
const materials = () => (mats ??= makeMaterials());

function signMaterial() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1f8a4c";
  g.fillRect(0, 0, 86, 64);
  g.fillStyle = "#f6f3ea";
  g.fillRect(86, 0, 85, 64);
  g.fillStyle = "#c8282e";
  g.fillRect(171, 0, 85, 64);
  g.font = "bold 44px Bungee, Impact, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 6;
  g.strokeStyle = "#3b2a20";
  g.strokeText("PIZZA", 128, 35);
  g.fillStyle = "#ffd36b";
  g.fillText("PIZZA", 128, 35);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, emissive: new THREE.Color("#ffffff"), emissiveMap: t, emissiveIntensity: 0.5, toneMapped: false });
}

const unit = new THREE.BoxGeometry(1, 1, 1);
type B = [x: number, z: number, w: number, d: number, y0: number, y1: number];
function Boxes({ list, m }: { list: B[]; m: THREE.Material }) {
  const geometry = useMemo(() => mergeGeometries(list.map(([x, z, w, d, y0, y1]) => unit.clone().scale(w, y1 - y0, d).translate(x, (y0 + y1) / 2, z)))!, [list]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} material={m} castShadow receiveShadow />;
}

const HOUSE: B[] = [[0, 2.5, 11, 8, 0, 5]];
const CORNICE: B[] = [[0, 2.5, 11.4, 8.4, 5, 5.4]];
const ROOF: B[] = [[0, 2.5, 10.6, 7.6, 5.4, 5.55]];
const WINDOWS: B[] = [
  [-3.3, -1.55, 2.6, 0.12, 1, 3.2],
  [3.3, -1.55, 2.6, 0.12, 1, 3.2],
  [0, -1.55, 1.6, 0.12, 0.05, 2.6],
];
// Awning in three stripes (green, white, red) over the front.
const AWNING = (i: number): B[] => [[-3.6 + i * 3.6, -2.4, 3.6, 1.8, 3.4, 3.55]];
const TERRACE: B[] = [[0, -4.6, 13, 4, 0, 0.05]];
const CHIMNEY: B[] = [[3.6, 4.6, 1.2, 1.2, 5.4, 7.6]];
const TABLES: B[] = [-4.5, 0, 4.5].flatMap((x) => [[x, -4.8, 1.1, 1.1, 0.72, 0.78] as B, [x, -4.8, 0.12, 0.12, 0, 0.72] as B]);

export function Pizzeria() {
  const m = materials();
  return (
    <group>
      <Boxes list={TERRACE} m={m.terrace} />
      <Boxes list={HOUSE} m={m.wall} />
      <Boxes list={CORNICE} m={m.trim} />
      <Boxes list={ROOF} m={m.roof} />
      <Boxes list={WINDOWS} m={m.glass} />
      <Boxes list={CHIMNEY} m={m.brick} />
      <Boxes list={AWNING(0)} m={m.green} />
      <Boxes list={AWNING(1)} m={m.white} />
      <Boxes list={AWNING(2)} m={m.red} />
      <Boxes list={TABLES} m={m.table} />
      {/* Sign above the awning, facing the street. */}
      <mesh material={m.sign} position={[0, 4.3, -1.6]}>
        <planeGeometry args={[5.2, 1.3]} />
      </mesh>
      {/* Parasols over the tables (white with a red top). */}
      {[-4.5, 0, 4.5].map((x) => (
        <group key={x} position={[x, 0, -4.8]}>
          <mesh material={m.table} position={[0, 1.3, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 2.6, 6]} />
          </mesh>
          <mesh material={x === 0 ? m.green : m.red} position={[0, 2.5, 0]} castShadow>
            <coneGeometry args={[1.4, 0.6, 8]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
