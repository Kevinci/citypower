import { FLAT, overOf, type Profile, type Separations } from "./grade";
import { findCrossings } from "./network";
import { buildFrames, cumulative, type Frame } from "./road-geometry";
import { sampleDepth, type DepthGrid } from "./terrain";
import { RAMP_LANE_V } from "./ramps";
import type { Path, Road, Vec2 } from "./types";

/**
 * Motorway junction ("Anschlussstelle", diamond layout) at a crossing of a motorway with a
 * street that is grade-separated from it.
 *
 * Four one-way ramps, one per quadrant. Each one leaves (or joins) the motorway on a long
 * taper along the outer lane, runs parallel to the motorway, turns diagonally away and
 * meets the street at a T-junction where the street is back on the ground (beyond the
 * bridge ramps), so ramps never have to climb onto a bridge.
 *
 * Local coordinates: u along the motorway (t), v across it (n). In Germany traffic keeps
 * right, so traffic travelling in +t uses the +n carriageway: its exit ramp lies at u < 0,
 * its entry ramp at u > 0 – all four quadrants get one ramp.
 */

/** Click must be this close to the crossing. */
const PICK_RADIUS = 45;
/** Lateral position of the ramp start on the motorway (outer lane / shoulder). */
const TAPER_START_V = 11.5;
/** Lateral position of the parallel exit/entry lane beside the motorway. */
const PARALLEL_V = RAMP_LANE_V;
/** Taper (Verziehung) and parallel lane (Ausfädelungsstreifen) lengths, see ramps.ts. */
const TAPER_LENGTH = 30;
const PARALLEL_LENGTH = 25;
/** The taper must start at least this far from the crossing, even on a short motorway. */
const MIN_TAPER_DISTANCE = 50;
/** Straight piece before the T-junction with the street. */
const APPROACH = 30;
/** Ramps meet the street at least this far from the motorway centre. */
const MIN_STREET_DISTANCE = 45;
/** Farther than this the street is not usable for a junction on that side. */
const MAX_STREET_DISTANCE = 170;

/** True if a polyline runs through water anywhere (sampled every 2 m). */
function crossesWater(points: Vec2[], grid: DepthGrid) {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2);
    for (let k = 0; k <= steps; k++) {
      const x = a.x + ((b.x - a.x) * k) / steps;
      const z = a.z + ((b.z - a.z) * k) / steps;
      if (sampleDepth(grid, x, z) > 0.2) return true;
    }
  }
  return false;
}

interface Station {
  frames: Frame[];
  dist: number[];
  s: number;
  index: number;
}

function station(road: Road, x: number, z: number): Station {
  const frames = buildFrames(road.points, road.kind);
  const dist = cumulative(frames);
  let index = 0;
  let best = Infinity;
  frames.forEach((f, i) => {
    const d = (f.p.x - x) ** 2 + (f.p.z - z) ** 2;
    if (d < best) {
      best = d;
      index = i;
    }
  });
  return { frames, dist, s: dist[index], index };
}

function frameAtS(st: Station, s: number, clamp = false): Frame | null {
  const length = st.dist[st.dist.length - 1];
  if (clamp) s = Math.min(length, Math.max(0, s));
  if (s < 0 || s > length) return null;
  let i = 0;
  while (i < st.dist.length - 1 && st.dist[i + 1] < s) i++;
  return st.frames[i];
}

/** Distance from s along `dir` until the profile is back on the ground (at least `min`). */
function groundDistance(profile: Profile, s: number, dir: number, min: number, length: number) {
  for (let d = min; d < length; d += 1) {
    const x = s + dir * d;
    if (x < 0 || x > length) return null;
    if (profile.heightAt(x) < 0.05) return d;
  }
  return null;
}

export interface InterchangePlan {
  street: Road;
  highway: Road;
  /** Ramp polylines in travel direction (exit: motorway → street, entry: street → motorway). */
  ramps: Vec2[][];
}

