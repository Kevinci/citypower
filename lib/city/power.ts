import { BUILDINGS, insideFootprint, type Building } from "./economy";
import type { Cable, Vec2 } from "./types";

/**
 * Electricity: a power station feeds overhead lines (cables) that the player draws to
 * transformer stations; every transformer supplies the buildings within its radius.
 *
 *   Kraftwerk ── Kabel ──► Trafostation ──► Gebäude im Umkreis
 *
 * Stations: level 1 hydro (needs a canal at the plant), level 2 coal (coal mine), level 3
 * nuclear (uranium mine), levels 4–5 a second and third reactor unit. Fuel arrives over the road network like every other good.
 */

export const POWER_LEVEL_NAME = ["", "Wasserkraftwerk", "Kohlekraftwerk", "Kernkraftwerk", "Kernkraftwerk (2 Blöcke)", "Kernkraftwerk (3 Blöcke)"];
/** Power per level (kW, at full staffing and fuel). Levels 4 and 5 add reactor units. */
export const POWER_CAPACITY = [0, 500, 1400, 4500, 8500, 12500];
export const POWER_UPKEEP = [0, 25, 50, 120, 210, 300];
export const POWER_JOBS = [0, 8, 24, 40, 60, 80];
/** Fuel per minute at full load (uranium for one reactor unit). */
export const COAL_PER_MINUTE = 14;
export const URANIUM_PER_MINUTE = 2;
/** Reactor units of a nuclear plant (0 below level 3). */
export const reactorsOf = (level: number) => Math.max(0, level - 2);
/** Fuel per minute at full load for a plant level. */
export const fuelPerMinute = (level: number) => (level === 2 ? COAL_PER_MINUTE : URANIUM_PER_MINUTE * reactorsOf(level));
/** A hydro plant needs a canal running this close to its footprint (m). */
export const HYDRO_CANAL_DISTANCE = 24;
/** A power station must have water (river, lake, canal) this close to its footprint (m). */
export const PLANT_WATER_DISTANCE = 30;

export const TRANSFORMER_LEVEL_NAME = ["", "Trafostation", "Umspannstation", "Umspannwerk"];
export const TRANSFORMER_RADIUS = [0, 80, 130, 200];
export const TRANSFORMER_UPKEEP = [0, 2, 4, 8];

/** A cable point this close to a plant or transformer footprint connects it. */
export const CABLE_REACH = 8;
/** Cables touching within this distance form one grid. */
const CABLE_JOIN = 3;

/** Electricity fee per kW and minute (the utility is municipal). */
export const POWER_FEE = 0.6;
/** Businesses without power still work, but slower. */
export const UNPOWERED_WORK = 0.75;

/** Power demand of a building (kW). */
export function powerOf(b: Building): number {
  switch (b.kind) {
    case "house":
      return [0, 4, 10, 28, 55, 100, 180, 320][b.level] ?? 28;
    case "powerplant":
    case "transformer":
    case "coalmine":
    case "ironmine":
    case "uraniummine":
    case "goldmine":
      return 0;
    case "waterworks":
    case "hospital":
    case "school":
    case "church":
    case "bank":
    case "townhall":
    case "taxoffice":
      return 15;
    default:
      return BUILDINGS[b.kind].jobs * 2;
  }
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

/** Distance from a point to a polyline. */
export function polylineDistance(p: Vec2, points: Vec2[]) {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) best = Math.min(best, segmentDistance(p, points[i], points[i + 1]));
  return points.length === 1 ? Math.hypot(p.x - points[0].x, p.z - points[0].z) : best;
}

/** Connected cable grids: cable id → grid id. */
export function cableGrids(cables: Cable[]): Map<string, number> {
  const parent = cables.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let a = 0; a < cables.length; a++) {
    for (let b = a + 1; b < cables.length; b++) {
      const touch =
        cables[a].points.some((p) => polylineDistance(p, cables[b].points) < CABLE_JOIN) ||
        cables[b].points.some((p) => polylineDistance(p, cables[a].points) < CABLE_JOIN);
      if (touch) parent[find(a)] = find(b);
    }
  }
  const out = new Map<string, number>();
  cables.forEach((c, i) => out.set(c.id, find(i)));
  return out;
}

/** The grid a plant or transformer is wired to (a cable point at its footprint), or null. */
export function gridOf(b: Building, cables: Cable[], grids: Map<string, number>): number | null {
  for (const c of cables) {
    if (c.points.some((p) => insideFootprint(b, p.x, p.z, CABLE_REACH))) return grids.get(c.id) ?? null;
  }
  return null;
}

/** True if a transformer reaches the building (centre within its radius). */
export const transformerReaches = (t: Building, b: Building) =>
  Math.hypot(t.x - b.x, t.z - b.z) <= TRANSFORMER_RADIUS[t.level];

export interface PowerPlantStatus {
  /** Grid id or null if no cable is attached. */
  grid: number | null;
  /** Possible output (kW) with the current staff. */
  capacity: number;
  /** Delivered this minute. */
  delivered: number;
  /** Fuel needed / received this minute. */
  fuel?: { need: number; got: number };
}

/** Where the line ends at a plant (switchyard, front left) or transformer (local x, z). */
const FEED_LOCAL: Partial<Record<Building["kind"], [number, number]>> = {
  powerplant: [-15, -10],
  transformer: [0, -1.5],
};

/** World position of the line terminal of a plant or transformer, or null for other kinds. */
export function feedPoint(b: Building): Vec2 | null {
  const local = FEED_LOCAL[b.kind];
  if (!local) return null;
  const [lx, lz] = local;
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c };
}
