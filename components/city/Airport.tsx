import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { sizeOf, type Building } from "@/lib/city/economy";
import { useCity } from "@/lib/city/store";
import type { DepthGrid } from "@/lib/city/terrain";
import { photoMaterial, withPhoto } from "./photoMaterial";

/**
 * Airport in three levels: Flugplatz (grass strip, hangar, small planes), Regionalflughafen
 * (asphalt runway, terminal, tower, cargo hall, jets) and Flughafen (long runway, big terminal
 * with jet bridges, hotel, cargo centre, wide-bodies).
 *
 * Local layout: x runs along the road (and the runway), the road is at −z (front). The terrain
 * under the plot is levelled (hills cut, hollows filled, 1 : 1.5 slopes around, see
 * `levelPads`), so the airfield lies on the natural grass. Planes fly a fixed real-time schedule (stopped while paused
 * or while the airport is shut down): push back, taxi, take off towards +x, climb out of
 * sight, come back on the approach from −x, land, taxi to their stand.
 */

/* ---------- materials and shared geometry ---------- */

let assets: ReturnType<typeof createAssets> | null = null;
function createAssets() {
  const m = (color: string, roughness = 0.6, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    mown: withPhoto(new THREE.MeshStandardMaterial({ color: "#56802f", roughness: 1 }), { texture: "aerial_grass_rock", tile: 6, mode: "grain", strength: 0.5 }),
    asphalt: photoMaterial({ texture: "asphalt_02", tile: 6, color: "#8c8c8c", roughness: 0.95 }),
    apron: withPhoto(new THREE.MeshStandardMaterial({ color: "#a9abad", roughness: 0.9 }), { texture: "concrete_wall_008", tile: 6, mode: "grain", strength: 0.5 }),
    white: m("#f2f2ee", 0.7),
    yellow: m("#e8b923", 0.6),
    concrete: photoMaterial({ texture: "concrete_wall_008", tile: 3, color: "#f0ede6", roughness: 0.85 }),
    glass: m("#5f88a3", 0.08, 0.6),
    darkGlass: m("#2d4656", 0.12, 0.5),
    hall: photoMaterial({ texture: "corrugated_iron_02", tile: 2, mode: "grain", strength: 0.8, color: "#9aa4ab", roughness: 0.6, metalness: 0.3 }),
    cladBlue: photoMaterial({ texture: "corrugated_iron_02", tile: 2, mode: "grain", strength: 0.7, color: "#3d6f9e", roughness: 0.55, metalness: 0.3 }),
    steel: m("#8f989e", 0.45, 0.6),
    red: m("#c9302c", 0.5),
    orange: m("#e8742a", 0.7),
    // Planes.
    hull: m("#f4f5f7", 0.35, 0.25),
    hullGrey: m("#cfd3d6", 0.4, 0.3),
    tailBlue: m("#1a5f9e", 0.4, 0.2),
    tailOrange: m("#e07a1f", 0.45, 0.2),
    windows: m("#22303a", 0.2, 0.4),
    engine: m("#9aa1a6", 0.35, 0.6),
    prop: m("#2a2a2a", 0.6),
  };
}
function useAssets() {
  assets ??= createAssets();
  return assets;
}

function Box({ m, x = 0, z = 0, w, d, y0 = 0, y1 }: { m: THREE.Material; x?: number; z?: number; w: number; d: number; y0?: number; y1: number }) {
  const a = useAssets();
  return <mesh geometry={a.box} material={m} position={[x, y0, z]} scale={[w, y1 - y0, d]} castShadow receiveShadow />;
}

