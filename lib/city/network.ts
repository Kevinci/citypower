import { CORNER_RADIUS, GRID_SIZE, HALF_WIDTH, ROAD_ANGLE_STEP, snapToGrid, type Path, type Road, type RoadKind, type Vec2 } from "./types";

/** A place where two or more roads meet at an angle. Radius = half asphalt width of the widest road there. */
export interface Junction {
  x: number;
  z: number;
  radius: number;
  /** true = crossing or T-junction: curbs, sidewalks and markings are cut back. */
  cut: boolean;
  /**
   * Custom cut-out shape instead of the circle (e.g. a level crossing: a band along the
   * track). Gets the point and the extra margin the caller adds.
   */
  test?: (x: number, z: number, extra: number) => boolean;
  /**
   * Radius of the asphalt plaza disc. Smaller than `radius` when the widest road only ends
   * here (e.g. a street ending at a cycle path): the plaza then follows the through road
   * so it never sticks out beyond the road end.
   */
  plaza?: number;
  /** Height of the junction surface (lifted junctions on ramps or bridges). */
  y?: number;
  /** Asphalt half width of every road at this node, by road id. */
  widths?: Map<string, number>;
}

/** Snap distances in metres. */
const SNAP_NODE = 1.6;
const SNAP_EDGE = 1.2;
/** Nodes closer than this count as the same junction. */
const NODE_MERGE = 1.0;
const MIN_POINT_DISTANCE = 0.05;
const EPS = 0.02;
const NEW_ROAD = "__new__";

export const ASPHALT_HALF_WIDTH: Record<RoadKind, number> = {
  street: HALF_WIDTH.street,
  highway: HALF_WIDTH.highway,
  bike: HALF_WIDTH.bike,
  ramp: HALF_WIDTH.ramp,
};

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

function closestOnSegment(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  const q = { x: a.x + dx * t, z: a.z + dz * t };
  return { t, q, d: dist(p, q) };
}

/** Proper intersection of segments ab and cd, ignoring touching at the ends. */
function intersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { t: number; u: number; p: Vec2 } | null {
  const rx = b.x - a.x;
  const rz = b.z - a.z;
  const sx = d.x - c.x;
  const sz = d.z - c.z;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qpx = c.x - a.x;
  const qpz = c.z - a.z;
  const t = (qpx * sz - qpz * sx) / den;
  const u = (qpx * rz - qpz * rx) / den;
  if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) return null;
  return { t, u, p: { x: a.x + rx * t, z: a.z + rz * t } };
}

type Insertion = { seg: number; t: number; p: Vec2 };

function dedupe(points: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) >= MIN_POINT_DISTANCE) out.push(p);
  }
  return out;
}

function applyInsertions(points: Vec2[], ins: Insertion[] | undefined): Vec2[] {
  if (!ins || ins.length === 0) return points;
  // Descending order keeps the indices of earlier segments valid while we splice.
  const sorted = [...ins].sort((a, b) => b.seg - a.seg || b.t - a.t);
  const out = [...points];
  for (const i of sorted) {
    const prev = out[i.seg];
    const next = out[i.seg + 1];
    if (dist(i.p, prev) < MIN_POINT_DISTANCE || dist(i.p, next) < MIN_POINT_DISTANCE) continue;
    out.splice(i.seg + 1, 0, { x: i.p.x, z: i.p.z });
  }
  return dedupe(out);
}

/**
 * Connects a road that is about to be created to the existing network:
 *  A) its control points snap onto nearby existing nodes or road edges,
 *  B) existing nodes lying on its segments are inserted into it (T-junctions),
 *  C) crossing segments get a shared node in both roads.
 * Returns the updated existing roads and the new road (null if it collapsed).
 */
