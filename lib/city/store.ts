import { create } from "zustand";
import { goldBuyPrice, goldSellPrice } from "./gold";
import { computeProfiles, crossesAtGrade, crossesLevel, pairKey, type Separations } from "./grade";
import { planCloverleaf, planCloverleafPrefab } from "./cloverleaf";
import {
  BUILDINGS,
  MAYOR_PRIVATE,
  sizeOf,
  BUSINESS_TAX_DEFAULT,
  BUSINESS_TAX_MAX,
  BUSINESS_TAX_MIN,
  levelName,
  MISSION_FEE,
  simulate, START_MONEY, TAX_DEFAULT, TAX_MAX, TAX_MIN, type Building, type BuildingKind, type EconomyStats,
  storedTotal,
  insideFootprint,
  type Good,
  warehouseCapacity,
  type Storage,
} from "./economy";
import { planInterchange } from "./interchange";
import { plotsUnchecked, decay, growOnce, GROWTH_STEP, type Permits } from "./growth";
import { autoConnectTransformers } from "./autocable";
import { harbourWaterProblem, planBuilding, planGrowth, redockAirports } from "./placement";
import { polylineLength } from "./road-geometry";
import { mulberry32 } from "./random";
import { LAYOUT_VERSION, migrateLayout, SAVE_VERSION, type SaveGame } from "./save";
import { generateVillage } from "./village";
import { planTrumpet, trumpetSeparations } from "./trumpet";
import { CANAL_MAX_CUT, depthGrid, naturalDepthGrid, setWorldSeed, terrainHeight, type DepthGrid } from "./terrain";
import { connectRoads, findCrossings, splitAtJunctions } from "./network";
import { BUILD_LABEL, NETWORK_OF, OUTER_HALF_WIDTH, type BuildKind, type Cable, type Canal, type NetworkId, type Path, type Rail, type Road, type Vec2 } from "./types";
import { CABLE_REACH, feedPoint, polylineDistance } from "./power";
import { creditLimit, debtOf, LOAN_OFFERS, loanPayments, newLoan, payLoans, payoffOf, type Loan } from "./finance";
import { moodFactors, moodOf, STAT_INTERVAL, STAT_LIMIT, type StatSample } from "./wellbeing";
import { bulldozeTarget, splitOut } from "./bulldoze";
import { checkPoint, type JoinState } from "./joins";
import { HARBOUR_BERTHS, newShip, SALE_WINDOW, SHIP_RESALE, shipType, shipUpkeep, stepShips, type Ship, type ShipSale } from "./shipping";
import { dispatch, dispatchAmbulance, dispatchPolice, incidentDone, stepIncidents, type Incident } from "./incidents";
import { acceptOffer, applyMayor, embezzleSuspicion, jailed, newMayor, OFFER_LABEL, repayTown, SALARY_MAX, setFront, setRacket, spend, stepMayor, type MayorState } from "./mayor";
import { payoutOf, type RouletteBet, type RouletteSpin } from "./roulette";
import { collectNews, makeEdition, newsSnapshot, PAPER_NAME, type Edition, type NewsEvent, type NewsSnapshot } from "./news";
import { timed } from "./perf";
import { buildingsDropped, buildingsSynced, requestGrow, requestSim, simState, type SimWorld } from "./sim-client";
import { depotSlots, newTrain, railEconomy, TRAIN_RESALE, trainType, type Train } from "./railway";

const HISTORY_LIMIT = 50;

/** Everything the player has built. One undo step restores a whole snapshot. */
export interface Networks {
  roads: Road[];
  rails: Rail[];
  canals: Canal[];
  /** Overhead power lines. */
  cables: Cable[];
  buildings: Building[];
  money: number;
  /** Which path goes over at grade-separated crossings (pair key → id of the upper path). */
  separations: Separations;
}

/**
 * How a new path treats paths it crosses:
 *  - auto: realistic defaults – junctions and level crossings where allowed, bridges
 *    elsewhere (motorways); the new path goes over.
 *  - over / under: every crossing becomes a bridge; the new path goes over / under.
 */
export type CrossingMode = "auto" | "over" | "under";
export const CROSSING_MODE_LABEL: Record<CrossingMode, string> = {
  auto: "Automatisch",
  over: "Brücke drüber",
  under: "Unterführung",
};