/** Flat boxes (markings) merged into one geometry: [x, z, w, d] in local metres. */
function flatBoxes(rects: [number, number, number, number][], y0: number, y1: number) {
  if (rects.length === 0) return null;
  const parts = rects.map(([x, z, w, d]) => new THREE.BoxGeometry(w, y1 - y0, d).translate(x, (y0 + y1) / 2, z));
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

/* ---------- layout per level ---------- */

export interface AirportLayout {
  w: number;
  d: number;
  /** Runway: centre line z, width, start and end x (take-off towards +x). */
  runwayZ: number;
  runwayW: number;
  x0: number;
  x1: number;
  grass: boolean;
  /** Parallel taxiway z (grass track at level 1). */
  taxiZ: number;
  taxiW: number;
  /** Apron band z range. */
  apron: [number, number];
  apronX: [number, number];
}

export function airportLayout(level: number): AirportLayout {
  const [w, d] = sizeOf({ kind: "airport", level });
  const front = -d / 2;
  // Same plot at every level (380 × 130 m): buildings at the road, apron, taxiway, runway at the back.
  if (level <= 1)
    return { w, d, runwayZ: d / 2 - 25, runwayW: 20, x0: -w / 2 + 60, x1: w / 2 - 20, grass: true, taxiZ: front + 77, taxiW: 0, apron: [front + 25, front + 51], apronX: [-w / 2 + 10, -w / 2 + 120] };
  if (level === 2)
    return { w, d, runwayZ: d / 2 - 23, runwayW: 30, x0: -w / 2 + 10, x1: w / 2 - 10, grass: false, taxiZ: front + 77, taxiW: 12, apron: [front + 27, front + 69], apronX: [-w / 2 + 10, w / 2 - 10] };
  return { w, d, runwayZ: d / 2 - 21, runwayW: 36, x0: -w / 2 + 10, x1: w / 2 - 10, grass: false, taxiZ: front + 77, taxiW: 14, apron: [front + 27, front + 69], apronX: [-w / 2 + 10, w / 2 - 10] };
}

/* ---------- planes ---------- */

export type PlaneType = "prop" | "jet" | "wide" | "cargo";

const PLANE: Record<PlaneType, { length: number; span: number; radius: number; gear: number; tail: "tailBlue" | "tailOrange"; low: boolean; engines: number }> = {
  prop: { length: 8.5, span: 11, radius: 0.65, gear: 0.9, tail: "tailBlue", low: false, engines: 0 },
  jet: { length: 30, span: 28, radius: 1.9, gear: 1.6, tail: "tailBlue", low: true, engines: 2 },
  wide: { length: 42, span: 40, radius: 2.9, gear: 2.2, tail: "tailBlue", low: true, engines: 2 },
  cargo: { length: 36, span: 34, radius: 2.4, gear: 1.9, tail: "tailOrange", low: true, engines: 4 },
};

/** One plane along +x (nose), wheels at y = 0. Made of a few primitive meshes. */
export function PlaneModel({ type }: { type: PlaneType }) {
  const a = useAssets();
  const p = PLANE[type];
  const r = p.radius;
  const body = p.length * 0.72;
  const y = p.gear + r;
  const wingY = p.low ? y - r * 0.55 : y + r * 0.8;
  const wingX = p.low ? -p.length * 0.04 : p.length * 0.05;
  const chord = Math.max(1.4, p.length * 0.16);
  const sweep = p.low ? 0.45 : 0;
  const hull = type === "cargo" ? a.hullGrey : a.hull;
  return (
    <group>
      {/* Fuselage, nose and tail cone. */}
      <mesh position={[0, y, 0]} rotation={[0, 0, Math.PI / 2]} material={hull} castShadow>
        <cylinderGeometry args={[r, r, body, 16]} />
      </mesh>
      <mesh position={[body / 2, y, 0]} scale={[p.length * 0.12, r, r]} material={hull} castShadow>
        <sphereGeometry args={[1, 16, 10, 0, Math.PI * 2, 0, Math.PI]} />
      </mesh>
      <mesh position={[-body / 2 - p.length * 0.08, y + r * 0.35, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.9]} material={hull} castShadow>
        <cylinderGeometry args={[r * 0.35, r, p.length * 0.16, 16]} />
      </mesh>
      {/* Window band and cockpit (no windows on freighters except the cockpit). */}
      {type !== "cargo" &&
        [-1, 1].map((s) => (
          <mesh key={s} geometry={a.box} material={a.windows} position={[0, y + r * 0.2, s * r * 0.97]} scale={[body * 0.85, r * 0.18, 0.08]} />
        ))}
      <mesh geometry={a.box} material={a.windows} position={[body / 2 + p.length * 0.05, y + r * 0.35, 0]} scale={[p.length * 0.05, r * 0.3, r * 1.3]} rotation={[0, 0, -0.5]} />
      {/* Wings (swept for jets) and tailplane. */}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          geometry={a.box}
          material={hull}
          position={[wingX - (p.span / 4) * Math.sin(sweep), wingY, (s * p.span) / 4]}
          rotation={[0, -s * sweep, 0]}
          scale={[chord, 0.25 + r * 0.06, p.span / 2]}
          castShadow
        />
      ))}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          geometry={a.box}
          material={hull}
          position={[-body / 2 - p.length * 0.1 - (p.span / 9) * Math.sin(sweep), y + r * 0.5, (s * p.span) / 9]}
          rotation={[0, -s * sweep, 0]}
          scale={[chord * 0.55, 0.18, p.span / 4.5]}
          castShadow
        />
      ))}
      {/* Fin in the livery colour. */}
      <mesh
        geometry={a.box}
        material={a[p.tail]}
        position={[-body / 2 - p.length * 0.08, y + r * 0.6, 0]}
        rotation={[0, 0, sweep * 0.9]}
        scale={[chord * 0.75, p.length * 0.2, 0.25 + r * 0.05]}
        castShadow
      />
      {/* Engines under the wings, or a propeller at the nose. */}
      {p.engines > 0 &&
        Array.from({ length: p.engines }, (_, i) => {
          const side = i % 2 ? 1 : -1;
          const k = p.engines === 4 ? (i < 2 ? 0.2 : 0.38) : 0.28;
          const z = side * p.span * k;
          const x = wingX + chord * 0.55 - Math.abs(z) * Math.tan(sweep) * 0.9;
          return (
            <mesh key={i} position={[x, wingY - r * 0.45, z]} rotation={[0, 0, Math.PI / 2]} material={a.engine} castShadow>
              <cylinderGeometry args={[r * 0.42, r * 0.36, chord * 0.9, 12]} />
            </mesh>
          );
        })}
      {type === "prop" && <mesh geometry={a.box} material={a.prop} position={[body / 2 + p.length * 0.12, y, 0]} scale={[0.08, 2.2, 0.18]} />}
      {/* Landing gear. */}
      {[
        [body * 0.38, 0],
        [wingX - chord * 0.2, r * 0.8],
        [wingX - chord * 0.2, -r * 0.8],
      ].map(([x, z], i) => (
        <mesh key={i} geometry={a.box} material={a.prop} position={[x, 0, z]} scale={[0.5 + r * 0.15, p.gear + 0.2, 0.3 + r * 0.1]} />
      ))}
    </group>
  );
}