export function connectRoads<T extends Path>(
  existing: T[],
  incoming: T,
  /** Paths the new one may join at grade. Others are crossed by a bridge and left alone. */
  canConnect: (other: T) => boolean = () => true,
  /** Paths the new one may also cross at grade (nodes in mid-segment). Defaults to canConnect. */
  canCross: (other: T) => boolean = canConnect,
): { roads: T[]; created: T | null } {
  const pts: Vec2[] = incoming.points.map((p) => ({ x: p.x, z: p.z }));
  const joinable = existing.filter(canConnect);
  const crossable = existing.filter((r) => canConnect(r) && canCross(r));
  const inserts = new Map<string, Insertion[]>();
  const add = (id: string, ins: Insertion) => {
    const list = inserts.get(id);
    if (list) list.push(ins);
    else inserts.set(id, [ins]);
  };

  // A) snap new points onto existing nodes or edges
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    let node: Vec2 | null = null;
    let nodeDist = SNAP_NODE;
    for (const r of joinable) {
      for (const q of r.points) {
        const d = dist(p, q);
        if (d < nodeDist) {
          nodeDist = d;
          node = q;
        }
      }
    }
    if (node) {
      pts[i] = { x: node.x, z: node.z };
      continue;
    }

    let best: { d: number; t: number; q: Vec2; road: T; k: number } | null = null;
    for (const r of joinable) {
      for (let k = 0; k < r.points.length - 1; k++) {
        const c = closestOnSegment(p, r.points[k], r.points[k + 1]);
        if (c.d < SNAP_EDGE && (!best || c.d < best.d)) best = { ...c, road: r, k };
      }
    }
    if (best) {
      if (best.t < 0.02 || best.t > 0.98) {
        const q = best.t < 0.5 ? best.road.points[best.k] : best.road.points[best.k + 1];
        pts[i] = { x: q.x, z: q.z };
      } else {
        const q = snapOutOfCorner(best.q, best.road, best.k);
        pts[i] = { x: q.x, z: q.z };
        // Moved onto the corner point: that node exists already, nothing to insert.
        if (q === best.q) add(best.road.id, { seg: best.k, t: best.t, p: { x: q.x, z: q.z } });
      }
    }
  }

  // B) existing nodes that lie on one of the new segments
  for (const r of crossable) {
    for (const q of r.points) {
      for (let s = 0; s < pts.length - 1; s++) {
        const c = closestOnSegment(q, pts[s], pts[s + 1]);
        if (c.d < SNAP_EDGE && c.t > 0.02 && c.t < 0.98) {
          add(NEW_ROAD, { seg: s, t: c.t, p: { x: q.x, z: q.z } });
          break;
        }
      }
    }
  }

  // C) crossings between new and existing segments
  for (const r of crossable) {
    for (let k = 0; k < r.points.length - 1; k++) {
      for (let s = 0; s < pts.length - 1; s++) {
        const x = intersect(r.points[k], r.points[k + 1], pts[s], pts[s + 1]);
        if (x) {
          add(r.id, { seg: k, t: x.t, p: x.p });
          add(NEW_ROAD, { seg: s, t: x.u, p: x.p });
        }
      }
    }
  }

  const updated = existing.map((r) => {
    const ins = inserts.get(r.id);
    return ins ? { ...r, points: applyInsertions(r.points, ins) } : r;
  });

  const newPoints = dedupe(applyInsertions(pts, inserts.get(NEW_ROAD)));
  if (newPoints.length < 2) return { roads: existing, created: null };

  return { roads: updated, created: { ...incoming, points: newPoints } };
}

/**
 * Finds real junctions: nodes where at least two roads meet at an angle.
 * A node where exactly two road ends run straight through (opposite directions) is just a
 * continuation and gets no plaza and no cut-outs, so its sidewalks stay unbroken.
 */
export function findJunctions(roads: Road[]): Junction[] {
  const clusters: {
    x: number;
    z: number;
    ids: Set<string>;
    radius: number;
    through: number;
    dirs: Vec2[];
    widths: Map<string, number>;
  }[] = [];

  const addNode = (road: Road, i: number) => {
    const p = road.points[i];
    const half = ASPHALT_HALF_WIDTH[road.kind];
    // Directions from this node towards its neighbours on the same road.
    const neighbours: Vec2[] = [];
    if (i > 0) neighbours.push({ x: road.points[i - 1].x - p.x, z: road.points[i - 1].z - p.z });
    if (i < road.points.length - 1) neighbours.push({ x: road.points[i + 1].x - p.x, z: road.points[i + 1].z - p.z });

    let c = clusters.find((cl) => Math.hypot(cl.x - p.x, cl.z - p.z) < NODE_MERGE);
    if (!c) {
      c = { x: p.x, z: p.z, ids: new Set(), radius: 0, through: 0, dirs: [], widths: new Map() };
      clusters.push(c);
    }
    c.ids.add(road.id);
    c.widths.set(road.id, half);
    c.radius = Math.max(c.radius, half);
    if (neighbours.length === 2) c.through = Math.max(c.through, half);
    c.dirs.push(...neighbours);
  };

  for (const road of roads) {
    for (let i = 0; i < road.points.length; i++) addNode(road, i);
  }

  return clusters
    .filter((c) => {
      if (c.ids.size < 2) return false;
      if (c.dirs.length === 2) {
        const [a, b] = c.dirs;
        const la = Math.hypot(a.x, a.z) || 1;
        const lb = Math.hypot(b.x, b.z) || 1;
        const straight = (a.x * b.x + a.z * b.z) / (la * lb) < -0.99;
        if (straight) return false;
      }
      return true;
    })
    .map((c) => ({
      x: c.x,
      z: c.z,
      radius: c.radius,
      plaza: c.through > 0 ? c.through : c.radius,
      widths: c.widths,
      // A bend between two roads gets an asphalt plaza only; a real crossing or T also cuts sidewalks.
      cut: c.dirs.length >= 3,
    }));
}