/** Everything selectable in the toolbar: path tools plus one-click tools. */
export type Tool = BuildKind | "interchange" | "cloverleaf" | "trumpet" | "cable" | "bulldoze";
/** One-click tools that place a whole interchange instead of drawing a path. */
export const PLACEMENT_TOOLS: Tool[] = ["interchange", "cloverleaf", "trumpet"];
export const isPathTool = (t: Tool | null): t is BuildKind => t !== null && t !== "cable" && t !== "bulldoze" && !PLACEMENT_TOOLS.includes(t);
/** Cable cost per metre (pylons and wires). */
export const CABLE_COST_PER_M = 12;
const cableId = () => `cable-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
/** Cable points snap to existing pylons and to plants/transformers within this distance. */
const CABLE_SNAP = 6;

/** Snaps a cable point to a nearby pylon, cable or the centre of a power building. */
export function snapCablePoint(p: Vec2, cables: Cable[], buildings: Building[]): Vec2 {
  for (const c of cables) for (const q of c.points) if (Math.hypot(q.x - p.x, q.z - p.z) < CABLE_SNAP) return q;
  for (const b of buildings) {
    const feed = feedPoint(b);
    if (!feed) continue;
    const [w, d] = sizeOf(b);
    if (Math.hypot(b.x - p.x, b.z - p.z) < Math.max(w, d) / 2 + CABLE_REACH / 2) return feed;
  }
  for (const c of cables) if (polylineDistance(p, c.points) < CABLE_SNAP / 2) return p;
  return p;
}

/** Which state list holds the paths of a network. */
type PathListKey = "roads" | "rails" | "canals";
export const NETWORK_KEY: Record<NetworkId, PathListKey> = {
  road: "roads",
  rail: "rails",
  water: "canals",
};

interface CityState extends Networks {
  /** Cinematic rain weather effect. */
  showRain: boolean;
  toggleRain: () => void;
  /** Snow weather effect. */
  showSnow: boolean;
  toggleSnow: () => void;
  /** Earlier snapshots, for undo. */
  history: Networks[];
  /** Points placed for the path currently being drawn. */
  draft: Vec2[];
  /** Snapped ground position under the mouse while building. */
  cursor: Vec2 | null;
  /** Verdict on the cursor point of a path tool (joins.ts): ring colour and reason. */
  cursorJoin: { state: JoinState; reason: string | null } | null;
  /** Active build tool, or null for camera-only mode. */
  tool: Tool | null;
  /** Short message for the status bar (e.g. why a click did nothing). */
  notice: string | null;
  /** Ids of paths that still have a construction crew working on them. */
  jobs: string[];
  /** Per job: length (m) at the start of the path that already exists (only the rest is built). */
  jobOffsets: Record<string, number>;
  crossingMode: CrossingMode;
  /** Seed of the current world (terrain, water, village). */
  seed: number;
  /** Building being placed from the economy menu, or null. */
  placing: BuildingKind | null;
  /** Selected building (info panel), or null. */
  selected: string | null;
  /** Latest economy step (per-minute rates and building status). */
  economy: EconomyStats | null;
  /** Simulation speed: 0 = paused, 1–3 = game minutes per real second. */
  speed: number;
  /** Game time in minutes since the start (day 1, 06:00). */
  gameMinutes: number;
  /** New residents gathered towards the next house (births and immigration). */
  growthPoints: number;
  /** Income tax rate on wages (TAX_MIN … TAX_MAX). */
  taxRate: number;
  /** Business tax on profits (BUSINESS_TAX_MIN … BUSINESS_TAX_MAX). */
  businessTaxRate: number;
  setBusinessTaxRate: (rate: number) => void;

  setTool: (tool: Tool | null) => void;
  /** Builds on/off ramps at the motorway × street crossing nearest to p. */
  buildInterchange: (p: Vec2) => void;
  /** Builds a cloverleaf at the motorway × motorway crossing nearest to p. */
  buildCloverleaf: (p: Vec2) => void;
  /** Builds a trumpet where a motorway ends at another one, nearest to p. */
  buildTrumpet: (p: Vec2) => void;
  setCursor: (p: Vec2 | null, join?: { state: JoinState; reason: string | null } | null) => void;
  addPoint: (p: Vec2) => void;
  removeLastPoint: () => void;
  cancelDraft: () => void;
  finishDraft: () => void;
  undo: () => void;
  finishJob: (id: string) => void;
  cycleCrossingMode: () => void;
  /** Generates a new world from a seed: terrain, water and the starting village. */
  newWorld: (seed: number) => void;
  startPlacing: (kind: BuildingKind | null) => void;
  /** Places the building of `placing` for the cursor, if it fits. */
  placeBuilding: (p: Vec2) => void;
  /** Wires transformers without power (all, or one) to the nearest powered cable. */
  autoCable: (only?: string) => void;
  select: (id: string | null) => void;
  /** Selects a building and flies the camera to it (lists in the panels). */
  flyTo: (id: string) => void;
  /** Camera flight target (point and a counter that restarts the flight), consumed by CameraFly. */
  focus: { x: number; z: number; n: number } | null;
  upgrade: (id: string) => void;
  demolish: (id: string) => void;
  /** One second of simulation: money changes by the per-minute balance / 60. */
  tick: (precomputed?: EconomyStats) => void;
  /**
   * One game tick with the economy and the growth computed in the simulation worker
   * (falls back to `tick` + `growStep` on the main thread without one).
   */
  tickAsync: () => Promise<void>;
  /** Town growth after a tick (own task): new and bigger houses, as many as the speed allows. */
  growStep: () => void;
  setSpeed: (speed: number) => void;
  setTaxRate: (rate: number) => void;
  /** Increases on every new or loaded world; the 3D scene is remounted with it. */
  worldVersion: number;
  /** Current state as a save game. */
  toSave: () => SaveGame;
  /** Replaces the whole game with a save. */
  loadGame: (save: SaveGame) => void;
  /** Supply chain overlay: show every delivery link. */
  showSupply: boolean;
  toggleSupply: () => void;
  /** Overlays: power grid (cables, all supply circles) and water supply areas. */
  showPower: boolean;
  togglePower: () => void;
  showWater: boolean;
  toggleWater: () => void;
  /** Overlay: road networks in colours, unconnected buildings and gaps. */
  showNetworks: boolean;
  toggleNetworks: () => void;
  /** House models: built-in box houses or the Kenney City Pack (trial; per browser, not in the save). */
  houseStyle: HouseStyle;
  setHouseStyle: (style: HouseStyle) => void;
  /** Test cheat: adds money. */
  cheatMoney: (amount: number) => void;
  /** Bank loans being paid back. */
  loans: Loan[];
  takeLoan: (offerId: string) => void;
  /** Pays a loan off early (remaining principal, no further interest). */
  repayLoan: (id: string) => void;
  /** Trend samples for the bank and town hall charts. */
  stats: StatSample[];
  /** Big HUD panel opened from the bank, town hall or tax office, or null. */
  panel: CityPanel | null;
  setPanel: (panel: CityPanel | null) => void;
  /** Goods in the warehouses (warehouse id → good → units). */
  storage: Storage;
  /** Ships; each belongs to one harbour. */
  ships: Ship[];
  /** Cargo sales of the last game day (tax office average). */
  shipSales: ShipSale[];
  /** Gold bars in the bank's vault (owned by the town). */
  gold: number;
  /** Turns money into bars (n > 0) or bars back into money (n < 0) at the market price. */
  tradeGold: (n: number) => void;
  buyShip: (harbourId: string, typeId: string) => void;
  /** Bulldozer: removes the piece of road, track, canal or power line under p. */
  bulldoze: (p: Vec2) => void;
  sellShip: (id: string) => void;
  /** Building permits for homes, set in the town hall (only while one stands). */
  permits: Permits;
  setPermits: (permits: Permits) => void;
  /** Open accidents and house fires (police and fire brigade respond). */
  incidents: Incident[];
  /** Game minute the last incident started (incidents keep a pause between them). */
  incidentLastAt: number;
  /** The mayor's private account, salary, bribes and suspicion (mayor.ts). */
  mayor: MayorState;
  setSalary: (salary: number) => void;
  acceptBribe: (id: string) => void;
  declineBribe: (id: string) => void;
  /** Moves money from the town's till onto the mayor's account. */
  embezzle: (amount: number) => void;
  /** The mayor gives money back to the town: standing up, a running scandal shorter. */
  repayCity: (amount: number) => void;
  /** Uses a pizzeria / recycling yard to launder the mayor's dirty money (or stops it). */
  setLaundering: (building: string, on: boolean) => void;
  /** Protection money from a firm: share of its profit (0 ends it). */
  setProtection: (building: string, share: number) => void;
  /** One spin of the casino's roulette with the mayor's money; null if it cannot be played. */
  playRoulette: (bet: RouletteBet, stake: number) => RouletteSpin | null;
  /** Last spins (not saved). */
  rouletteHistory: RouletteSpin[];
  /** What happened lately (for the newspaper), the printed editions (newest first), the last edition read. */
  newsLog: NewsEvent[];
  newspapers: Edition[];
  newsRead: number;
  /** Marks the newest edition as read. */
  readNewspaper: () => void;
  /** The player raises the alarm for an incident: police or fire brigade set off. */
  raiseAlarm: (id: string) => void;
  /** Flies the camera to an incident. */
  flyToIncident: (id: string) => void;
  /** The vehicle has arrived at the incident (scene → store). */
  incidentOnSite: (id: string) => void;
  /** The vehicle has finished at the incident: it is over (or only waits for the ambulance); the fee is paid. */
  resolveIncident: (id: string) => void;
  /** The ambulance has taken the injured to hospital; its fee is paid. */
  ambulanceDone: (id: string) => void;
  /** The patrol car at a fire has opened the street again and left. */
  policeDone: (id: string) => void;
  /** Trains; each belongs to a signal box (traindepot). */
  trains: Train[];
  buyTrain: (depotId: string, typeId: string) => void;
  sellTrain: (id: string) => void;
}

export type HouseStyle = "classic" | "pack";
const HOUSE_STYLE_KEY = "citypower.houseStyle";
/** The trial shows the City Pack unless the player switched back to the classic houses. */
function readHouseStyle(): HouseStyle {
  try {
    return typeof window !== "undefined" && localStorage.getItem(HOUSE_STYLE_KEY) === "classic" ? "classic" : "pack";
  } catch {
    return "pack";
  }
}

export type CityPanel = "bank" | "townhall" | "taxoffice" | "exchange" | "mayor" | "casino" | "newspaper";

let idCounter = 0;
const newId = (network: NetworkId) => `${network}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

const snapshot = (s: Networks): Networks => ({
  roads: s.roads,
  rails: s.rails,
  canals: s.canals,
  cables: s.cables,
  buildings: s.buildings,
  money: s.money,
  separations: s.separations,
});

const firstWorld = generateVillage(1);

/** What the mayor's own buildings (villa, boathouse) cost him (construction and upgrades), for undo refunds. */
function villaValue(buildings: Building[]) {
  let sum = 0;
  for (const v of buildings) {
    if (!MAYOR_PRIVATE.includes(v.kind)) continue;
    const up = BUILDINGS[v.kind].upgrade ?? [];
    sum += BUILDINGS[v.kind].cost;
    for (let l = 2; l <= v.level; l++) sum += up[l] ?? 0;
  }
  return sum;
}
const mayorRnd = mulberry32((Date.now() >> 5) & 0xffff);
/** The state the newspaper compared against last tick (null after loading: the first tick only takes a picture). */
let lastNews: NewsSnapshot | null = null;
const rouletteRnd = mulberry32((Date.now() >> 7) & 0xffff);

/** Why each harbour cannot send ships (null = it can); cached while buildings and water stay the same. */
let harbourCache: { buildings: Building[]; grid: DepthGrid; out: Record<string, string | null> } | null = null;
function harbourStatus(buildings: Building[], grid: DepthGrid) {
  if (harbourCache && harbourCache.buildings === buildings && harbourCache.grid === grid) return harbourCache.out;
  const out: Record<string, string | null> = {};
  for (const b of buildings) if (b.kind === "harbour") out[b.id] = harbourWaterProblem(b, grid);
  harbourCache = { buildings, grid, out };
  return out;
}
const growthRnd = mulberry32(Date.now() & 0xffff);
const incidentRnd = mulberry32((Date.now() >> 3) & 0xffff);
/**
 * A growth step that found no plot and no house to upgrade is retried only after
 * GROWTH_RETRY ticks or once roads/buildings change: the search costs ~7 ms and ran every
 * tick while the town was full, a hitch once per second.
 */
const GROWTH_RETRY = 15;
/** Time slice for growth after a tick (ms): more houses only while there is time left. */
const GROW_SLICE_MS = 8;
/** Real time of the last tick, for the smooth clock between ticks. */
let lastTickAt = 0;

/**
 * Game time with the fraction since the last tick (ticks come once a second and add `speed`
 * minutes at once): sun, sky and the HUD clock move smoothly instead of jumping.
 */
export function clockMinutes() {
  const s = useCity.getState();
  if (s.speed === 0 || lastTickAt === 0) return s.gameMinutes;
  return s.gameMinutes + Math.min(1, (performance.now() - lastTickAt) / 1000) * s.speed;
}
let growthBlocked: { buildings: Building[]; roads: Path[]; ticks: number } | null = null;

/** True if a new path of `kind` drawn in `mode` joins `other` at grade where they meet. */
export function joinsAtGrade(mode: CrossingMode, kind: BuildKind, other: BuildKind) {
  return mode === "auto" && crossesAtGrade(kind, other);
}

const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z) < 0.5;

/**
 * Joins `created` with paths of the same kind that end exactly where it starts or ends,
 * if nothing else meets there. Two roads forming an L or a straight continuation become
 * one path, so the corner gets a proper curve (with sidewalks) instead of a junction.
 */
