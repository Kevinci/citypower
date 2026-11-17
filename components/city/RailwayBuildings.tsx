"use client";

import * as THREE from "three";
import { sizeOf } from "@/lib/city/economy";
import { signGlow, windowGlow } from "./nightGlow";

/**
 * Railway buildings in the flat Kenney look. Local frame as for every building: front (−z)
 * to the land, back (+z) to the track. The platform lies along the back edge and reaches
 * 2.2 m beyond the plot towards the track (the plot keeps clear of the ballast).
 */

const m = (color: string, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
let mats: ReturnType<typeof create> | null = null;
function create() {
  return {
    box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    platform: m("#b9bcc4"),
    edge: m("#f4f2e8"),
    tactile: m("#e3c34a"),
    brick: m("#b8573e"),
    sandstone: m("#e6d2a8"),
    plaster: m("#f1ece0"),
    roof: m("#4a5560", 0.7),
    roofRed: m("#a8432c", 0.75),
    steel: m("#6b7a85", 0.5, 0.4),
    white: m("#f4f5f7"),
    green: m("#2f7d4f"),
    dark: m("#2d343a"),
    glass: windowGlow(m("#7fb6d6", 0.2, 0.1), "kit", 0.8),
    canopyGlass: new THREE.MeshStandardMaterial({ color: "#bfe3f2", roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
    sleeper: m("#5b4636", 0.95),
    rail: m("#8a9096", 0.4, 0.7),
    gravel: m("#8b8478", 1),
    signStation: signGlow(new THREE.MeshStandardMaterial({ map: signTexture("BAHNHOF", "#1d5aa8"), roughness: 0.5 }), 1.4),
    signBox: signGlow(new THREE.MeshStandardMaterial({ map: signTexture("STELLWERK", "#1d5aa8"), roughness: 0.5 }), 1.2),
    clock: new THREE.MeshStandardMaterial({ map: clockTexture(), roughness: 0.5 }),
  };
}
const useMats = () => (mats ??= create());

function signTexture(text: string, bg: string) {
  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = 96;
  const g = cv.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = "#ffffff";
  g.font = "bold 58px Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 52);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function clockTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#1d2a35";
  g.lineWidth = 6;
  g.stroke();
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(64, 64);
  g.lineTo(64, 24);
  g.moveTo(64, 64);
  g.lineTo(94, 64);
  g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function B({ mat, x = 0, z = 0, w, d, y0 = 0, y1, shadow = true }: { mat: THREE.Material; x?: number; z?: number; w: number; d: number; y0?: number; y1: number; shadow?: boolean }) {
  const a = useMats();
  return <mesh geometry={a.box} material={mat} position={[x, y0, z]} scale={[w, y1 - y0, d]} castShadow={shadow} receiveShadow />;
}

/** Platform height above the ground and how far it reaches beyond the plot towards the track. */
const PLATFORM_Y = 0.95;
const PLATFORM_REACH = 2.2;

/** Platform along the back edge: slab, white edge line, yellow tactile strip, lamps and benches. */
function Platform({ d, length, depth = 6 }: { d: number; length: number; depth?: number }) {
  const a = useMats();
  const z1 = d / 2 + PLATFORM_REACH;
  const z0 = z1 - depth;
  const zc = (z0 + z1) / 2;
  return (
    <group>
      <B mat={a.platform} w={length} d={depth} y1={PLATFORM_Y} z={zc} />
      <B mat={a.edge} w={length} d={0.35} y0={PLATFORM_Y} y1={PLATFORM_Y + 0.02} z={z1 - 0.2} shadow={false} />
      <B mat={a.tactile} w={length} d={0.4} y0={PLATFORM_Y} y1={PLATFORM_Y + 0.02} z={z1 - 0.9} shadow={false} />
      {Array.from({ length: Math.max(2, Math.round(length / 16)) }, (_, i) => {
        const n = Math.max(2, Math.round(length / 16));
        const x = -length / 2 + (length * (i + 0.5)) / n;
        return (
          <group key={i} position={[x, PLATFORM_Y, z0 + 1.2]}>
            <B mat={a.steel} w={0.12} d={0.12} y1={3.6} />
            <B mat={a.white} w={0.8} d={0.3} y0={3.6} y1={3.75} />
            <B mat={a.green} w={1.6} d={0.45} y0={0.42} y1={0.5} x={2.2} />
          </group>
        );
      })}
    </group>
  );
}

/** Canopy over the platform on a row of posts. */
function Canopy({ d, length, depth = 4.5, mat }: { d: number; length: number; depth?: number; mat: THREE.Material }) {
  const a = useMats();
  const z = d / 2 + PLATFORM_REACH - depth / 2 - 0.8;
  return (
    <group>
      {Array.from({ length: Math.max(2, Math.round(length / 10)) + 1 }, (_, i) => (
        <B key={i} mat={a.steel} w={0.25} d={0.25} y0={PLATFORM_Y} y1={PLATFORM_Y + 3.6} x={-length / 2 + (length * i) / Math.max(2, Math.round(length / 10))} z={z} />
      ))}
      <B mat={mat} w={length} d={depth} y0={PLATFORM_Y + 3.6} y1={PLATFORM_Y + 3.85} z={z} />
    </group>
  );
}

/** Haltepunkt / Bahnhof / Hauptbahnhof. */
export function TrainStation({ level = 1 }: { level?: number }) {
  const a = useMats();
  const [w, d] = sizeOf({ kind: "trainstation", level });
  const front = -d / 2;
  return (
    <group>
      {/* Forecourt (a footpath to the platform at the halt). */}
      {level === 1 ? (
        <B mat={a.platform} w={4} d={d - 4} y1={0.05} x={9} z={-2} shadow={false} />
      ) : (
        <B mat={a.platform} w={w - 4} d={d - 6} y1={0.05} z={-2} shadow={false} />
      )}
      {level === 1 && (
        <>
          <Platform d={d} length={40} />
          <Canopy d={d} length={14} mat={a.roof} />
          {/* Ticket machine and sign. */}
          <B mat={a.steel} w={0.8} d={0.6} y0={PLATFORM_Y} y1={PLATFORM_Y + 1.8} x={9} z={d / 2 - 2} />
          <B mat={a.steel} w={0.15} d={0.15} y1={4} x={-12} z={front + 3} />
          <mesh geometry={a.box} material={a.signStation} position={[-12, 3.2, front + 3]} scale={[5, 0.95, 0.15]} />
        </>
      )}
      {level === 2 && (
        <>
          <Platform d={d} length={60} />
          <Canopy d={d} length={40} mat={a.roof} />
          {/* Station house: brick, two storeys, gable roof, clock, sign. */}
          <group position={[0, 0, front + 7]}>
            <B mat={a.brick} w={24} d={10} y1={8} />
            {[2, 5.6].map((y) =>
              [-9, -5, 5, 9].map((x) => <B key={`${x}${y}`} mat={a.glass} w={1.8} d={10.1} y0={y - 0.9} y1={y + 0.9} x={x} />),
            )}
            <B mat={a.glass} w={4} d={10.1} y1={3.2} />
            <mesh position={[0, 8, 0]} rotation={[0, Math.PI / 4, 0]} scale={[1, 1, 1]} material={a.roofRed} castShadow>
              <coneGeometry args={[13.5, 4.5, 4, 1]} />
            </mesh>
            <mesh geometry={a.box} material={a.signStation} position={[0, 3.7, -5.12]} scale={[7, 1.2, 0.15]} />
            <mesh position={[0, 6.4, -5.13]} rotation={[0, Math.PI, 0]} material={a.clock}>
              <circleGeometry args={[0.9, 24]} />
            </mesh>
          </group>
        </>
      )}
      {level >= 3 && (
        <>
          <Platform d={d} length={64} depth={8} />
          {/* Hall: arched glass roof over the platform and the tracks. */}
          {Array.from({ length: 7 }, (_, i) => (
            <mesh key={i} position={[-30 + i * 10, PLATFORM_Y + 2, d / 2 + 2]} rotation={[0, Math.PI / 2, 0]} material={a.steel} castShadow>
              <torusGeometry args={[9.5, 0.25, 6, 24, Math.PI]} />
            </mesh>
          ))}
          <mesh position={[0, PLATFORM_Y + 2, d / 2 + 2]} rotation={[0, 0, Math.PI / 2]} material={a.canopyGlass}>
            {/* Axis turned to x; theta 0…π is the upper half then. */}
            <cylinderGeometry args={[9.5, 9.5, 62, 24, 1, true, 0, Math.PI]} />
          </mesh>
          {/* Reception building: sandstone, three storeys, clock tower. */}
          <group position={[0, 0, front + 6]}>
            <B mat={a.sandstone} w={44} d={10} y1={12} />
            {[2.2, 6, 9.6].map((y) =>
              Array.from({ length: 10 }, (_, i) => <B key={`${i}${y}`} mat={a.glass} w={2} d={10.1} y0={y - 1} y1={y + 1} x={-18 + i * 4} />),
            )}
            <B mat={a.roof} w={45} d={11} y0={12} y1={12.6} />
            <B mat={a.sandstone} w={7} d={7} y1={24} x={0} z={-0.5} />
            <B mat={a.roof} w={8} d={8} y0={24} y1={25} x={0} z={-0.5} />
            <mesh position={[0, 20, -4.06]} rotation={[0, Math.PI, 0]} material={a.clock}>
              <circleGeometry args={[2, 32]} />
            </mesh>
            <B mat={a.glass} w={8} d={10.2} y1={5} />
            <mesh geometry={a.box} material={a.signStation} position={[0, 6.2, -5.15]} scale={[12, 2, 0.2]} />
          </group>
        </>
      )}
    </group>
  );
}

/** Stellwerk / Betriebshof / Bahnbetriebswerk: signal box tower, engine shed(s) with tracks. */
export function TrainDepot({ level = 1 }: { level?: number }) {
  const a = useMats();
  const [, d] = sizeOf({ kind: "traindepot", level });
  const front = -d / 2;
  const sheds = level >= 3 ? 2 : 1;
  return (
    <group>
      <B mat={a.gravel} w={50} d={d - 2} y1={0.04} shadow={false} />
      {/* Signal box: brick base, glazed control room on top, sign. */}
      <group position={[-17, 0, front + 6]}>
        <B mat={a.brick} w={9} d={7} y1={4.5} />
        <B mat={a.glass} w={9.4} d={7.4} y0={4.5} y1={7.3} />
        <B mat={a.plaster} w={9.4} d={7.4} y0={7.3} y1={7.6} />
        <mesh position={[0, 7.6, 0]} rotation={[0, Math.PI / 4, 0]} material={a.roofRed} castShadow>
          <coneGeometry args={[6.6, 2.4, 4, 1]} />
        </mesh>
        <mesh geometry={a.box} material={a.signBox} position={[0, 3.2, -3.55]} scale={[6, 1, 0.15]} />
      </group>
      {/* Engine shed(s) along the track with a stub track each. */}
      {Array.from({ length: sheds }, (_, i) => (
        <group key={i} position={[8 - i * 0, 0, i === 0 ? 3 : -6]}>
          <B mat={level >= 2 ? a.brick : a.steel} w={32} d={8} y1={7} />
          <B mat={a.roof} w={33} d={8.6} y0={7} y1={7.5} />
          <B mat={a.dark} w={0.3} d={6} y1={5.5} x={16.05} />
          {[-1.6, 1.6].map((o) => (
            <B key={o} mat={a.rail} w={40} d={0.12} y0={0.04} y1={0.2} x={4} z={o * 0.45} shadow={false} />
          ))}
        </group>
      ))}
      {/* Light mast and buffer stop. */}
      <B mat={a.steel} w={0.3} d={0.3} y1={12} x={-24} z={d / 2 - 3} />
      <B mat={a.white} w={1.6} d={0.5} y0={12} y1={12.4} x={-24} z={d / 2 - 3} />
      {level >= 2 && <B mat={a.sleeper} w={2.5} d={1.2} y1={1.2} x={24.5} z={3} />}
    </group>
  );
}

/**
 * Prison: perimeter wall with guard towers at the corners, cell blocks (more per level),
 * administration at the gate, exercise yard. Same flat look as the railway buildings.
 */
export function Prison({ level = 1 }: { level?: number }) {
  const a = useMats();
  const [w, d] = sizeOf({ kind: "prison", level });
  const hw = w / 2 - 1;
  const hd = d / 2 - 1;
  const wallH = 6;
  const blocks = level >= 3 ? 3 : level === 2 ? 2 : 1;
  const floors = level >= 3 ? 4 : 3;
  return (
    <group>
      <B mat={a.gravel} w={w - 2} d={d - 2} y1={0.04} shadow={false} />
      {/* Wall with a gate at the front. */}
      <B mat={a.plaster} w={w - 2} d={0.6} y1={wallH} z={hd} />
      <B mat={a.plaster} w={0.6} d={d - 2} y1={wallH} x={-hw} />
      <B mat={a.plaster} w={0.6} d={d - 2} y1={wallH} x={hw} />
      <B mat={a.plaster} w={(w - 2) / 2 - 4} d={0.6} y1={wallH} x={-(w / 4 + 1)} z={-hd} />
      <B mat={a.plaster} w={(w - 2) / 2 - 4} d={0.6} y1={wallH} x={w / 4 + 1} z={-hd} />
      <B mat={a.steel} w={8} d={0.4} y1={5} z={-hd} />
      {/* Barbed wire on top of the wall. */}
      {[
        [0, hd, w - 2, 0.2],
        [-hw, 0, 0.2, d - 2],
        [hw, 0, 0.2, d - 2],
      ].map(([x, z, ww, dd], i) => (
        <B key={i} mat={a.dark} w={ww} d={dd} y0={wallH} y1={wallH + 0.6} x={x} z={z} shadow={false} />
      ))}
      {/* Guard towers. */}
      {[
        [-hw, -hd],
        [hw, -hd],
        [-hw, hd],
        [hw, hd],
      ].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <B mat={a.plaster} w={2.6} d={2.6} y1={10} />
          <B mat={a.glass} w={3.4} d={3.4} y0={10} y1={12} />
          <B mat={a.roof} w={4} d={4} y0={12} y1={12.5} />
        </group>
      ))}
      {/* Administration at the gate. */}
      <group position={[-12, 0, -hd + 6]}>
        <B mat={a.sandstone} w={14} d={8} y1={7} />
        {[2, 5].map((y) => [-4.5, -1.5, 1.5, 4.5].map((x) => <B key={`${x}${y}`} mat={a.glass} w={1.6} d={8.1} y0={y - 0.8} y1={y + 0.8} x={x} />))}
        <B mat={a.roof} w={14.6} d={8.6} y0={7} y1={7.5} />
      </group>
      {/* Cell blocks: long grey buildings with rows of small barred windows. */}
      {Array.from({ length: blocks }, (_, i) => (
        <group key={i} position={[-8 + i * 0, 0, 2 + i * 0]}>
          <group position={[i === 0 ? 8 : i === 1 ? -14 : 14, 0, i === 0 ? 4 : 10]} rotation={[0, i === 0 ? 0 : Math.PI / 2, 0]}>
            <B mat={a.platform} w={i === 0 ? 30 : 20} d={9} y1={floors * 3.2} />
            {Array.from({ length: floors }, (_, f) =>
              Array.from({ length: i === 0 ? 10 : 7 }, (_, k) => (
                <B key={`${f}-${k}`} mat={a.dark} w={0.9} d={9.1} y0={f * 3.2 + 1.3} y1={f * 3.2 + 2.3} x={-(i === 0 ? 13.5 : 9) + k * 3} />
              )),
            )}
            <B mat={a.roof} w={i === 0 ? 30.6 : 20.6} d={9.6} y0={floors * 3.2} y1={floors * 3.2 + 0.4} />
          </group>
        </group>
      ))}
      {/* Exercise yard with a fence. */}
      <B mat={a.green} w={14} d={10} y1={0.06} x={-14} z={hd - 8} shadow={false} />
    </group>
  );
}