/**
 * Where a new control point should go: an existing node or road edge if one is close,
 * otherwise a point on the grid in one of the allowed 45° directions from the previous point.
 */
export function resolvePoint(raw: Vec2, roads: Path[], last: Vec2 | undefined): Vec2 {
  const net = snapToNetwork(raw, roads);
  if (net) return net;
  if (!last) return { x: snapToGrid(raw.x), z: snapToGrid(raw.z) };

  const dx = raw.x - last.x;
  const dz = raw.z - last.z;
  const angle = Math.round(Math.atan2(dz, dx) / ROAD_ANGLE_STEP) * ROAD_ANGLE_STEP;
  const along = Math.max(GRID_SIZE, Math.round((dx * Math.cos(angle) + dz * Math.sin(angle)) / GRID_SIZE) * GRID_SIZE);
  return { x: last.x + Math.cos(angle) * along, z: last.z + Math.sin(angle) * along };
}

/**
 * Snaps a free ground position onto an existing node (preferred) or road centre line.
 * Returns null when nothing is close enough, so the caller can fall back to the grid.
 */
export function snapToNetwork(p: Vec2, roads: Path[]): Vec2 | null {
  let node: Vec2 | null = null;
  let nodeDist = SNAP_NODE;
  for (const r of roads) {
    for (const q of r.points) {
      const d = dist(p, q);
      if (d < nodeDist) {
        nodeDist = d;
        node = q;
      }
    }
  }
  if (node) return { x: node.x, z: node.z };

  let best: { d: number; q: Vec2 } | null = null;
  for (const r of roads) {
    for (let k = 0; k < r.points.length - 1; k++) {
      const c = closestOnSegment(p, r.points[k], r.points[k + 1]);
      if (c.d < SNAP_EDGE && (!best || c.d < best.d)) best = { d: c.d, q: snapOutOfCorner(c.q, r, k) };
    }
  }
  return best ? { x: best.q.x, z: best.q.z } : null;
}

/** Shortest distance from p to a path's control polyline. */
export function distanceToPath(p: Vec2, path: Path): number {
  let best = Infinity;
  for (let k = 0; k < path.points.length - 1; k++) {
    best = Math.min(best, closestOnSegment(p, path.points[k], path.points[k + 1]).d);
  }
  return best;
}

/** A place where two paths of different networks cross, e.g. a level crossing. */
export interface Crossing {
  x: number;
  z: number;
  /** Path ids involved: [a, b]. */
  a: string;
  b: string;
  /** |sin| of the crossing angle: 1 = perpendicular, ~0.7 = 45°. */
  sin: number;
  /** Unit directions of the crossing segments of a and b. */
  dirA: Vec2;
  dirB: Vec2;
}

