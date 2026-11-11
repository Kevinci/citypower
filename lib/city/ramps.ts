import { buildFrames, cumulative, type Frame } from "./road-geometry";
import { sampleDepth, type DepthGrid } from "./terrain";
import type { Road, Vec2 } from "./types";

/**
 * Shared building blocks for motorway ramps (interchanges, cloverleaf, trumpet).
 *
 * German practice (RAA): exits and entries are *parallel* lanes beside the carriageway
 * (Ausfädelungs-/Einfädelungsstreifen, typically ~250 m) with a short taper
 * (Verziehung) where they start/end, not diagonal cuts across the lanes. Our world is
 * smaller than reality, so lengths are scaled down but keep the proportions.
 */

/** Lateral position of a ramp lane centre beside the motorway (edge 12.3 m + half lane). */
export const RAMP_LANE_V = 15.5;
/** Where the taper starts: just outside the motorway's edge line. */
const TAPER_V = 11.5;
/** Taper (Verziehung) and parallel lane (Aus-/Einfädelungsstreifen) lengths in metres. */
export const TAPER_LENGTH = 30;
export const PARALLEL_LENGTH = 60;

export interface Axis {
  road: Road;
  frames: Frame[];
  dist: number[];
  /** Station of the reference point (the crossing). */
  s: number;
  length: number;
}

export function axisOf(road: Road, x: number, z: number): Axis {
  const frames = buildFrames(road.points, road.kind);
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
  return { road, frames, dist, s: dist[best], length: dist[dist.length - 1] };
}

export function frameAt(a: Axis, s: number): Frame {
  let i = 0;
  while (i < a.dist.length - 1 && a.dist[i + 1] < s) i++;
  return a.frames[i];
}

/** Room along the axis from the reference point in travel direction `dir`. */
export const roomAhead = (a: Axis, dir: number) => (dir > 0 ? a.length - a.s : a.s);

/**
 * Point on a motorway `coord` metres from the reference point along travel direction
 * `dir` (+1 / −1 relative to the road's own direction), `lateral` metres to the right.
 */
export function onAxis(a: Axis, dir: number, coord: number, lateral: number): Vec2 {
  const f = frameAt(a, a.s + dir * coord);
  return { x: f.p.x + f.n.x * dir * lateral, z: f.p.z + f.n.z * dir * lateral };
}

/**
 * Exit: taper out of the carriageway starting at `coord`, then a parallel lane. Returns the
 * first points of a ramp, in travel direction; the ramp continues from the last one.
 */
export function exitLane(a: Axis, dir: number, coord: number, parallel = PARALLEL_LENGTH): Vec2[] {
  return [
    onAxis(a, dir, coord, TAPER_V),
    onAxis(a, dir, coord + TAPER_LENGTH, RAMP_LANE_V),
    onAxis(a, dir, coord + TAPER_LENGTH + parallel, RAMP_LANE_V),
  ];
}

/** Entry: a parallel lane ending in a taper at `coord` (the last points of a ramp). */
export function entryLane(a: Axis, dir: number, coord: number, parallel = PARALLEL_LENGTH): Vec2[] {
  return [
    onAxis(a, dir, coord - TAPER_LENGTH - parallel, RAMP_LANE_V),
    onAxis(a, dir, coord - TAPER_LENGTH, RAMP_LANE_V),
    onAxis(a, dir, coord, TAPER_V),
  ];
}

/** True if a polyline runs through water anywhere (sampled every 3 m). */
export function crossesWater(points: Vec2[], grid: DepthGrid) {
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i];
    const q = points[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 3));
    for (let k = 0; k <= steps; k++) {
      if (sampleDepth(grid, p.x + ((q.x - p.x) * k) / steps, p.z + ((q.z - p.z) * k) / steps) > 0.2) return true;
    }
  }
  return false;
}

type V = { x: number; z: number };
/** Linear combination of 2D vectors: Σ k·v. */
export const comb = (...vs: [V, number][]): Vec2 => ({
  x: vs.reduce((acc, [v, k]) => acc + v.x * k, 0),
  z: vs.reduce((acc, [v, k]) => acc + v.z * k, 0),
});
export const rightOf = (d: V): V => ({ x: -d.z, z: d.x });

/** Points on a circular arc around `centre` from angle a0 to a1 (radians, step ~15°). */
export function arc(centre: V, u: V, w: V, radius: number, a0: number, a1: number): Vec2[] {
  const steps = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 12)));
  const out: Vec2[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = a0 + ((a1 - a0) * k) / steps;
    out.push(comb([centre, 1], [u, Math.cos(t) * radius], [w, Math.sin(t) * radius]));
  }
  return out;
}
