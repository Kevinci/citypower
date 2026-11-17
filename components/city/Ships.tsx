"use client";

import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Building } from "@/lib/city/economy";
import { shipType, type Ship, type ShipType } from "@/lib/city/shipping";
import { harbourMouth } from "@/lib/city/placement";
import { routeToEdge } from "@/lib/city/waterways";
import { useCity } from "@/lib/city/store";
import { WATER_LEVEL, type DepthGrid } from "@/lib/city/terrain";
import type { Vec2 } from "@/lib/city/types";
import { useDepthGrid } from "./useWater";

/**
 * Ships of the harbours: moored one after the other in the channel in front of the quay
 * while docked or loading,
 * sailing the waterway to the map edge and back (`routeToEdge` in waterways.ts). Positions follow
 * the store's ship state and are smoothed per frame.
 */

const hullMat = new THREE.MeshStandardMaterial({ color: "#22313f", roughness: 0.6, metalness: 0.2 });
const bootMat = new THREE.MeshStandardMaterial({ color: "#8e2a22", roughness: 0.7 });
const deckMat = new THREE.MeshStandardMaterial({ color: "#4a4f55", roughness: 0.9 });
const houseMat = new THREE.MeshStandardMaterial({ color: "#f2f1ec", roughness: 0.6 });
const windowMat = new THREE.MeshStandardMaterial({ color: "#2d4656", roughness: 0.15, metalness: 0.5 });
const CARGO = ["#c9302c", "#2d6fb7", "#d9a21b", "#3c9a5f", "#7a4a33"].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

/** Hull outline with a pointed bow (+x), extruded upwards. */
function hullGeometry(length: number, beam: number, height: number) {
  const shape = new THREE.Shape();
  const bow = beam * 0.9;
  shape.moveTo(-length / 2, -beam / 2);
  shape.lineTo(length / 2 - bow, -beam / 2);
  shape.quadraticCurveTo(length / 2, -beam / 4, length / 2, 0);
  shape.quadraticCurveTo(length / 2, beam / 4, length / 2 - bow, beam / 2);
  shape.lineTo(-length / 2 + 1, beam / 2);
  shape.lineTo(-length / 2, beam / 2 - 1);
  shape.lineTo(-length / 2, -beam / 2);
  return new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }).rotateX(-Math.PI / 2);
}

const DRAFT = 1.5;
/** Share of the way out (and back) the ship is seen on the map; the rest is beyond the edge. */
const VISIBLE = 0.7;
const FREEBOARD = 1.4;

/** Memoised: the fleet list changes every tick, the model only with type and cargo. */
const ShipModel = memo(function ShipModel({ type, loaded }: { type: ShipType; loaded: boolean }) {
  const hull = useMemo(() => hullGeometry(type.length, type.beam, DRAFT + FREEBOARD), [type]);
  const boot = useMemo(() => hullGeometry(type.length + 0.1, type.beam + 0.1, DRAFT + 0.25), [type]);
  useEffect(
    () => () => {
      hull.dispose();
      boot.dispose();
    },
    [hull, boot],
  );
  const L = type.length;
  const B = type.beam;
  // Cargo hold from behind the bow to the deckhouse; containers in rows of 6.5 m.
  const holdFrom = -L / 2 + 8;
  const holdTo = L / 2 - B * 0.9 - 1;
  const rows = Math.max(1, Math.floor((holdTo - holdFrom) / 6.5));
  const across = B >= 8 ? 3 : 2;
  return (
    <group>
      <mesh geometry={boot} material={bootMat} position={[0, -DRAFT - 0.02, 0]} />
      <mesh geometry={hull} material={hullMat} position={[0, -DRAFT, 0]} castShadow />
      <mesh geometry={box} material={deckMat} position={[(holdFrom + holdTo) / 2, FREEBOARD - 0.3, 0]} scale={[holdTo - holdFrom, 0.5, B - 1]} />
      {loaded &&
        Array.from({ length: rows * across }, (_, i) => {
          const r = Math.floor(i / across);
          const c = i % across;
          return (
            <mesh
              key={i}
              geometry={box}
              material={CARGO[(r * 2 + c) % CARGO.length]}
              position={[holdFrom + 3.25 + r * 6.5, FREEBOARD + 0.2, (c - (across - 1) / 2) * 2.55]}
              scale={[6.1, 2.5, 2.4]}
              castShadow
            />
          );
        })}
      {/* Deckhouse and wheelhouse at the stern. */}
      <mesh geometry={box} material={houseMat} position={[-L / 2 + 4, FREEBOARD, 0]} scale={[5.5, 2.4, B - 1.2]} castShadow />
      <mesh geometry={box} material={houseMat} position={[-L / 2 + 4, FREEBOARD + 2.4, 0]} scale={[3.2, 2.2, B - 2]} castShadow />
      <mesh geometry={box} material={windowMat} position={[-L / 2 + 4, FREEBOARD + 3.2, 0]} scale={[3.3, 0.9, B - 1.9]} />
      <mesh geometry={box} material={hullMat} position={[-L / 2 + 3.2, FREEBOARD + 4.6, 0]} scale={[0.3, 2.2, 0.3]} />
    </group>
  );
});

interface Route {
  /** Deep-water route from in front of the harbour to the map edge, with arc lengths. */
  path: Vec2[];
  lengths: number[];
}

/** Ships moor one after the other in the channel, this far apart (metres along the route). */
const BERTH_SPACING = 75;

