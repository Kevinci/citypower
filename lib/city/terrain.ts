import { mulberry32 } from "./random";
import { buildFrames } from "./road-geometry";
import { HALF_WIDTH, OUTER_HALF_WIDTH, type Canal, type Vec2 } from "./types";

/**
 * Terrain and water.
 *
 * The ground is flat at y = 0 except where water carved it out. Carving is stored as a
 * depth grid (metres below 0) with one sample every TERRAIN_RES metres over the whole
 * world. One water plane at WATER_LEVEL covers the world; it is only visible where the
 * terrain lies below it. Natural rivers and lakes are generated deterministically; built
 * canals are stamped on top of that once their construction has finished.
 */

/** Edge length of the square world, in metres. */
export const WORLD_SIZE = 2100;
export const WORLD_HALF = WORLD_SIZE / 2;
/**
 * Half size of the original 1.400 m map. Rivers and lakes are still laid out from it, so
 * every seed (and every save) keeps exactly the same inner world; the bigger map only adds
 * land around it (the river runs on, plus a few outer lakes).
 */
const GEN_HALF = 700;
/** Metres between two terrain samples (and terrain mesh vertices). */
export const TERRAIN_RES = 2;
/** Samples per row and column. */
export const TERRAIN_N = WORLD_SIZE / TERRAIN_RES + 1;
/** Height of every water surface. */
export const WATER_LEVEL = -0.9;
/** Ground deeper than this below 0 is under water. */
export const WET_DEPTH = -WATER_LEVEL;
/** Depth of a built canal (flat bottom between quay walls). */
export const CANAL_DEPTH = 3.2;
/** Largest depth the water shader distinguishes; the depth texture stores depth / this. */
export const DEPTH_TEXTURE_SCALE = 5;

export type DepthGrid = Float32Array;

/* ---------- natural water ---------- */

export interface RiverSpec {
  /** Centre line, densely sampled. */
  points: Vec2[];
  /** Half width of the water surface at each point. */
  halfWidths: number[];
  depth: number;
}

export interface LakeSpec {
  x: number;
  z: number;
  /** Mean radius of the water surface. */
  radius: number;
  depth: number;
  /** Shape noise phases. */
  phase: [number, number, number];
}

/** Resamples a meandering line from `from` to `to` every 2 m. */
function meander(
  from: Vec2,
  to: Vec2,
  waves: { amp: number; freq: number; phase: number }[],
  halfWidth: (s: number) => number,
  /** Continue the same curve this far beyond both ends (m). */
  extend = 0,
): { points: Vec2[]; halfWidths: number[] } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  const tx = dx / len;
  const tz = dz / len;
  const steps = Math.ceil(len / 2);
  const step = len / steps;
  const more = Math.ceil(extend / step);
  const points: Vec2[] = [];
  const halfWidths: number[] = [];
  for (let i = -more; i <= steps + more; i++) {
    const s = i * step;
    const off = waves.reduce((acc, w) => acc + w.amp * Math.sin(s * w.freq + w.phase), 0);
    points.push({ x: from.x + tx * s - tz * off, z: from.z + tz * s + tx * off });
    halfWidths.push(halfWidth(s));
  }
  return { points, halfWidths };
}

/* ---------- world seed ---------- */

/** Seed of the current world: the whole map (rivers, lakes, mountains, hills) follows from it. */
let worldSeed = 1;
export const getWorldSeed = () => worldSeed;
export function setWorldSeed(seed: number) {
  worldSeed = seed >>> 0;
}

/** Radius around the map centre that stays flat and dry for the starting village. */
export const START_RADIUS = 210;

/**
 * Natural water of the world, generated from the seed: one main river crossing the map
 * (never through the start area), sometimes a side stream, and two to four lakes.
 */