/** Seconds of each part of a flight cycle (real time, so it looks the same at every speed). */
const T = { push: 5, taxiOut: 18, roll: 8, climb: 24, away: 60, approach: 26, rollout: 8, taxiIn: 18 };
const CYCLE = 240;
const ACTIVE = T.push + T.taxiOut + T.roll + T.climb + T.away + T.approach + T.rollout + T.taxiIn;
const CLIMB_DISTANCE = 2300;
const CLIMB_HEIGHT = 280;
const APPROACH_DISTANCE = 2400;
const APPROACH_HEIGHT = 150;

interface Flight {
  type: PlaneType;
  /** Stand on the apron (nose towards the terminal, −z). */
  sx: number;
  sz: number;
  /** Start of its cycle (s). */
  offset: number;
}

/** Point at arc length s along a polyline. */
function along(pts: [number, number][], s: number): [number, number] {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const l = Math.hypot(bx - ax, bz - az);
    if (s <= l || i === pts.length - 2) {
      const t = l > 0 ? Math.min(1, s / l) : 1;
      return [ax + (bx - ax) * t, az + (bz - az) * t];
    }
    s -= l;
  }
  return pts[pts.length - 1];
}
const lengthOf = (pts: [number, number][]) => pts.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

/** Moves along a ground path at constant speed, nose along the path (or reversing). */
function groundMove(o: THREE.Object3D, pts: [number, number][], u: number, reverse = false) {
  const len = lengthOf(pts);
  const [x, z] = along(pts, u * len);
  const [ax, az] = along(pts, Math.min(len, u * len + 10));
  const [bx, bz] = along(pts, Math.max(0, u * len - 10));
  const dx = reverse ? bx - ax : ax - bx;
  const dz = reverse ? bz - az : az - bz;
  o.position.set(x, 0, z);
  if (Math.hypot(dx, dz) > 0.01) o.rotation.set(0, Math.atan2(-dz, dx), 0);
}

