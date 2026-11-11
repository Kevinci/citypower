import { findCrossings } from "./network";
import { buildFrames, cumulative, type Elevation, type Frame } from "./road-geometry";
import { sampleDepth, WATER_LEVEL, type DepthGrid } from "./terrain";
import { NETWORK_OF, OUTER_HALF_WIDTH, type BuildKind, type Path } from "./types";

/**
 * Grade separation: decides where roads and tracks must leave the ground and computes a
 * height profile for each of them.
 *
 * A path rises where it
 *  - crosses water: navigable water (rivers, lakes, canals) needs 6 m clearance above the
 *    water surface for ships, small streams 1.8 m;
 *  - crosses another path that must not be crossed at grade (anything × highway, or any
 *    pair the player decided to separate). The upper path then keeps the clearance of the
 *    lower one: 4.7 m for roads (lorries), 6.4 m for railways (trains + catenary).
 * Between those spans the path climbs and descends on ramps with a realistic maximum
 * gradient per kind and rounded vertical curves.
 */

/** Order-independent key for a pair of path ids. */
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Player decisions: pair key → id of the path that goes over. */
export type Separations = Record<string, string>;

/** True if two kinds may meet at grade (junction, switch or level crossing). */
export function crossesAtGrade(a: BuildKind, b: BuildKind): boolean {
  if (NETWORK_OF[a] === "water" || NETWORK_OF[b] === "water") return false;
  // Motorways are grade-separated from everything except their own ramps.
  if (a === "highway" || b === "highway") return a === b || a === "ramp" || b === "ramp";
  return true;
}

/**
 * True if two kinds may cross each other at grade (a crossing in the middle of both, as
 * opposed to joining at a shared end). Motorways never cross anything at grade – two
 * motorways crossing need an interchange structure.
 */
export function crossesLevel(a: BuildKind, b: BuildKind): boolean {
  if (a === "highway" || b === "highway") return false;
  return crossesAtGrade(a, b);
}

/** Without a player decision the lighter structure goes over (a street over a motorway). */
const RANK: Record<BuildKind, number> = { bike: 0, street: 1, ramp: 1, rail: 2, rail2: 2, highway: 3, canal: 4 };

/** The path that bridges over the other, or null if they cross at grade. */
export function overOf(a: Path, b: Path, seps: Separations): Path | null {
  const decided = seps[pairKey(a.id, b.id)];
  if (decided === a.id) return a;
  if (decided === b.id) return b;
  if (crossesLevel(a.kind, b.kind)) return null;
  return RANK[a.kind] <= RANK[b.kind] ? a : b;
}

/** Structural depth of the deck below the running surface, in metres. */
export const DECK_DEPTH: Record<BuildKind, number> = {
  street: 1.3,
  highway: 1.6,
  bike: 0.8,
  ramp: 1.2,
  rail: 1.7,
  rail2: 1.9,
  canal: 0,
};

/** Free height that has to stay open above a path that is crossed over. */
const CLEARANCE: Record<BuildKind, number> = {
  street: 4.7,
  highway: 4.7,
  bike: 3,
  ramp: 4.7,
  rail: 6.4,
  rail2: 6.4,
  canal: 6,
};

/** Maximum ramp gradient (rise per metre). */
const GRADIENT: Record<BuildKind, number> = {
  street: 0.07,
  highway: 0.045,
  bike: 0.06,
  ramp: 0.06,
  rail: 0.03,
  rail2: 0.03,
  canal: 0,
};

const SHIP_CLEARANCE = 6;
const STREAM_CLEARANCE = 1.8;
/** Water this deep somewhere along the crossing counts as navigable. */
const NAVIGABLE_DEPTH = 2.4;
const NAVIGABLE_WIDTH = 12;
/** Ground deeper than this under a path needs a bridge. */
const WET = 0.45;
/** A path higher than this at a crossing cannot meet the other path at grade. */
export const LIFTED = 0.5;
/** Radius (m) of the moving average that rounds the vertical curves. */
const SMOOTH_RADIUS = 7;