export function naturalWater(seed = worldSeed): { rivers: RiverSpec[]; lakes: LakeSpec[] } {
  const rnd = mulberry32(seed * 7919 + 17);
  // Main river: a line across the map, offset from the centre, meandering.
  const angle = rnd() * Math.PI;
  const dir = { x: Math.cos(angle), z: Math.sin(angle) };
  const perp = { x: -dir.z, z: dir.x };
  const offset = (START_RADIUS + 80 + rnd() * 160) * (rnd() < 0.5 ? -1 : 1);
  const reach = GEN_HALF * 1.5;
  const from = { x: perp.x * offset - dir.x * reach, z: perp.z * offset - dir.z * reach };
  const to = { x: perp.x * offset + dir.x * reach, z: perp.z * offset + dir.z * reach };
  const river = meander(
    from,
    to,
    [
      { amp: 35 + rnd() * 30, freq: 0.005 + rnd() * 0.003, phase: rnd() * 6.28 },
      { amp: 10 + rnd() * 12, freq: 0.016 + rnd() * 0.008, phase: rnd() * 6.28 },
    ],
    (s) => 13 + 5 * Math.sin(s * 0.004),
    // The same river, continued to the edge of the bigger map (corners included).
    Math.max(0, WORLD_HALF * Math.SQRT2 + 40 - reach),
  );
  const rivers: RiverSpec[] = [{ ...river, depth: 3.6 }];

  // Lakes: away from the centre and from the river.
  const lakes: LakeSpec[] = [];
  const lakeCount = 2 + Math.floor(rnd() * 3);
  for (let tries = 0; tries < 60 && lakes.length < lakeCount; tries++) {
    const r = START_RADIUS + 90 + rnd() * (GEN_HALF - START_RADIUS - 170);
    const a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const radius = 30 + rnd() * 45;
    const nearRiver = river.points.some((p) => Math.hypot(p.x - x, p.z - z) < radius + 70);
    const nearLake = lakes.some((l) => Math.hypot(l.x - x, l.z - z) < l.radius + radius + 60);
    if (nearRiver || nearLake) continue;
    lakes.push({ x, z, radius, depth: 3 + rnd() * 1.5, phase: [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28] });
  }

  // Sometimes a stream runs from the first lake to the map edge.
  if (lakes.length > 0 && rnd() < 0.6) {
    const l = lakes[0];
    const out = Math.hypot(l.x, l.z) || 1;
    const edge = { x: (l.x / out) * (WORLD_HALF + 20), z: (l.z / out) * (WORLD_HALF + 20) };
    const stream = meander(
      { x: l.x + (l.x / out) * l.radius * 0.8, z: l.z + (l.z / out) * l.radius * 0.8 },
      edge,
      [
        { amp: 12, freq: 0.021, phase: rnd() * 6.28 },
        { amp: 5, freq: 0.055, phase: rnd() * 6.28 },
      ],
      () => 5,
    );
    rivers.push({ ...stream, depth: 2.2 });
  }
  // Outer lakes on the land beyond the original map (own random stream: the inner world stays).
  if (WORLD_HALF > GEN_HALF) {
    const outer = mulberry32(seed * 104729 + 7);
    const count = 2 + Math.floor(outer() * 3);
    const placed: LakeSpec[] = [];
    for (let tries = 0; tries < 80 && placed.length < count; tries++) {
      const r = GEN_HALF + 40 + outer() * (WORLD_HALF - GEN_HALF - 160);
      const a = outer() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const radius = 35 + outer() * 55;
      const lake: LakeSpec = { x, z, radius, depth: 3 + outer() * 1.5, phase: [outer() * 6.28, outer() * 6.28, outer() * 6.28] };
      if (Math.max(Math.abs(x), Math.abs(z)) > WORLD_HALF - radius - 60) continue;
      if (rivers.some((rv) => rv.points.some((p) => Math.hypot(p.x - x, p.z - z) < radius + 80))) continue;
      if ([...lakes, ...placed].some((l) => Math.hypot(l.x - x, l.z - z) < l.radius + radius + 80)) continue;
      placed.push(lake);
    }
    lakes.push(...placed);
  }
  return { rivers, lakes };
}

/**
 * Bank profile: depth at relative distance s (0 = centre, 1 = where the bank meets the
 * flat ground). Smooth at both ends, so banks blend into the meadow.
 */
const profile = (s: number) => (s >= 1 ? 0 : (1 - s * s) ** 1.5);

/** Relative distance at which a profile of the given depth reaches the water line. */
const shoreAt = (depth: number) => Math.sqrt(1 - (WET_DEPTH / depth) ** (2 / 3));

