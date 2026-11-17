import * as THREE from "three";
import type { RoadMaterialKey } from "./materials";
import type { Junction } from "./network";
import { CORNER_RADIUS, type BuildKind, type RoadKind, type Vec2 } from "./types";

/**
 * A sample on a road's centre line.
 * `n` is the horizontal normal (offsets are measured along it), `t` the direction of travel.
 */
export interface Frame {
  p: THREE.Vector3;
  t: THREE.Vector3;
  n: THREE.Vector3;
}

const STEP = 1; // metres between samples

export { CORNER_RADIUS };

/** Lateral offset (m) at which construction vehicles park next to a road. */
export const CREW_OFFSET: Record<RoadKind, number> = { street: 8, highway: 16, bike: 4, ramp: 7 };

const normalOf = (t: THREE.Vector3) => new THREE.Vector3(-t.z, 0, t.x);

function makeFrame(p: THREE.Vector3, t: THREE.Vector3): Frame {
  const tangent = new THREE.Vector3(t.x, 0, t.z).normalize();
  return { p: p.clone(), t: tangent, n: normalOf(tangent) };
}

/** Rotates a horizontal vector around the y axis. */
function rotateY(v: THREE.Vector3, angle: number) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new THREE.Vector3(v.x * c - v.z * s, 0, v.x * s + v.z * c);
}

/** Frames along a straight line from a to b, excluding b. */
function lineFrames(out: Frame[], a: THREE.Vector3, b: THREE.Vector3) {
  const len = a.distanceTo(b);
  if (len < 1e-6) return;
  const t = b.clone().sub(a);
  const steps = Math.max(1, Math.ceil(len / STEP));
  for (let j = 0; j < steps; j++) out.push(makeFrame(a.clone().lerp(b, j / steps), t));
}

/**
 * Samples a polyline into frames. Every corner is replaced by a circular arc (fillet) of
 * the road's corner radius, shrunk only when the neighbouring segments are too short.
 */
/** Height of a path's centre line (surface level) at distance s from its start. */
export interface Elevation {
  heightAt(s: number): number;
}

/**
 * Samples a polyline into frames (see buildFlatFrames) and lifts them by `elevation`.
 * All geometry helpers measure heights relative to the frame, so a lifted frame lifts the
 * whole cross-section (asphalt, ballast, sidewalks, lamps …).
 */
export function buildFrames(points: Vec2[], kind: BuildKind, elevation?: Elevation): Frame[] {
  const frames = buildFlatFrames(points, kind);
  if (elevation && frames.length > 1) {
    let d = 0;
    for (let i = 0; i < frames.length; i++) {
      if (i > 0) d += Math.hypot(frames[i].p.x - frames[i - 1].p.x, frames[i].p.z - frames[i - 1].p.z);
      frames[i].p.y = elevation.heightAt(d);
    }
  }
  return frames;
}

function buildFlatFrames(points: Vec2[], kind: BuildKind): Frame[] {
  if (points.length < 2) return [];
  const v = points.map((p) => new THREE.Vector3(p.x, 0, p.z));
  const radius = CORNER_RADIUS[kind];
  const out: Frame[] = [];
  let cursor = v[0].clone();

  for (let k = 1; k < v.length - 1; k++) {
    const a = v[k - 1];
    const b = v[k];
    const c = v[k + 1];
    const d0 = b.clone().sub(a).normalize();
    const d1 = c.clone().sub(b).normalize();
    const turn = Math.acos(THREE.MathUtils.clamp(d0.dot(d1), -1, 1));

    if (turn < 1e-3) continue; // straight through, no arc needed

    // Tangent length of the fillet, limited by the room on both segments.
    const tanHalf = Math.tan(turn / 2);
    const tangentLen = Math.min(radius * tanHalf, cursor.distanceTo(b), b.distanceTo(c) / 2);
    const r = tangentLen / tanHalf;
    const p0 = b.clone().addScaledVector(d0, -tangentLen);
    const p1 = b.clone().addScaledVector(d1, tangentLen);

    lineFrames(out, cursor, p0);

    // Turn direction: +1 if rotating d0 by +turn gives d1, else -1.
    const sign = rotateY(d0, turn).dot(d1) > rotateY(d0, -turn).dot(d1) ? 1 : -1;
    // The arc centre lies on the side the road turns towards.
    const toCentre = rotateY(d0, sign * (Math.PI / 2));
    const centre = p0.clone().addScaledVector(toCentre, r);
    const radial = p0.clone().sub(centre);
    const steps = Math.max(2, Math.ceil((r * turn) / STEP));
    for (let j = 0; j < steps; j++) {
      const phi = (j / steps) * turn * sign;
      out.push(makeFrame(centre.clone().add(rotateY(radial, phi)), rotateY(d0, phi)));
    }

    cursor = p1;
  }

  const last = v[v.length - 1];
  lineFrames(out, cursor, last);
  out.push(makeFrame(last, last.clone().sub(v[v.length - 2])));
  return out;
}

