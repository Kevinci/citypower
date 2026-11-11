"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { BuildingKind } from "@/lib/city/economy";
import { kenneyPavementTexture } from "./kenneyGround";

/**
 * Yard of a City Pack factory: warm paving instead of grey concrete, a metal fence round the
 * plot with a gate at the street, and the goods the factory makes stacked in a strip beside
 * the hall – so the kind of factory reads from the air (logs at the sawmill, tyres at the
 * rubber factory, coloured spools at the spinning mill …). Kenney-style primitives.
 */

/* ---------- paving ---------- */

let paving: THREE.MeshStandardMaterial | null = null;
export function pavingMaterial() {
  paving ??= new THREE.MeshStandardMaterial({ map: kenneyPavementTexture(), roughness: 0.92 });
  return paving;
}

/** Flat yard w × d with the paving repeating every 6 m. */
function yardGeometry(w: number, d: number) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.07, 0);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 6, (uv.getY(i) * d) / 6);
  return g;
}

/* ---------- fence ---------- */

const FENCE_H = 1.8;
const GATE = 9;

/** Boxes merged into one geometry (positions and normals). */
function merge(boxes: { w: number; h: number; d: number; x: number; y: number; z: number }[]) {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const b of boxes) {
    const g = new THREE.BoxGeometry(b.w, b.h, b.d).translate(b.x, b.y, b.z).toNonIndexed();
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

/** Posts every ~3 m and two rails round the plot, gap for the gate in the middle of the front. */
function fenceGeometry(w: number, d: number, gateX: number) {
  const boxes: { w: number; h: number; d: number; x: number; y: number; z: number }[] = [];
  const x0 = -w / 2 + 0.3;
  const x1 = w / 2 - 0.3;
  const z0 = -d / 2 + 0.3;
  const z1 = d / 2 - 0.3;
  const side = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) return;
    const n = Math.max(1, Math.round(len / 3));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      boxes.push({ w: 0.12, h: FENCE_H, d: 0.12, x: ax + (bx - ax) * t, y: FENCE_H / 2, z: az + (bz - az) * t });
    }
    const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
    for (const y of [0.5, FENCE_H - 0.1])
      boxes.push({ w: alongX ? len : 0.06, h: 0.07, d: alongX ? 0.06 : len, x: (ax + bx) / 2, y, z: (az + bz) / 2 });
  };
  // Front with the gate gap, sides and back.
  side(x0, z0, gateX - GATE / 2, z0);
  side(gateX + GATE / 2, z0, x1, z0);
  side(x0, z0, x0, z1);
  side(x1, z0, x1, z1);
  side(x0, z1, x1, z1);
  return merge(boxes);
}

let fenceMat: THREE.MeshStandardMaterial | null = null;
const fenceMaterial = () => (fenceMat ??= new THREE.MeshStandardMaterial({ color: "#4d5468", roughness: 0.6, metalness: 0.3 }));

/* ---------- goods ---------- */

type Shape = "box" | "cyl" | "lying" | "torus" | "cone";
interface Piece {
  shape: Shape;
  x: number;
  y: number;
  z: number;
  /** Size: box w,h,d; cylinder r,h; torus r; cone r,h. */
  s: [number, number, number];
  color: string;
}

const PALLET = "#b88a55";
/** Pallets in a grid of 2 columns: (column, row) → position in the strip. */
const slot = (i: number) => ({ x: (i % 2) * 2.6 - 1.3, z: Math.floor(i / 2) * 2.6 });
const pallet = (i: number): Piece => ({ shape: "box", ...slot(i), y: 0, s: [2.1, 0.18, 2.1], color: PALLET });