const index = (col: number, row: number) => row * TERRAIN_N + col;
const toCol = (x: number) => (x + WORLD_HALF) / TERRAIN_RES;

/** Raises the grid to `depth(distance)` inside a disc around (x, z). */
function stampDisc(
  grid: DepthGrid,
  x: number,
  z: number,
  radius: number,
  depthAt: (d: number) => number,
  keep?: (px: number, pz: number) => boolean,
) {
  const c0 = Math.max(0, Math.floor(toCol(x - radius)));
  const c1 = Math.min(TERRAIN_N - 1, Math.ceil(toCol(x + radius)));
  const r0 = Math.max(0, Math.floor(toCol(z - radius)));
  const r1 = Math.min(TERRAIN_N - 1, Math.ceil(toCol(z + radius)));
  for (let row = r0; row <= r1; row++) {
    const pz = row * TERRAIN_RES - WORLD_HALF;
    for (let col = c0; col <= c1; col++) {
      const px = col * TERRAIN_RES - WORLD_HALF;
      const d = Math.hypot(px - x, pz - z);
      if (d > radius) continue;
      if (keep && !keep(px, pz)) continue;
      const v = depthAt(d);
      const i = index(col, row);
      if (v > grid[i]) grid[i] = v;
    }
  }
}

/* ---------- mountains ---------- */

/** Highest peaks reach about this height above the plain (m). */
export const PEAK_HEIGHT = 85;

