import { closestOnPath } from "./adjacency";
import { INDUSTRY, jobsOf, LEVELS, levelFactor, residentsOf, sizeOf, type Building, type BuildingKind } from "./economy";
import { OUTER_HALF_WIDTH, type Rail, type Vec2 } from "./types";

/**
 * Railway service: stations and signal boxes (Stellwerk, where trains are bought) dock to a
 * track. Every train belongs to its signal box and shuttles between all stations of the same
 * track network (tracks joined at shared points). Passenger trains earn fares from residents
 * around the stations, freight trains carry the goods of the businesses around them.
 * The trains themselves are drawn and driven in Trains.tsx; the money is computed here.
 */

export const RAIL_BUILDINGS: BuildingKind[] = ["trainstation", "traindepot"];

export interface TrainType {
  id: string;
  label: string;
  /** Passengers (or freight units) per minute it can carry on its line. */
  capacity: number;
  freight: boolean;
  cost: number;
  upkeep: number;
  /** Top speed (m/s) for the animation. */
  speed: number;
  /**
   * Models front to back (Kenney Train Kit). A last car equal to the first is a second cab turned
   * round (push-pull train: a nose at both ends).
   */
  cars: string[];
}

export const TRAIN_TYPES: TrainType[] = [
  {
    id: "regio",
    label: "Regionalzug",
    capacity: 70,
    freight: false,
    cost: 120_000,
    upkeep: 30,
    speed: 22,
    cars: ["train-electric-city-a", "train-electric-city-b", "train-electric-city-a"],
  },
  {
    id: "express",
    label: "Schnellzug",
    capacity: 160,
    freight: false,
    cost: 320_000,
    upkeep: 70,
    speed: 36,
    cars: ["train-electric-bullet-a", "train-electric-bullet-b", "train-electric-bullet-b", "train-electric-bullet-a"],
  },
  {
    id: "freight",
    label: "Güterzug",
    capacity: 90,
    freight: true,
    cost: 150_000,
    upkeep: 35,
    speed: 17,
    cars: [
      "train-diesel-a",
      "train-carriage-container-blue",
      "train-carriage-tank",
      "train-carriage-coal",
      "train-carriage-container-red",
      "train-carriage-lumber",
    ],
  },
];
export const trainType = (id: string) => TRAIN_TYPES.find((t) => t.id === id) ?? TRAIN_TYPES[0];
/** Selling a train gives back this share of its price. */
export const TRAIN_RESALE = 0.5;

const NAMES = ["Rheingold", "Edelweiß", "Merkur", "Komet", "Albatros", "Lorelei", "Blauer Enzian", "Helvetia", "Gambrinus", "Roland", "Senator", "Isar", "Saphir", "Falke"];

export interface Train {
  id: string;
  type: string;
  /** Signal box (traindepot) it belongs to. */
  depot: string;
  name: string;
}

/** Trains a signal box can keep (its level factor: 2 / 4 / 8). */
export const depotSlots = (b: Building) => levelFactor(b);

export function newTrain(type: TrainType, depot: string, id: string, existing: Train[]): Train {
  const used = new Set(existing.map((t) => t.name));
  const name = NAMES.find((n) => !used.has(n)) ?? `${type.label} ${existing.length + 1}`;
  return { id, type: type.id, depot, name };
}

/* ---------- track networks and docking ---------- */

/** Connected track networks: rail id → network id (tracks joined at a shared point). */
export function railNetworks(rails: Rail[]): Map<string, number> {
  const parent = rails.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let a = 0; a < rails.length; a++)
    for (let b = a + 1; b < rails.length; b++)
      if (rails[a].points.some((p) => rails[b].points.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < 0.6))) parent[find(a)] = find(b);
  const out = new Map<string, number>();
  rails.forEach((r, i) => out.set(r.id, find(i)));
  return out;
}

/** Gap between the track's outer edge and the plot (the platform reaches across it). */
export const RAIL_SETBACK = 0.8;