/** Places a plane for the time `t` (s) of its schedule. */
function fly(o: THREE.Object3D, f: Flight, L: AirportLayout, t: number, length: number) {
  let k = (((t - f.offset) % CYCLE) + CYCLE) % CYCLE;
  o.visible = true;
  o.rotation.order = "YZX";
  const back: [number, number] = [f.sx, f.sz + 14 + length * 0.3];
  const lineUp = L.x0 + 10;
  if (k < CYCLE - ACTIVE) {
    // Parked at the stand.
    o.position.set(f.sx, 0, f.sz);
    o.rotation.set(0, Math.PI / 2, 0);
    return;
  }
  k -= CYCLE - ACTIVE;
  if (k < T.push) return groundMove(o, [[f.sx, f.sz], back], k / T.push, true);
  k -= T.push;
  if (k < T.taxiOut)
    return groundMove(o, [back, [back[0], L.taxiZ], [lineUp, L.taxiZ], [lineUp, L.runwayZ], [lineUp + 1, L.runwayZ]], k / T.taxiOut);
  k -= T.taxiOut;
  const runway = L.x1 - L.x0;
  const liftOff = lineUp + runway * 0.62;
  if (k < T.roll) {
    const u = k / T.roll;
    o.position.set(lineUp + (liftOff - lineUp) * u * u, 0, L.runwayZ);
    o.rotation.set(0, 0, u > 0.85 ? (u - 0.85) * 0.8 : 0);
    return;
  }
  k -= T.roll;
  if (k < T.climb) {
    const u = k / T.climb;
    const x = liftOff + CLIMB_DISTANCE * u * (0.7 + 0.3 * u);
    const y = CLIMB_HEIGHT * Math.pow(u, 1.25);
    const slope = (CLIMB_HEIGHT * 1.25 * Math.pow(Math.max(u, 0.02), 0.25)) / (CLIMB_DISTANCE * (0.7 + 0.6 * u));
    o.position.set(x, y, L.runwayZ);
    o.rotation.set(0, 0, Math.min(0.2, Math.atan(slope) + 0.04));
    return;
  }
  k -= T.climb;
  if (k < T.away) {
    o.visible = false;
    return;
  }
  k -= T.away;
  const touch = L.x0 + 30;
  if (k < T.approach) {
    const u = k / T.approach;
    const x = touch - APPROACH_DISTANCE * (1 - u);
    o.position.set(x, APPROACH_HEIGHT * Math.pow(1 - u, 1.15), L.runwayZ);
    // Slightly nose-up on the glide path, flare at the end.
    o.rotation.set(0, 0, u > 0.9 ? 0.06 : 0.02);
    return;
  }
  k -= T.approach;
  const exit = touch + runway * 0.5;
  if (k < T.rollout) {
    const u = k / T.rollout;
    o.position.set(touch + (exit - touch) * (1 - (1 - u) * (1 - u)), 0, L.runwayZ);
    o.rotation.set(0, 0, 0);
    return;
  }
  k -= T.rollout;
  groundMove(o, [[exit, L.runwayZ], [exit + 1, L.runwayZ], [exit, L.taxiZ], [f.sx, L.taxiZ], [f.sx, f.sz]], Math.min(1, k / T.taxiIn));
}

/** All planes of one airport. */
function Planes({ flights, layout, active }: { flights: Flight[]; layout: AirportLayout; active: boolean }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const clock = useRef(0);
  useFrame((_, dt) => {
    const running = active && useCity.getState().speed > 0;
    if (running) clock.current += Math.min(dt, 0.1);
    flights.forEach((f, i) => {
      const o = refs.current[i];
      // Shut down: everyone at the stand; paused: frozen where they are.
      if (o) fly(o, f, layout, active ? clock.current : f.offset, PLANE[f.type].length);
    });
  });
  return (
    <>
      {flights.map((f, i) => (
        <group
          key={i}
          ref={(o) => {
            refs.current[i] = o;
          }}
          position={[f.sx, 0, f.sz]}
          rotation={[0, Math.PI / 2, 0]}
        >
          <PlaneModel type={f.type} />
        </group>
      ))}
    </>
  );
}