/* ---------- mesh building ---------- */

type UV = [number, number];

/** Collects quads and fans with UVs in metres, so textures repeat at real-world scale. */
export class MeshBuilder {
  private positions: number[] = [];
  private uvs: number[] = [];
  /** Distance from the road start per vertex; lets shaders reveal a road progressively. */
  private along: number[] = [];
  private indices: number[] = [];

  quad(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    uv: [UV, UV, UV, UV],
    along: [number, number, number, number],
  ) {
    const base = this.positions.length / 3;
    for (const v of [a, b, c, d]) this.positions.push(v.x, v.y, v.z);
    for (const t of uv) this.uvs.push(t[0], t[1]);
    this.along.push(...along);
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /**
   * Axis box oriented by a frame: `halfN` across (along n), `halfT` along the path (along t),
   * from y0 to y1 above c.y. Top and four sides, no bottom. `along` is the same for all vertices.
   */
  box(c: THREE.Vector3, t: THREE.Vector3, n: THREE.Vector3, halfN: number, halfT: number, y0: number, y1: number, along: number) {
    const corner = (sn: number, st: number, y: number) =>
      new THREE.Vector3(c.x + n.x * halfN * sn + t.x * halfT * st, c.y + y, c.z + n.z * halfN * sn + t.z * halfT * st);
    const a = [along, along, along, along] as [number, number, number, number];
    const w = halfN * 2;
    const d = halfT * 2;
    const h = y1 - y0;
    // top
    this.quad(corner(-1, -1, y1), corner(1, -1, y1), corner(1, 1, y1), corner(-1, 1, y1), [[0, 0], [w, 0], [w, d], [0, d]], a);
    // sides
    this.quad(corner(-1, -1, y0), corner(1, -1, y0), corner(1, -1, y1), corner(-1, -1, y1), [[0, 0], [w, 0], [w, h], [0, h]], a);
    this.quad(corner(1, 1, y0), corner(-1, 1, y0), corner(-1, 1, y1), corner(1, 1, y1), [[0, 0], [w, 0], [w, h], [0, h]], a);
    this.quad(corner(1, -1, y0), corner(1, 1, y0), corner(1, 1, y1), corner(1, -1, y1), [[0, 0], [d, 0], [d, h], [0, h]], a);
    this.quad(corner(-1, 1, y0), corner(-1, -1, y0), corner(-1, -1, y1), corner(-1, 1, y1), [[0, 0], [d, 0], [d, h], [0, h]], a);
  }

  /** Filled disc as a triangle fan, used for junction plazas. UVs are world x/z. */
  disc(cx: number, cz: number, radius: number, y: number, segments = 32) {
    const base = this.positions.length / 3;
    this.positions.push(cx, y, cz);
    this.uvs.push(cx, cz);
    this.along.push(0);
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const x = cx + Math.cos(a) * radius;
      const z = cz + Math.sin(a) * radius;
      this.positions.push(x, y, z);
      this.uvs.push(x, z);
      this.along.push(0);
    }
    for (let i = 0; i < segments; i++) {
      this.indices.push(base, base + 1 + i, base + 2 + i);
    }
  }