/** The track a station or signal box stands at (its back edge along it), or null. */
export function railOf(b: { x: number; z: number; rot: number; kind: BuildingKind; level?: number }, rails: Rail[]): Rail | null {
  const [, d] = sizeOf(b);
  // Middle of the back edge (local +z), where the platform is.
  const back: Vec2 = { x: b.x + Math.sin(b.rot) * (d / 2), z: b.z + Math.cos(b.rot) * (d / 2) };
  let best: { rail: Rail; d: number } | null = null;
  for (const r of rails) {
    const dist = closestOnPath(back, r).distance;
    if (dist <= OUTER_HALF_WIDTH[r.kind] + RAIL_SETBACK + 3 && (!best || dist < best.d)) best = { rail: r, d: dist };
  }
  return best?.rail ?? null;
}

/* ---------- money: fares and freight ---------- */

/** Reach of a station per level (m): residents and businesses there use it. */
export const STATION_RADIUS = [0, 450, 650, 900];
/** Passengers a station handles per minute at level factor 1. */
export const STATION_CAPACITY = 60;
/** Train trips per resident and minute (commuters, shopping, visits). */
const TRIPS_PER_RESIDENT = 0.01;
/** Freight units per job of an industrial business and minute. */
const FREIGHT_PER_JOB = 0.05;
export const FARE = 4;
export const FREIGHT_RATE = 7;

export interface StationStatus {
  network: number | null;
  /** Residents and industrial jobs within reach. */
  residents: number;
  jobs: number;
  /** Passengers and freight units per minute moved through it. */
  passengers: number;
  freight: number;
  problem: string | null;
}
export interface DepotStatus {
  network: number | null;
  stations: number;
  running: number;
  /** Fares and freight earned per minute by its trains. */
  revenue: number;
  problem: string | null;
}
export interface RailStats {
  stations: Record<string, StationStatus>;
  depots: Record<string, DepotStatus>;
  /** Income per minute (fares + freight) and running costs of all trains. */
  income: number;
  upkeep: number;
  /** Share of residents near a station that passenger trains serve (0..1). */
  transit: number;
  passengers: number;
  freight: number;
}