function mergeEnds(
  list: Path[],
  created: Path,
): { list: Path[]; created: Path; merged: string[]; builtPrefix: Path | null } {
  let current = created;
  let rest = list;
  const merged: string[] = [];
  let prefix: Path | null = null;
  for (let pass = 0; pass < 2; pass++) {
    for (const atStart of [true, false]) {
      const end = atStart ? current.points[0] : current.points[current.points.length - 1];
      const users = rest.filter((p) => p.points.some((q) => near(q, end)));
      if (users.length !== 1) continue;
      const other = users[0];
      if (other.kind !== current.kind) continue;
      const oStart = near(other.points[0], end);
      const oEnd = near(other.points[other.points.length - 1], end);
      if (!oStart && !oEnd) continue;
      // Orient both so they meet at `end`, then concatenate.
      const o = oEnd ? other.points : [...other.points].reverse();
      const c = atStart ? current.points : [...current.points].reverse();
      const points = [...o, ...c.slice(1)];
      current = { ...current, points: atStart ? points : points };
      rest = rest.filter((p) => p.id !== other.id);
      merged.push(other.id);
      prefix = { ...other, points: o };
    }
  }
  // With exactly one merge the existing path comes first and the new part last: only the
  // new part needs a construction site.
  return { list: rest, created: current, merged, builtPrefix: merged.length === 1 ? prefix : null };
}

/** True if a drawn line runs over terrain higher than the plain (sampled every 4 m). */
function draftClimbs(points: Vec2[]) {
  const grid = naturalDepthGrid();
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4));
    for (let k = 0; k <= steps; k++) {
      if (terrainHeight(grid, a.x + ((b.x - a.x) * k) / steps, a.z + ((b.z - a.z) * k) / steps) > CANAL_MAX_CUT) return true;
    }
  }
  return false;
}

/**
 * Splits streets at inner points where other streets join (see `splitAtJunctions`) and
 * carries crossing decisions and construction sites over to the pieces.
 */
function cleanJunctions(roads: Road[], separations: Separations, jobs: string[]) {
  const { paths, pieces } = splitAtJunctions(roads, () => newId("road"));
  if (pieces.size === 0) return { roads, separations, jobs };
  const seps: Separations = {};
  for (const [k, v] of Object.entries(separations)) {
    const [a, b] = k.split("|");
    for (const pa of pieces.get(a) ?? [a])
      for (const pb of pieces.get(b) ?? [b]) {
        const upper = v === a ? pa : v === b ? pb : v;
        seps[pairKey(pa, pb)] = upper;
      }
  }
  return { roads: paths, separations: seps, jobs: jobs.flatMap((j) => pieces.get(j) ?? [j]) };
}

/** Buildings whose footprint a new path (half width incl. sidewalks) runs through. */
function buildingsOnPath(points: Vec2[], half: number, buildings: Building[]) {
  const out = new Set<Building>();
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2));
    for (let k = 0; k <= steps; k++) {
      const x = a.x + ((b.x - a.x) * k) / steps;
      const z = a.z + ((b.z - a.z) * k) / steps;
      for (const bd of buildings) if (!out.has(bd) && insideFootprint(bd, x, z, half - 0.5)) out.add(bd);
    }
  }
  return [...out];
}

/** Paths of the network the given tool builds in; the draft snaps to these. */
export function pathsFor(s: Networks, tool: BuildKind): Path[] {
  return s[NETWORK_KEY[NETWORK_OF[tool]]];
}

