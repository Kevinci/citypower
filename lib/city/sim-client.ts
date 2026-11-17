import type { Building, EconomyStats, Storage } from "./economy";
import type { Permits } from "./growth";
import type { SimRequest, SimResponse, WorldPatch } from "./sim.worker";
import type { Cable, Canal, Rail, Road } from "./types";

/**
 * Main-thread side of the simulation worker (sim.worker.ts). Requests carry only the parts of
 * the world whose identity changed since the last request. One request at a time: while the
 * worker is busy the caller skips its turn (the game clock then simply runs slower instead of
 * piling work up).
 */

export interface SimWorld {
  seed: number;
  roads: Road[];
  rails: Rail[];
  canals: Canal[];
  cables: Cable[];
  jobs: string[];
  buildings: Building[];
}
type GrowResult = Extract<SimResponse, { type: "grow" }>;

let worker: Worker | null | undefined;
let busy = false;
let nextId = 1;
let sent: Partial<SimWorld> = {};
const waiting = new Map<number, (r: SimResponse | null) => void>();
/** Worker timings of the last requests (ms), for the benchmark. */
export const simTimings = { sim: 0, grow: 0 };

function start(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === "undefined") return (worker = null);
    const w = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<SimResponse>) => {
      busy = false;
      if (e.data.type === "sim") simTimings.sim = e.data.ms;
      else simTimings.grow = e.data.ms;
      waiting.get(e.data.id)?.(e.data);
      waiting.delete(e.data.id);
    };
    w.onerror = () => {
      // Broken worker: the store falls back to simulating on the main thread.
      worker = null;
      busy = false;
      for (const done of waiting.values()) done(null);
      waiting.clear();
    };
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

function patchFor(world: SimWorld): WorldPatch {
  const patch: WorldPatch = {};
  for (const key of Object.keys(world) as (keyof SimWorld)[]) {
    if (sent[key] !== world[key]) (patch as Record<string, unknown>)[key] = world[key];
  }
  sent = { ...world };
  return patch;
}

function post<T extends SimResponse>(req: SimRequest): Promise<T | null> {
  busy = true;
  return new Promise((resolve) => {
    waiting.set(req.id, resolve as (r: SimResponse | null) => void);
    worker!.postMessage(req);
  });
}

/** "sync" = no worker (simulate on the main thread), "busy" = skip this turn. */
export function simState(): "ready" | "busy" | "sync" {
  if (!start()) return "sync";
  return busy ? "busy" : "ready";
}

export async function requestSim(
  world: SimWorld,
  p: { taxRate: number; businessTaxRate: number; storage: Storage; shipUpkeep: Record<string, number>; harbourWater: Record<string, string | null> },
): Promise<EconomyStats | null> {
  const res = await post<Extract<SimResponse, { type: "sim" }>>({ type: "sim", id: nextId++, world: patchFor(world), ...p });
  return res?.economy ?? null;
}

export function requestGrow(world: SimWorld, p: { growthPoints: number; permits: Permits; minutes: number; speed: number }): Promise<GrowResult | null> {
  return post<GrowResult>({ type: "grow", id: nextId++, world: patchFor(world), ...p });
}

/** After the worker's growth was applied: this list is what the worker already has. */
export function buildingsSynced(buildings: Building[]) {
  sent.buildings = buildings;
}
/** The worker's growth was dropped (the town changed meanwhile): send the list again next time. */
export function buildingsDropped() {
  sent.buildings = undefined;
}