export function railEconomy(buildings: Building[], rails: Rail[], trains: Train[], totalResidents: number): RailStats {
  const nets = railNetworks(rails);
  const stationsB = buildings.filter((b) => b.kind === "trainstation");
  const depotsB = buildings.filter((b) => b.kind === "traindepot");
  const netOf = (b: Building) => {
    const r = railOf(b, rails);
    return r ? (nets.get(r.id) ?? null) : null;
  };
  const stations: Record<string, StationStatus> = {};
  const depots: Record<string, DepotStatus> = {};
  for (const s of stationsB) stations[s.id] = { network: netOf(s), residents: 0, jobs: 0, passengers: 0, freight: 0, problem: null };
  for (const d of depotsB) depots[d.id] = { network: netOf(d), stations: 0, running: 0, revenue: 0, problem: null };

  // Residents and industrial jobs around the stations (each counted at its nearest station).
  for (const b of buildings) {
    const r = residentsOf(b);
    const j = INDUSTRY.includes(b.kind) ? jobsOf(b) : 0;
    if (r <= 0 && j <= 0) continue;
    let best: { id: string; d: number } | null = null;
    for (const s of stationsB) {
      if (stations[s.id].network === null) continue;
      const d = Math.hypot(s.x - b.x, s.z - b.z);
      if (d <= STATION_RADIUS[s.level] && (!best || d < best.d)) best = { id: s.id, d };
    }
    if (!best) continue;
    stations[best.id].residents += r;
    stations[best.id].jobs += j;
  }

  let income = 0;
  let upkeep = 0;
  let passengersAll = 0;
  let freightAll = 0;
  let served = 0;
  const byNet = new Map<number, { stations: Building[]; depots: Building[] }>();
  for (const s of stationsB) {
    const n = stations[s.id].network;
    if (n === null) continue;
    const e = byNet.get(n) ?? { stations: [], depots: [] };
    e.stations.push(s);
    byNet.set(n, e);
  }
  for (const d of depotsB) {
    const n = depots[d.id].network;
    if (n === null) continue;
    const e = byNet.get(n) ?? { stations: [], depots: [] };
    e.depots.push(d);
    byNet.set(n, e);
  }
  for (const t of trains) upkeep += trainType(t.type).upkeep;

  for (const { stations: ss, depots: ds } of byNet.values()) {
    const fleet = trains.filter((t) => ds.some((d) => d.id === t.depot));
    for (const d of ds) depots[d.id].stations = ss.length;
    if (ss.length < 2) continue;
    const pax = fleet.filter((t) => !trainType(t.type).freight);
    const cargo = fleet.filter((t) => trainType(t.type).freight);
    // Demand, capped by what each station can handle.
    const paxDemand = ss.map((s) => Math.min(stations[s.id].residents * TRIPS_PER_RESIDENT, STATION_CAPACITY * levelFactor(s)));
    const freightDemand = ss.map((s) => stations[s.id].jobs * FREIGHT_PER_JOB);
    const paxCap = pax.reduce((a, t) => a + trainType(t.type).capacity, 0);
    const freightCap = cargo.reduce((a, t) => a + trainType(t.type).capacity, 0);
    const paxTotal = paxDemand.reduce((a, v) => a + v, 0);
    const freightTotal = freightDemand.reduce((a, v) => a + v, 0);
    const paxShare = paxTotal > 0 ? Math.min(1, paxCap / paxTotal) : 0;
    const freightShare = freightTotal > 0 ? Math.min(1, freightCap / freightTotal) : 0;
    ss.forEach((s, i) => {
      stations[s.id].passengers = paxDemand[i] * paxShare;
      stations[s.id].freight = freightDemand[i] * freightShare;
      if (pax.length > 0) served += stations[s.id].residents;
    });
    const paxMoved = paxTotal * paxShare;
    const freightMoved = freightTotal * freightShare;
    passengersAll += paxMoved;
    freightAll += freightMoved;
    const netIncome = paxMoved * FARE + freightMoved * FREIGHT_RATE;
    income += netIncome;
    // Revenue per signal box by the capacity of its trains.
    const capAll = paxCap + freightCap;
    for (const d of ds) {
      const own = fleet.filter((t) => t.depot === d.id);
      depots[d.id].running = own.length;
      const cap = own.reduce((a, t) => a + trainType(t.type).capacity, 0);
      depots[d.id].revenue = capAll > 0 ? (netIncome * cap) / capAll : 0;
    }
  }

  for (const s of stationsB) {
    const st = stations[s.id];
    const net = st.network !== null ? byNet.get(st.network) : null;
    st.problem =
      st.network === null
        ? "Nicht am Gleis – mit dem Bahnsteig direkt an ein Gleis bauen"
        : (net?.stations.length ?? 0) < 2
          ? "Nur ein Bahnhof im Gleisnetz – einen zweiten bauen"
          : !trains.some((t) => net?.depots.some((d) => d.id === t.depot))
            ? "Kein Zug im Gleisnetz – im Stellwerk Züge kaufen"
            : null;
  }
  for (const d of depotsB) {
    const st = depots[d.id];
    st.problem =
      st.network === null
        ? "Nicht am Gleis – direkt an ein Gleis bauen"
        : st.stations < 2
          ? "Mindestens zwei Bahnhöfe im selben Gleisnetz nötig"
          : !trains.some((t) => t.depot === d.id)
            ? "Noch keine Züge – unten kaufen"
            : null;
  }

  return {
    stations,
    depots,
    income,
    upkeep,
    transit: totalResidents > 0 ? Math.min(1, served / totalResidents) : 0,
    passengers: passengersAll,
    freight: freightAll,
  };
}

/** Level names (LEVELS) of the rail buildings, for cards. */
export const railLevelName = (b: Building) => LEVELS[b.kind]?.name[b.level] ?? "";