/** What lies on the yard of each kind (local to the goods strip, rows towards the back). */
function goodsOf(kind: BuildingKind): Piece[] {
  const out: Piece[] = [];
  const stacks = (n: number, top: (i: number) => Piece[]) => {
    for (let i = 0; i < n; i++) out.push(pallet(i), ...top(i));
  };
  const at = (i: number) => slot(i);
  switch (kind) {
    case "steelworks":
      // Steel coils and beams.
      stacks(6, (i) =>
        i % 2
          ? [{ shape: "lying", ...at(i), y: 0.9, s: [0.75, 1.6, 0], color: "#9aa3aa" }]
          : [0, 1, 2].map((k) => ({ shape: "box" as Shape, ...at(i), y: 0.18 + k * 0.32, s: [1.9, 0.3, 0.5 + 0.2 * k] as [number, number, number], color: "#5f676d" })),
      );
      break;
    case "sawmill":
      // Log piles and stacks of boards.
      for (let i = 0; i < 6; i++) {
        const p = at(i);
        if (i % 2 === 0) for (const [dx, dy] of [[-0.55, 0.35], [0, 0.35], [0.55, 0.35], [-0.27, 0.95], [0.27, 0.95]]) out.push({ shape: "lying", x: p.x + dx, y: dy, z: p.z, s: [0.33, 2.2, 0], color: "#8a5a32" });
        else out.push(pallet(i), { shape: "box", ...p, y: 0.18, s: [1.9, 1.1, 1.9], color: "#d8b07a" });
      }
      break;
    case "furniture":
      stacks(6, (i) => [{ shape: "box", ...at(i), y: 0.18, s: [1.8, 1.2 + (i % 3) * 0.3, 1.8], color: i % 2 ? "#c99a62" : "#e0c08e" }]);
      break;
    case "slaughterhouse":
      stacks(4, (i) => [{ shape: "box", ...at(i), y: 0.18, s: [1.8, 1.1, 1.8], color: i % 2 ? "#e8eef2" : "#c94a3c" }]);
      break;
    case "tannery":
      stacks(4, (i) => [-0.5, 0.5].flatMap((dx) => [-0.5, 0.5].map((dz) => ({ shape: "cyl" as Shape, x: at(i).x + dx, y: 0.18, z: at(i).z + dz, s: [0.38, 1.6, 0] as [number, number, number], color: "#7a4a2a" }))));
      break;
    case "rubberfactory":
      // Stacks of tyres.
      for (let i = 0; i < 6; i++) for (let k = 0; k < 4 + (i % 3); k++) out.push({ shape: "torus", ...at(i), y: 0.2 + k * 0.42, s: [0.7, 0, 0], color: "#2b2b2e" });
      break;
    case "shoefactory":
      stacks(6, (i) => [0, 1, 2].map((k) => ({ shape: "box" as Shape, ...at(i), y: 0.18 + k * 0.45, s: [1.8, 0.42, 1.8] as [number, number, number], color: k % 2 ? "#f08a3c" : "#ffffff" })));
      break;
    case "spinning":
      // Coloured yarn spools.
      stacks(6, (i) => [-0.5, 0.5].flatMap((dx) => [-0.5, 0.5].map((dz, k) => ({ shape: "cyl" as Shape, x: at(i).x + dx, y: 0.18, z: at(i).z + dz, s: [0.38, 1.0, 0] as [number, number, number], color: ["#e86a9a", "#5aa0e0", "#f2c94c", "#7ccf7c"][(i + k) % 4] }))));
      break;
    case "clothing":
      // Fabric rolls.
      stacks(6, (i) => [0, 1].map((k) => ({ shape: "lying" as Shape, ...at(i), y: 0.55 + k * 0.7, s: [0.35, 2.0, 0] as [number, number, number], color: ["#3f6fb5", "#e84a5f", "#f2c94c", "#6dbb6d"][(i + k) % 4] })));
      break;
    case "foodfactory":
      stacks(6, (i) => [{ shape: "box", ...at(i), y: 0.18, s: [1.8, 1.3, 1.8], color: ["#e5543a", "#f2c94c", "#ffffff"][i % 3] }]);
      break;
    case "goldsmelter":
      stacks(4, (i) => [0, 1, 2].map((k) => ({ shape: "box" as Shape, ...at(i), y: 0.18 + k * 0.22, s: [1.4 - k * 0.3, 0.2, 1.0 - k * 0.2] as [number, number, number], color: "#f2c230" })));
      break;
    case "mill":
      // Flour sacks.
      stacks(6, (i) => [0, 1].flatMap((k) => [-0.45, 0.45].map((dx) => ({ shape: "box" as Shape, x: at(i).x + dx, y: 0.18 + k * 0.5, z: at(i).z, s: [0.8, 0.48, 1.6] as [number, number, number], color: "#f4efe2" }))));
      break;
    case "chickenfarm":
      stacks(4, (i) => [0, 1, 2].map((k) => ({ shape: "box" as Shape, ...at(i), y: 0.18 + k * 0.35, s: [1.8, 0.32, 1.8] as [number, number, number], color: k % 2 ? "#f1e3c2" : "#e9d3a8" })));
      break;
    case "recycling":
      stacks(6, (i) => [{ shape: "box", ...at(i), y: 0.18, s: [1.6, 1.4, 1.6], color: ["#4a8f4a", "#3d6f9e", "#a07850"][i % 3] }]);
      break;
    case "coalmine":
    case "ironmine":
    case "goldmine":
      // Ore heap in the colour of the ore.
      out.push({ shape: "cone", x: 0, y: 0, z: 2.6, s: [3.4, 3.2, 0], color: kind === "coalmine" ? "#2b2b2b" : kind === "ironmine" ? "#8b4a2f" : "#d9b23a" });
      out.push({ shape: "cone", x: 0.6, y: 0, z: 6.2, s: [2.6, 2.4, 0], color: kind === "coalmine" ? "#3a3a3a" : kind === "ironmine" ? "#7a4029" : "#c9a030" });
      break;
    case "uraniummine":
      // Yellow barrels.
      stacks(4, (i) => [-0.5, 0.5].flatMap((dx) => [-0.5, 0.5].map((dz) => ({ shape: "cyl" as Shape, x: at(i).x + dx, y: 0.18, z: at(i).z + dz, s: [0.4, 1.1, 0] as [number, number, number], color: "#e0c21f" }))));
      break;
    default:
      break;
  }
  return out;
}