  geometry(): THREE.BufferGeometry | null {
    if (this.indices.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute("along", new THREE.Float32BufferAttribute(this.along, 1));
    g.setIndex(this.indices);
    g.computeVertexNormals();
    return g;
  }
}

/** Point at a lateral offset from a frame, `y` metres above the frame's height. */
export const at = (f: Frame, offset: number, y: number) =>
  new THREE.Vector3(f.p.x + f.n.x * offset, f.p.y + y, f.p.z + f.n.z * offset);

/** Returns true if a point should be left out of a layer. */
export type Skip = (p: THREE.Vector3) => boolean;

/** Distance along the road at every frame, used as the V texture coordinate. */
export function cumulative(frames: Frame[]): number[] {
  const out = [0];
  for (let i = 1; i < frames.length; i++) out.push(out[i - 1] + frames[i - 1].p.distanceTo(frames[i].p));
  return out;
}

/**
 * Flat band between two lateral offsets, optionally dashed. Segments whose midpoint `skip`
 * returns true are left out. U = lateral offset, V = distance along the road, both in metres.
 */
export function strip(
  mb: MeshBuilder,
  frames: Frame[],
  off0: number,
  off1: number,
  y: number,
  opts: {
    dash?: { on: number; off: number };
    /** Tested at the centre line (junction cut-outs). */
    skip?: Skip;
    /** Tested at the band's own lateral position (clipping against other surfaces). */
    clip?: Skip;
  } = {},
) {
  const { dash, skip, clip } = opts;
  const mid = (off0 + off1) / 2;
  const period = dash ? dash.on + dash.off : 1;
  const dist = cumulative(frames);
  for (let i = 0; i < frames.length - 1; i++) {
    const f0 = frames[i];
    const f1 = frames[i + 1];
    if (dash && dist[i] % period >= dash.on) continue;
    if (skip && skip(f0.p.clone().lerp(f1.p, 0.5))) continue;
    if (clip && clip(at(f0, mid, 0).lerp(at(f1, mid, 0), 0.5))) continue;
    mb.quad(
      at(f0, off0, y),
      at(f0, off1, y),
      at(f1, off1, y),
      at(f1, off0, y),
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

/** Vertical face at a lateral offset, e.g. a curb. U = distance along, V = height. */
export function wall(
  mb: MeshBuilder,
  frames: Frame[],
  offset: number,
  y0: number,
  y1: number,
  skip?: Skip,
  /** Tested at the wall's own lateral position. */
  clip?: Skip,
) {
  const dist = cumulative(frames);
  for (let i = 0; i < frames.length - 1; i++) {
    const f0 = frames[i];
    const f1 = frames[i + 1];
    if (skip && skip(f0.p.clone().lerp(f1.p, 0.5))) continue;
    if (clip && clip(at(f0, offset, 0).lerp(at(f1, offset, 0), 0.5))) continue;
    mb.quad(
      at(f0, offset, y0),
      at(f0, offset, y1),
      at(f1, offset, y1),
      at(f1, offset, y0),
      [
        [dist[i], y0],
        [dist[i], y1],
        [dist[i + 1], y1],
        [dist[i + 1], y0],
      ],
      [dist[i], dist[i], dist[i + 1], dist[i + 1]],
    );
  }
}

export type RoadLayers = Partial<Record<RoadMaterialKey, THREE.BufferGeometry>>;

/**
 * Builds all geometry layers for a road.
 * Street: 8 m asphalt, dashed centre line, edge lines, curbs, 2.2 m sidewalks.
 * Highway: two carriageways with 2×3.75 m lanes and hard shoulder, grass median with concrete barrier.
 * Only real junctions (roads meeting at an angle) cut curbs, sidewalks and markings. Straight
 * continuations stay unbroken.
 */
export function buildRoadLayers(
  points: Vec2[],
  kind: RoadKind,
  junctions: Junction[] = [],
  elevation?: Elevation,
  /** Leaves out parts of the surface, e.g. where a ramp overlaps the motorway. */
  clip?: Skip,
  /** Id of the road, so junction cut-outs can size themselves to the other roads. */
  roadId?: string,
): RoadLayers {
  const frames = buildFrames(points, kind, elevation);
  if (frames.length < 2) return {};

  // Curbs and sidewalks stop just outside the junction plaza, markings stop at its edge.
  // Each road is cut back only as far as the widest *other* road at the junction
  // reaches: a cycle path crossing a street interrupts its sidewalk by 3 m, not by 8 m.
  const cutRadius = (j: Junction) => {
    if (!j.widths || !roadId) return j.radius;
    let r = 0;
    for (const [id, w] of j.widths) if (id !== roadId) r = Math.max(r, w);
    return r || j.radius;
  };
  // Only junctions near this road, with their radius worked out once: every vertex of every
  // band is tested (it was all junctions of the town × the radius search per test).
  let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
  for (const f of frames) {
    if (f.p.x < bx0) bx0 = f.p.x;
    if (f.p.x > bx1) bx1 = f.p.x;
    if (f.p.z < bz0) bz0 = f.p.z;
    if (f.p.z > bz1) bz1 = f.p.z;
  }
  const cuts = junctions
    .filter((j) => j.cut)
    .map((j) => ({ j, r: cutRadius(j) }))
    .filter(({ j, r }) => {
      const reach = Math.max(r, j.radius) + 30;
      return j.x >= bx0 - reach && j.x <= bx1 + reach && j.z >= bz0 - reach && j.z <= bz1 + reach;
    });
  const nearJunction = (extra: number): Skip => {
    return (p) =>
      cuts.some(({ j, r }) => (j.test ? j.test(p.x, p.z, extra) : (p.x - j.x) ** 2 + (p.z - j.z) ** 2 < (r + extra) ** 2));
  };
  const edgeSkip = nearJunction(0.5);
  const markingSkip = nearJunction(0);

  const m: Record<RoadMaterialKey, MeshBuilder> = {
    asphalt: new MeshBuilder(),
    marking: new MeshBuilder(),
    curb: new MeshBuilder(),
    sidewalk: new MeshBuilder(),
    median: new MeshBuilder(),
    bikeway: new MeshBuilder(),
  };

  if (kind === "ramp") {
    // One-way single lane with hard shoulders. Where the ramp lies on the motorway
    // (diverge/merge taper) it is clipped band by band at each band's own position, so
    // the ramp grows out of the motorway edge along a clean diagonal.
    const bands = 8;
    for (let k = 0; k < bands; k++) {
      const a = -3.5 + (7 * k) / bands;
      // 3 mm above the motorway where the two overlap at the taper edge.
      strip(m.asphalt, frames, a, a + 7 / bands, 0.023, { clip });
    }
    strip(m.marking, frames, 3.0, 3.15, 0.04, { skip: markingSkip, clip });
    strip(m.marking, frames, -3.15, -3.0, 0.04, { skip: markingSkip, clip });
  } else if (kind === "bike") {
    // 3 m two-way cycle path: red asphalt, dashed white centre line, white edge lines.
    strip(m.bikeway, frames, -1.5, 1.5, 0.025);
    strip(m.marking, frames, -0.06, 0.06, 0.045, { dash: { on: 1, off: 1.5 }, skip: markingSkip });
    strip(m.marking, frames, 1.3, 1.4, 0.045, { skip: markingSkip });
    strip(m.marking, frames, -1.4, -1.3, 0.045, { skip: markingSkip });
    // Low concrete edging, flush with the ground.
    strip(m.curb, frames, 1.5, 1.7, 0.03, { skip: edgeSkip });
    strip(m.curb, frames, -1.7, -1.5, 0.03, { skip: edgeSkip });
  } else if (kind === "street") {
    strip(m.asphalt, frames, -4, 4, 0.02);
    strip(m.marking, frames, -0.08, 0.08, 0.04, { dash: { on: 3, off: 6 }, skip: markingSkip });
    strip(m.marking, frames, 3.5, 3.7, 0.04, { skip: markingSkip });
    strip(m.marking, frames, -3.7, -3.5, 0.04, { skip: markingSkip });
    wall(m.curb, frames, 4, 0.02, 0.14, edgeSkip);
    wall(m.curb, frames, -4, 0.02, 0.14, edgeSkip);
    strip(m.sidewalk, frames, 4, 6.2, 0.14, { skip: edgeSkip });
    strip(m.sidewalk, frames, -6.2, -4, 0.14, { skip: edgeSkip });
  } else {
    strip(m.asphalt, frames, 1.5, 12, 0.02);
    strip(m.asphalt, frames, -12, -1.5, 0.02);
    strip(m.median, frames, -1.5, 1.5, 0.3, { skip: edgeSkip });
    wall(m.curb, frames, 1.5, 0.02, 0.3, edgeSkip);
    wall(m.curb, frames, -1.5, 0.02, 0.3, edgeSkip);
    // Where a ramp attaches (clip), the solid edge line becomes a block marking (broken).
    const onRamp: Skip | undefined = clip ? (p) => !clip(p) : undefined;
    for (const [a0, a1] of [
      [11.2, 11.5],
      [-11.5, -11.2],
    ]) {
      strip(m.marking, frames, a0, a1, 0.04, { skip: markingSkip, clip });
      if (onRamp) strip(m.marking, frames, a0, a1, 0.04, { skip: markingSkip, clip: onRamp, dash: { on: 3, off: 3 } });
    }
    strip(m.marking, frames, 5.2, 5.32, 0.04, { dash: { on: 6, off: 6 }, skip: markingSkip });
    strip(m.marking, frames, -5.32, -5.2, 0.04, { dash: { on: 6, off: 6 }, skip: markingSkip });
  }

  const out: RoadLayers = {};
  (Object.keys(m) as RoadMaterialKey[]).forEach((key) => {
    const g = m[key].geometry();
    if (g) out[key] = g;
  });
  return out;
}

/** Asphalt plazas at every junction, drawn on top of the road surfaces. */
export function buildJunctionLayer(junctions: Junction[]): THREE.BufferGeometry | null {
  const mb = new MeshBuilder();
  for (const j of junctions) mb.disc(j.x, j.z, j.plaza ?? j.radius, (j.y ?? 0) + 0.024);
  return mb.geometry();
}

/* ---------- construction site ---------- */

/** Sloped band between two (offset, height) points, e.g. one flank of a soil heap. */
export function band(mb: MeshBuilder, frames: Frame[], a: [number, number], b: [number, number], skip?: Skip) {
  const dist = cumulative(frames);
  for (let i = 0; i < frames.length - 1; i++) {
    const f0 = frames[i];
    const f1 = frames[i + 1];
    if (skip && skip(f0.p.clone().lerp(f1.p, 0.5))) continue;
    mb.quad(
      at(f0, a[0], a[1]),
      at(f0, b[0], b[1]),
      at(f1, b[0], b[1]),
      at(f1, a[0], a[1]),
      [
        [a[0], dist[i]],
        [b[0], dist[i]],
        [b[0], dist[i + 1]],
        [a[0], dist[i + 1]],
      ],
      [dist[i], dist[i], dist[i + 1], dist[i + 1]],
    );
  }
}

/** Pipe running along the road at a lateral offset. */
export function tube(mb: MeshBuilder, frames: Frame[], offset: number, y: number, radius: number, sides = 10) {
  const dist = cumulative(frames);
  const up = new THREE.Vector3(0, 1, 0);
  const ring = (f: Frame, j: number) => {
    const angle = (j / sides) * Math.PI * 2;
    return at(f, offset, y)
      .addScaledVector(f.n, Math.cos(angle) * radius)
      .addScaledVector(up, Math.sin(angle) * radius);
  };
  for (let i = 0; i < frames.length - 1; i++) {
    for (let j = 0; j < sides; j++) {
      mb.quad(
        ring(frames[i], j),
        ring(frames[i + 1], j),
        ring(frames[i + 1], j + 1),
        ring(frames[i], j + 1),
        [
          [j / sides, dist[i]],
          [j / sides, dist[i + 1]],
          [(j + 1) / sides, dist[i + 1]],
          [(j + 1) / sides, dist[i]],
        ],
        [dist[i], dist[i + 1], dist[i + 1], dist[i]],
      );
    }
  }
}

/** Width of the opened ground and position of the utility trench per road type. */
export const SITE_SPEC: Record<RoadKind, { halfWidth: number; trench: [number, number] }> = {
  street: { halfWidth: 6.8, trench: [0.8, 2.8] },
  highway: { halfWidth: 13, trench: [3.2, 5.4] },
  bike: { halfWidth: 2.6, trench: [0.2, 1.4] },
  ramp: { halfWidth: 5, trench: [1, 2.8] },
};

export type SiteLayerKey = "dirt" | "trench" | "spoil" | "waterPipe" | "gasPipe";
export type SiteLayers = Partial<Record<SiteLayerKey, THREE.BufferGeometry>>;

/**
 * Geometry for a road under construction: opened ground across the full road width, a
 * utility trench with soil heaps on both edges, and a water pipe and a gas pipe in it.
 */
export function buildSiteLayers(points: Vec2[], kind: RoadKind, elevation?: Elevation): SiteLayers {
  const frames = buildFrames(points, kind, elevation);
  if (frames.length < 2) return {};
  const { halfWidth, trench } = SITE_SPEC[kind];
  const [t0, t1] = trench;

  const m: Record<SiteLayerKey, MeshBuilder> = {
    dirt: new MeshBuilder(),
    trench: new MeshBuilder(),
    spoil: new MeshBuilder(),
    waterPipe: new MeshBuilder(),
    gasPipe: new MeshBuilder(),
  };

  strip(m.dirt, frames, -halfWidth, halfWidth, 0.012);
  strip(m.trench, frames, t0, t1, 0.016);
  // Soil heaps along both trench edges.
  band(m.spoil, frames, [t0 - 1.4, 0.014], [t0 - 0.55, 0.55]);
  band(m.spoil, frames, [t0 - 0.55, 0.55], [t0, 0.02]);
  band(m.spoil, frames, [t1, 0.02], [t1 + 0.55, 0.55]);
  band(m.spoil, frames, [t1 + 0.55, 0.55], [t1 + 1.4, 0.014]);
  // Pipes lie in the trench; the ground is flat, so they sit just above it.
  tube(m.waterPipe, frames, t0 + 0.55, 0.2, 0.18);
  tube(m.gasPipe, frames, t1 - 0.5, 0.15, 0.12);

  const out: SiteLayers = {};
  (Object.keys(m) as SiteLayerKey[]).forEach((key) => {
    const g = m[key].geometry();
    if (g) out[key] = g;
  });
  return out;
}

/**
 * Most general band: per-frame lateral offsets and heights (relative to the frame) for both
 * edges. Used for embankments, arches and anything whose cross-section changes along the path.
 */
export function ribbonFn(
  mb: MeshBuilder,
  frames: Frame[],
  off0: (i: number) => number,
  y0: (i: number) => number,
  off1: (i: number) => number,
  y1: (i: number) => number,
  keep?: (i: number) => boolean,
) {
  const dist = cumulative(frames);
  for (let i = 0; i < frames.length - 1; i++) {
    if (keep && !keep(i)) continue;
    const f0 = frames[i];
    const f1 = frames[i + 1];
    mb.quad(
      at(f0, off0(i), y0(i)),
      at(f0, off1(i), y1(i)),
      at(f1, off1(i + 1), y1(i + 1)),
      at(f1, off0(i + 1), y0(i + 1)),
      [
        [off0(i), dist[i]],
        [off1(i), dist[i]],
        [off1(i + 1), dist[i + 1]],
        [off0(i + 1), dist[i + 1]],
      ],
      [dist[i], dist[i], dist[i + 1], dist[i + 1]],
    );
  }
}

/** Cumulative distance along the road for every frame (exported for placing workers). */
export const frameDistances = cumulative;

/* ---------- helpers ---------- */

export interface LampSpot {
  position: THREE.Vector3;
  /** Direction from the lamp pole towards the road. */
  inward: THREE.Vector3;
}

/** Evenly spaced lamp positions along a road at a lateral offset. */
export function lampSpots(frames: Frame[], offset: number, spacing: number): LampSpot[] {
  const spots: LampSpot[] = [];
  const side = Math.sign(offset);
  let dist = 0;
  let next = spacing / 2;
  for (let i = 0; i < frames.length - 1; i++) {
    const f0 = frames[i];
    const f1 = frames[i + 1];
    const seg = f0.p.distanceTo(f1.p);
    while (seg > 0 && dist + seg >= next) {
      const t = (next - dist) / seg;
      const p = f0.p.clone().lerp(f1.p, t);
      p.addScaledVector(f0.n, offset);
      spots.push({ position: p, inward: f0.n.clone().multiplyScalar(-side) });
      next += spacing;
    }
    dist += seg;
  }
  return spots;
}

export function frameLength(frames: Frame[]) {
  let len = 0;
  for (let i = 0; i < frames.length - 1; i++) len += frames[i].p.distanceTo(frames[i + 1].p);
  return len;
}

/** Length of a polyline of control points. */
export function polylineLength(points: Vec2[]) {
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) {
    len += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
  }
  return len;
}
