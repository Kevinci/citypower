/// <reference lib="webworker" />
import { simulate, type Building, type EconomyStats, type Storage } from "./economy";
import { GROWTH_STEP, growOnce, plotsUnchecked, type Permits } from "./growth";
import { mulberry32 } from "./random";
import { depthGrid, setWorldSeed } from "./terrain";
import type { Cable, Canal, Path, Rail, Road } from "./types";

/**
 * Simulation worker: the economy step (`simulate`) and the town growth (`growOnce`) run here,
 * off the main thread. The worker keeps its own copy of the world; the main thread sends only
 * what changed (see sim-client.ts). Buildings are reconciled by value so unchanged ones keep
 * their object identity – the caches of the economy and the plot search key on it.
 */

export interface WorldPatch {
  seed?: number;
  roads?: Road[];
  rails?: Rail[];
  canals?: Canal[];
  cables?: Cable[];
  jobs?: string[];
  buildings?: Building[];
}
export type SimRequest =
  | {
      type: "sim";
      id: number;
      world: WorldPatch;
      taxRate: number;
      businessTaxRate: number;
      storage: Storage;
      shipUpkeep: Record<string, number>;
      harbourWater: Record<string, string | null>;
    }
  | { type: "grow"; id: number; world: WorldPatch; growthPoints: number; permits: Permits; minutes: number; speed: number };
export type SimResponse =
  | { type: "sim"; id: number; economy: EconomyStats; ms: number }
  | {
      type: "grow";
      id: number;
      /** New houses and houses that changed (upgrades), in order. */
      added: Building[];
      changed: Building[];
      growthPoints: number;
      event: string | null;
      ms: number;
    };

const world = { seed: NaN, roads: [] as Road[], rails: [] as Rail[], canals: [] as Canal[], cables: [] as Cable[], jobs: [] as string[], buildings: [] as Building[] };
let economy: EconomyStats | null = null;
let finishedCanals: { canals: Canal[]; jobs: string[]; out: Canal[] } | null = null;
let others: { roads: Road[]; rails: Rail[]; canals: Canal[]; out: Path[] } | null = null;
let blocked: { buildings: Building[]; roads: Road[]; ticks: number } | null = null;
const rnd = mulberry32(Date.now() & 0xffff);
let idCounter = 0;
/** Same rules as the store's growStep. */
const GROWTH_RETRY = 15;
const GROW_SLICE_MS = 30;

const same = (a: Building, b: Building) =>
  a.kind === b.kind && a.x === b.x && a.z === b.z && a.rot === b.rot && a.level === b.level && a.variant === b.variant;

/** The main thread's list with the worker's own objects wherever nothing changed. */
function reconcile(next: Building[]): Building[] {
  const old = new Map(world.buildings.map((b) => [b.id, b]));
  let unchanged = next.length === world.buildings.length;
  const out = next.map((b, i) => {
    const o = old.get(b.id);
    if (o && same(o, b)) {
      if (world.buildings[i] !== o) unchanged = false;
      return o;
    }
    unchanged = false;
    return b;
  });
  return unchanged ? world.buildings : out;
}

function apply(patch: WorldPatch) {
  if (patch.seed !== undefined && patch.seed !== world.seed) {
    world.seed = patch.seed;
    setWorldSeed(patch.seed);
    economy = null;
    blocked = null;
  }
  if (patch.roads) world.roads = patch.roads;
  if (patch.rails) world.rails = patch.rails;
  if (patch.canals) world.canals = patch.canals;
  if (patch.cables) world.cables = patch.cables;
  if (patch.jobs) world.jobs = patch.jobs;
  if (patch.buildings) world.buildings = reconcile(patch.buildings);
}

function grow(req: Extract<SimRequest, { type: "grow" }>): Omit<Extract<SimResponse, { type: "grow" }>, "id" | "ms" | "type"> {
  let { growthPoints } = req;
  const before = world.buildings;
  let event: string | null = null;
  if (economy && req.permits !== "none") {
    if (!finishedCanals || finishedCanals.canals !== world.canals || finishedCanals.jobs !== world.jobs)
      finishedCanals = { canals: world.canals, jobs: world.jobs, out: world.canals.filter((c) => !world.jobs.includes(c.id)) };
    if (!others || others.roads !== world.roads || others.rails !== world.rails || others.canals !== world.canals)
      others = { roads: world.roads, rails: world.rails, canals: world.canals, out: [...world.roads, ...world.rails, ...world.canals] };
    const grid = depthGrid(finishedCanals.out);
    const deadline = performance.now() + GROW_SLICE_MS;
    const maxSteps = Math.max(1, req.speed) * 2;
    if (blocked) blocked.ticks--;
    for (let steps = 0; growthPoints >= GROWTH_STEP && steps < maxSteps && (steps === 0 || performance.now() < deadline); steps++) {
      if (blocked && blocked.buildings === world.buildings && blocked.roads === world.roads && blocked.ticks > 0) break;
      const result = growOnce(world.buildings, world.roads, others.out, grid, economy, rnd, () => `building-${Date.now().toString(36)}-w${(idCounter++).toString(36)}`, req.permits, req.minutes);
      if (result.buildings === world.buildings) {
        growthPoints = GROWTH_STEP;
        blocked = { buildings: world.buildings, roads: world.roads, ticks: plotsUnchecked() > 0 ? 2 : GROWTH_RETRY };
        if (result.event) event = result.event;
        break;
      }
      growthPoints -= GROWTH_STEP;
      blocked = null;
      world.buildings = result.buildings;
      if (result.event) event = result.event;
    }
  }
  const added: Building[] = [];
  const changed: Building[] = [];
  if (world.buildings !== before) {
    const old = new Map(before.map((b) => [b.id, b]));
    for (const b of world.buildings) {
      const o = old.get(b.id);
      if (!o) added.push(b);
      else if (o !== b) changed.push(b);
    }
  }
  return { added, changed, growthPoints, event };
}

self.onmessage = (e: MessageEvent<SimRequest>) => {
  const req = e.data;
  const t0 = performance.now();
  apply(req.world);
  let res: SimResponse;
  if (req.type === "sim") {
    economy = simulate(world.buildings, world.roads, req.taxRate, req.businessTaxRate, world.cables, world.canals, req.storage, req.shipUpkeep, req.harbourWater);
    res = { type: "sim", id: req.id, economy, ms: performance.now() - t0 };
  } else {
    res = { type: "grow", id: req.id, ...grow(req), ms: performance.now() - t0 };
  }
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(res);
};