/** Kinds whose goods are shown on the yard (the hall leaves them a strip at the side). */
export const GOODS_KINDS: BuildingKind[] = [
  "steelworks", "sawmill", "furniture", "slaughterhouse", "tannery", "rubberfactory", "shoefactory", "spinning", "clothing",
  "foodfactory", "goldsmelter", "mill", "chickenfarm", "recycling", "coalmine", "ironmine", "goldmine", "uraniummine",
];
/** Width of the goods strip at the side of the hall (m). */
export const GOODS_STRIP = 7;

const geo = {
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 14).translate(0, 0.5, 0),
  lying: new THREE.CylinderGeometry(1, 1, 1, 14).rotateZ(Math.PI / 2),
  torus: new THREE.TorusGeometry(1, 0.42, 8, 18).rotateX(Math.PI / 2),
  cone: new THREE.ConeGeometry(1, 1, 9).translate(0, 0.5, 0),
};
const colours = new Map<string, THREE.MeshStandardMaterial>();
const colourMaterial = (c: string) => {
  let m = colours.get(c);
  if (!m) colours.set(c, (m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 })));
  return m;
};

function Goods({ kind }: { kind: BuildingKind }) {
  const pieces = useMemo(() => goodsOf(kind), [kind]);
  return (
    <group>
      {pieces.map((p, i) => {
        const scale: [number, number, number] =
          p.shape === "box" ? p.s : p.shape === "cyl" || p.shape === "cone" ? [p.s[0], p.s[1], p.s[0]] : p.shape === "lying" ? [p.s[1], p.s[0], p.s[0]] : [p.s[0] * 0.75, p.s[0] * 0.75, p.s[0] * 0.75];
        return <mesh key={i} geometry={geo[p.shape]} material={colourMaterial(p.color)} position={[p.x, p.y, p.z]} scale={scale} castShadow receiveShadow />;
      })}
    </group>
  );
}

/** Paving, fence and goods of a factory plot w × d (local coordinates, street at −z). */
export function FactoryYard({ kind, w, d, fence, goods }: { kind: BuildingKind; w: number; d: number; fence: boolean; goods: boolean }) {
  const yard = useMemo(() => yardGeometry(w, d), [w, d]);
  // Gate beside the sign corner, towards the middle of the front.
  const fenceGeo = useMemo(() => (fence ? fenceGeometry(w, d, Math.min(0, -w / 2 + 14)) : null), [fence, w, d]);
  useEffect(() => () => yard.dispose(), [yard]);
  useEffect(() => () => fenceGeo?.dispose(), [fenceGeo]);
  return (
    <group>
      <mesh geometry={yard} material={pavingMaterial()} receiveShadow />
      {fenceGeo && <mesh geometry={fenceGeo} material={fenceMaterial()} castShadow />}
      {goods && (
        // Goods strip at the right side, from just behind the front fence backwards.
        <group position={[w / 2 - GOODS_STRIP / 2 - 0.6, 0.07, -d / 2 + 2.6]}>
          <Goods kind={kind} />
        </group>
      )}
    </group>
  );
}