/** Which planes an airport level has and where they park. */
function flightsOf(level: number, L: AirportLayout): Flight[] {
  const stand = (L.apron[0] + L.apron[1]) / 2;
  const list: { type: PlaneType; x: number }[] =
    level <= 1
      ? [
          { type: "prop", x: -160 },
          { type: "prop", x: -135 },
        ]
      : level === 2
        ? [
            { type: "jet", x: -110 },
            { type: "jet", x: -60 },
            { type: "cargo", x: 110 },
          ]
        : [
            { type: "wide", x: -125 },
            { type: "jet", x: -80 },
            { type: "wide", x: -35 },
            { type: "jet", x: 10 },
            { type: "cargo", x: 100 },
            { type: "cargo", x: 150 },
          ];
  return list.map((p, i) => ({ type: p.type, sx: p.x, sz: stand, offset: (i * CYCLE) / list.length + 30 }));
}

/* ---------- ground: platform, runway, buildings ---------- */

function useMarkings(L: AirportLayout) {
  return useMemo(() => {
    const white: [number, number, number, number][] = [];
    const yellow: [number, number, number, number][] = [];
    const len = L.x1 - L.x0;
    if (L.grass) {
      // Grass strip: white edge markers every 30 m.
      for (let x = L.x0; x <= L.x1; x += 30) for (const s of [-1, 1]) white.push([x, L.runwayZ + (s * L.runwayW) / 2, 3, 1]);
    } else {
      // Threshold stripes, centre line dashes, edge lines, touchdown zone, taxiway centre line.
      const stripes = L.runwayW >= 40 ? 12 : 8;
      for (const end of [L.x0 + 8, L.x1 - 8])
        for (let i = 0; i < stripes; i++) white.push([end, L.runwayZ - L.runwayW / 2 + 3 + ((L.runwayW - 6) * (i + 0.5)) / stripes, 22, 1.4]);
      for (let x = L.x0 + 40; x < L.x1 - 40; x += 40) white.push([x + 12, L.runwayZ, 24, 0.9]);
      for (const s of [-1, 1]) white.push([(L.x0 + L.x1) / 2, L.runwayZ + s * (L.runwayW / 2 - 1), len, 0.6]);
      for (const end of [L.x0 + 70, L.x1 - 70]) for (const s of [-1, 1]) white.push([end, L.runwayZ + s * L.runwayW * 0.25, 30, 3]);
      yellow.push([(L.x0 + L.x1) / 2, L.taxiZ, L.x1 - L.x0 - 20, 0.5]);
    }
    return { white: flatBoxes(white, 0.06, 0.1), yellow: flatBoxes(yellow, 0.06, 0.1) };
  }, [L]);
}

