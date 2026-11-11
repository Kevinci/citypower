import * as THREE from "three";
import { closestOnPath } from "./adjacency";
import { DECK_DEPTH, type Opening, type Profile } from "./grade";
import {
  at,
  band,
  buildFrames,
  cumulative,
  MeshBuilder,
  ribbonFn,
  strip,
  tube,
  wall,
  type Frame,
  type Skip,
} from "./road-geometry";
import { sampleDepth, WATER_LEVEL, type DepthGrid } from "./terrain";
import { NETWORK_OF, OUTER_HALF_WIDTH, type Path } from "./types";

/**
 * Structures under a lifted road or track:
 *  - embankment (grass slopes 1:1.5) where it is lifted over open ground,
 *  - concrete abutments where an embankment meets a span,
 *  - spans: box-girder deck with cantilevered edge beams, cornice and steel railing,
 *  - piers every ~28 m on long spans, never in a ship channel or on the path below,
 *  - steel tied-arch bridge for long navigable spans (no piers in the water).
 */

export type StructureLayerKey = "concrete" | "steel" | "embankment" | "tunnel";
export type StructureLayers = Partial<Record<StructureLayerKey, THREE.BufferGeometry>>;

/** Edge beam width outside the path's outer edge. */
const CORNICE = 0.35;
const CORNICE_TOP = 0.35;
/** Inset of the box girder bottom from the outer edge. */
const BOX_INSET = 1.2;
const EDGE_BEAM_BOTTOM = -0.55;
const EMBANKMENT_SLOPE = 1.5;
const PIER_SPACING = 28;
/** Spans up to this length need no pier. */
const MAX_FREE_SPAN = 34;
const RAILING_HEIGHT = 1.1;
const RAILING_POST_SPACING = 2;
const HANGER_SPACING = 4.5;
/** Free height inside a tunnel and rock/concrete above it before a tunnel starts. */
const TUNNEL_CLEARANCE = { road: 5, rail: 6.6 };
const TUNNEL_ROOF = 1.8;

/**
 * Tunnel portal at frame f: a concrete frame (two walls and a lintel) around the opening,
 * standing slightly out of the slope, and a dark mouth set back inside so the tunnel reads
 * as a hole in the mountain. `outward` = ±1 along the frame's travel direction.
 */
function portal(
  m: Record<StructureLayerKey, MeshBuilder>,
  f: Frame,
  outward: number,
  outer: number,
  clearance: number,
  along: number,
) {
  const half = outer + 0.6;
  const wall = 1.2;
  const height = clearance + 2.6;
  const out = f.t.clone().multiplyScalar(outward);
  const c = f.p.clone().addScaledVector(out, 0.6);
  // Side walls and lintel.
  m.concrete.box(c.clone().addScaledVector(f.n, -(half + wall)), f.t, f.n, wall, 0.9, -0.5, height, along);
  m.concrete.box(c.clone().addScaledVector(f.n, half + wall), f.t, f.n, wall, 0.9, -0.5, height, along);
  m.concrete.box(c, f.t, f.n, half + 2 * wall, 0.9, clearance, height, along);
  // Wing walls angled back into the slope.
  for (const side of [-1, 1]) {
    const w = c.clone().addScaledVector(f.n, side * (half + wall * 2 + 2.5)).addScaledVector(out, 1.5);
    m.concrete.box(w, f.t, f.n, 2.5, 0.5, -0.5, height * 0.7, along);
  }
  // Dark mouth inside the opening.
  const back = f.p.clone().addScaledVector(out, -1.2);
  const corner = (sn: number, y: number) => back.clone().addScaledVector(f.n, sn * half).setY(f.p.y + y);
  m.tunnel.quad(
    corner(-1, -0.2),
    corner(1, -0.2),
    corner(1, clearance),
    corner(-1, clearance),
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    [along, along, along, along],
  );
}
/** Above this height an approach is a viaduct on piers instead of an earth embankment. */
const VIADUCT_HEIGHT = 5;
const VIADUCT_PIER_SPACING = 26;

const inOpening = (openings: Opening[], s: number) => openings.find((o) => s >= o.s0 && s <= o.s1) ?? null;