export interface Opening {
  /** Span from s0 to s1 (metres along the path) that must stay open below the deck. */
  s0: number;
  s1: number;
  /** Surface height required inside the span. */
  height: number;
  kind: "water" | "crossing";
  /** Ships pass below: no piers in the channel, arch for long spans. */
  navigable: boolean;
  /** The path crossed below (for crossings). */
  under?: Path;
}

export interface Profile extends Elevation {
  length: number;
  /** Surface height every metre. */
  heights: Float32Array;
  openings: Opening[];
  /** Highest point of the profile. */
  max: number;
}

function makeProfile(heights: Float32Array, openings: Opening[]): Profile {
  let max = 0;
  let flat = true;
  for (const h of heights) {
    max = Math.max(max, h);
    if (h !== 0) flat = false;
  }
  const length = heights.length - 1;
  return {
    length,
    heights,
    openings,
    max: flat ? 0 : Math.max(max, 1e-3),
    heightAt(s: number) {
      if (flat) return 0;
      const x = Math.min(length, Math.max(0, s));
      const i = Math.floor(x);
      const t = x - i;
      const a = heights[i];
      const b = heights[Math.min(length, i + 1)];
      return a + (b - a) * t;
    },
  };
}

export const FLAT: Profile = makeProfile(new Float32Array(1), []);

interface Prepared {
  path: Path;
  frames: Frame[];
  dist: number[];
  length: number;
  water: Opening[];
  /** Natural terrain height under the centre line, every metre. */
  ground: Float32Array;
  /** Drivable height following the terrain within the kind's gradient, every metre. */
  base: Float32Array;
}

/** Terrain under a path's centre line, sampled every metre. */
function groundAlong(frames: Frame[], dist: number[], length: number, grid: DepthGrid): Float32Array {
  const n = Math.max(1, Math.ceil(length)) + 1;
  const out = new Float32Array(n);
  let i = 0;
  for (let s = 0; s < n; s++) {
    while (i < dist.length - 2 && dist[i + 1] < s) i++;
    const f0 = frames[i];
    const f1 = frames[Math.min(frames.length - 1, i + 1)];
    const span = dist[Math.min(dist.length - 1, i + 1)] - dist[i];
    const t = span > 0 ? Math.min(1, Math.max(0, (s - dist[i]) / span)) : 0;
    out[s] = -sampleDepth(grid, f0.p.x + (f1.p.x - f0.p.x) * t, f0.p.z + (f1.p.z - f0.p.z) * t);
  }
  return out;
}

/**
 * Drivable profile over terrain, as in economy simulators: the mean of the lowest profile
 * that never goes below the ground (U: bridges over every valley) and the highest one that
 * never goes above it (D: tunnels through every hill), both limited to gradient g. Where
 * the terrain is gentle both equal the terrain, so the path simply lies on it; across steep
 * valleys and ridges the path runs between – on embankments or viaducts, in cuttings or
 * tunnels.
 */
export function terrainBase(ground: Float32Array, g: number): Float32Array {
  const n = ground.length;
  const up = Float32Array.from(ground);
  const down = Float32Array.from(ground);
  for (let i = 1; i < n; i++) {
    up[i] = Math.max(up[i], up[i - 1] - g);
    down[i] = Math.min(down[i], down[i - 1] + g);
  }
  for (let i = n - 2; i >= 0; i--) {
    up[i] = Math.max(up[i], up[i + 1] - g);
    down[i] = Math.min(down[i], down[i + 1] + g);
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Flat lowland stays exactly at 0 (keeps lowland paths on the FLAT fast path).
    const v = (up[i] + down[i]) / 2;
    out[i] = Math.abs(v) < 0.05 && Math.abs(ground[i]) < 0.3 ? 0 : v;
  }
  return out;
}

/** Terrain-following profile for a single path (drawing previews). */
export function terrainProfile(path: Path, grid: DepthGrid): Profile {
  const frames = buildFrames(path.points, path.kind);
  if (frames.length < 2) return FLAT;
  const dist = cumulative(frames);
  const ground = groundAlong(frames, dist, dist[dist.length - 1], grid);
  return makeProfile(terrainBase(ground, GRADIENT[path.kind]), []);
}

