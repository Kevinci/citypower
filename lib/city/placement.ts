import { closestOnPath, occupant } from "./adjacency";
import { accessRoad, ROADLESS_KINDS, BUILDINGS, sizeOf, insideFootprint, MINES, TRADER_HARBOUR_DISTANCE, UNIQUE, type Building, type BuildingKind } from "./economy";
import { PLANT_WATER_DISTANCE, polylineDistance } from "./power";
import { sampleDepth, WET_DEPTH, type DepthGrid } from "./terrain";
import { NAVIGABLE_DEPTH, reachesMarkets } from "./waterways";
import { OUTER_HALF_WIDTH, type Cable, type Path, type Road, type Vec2 } from "./types";

/** Buildings that need no road (still dock to one when it is close). */
const ROADLESS: BuildingKind[] = ROADLESS_KINDS;
/** Roadless buildings only dock to a street this close; farther away they stand free. */
const SNAP_ROADLESS = 20;

/** Search radius for the road a new building attaches to. */
const SNAP_ROAD = 70;
/** Gap between sidewalk edge and building front. */
const SETBACK = 1.5;
/** Largest height difference allowed inside a footprint (m); farms tolerate more. */
const MAX_UNEVEN: Record<BuildingKind, number> = { house: 3, church: 3, farm: 7, mill: 3, bakery: 3, waterworks: 4, hospital: 4, school: 4, steelworks: 6, sawmill: 5, furniture: 5, furniturestore: 3, slaughterhouse: 4, butcher: 3, restaurant: 3, cinema: 3, powerplant: 5, transformer: 3, coalmine: 14, ironmine: 14, uraniummine: 14, bank: 3, townhall: 3, taxoffice: 3, jobcenter: 3, recycling: 4, park: 6, playground: 3, warehouse: 4, harbour: 3, pool: 2, fair: 4, tannery: 4, rubberfactory: 5, shoefactory: 5, shoeshop: 3, sheepfarm: 7, spinning: 4, clothing: 4, fashion: 3, chickenfarm: 5, trader: 4, foodfactory: 4, discounter: 3, goldmine: 14, goldsmelter: 4, jeweller: 3, exchange: 3, airport: Infinity };
/** A mine needs terrain at least this high next to it (a mountain to dig into). */
export const MINE_MIN_HEIGHT = 10;

/** Samples on a ring `margin` metres around a footprint. */
function ringSamples(b: Building, margin: number): Vec2[] {
  const [w, d] = sizeOf(b);
  const hw = w / 2 + margin;
  const hd = d / 2 + margin;
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const out: Vec2[] = [];
  for (let t = 0; t < 1; t += 0.04) {
    for (const [lx, lz] of [
      [-hw + 2 * hw * t, -hd],
      [hw, -hd + 2 * hd * t],
      [hw - 2 * hw * t, hd],
      [-hw, hd - 2 * hd * t],
    ]) out.push({ x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c });
  }
  return out;
}

/** True if open water (river, lake, canal) lies within `distance` of the footprint. */
export function nearWater(b: Building, grid: DepthGrid, distance = PLANT_WATER_DISTANCE) {
  for (let m = 4; m <= distance; m += 6) {
    if (ringSamples(b, m).some((p) => sampleDepth(grid, p.x, p.z) > 0.5)) return true;
  }
  return false;
}

/** Highest terrain right behind and beside a footprint (for mines). */
export function mountainHeight(b: Building, grid: DepthGrid) {
  let best = -Infinity;
  for (const m of [0, 10, 25]) for (const p of ringSamples(b, m)) best = Math.max(best, -sampleDepth(grid, p.x, p.z));
  return best;
}

/** Depth of the harbour's quay strip that may stand in the water. */
const HARBOUR_QUAY = 8;

/**
 * Behind a harbour (local +z, away from the road) there must be water right at the back
 * edge (the quay) and navigable water not far out (natural banks are flat; the harbour
 * basin counts as dredged). Returns the share of the back edge that fits.
 */
/** Point in the water off the middle of a harbour's quay. */
export function harbourMouth(b: Building): Vec2 {
  const [, d] = sizeOf(b);
  return { x: b.x + Math.sin(b.rot) * (d / 2 + 10), z: b.z + Math.cos(b.rot) * (d / 2 + 10) };
}

