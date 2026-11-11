import * as THREE from "three";
import type { RailMaterialKey } from "./materials";
import { at, buildFrames, cumulative, MeshBuilder, tube, type Elevation, type Frame } from "./road-geometry";
import { HALF_WIDTH, type RailKind, type Vec2 } from "./types";

/** Half of the standard gauge (1435 mm) measured to the rail centres. */
const GAUGE_HALF = 0.7175;
const RAIL_HEAD_HALF = 0.036;
const RAIL_HEIGHT = 0.16;
const BALLAST_HEIGHT = 0.32;
const SLEEPER_HEIGHT = 0.16;
const SLEEPER_HALF_LENGTH = 1.3;
const SLEEPER_HALF_WIDTH = 0.13;
const SLEEPER_SPACING = 0.6;
/** Rail top inside a level crossing, flush with the crossing plate. */
const EMBEDDED_RAIL_TOP = 0.075;
const PLATE_Y = 0.045;
const MAST_SPACING = 48;
const MAST_HEIGHT = 6.4;
const WIRE_Y = 5.7;

/** Lateral offsets of the track centres. */
export const TRACK_OFFSETS: Record<RailKind, number[]> = { rail: [0], rail2: [-2.25, 2.25] };
/** Half widths of the ballast bed: flat top and foot on the ground. */
const BALLAST_TOP: Record<RailKind, number> = { rail: 1.7, rail2: 3.95 };

/** Where a road crosses the track. `halfLength` = how much of the track the road covers on each side. */
export interface LevelCrossing {
  x: number;
  z: number;
  halfLength: number;
}

export type RailLayers = Partial<Record<RailMaterialKey, THREE.BufferGeometry>>;

/**
 * Flat or sloped band with a height per frame: from (off0, y0(i)) to (off1, y1(i)).
 * With off0 === off1 it is a vertical face. `keep(i)` decides per segment.
 */
