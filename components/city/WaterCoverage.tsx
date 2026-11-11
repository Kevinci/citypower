import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { ACCESS_DISTANCE, accessRoad, roadNetworks, sizeOf, type Building } from "@/lib/city/economy";
import { FLAT, type Profile } from "@/lib/city/grade";
import { buildingGround } from "@/lib/city/placement";
import { buildFrames } from "@/lib/city/road-geometry";
import { useCity } from "@/lib/city/store";
import { sampleDepth, type DepthGrid } from "@/lib/city/terrain";
import { OUTER_HALF_WIDTH, type Road } from "@/lib/city/types";
import { useProfiles, useShapedGrid } from "./useProfiles";

/**
 * Service area of the selected waterworks, drawn green and transparent: water runs through
 * the pipes laid with every road, so the area is the waterworks' road network – streets
 * with the strip on both sides where buildings connect (ACCESS_DISTANCE), motorways and
 * ramps as bare pipe routes – plus the footprints of every building it supplies.
 */

const LIFT = 0.3;
/** Samples across a band: the road part follows the road, the rest the terrain. */
const ACROSS = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];

// Overlapping bands (junctions) must not add up: equal depth fails the depth test, so each
// pixel is tinted once.
const areaMaterial = new THREE.MeshBasicMaterial({
  color: "#2ecc71",
  transparent: true,
  opacity: 0.28,
  depthWrite: true,
  depthFunc: THREE.LessDepth,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
  side: THREE.DoubleSide,
});
const buildingMaterial = new THREE.MeshBasicMaterial({
  color: "#2ecc71",
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
  side: THREE.DoubleSide,
});

/** One merged band geometry for all roads of the network. */
function coverageGeometry(roads: Road[], profiles: Map<string, Profile>, grid: DepthGrid) {
  const pos: number[] = [];
  const index: number[] = [];
  for (const r of roads) {
    const road = OUTER_HALF_WIDTH[r.kind];
    const half = r.kind === "street" ? ACCESS_DISTANCE : road;
    const frames = buildFrames(r.points, r.kind, profiles.get(r.id) ?? FLAT);
    const cols = ACROSS.length;
    const base = pos.length / 3;
    for (const f of frames) {
      for (const k of ACROSS) {
        const off = k * half;
        const x = f.p.x + f.n.x * off;
        const z = f.p.z + f.n.z * off;
        const y = Math.abs(off) <= road ? f.p.y : Math.max(0, -sampleDepth(grid, x, z));
        pos.push(x, y + LIFT, z);
      }
    }
    for (let i = 0; i < frames.length - 1; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = base + i * cols + j;
        const b = a + cols;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}

/** Flat, slightly enlarged footprints of the supplied buildings. */
export function footprintGeometry(buildings: Building[], grid: DepthGrid) {
  const parts = buildings.map((b) => {
    const [w, d] = sizeOf(b);
    const g = new THREE.PlaneGeometry(w + 2, d + 2).rotateX(-Math.PI / 2).rotateY(b.rot);
    return g.translate(b.x, buildingGround(b, grid) + LIFT + 0.1, b.z);
  });
  const pos: number[] = [];
  const index: number[] = [];
  for (const p of parts) {
    const base = pos.length / 3;
    pos.push(...(p.attributes.position.array as Float32Array));
    index.push(...Array.from(p.index!.array, (i) => i + base));
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}

export function WaterCoverage() {
  const selected = useCity((s) => s.buildings.find((b) => b.id === s.selected));
  const overlay = useCity((s) => s.showWater);
  const roads = useCity((s) => s.roads);
  const buildings = useCity((s) => s.buildings);
  const profiles = useProfiles();
  const grid = useShapedGrid();
  const selectedWorks = selected?.kind === "waterworks" ? selected : null;

  // The selected waterworks' network, or with the water overlay on every network with a waterworks.
  const coverage = useMemo(() => {
    const works = selectedWorks ? [selectedWorks] : overlay ? buildings.filter((b) => b.kind === "waterworks") : [];
    if (works.length === 0) return null;
    const nets = roadNetworks(roads);
    const served = new Set<number>();
    for (const w of works) {
      const own = accessRoad(w, roads);
      const net = own ? nets.get(own.id) : undefined;
      if (net !== undefined) served.add(net);
    }
    if (served.size === 0) return null;
    const area = coverageGeometry(roads.filter((r) => served.has(nets.get(r.id)!)), profiles, grid);
    const supplied = buildings.filter((b) => {
      const r = accessRoad(b, roads);
      return r !== null && served.has(nets.get(r.id)!);
    });
    return { area, footprints: footprintGeometry(supplied, grid) };
  }, [selectedWorks, overlay, roads, buildings, profiles, grid]);

  useEffect(
    () => () => {
      coverage?.area.dispose();
      coverage?.footprints.dispose();
    },
    [coverage],
  );

  if (!coverage) return null;
  return (
    <group>
      <mesh geometry={coverage.area} material={areaMaterial} renderOrder={5} />
      <mesh geometry={coverage.footprints} material={buildingMaterial} renderOrder={6} />
    </group>
  );
}