export function quayWater(b: Building, grid: DepthGrid) {
  const [w, d] = sizeOf(b);
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const at = (lx: number, lz: number) => sampleDepth(grid, b.x + lx * c + lz * s, b.z - lx * s + lz * c);
  let ok = 0;
  let n = 0;
  for (let lx = -w / 2 + 2; lx <= w / 2 - 2; lx += 4) {
    n++;
    const wet = [-HARBOUR_QUAY / 2, 0, 4, 10].some((lz) => at(lx, d / 2 + lz) > WET_DEPTH + 0.2);
    const deep = [10, 20, 30, 40, 50, 60].some((lz) => at(lx, d / 2 + lz) > NAVIGABLE_DEPTH);
    if (wet && deep) ok++;
  }
  return n > 0 ? ok / n : 0;
}

/** Canals this close to the cursor take a harbour. */
const SNAP_CANAL = 45;

function nearestCanal(cursor: Vec2, paths: Path[]): Path | null {
  let best: { path: Path; d: number } | null = null;
  for (const p of paths) {
    if (p.kind !== "canal") continue;
    const d = closestOnPath(cursor, p).distance;
    if (d < SNAP_CANAL && (!best || d < best.d)) best = { path: p, d };
  }
  return best?.path ?? null;
}

export interface PlacementPlan {
  building: Building;
  /** Ground height for the building (mean over the footprint). */
  y: number;
  problem: string | null;
  /** Fits, but will stand shut down (no street / no water yet). */
  warning?: string | null;
  /** Houses in the way, torn down when the building is placed. */
  demolish?: string[];
}

/** Points covering a footprint (every ~4 m incl. edges), in world space. */
export function footprintSamples(b: { x: number; z: number; rot: number; kind: BuildingKind; level?: number }): Vec2[] {
  const [w, d] = sizeOf(b);
  const nx = Math.max(2, Math.ceil(w / 4));
  const nz = Math.max(2, Math.ceil(d / 4));
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const out: Vec2[] = [];
  for (let i = 0; i <= nx; i++) {
    for (let k = 0; k <= nz; k++) {
      const lx = -w / 2 + (w * i) / nx;
      const lz = -d / 2 + (d * k) / nz;
      out.push({ x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c });
    }
  }
  return out;
}

/** Mean terrain height under a building. */
export function buildingGround(b: Building, grid: DepthGrid) {
  const pts = footprintSamples(b);
  return pts.reduce((sum, p) => sum + Math.max(0, -sampleDepth(grid, p.x, p.z)), 0) / pts.length;
}

/**
 * Where a building of `kind` goes for the cursor: next to the closest street, front
 * facing it (like plots along roads in economy simulators), with all checks.
 */