/** Openings over water found by walking the path through the depth grid. */
function waterOpenings(path: Path, frames: Frame[], dist: number[], grid: DepthGrid): Opening[] {
  const outer = OUTER_HALF_WIDTH[path.kind];
  const depthAt = (i: number, o: number) => {
    const f = frames[i];
    return sampleDepth(grid, f.p.x + f.n.x * o, f.p.z + f.n.z * o);
  };
  const wet = frames.map((_, i) => [0, -outer, outer].some((o) => depthAt(i, o) > WET));
  const out: Opening[] = [];
  let start = -1;
  for (let i = 0; i <= frames.length; i++) {
    if (i < frames.length && wet[i]) {
      if (start < 0) start = i;
      continue;
    }
    if (start < 0) continue;
    const end = i - 1;
    // Water touching a path end is not crossed: the path stops at the bank.
    if (start > 0 && end < frames.length - 1) {
      let maxDepth = 0;
      for (let k = start; k <= end; k++) maxDepth = Math.max(maxDepth, depthAt(k, 0));
      const width = dist[end] - dist[start];
      const navigable = maxDepth >= NAVIGABLE_DEPTH || width >= NAVIGABLE_WIDTH;
      // Widen to the top of the banks so abutments stand on dry ground.
      let a = start;
      let b = end;
      while (a > 0 && depthAt(a - 1, 0) > 0.05) a--;
      while (b < frames.length - 1 && depthAt(b + 1, 0) > 0.05) b++;
      out.push({
        s0: Math.max(0, dist[a] - 2),
        s1: Math.min(dist[dist.length - 1], dist[b] + 2),
        height: WATER_LEVEL + (navigable ? SHIP_CLEARANCE : STREAM_CLEARANCE) + DECK_DEPTH[path.kind],
        kind: "water",
        navigable,
      });
    }
    start = -1;
  }
  return out;
}