/** All points where a segment of a path in `as` properly crosses a segment of a path in `bs`. */
export function findCrossings(as: Path[], bs: Path[]): Crossing[] {
  const out: Crossing[] = [];
  for (const a of as) {
    for (const b of bs) {
      for (let i = 0; i < a.points.length - 1; i++) {
        for (let k = 0; k < b.points.length - 1; k++) {
          const p0 = a.points[i];
          const p1 = a.points[i + 1];
          const q0 = b.points[k];
          const q1 = b.points[k + 1];
          const x = intersectLoose(p0, p1, q0, q1);
          if (!x) continue;
          // Segments meeting at shared end points would be counted twice.
          if (out.some((c) => c.a === a.id && c.b === b.id && Math.hypot(c.x - x.x, c.z - x.z) < 0.5)) continue;
          const la = dist(p0, p1);
          const lb = dist(q0, q1);
          const dirA = { x: (p1.x - p0.x) / la, z: (p1.z - p0.z) / la };
          const dirB = { x: (q1.x - q0.x) / lb, z: (q1.z - q0.z) / lb };
          const sin = Math.abs(dirA.x * dirB.z - dirA.z * dirB.x);
          out.push({ x: x.x, z: x.z, a: a.id, b: b.id, sin: Math.max(0.2, sin), dirA, dirB });
        }
      }
    }
  }
  return out;
}

/** Segment intersection including the end points. */
function intersectLoose(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const rx = b.x - a.x;
  const rz = b.z - a.z;
  const sx = d.x - c.x;
  const sz = d.z - c.z;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qpx = c.x - a.x;
  const qpz = c.z - a.z;
  const t = (qpx * sz - qpz * sx) / den;
  const u = (qpx * rz - qpz * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + rx * t, z: a.z + rz * t };
}

/* ---------- clean junctions: no rounded corner where another road joins ---------- */

/** Road kinds whose junctions are normalised (motorways and ramps keep their own layout). */
const SPLIT_KINDS = new Set(["street", "bike"]);

/** Turn angle (radians) at interior point i of a polyline, 0 = straight. */
function turnAt(points: Vec2[], i: number) {
  const a = points[i - 1];
  const b = points[i];
  const c = points[i + 1];
  const ux = b.x - a.x;
  const uz = b.z - a.z;
  const vx = c.x - b.x;
  const vz = c.z - b.z;
  const lu = Math.hypot(ux, uz) || 1;
  const lv = Math.hypot(vx, vz) || 1;
  return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uz * vz) / (lu * lv))));
}

/** How far before/after a corner the rounded curve reaches (tangent length of the fillet). */
function cornerReach(path: Path, i: number) {
  const turn = turnAt(path.points, i);
  if (turn < 0.05) return 0;
  return CORNER_RADIUS[path.kind] * Math.tan(turn / 2);
}

/**
 * A point snapped onto segment k of `path`: if it lies inside the rounded part of a
 * corner, it moves onto the corner point itself (the junction then sits at the node and
 * the corner is split there, instead of a road ending in the middle of a curve).
 */
export function snapOutOfCorner(q: Vec2, path: Path, k: number): Vec2 {
  for (const i of [k, k + 1]) {
    if (i <= 0 || i >= path.points.length - 1) continue;
    const reach = cornerReach(path, i);
    const v = path.points[i];
    if (reach > 0 && dist(q, v) < reach + ASPHALT_HALF_WIDTH[path.kind as RoadKind]) return { x: v.x, z: v.z };
  }
  return q;
}

/**
 * Splits streets and cycle paths at every inner point where another street or cycle path
 * meets them. Junctions then always lie at path ends: no corner of a path is rounded
 * across a junction, and every branch gets its own approach. Returns the new list and,
 * per split path, the ids of its pieces (the first piece keeps the id).
 */
export function splitAtJunctions<T extends Path>(paths: T[], newId: () => string): { paths: T[]; pieces: Map<string, string[]> } {
  const pieces = new Map<string, string[]>();
  const touches = (p: Vec2, self: string) =>
    paths.some((o) => o.id !== self && SPLIT_KINDS.has(o.kind) && o.points.some((q) => dist(p, q) < NODE_MERGE));
  const out: T[] = [];
  for (const path of paths) {
    if (!SPLIT_KINDS.has(path.kind) || path.points.length < 3) {
      out.push(path);
      continue;
    }
    const cuts: number[] = [];
    for (let i = 1; i < path.points.length - 1; i++) if (touches(path.points[i], path.id)) cuts.push(i);
    if (cuts.length === 0) {
      out.push(path);
      continue;
    }
    const ids: string[] = [];
    let from = 0;
    for (const c of [...cuts, path.points.length - 1]) {
      const id = ids.length === 0 ? path.id : newId();
      ids.push(id);
      out.push({ ...path, id, points: path.points.slice(from, c + 1) });
      from = c;
    }
    pieces.set(path.id, ids);
  }
  return { paths: out, pieces };
}
