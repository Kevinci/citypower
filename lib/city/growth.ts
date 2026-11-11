import { closestOnPath } from "./adjacency";
import {
  accessRoad,
  BUILDINGS,
  HOUSE_RESIDENTS,
  INDUSTRY,
  INDUSTRY_BUFFER,
  insideFootprint,
  MAX_HOUSE_LEVEL,
  UPGRADE_NEEDS,
  houseCap,
  type Building,
  type EconomyStats,
  sizeOf,
} from "./economy";
import { footprintSamples, planBuilding } from "./placement";
import type { DepthGrid } from "./terrain";
import { OUTER_HALF_WIDTH, type Path, type Road } from "./types";

/**
 * The town grows by itself, like the residential zones of city builders: the player only
 * provides infrastructure. New residents (births with a hospital, immigration with
 * enough water and bread) fill "growth points"; each time enough have gathered, one
 * house is built on a free plot along a street, or an existing house moves up a level
 * (up to Wohnblock and Hochhaus, which only come now and then in a bigger town).
 * Houses without water fall back a level.
 */

/** Distance between candidate plots along a street. */
const PLOT_STEP = 14;
/** Town size needed before houses grow to level 4 (Wohnblock), 5 (Hochhaus), 6 (Turmhochhaus), 7 (Wolkenkratzer). */
const TALL_RESIDENTS = [0, 0, 0, 0, 500, 1200, 3000, 6000];
/** Chance per growth step that a house qualifies for level 4–7: tall buildings come one by one. */
const TALL_CHANCE = [1, 1, 1, 1, 0.5, 0.3, 0.2, 0.12];
/** Plots this far from existing houses still count as "next to the town". */
const NEIGHBOUR_RADIUS = 60;

/**
 * Building permits for homes, set in the town hall: all, only enlarging existing houses,
 * or none (building freeze – the player can lay out infrastructure in peace).
 */
export type Permits = "all" | "upgrades" | "none";
export const PERMIT_LABEL: Record<Permits, string> = {
  all: "Baugenehmigungen werden erteilt",
  upgrades: "Nur Ausbau bestehender Häuser – keine neuen Wohnhäuser",
  none: "Baustopp – keine neuen oder größeren Wohnhäuser",
};

export interface GrowthResult {
  buildings: Building[];
  /** Short message for the ticker, or null. */
  event: string | null;
}

/**
 * Checked plots (planBuilding per candidate is the expensive part, ~10 ms for a town): kept
 * while streets, paths and terrain stay the same. New buildings only invalidate the plots
 * they overlap; a removed or moved building clears the cache (a plot may have become free).
 */
let plotCache: { roads: Road[]; others: Path[]; grid: DepthGrid; seen: Map<string, Building>; plans: Map<string, Building | null> } | null = null;

function cachedPlots(roads: Road[], others: Path[], buildings: Building[], grid: DepthGrid) {
  const c = plotCache;
  const same = c && c.roads === roads && c.grid === grid && c.others.length === others.length && c.others.every((o, i) => o === others[i]);
  const now = new Map(buildings.map((b) => [b.id, b]));
  // Houses that only went up a level keep their plot (same place and size).
  const moved = (old: Building, b: Building | undefined) =>
    !b || (b !== old && (b.kind !== "house" || b.x !== old.x || b.z !== old.z || b.rot !== old.rot));
  if (!same || [...c.seen].some(([id, old]) => moved(old, now.get(id)))) {
    plotCache = { roads, others, grid, seen: now, plans: new Map() };
    return plotCache.plans;
  }
  const added = buildings.filter((b) => !c.seen.has(b.id));
  if (added.length > 0)
    for (const [k, plot] of c.plans)
      if (plot && added.some((o) => footprintSamples(plot).some((p) => insideFootprint(o, p.x, p.z, 1)) || footprintSamples(o).some((p) => insideFootprint(plot, p.x, p.z, 1))))
        c.plans.set(k, null);
  c.seen = now;
  return c.plans;
}

/**
 * Time for new plot plans per search (ms): a cold cache (game loaded) is filled over a few
 * searches, not in one long tick. Was a fixed 20 plans – in a town of 1,400 buildings the first
 * free plot came after 84 searches (42 game hours), plots on new streets were never reached.
 */
const PLAN_BUDGET_MS = 12;
/** Candidates not yet checked after the last search (more searches needed before "no room"). */
let unchecked = 0;
export const plotsUnchecked = () => unchecked;