export function planBuilding(
  kind: BuildingKind,
  cursor: Vec2,
  roads: Road[],
  others: Path[],
  buildings: Building[],
  grid: DepthGrid,
  money: number,
  id = "__ghost__",
  cables: Cable[] = [],
): PlacementPlan {
  const [, depth] = BUILDINGS[kind].size;
  let best: { road: Road; d: number } | null = null;
  for (const r of roads) {
    if (r.kind !== "street") continue;
    const d = closestOnPath(cursor, r).distance;
    // Deep plots (airport): the cursor sits at the plot's middle, far from the street.
    const snap = ROADLESS.includes(kind) ? SNAP_ROADLESS : Math.max(SNAP_ROAD, depth / 2 + 45);
    if (d < snap && (!best || d < best.d)) best = { road: r, d };
  }

  let building: Building;
  let problem: string | null = null;
  // A harbour docks with its quay (back) to a canal near the cursor; the street must run
  // along its front (landside).
  const canal = kind === "harbour" ? nearestCanal(cursor, others) : null;
  if (canal) {
    const a = closestOnPath(cursor, canal);
    let n = { x: -a.direction.z, z: a.direction.x };
    if ((cursor.x - a.point.x) * n.x + (cursor.z - a.point.z) * n.z < 0) n = { x: -n.x, z: -n.z };
    const off = OUTER_HALF_WIDTH.canal + 0.8 + depth / 2;
    building = {
      id,
      kind,
      x: a.point.x + n.x * off,
      z: a.point.z + n.z * off,
      // Front (local −z) to the land, back to the canal.
      rot: Math.atan2(-n.x, -n.z),
      level: 1,
      variant: 0,
    };

  } else if (best) {
    const a = closestOnPath(cursor, best.road);
    // Normal pointing from the road to the cursor's side.
    let n = { x: -a.direction.z, z: a.direction.x };
    if ((cursor.x - a.point.x) * n.x + (cursor.z - a.point.z) * n.z < 0) n = { x: -n.x, z: -n.z };
    const off = OUTER_HALF_WIDTH[best.road.kind] + SETBACK + depth / 2;
    building = {
      id,
      kind,
      x: a.point.x + n.x * off,
      z: a.point.z + n.z * off,
      // Local −z (the front) points back to the road.
      rot: Math.atan2(n.x, n.z),
      level: 1,
      variant: 0,
    };
  } else {
    // No street close by: the building stands free and is shut down until one is built
    // (transformers are fed by cable and never need one). A harbour turns its back to
    // nearby water, everything else its front to the nearest street.
    const rot = (kind === "harbour" ? backToWater(cursor, grid) : null) ?? frontToRoad(cursor, roads);
    building = { id, kind, x: cursor.x, z: cursor.z, rot, level: 1, variant: 0 };
  }

  const samples = footprintSamples(building);
  // A harbour's quay is built out into the water: its back strip may stand in it.
  const [, depthB] = sizeOf(building);
  const onLand =
    kind === "harbour"
      ? samples.filter((p) => (p.x - building.x) * Math.sin(building.rot) + (p.z - building.z) * Math.cos(building.rot) < depthB / 2 - HARBOUR_QUAY)
      : samples;
  const heights = onLand.map((p) => -sampleDepth(grid, p.x, p.z));
  const y = heights.reduce((s, h) => s + Math.max(0, h), 0) / heights.length;
  if (!problem && UNIQUE.includes(kind) && buildings.some((o) => o.kind === kind)) problem = `Es gibt schon ein(e) ${BUILDINGS[kind].label} – nur eins pro Stadt`;
  if (!problem && BUILDINGS[kind].cost > money) problem = `Nicht genug Geld (${BUILDINGS[kind].cost.toLocaleString("de-DE")} € nötig)`;
  if (!problem && heights.some((h) => h < -0.15)) problem = "Steht im Wasser";
  if (
    !problem &&
    kind === "trader" &&
    !buildings.some((o) => o.kind === "harbour" && Math.hypot(o.x - building.x, o.z - building.z) <= TRADER_HARBOUR_DISTANCE)
  )
    problem = `Nur in der Nähe eines Binnenhafens (≤ ${TRADER_HARBOUR_DISTANCE} m) – die Ware kommt per Schiff`;
  if (!problem && kind === "powerplant" && !nearWater(building, grid))
    problem = "Kraftwerk muss direkt am Wasser liegen (Fluss, See oder Kanal) – es braucht Kühlwasser";

  if (!problem && MINES.includes(kind) && mountainHeight(building, grid) < MINE_MIN_HEIGHT)
    problem = "Bergwerk nur an einem Berg – an eine Straße im Gebirge setzen";
  if (!problem && Math.max(...heights) - Math.min(...heights) > MAX_UNEVEN[kind]) problem = "Gelände zu steil";
  if (!problem && samples.some((p) => occupant(p, others, { margin: 0.5 }) !== null)) problem = "Überschneidet Straßen oder Gleise";
  // Houses always make way for other buildings (they are torn down); anything else blocks.
  const overlapping = problem ? [] : buildings.filter((o) => samples.some((p) => insideFootprint(o, p.x, p.z, 1)));
  const demolish = kind === "house" ? [] : overlapping.filter((o) => o.kind === "house").map((o) => o.id);
  const blocker = overlapping.find((o) => kind === "house" || o.kind !== "house");
  if (!problem && blocker) problem = kind === "house" ? "Überschneidet ein Gebäude" : `Überschneidet ${BUILDINGS[blocker.kind].label}`;
  // Pylons stand along the whole line: nothing may be built under a power line (except
  // the power buildings the line ends at).
  if (!problem && kind !== "powerplant" && kind !== "transformer" && cables.some((c) => samples.some((p) => polylineDistance(p, c.points) < 3)))
    problem = "Unter einer Stromleitung – hier stehen Masten";
  // Fits, but cannot work yet: built shut down until the connection is added.
  let warning: string | null = null;
  if (!problem && kind === "harbour" && harbourWaterProblem(building, grid))
    warning = `Stillgelegt, bis Wasser angebunden ist: ${harbourWaterProblem(building, grid)}`;
  if (!problem && !ROADLESS.includes(kind) && !accessRoad(building, roads))
    warning = warning ?? "Kein Straßenanschluss – wird gebaut, bleibt aber stillgelegt, bis eine Straße davor angebaut ist";
  return { building, y, problem, warning, demolish: problem ? [] : demolish };
}