function hash2(x: number, z: number) {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function valueNoise(x: number, z: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x: number, z: number, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, z);
    norm += amp;
    x *= 2.03;
    z *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Ridged multifractal: sharp crests and valleys like folded mountains. */
function ridged(x: number, z: number, octaves = 5) {
  let sum = 0;
  let amp = 0.55;
  let norm = 0;
  let weight = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(valueNoise(x, z) * 2 - 1);
    n *= n * weight;
    weight = Math.min(1, n * 1.6);
    sum += amp * n;
    norm += amp;
    x *= 2.1;
    z *= 2.1;
    amp *= 0.5;
  }
  return sum / norm;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Terrain height of the natural land (without water), like the random maps of economy
 * simulators: flat land around the centre for the first village, rolling hills further
 * out, and mountain ranges wherever a large-scale noise field from the seed says so.
 * `waterDist` keeps valleys open along rivers and around lakes.
 */
function landHeight(x: number, z: number, waterDist: number, seed: number) {
  const ox = (seed % 997) * 3.17;
  const oz = (seed % 991) * 2.71;
  const r = Math.hypot(x, z);
  const away = smooth(START_RADIUS - 20, START_RADIUS + 140, r);
  if (away <= 0) return 0;
  // Where mountain ranges lie: large-scale noise, different for every seed.
  const rangeField = fbm(x / 520 + ox, z / 520 + oz, 3);
  const range = smooth(0.5, 0.64, rangeField) * smooth(START_RADIUS + 60, START_RADIUS + 260, r);
  const crest = ridged(x / 230 + ox * 1.3, z / 230 - oz * 0.7);
  const detail = fbm(x / 70 + 11 + ox, z / 70 - 5 + oz);
  const mountains = range * (8 + (PEAK_HEIGHT - 8) * Math.pow(crest, 1.5) * (0.65 + 0.5 * detail));
  // Rolling hills everywhere outside the centre.
  const hills = 10 * Math.pow(fbm(x / 160 - ox, z / 160 + oz, 4), 1.4) * away;
  const valley = smooth(35, 150, waterDist);
  return Math.max(mountains, hills) * valley;
}

function buildNaturalGrid(seed: number): DepthGrid {
  const grid = new Float32Array(TERRAIN_N * TERRAIN_N);
  const { rivers, lakes } = naturalWater(seed);

  // Distance to rivers and lake shores (only needed near them, so stamped from samples).
  const riverDist = new Float32Array(TERRAIN_N * TERRAIN_N).fill(1e6);
  const RIVER_REACH = 180;
  const samples: { x: number; z: number; r: number }[] = [];
  for (const rv of rivers) rv.points.forEach((p, i) => i % 3 === 0 && samples.push({ x: p.x, z: p.z, r: 0 }));
  for (const l of lakes) {
    for (let a = 0; a < Math.PI * 2; a += 0.15) {
      samples.push({ x: l.x + Math.cos(a) * l.radius, z: l.z + Math.sin(a) * l.radius, r: 0 });
    }
    samples.push({ x: l.x, z: l.z, r: l.radius });
  }
  for (const p of samples) {
    const c0 = Math.max(0, Math.floor(toCol(p.x - RIVER_REACH)));
    const c1 = Math.min(TERRAIN_N - 1, Math.ceil(toCol(p.x + RIVER_REACH)));
    const r0 = Math.max(0, Math.floor(toCol(p.z - RIVER_REACH)));
    const r1 = Math.min(TERRAIN_N - 1, Math.ceil(toCol(p.z + RIVER_REACH)));
    for (let row = r0; row <= r1; row++) {
      const pz = row * TERRAIN_RES - WORLD_HALF;
      for (let col = c0; col <= c1; col++) {
        const px = col * TERRAIN_RES - WORLD_HALF;
        const d = Math.max(0, Math.hypot(px - p.x, pz - p.z) - p.r);
        const i = index(col, row);
        if (d < riverDist[i]) riverDist[i] = d;
      }
    }
  }
  // Land first: mountains are negative depth.
  for (let row = 0; row < TERRAIN_N; row++) {
    const pz = row * TERRAIN_RES - WORLD_HALF;
    for (let col = 0; col < TERRAIN_N; col++) {
      const px = col * TERRAIN_RES - WORLD_HALF;
      const i = index(col, row);
      grid[i] = -landHeight(px, pz, riverDist[i], seed);
    }
  }

  for (const r of rivers) {
    const shore = shoreAt(r.depth);
    r.points.forEach((p, i) => {
      const outer = r.halfWidths[i] / shore;
      stampDisc(grid, p.x, p.z, outer, (d) => r.depth * profile(d / outer));
    });
  }

  for (const l of lakes) {
    const shore = shoreAt(l.depth);
    const maxOuter = (l.radius * 1.35) / shore;
    const [a, b, c] = l.phase;
    const c0 = Math.max(0, Math.floor(toCol(l.x - maxOuter)));
    const c1 = Math.min(TERRAIN_N - 1, Math.ceil(toCol(l.x + maxOuter)));
    const r0 = Math.max(0, Math.floor(toCol(l.z - maxOuter)));
    const r1 = Math.min(TERRAIN_N - 1, Math.ceil(toCol(l.z + maxOuter)));
    for (let row = r0; row <= r1; row++) {
      const pz = row * TERRAIN_RES - WORLD_HALF;
      for (let col = c0; col <= c1; col++) {
        const px = col * TERRAIN_RES - WORLD_HALF;
        const theta = Math.atan2(pz - l.z, px - l.x);
        // Irregular shore line from three low-frequency harmonics.
        const radius =
          l.radius * (1 + 0.16 * Math.sin(2 * theta + a) + 0.1 * Math.sin(3 * theta + b) + 0.05 * Math.sin(5 * theta + c));
        const outer = radius / shore;
        const dist = Math.hypot(px - l.x, pz - l.z);
        const v = l.depth * profile(dist / outer);
        const i = index(col, row);
        if (v > 0) {
          if (v > grid[i]) grid[i] = v;
        } else if (grid[i] < 0) {
          // Banks: land beyond the water line levels out towards the lake, but fades back to
          // the natural ground by the edge of the lake's square – before, the whole square was
          // set to 0 and its edge stood as a sharp step in hilly land.
          const fade = smooth(outer, Math.max(outer + 1, maxOuter), dist);
          grid[i] *= fade;
        }
      }
    }
  }

  // Fine noise on the beds so shallow areas are not perfectly smooth.
  const rnd = mulberry32(4242);
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] > 0.4) grid[i] += (rnd() - 0.5) * 0.12;
  }
  return grid;
}

let natural: { seed: number; grid: DepthGrid } | null = null;
/** Depth grid of the natural land and water (mountains are negative depth). Built once. */
export function naturalDepthGrid(): DepthGrid {
  if (!natural || natural.seed !== worldSeed) natural = { seed: worldSeed, grid: buildNaturalGrid(worldSeed) };
  return natural.grid;
}