const routeCache = new WeakMap<DepthGrid, Map<string, Route>>();
function cachedRoute(h: Building, grid: DepthGrid): Route {
  let byPlace = routeCache.get(grid);
  if (!byPlace) routeCache.set(grid, (byPlace = new Map()));
  const key = `${h.x},${h.z},${h.rot},${h.level}`;
  let r = byPlace.get(key);
  if (!r) byPlace.set(key, (r = routeOf(h, grid)));
  return r;
}

function routeOf(h: Building, grid: DepthGrid): Route {
  const raw = routeToEdge(harbourMouth(h), grid);
  // The first point is the mouth on the bank; ships start at the first deep cell.
  const path = raw.length > 2 ? raw.slice(1) : raw;
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
  return { path, lengths };
}

/** Point and heading at arc length `s` along the route. */
function pointAt(route: Route, s: number) {
  const { path, lengths } = route;
  if (path.length < 2) return { x: path[0].x, z: path[0].z, heading: 0 };
  const total = lengths[lengths.length - 1];
  const t = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < path.length - 1 && lengths[i] < t) i++;
  const seg = Math.max(1e-6, lengths[i] - lengths[i - 1]);
  const f = Math.min(1, Math.max(0, (t - lengths[i - 1]) / seg));
  const a = path[i - 1];
  const e = path[i];
  return { x: a.x + (e.x - a.x) * f, z: a.z + (e.z - a.z) * f, heading: Math.atan2(e.x - a.x, e.z - a.z) };
}

/** Where a ship should be: position, heading (radians, direction (sin, cos)) and visibility. */
function shipTarget(ship: Ship, index: number, route: Route) {
  const type = shipType(ship.type);
  const total = route.lengths[route.lengths.length - 1] ?? 0;
  const berth = Math.min(index * BERTH_SPACING, total * 0.5);
  const half = type.trip / 2;
  if (ship.state === "out") {
    const p = ship.t / half;
    const at = pointAt(route, berth + (total - berth) * Math.min(1, p / VISIBLE));
    return { ...at, visible: p < VISIBLE };
  }
  if (ship.state === "back") {
    const p = ship.t / half;
    const at = pointAt(route, berth + (total - berth) * Math.max(0, 1 - (p - (1 - VISIBLE)) / VISIBLE));
    return { ...at, heading: at.heading + Math.PI, visible: p > 1 - VISIBLE };
  }
  // Moored bow upstream (against the current, towards the harbour).
  const at = pointAt(route, berth);
  return { ...at, heading: at.heading + Math.PI, visible: true };
}

interface Live {
  group: THREE.Group;
  x: number;
  z: number;
  heading: number;
  shown: boolean;
}

/** Moves every ship towards its target (per frame, outside the component for the React compiler). */
function moveShips(live: Map<string, Live>, targets: Map<string, ReturnType<typeof shipTarget>>, dt: number) {
  const k = 1 - Math.exp(-dt * 2.5);
  for (const [id, l] of live) {
    const t = targets.get(id);
    if (!t) continue;
    if (!l.shown || !t.visible) {
      // Appearing or disappearing: jump instead of gliding across the land.
      l.x = t.x;
      l.z = t.z;
      l.heading = t.heading;
    } else {
      l.x += (t.x - l.x) * k;
      l.z += (t.z - l.z) * k;
      let dh = t.heading - l.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      l.heading += dh * k;
    }
    l.shown = t.visible;
    l.group.visible = t.visible;
    l.group.position.set(l.x, WATER_LEVEL, l.z);
    // Model bow is +x: rotation y = heading − π/2.
    l.group.rotation.set(0, l.heading - Math.PI / 2, 0);
  }
}

export function Ships() {
  const ships = useCity((s) => s.ships);
  const buildings = useCity((s) => s.buildings);
  const grid = useDepthGrid();
  const harbours = useMemo(() => buildings.filter((b) => b.kind === "harbour"), [buildings]);
  // Routes only depend on the harbour's place and the water: cached, so a new house anywhere
  // does not run the path search to the map edge again (~25 ms per harbour).
  const routes = useMemo(() => new Map(harbours.map((h) => [h.id, cachedRoute(h, grid)])), [harbours, grid]);
  const targets = useMemo(() => {
    const out = new Map<string, ReturnType<typeof shipTarget>>();
    for (const h of harbours) {
      const route = routes.get(h.id)!;
      ships.filter((s) => s.harbour === h.id).forEach((s, i) => out.set(s.id, shipTarget(s, i, route)));
    }
    return out;
  }, [ships, harbours, routes]);
  const live = useRef(new Map<string, Live>());
  useFrame((_, dt) => moveShips(live.current, targets, Math.min(dt, 0.1)));

  return (
    <group>
      {ships.map((s) =>
        routes.has(s.harbour) ? (
          <group
            key={s.id}
            ref={(g) => {
              if (g) {
                const t = targets.get(s.id);
                if (!live.current.has(s.id)) live.current.set(s.id, { group: g, x: t?.x ?? 0, z: t?.z ?? 0, heading: t?.heading ?? 0, shown: false });
                else live.current.get(s.id)!.group = g;
              } else live.current.delete(s.id);
            }}
          >
            <ShipModel type={shipType(s.type)} loaded={s.state === "loading" || s.state === "out"} />
          </group>
        ) : null,
      )}
    </group>
  );
}