/**
 * Why a harbour cannot send ships yet (null if it can): navigable water at the quay that
 * leads out of the map (a river, or a canal joined to one).
 */
export function harbourWaterProblem(b: Building, grid: DepthGrid): string | null {
  if (quayWater(b, grid) < 0.6) return "kein schiffbares Wasser am Kai – Kanal an die Rückseite bauen";
  if (!reachesMarkets(harbourMouth(b), grid)) return "Gewässer ohne Verbindung zu einem Fluss, der aus der Karte führt – Kanal bis ins Flusswasser ziehen";
  return null;
}

/** Rotation turning a building's back (local +z) towards the deepest water within 40 m, or null. */
function backToWater(p: Vec2, grid: DepthGrid): number | null {
  let best: { rot: number; wet: number } | null = null;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const wet = [15, 25, 35, 45].reduce((sum, d) => sum + Math.max(0, sampleDepth(grid, p.x + dx * d, p.z + dz * d) - WET_DEPTH), 0);
    if (wet > 0 && (!best || wet > best.wet)) best = { rot: a, wet };
  }
  return best?.rot ?? null;
}

/** Rotation turning a building's front (local −z) towards the nearest street, or 0. */
function frontToRoad(p: Vec2, roads: Road[]): number {
  let best: { a: ReturnType<typeof closestOnPath>; d: number } | null = null;
  for (const r of roads) {
    if (r.kind !== "street") continue;
    const a = closestOnPath(p, r);
    if (!best || a.distance < best.d) best = { a, d: a.distance };
  }
  if (!best || best.d < 1e-3) return 0;
  // Parallel to the street (not turned towards its nearest point), front facing it.
  const { point, direction } = best.a;
  let n = { x: -direction.z, z: direction.x };
  if ((p.x - point.x) * n.x + (p.z - point.z) * n.z < 0) n = { x: -n.x, z: -n.z };
  return Math.atan2(n.x, n.z);
}

export interface GrowthPlan {
  /** The building at its new level (moved back so the front stays at the road). */
  building: Building;
  /** Houses that make way for the bigger plot. */
  demolish: string[];
  problem: string | null;
}

/**
 * Upgrade of a building whose plot grows with the level (mill → Mühlenfabrik): the plot
 * extends away from the road. Houses on the new ground are torn down; roads, water,
 * steep ground or other buildings block the upgrade.
 */