export const useCity = create<CityState>((set, get) => ({
  roads: firstWorld.roads,
  rails: [],
  canals: [],
  cables: [],
  buildings: firstWorld.buildings,
  money: START_MONEY,
  seed: 1,
  placing: null,
  selected: null,
  economy: null,
  speed: 1,
  gameMinutes: 6 * 60,
  growthPoints: 0,
  taxRate: TAX_DEFAULT,
  businessTaxRate: BUSINESS_TAX_DEFAULT,
  worldVersion: 0,
  showSupply: false,
  showPower: false,
  showWater: false,
  showNetworks: false,
  focus: null,
  houseStyle: readHouseStyle(),
  loans: [],
  stats: [],
  panel: null,
  permits: "all",
  storage: {},
  ships: [],
  trains: [],
  shipSales: [],
  gold: 0,
  incidents: [],
  incidentLastAt: -Infinity,
  mayor: newMayor(),
  rouletteHistory: [],
  newsLog: [],
  newspapers: [],
  newsRead: 0,
  separations: {},
  crossingMode: "auto",
  history: [],
  draft: [],
  cursor: null,
  cursorJoin: null,
  tool: null,
  notice: null,
  jobs: [],
  jobOffsets: {},
  showRain: false,
  showSnow: false,

  setTool: (tool) => set({ tool, draft: [], cursor: null, notice: null, placing: null }),

  newWorld: (seed) => {
    // The newspaper starts comparing afresh (otherwise every building would be "new").
    lastNews = null;
    setWorldSeed(seed);
    const village = generateVillage(seed);
    set({
      seed,
      roads: village.roads,
      rails: [],
      canals: [],
      cables: [],
      buildings: village.buildings,
      money: START_MONEY,
      loans: [],
      stats: [],
      panel: null,
      permits: "all",
      storage: {},
      ships: [],
      trains: [],
      shipSales: [],
      gold: 0,
      incidents: [],
      incidentLastAt: -Infinity,
      mayor: newMayor(),
      newsLog: [],
      newspapers: [],
      newsRead: 0,
      separations: {},
      history: [],
      jobs: [],
      draft: [],
      cursor: null,
      tool: null,
      placing: null,
      selected: null,
      economy: null,
      notice: null,
      gameMinutes: 6 * 60,
      growthPoints: 0,
      taxRate: TAX_DEFAULT,
      businessTaxRate: BUSINESS_TAX_DEFAULT,
      jobOffsets: {},
      worldVersion: get().worldVersion + 1,
    });
  },

  toSave: () => {
    const s = get();
    return {
      version: SAVE_VERSION,
      layout: LAYOUT_VERSION,
      savedAt: new Date().toISOString(),
      seed: s.seed,
      roads: s.roads,
      rails: s.rails,
      canals: s.canals,
      cables: s.cables,
      buildings: s.buildings,
      separations: s.separations,
      money: s.money,
      taxRate: s.taxRate,
      businessTaxRate: s.businessTaxRate,
      gameMinutes: s.gameMinutes,
      growthPoints: s.growthPoints,
      loans: s.loans,
      stats: s.stats,
      permits: s.permits,
      storage: s.storage,
      ships: s.ships,
      trains: s.trains,
      shipSales: s.shipSales,
      gold: s.gold,
      incidents: s.incidents,
      mayor: s.mayor,
      newsLog: s.newsLog,
      newspapers: s.newspapers,
      newsRead: s.newsRead,
      summary: { residents: s.economy?.residents ?? 0 },
    };
  },

  loadGame: (save) => {
    // The newspaper starts comparing afresh (otherwise every building would be "new").
    lastNews = null;
    setWorldSeed(save.seed);
    // Older saves may have junctions on rounded corners: repaired on load.
    const clean = cleanJunctions(save.roads, save.separations, []);
    // Airports from before the docking fix stood crooked: moved to their street.
    // Plots whose shape changed since the save was written keep their front at the street.
    const laidOut = migrateLayout(save.buildings, save.layout ?? 1);
    const redock = redockAirports(laidOut, clean.roads, [...clean.roads, ...save.rails, ...save.canals], depthGrid(save.canals), save.cables ?? []);
    // Transformers left without a cable are wired to the nearest powered line (paid as drawn).
    const wired = autoConnectTransformers(redock.buildings, save.cables ?? [], cableId);
    const wiredCost = Math.round(wired.length * CABLE_COST_PER_M);
    set({
      seed: save.seed,
      roads: clean.roads,
      separations: clean.separations,
      rails: save.rails,
      canals: save.canals,
      cables: wired.cables,
      buildings: redock.buildings,
      money: save.money - wiredCost,
      taxRate: save.taxRate,
      businessTaxRate: save.businessTaxRate ?? BUSINESS_TAX_DEFAULT,
      gameMinutes: save.gameMinutes,
      growthPoints: save.growthPoints,
      loans: save.loans ?? [],
      stats: save.stats ?? [],
      permits: save.permits ?? "all",
      storage: save.storage ?? {},
      ships: save.ships ?? [],
      trains: save.trains ?? [],
      shipSales: save.shipSales ?? [],
      gold: save.gold ?? 0,
      incidents: save.incidents ?? [],
      mayor: { ...newMayor(), ...(save.mayor ?? {}) },
      newsLog: save.newsLog ?? [],
      newspapers: save.newspapers ?? [],
      newsRead: save.newsRead ?? 0,
      panel: null,
      history: [],
      // Everything in a save is finished: no construction sites.
      jobs: [],
      jobOffsets: {},
      draft: [],
      cursor: null,
      tool: null,
      placing: null,
      selected: null,
      economy: null,
      notice:
        wired.added.length > 0
          ? `Spielstand geladen – ${wired.added.length} Trafostation${wired.added.length === 1 ? "" : "en"} automatisch ans Stromnetz angeschlossen (−${wiredCost.toLocaleString("de-DE")} €)`
          : redock.moved > 0
          ? "Spielstand geladen – Flughafen gerade an die Straße angedockt"
          : redock.blocked.length > 0
            ? `Spielstand geladen – Flughafen konnte nicht neu ausgerichtet werden: ${redock.blocked[0]}`
            : "Spielstand geladen",
      worldVersion: get().worldVersion + 1,
    });
  },

  startPlacing: (kind) => set({ placing: kind, tool: null, draft: [], selected: null, notice: null }),

  placeBuilding: (p) => {
    const state = get();
    if (!state.placing) return;
    const finishedCanals = state.canals.filter((c) => !state.jobs.includes(c.id));
    // The mayor's villa and boathouse are paid from his private account, not by the town.
    const privately = MAYOR_PRIVATE.includes(state.placing);
    if (privately && jailed(state.mayor, state.gameMinutes)) {
      set({ notice: `Der Bürgermeister sitzt im Gefängnis – kein ${BUILDINGS[state.placing].label}` });
      return;
    }
    if (privately && state.mayor.account < BUILDINGS[state.placing].cost) {
      set({ notice: `Das Privatkonto reicht nicht (${Math.round(state.mayor.account).toLocaleString("de-DE")} € von ${BUILDINGS[state.placing].cost.toLocaleString("de-DE")} €) – Knopf „Bürgermeister“` });
      return;
    }
    const plan = planBuilding(
      state.placing,
      p,
      state.roads,
      [...state.roads, ...state.rails, ...state.canals],
      state.buildings,
      depthGrid(finishedCanals),
      privately ? state.mayor.account : state.money,
      newId("road").replace("road", "building"),
      state.cables,
    );
    if (plan.problem) {
      set({ notice: plan.problem });
      return;
    }
    const cost = BUILDINGS[plan.building.kind].cost;
    // Houses in the way make room (their residents move elsewhere).
    const gone = new Set(plan.demolish ?? []);
    const buildings = [...state.buildings.filter((b) => !gone.has(b.id)), plan.building];
    // A new transformer is wired to the nearest powered line right away.
    const wired =
      plan.building.kind === "transformer" ? autoConnectTransformers(buildings, state.cables, cableId, plan.building.id) : null;
    const wiredCost = wired ? Math.round(wired.length * CABLE_COST_PER_M) : 0;
    set({
      buildings,
      cables: wired?.cables ?? state.cables,
      money: state.money - (privately ? 0 : cost) - wiredCost,
      mayor: privately ? spend(state.mayor, cost, false) : state.mayor,
      selected: plan.building.id,
      notice: `${BUILDINGS[plan.building.kind].label} gebaut (−${cost.toLocaleString("de-DE")} €${privately ? " vom Privatkonto" : ""})${
        gone.size > 0 ? `, ${gone.size} ${gone.size === 1 ? "Wohnhaus" : "Wohnhäuser"} abgerissen` : ""
      }${
        wired?.added.length ? `, Leitung automatisch gelegt (−${wiredCost.toLocaleString("de-DE")} €)` : ""
      }${plan.warning ? " – stillgelegt, bis der Anschluss steht" : ""}`,
      history: [...state.history, snapshot(state)].slice(-HISTORY_LIMIT),
    });
  },

  autoCable: (only) => {
    const state = get();
    const wired = autoConnectTransformers(state.buildings, state.cables, cableId, only);
    const cost = Math.round(wired.length * CABLE_COST_PER_M);
    if (wired.added.length === 0) {
      set({
        notice: state.buildings.some((b) => b.kind === "powerplant")
          ? "Keine Leitung möglich – Weg zum nächsten Stromkabel ist bebaut oder zu weit (max. 900 m)"
          : "Kein Kraftwerk mit Leitung – erst ein Kraftwerk anschließen",
      });
      return;
    }
    if (cost > state.money) {
      set({ notice: `Nicht genug Geld für die Leitung (${cost.toLocaleString("de-DE")} €)` });
      return;
    }
    set({
      cables: wired.cables,
      money: state.money - cost,
      notice: `Leitung automatisch gelegt: ${Math.round(wired.length)} m (−${cost.toLocaleString("de-DE")} €)${wired.failed.length ? ` – ${wired.failed.length} Trafo(s) ohne freien Weg` : ""}`,
      history: [...state.history, snapshot(state)].slice(-HISTORY_LIMIT),
    });
  },

  select: (id) => set({ selected: id }),
  flyTo: (id) => {
    const b = get().buildings.find((x) => x.id === id);
    if (!b) return;
    set((s) => ({ selected: id, focus: { x: b.x, z: b.z, n: (s.focus?.n ?? 0) + 1 } }));
  },

  upgrade: (id) => {
    const state = get();
    const b = state.buildings.find((x) => x.id === id);
    const costs = b ? BUILDINGS[b.kind].upgrade : undefined;
    if (!b || !costs || b.level >= costs.length - 1) return;
    const cost = costs[b.level + 1];
    const privately = MAYOR_PRIVATE.includes(b.kind);
    if ((privately ? state.mayor.account : state.money) < cost) {
      set({ notice: privately ? `Das Privatkonto reicht nicht für den Ausbau (${cost.toLocaleString("de-DE")} €)` : `Nicht genug Geld für den Ausbau (${cost.toLocaleString("de-DE")} €)` });
      return;
    }
    // Buildings with a growing plot move back from the road and clear houses in the way.
    const finishedCanals = state.canals.filter((c) => !state.jobs.includes(c.id));
    const plan = planGrowth(b, b.level + 1, [...state.roads, ...state.rails, ...state.canals], state.buildings, depthGrid(finishedCanals), state.cables);
    if (plan.problem) {
      set({ notice: plan.problem });
      return;
    }
    const gone = new Set(plan.demolish);
    set({
      buildings: state.buildings.filter((x) => !gone.has(x.id)).map((x) => (x.id === id ? plan.building : x)),
      money: state.money - (privately ? 0 : cost),
      mayor: privately ? spend(state.mayor, cost, false) : state.mayor,
      notice: `Ausgebaut: ${levelName(plan.building)}${gone.size > 0 ? ` – ${gone.size} ${gone.size === 1 ? "Haus" : "Häuser"} abgerissen` : ""}`,
      history: [...state.history, snapshot(state)].slice(-HISTORY_LIMIT),
    });
  },

  demolish: (id) => {
    const state = get();
    set({
      buildings: state.buildings.filter((b) => b.id !== id),
      cables: state.cables.filter((c) => c.id !== id),
      // Goods of a demolished warehouse and the fleet of a demolished harbour are gone.
      storage: id in state.storage ? Object.fromEntries(Object.entries(state.storage).filter(([k]) => k !== id)) : state.storage,
      ships: state.ships.some((sh) => sh.harbour === id) ? state.ships.filter((sh) => sh.harbour !== id) : state.ships,
      // Trains of a demolished signal box are scrapped.
      trains: state.trains.some((t) => t.depot === id) ? state.trains.filter((t) => t.depot !== id) : state.trains,
      // A fire in a demolished house is out; a demolished station's vehicles are recalled.
      incidents: state.incidents
        .filter((i) => i.building !== id)
        .map((i) => (i.station === id ? { ...i, station: null, onSite: false } : i)),
      selected: null,
      history: [...state.history, snapshot(state)].slice(-HISTORY_LIMIT),
    });
  },

  tickAsync: async () => {
    const state = get();
    const mode = simState();
    // Worker still busy with the last tick (slow machine): skip, the clock just runs slower.
    if (mode === "busy") return;
    if (mode === "sync") {
      get().tick();
      requestAnimationFrame(() => window.setTimeout(() => get().growStep(), 0));
      return;
    }
    const worldOf = (s: CityState): SimWorld => ({ seed: s.seed, roads: s.roads, rails: s.rails, canals: s.canals, cables: s.cables, jobs: s.jobs, buildings: s.buildings });
    const harbourWater = harbourStatus(state.buildings, depthGrid(state.canals.filter((c) => !state.jobs.includes(c.id))));
    const economy = await requestSim(worldOf(state), {
      taxRate: state.taxRate,
      businessTaxRate: state.businessTaxRate,
      storage: state.storage,
      shipUpkeep: shipUpkeep(state.ships),
      harbourWater,
    });
    // A new world was started or loaded meanwhile: this result belongs to the old one.
    if (get().worldVersion !== state.worldVersion) return;
    if (!economy) {
      get().tick();
      return;
    }
    get().tick(economy);
    // Growth: as many new houses as the speed allows, also in the worker.
    const s = get();
    const permits: Permits = s.buildings.some((b) => b.kind === "townhall") ? s.permits : "all";
    if (s.speed === 0 || permits === "none" || s.growthPoints < GROWTH_STEP || simState() !== "ready") return;
    const asked = s.growthPoints;
    const grown = await requestGrow(worldOf(s), { growthPoints: asked, permits, minutes: s.gameMinutes, speed: s.speed });
    const now = get();
    if (!grown || now.worldVersion !== s.worldVersion) return;
    if (now.buildings !== s.buildings) {
      // The player built or demolished something meanwhile: drop this step (the points stay).
      if (grown.added.length + grown.changed.length > 0) buildingsDropped();
      return;
    }
    let buildings = s.buildings;
    if (grown.added.length + grown.changed.length > 0) {
      const changed = new Map(grown.changed.map((b) => [b.id, b]));
      buildings = [...(changed.size > 0 ? s.buildings.map((b) => changed.get(b.id) ?? b) : s.buildings), ...grown.added];
      buildingsSynced(buildings);
    }
    set({
      buildings,
      growthPoints: now.growthPoints + (grown.growthPoints - asked),
      notice: grown.event && !now.tool && !now.placing ? grown.event : now.notice,
    });
  },

  tick: (precomputed) => {
    const state = get();
    lastTickAt = performance.now();
    // All roads count for supply: the construction animation is only visual (a new street
    // merged into an existing one must not cut the town off while it is being built).
    const done = state.roads;
    const harbourWater = timed("tick: Hafenwasser", () => harbourStatus(state.buildings, depthGrid(state.canals.filter((c) => !state.jobs.includes(c.id)))));
    const base = precomputed ?? timed("tick: simulate", () => simulate(state.buildings, done, state.taxRate, state.businessTaxRate, state.cables, state.canals, state.storage, shipUpkeep(state.ships), harbourWater));
    // Railway: fares and freight in, train upkeep out; a served station network attracts a few more people.
    const finishedRails = state.rails.filter((r) => !state.jobs.includes(r.id));
    const rail = timed("tick: Bahn", () => railEconomy(state.buildings, finishedRails, state.trains, base.residents));
    const withRail: EconomyStats =
      rail.income > 0 || rail.upkeep > 0 || Object.keys(rail.stations).length > 0 || Object.keys(rail.depots).length > 0
        ? {
            ...base,
            rail,
            balance: base.balance + rail.income - rail.upkeep,
            income: base.income + rail.income,
            upkeep: base.upkeep + rail.upkeep,
            immigration: base.immigration * (0.97 + 0.06 * rail.transit),
            budget: {
              ...base.budget,
              rail: rail.income,
              services: rail.upkeep > 0 ? { ...base.budget.services, traindepot: (base.budget.services.traindepot ?? 0) + rail.upkeep } : base.budget.services,
            },
          }
        : base;
    // The mayor: salary and favours leave the balance, a scandal keeps people away.
    const economy = applyMayor(withRail, state.mayor, state.gameMinutes);
    // Paused: keep the readings fresh, but no time passes and no money flows.
    if (state.speed === 0) {
      set({ economy });
      return;
    }
    // The town grows by itself from births and immigration.
    let growthPoints = state.growthPoints + (economy.births + economy.immigration) * state.speed;
    let buildings = state.buildings;
    let notice = state.notice;
    // Permits only bind while a town hall stands (without one, nobody can stop the builders).
    const permits: Permits = state.buildings.some((b) => b.kind === "townhall") ? state.permits : "all";
    if (permits === "none") growthPoints = Math.min(growthPoints, GROWTH_STEP);
    // New houses are built in `growStep`, in its own task after this tick (see CityBuilder),
    // as many as the speed allows: a blocked search waits a few ticks.
    if (growthBlocked) growthBlocked.ticks--;
    buildings = timed("tick: Verfall", () => decay(buildings, economy, growthRnd, state.speed)) ?? buildings;
    // Accidents and fires: new ones start, unattended ones end badly.
    const incidentStep = timed("tick: Einsätze", () => stepIncidents(state.incidents, buildings, done.filter((r) => !state.jobs.includes(r.id)), economy, state.gameMinutes, state.speed, incidentRnd, () => newId("road").replace("road", "incident"), state.incidentLastAt));
    buildings = incidentStep.buildings;
    if (incidentStep.notice && !state.tool && !state.placing) notice = incidentStep.notice;
    const { loans, paid } = payLoans(state.loans, state.speed);
    // Warehouses fill with the surplus (up to their capacity), ships take it away.
    let storage = state.storage;
    if (Object.keys(economy.storageIn).length > 0) {
      storage = { ...storage };
      for (const [id, goods] of Object.entries(economy.storageIn)) {
        const w = buildings.find((b) => b.id === id);
        if (!w) continue;
        const cur = { ...storage[id] };
        let room = Math.max(0, warehouseCapacity(w) - storedTotal(cur));
        for (const [g, v] of Object.entries(goods) as [Good, number][]) {
          // Rates are per HUD minute like money (balance / 60 per game minute).
          const put = Math.min(room, (v / 60) * state.speed);
          cur[g] = (cur[g] ?? 0) + put;
          room -= put;
        }
        storage[id] = cur;
      }
    }
    // Import-export companies hand out what the factories took from their store; cargo
    // planes take goods out of the warehouses.
    const taken = [...Object.entries(economy.importOut), ...Object.entries(economy.airOut ?? {})];
    if (taken.length > 0) {
      storage = storage === state.storage ? { ...storage } : storage;
      for (const [id, goods] of taken) {
        if (Object.keys(goods).length === 0) continue;
        const cur = { ...storage[id] };
        for (const [g, v] of Object.entries(goods) as [Good, number][]) cur[g] = Math.max(0, (cur[g] ?? 0) - (v / 60) * state.speed);
        storage[id] = cur;
      }
    }
    const shipping = timed("tick: Schiffe", () => stepShips(state.ships, buildings, storage, economy.networkOf, state.speed, harbourWater, economy.importOrders));
    storage = shipping.storage;
    const mayorStep = stepMayor(state.mayor, economy, buildings, state.gameMinutes, state.speed, mayorRnd, () => newId("road").replace("road", "offer"));
    if (mayorStep.notice) notice = mayorStep.notice;
    // Arrested: the villa goes to the state.
    if (mayorStep.confiscateVilla) buildings = buildings.filter((b) => !MAYOR_PRIVATE.includes(b.kind));
    const money = state.money + (economy.balance / 60) * state.speed - paid + shipping.revenue + mayorStep.seized;
    const gameMinutes = state.gameMinutes + state.speed;
    if (loans.length < state.loans.length && !state.tool && !state.placing) notice = "Ein Kredit ist vollständig zurückgezahlt";
    // A trend sample every STAT_INTERVAL game minutes.
    let stats = state.stats;
    if (Math.floor(gameMinutes / STAT_INTERVAL) !== Math.floor(state.gameMinutes / STAT_INTERVAL)) {
      const mood = moodOf(moodFactors(economy));
      const b = economy.budget;
      const income = b.incomeTax + b.businessTax + b.propertyTax + b.waterFees + b.powerFees + (b.airport ?? 0) + (b.emergency ?? 0) + (b.rail ?? 0) + (b.justice ?? 0);
      const sample: StatSample = { t: gameMinutes, money, residents: economy.residents, balance: economy.balance - loanPayments(loans), mood, income };
      stats = [...stats, sample].slice(-STAT_LIMIT);
    }
    if (shipping.event && !state.tool && !state.placing) notice = shipping.event;
    const shipSales =
      shipping.sales.length > 0
        ? [...state.shipSales, ...shipping.sales.map((x) => ({ ...x, t: gameMinutes }))].filter((x) => x.t > gameMinutes - SALE_WINDOW)
        : state.shipSales;
    // The smelters' leftover bars go into the vault (paid in the balance like warehouse purchases).
    const gold = state.gold + ((economy.goldIn ?? 0) / 60) * state.speed;
    // Newspaper: note what happened since the last tick; a connected newspaper prints an edition every game day.
    const snap = newsSnapshot(buildings, incidentStep.incidents, mayorStep.mayor, economy.residents, gameMinutes);
    const happened = lastNews ? collectNews(lastNews, snap, gameMinutes) : [];
    lastNews = snap;
    let newsLog = state.newsLog;
    if (happened.length > 0 || newsLog.some((e) => e.t < gameMinutes - 2 * 1440)) newsLog = [...newsLog.filter((e) => e.t >= gameMinutes - 2 * 1440), ...happened];
    let newspapers = state.newspapers;
    const press = buildings.find((b) => b.kind === "newspaper");
    const day = Math.floor(gameMinutes / 1440);
    const printing = press && economy.status[press.id]?.connected && (Math.floor(state.gameMinutes / 1440) < day || newspapers.length === 0);
    if (printing) {
      // The first edition comes out right away (with the last day's news), then one each morning.
      const since = newspapers[0]?.printedAt ?? gameMinutes - 1440;
      const edition = makeEdition(since, newsLog, { economy, mayor: mayorStep.mayor, buildings, money, now: gameMinutes });
      newspapers = [edition, ...newspapers].slice(0, 10);
      if (!state.tool && !state.placing) notice = `Die neue ${PAPER_NAME} ist da: „${edition.headline.title}“`;
    }
    set({ economy, buildings, growthPoints, notice, money, gameMinutes, loans, stats, storage, ships: shipping.ships, shipSales, gold, incidents: incidentStep.incidents, incidentLastAt: incidentStep.lastAt, mayor: mayorStep.mayor, newsLog, newspapers });
  },

  setSalary: (salary) => set((s) => jailed(s.mayor, s.gameMinutes) ? {} : ({ mayor: { ...s.mayor, salary: Math.max(0, Math.min(SALARY_MAX, Math.round(salary))) } })),
  acceptBribe: (id) => {
    const state = get();
    const done = acceptOffer(state.mayor, id, state.gameMinutes);
    if (!done) return;
    set({
      mayor: done.mayor,
      money: state.money - done.townCost,
      growthPoints: state.growthPoints + done.growthPoints,
      notice: `${OFFER_LABEL[done.offer.kind]} angenommen: +${done.offer.amount.toLocaleString("de-DE")} € aufs Privatkonto${done.townCost > 0 ? ` (die Stadt zahlt ${done.townCost.toLocaleString("de-DE")} €)` : ""}`,
    });
  },
  repayCity: (amount) => {
    const state = get();
    const done = repayTown(state.mayor, amount, state.economy?.residents ?? 0, state.gameMinutes);
    if (done.paid <= 0) return;
    set({
      mayor: done.mayor,
      money: state.money + done.paid,
      notice: `${Math.round(done.paid).toLocaleString("de-DE")} € an die Stadt zurückgegeben – das Ansehen steigt${done.cut > 0 ? `, der Skandal ist ${Math.round(done.cut * 100)} % kürzer` : ""}`,
    });
  },
  readNewspaper: () => set((s) => ({ newsRead: s.newspapers[0]?.day ?? s.newsRead })),
  setLaundering: (building, on) => {
    const state = get();
    if (jailed(state.mayor, state.gameMinutes)) return;
    const b = state.buildings.find((x) => x.id === building);
    set({
      mayor: setFront(state.mayor, building, on),
      notice: b ? (on ? `${levelName(b)} wäscht ab jetzt Schwarzgeld des Bürgermeisters` : `${levelName(b)} wäscht kein Geld mehr`) : null,
    });
  },
  setProtection: (building, share) => {
    const state = get();
    if (jailed(state.mayor, state.gameMinutes)) return;
    const b = state.buildings.find((x) => x.id === building);
    set({
      mayor: setRacket(state.mayor, building, share),
      notice: b ? (share > 0 ? `Schutzgeld: ${levelName(b)} zahlt ab jetzt ${Math.round(share * 100)} % vom Gewinn` : `${levelName(b)} zahlt kein Schutzgeld mehr`) : null,
    });
  },
  playRoulette: (bet, stake) => {
    const state = get();
    if (jailed(state.mayor, state.gameMinutes) || !state.buildings.some((b) => b.kind === "casino")) return null;
    if (stake <= 0 || stake > state.mayor.account) {
      set({ notice: "Nicht genug auf dem Privatkonto für diesen Einsatz" });
      return null;
    }
    const n = Math.floor(rouletteRnd() * 37);
    const payout = payoutOf(bet, n, stake);
    const spin: RouletteSpin = { n, bet, stake, payout };
    set({
      // Stakes come out of the dirty money first; winnings are paid out clean (a way to launder, at the house edge).
      mayor: (() => {
        const paid = spend(state.mayor, stake, true);
        return { ...paid, account: paid.account + payout };
      })(),
      // No ticker message: the panel reveals the number after the ball has run.
      rouletteHistory: [spin, ...state.rouletteHistory].slice(0, 12),
    });
    return spin;
  },
  declineBribe: (id) => set((s) => ({ mayor: { ...s.mayor, offers: s.mayor.offers.filter((o) => o.id !== id) } })),
  embezzle: (amount) => {
    const state = get();
    if (jailed(state.mayor, state.gameMinutes)) return;
    const n = Math.min(amount, Math.max(0, state.money));
    if (n <= 0) {
      set({ notice: "In der Stadtkasse ist nichts zu holen" });
      return;
    }
    set({
      money: state.money - n,
      mayor: {
        ...state.mayor,
        account: state.mayor.account + n,
        dirty: state.mayor.dirty + n,
        taken: state.mayor.taken + n,
        suspicion: Math.min(100, state.mayor.suspicion + embezzleSuspicion(n, state.economy?.residents ?? 0)),
      },
      notice: `${n.toLocaleString("de-DE")} € aus der Stadtkasse aufs Privatkonto umgebucht`,
    });
  },

  raiseAlarm: (id) => {
    const state = get();
    const inc = state.incidents.find((i) => i.id === id);
    if (!inc || !state.economy) return;
    const needsStation = !inc.station;
    const needsAmbulance = !!inc.injured && !inc.ambulance && !inc.ambulanceDone;
    if (!needsStation && !needsAmbulance) return;
    const main = needsStation ? dispatch(inc, state.buildings, state.incidents, state.economy) : null;
    const amb = needsAmbulance ? dispatchAmbulance(inc, state.buildings, state.incidents, state.economy) : null;
    const station = main?.station ?? inc.station;
    const ambulance = amb?.hospital ?? inc.ambulance ?? null;
    // A fire: the police comes along to close the street (if a patrol car is free), only once the fire brigade goes.
    const pol = inc.kind === "fire" && main?.station && !inc.police ? dispatchPolice(inc, state.buildings, state.incidents, state.economy) : null;
    const police = pol?.station ?? inc.police ?? null;
    const parts: string[] = [];
    if (main) parts.push(main.station ? (inc.kind === "accident" ? "Streifenwagen unterwegs" : "Feuerwehr rückt aus") : `${inc.kind === "accident" ? "Polizei" : "Feuerwehr"}: ${main.reason}`);
    if (pol) parts.push(pol.station ? "Polizei sperrt die Straße" : `Polizei: ${pol.reason}`);
    if (amb) parts.push(amb.hospital ? "Krankenwagen unterwegs" : `Krankenwagen: ${amb.reason}`);
    set({
      incidents: state.incidents.map((i) => (i.id === id ? { ...i, station, ambulance, police } : i)),
      notice: `${main?.station || amb?.hospital ? "Alarm ausgelöst" : "Alarm ohne Erfolg"} – ${parts.join(", ")}`,
    });
  },
  flyToIncident: (id) => {
    const inc = get().incidents.find((i) => i.id === id);
    if (!inc) return;
    set((s) => ({ focus: { x: inc.x, z: inc.z, n: (s.focus?.n ?? 0) + 1 } }));
  },

  growStep: () => {
    const state = get();
    if (state.speed === 0 || !state.economy) return;
    const permits: Permits = state.buildings.some((b) => b.kind === "townhall") ? state.permits : "all";
    if (permits === "none") return;
    const done = state.roads;
    let { growthPoints, buildings, notice } = state;
    const finishedCanals = state.canals.filter((c) => !state.jobs.includes(c.id));
    const grid = depthGrid(finishedCanals);
    const others = [...done, ...state.rails, ...state.canals];
    const deadline = performance.now() + GROW_SLICE_MS;
    // Up to `speed` new houses per tick (plus a little catch-up), within a time slice.
    const maxSteps = state.speed * 2;
    let steps = 0;
    while (growthPoints >= GROWTH_STEP && steps < maxSteps && (steps === 0 || performance.now() < deadline)) {
      if (growthBlocked && growthBlocked.buildings === buildings && growthBlocked.roads === done && growthBlocked.ticks > 0) break;
      const result = timed("Wachstum (eigene Zeitscheibe)", () =>
        growOnce(buildings, done, others, grid, state.economy!, growthRnd, () => newId("road").replace("road", "building"), permits, state.gameMinutes),
      );
      steps++;
      if (result.buildings === buildings) {
        growthPoints = GROWTH_STEP; // no room: wait for new streets
        // Plots still unchecked (cold cache): try again soon, the next search may find some.
        growthBlocked = { buildings, roads: done, ticks: plotsUnchecked() > 0 ? 2 : GROWTH_RETRY };
        break;
      }
      growthPoints -= GROWTH_STEP;
      growthBlocked = null;
      buildings = result.buildings;
      if (!state.tool && !state.placing && result.event) notice = result.event;
    }
    if (buildings !== state.buildings || growthPoints !== state.growthPoints) set({ buildings, growthPoints, notice });
  },

  incidentOnSite: (id) =>
    set((s) => (s.incidents.some((i) => i.id === id && !i.onSite) ? { incidents: s.incidents.map((i) => (i.id === id ? { ...i, onSite: true } : i)) } : {})),
  resolveIncident: (id) =>
    set((s) => {
      const inc = s.incidents.find((i) => i.id === id);
      if (!inc || inc.cleared) return {};
      const fee = MISSION_FEE[inc.kind];
      const next = { ...inc, cleared: true };
      return {
        incidents: incidentDone(next) ? s.incidents.filter((i) => i.id !== id) : s.incidents.map((i) => (i.id === id ? next : i)),
        money: s.money + fee,
        notice: `${inc.kind === "accident" ? "Unfallstelle geräumt" : "Brand gelöscht"} – Einsatzgebühr +${fee.toLocaleString("de-DE")} €`,
      };
    }),
  policeDone: (id) =>
    set((s) => {
      const inc = s.incidents.find((i) => i.id === id);
      if (!inc || inc.policeDone) return {};
      const next = { ...inc, policeDone: true };
      return { incidents: incidentDone(next) ? s.incidents.filter((i) => i.id !== id) : s.incidents.map((i) => (i.id === id ? next : i)) };
    }),
  ambulanceDone: (id) =>
    set((s) => {
      const inc = s.incidents.find((i) => i.id === id);
      if (!inc || inc.ambulanceDone) return {};
      const next = { ...inc, ambulanceDone: true };
      return {
        incidents: incidentDone(next) ? s.incidents.filter((i) => i.id !== id) : s.incidents.map((i) => (i.id === id ? next : i)),
        money: s.money + MISSION_FEE.ambulance,
        notice: `Verletzte ins Krankenhaus gebracht – Krankenkasse zahlt +${MISSION_FEE.ambulance.toLocaleString("de-DE")} €`,
      };
    }),

  setSpeed: (speed) => set({ speed }),

  toggleSupply: () => set((s) => ({ showSupply: !s.showSupply })),
  togglePower: () => set((s) => ({ showPower: !s.showPower })),
  toggleWater: () => set((s) => ({ showWater: !s.showWater })),
  toggleNetworks: () => set((s) => ({ showNetworks: !s.showNetworks })),
  setHouseStyle: (houseStyle) => {
    try {
      localStorage.setItem(HOUSE_STYLE_KEY, houseStyle);
    } catch {
      /* storage unavailable: the choice lasts until reload */
    }
    set({ houseStyle });
  },
  toggleRain: () => set((s) => ({ showRain: !s.showRain })),
  toggleSnow: () =>
      set((s) => ({
        showSnow: !s.showSnow,
        showRain: s.showSnow ? s.showRain : false,
      })),

  takeLoan: (offerId) => {
    const state = get();
    const offer = LOAN_OFFERS.find((o) => o.id === offerId);
    if (!offer) return;
    if (!state.buildings.some((b) => b.kind === "bank")) {
      set({ notice: "Kredite gibt es nur mit einer Bank" });
      return;
    }
    if (debtOf(state.loans) + offer.amount > creditLimit(state.economy)) {
      set({ notice: "Kreditrahmen ausgeschöpft – die Bank leiht nicht mehr" });
      return;
    }
    set({
      loans: [...state.loans, newLoan(offer, `loan-${Date.now().toString(36)}-${(idCounter++).toString(36)}`, state.gameMinutes)],
      money: state.money + offer.amount,
      notice: `${offer.label} aufgenommen: +${offer.amount.toLocaleString("de-DE")} €`,
    });
  },

  repayLoan: (id) => {
    const state = get();
    const loan = state.loans.find((l) => l.id === id);
    if (!loan) return;
    const cost = payoffOf(loan);
    if (cost > state.money) {
      set({ notice: `Nicht genug Geld zum Ablösen (${Math.round(cost).toLocaleString("de-DE")} €)` });
      return;
    }
    set({
      loans: state.loans.filter((l) => l.id !== id),
      money: state.money - cost,
      notice: `${loan.label} abgelöst (−${Math.round(cost).toLocaleString("de-DE")} €)`,
    });
  },

  setPanel: (panel) => set({ panel }),
  setPermits: (permits) => set({ permits }),

  bulldoze: (p) => {
    const state = get();
    // Fire ruins go first: one click clears the plot for new houses.
    const ruin = state.buildings.find((b) => b.kind === "ruin" && insideFootprint(b, p.x, p.z, 1));
    if (ruin) {
      get().demolish(ruin.id);
      set({ notice: "Brandruine abgerissen – das Grundstück wird wieder bebaut" });
      return;
    }
    const target = bulldozeTarget(p, state);
    if (!target) {
      set({ notice: "Hier ist nichts zum Abreißen – Straße, Gleis, Kanal, Stromleitung oder Brandruine anklicken" });
      return;
    }
    const key = target.network;
    const list = state[key] as Path[];
    const path = list.find((x) => x.id === target.id)!;
    const parts = splitOut(path, target.segment, `${path.id.split("-")[0]}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`);
    const rest = list.filter((x) => x.id !== path.id).concat(parts);
    // Crossing decisions follow the pieces that are left.
    const separations: Separations = {};
    for (const [k, v] of Object.entries(state.separations)) {
      const [a, b] = k.split("|");
      for (const part of parts) {
        if (a === path.id || b === path.id) {
          const other = a === path.id ? b : a;
          separations[pairKey(part.id, other)] = v === path.id ? part.id : v;
        }
      }
      if (a !== path.id && b !== path.id) separations[k] = v;
    }
    const wasJob = state.jobs.includes(path.id);
    set({
      [key]: rest,
      separations,
      jobs: [...state.jobs.filter((j) => j !== path.id), ...(wasJob ? parts.map((x) => x.id) : [])],
      notice: `${target.label} abgerissen (${Math.round(target.length)} m)`,
      history: [...state.history, snapshot(state)].slice(-HISTORY_LIMIT),
    } as Partial<CityState>);
  },

  buyShip: (harbourId, typeId) => {
    const state = get();
    const type = shipType(typeId);
    const fleet = state.ships.filter((sh) => sh.harbour === harbourId);
    if (!state.buildings.some((b) => b.id === harbourId && b.kind === "harbour")) return;
    if (fleet.length >= HARBOUR_BERTHS) {
      set({ notice: `Alle ${HARBOUR_BERTHS} Liegeplätze belegt – zweiten Hafen bauen` });
      return;
    }
    if (type.cost > state.money) {
      set({ notice: `Nicht genug Geld (${type.cost.toLocaleString("de-DE")} € nötig)` });
      return;
    }
    const ship = newShip(type, harbourId, `ship-${Date.now().toString(36)}-${(idCounter++).toString(36)}`, state.ships);
    set({ ships: [...state.ships, ship], money: state.money - type.cost, notice: `${type.label} „${ship.name}“ gekauft` });
  },

  buyTrain: (depotId, typeId) => {
    const state = get();
    const type = trainType(typeId);
    const depot = state.buildings.find((b) => b.id === depotId && b.kind === "traindepot");
    if (!depot) return;
    const fleet = state.trains.filter((t) => t.depot === depotId);
    if (fleet.length >= depotSlots(depot)) {
      set({ notice: `Alle ${depotSlots(depot)} Abstellgleise belegt – Stellwerk ausbauen` });
      return;
    }
    if (type.cost > state.money) {
      set({ notice: `Nicht genug Geld (${type.cost.toLocaleString("de-DE")} € nötig)` });
      return;
    }
    const train = newTrain(type, depotId, `train-${Date.now().toString(36)}-${(idCounter++).toString(36)}`, state.trains);
    set({ trains: [...state.trains, train], money: state.money - type.cost, notice: `${type.label} „${train.name}“ gekauft` });
  },
  sellTrain: (id) => {
    const state = get();
    const train = state.trains.find((t) => t.id === id);
    if (!train) return;
    const back = Math.round(trainType(train.type).cost * TRAIN_RESALE);
    set({ trains: state.trains.filter((t) => t.id !== id), money: state.money + back, notice: `„${train.name}“ verkauft (+${back.toLocaleString("de-DE")} €)` });
  },

  sellShip: (id) => {
    const state = get();
    const ship = state.ships.find((sh) => sh.id === id);
    if (!ship) return;
    const back = Math.round(shipType(ship.type).cost * SHIP_RESALE);
    set({
      ships: state.ships.filter((sh) => sh.id !== id),
      money: state.money + back,
      notice: `„${ship.name}“ verkauft (+${back.toLocaleString("de-DE")} €)`,
    });
  },

  tradeGold: (n) => {
    const state = get();
    if (!state.buildings.some((b) => b.kind === "bank")) return;
    // With a Börse the bank trades at the market price, otherwise at the fixed reference price.
    const exchange = state.buildings.some((b) => b.kind === "exchange");
    if (n > 0) {
      const price = goldBuyPrice(state.gameMinutes, exchange);
      const bars = Math.min(n, Math.floor(state.money / price));
      if (bars <= 0) return set({ notice: "Nicht genug Geld für einen Goldbarren" });
      set({ money: state.money - bars * price, gold: state.gold + bars, notice: `${bars.toLocaleString("de-DE")} Goldbarren gekauft (−${(bars * price).toLocaleString("de-DE")} €)` });
    } else {
      const bars = Math.min(-n, Math.floor(state.gold + 1e-6));
      if (bars <= 0) return;
      const price = goldSellPrice(state.gameMinutes, exchange);
      set({ money: state.money + bars * price, gold: Math.max(0, state.gold - bars), notice: `${bars.toLocaleString("de-DE")} Goldbarren verkauft (+${(bars * price).toLocaleString("de-DE")} €)` });
    }
  },

  cheatMoney: (amount) =>
    set((s) => ({ money: s.money + amount, notice: `Admin: +${amount.toLocaleString("de-DE")} €` })),

  setTaxRate: (rate) =>
    set({ taxRate: Math.round(Math.min(TAX_MAX, Math.max(TAX_MIN, rate)) * 100) / 100 }),
  setBusinessTaxRate: (rate) =>
    set({ businessTaxRate: Math.round(Math.min(BUSINESS_TAX_MAX, Math.max(BUSINESS_TAX_MIN, rate)) * 100) / 100 }),

  buildTrumpet: (p) => {
    const state = get();
    const finishedCanals = state.canals.filter((c) => !state.jobs.includes(c.id));
    const plan = planTrumpet(p, state.roads, depthGrid(finishedCanals), [...state.rails, ...state.canals]);
    if (!plan) {
      set({
        notice:
          "Hier passt kein Autobahndreieck (eine Autobahn muss an einer anderen enden; je ca. 200 m Platz, kein Wasser)",
      });
      return;
    }
    const ramps: Road[] = plan.ramps.map((points) => ({ id: newId("road"), kind: "ramp", points }));
    const roads = state.roads.map((r) => (r.id === plan.b.id ? plan.stem : r));
    set({
      roads: [...roads, ...ramps],
      separations: { ...state.separations, ...trumpetSeparations(ramps.map((r) => r.id), plan.over) },
      jobs: [...state.jobs, ...ramps.map((r) => r.id)],
      notice: "Autobahndreieck (Trompete) gebaut",
      history: [...state.history, snapshot(state)].slice(-HISTORY_LIMIT),
    });
  },

  buildCloverleaf: (p) => {
    const state = get();
    const finishedCanals = state.canals.filter((c) => !state.jobs.includes(c.id));
    const grid = depthGrid(finishedCanals);
    const obstacles = [...state.rails, ...state.canals];
    // At an existing motorway crossing, or as a prefab placed onto a single motorway (it
    // then brings its own crossing motorway).
    const plan =
      planCloverleaf(p, state.roads, state.separations, grid, obstacles) ??
      planCloverleafPrefab(p, state.roads, state.separations, grid, obstacles, newId("road"));
    if (!plan) {
      set({ notice: "Setze das Autobahnkreuz auf eine Autobahn" });
      return;
    }
    if (plan.problem) {
      set({ notice: plan.problem });
      return;
    }
    const ramps: Road[] = plan.ramps.map((points) => ({ id: newId("road"), kind: "ramp", points }));
    const ref = (x: number | string) => (typeof x === "number" ? ramps[x].id : x);
    const separations = { ...state.separations };
    for (const [hi, lo] of plan.over) separations[pairKey(ref(hi), ref(lo))] = ref(hi);
    const built: Road[] = [...ramps];
    if (plan.newMotorway) {
      built.unshift(plan.newMotorway);
      // The new motorway bridges the existing one.
      separations[pairKey(plan.newMotorway.id, plan.a.id)] = plan.newMotorway.id;
    }
    set({
      roads: [...state.roads, ...built],
      separations,
      jobs: [...state.jobs, ...built.map((r) => r.id)],
      notice: "Autobahnkreuz gebaut",
      history: [...state.history, snapshot(state)].slice(-HISTORY_LIMIT),
    });
  },


  buildInterchange: (p) => {
    const state = get();
    const finishedCanals = state.canals.filter((c) => !state.jobs.includes(c.id));
    const grid = depthGrid(finishedCanals);
    const profiles = computeProfiles([...state.roads, ...state.rails], grid, state.separations);
    const plan = planInterchange(p, state.roads, profiles, state.separations, grid, [...state.rails, ...state.canals]);
    if (!plan) {
      set({ notice: "Keine Autobahn-Überführung einer Straße in der Nähe" });
      return;
    }
    let roads = state.roads;
    const created: string[] = [];
    for (const points of plan.ramps) {
      // Ramps join the street at a T-junction and nothing else.
      const { roads: connected, created: ramp } = connectRoads<Road>(
        roads,
        { id: newId("road"), kind: "ramp", points },
        (other) => other.id === plan.street.id || other.kind === "street",
      );
      if (!ramp) continue;
      roads = [...connected, ramp];
      created.push(ramp.id);
    }
    set({
      roads,
      jobs: [...state.jobs, ...created],
      notice: `Anschlussstelle mit ${created.length} Rampen gebaut`,
      history: [...state.history, snapshot(state)].slice(-HISTORY_LIMIT),
    });
  },

  setCursor: (p, join = null) => set({ cursor: p, cursorJoin: p ? join : null }),

  addPoint: (p) => {
    const { draft, tool } = get();
    if (!tool) return;
    if (tool === "interchange") {
      get().buildInterchange(p);
      return;
    }
    if (tool === "cloverleaf") {
      get().buildCloverleaf(p);
      return;
    }
    if (tool === "trumpet") {
      get().buildTrumpet(p);
      return;
    }
    if (tool === "bulldoze") {
      get().bulldoze(p);
      return;
    }
    const last = draft[draft.length - 1];
    if (last && last.x === p.x && last.z === p.z) return;
    // Points the join check refuses (overlap, acute angle) are not placed.
    if (isPathTool(tool)) {
      const joinable = pathsFor(get(), tool).filter((o) => joinsAtGrade(get().crossingMode, tool, o.kind));
      const check = checkPoint(p, joinable, last, tool);
      if (check.state === "blocked") {
        if (check.reason) set({ notice: check.reason });
        return;
      }
    }
    set({ draft: [...draft, p] });
  },

  removeLastPoint: () => set((s) => ({ draft: s.draft.slice(0, -1) })),

  cancelDraft: () => set({ draft: [] }),

  finishDraft: () => {
    const state = get();
    const { draft, tool, jobs, history, crossingMode } = state;
    if (tool === "cable") {
      if (draft.length < 2) {
        set({ draft: [] });
        return;
      }
      const cost = Math.round(polylineLength(draft) * CABLE_COST_PER_M);
      if (cost > state.money) {
        set({ notice: `Nicht genug Geld für das Kabel (${cost.toLocaleString("de-DE")} €)` });
        return;
      }
      const cable: Cable = { id: `cable-${Date.now().toString(36)}-${(idCounter++).toString(36)}`, points: draft };
      set({
        cables: [...state.cables, cable],
        money: state.money - cost,
        draft: [],
        notice: `Stromleitung gebaut (−${cost.toLocaleString("de-DE")} €)`,
        history: [...history, snapshot(state)].slice(-HISTORY_LIMIT),
      });
      return;
    }
    if (!isPathTool(tool) || draft.length < 2) {
      set({ draft: [] });
      return;
    }
    const network = NETWORK_OF[tool];
    const key = NETWORK_KEY[network];
    // Canals are dug at sea level: in the lowland (gentle rises get a cutting), not into hills.
    if (network === "water" && draftClimbs(draft)) {
      set({ draft: [], notice: `Kanäle nur im Flachland (Gelände bis ${CANAL_MAX_CUT} m hoch, dort im Einschnitt) – hier ist es zu hoch` });
      return;
    }
    // Nothing is built through a building: houses make way, anything else blocks the path.
    const hit = buildingsOnPath(draft, OUTER_HALF_WIDTH[tool], state.buildings);
    const blocker = hit.find((b) => b.kind !== "house");
    if (blocker) {
      set({ notice: `${BUILD_LABEL[tool]} führt durch ${levelName(blocker)} – anders führen oder das Gebäude erst abreißen` });
      return;
    }
    const cleared = hit.length > 0 ? state.buildings.filter((b) => !hit.includes(b)) : state.buildings;
    // Snap to and split existing paths of the same network, add nodes at crossings.
    const { roads: connected, created } = connectRoads<Path>(
      state[key],
      { id: newId(network), kind: tool, points: draft },
      (other) => joinsAtGrade(crossingMode, tool, other.kind),
      (other) => crossingMode === "auto" && crossesLevel(tool, other.kind),
    );
    if (!created) {
      set({ draft: [] });
      return;
    }
    // An L-corner or straight continuation with a path of the same kind becomes one path.
    const joined = mergeEnds(connected, created);
    const finalList = joined.list;
    const finalPath = joined.created;
    // Record who goes over at every crossing that is not at grade.
    const separations: Separations = {};
    for (const [k, v] of Object.entries(state.separations)) {
      const [a, b] = k.split("|").map((id) => (joined.merged.includes(id) ? finalPath.id : id));
      if (a !== b) separations[pairKey(a, b)] = joined.merged.includes(v) ? finalPath.id : v;
    }
    const others = [...state.roads, ...state.rails].filter(
      (p) => p.id !== finalPath.id && !joined.merged.includes(p.id),
    );
    if (network !== "water") {
      for (const c of findCrossings([finalPath], others)) {
        const other = others.find((o) => o.id === c.b);
        if (!other) continue;
        const atGrade = crossingMode === "auto" && crossesLevel(tool, other.kind);
        if (atGrade) continue;
        // Shared end points are junctions, not crossings.
        const shared = [finalPath, other].every((p) => p.points.some((q) => Math.hypot(q.x - c.x, q.z - c.z) < 0.5));
        if (shared) continue;
        const k = pairKey(finalPath.id, other.id);
        // Keep earlier decisions for the merged-in part of the path.
        if (!(k in separations)) separations[k] = crossingMode === "under" ? other.id : finalPath.id;
      }
    }
    const built = {
      list: [...finalList, finalPath] as Path[],
      separations,
      jobs: [...jobs.filter((j) => !joined.merged.includes(j)), finalPath.id],
    };
    // Streets: junctions always at path ends (no corner rounded across a junction).
    const clean = key === "roads" ? cleanJunctions(built.list as Road[], built.separations, built.jobs) : null;
    set({
      buildings: cleared,
      notice: hit.length > 0 ? `${hit.length === 1 ? "1 Haus" : `${hit.length} Häuser`} für den Weg abgerissen` : state.notice,
      [key]: clean ? clean.roads : built.list,
      separations: clean ? clean.separations : built.separations,
      jobs: clean ? clean.jobs : built.jobs,
      jobOffsets:
        joined.builtPrefix && !jobs.includes(joined.builtPrefix.id)
          ? { ...state.jobOffsets, [finalPath.id]: polylineLength(joined.builtPrefix.points) }
          : state.jobOffsets,
      draft: [],
      history: [...history, snapshot(state)].slice(-HISTORY_LIMIT),
    } as Partial<CityState>);
  },

  undo: () => {
    const { draft, history, jobs } = get();
    if (draft.length > 0) {
      set({ draft: draft.slice(0, -1) });
      return;
    }
    const prev = history[history.length - 1];
    if (!prev) return;
    const ids = new Set([...prev.roads, ...prev.rails, ...prev.canals].map((p) => p.id));
    // Villa and boathouse were paid privately: undoing their construction or upgrade refunds the account.
    const refund = villaValue(get().buildings) - villaValue(prev.buildings);
    set({
      ...prev,
      mayor: refund !== 0 ? { ...get().mayor, account: get().mayor.account + refund } : get().mayor,
      history: history.slice(0, -1),
      jobs: jobs.filter((id) => ids.has(id)),
    });
  },

  finishJob: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j !== id) })),

  cycleCrossingMode: () =>
    set((s) => ({
      crossingMode: s.crossingMode === "auto" ? "over" : s.crossingMode === "over" ? "under" : "auto",
    })),
}));
