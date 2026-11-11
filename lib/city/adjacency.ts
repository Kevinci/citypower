import { HALF_WIDTH, NETWORK_OF, OUTER_HALF_WIDTH, type NetworkId, type Path, type Vec2 } from "./types";
import { sampleDepth, WET_DEPTH, type DepthGrid } from "./terrain";

/**
 * Neighbourhood queries: what is built at or next to a place.
 *
 * Everything that has to react to its neighbours uses this module: guardrails along water
 * and tracks, lamps and masts that must not stand inside another path, canal banks that
 * give way to roads. It is also the intended entry point for buildings later on: a house
 * asks for the nearest road (`nearestAccess`), a steelworks for the nearest track and
 * canal, so connection rules live in one place.
 */

/** Result of a nearest-path query. */
export interface Access {
  path: Path;
  /** Closest point on the path's centre line. */
  point: Vec2;
  /** Distance from the query point to the centre line. */
  distance: number;
  /** Distance from the query point to the path's outer edge (0 if inside). */
  gap: number;
  /** Unit direction of the path at `point`. */
  direction: Vec2;
}

function closestOnSegment(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  const q = { x: a.x + dx * t, z: a.z + dz * t };
  const len = Math.sqrt(len2) || 1;
  return { q, d: Math.hypot(p.x - q.x, p.z - q.z), dir: { x: dx / len, z: dz / len } };
}

/** Closest point on one path. */
export function closestOnPath(p: Vec2, path: Path): Access {
  let best: Access | null = null;
  for (let k = 0; k < path.points.length - 1; k++) {
    const c = closestOnSegment(p, path.points[k], path.points[k + 1]);
    if (!best || c.d < best.distance) {
      best = {
        path,
        point: c.q,
        distance: c.d,
        gap: Math.max(0, c.d - OUTER_HALF_WIDTH[path.kind]),
        direction: c.dir,
      };
    }
  }
  return best ?? { path, point: p, distance: Infinity, gap: Infinity, direction: { x: 1, z: 0 } };
}

export interface QueryOptions {
  /** Only paths of these networks. */
  networks?: NetworkId[];
  /** Ignore these path ids (usually the asking path itself). */
  exclude?: string[];
  /** Use the core width (asphalt, ballast, water) instead of the outer width. */
  core?: boolean;
  /** Grow every footprint by this many metres. */
  margin?: number;
}

const accepts = (path: Path, o: QueryOptions) =>
  (!o.networks || o.networks.includes(NETWORK_OF[path.kind])) && !(o.exclude && o.exclude.includes(path.id));

/** The first path whose footprint contains p, or null. */
export function occupant(p: Vec2, paths: Path[], o: QueryOptions = {}): Path | null {
  for (const path of paths) {
    if (!accepts(path, o)) continue;
    const half = (o.core ? HALF_WIDTH : OUTER_HALF_WIDTH)[path.kind] + (o.margin ?? 0);
    if (closestOnPath(p, path).distance < half) return path;
  }
  return null;
}

/**
 * Nearest path within `maxGap` metres of its outer edge, or null.
 * Future buildings use this to find their connection: road for houses, track or canal
 * for industry.
 */
export function nearestAccess(p: Vec2, paths: Path[], maxGap: number, o: QueryOptions = {}): Access | null {
  let best: Access | null = null;
  for (const path of paths) {
    if (!accepts(path, o)) continue;
    const a = closestOnPath(p, path);
    if (a.gap <= maxGap && (!best || a.gap < best.gap)) best = a;
  }
  return best;
}

/** True if open water (natural or a finished canal) is at p. */
export const waterAt = (grid: DepthGrid, p: Vec2, minDepth = WET_DEPTH * 0.5) => sampleDepth(grid, p.x, p.z) > minDepth;

/** Width of the cap stone on top of a quay wall; must match water-geometry. */
const QUAY_CAP = 0.5;

/**
 * Pulls a point that lies on a canal (water or towpath) back to the quay edge, so a road or
 * track drawn up to a canal ends flush at the quay instead of hanging over the water.
 * With a previous point the point slides back along the drawn direction (keeps the 45°
 * step); without one it moves straight away from the canal.
 * Points beyond the canal (the far bank) are left alone: that is a bridge.
 */
export function snapToQuay(p: Vec2, last: Vec2 | undefined, canals: Path[]): Vec2 {
  const edgeOf = (c: Path) => HALF_WIDTH[c.kind] + QUAY_CAP;
  const inside = (q: Vec2) => canals.find((c) => closestOnPath(q, c).distance < edgeOf(c)) ?? null;
  const towpath = (q: Vec2) => canals.find((c) => closestOnPath(q, c).distance < OUTER_HALF_WIDTH[c.kind]) ?? null;

  const hit = towpath(p);
  if (!hit) return p;
  // Already on the quay and coming from outside: end exactly at the quay edge.
  if (last) {
    const dx = p.x - last.x;
    const dz = p.z - last.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return p;
    // March from the last point towards p (and a little past it, across the towpath) and
    // stop right before the water.
    const ux = dx / len;
    const uz = dz / len;
    const reach = len + (OUTER_HALF_WIDTH[hit.kind] - edgeOf(hit));
    let prev = last;
    for (let d = 0.1; d <= reach; d += 0.1) {
      const q = { x: last.x + ux * d, z: last.z + uz * d };
      if (inside(q)) return d <= 0.1 ? p : prev;
      prev = q;
    }
    return p;
  }
  const a = closestOnPath(p, hit);
  const d = a.distance || 1;
  const k = edgeOf(hit) / d;
  return { x: a.point.x + (p.x - a.point.x) * k, z: a.point.z + (p.z - a.point.z) * k };
}