function ribbon(
  mb: MeshBuilder,
  frames: Frame[],
  dist: number[],
  off0: number,
  off1: number,
  y0: (i: number) => number,
  y1: (i: number) => number,
  keep?: (i: number) => boolean,
) {
  for (let i = 0; i < frames.length - 1; i++) {
    if (keep && !keep(i)) continue;
    const f0 = frames[i];
    const f1 = frames[i + 1];
    mb.quad(
      at(f0, off0, y0(i)),
      at(f0, off1, y1(i)),
      at(f1, off1, y1(i + 1)),
      at(f1, off0, y0(i + 1)),
      [
        [off0, dist[i]],
        [off1, dist[i]],
        [off1, dist[i + 1]],
        [off0, dist[i + 1]],
      ],
      [dist[i], dist[i], dist[i + 1], dist[i + 1]],
    );
  }
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Track geometry: ballast bed with sloped flanks, concrete sleepers, two steel rails per
 * track and catenary masts with contact wire.
 *
 * At level crossings the whole track sinks smoothly to road level over ~10 m: ballast and
 * sleepers vanish below the asphalt, the rails end up flush in a concrete crossing plate.
 * `lift` raises everything by a few millimetres so overlapping tracks at switches do not
 * z-fight.
 */
export function buildRailLayers(
  points: Vec2[],
  kind: RailKind,
  crossings: LevelCrossing[] = [],
  lift = 0,
  blocked?: (x: number, z: number) => boolean,
  profile?: Elevation,
): RailLayers {
  const frames = buildFrames(points, kind, profile);
  if (frames.length < 2) return {};
  const dist = cumulative(frames);

  // Elevation factor per frame: 1 = normal track, 0 = inside a level crossing.
  const elevation = frames.map((f) => {
    let e = 1;
    for (const c of crossings) {
      const d = Math.hypot(f.p.x - c.x, f.p.z - c.z);
      e = Math.min(e, smoothstep(c.halfLength + 0.5, c.halfLength + 10, d));
    }
    return e;
  });

  const m: Record<RailMaterialKey, MeshBuilder> = {
    ballast: new MeshBuilder(),
    sleeper: new MeshBuilder(),
    rail: new MeshBuilder(),
    plate: new MeshBuilder(),
    mast: new MeshBuilder(),
  };

  const foot = HALF_WIDTH[kind];
  const top = BALLAST_TOP[kind];
  const ground = () => lift + 0.005;
  const ballastTop = (i: number) => lift + 0.01 + (BALLAST_HEIGHT - 0.01) * elevation[i];
  const railTop = (i: number) =>
    lift + EMBEDDED_RAIL_TOP + (BALLAST_HEIGHT + SLEEPER_HEIGHT + RAIL_HEIGHT - EMBEDDED_RAIL_TOP) * elevation[i];
  const railBottom = (i: number) => railTop(i) - RAIL_HEIGHT;
  const raised = (i: number) => elevation[i] > 0.01 || elevation[i + 1] > 0.01;
  const flat = (i: number) => elevation[i] < 0.05 && elevation[i + 1] < 0.05;

  // Ballast bed: flank, top, flank. A flank gives way where a neighbouring path lies on it.
  const flankFree = (side: number) => (i: number) => {
    if (!raised(i) || !blocked) return raised(i);
    const f = frames[i];
    const o = side * (top + foot) * 0.5;
    return !blocked(f.p.x + f.n.x * o, f.p.z + f.n.z * o);
  };
  ribbon(m.ballast, frames, dist, -foot, -top, ground, ballastTop, flankFree(-1));
  ribbon(m.ballast, frames, dist, -top, top, ballastTop, ballastTop, raised);
  ribbon(m.ballast, frames, dist, top, foot, ballastTop, ground, flankFree(1));

  // Crossing plate over the full bed width.
  const plateY = () => lift + PLATE_Y;
  ribbon(m.plate, frames, dist, -foot, foot, plateY, plateY, flat);

  for (const o of TRACK_OFFSETS[kind]) {
    // Sleepers at fixed spacing, only on fully raised track.
    let next = SLEEPER_SPACING / 2;
    for (let i = 0; i < frames.length - 1; i++) {
      const seg = dist[i + 1] - dist[i];
      while (seg > 0 && next <= dist[i + 1]) {
        const t = (next - dist[i]) / seg;
        if (elevation[i] > 0.98 && elevation[i + 1] > 0.98) {
          const f = frames[i];
          const c = f.p.clone().lerp(frames[i + 1].p, t).addScaledVector(f.n, o);
          const y0 = ballastTop(i) - 0.02;
          m.sleeper.box(c, f.t, f.n, SLEEPER_HALF_LENGTH, SLEEPER_HALF_WIDTH, y0, y0 + SLEEPER_HEIGHT + 0.02, next);
        }
        next += SLEEPER_SPACING;
      }
    }

    // Two rails: both side faces and the running surface.
    for (const side of [-1, 1]) {
      const x = o + side * GAUGE_HALF;
      ribbon(m.rail, frames, dist, x - RAIL_HEAD_HALF, x - RAIL_HEAD_HALF, railBottom, railTop);
      ribbon(m.rail, frames, dist, x + RAIL_HEAD_HALF, x + RAIL_HEAD_HALF, railTop, railBottom);
      ribbon(m.rail, frames, dist, x - RAIL_HEAD_HALF, x + RAIL_HEAD_HALF, railTop, railTop);
    }

    // Contact wire above the track.
    tube(m.mast, frames, o, lift + WIRE_Y, 0.025, 4);
  }

  // Catenary masts beside the bed, with an arm reaching over the nearest track.
  const tracks = TRACK_OFFSETS[kind];
  // Single track: one mast on the +n side, or on the other side if a neighbour is there.
  const sides = kind === "rail" ? [1] : [-1, 1];
  let nextMast = MAST_SPACING / 2;
  for (let i = 0; i < frames.length - 1; i++) {
    if (dist[i] < nextMast) continue;
    nextMast = dist[i] + MAST_SPACING;
    if (elevation[i] < 0.98) continue;
    const f = frames[i];
    for (const s of sides) {
      let poleOff = s * (foot + 0.5);
      let pole = f.p.clone().addScaledVector(f.n, poleOff);
      if (blocked?.(pole.x, pole.z)) {
        if (kind !== "rail") continue;
        poleOff = -poleOff;
        pole = f.p.clone().addScaledVector(f.n, poleOff);
        if (blocked(pole.x, pole.z)) continue;
      }
      m.mast.box(pole, f.t, f.n, 0.14, 0.14, lift, lift + MAST_HEIGHT, dist[i]);
      const track = poleOff < 0 ? tracks[0] : tracks[tracks.length - 1];
      const armMid = f.p.clone().addScaledVector(f.n, (poleOff + track) / 2);
      const armHalf = Math.abs(poleOff - track) / 2 + 0.2;
      m.mast.box(armMid, f.t, f.n, armHalf, 0.06, lift + WIRE_Y + 0.25, lift + WIRE_Y + 0.4, dist[i]);
    }
  }

  const out: RailLayers = {};
  (Object.keys(m) as RailMaterialKey[]).forEach((key) => {
    const g = m[key].geometry();
    if (g) out[key] = g;
  });
  return out;
}

/** Small per-track height offset from its id, so overlapping beds at switches never z-fight. */
export function railLift(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 7) * 0.004;
}