/** Distance along a path of the frame closest to (x, z). */
function stationOf(prep: Prepared, x: number, z: number) {
  let best = 0;
  let bestD = Infinity;
  prep.frames.forEach((f, i) => {
    const d = (f.p.x - x) ** 2 + (f.p.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return prep.dist[best];
}

/** A point where a path must have a given height (junction or ramp attachment). */
interface NodeTarget {
  s: number;
  h: number;
}

/** Forces h to `target` at `node`, limiting the slope away from it to g·1.5. */
function clampToNodes(h: Float32Array, nodes: NodeTarget[], g: number) {
  const G = g * 1.5;
  for (const node of nodes) {
    for (let s = 0; s < h.length; s++) {
      const d = Math.abs(s - node.s);
      h[s] = Math.min(Math.max(h[s], node.h - G * d), node.h + G * d);
    }
  }
}

/** Heights every metre from openings and node targets: plateaus, ramps, rounded curves. */
function solve(prep: Prepared, openings: Opening[], nodes: NodeTarget[]): Float32Array {
  const n = Math.max(1, Math.ceil(prep.length)) + 1;
  const g = GRADIENT[prep.path.kind];
  const base = prep.base;
  const h = new Float32Array(n);
  const flatBase = base.every((v) => v === 0);
  if (flatBase && openings.length === 0 && nodes.every((node) => Math.abs(node.h) < 0.02)) return h;
  for (let s = 0; s < n; s++) {
    let v = base[Math.min(base.length - 1, s)];
    for (const o of openings) {
      const d = s < o.s0 ? o.s0 - s : s > o.s1 ? s - o.s1 : 0;
      v = Math.max(v, o.height - g * d);
    }
    h[s] = v;
  }
  // Junctions: every path meeting there has the same height (the ramp gets a little
  // steeper if it must).
  clampToNodes(h, nodes, g);
  // Rounded vertical curves: two passes of a moving average.
  let cur = h;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(n);
    for (let s = 0; s < n; s++) {
      let sum = 0;
      let cnt = 0;
      for (let k = -SMOOTH_RADIUS; k <= SMOOTH_RADIUS; k++) {
        const j = s + k;
        if (j < 0 || j >= n) continue;
        sum += cur[j];
        cnt++;
      }
      next[s] = sum / cnt;
    }
    cur = next;
  }
  // Spans keep their full height; junction heights stay exact.
  for (const o of openings) {
    for (let s = Math.max(0, Math.floor(o.s0)); s <= Math.min(n - 1, Math.ceil(o.s1)); s++) {
      cur[s] = Math.max(cur[s], o.height);
    }
  }
  clampToNodes(cur, nodes, g);
  // Lowland paths never sink below the plain; elsewhere the terrain profile rules.
  for (let s = 0; s < n; s++) {
    if (cur[s] < 0.02 && prep.ground[Math.min(prep.ground.length - 1, s)] < 0.3) cur[s] = Math.max(0, cur[s]) < 0.02 ? 0 : cur[s];
  }
  return cur;
}

/** A junction or attachment seen from one path. */
interface NodeLink {
  s: number;
  /** Other paths at this node and their stations. */
  partners: { prep: Prepared; s: number }[];
  /** true: only this path follows the partner's height (ramp on a motorway). */
  follow: boolean;
}

/** Ramp ends closer than this to a motorway centre line are attached to it. */
const RAMP_ATTACH = 14;

/**
 * Height profiles for all roads and tracks. Canals are never lifted.
 * Paths that stay on the ground get FLAT.
 */
export function computeProfiles(paths: Path[], grid: DepthGrid, seps: Separations): Map<string, Profile> {
  const preps = new Map<string, Prepared>();
  for (const path of paths) {
    if (NETWORK_OF[path.kind] === "water") continue;
    const frames = buildFrames(path.points, path.kind);
    if (frames.length < 2) continue;
    const dist = cumulative(frames);
    const length = dist[dist.length - 1];
    const ground = groundAlong(frames, dist, length, grid);
    const base = NETWORK_OF[path.kind] === "water" ? ground : terrainBase(ground, GRADIENT[path.kind]);
    preps.set(path.id, { path, frames, dist, length, water: [], ground, base });
  }
  for (const prep of preps.values()) prep.water = waterOpenings(prep.path, prep.frames, prep.dist, grid);
  const list = [...preps.values()];

  // Junctions: control points shared with paths this one may join at grade.
  const links = new Map<string, NodeLink[]>();
  const sharedPoint = (a: Path, b: Path, x: number, z: number) =>
    a.points.some((p) => Math.hypot(p.x - x, p.z - z) < 0.5) && b.points.some((p) => Math.hypot(p.x - x, p.z - z) < 0.5);
  for (const a of list) {
    const out: NodeLink[] = [];
    for (const q of a.path.points) {
      const partners: NodeLink["partners"] = [];
      for (const b of list) {
        if (a === b || !crossesAtGrade(a.path.kind, b.path.kind)) continue;
        if (b.path.points.some((p) => Math.hypot(p.x - q.x, p.z - q.z) < 0.5)) {
          partners.push({ prep: b, s: stationOf(b, q.x, q.z) });
        }
      }
      if (partners.length > 0) out.push({ s: stationOf(a, q.x, q.z), partners, follow: false });
    }
    // Ramp ends lying on a motorway take the motorway's height there.
    if (a.path.kind === "ramp") {
      for (const end of [a.path.points[0], a.path.points[a.path.points.length - 1]]) {
        for (const m of list) {
          if (m.path.kind !== "highway") continue;
          const sm = stationOf(m, end.x, end.z);
          const f = m.frames[m.dist.findIndex((d) => d >= sm)] ?? m.frames[m.frames.length - 1];
          if (Math.hypot(f.p.x - end.x, f.p.z - end.z) > RAMP_ATTACH) continue;
          out.push({ s: stationOf(a, end.x, end.z), partners: [{ prep: m, s: sm }], follow: true });
        }
      }
    }
    links.set(a.path.id, out);
  }

  const heightIn = (heights: Map<string, Float32Array>, prep: Prepared, s: number) => {
    const h = heights.get(prep.path.id);
    return h ? h[Math.min(h.length - 1, Math.max(0, Math.round(s)))] : 0;
  };

  /** Openings where a path bridges another, from the current heights. */
  const pathsOnly = list.map((p) => p.path);
  const allCrossings = findCrossings(pathsOnly, pathsOnly).filter((c) => c.a < c.b);
  const crossingOpenings = (heights: Map<string, Float32Array>) => {
    const extra = new Map<string, Opening[]>();
    for (const c of allCrossings) {
      const pa = preps.get(c.a);
      const pb = preps.get(c.b);
      if (!pa || !pb) continue;
      // A shared point is a junction, not a crossing.
      if (sharedPoint(pa.path, pb.path, c.x, c.z)) continue;
      let over = overOf(pa.path, pb.path, seps);
      if (!over) {
        // An at-grade pair still needs a bridge if one of them is already lifted here
        // (e.g. a street meeting a track on its ramp): the higher one goes over.
        const sa = stationOf(pa, c.x, c.z);
        const sb = stationOf(pb, c.x, c.z);
        // Height above the terrain, not above sea level (paths in the mountains lie high).
        const ha = heightIn(heights, pa, sa) - pa.ground[Math.min(pa.ground.length - 1, Math.round(sa))];
        const hb = heightIn(heights, pb, sb) - pb.ground[Math.min(pb.ground.length - 1, Math.round(sb))];
        if (Math.max(ha, hb) < LIFTED) continue;
        over = ha >= hb ? pa.path : pb.path;
      }
      const upper = over === pa.path ? pa : pb;
      const lower = over === pa.path ? pb : pa;
      const s = stationOf(upper, c.x, c.z);
      const half = (OUTER_HALF_WIDTH[lower.path.kind] + 1.5) / c.sin + 1;
      const ground = heightIn(heights, lower, stationOf(lower, c.x, c.z));
      const opening: Opening = {
        s0: Math.max(0, s - half),
        s1: Math.min(upper.length, s + half),
        height: ground + CLEARANCE[lower.path.kind] + DECK_DEPTH[upper.path.kind],
        kind: "crossing",
        navigable: false,
        under: lower.path,
      };
      const listFor = extra.get(upper.path.id) ?? [];
      listFor.push(opening);
      extra.set(upper.path.id, listFor);
    }
    return extra;
  };

  /** Node targets from the current heights: the highest path at a junction wins. */
  const targets = (prep: Prepared, heights: Map<string, Float32Array>): NodeTarget[] =>
    (links.get(prep.path.id) ?? []).map((link) => {
      const others = link.partners.map((p) => heightIn(heights, p.prep, p.s));
      const h = link.follow ? Math.max(...others) : Math.max(heightIn(heights, prep, link.s), ...others);
      return { s: link.s, h };
    });

  // Pass 1: terrain and water only. Then two rounds of crossings + junction heights, so lifted
  // junctions and stacked crossings settle.
  let heights = new Map<string, Float32Array>();
  for (const prep of list) heights.set(prep.path.id, solve(prep, prep.water, []));
  let extra = new Map<string, Opening[]>();
  for (let round = 0; round < 2; round++) {
    extra = crossingOpenings(heights);
    const next = new Map<string, Float32Array>();
    for (const prep of list) {
      const openings = [...prep.water, ...(extra.get(prep.path.id) ?? [])];
      next.set(prep.path.id, solve(prep, openings, targets(prep, heights)));
    }
    heights = next;
  }

  const out = new Map<string, Profile>();
  for (const prep of list) {
    const h = heights.get(prep.path.id);
    const openings = [...prep.water, ...(extra.get(prep.path.id) ?? [])].sort((x, y) => x.s0 - y.s0);
    if (!h || h.every((v) => v === 0)) {
      out.set(prep.path.id, FLAT);
      continue;
    }
    out.set(prep.path.id, makeProfile(h, openings));
  }
  return out;
}

/** Height of a path's surface at the frame closest to (x, z). */
export function heightAtPoint(path: Path, profile: Profile, x: number, z: number): number {
  if (profile.max === 0) return 0;
  const frames = buildFrames(path.points, path.kind);
  const dist = cumulative(frames);
  let best = 0;
  let bestD = Infinity;
  frames.forEach((f, i) => {
    const d = (f.p.x - x) ** 2 + (f.p.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return profile.heightAt(dist[best]);
}

/** Height of a path above the terrain at the point closest to (x, z) (negative: tunnel/cut). */
export function liftAtPoint(path: Path, profile: Profile, x: number, z: number, grid: DepthGrid): number {
  return heightAtPoint(path, profile, x, z) + sampleDepth(grid, x, z);
}