/** Free house plots along all streets, best first (many houses nearby, close to the centre). */
export function housePlots(roads: Road[], others: Path[], buildings: Building[], grid: DepthGrid, limit = 6): Building[] {
  const deadline = performance.now() + PLAN_BUDGET_MS;
  unchecked = 0;
  const plans = cachedPlots(roads, others, buildings, grid);
  // Every building in a coarse grid: a candidate whose centre lies on a building is taken
  // without the costly planBuilding (most candidates in a built-up town).
  const BCELL = 40;
  const bgrid = new Map<string, Building[]>();
  for (const b of buildings) {
    const r = Math.max(...sizeOf(b)) / 2;
    for (let i = Math.floor((b.x - r) / BCELL); i <= Math.floor((b.x + r) / BCELL); i++)
      for (let j = Math.floor((b.z - r) / BCELL); j <= Math.floor((b.z + r) / BCELL); j++) {
        const k = `${i},${j}`;
        const list = bgrid.get(k);
        if (list) list.push(b);
        else bgrid.set(k, [b]);
      }
  }
  // Centre and four points 4 m off it all lie inside any house plot there, whichever way it faces:
  // a building on one of them always overlaps the plot.
  const PROBE = [
    [0, 0],
    [4, 0],
    [-4, 0],
    [0, 4],
    [0, -4],
  ];
  const occupied = (p: { x: number; z: number }) =>
    PROBE.some(([dx, dz]) => {
      const x = p.x + dx;
      const z = p.z + dz;
      return (bgrid.get(`${Math.floor(x / BCELL)},${Math.floor(z / BCELL)}`) ?? []).some((b) => insideFootprint(b, x, z, 0));
    });
  const houses = buildings.filter((b) => b.kind === "house");
  const industry = buildings.filter((b) => INDUSTRY.includes(b.kind));
  const [, depth] = BUILDINGS.house.size;
  // Houses in a coarse grid: counting neighbours scans 3×3 cells instead of every house.
  const cell = (v: number) => Math.floor(v / NEIGHBOUR_RADIUS);
  const grid2 = new Map<string, Building[]>();
  for (const h of houses) {
    const k = `${cell(h.x)},${cell(h.z)}`;
    const list = grid2.get(k);
    if (list) list.push(h);
    else grid2.set(k, [h]);
  }
  const neighbours = (p: { x: number; z: number }) => {
    let n = 0;
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const h of grid2.get(`${cell(p.x) + i},${cell(p.z) + j}`) ?? []) if (Math.hypot(h.x - p.x, h.z - p.z) < NEIGHBOUR_RADIUS) n++;
    return n;
  };
  const plots: { b: Building; score: number }[] = [];
  for (const road of roads) {
    if (road.kind !== "street") continue;
    for (let k = 0; k < road.points.length - 1; k++) {
      const a = road.points[k];
      const c = road.points[k + 1];
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      const tx = (c.x - a.x) / len;
      const tz = (c.z - a.z) / len;
      for (let s = PLOT_STEP / 2; s < len; s += PLOT_STEP) {
        for (const side of [-1, 1]) {
          const off = OUTER_HALF_WIDTH.street + 2 + depth / 2;
          const p = { x: a.x + tx * s - tz * side * off, z: a.z + tz * s + tx * side * off };
          const key = `${road.id}:${k}:${s}:${side}`;
          let plot = plans.get(key);
          // Known dead plots (taken, blocked) need no further checks.
          if (plot === null) continue;
          // Only plots near the existing town (it grows outward along streets).
          const near = neighbours(p);
          if (houses.length > 0 && near === 0) continue;
          // Nobody wants to live right next to a steelworks.
          if (industry.some((f) => Math.hypot(f.x - p.x, f.z - p.z) < INDUSTRY_BUFFER + Math.max(...sizeOf(f)) / 2)) continue;
          if (plot === undefined && occupied(p)) {
            plans.set(key, null);
            continue;
          }
          if (plot === undefined) {
            if (performance.now() > deadline) {
              unchecked++;
              continue;
            }
            const plan = planBuilding("house", p, roads, others, buildings, grid, Infinity);
            // The plot must face the street it was found on.
            const fits = !plan.problem && closestOnPath({ x: plan.building.x, z: plan.building.z }, road).distance <= off + 3;
            plot = fits ? plan.building : null;
            plans.set(key, plot);
          }
          if (!plot) continue;
          plots.push({ b: plot, score: near * 10 - Math.hypot(p.x, p.z) * 0.05 });
        }
      }
    }
  }
  plots.sort((x, y) => y.score - x.score);
  return plots.slice(0, limit).map((p) => p.b);
}

/** Game minutes between two searches for free house plots (the search is the costly part of growth). */
export const PLOT_SEARCH_MINUTES = 30;
/** While candidates are still unchecked (cold cache after loading, a building removed), search this often. */
const PLOT_CATCHUP_MINUTES = 2;
let lastSearch: { at: number; plots: Building[] } | null = null;

/**
 * Free plots, searched at most every PLOT_SEARCH_MINUTES of game time; in between the plots
 * of the last search are used up (minus any that something else was built on meanwhile).
 */