/** Steel railing (posts, hand rail, knee rail) along frames at a lateral offset. */
function railing(mb: MeshBuilder, frames: Frame[], offset: number, base: number) {
  if (frames.length < 2) return;
  const dist = cumulative(frames);
  let next = 0;
  frames.forEach((f, i) => {
    if (dist[i] + 1e-6 < next) return;
    next = dist[i] + RAILING_POST_SPACING;
    mb.box(at(f, offset, 0).setY(f.p.y), f.t, f.n, 0.035, 0.035, base, base + RAILING_HEIGHT, dist[i]);
  });
  tube(mb, frames, offset, base + RAILING_HEIGHT, 0.04, 6);
  tube(mb, frames, offset, base + RAILING_HEIGHT * 0.5, 0.025, 5);
}

/** Splits index ranges where `keep(i)` holds for consecutive frames. */
function runs(n: number, keep: (i: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    if (i < n && keep(i)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - 1 > start) out.push([start, i - 1]);
      start = -1;
    }
  }
  return out;
}

export function buildStructure(
  path: Path,
  profile: Profile,
  grid: DepthGrid,
  /** Opens railings and cornices where another path joins (tested at the railing position). */
  open?: Skip,
): StructureLayers {
  if (profile.max === 0) return {};
  const frames = buildFrames(path.points, path.kind, profile);
  if (frames.length < 2) return {};
  const dist = cumulative(frames);
  const outer = OUTER_HALF_WIDTH[path.kind];
  const edge = outer + CORNICE;
  const deck = DECK_DEPTH[path.kind];
  const openings = profile.openings;

  const m: Record<StructureLayerKey, MeshBuilder> = {
    concrete: new MeshBuilder(),
    steel: new MeshBuilder(),
    embankment: new MeshBuilder(),
    tunnel: new MeshBuilder(),
  };

  /** Absolute surface height of frame i. */
  const h = (i: number) => frames[i].p.y;
  /** Terrain height (absolute y) below a point at a lateral offset of frame i. */
  const terrain = (i: number, off: number) => {
    const f = frames[i];
    return -sampleDepth(grid, f.p.x + f.n.x * off, f.p.z + f.n.z * off);
  };
  /** Height of the surface above the terrain (negative: in a cutting or tunnel). */
  const liftCache = frames.map((_, i) => h(i) - Math.max(terrain(i, 0), WATER_LEVEL - 0.3));
  const lift = (i: number) => liftCache[i];
  const lifted = (i: number) => lift(i) > 0.05;
  const opening = (i: number) => inOpening(openings, dist[i]) !== null;
  /** Open below the deck: real openings and high viaduct approaches. */
  const span = (i: number) => opening(i) || lift(i) > VIADUCT_HEIGHT;
  const footOff = (i: number) => outer + EMBANKMENT_SLOPE * Math.max(0, lift(i));

  /* ----- embankments ----- */
  const embank = (i: number) => (lifted(i) || lifted(i + 1)) && !span(i) && !span(i + 1);
  for (const side of [-1, 1]) {
    // No slope where it would land on a path this one merges into (ramp taper on a motorway).
    const free = (i: number) => embank(i) && !open?.(at(frames[i], side * (outer + 1), 0));
    ribbonFn(
      m.embankment,
      frames,
      () => side * outer,
      () => -0.01,
      (i) => side * footOff(i),
      (i) => terrain(i, side * footOff(i)) - h(i),
      free,
    );
  }

  /* ----- abutments and end faces: trapezoid across the embankment ----- */
  const face = (i: number, towards: number) => {
    const f = frames[i];
    const foot = footOff(i);
    const yl = terrain(i, -foot) - h(i) - 0.3;
    const yr = terrain(i, foot) - h(i) - 0.3;
    const shift = (v: THREE.Vector3) => v.addScaledVector(f.t, towards * 0.02);
    m.concrete.quad(
      shift(at(f, -foot, yl)),
      shift(at(f, -edge, 0)),
      shift(at(f, edge, 0)),
      shift(at(f, foot, yr)),
      [
        [-foot, yl],
        [-edge, 0],
        [edge, 0],
        [foot, yr],
      ],
      [dist[i], dist[i], dist[i], dist[i]],
    );
  };
  const closed = (i: number) => !open?.(frames[i].p);
  for (let i = 0; i < frames.length - 1; i++) {
    const a = lifted(i) && span(i);
    const b = lifted(i + 1) && span(i + 1);
    if (a !== b && closed(a ? i + 1 : i)) face(a ? i + 1 : i, a ? -1 : 1);
  }
  // Path ends hanging in the air get an end face, unless they merge into another path there.
  if (lifted(0) && !span(0) && closed(0)) face(0, 1);
  const last = frames.length - 1;
  if (lifted(last) && !span(last) && closed(last)) face(last, -1);

  /* ----- spans: deck ----- */
  const spanRuns = runs(frames.length, (i) => span(i) && lifted(i));
  for (const [a, b] of spanRuns) {
    const sub = frames.slice(a, b + 1);
    const inner = outer - BOX_INSET;
    strip(m.concrete, sub, -inner, inner, -deck);
    for (const side of [-1, 1]) {
      band(m.concrete, sub, [side * inner, -deck], [side * (outer + 0.1), EDGE_BEAM_BOTTOM]);
      strip(m.concrete, sub, Math.min(side * (outer + 0.1), side * edge), Math.max(side * (outer + 0.1), side * edge), EDGE_BEAM_BOTTOM);
      wall(m.concrete, sub, side * edge, EDGE_BEAM_BOTTOM, 0);
      wall(m.concrete, sub, side * edge, 0, CORNICE_TOP, undefined, open);
      wall(m.concrete, sub, side * outer, 0, CORNICE_TOP, undefined, open);
      strip(m.concrete, sub, Math.min(side * outer, side * edge), Math.max(side * outer, side * edge), CORNICE_TOP, {
        clip: open,
      });
    }
  }

  /* ----- railings on spans and on high embankments ----- */
  const railed = runs(frames.length, (i) => (span(i) && lifted(i)) || lift(i) > 1.2);
  for (const [a, b] of railed) {
    for (const side of [-1, 1]) {
      const off = side * (outer + CORNICE * 0.5);
      // Split the railing where another path joins on this side.
      const pieces = runs(b - a + 1, (k) => !open?.(at(frames[a + k], off, 0)));
      for (const [p0, p1] of pieces) railing(m.steel, frames.slice(a + p0, a + p1 + 1), off, span(a) ? CORNICE_TOP : 0);
    }
  }

  /* ----- piers and arches per opening ----- */
  for (const o of openings) {
    const length = o.s1 - o.s0;
    const idx = (s: number) => {
      let i = 0;
      while (i < dist.length - 1 && dist[i] < s) i++;
      return i;
    };
    const ia = idx(o.s0);
    const ib = idx(o.s1);
    if (ib <= ia) continue;

    if (o.navigable && length > MAX_FREE_SPAN) {
      buildArch(m.steel, frames, dist, ia, ib, edge, path);
      continue;
    }
    if (length <= MAX_FREE_SPAN) continue;
    const count = Math.ceil(length / PIER_SPACING) - 1;
    for (let k = 1; k <= count; k++) {
      const s = o.s0 + (length * k) / (count + 1);
      const i = idx(s);
      const f = frames[i];
      const q = { x: f.p.x, z: f.p.z };
      if (o.navigable && sampleDepth(grid, f.p.x, f.p.z) > 1) continue;
      if (o.under && closestOnPath(q, o.under).distance < OUTER_HALF_WIDTH[o.under.kind] + 1.5) continue;
      const bottom = terrain(i, 0) - h(i) - 0.5;
      m.concrete.box(f.p, f.t, f.n, (outer - BOX_INSET) * 0.75, 0.6, bottom, -deck - 0.6, s);
      m.concrete.box(f.p, f.t, f.n, outer - BOX_INSET + 0.4, 0.9, -deck - 0.6, -deck, s);
    }
  }

  /* ----- viaduct piers on high approaches ----- */
  const viaducts = runs(frames.length, (i) => lift(i) > VIADUCT_HEIGHT && !opening(i));
  for (const [a, b] of viaducts) {
    const length = dist[b] - dist[a];
    const count = Math.max(1, Math.round(length / VIADUCT_PIER_SPACING));
    for (let k = 0; k < count; k++) {
      const s = dist[a] + (length * (k + 0.5)) / count;
      let i = a;
      while (i < b && dist[i] < s) i++;
      const f = frames[i];
      if (sampleDepth(grid, f.p.x, f.p.z) > 1) continue;
      const bottom = terrain(i, 0) - h(i) - 0.5;
      m.concrete.box(f.p, f.t, f.n, (outer - BOX_INSET) * 0.75, 0.6, bottom, -deck - 0.6, s);
      m.concrete.box(f.p, f.t, f.n, outer - BOX_INSET + 0.4, 0.9, -deck - 0.6, -deck, s);
    }
  }

  /* ----- tunnel portals ----- */
  // Deep below the terrain the path runs in a tunnel; where it enters or leaves the
  // mountain a portal frames a dark mouth (the terrain itself covers the tunnel).
  const cover = TUNNEL_CLEARANCE[NETWORK_OF[path.kind] === "rail" ? "rail" : "road"] + TUNNEL_ROOF;
  const inTunnel = (i: number) => -lift(i) > cover;
  for (let i = 0; i < frames.length - 1; i++) {
    if (inTunnel(i) === inTunnel(i + 1)) continue;
    // Portal at the first tunnel frame, facing out of the mountain.
    const k = inTunnel(i + 1) ? i + 1 : i;
    const outward = inTunnel(i + 1) ? -1 : 1;
    portal(m, frames[k], outward, outer, cover - TUNNEL_ROOF, dist[k]);
  }

  const out: StructureLayers = {};
  (Object.keys(m) as StructureLayerKey[]).forEach((key) => {
    const g = m[key].geometry();
    if (g) out[key] = g;
  });
  return out;
}

