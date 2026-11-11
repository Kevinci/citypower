import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { accessRoad, roadNetworks, sizeOf, type Building } from "@/lib/city/economy";
import { closestOnPath } from "@/lib/city/adjacency";
import { FLAT, type Profile } from "@/lib/city/grade";
import { buildingGround } from "@/lib/city/placement";
import { buildFrames } from "@/lib/city/road-geometry";
import { useCity } from "@/lib/city/store";
import { sampleDepth, type DepthGrid } from "@/lib/city/terrain";
import { OUTER_HALF_WIDTH, type Road } from "@/lib/city/types";
import { useProfiles, useShapedGrid } from "./useProfiles";

/**
 * Road network overview: every connected network (water, goods and customers only travel
 * inside one) gets its own colour on its roads and on the buildings it serves. Buildings
 * without a road in reach are red, and a red ring marks road ends that stop just short of a
 * road of another network – the usual reason two parts of a town are not connected.
 */

/** Network colours, biggest network first (red is kept for problems). */
export const NETWORK_COLOURS = ["#1a8fc8", "#f39c12", "#8e44ad", "#16a085", "#e84393", "#d35400", "#2c3e50", "#7f8c1a"];
const UNSERVED = "#c0392b";
/** A road end this close to a road of another network is shown as a gap. */
export const GAP_DISTANCE = 15;
const LIFT = 0.35;

const bandMaterial = new THREE.MeshBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.55,
  depthWrite: true,
  depthFunc: THREE.LessDepth,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
  side: THREE.DoubleSide,
});
const footprintMaterial = new THREE.MeshBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const gapMaterial = new THREE.MeshBasicMaterial({ color: UNSERVED, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });

/** Networks of the roads, renumbered by size (0 = biggest), and the road count per network. */
export function rankedNetworks(roads: Road[]) {
  const nets = roadNetworks(roads);
  const count = new Map<number, number>();
  for (const n of nets.values()) count.set(n, (count.get(n) ?? 0) + 1);
  const order = [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)!);
  const rank = new Map(order.map((n, i) => [n, i]));
  const ranked = new Map<string, number>();
  for (const [id, n] of nets) ranked.set(id, rank.get(n)!);
  return { nets: ranked, sizes: order.map((n) => count.get(n)!) };
}

/** Road ends that stop within GAP_DISTANCE of a road of another network. */
export function networkGaps(roads: Road[], nets: Map<string, number>) {
  const gaps: { x: number; z: number }[] = [];
  for (const r of roads) {
    const net = nets.get(r.id);
    if (net === undefined) continue;
    for (const e of [r.points[0], r.points[r.points.length - 1]]) {
      const near = roads.some((o) => {
        const n = nets.get(o.id);
        return n !== undefined && n !== net && closestOnPath(e, o).distance < GAP_DISTANCE;
      });
      if (near) gaps.push({ x: e.x, z: e.z });
    }
  }
  return gaps;
}

const colourOf = (rank: number | undefined) => new THREE.Color(rank === undefined ? UNSERVED : NETWORK_COLOURS[rank % NETWORK_COLOURS.length]);

function bandGeometry(roads: Road[], nets: Map<string, number>, profiles: Map<string, Profile>) {
  const pos: number[] = [];
  const col: number[] = [];
  const index: number[] = [];
  for (const r of roads) {
    const rank = nets.get(r.id);
    if (rank === undefined) continue;
    const c = colourOf(rank);
    const half = OUTER_HALF_WIDTH[r.kind];
    const frames = buildFrames(r.points, r.kind, profiles.get(r.id) ?? FLAT);
    const base = pos.length / 3;
    for (const f of frames) {
      for (const k of [-1, 1]) {
        pos.push(f.p.x + f.n.x * half * k, f.p.y + LIFT, f.p.z + f.n.z * half * k);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < frames.length - 1; i++) {
      const a = base + i * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(index);
  return g;
}

function footprints(buildings: Building[], roads: Road[], nets: Map<string, number>, grid: DepthGrid) {
  const pos: number[] = [];
  const col: number[] = [];
  const index: number[] = [];
  for (const b of buildings) {
    if (b.kind === "house") continue;
    const road = accessRoad(b, roads);
    const c = colourOf(road ? nets.get(road.id) : undefined);
    const [w, d] = sizeOf(b);
    const p = new THREE.PlaneGeometry(w + 2, d + 2).rotateX(-Math.PI / 2).rotateY(b.rot);
    p.translate(b.x, buildingGround(b, grid) + LIFT + 0.1, b.z);
    const base = pos.length / 3;
    const arr = p.attributes.position.array as Float32Array;
    pos.push(...arr);
    for (let i = 0; i < arr.length / 3; i++) col.push(c.r, c.g, c.b);
    index.push(...Array.from(p.index!.array, (i) => i + base));
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(index);
  return g;
}

export function RoadNetworks() {
  const overlay = useCity((s) => s.showNetworks);
  const roads = useCity((s) => s.roads);
  const buildings = useCity((s) => s.buildings);
  const profiles = useProfiles();
  const grid = useShapedGrid();

  const view = useMemo(() => {
    if (!overlay) return null;
    const { nets } = rankedNetworks(roads);
    const gaps = networkGaps(roads, nets).map((g) => ({ ...g, y: Math.max(0, -sampleDepth(grid, g.x, g.z)) + 1 }));
    return { bands: bandGeometry(roads, nets, profiles), footprints: footprints(buildings, roads, nets, grid), gaps };
  }, [overlay, roads, buildings, profiles, grid]);

  useEffect(
    () => () => {
      view?.bands.dispose();
      view?.footprints.dispose();
    },
    [view],
  );

  if (!view) return null;
  return (
    <group>
      <mesh geometry={view.bands} material={bandMaterial} renderOrder={5} />
      <mesh geometry={view.footprints} material={footprintMaterial} renderOrder={6} />
      {view.gaps.map((g, i) => (
        <mesh key={i} position={[g.x, g.y, g.z]} rotation={[-Math.PI / 2, 0, 0]} material={gapMaterial} renderOrder={7}>
          <ringGeometry args={[6, 8, 32]} />
        </mesh>
      ))}
    </group>
  );
}