/* ---------- canals ---------- */

/** Canal water reaches this far past the quay wall line so the wall hides the terrain step. */
const CANAL_CARVE_EXTRA = 0.6;
/** Highest ground a canal may be dug through (its cutting gets this deep at most). */
export const CANAL_MAX_CUT = 4;
/** Ground height along the quays (matches the quay top in water-geometry.ts). */
const CANAL_QUAY_TOP = 0.12;

function stampCanal(grid: DepthGrid, canal: Canal) {
  const radius = HALF_WIDTH[canal.kind] + CANAL_CARVE_EXTRA;
  const frames = buildFrames(canal.points, canal.kind);
  const first = frames[0];
  const last = frames[frames.length - 1];
  // Square ends: nothing is dug beyond the end walls.
  const inside = (px: number, pz: number) =>
    (px - first.p.x) * first.t.x + (pz - first.p.z) * first.t.z >= -CANAL_CARVE_EXTRA &&
    (px - last.p.x) * last.t.x + (pz - last.p.z) * last.t.z <= CANAL_CARVE_EXTRA;
  for (const f of frames) stampDisc(grid, f.p.x, f.p.z, radius, () => CANAL_DEPTH, inside);
  // In gently rolling lowland the canal runs in a cutting: the ground beside the quays is
  // lowered to quay height and rises again with a 1:1 slope (only ever dug, never filled).
  const flat = OUTER_HALF_WIDTH[canal.kind] + 0.5;
  for (const f of frames) stampDisc(grid, f.p.x, f.p.z, flat + CANAL_MAX_CUT + 1, (d) => -(CANAL_QUAY_TOP + Math.max(0, d - flat)));
}

let cache: { key: string; grid: DepthGrid } | null = null;

/** Depth grid of natural water plus the given (finished) canals. Cached per canal set. */
export function depthGrid(canals: Canal[]): DepthGrid {
  const key = `${worldSeed}#` + canals.map((c) => `${c.id}:${c.points.length}`).join("|");
  if (cache && cache.key === key) return cache.grid;
  const base = naturalDepthGrid();
  const grid = canals.length === 0 ? base : new Float32Array(base);
  for (const c of canals) stampCanal(grid, c);
  cache = { key, grid };
  return grid;
}

/* ---------- sampling ---------- */

/** Bilinear depth at a world position; 0 outside the world. */
export function sampleDepth(grid: DepthGrid, x: number, z: number): number {
  const fc = toCol(x);
  const fr = toCol(z);
  if (fc < 0 || fr < 0 || fc >= TERRAIN_N - 1 || fr >= TERRAIN_N - 1) return 0;
  const c = Math.floor(fc);
  const r = Math.floor(fr);
  const u = fc - c;
  const v = fr - r;
  const a = grid[index(c, r)];
  const b = grid[index(c + 1, r)];
  const d = grid[index(c, r + 1)];
  const e = grid[index(c + 1, r + 1)];
  return (a * (1 - u) + b * u) * (1 - v) + (d * (1 - u) + e * u) * v;
}

/** Terrain height (y) at a world position. */
export const terrainHeight = (grid: DepthGrid, x: number, z: number) => -sampleDepth(grid, x, z);

/** True if the ground at (x, z) is below the water surface. */
export const isWet = (grid: DepthGrid, x: number, z: number) => sampleDepth(grid, x, z) > WET_DEPTH;

/* ---------- cuttings along paths ---------- */

/** A path's surface sampled every few metres, used to cut the terrain down to it. */
export interface CutLine {
  points: { x: number; z: number; y: number }[];
  /** Half width that has to be level (asphalt / ballast plus shoulder). */
  half: number;
  /** Below this depth under the terrain the path is in a tunnel: no cutting there. */
  tunnelCover: number;
}

/**
 * Terrain lowered along paths that run below it (cuttings), as economy simulators do when
 * a road is laid into a slope: level under the path, then 1:1 side slopes up to the
 * natural ground. Tunnels (deeper than `tunnelCover`) are left alone, and the plain is not
 * touched. Returns a new grid; the input is not modified.
 */