/**
 * Steel tied arch over frames ia..ib: one arch rib on each side, vertical hangers down to
 * the deck edge and cross bracing between the ribs near the crown.
 */
function buildArch(mb: MeshBuilder, frames: Frame[], dist: number[], ia: number, ib: number, edge: number, path: Path) {
  const length = dist[ib] - dist[ia];
  const rise = THREE.MathUtils.clamp(length * 0.16, 6, 16);
  const sub = frames.slice(ia, ib + 1);
  const subDist = dist.slice(ia, ib + 1);
  const archY = (j: number) => {
    const u = (subDist[j] - subDist[0]) / length;
    return CORNICE_TOP + 0.3 + rise * 4 * u * (1 - u);
  };
  const ribHalf = NETWORK_OF[path.kind] === "rail" ? 0.4 : 0.32;
  const ribH = 0.5;
  for (const side of [-1, 1]) {
    const o = side * (edge + ribHalf);
    const lo = (j: number) => archY(j) - ribH;
    const hi = (j: number) => archY(j) + ribH;
    ribbonFn(mb, sub, () => o - ribHalf, hi, () => o + ribHalf, hi);
    ribbonFn(mb, sub, () => o - ribHalf, lo, () => o + ribHalf, lo);
    ribbonFn(mb, sub, () => o - ribHalf, lo, () => o - ribHalf, hi);
    ribbonFn(mb, sub, () => o + ribHalf, lo, () => o + ribHalf, hi);
    // Hangers.
    let next = HANGER_SPACING;
    sub.forEach((f, j) => {
      const d = subDist[j] - subDist[0];
      if (d < next || length - d < HANGER_SPACING * 0.6) return;
      next = d + HANGER_SPACING;
      mb.box(at(f, o, 0).setY(f.p.y), f.t, f.n, 0.05, 0.05, CORNICE_TOP, archY(j) - ribH, subDist[j]);
    });
  }
  // Cross bracing between the ribs near the crown.
  let nextBrace = length * 0.25;
  sub.forEach((f, j) => {
    const d = subDist[j] - subDist[0];
    if (d < nextBrace || d > length * 0.75) return;
    nextBrace = d + 6;
    const y = archY(j);
    mb.box(f.p.clone(), f.t, f.n, edge + ribHalf, 0.12, y - 0.15, y + 0.15, subDist[j]);
  });
}