/** Plans the four ramps for the motorway × street crossing nearest to `click`, or null. */
export function planInterchange(
  click: Vec2,
  roads: Road[],
  profiles: Map<string, Profile>,
  seps: Separations,
  grid: DepthGrid,
  /** Everything else built (tracks, canals): ramps must not cut through them. */
  obstacles: Path[] = [],
): InterchangePlan | null {
  const highways = roads.filter((r) => r.kind === "highway");
  const streets = roads.filter((r) => r.kind === "street");
  let pick: { x: number; z: number; highway: Road; street: Road } | null = null;
  let bestD = PICK_RADIUS;
  for (const c of findCrossings(highways, streets)) {
    const highway = highways.find((h) => h.id === c.a);
    const street = streets.find((s) => s.id === c.b);
    if (!highway || !street || !overOf(highway, street, seps)) continue;
    const d = Math.hypot(c.x - click.x, c.z - click.z);
    if (d < bestD) {
      bestD = d;
      pick = { x: c.x, z: c.z, highway, street };
    }
  }
  if (!pick) return null;

  const { highway, street } = pick;
  const hs = station(highway, pick.x, pick.z);
  const ss = station(street, pick.x, pick.z);
  const hProfile = profiles.get(highway.id) ?? FLAT;
  const sProfile = profiles.get(street.id) ?? FLAT;
  const hLength = hs.dist[hs.dist.length - 1];
  const sLength = ss.dist[ss.dist.length - 1];
  const centre = hs.frames[hs.index];
  const t = centre.t;
  const n = centre.n;
  const C = { x: pick.x, z: pick.z };
  const local = (p: Vec2) => ({
    u: (p.x - C.x) * t.x + (p.z - C.z) * t.z,
    v: (p.x - C.x) * n.x + (p.z - C.z) * n.z,
  });

  // Where the street is back on the ground, on both sides of the motorway.
  const streetEnds = new Map<number, { q: Frame; v: number }>();
  for (const dir of [-1, 1]) {
    const d = groundDistance(sProfile, ss.s, dir, MIN_STREET_DISTANCE, sLength);
    if (d === null) continue;
    const q = frameAtS(ss, ss.s + dir * (d + 6));
    if (!q) continue;
    const v = local({ x: q.p.x, z: q.p.z }).v;
    if (Math.abs(v) > MAX_STREET_DISTANCE) continue;
    streetEnds.set(Math.sign(v), { q, v: Math.abs(v) });
  }

  // How far along the motorway it is still lifted (if it bridges the street instead).
  const motorwayClear = new Map<number, number>();
  for (const dir of [-1, 1]) {
    motorwayClear.set(dir, groundDistance(hProfile, hs.s, dir, 0, hLength) ?? Infinity);
  }

  const ramps: Vec2[][] = [];
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      const end = streetEnds.get(b);
      if (!end) continue;
      const U = Math.max(end.v, motorwayClear.get(a) ?? 0);
      // Short motorway: the ramp starts at its end instead.
      const f0 = frameAtS(hs, hs.s + a * (U + PARALLEL_LENGTH + TAPER_LENGTH), true);
      const f1 = frameAtS(hs, hs.s + a * (U + 10), true);
      if (!f0 || !f1) continue;
      const d0 = Math.abs(local({ x: f0.p.x, z: f0.p.z }).u);
      const d1 = Math.abs(local({ x: f1.p.x, z: f1.p.z }).u);
      if (d0 < MIN_TAPER_DISTANCE || d0 - d1 < 15) continue;
      // Frames' n may point either way relative to the crossing's n.
      const side0 = Math.sign(f0.n.x * n.x + f0.n.z * n.z) * b;
      const side1 = Math.sign(f1.n.x * n.x + f1.n.z * n.z) * b;
      const p0 = { x: f0.p.x + f0.n.x * side0 * TAPER_START_V, z: f0.p.z + f0.n.z * side0 * TAPER_START_V };
      const f0b = frameAtS(hs, hs.s + a * (U + PARALLEL_LENGTH), true) ?? f1;
      const side0b = Math.sign(f0b.n.x * n.x + f0b.n.z * n.z) * b;
      // End of the taper: from here the ramp runs parallel beside the motorway.
      const p0b = { x: f0b.p.x + f0b.n.x * side0b * PARALLEL_V, z: f0b.p.z + f0b.n.z * side0b * PARALLEL_V };
      const p1 = { x: f1.p.x + f1.n.x * side1 * PARALLEL_V, z: f1.p.z + f1.n.z * side1 * PARALLEL_V };
      const q = end.q;
      // Leave the street at a right angle, towards this quadrant's side of the crossing.
      const sgn = Math.sign(q.n.x * t.x * a + q.n.z * t.z * a) || 1;
      const p2 = { x: q.p.x + q.n.x * sgn * APPROACH, z: q.p.z + q.n.z * sgn * APPROACH };
      const ramp = [p0, p0b, p1, p2, { x: q.p.x, z: q.p.z }];
      // Ramps stay on dry ground; a quadrant with water gets no ramp.
      if (crossesWater(ramp, grid)) continue;
      // Ramps must not cut through other roads, tracks or canals (the street they join and
      // the motorway they leave are fine).
      const others = [...roads, ...obstacles].filter((o) => o.id !== highway.id);
      const probe: Path = { id: "__ramp__", kind: "ramp", points: ramp };
      const blocked = findCrossings([probe], others).some(
        // Touching the street at the junction point is the point of the ramp.
        (c) => !(c.b === street.id && Math.hypot(c.x - q.p.x, c.z - q.p.z) < 3),
      );
      if (blocked) continue;
      // Keep right: +t traffic (on +n) exits before the crossing (a < 0) and enters after it,
      // −t traffic the other way round. Paths are stored in travel direction.
      const exit = a * b < 0;
      ramps.push(exit ? ramp : [...ramp].reverse());
    }
  }
  return ramps.length > 0 ? { street, highway, ramps } : null;
}