function searchPlots(roads: Road[], others: Path[], buildings: Building[], grid: DepthGrid, minutes: number) {
  const every = unchecked > 0 ? PLOT_CATCHUP_MINUTES : PLOT_SEARCH_MINUTES;
  const due = !lastSearch || minutes - lastSearch.at >= every || minutes < lastSearch.at;
  if (due) {
    lastSearch = { at: minutes, plots: housePlots(roads, others, buildings, grid, 24) };
    return lastSearch.plots;
  }
  const s = lastSearch!;
  s.plots = s.plots.filter(
    (p) =>
      !buildings.some((b) => {
        const [w, d] = sizeOf(b);
        return Math.hypot(b.x - p.x, b.z - p.z) < (Math.max(w, d) + Math.max(...sizeOf(p))) / 2;
      }),
  );
  return s.plots;
}

/** One growth step: build or upgrade one house (or downgrade one without water). */
export function growOnce(
  buildings: Building[],
  roads: Road[],
  others: Path[],
  grid: DepthGrid,
  economy: EconomyStats,
  rnd: () => number,
  newId: () => string,
  /** Building permits from the town hall: "upgrades" = no new houses, only bigger ones. */
  permits: Permits = "all",
  /** Game time (minutes): the plot search runs at most every PLOT_SEARCH_MINUTES. */
  minutes = 0,
): GrowthResult {
  const houses = buildings.filter((b) => b.kind === "house");
  const N = UPGRADE_NEEDS;
  const breadOk = economy.breadDemand === 0 || economy.breadSold >= economy.breadDemand * N.bread;

  // Houses whose conditions allow the next level: water, bread for level 2, a hospital
  // and a town of some size for level 3. The centre densifies first.
  const canUpgrade = houses.filter((h) => {
    const st = economy.status[h.id];
    if (!st || h.level >= Math.min(MAX_HOUSE_LEVEL, houseCap(h)) || st.water < 0.99 || !accessRoad(h, roads)) return false;
    if (h.level === 1) return breadOk && economy.employment > N.employmentSmall;
    // Apartment buildings need a hospital, schools, jobs, furniture and power.
    const apartments =
      breadOk &&
      economy.hospital &&
      economy.residents >= N.residents &&
      economy.education >= N.education &&
      economy.employment > N.employment &&
      economy.furnished >= N.furnished &&
      // Lifts, pumps and lights: apartment buildings need electricity at the house.
      (st.power ?? 0) >= N.power;
    if (h.level === 2) return apartments;
    // Blocks and towers: a bigger town, and only now and then (the skyline grows slowly).
    return (
      apartments &&
      economy.residents >= TALL_RESIDENTS[h.level + 1] &&
      economy.furnished >= N.furnishedTall &&
      rnd() < TALL_CHANCE[h.level + 1]
    );
  });
  canUpgrade.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));

  const upgrade = (h: Building, why: string): GrowthResult => ({
    buildings: buildings.map((b) => (b.id === h.id ? { ...b, level: b.level + 1 } : b)),
    event: why,
  });

  // Prefer filling new plots while the town is small, densify later.
  const densify = canUpgrade.length > 0 && (rnd() < Math.min(0.75, economy.residents / 500) || rnd() < 0.25);
  if (densify) return upgrade(canUpgrade[Math.floor(rnd() * Math.min(4, canUpgrade.length))], "Ein Haus wurde vergrößert");

  const plots = permits === "all" ? searchPlots(roads, others, buildings, grid, minutes) : [];
  if (plots.length > 0) {
    const plot = plots[Math.floor(rnd() * Math.min(3, plots.length))];
    lastSearch?.plots.splice(lastSearch.plots.indexOf(plot), 1);
    return {
      buildings: [...buildings, { ...plot, id: newId(), level: 1, variant: Math.floor(rnd() * 6) }],
      event: "Neues Wohnhaus gebaut",
    };
  }
  if (canUpgrade.length > 0) return upgrade(canUpgrade[0], "Ein Haus wurde vergrößert");
  // Only a fresh, complete search can tell that there is no room (in between, the old plots may
  // just be used up; with candidates left unchecked, the next search may still find some).
  const searched = lastSearch?.at === minutes && unchecked === 0;
  return { buildings, event: permits === "all" && searched ? "Kein Bauplatz mehr – baue neue Straßen" : null };
}

/** Houses that have lacked water fall back a level (chance per minute). */
export function decay(buildings: Building[], economy: EconomyStats, rnd: () => number, minutes: number): Building[] | null {
  let changed = false;
  const out = buildings.map((b) => {
    if (b.kind !== "house" || b.level <= 1) return b;
    const st = economy.status[b.id];
    if (!st || st.water >= 0.7) return b;
    if (rnd() < 0.01 * minutes) {
      changed = true;
      return { ...b, level: b.level - 1 };
    }
    return b;
  });
  return changed ? out : null;
}

/** Residents a new step needs: a new small house or the gain of an upgrade. */
export const GROWTH_STEP = HOUSE_RESIDENTS[1];