function Ground({ L }: { L: AirportLayout }) {
  const a = useAssets();
  const marks = useMarkings(L);
  useEffect(
    () => () => {
      marks.white?.dispose();
      marks.yellow?.dispose();
    },
    [marks],
  );
  const len = L.x1 - L.x0;
  const mid = (L.x0 + L.x1) / 2;
  return (
    <>
      {/* Runway (grass strip or asphalt), taxiway with links to the apron, apron. */}
      <Box m={L.grass ? a.mown : a.asphalt} w={len} d={L.runwayW} y1={0.05} x={mid} z={L.runwayZ} />
      {!L.grass && (
        <>
          <Box m={a.asphalt} w={len - 20} d={L.taxiW} y1={0.05} x={mid} z={L.taxiZ} />
          {[L.x0 + 10, mid, L.x1 - 10].map((x) => (
            <Box key={x} m={a.asphalt} w={L.taxiW} d={Math.abs(L.runwayZ - L.taxiZ)} y1={0.045} x={x} z={(L.runwayZ + L.taxiZ) / 2} />
          ))}
          {[L.apronX[0] + 20, L.apronX[1] - 20].map((x) => (
            <Box key={x} m={a.asphalt} w={L.taxiW} d={Math.abs(L.taxiZ - L.apron[1])} y1={0.045} x={x} z={(L.taxiZ + L.apron[1]) / 2} />
          ))}
        </>
      )}
      <Box m={a.apron} w={L.apronX[1] - L.apronX[0]} d={L.apron[1] - L.apron[0]} y1={0.06} x={(L.apronX[0] + L.apronX[1]) / 2} z={(L.apron[0] + L.apron[1]) / 2} />
      {marks.white && <mesh geometry={marks.white} material={a.white} receiveShadow />}
      {marks.yellow && <mesh geometry={marks.yellow} material={a.yellow} receiveShadow />}
      {/* Windsock at the runway. */}
      <group position={[L.x0 + 40, 0, L.runwayZ - L.runwayW / 2 - 10]}>
        <Box m={a.steel} w={0.2} d={0.2} y1={6} />
        <mesh position={[1.6, 5.8, 0]} rotation={[0, 0, Math.PI / 2 + 0.25]} material={a.orange} castShadow>
          <coneGeometry args={[0.5, 3, 10, 1, true]} />
        </mesh>
      </group>
    </>
  );
}

/** Control tower: shaft, glass cab, roof. */
function Tower({ x, z, h, r }: { x: number; z: number; h: number; r: number }) {
  const a = useAssets();
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, h / 2, 0]} material={a.concrete} castShadow receiveShadow>
        <cylinderGeometry args={[r * 0.55, r * 0.65, h, 16]} />
      </mesh>
      <mesh position={[0, h + 1.8, 0]} material={a.darkGlass} castShadow>
        <cylinderGeometry args={[r * 1.15, r * 0.95, 3.6, 12]} />
      </mesh>
      <mesh position={[0, h + 3.9, 0]} material={a.concrete} castShadow>
        <cylinderGeometry args={[r * 1.25, r * 1.25, 0.6, 12]} />
      </mesh>
      <Box m={a.steel} w={0.2} d={0.2} y0={h + 4.2} y1={h + 8} />
    </group>
  );
}

/** Terminal: concrete block with a glass front, flat roof. */
function Terminal({ x, z, w, d, h }: { x: number; z: number; w: number; d: number; h: number }) {
  const a = useAssets();
  return (
    <group position={[x, 0, z]}>
      <Box m={a.concrete} w={w} d={d} y1={h} />
      <Box m={a.glass} w={w - 4} d={0.3} y0={1} y1={h - 1.5} z={-d / 2 - 0.05} />
      <Box m={a.glass} w={w - 4} d={0.3} y0={1} y1={h - 1.5} z={d / 2 + 0.05} />
      <Box m={a.steel} w={w + 1} d={d + 1} y0={h} y1={h + 0.6} />
      {/* Canopy over the kerb. */}
      <Box m={a.steel} w={w * 0.7} d={5} y0={4.2} y1={4.6} z={-d / 2 - 2.5} />
    </group>
  );
}

function Hangar({ x, z, w, d, h, m }: { x: number; z: number; w: number; d: number; h: number; m?: THREE.Material }) {
  const a = useAssets();
  return (
    <group position={[x, 0, z]}>
      <Box m={m ?? a.hall} w={w} d={d} y1={h} />
      <mesh position={[0, h, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 1]} material={m ?? a.hall} castShadow>
        <cylinderGeometry args={[d / 2, d / 2, w, 20, 1, false, 0, Math.PI]} />
      </mesh>
      {/* Doors towards the apron (+z). */}
      <Box m={a.steel} w={w * 0.8} d={0.3} y1={h * 0.85} z={d / 2 + 0.1} />
    </group>
  );
}

function Parking({ x, z, w, d }: { x: number; z: number; w: number; d: number }) {
  const a = useAssets();
  const lines = Math.floor(w / 3);
  return (
    <group position={[x, 0, z]}>
      <Box m={a.asphalt} w={w} d={d} y1={0.05} />
      {Array.from({ length: lines }, (_, i) => (
        <Box key={i} m={a.white} w={0.15} d={d * 0.4} y1={0.08} x={-w / 2 + 1.5 + i * 3} z={-d * 0.25} />
      ))}
    </group>
  );
}