export function cutTerrain(grid: DepthGrid, lines: CutLine[]): DepthGrid {
  let out: DepthGrid | null = null;
  for (const line of lines) {
    for (const p of line.points) {
      const ground = -sampleDepth(grid, p.x, p.z);
      const cover = ground - p.y;
      if (ground < 0.3 || cover < -0.6 || cover > line.tunnelCover) continue;
      out ??= new Float32Array(grid);
      const reach = line.half + 1 + Math.max(0, cover) + 2;
      const target = (d: number) => p.y - 0.06 + Math.max(0, d - line.half - 0.5);
      stampDisc(out, p.x, p.z, reach, (d) => -target(d));
    }
  }
  return out ?? grid;
}

/* ---------- levelled plots (airport) ---------- */

/** A rectangular plot whose ground is levelled to height y. */
export interface Pad {
  x: number;
  z: number;
  rot: number;
  w: number;
  d: number;
  y: number;
  /** How far the side slopes may reach (m); default PAD_REACH. */
  reach?: number;
  /** Flat margin around the plot (m); default PAD_MARGIN. */
  margin?: number;
}
/** Side slopes around a levelled plot (horizontal : vertical), and how far they may reach. */
const PAD_SLOPE = 1.5;
const PAD_REACH = 160;
/** Level margin around the plot, so grid cells at its edge are flat too. */
const PAD_MARGIN = 2;

/**
 * Terrain levelled under big plots: hills are cut down and hollows filled to the plot
 * height, with 1 : 1.5 slopes back to the natural ground (mountains get a cutting, valleys
 * an embankment). Water outside the plot is left alone. Returns a new grid.
 */
export function levelPads(grid: DepthGrid, pads: Pad[]): DepthGrid {
  if (pads.length === 0) return grid;
  const out = new Float32Array(grid);
  for (const p of pads) {
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    const reach = p.reach ?? PAD_REACH;
    const hw = p.w / 2 + (p.margin ?? PAD_MARGIN);
    const hd = p.d / 2 + (p.margin ?? PAD_MARGIN);
    const r = Math.hypot(hw, hd) + reach;
    const c0 = Math.max(0, Math.floor(toCol(p.x - r)));
    const c1 = Math.min(TERRAIN_N - 1, Math.ceil(toCol(p.x + r)));
    const r0 = Math.max(0, Math.floor(toCol(p.z - r)));
    const r1 = Math.min(TERRAIN_N - 1, Math.ceil(toCol(p.z + r)));
    for (let row = r0; row <= r1; row++) {
      const pz = row * TERRAIN_RES - WORLD_HALF;
      for (let col = c0; col <= c1; col++) {
        const px = col * TERRAIN_RES - WORLD_HALF;
        // Local plot axes as in insideFootprint (economy.ts).
        const dx = px - p.x;
        const dz = pz - p.z;
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        const dist = Math.hypot(Math.max(0, Math.abs(lx) - hw), Math.max(0, Math.abs(lz) - hd));
        if (dist > reach) continue;
        const i = index(col, row);
        if (dist > 0 && out[i] > WET_DEPTH) continue;
        const ground = -out[i];
        const h = dist === 0 ? p.y : ground > p.y ? Math.min(ground, p.y + dist / PAD_SLOPE) : Math.max(ground, p.y - dist / PAD_SLOPE);
        out[i] = -h;
      }
    }
  }
  return out;
}

/**
 * First point where a ray hits the terrain (marching, then bisection), or null.
 * Lets the build cursor land on mountains instead of the y = 0 plane.
 */
export function raycastTerrain(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  grid: DepthGrid,
  maxDist = 3000,
): { x: number; y: number; z: number } | null {
  const at = (t: number) => ({ x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t });
  const above = (t: number) => {
    const p = at(t);
    return p.y > -sampleDepth(grid, p.x, p.z);
  };
  if (!above(0)) return null;
  let prev = 0;
  for (let t = 4; t <= maxDist; t += 4) {
    if (!above(t)) {
      let lo = prev;
      let hi = t;
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        if (above(mid)) lo = mid;
        else hi = mid;
      }
      return at(hi);
    }
    prev = t;
  }
  return null;
}