export function planGrowth(b: Building, level: number, others: Path[], buildings: Building[], grid: DepthGrid, cables: Cable[] = []): GrowthPlan {
  const [w0, d0] = sizeOf(b);
  const [w1, d1] = sizeOf({ kind: b.kind, level });
  const shift = (d1 - d0) / 2;
  const building: Building = { ...b, level, x: b.x + Math.sin(b.rot) * shift, z: b.z + Math.cos(b.rot) * shift };
  if (w0 === w1 && d0 === d1) return { building, demolish: [], problem: null };
  const samples = footprintSamples(building);
  const heights = samples.map((p) => -sampleDepth(grid, p.x, p.z));
  let problem: string | null = null;
  if (heights.some((h) => h < -0.15)) problem = "Kein Platz für den Ausbau: Wasser im Weg";
  else if (Math.max(...heights) - Math.min(...heights) > MAX_UNEVEN[b.kind] + 2) problem = "Kein Platz für den Ausbau: Gelände zu steil";
  else if (samples.some((p) => occupant(p, others, { margin: 0.5 }) !== null)) problem = "Kein Platz für den Ausbau: Straße oder Gleis im Weg";
  // Same rule as for placing: nothing grows under a power line (its pylons stand there).
  else if (b.kind !== "powerplant" && b.kind !== "transformer" && cables.some((c) => samples.some((p) => polylineDistance(p, c.points) < 3)))
    problem = "Kein Platz für den Ausbau: Stromleitung im Weg";
  const hit = buildings.filter((o) => o.id !== b.id && (samples.some((p) => insideFootprint(o, p.x, p.z, 1)) || footprintSamples(o).some((p) => insideFootprint(building, p.x, p.z, 1))));
  const blocker = hit.find((o) => o.kind !== "house");
  if (!problem && blocker) problem = `Kein Platz für den Ausbau: ${BUILDINGS[blocker.kind].label} im Weg`;
  return { building, demolish: hit.filter((o) => o.kind === "house").map((o) => o.id), problem };
}

/** Airports farther than this from every street are left where they are. */
const REDOCK_RANGE = 300;

export interface RedockResult {
  buildings: Building[];
  /** Airports moved to their street, and those that did not fit (with the reason). */
  moved: number;
  blocked: string[];
}

/**
 * Re-docks airports placed before the docking fix: they could stand free and turned towards
 * the nearest street point (crooked), and their plot is now bigger than when they were built.
 * Each one is moved to the nearest street, front at the street and runway parallel to it, as
 * if placed again. Houses in the way are demolished; anything else in the way keeps it put.
 * Airports that already sit there are left unchanged (so this can run on every load).
 */
export function redockAirports(buildings: Building[], roads: Road[], others: Path[], grid: DepthGrid, cables: Cable[] = []): RedockResult {
  let out = buildings;
  let moved = 0;
  const blocked: string[] = [];
  for (const b of buildings.filter((x) => x.kind === "airport")) {
    let best: { a: ReturnType<typeof closestOnPath>; road: Road } | null = null;
    for (const r of roads) {
      if (r.kind !== "street") continue;
      const a = closestOnPath(b, r);
      if (a.distance < REDOCK_RANGE && (!best || a.distance < best.a.distance)) best = { a, road: r };
    }
    if (!best) continue;
    const { a, road } = best;
    let n = { x: -a.direction.z, z: a.direction.x };
    if ((b.x - a.point.x) * n.x + (b.z - a.point.z) * n.z < 0) n = { x: -n.x, z: -n.z };
    const off = OUTER_HALF_WIDTH[road.kind] + SETBACK + sizeOf(b)[1] / 2;
    const target = { x: a.point.x + n.x * off, z: a.point.z + n.z * off, rot: Math.atan2(n.x, n.z) };
    const turn = Math.abs(Math.atan2(Math.sin(target.rot - b.rot), Math.cos(target.rot - b.rot)));
    if (Math.hypot(target.x - b.x, target.z - b.z) < 0.5 && turn < 0.01) continue;
    // Same checks as placing it there (houses may go, they are demolished below).
    const rest = out.filter((o) => o.id !== b.id);
    const plan = planBuilding("airport", target, roads, others, rest.filter((o) => o.kind !== "house"), grid, Infinity, b.id, cables);
    const placed = { ...plan.building, level: b.level, variant: b.variant };
    if (plan.problem || Math.hypot(placed.x - target.x, placed.z - target.z) > 0.5) {
      blocked.push(plan.problem ?? "kein Platz an der Straße");
      continue;
    }
    const gone = new Set(rest.filter((o) => o.kind === "house" && footprintSamples(o).some((p) => insideFootprint(placed, p.x, p.z, 1))).map((o) => o.id));
    out = out.filter((o) => !gone.has(o.id)).map((o) => (o.id === b.id ? placed : o));
    moved++;
  }
  return { buildings: out, moved, blocked };
}