function Buildings({ level, L }: { level: number; L: AirportLayout }) {
  const a = useAssets();
  const front = -L.d / 2;
  if (level <= 1)
    return (
      <>
        <Hangar x={-160} z={front + 12} w={26} d={16} h={5} />
        {/* Clubhouse with a small tower cab. */}
        <Box m={a.concrete} w={14} d={9} y1={4} x={-130} z={front + 9} />
        <Box m={a.glass} w={12} d={0.2} y0={1} y1={3.2} x={-130} z={front + 13.6} />
        <Box m={a.darkGlass} w={4} d={4} y0={4} y1={6.5} x={-126} z={front + 9} />
        <Box m={a.concrete} w={4.6} d={4.6} y0={6.5} y1={7} x={-126} z={front + 9} />
        <Parking x={-100} z={front + 8} w={24} d={12} />
        {/* Fuel tank. */}
        <mesh position={[-80, 1.6, front + 16]} rotation={[0, 0, Math.PI / 2]} material={a.red} castShadow>
          <cylinderGeometry args={[1.5, 1.5, 6, 14]} />
        </mesh>
      </>
    );
  if (level === 2)
    return (
      <>
        <Terminal x={-85} z={front + 13} w={90} d={22} h={11} />
        <Tower x={0} z={front + 14} h={22} r={3} />
        <Hangar x={110} z={front + 13} w={60} d={22} h={8} m={a.cladBlue} />
        <Parking x={-160} z={front + 12} w={40} d={20} />
        <Parking x={45} z={front + 9} w={40} d={14} />
      </>
    );
  return (
    <>
      <Terminal x={-80} z={front + 13} w={130} d={22} h={15} />
      {/* Jet bridges from the terminal to the passenger stands. */}
      {[-125, -80, -35, 10].map((x) => (
        <Box key={x} m={a.steel} w={3} d={6} y0={3.5} y1={6.5} x={x} z={front + 26} />
      ))}
      <Tower x={30} z={front + 14} h={38} r={4} />
      {/* Hotel at the road. */}
      <Box m={a.glass} w={22} d={16} y1={42} x={70} z={front + 12} />
      <Box m={a.concrete} w={22.6} d={16.6} y0={42} y1={43} x={70} z={front + 12} />
      {Array.from({ length: 11 }, (_, i) => (
        <Box key={i} m={a.concrete} w={22.3} d={16.3} y0={3.5 + i * 3.5} y1={4.1 + i * 3.5} x={70} z={front + 12} />
      ))}
      {/* Cargo centre. */}
      <Hangar x={145} z={front + 13} w={70} d={22} h={11} m={a.cladBlue} />
      {/* Parking garage. */}
      <Box m={a.concrete} w={34} d={22} y1={12} x={-167} z={front + 13} />
      {[3, 6, 9].map((y) => (
        <Box key={y} m={a.darkGlass} w={34.4} d={22.4} y0={y - 1.2} y1={y - 0.2} x={-167} z={front + 13} />
      ))}
    </>
  );
}

/** Airport of a building record (all levels), with its planes. */
export function Airport({ b, y, preview = false }: { b: Building; grid?: DepthGrid; y: number; preview?: boolean }) {
  const L = useMemo(() => airportLayout(b.level), [b.level]);
  const active = useCity((s) => preview || (s.economy?.status[b.id]?.connected ?? false));
  const flights = useMemo(() => flightsOf(b.level, L), [b.level, L]);
  return (
    // The terrain under the plot is levelled to y (`levelPads` via useShapedGrid); a little
    // above it so the flat runway boxes do not flicker with the ground.
    <group position={[b.x, y + AIRPORT_LIFT, b.z]} rotation={[0, b.rot, 0]}>
      <group userData={GROUNDED}>
        <Ground L={L} />
        <Buildings level={b.level} L={L} />
      </group>
      {/* Outside the grounded group: moving planes get no contact shadow. */}
      <Planes flights={flights} layout={L} active={active && !preview} />
    </group>
  );
}

const GROUNDED = { base: true };
const AIRPORT_LIFT = 0.12;
