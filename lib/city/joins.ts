import { resolvePoint, snapOutOfCorner } from "./network";
import { OUTER_HALF_WIDTH, type BuildKind, type Path, type Vec2 } from "./types";

/**
 * Where the next point of a path being drawn goes, and whether it may go there. The cursor
 * ring shows the result: green = attaches cleanly to an existing path, red = not possible
 * (with a reason), neutral = free point in open land. The store refuses red points.
 *
 * Rules:
 * - Anywhere on the surface of a joinable path snaps onto it (not only on the centre line).
 *   A point on a road surface that is not on the road would overlap it.
 * - Near an existing point of that path (a junction, corner or end) it snaps onto that point,
 *   so junctions never sit a few metres apart.
 * - The new segment must not run along an existing path (overlap) or cross/meet it at a very
 *   acute angle: the junction would smear into a long strip of asphalt.
 */

export type JoinState = "join" | "free" | "blocked";

export interface PointCheck {
  p: Vec2;
  state: JoinState;
  reason: string | null;
}

/** Snap onto an existing point of a path this close to it (metres along the path). */
const NODE_PULL = 12;
/** Shortest segment that may be drawn. */
const MIN_SEGMENT = 6;
/** Acutest angle at which paths may meet or cross (sin 25°). */
const MIN_SIN = Math.sin((25 * Math.PI) / 180);

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

function closest(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l));
  const q = { x: a.x + t * dx, z: a.z + t * dz };
  return { q, d: dist(p, q), t };
}

/** Snaps p onto the surface of the nearest path it lies on, or null. */
function snapOnSurface(p: Vec2, paths: Path[]): Vec2 | null {
  // Existing points first (junctions, corners, ends) within the path's width.
  let node: Vec2 | null = null;
  let nodeD = Infinity;
  for (const r of paths) {
    const reach = OUTER_HALF_WIDTH[r.kind] + 1.5;
    for (const q of r.points) {
      const d = dist(p, q);
      if (d < reach && d < nodeD) {
        node = q;
        nodeD = d;
      }
    }
  }
  if (node) return { x: node.x, z: node.z };
  let best: { q: Vec2; d: number; r: Path; k: number } | null = null;
  for (const r of paths) {
    const reach = OUTER_HALF_WIDTH[r.kind] + 0.5;
    for (let k = 0; k < r.points.length - 1; k++) {
      const c = closest(p, r.points[k], r.points[k + 1]);
      if (c.d < reach && (!best || c.d < best.d)) best = { q: c.q, d: c.d, r, k };
    }
  }
  if (!best) return null;
  // Close to an existing point of that path: use it instead of a second junction next to it.
  const { r, k } = best;
  for (const v of [r.points[k], r.points[k + 1]]) if (dist(best.q, v) < NODE_PULL) return { x: v.x, z: v.z };
  return snapOutOfCorner(best.q, r, k);
}

/** True if p lies on (one of the centre lines of) a path. */
function onPath(p: Vec2, paths: Path[]) {
  return paths.some((r) => r.points.some((q, i) => i < r.points.length - 1 && closest(p, q, r.points[i + 1]).d < 0.05));
}

/** |sin| of the angle between direction d and the path segment nearest to p. */
function sinAt(p: Vec2, d: Vec2, r: Path) {
  let best: { a: Vec2; b: Vec2; d: number } | null = null;
  for (let k = 0; k < r.points.length - 1; k++) {
    const c = closest(p, r.points[k], r.points[k + 1]);
    if (!best || c.d < best.d) best = { a: r.points[k], b: r.points[k + 1], d: c.d };
  }
  if (!best) return 1;
  const sx = best.b.x - best.a.x;
  const sz = best.b.z - best.a.z;
  const l = Math.hypot(sx, sz) * Math.hypot(d.x, d.z) || 1;
  return Math.abs(sx * d.z - sz * d.x) / l;
}

/** Why segment a→b cannot be built against the existing paths, or null. */
function segmentProblem(a: Vec2, b: Vec2, kind: BuildKind, paths: Path[]): string | null {
  const len = dist(a, b);
  if (len < MIN_SEGMENT) return "Zu kurz – weiter weg ansetzen";
  const dir = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
  const half = OUTER_HALF_WIDTH[kind];
  for (const r of paths) {
    const reach = OUTER_HALF_WIDTH[r.kind] + half - 0.5;
    // Runs of the new segment that lie on the other path's surface.
    let run = 0;
    let start = 0;
    const step = 1;
    const n = Math.ceil(len / step);
    for (let i = 0; i <= n + 1; i++) {
      const t = Math.min(1, (i * step) / len);
      const s = { x: a.x + dir.x * t * len, z: a.z + dir.z * t * len };
      const inside = i <= n && r.points.some((q, k) => k < r.points.length - 1 && closest(s, q, r.points[k + 1]).d < reach);
      if (inside) {
        if (run === 0) start = t;
        run += step;
        continue;
      }
      if (run > 0) {
        const end = Math.min(1, t);
        const atEnd = start < 1e-6 || end > 1 - 1e-6;
        // A crossing at 25° is (2·reach)/sin 25° long; half of that at an end of the segment.
        const allowed = ((atEnd ? 1 : 2) * reach) / MIN_SIN + 1;
        if (run > allowed) {
          const mid = { x: a.x + dir.x * ((start + end) / 2) * len, z: a.z + dir.z * ((start + end) / 2) * len };
          const sin = sinAt(mid, dir, r);
          return sin < MIN_SIN && sin > 0.1
            ? "Zu spitzer Winkel zur Straße – steiler anschließen (mind. 25°)"
            : "Überlappt eine vorhandene Straße – an einer Kreuzung oder am Ende ansetzen";
        }
        run = 0;
      }
    }
  }
  return null;
}

/**
 * Resolves the raw cursor position to the next point of the draft and judges it.
 * `paths` are the paths the new one joins at grade.
 */
export function checkPoint(raw: Vec2, paths: Path[], last: Vec2 | undefined, kind: BuildKind): PointCheck {
  let p = snapOnSurface(raw, paths) ?? resolvePoint(raw, paths, last);
  // The grid/angle step can land a free point on a road surface: snap it on then.
  if (!onPath(p, paths)) p = snapOnSurface(p, paths) ?? p;
  const joined = onPath(p, paths) || paths.some((r) => r.points.some((q) => dist(q, p) < 0.05));
  if (last) {
    if (dist(last, p) < 0.05) return { p, state: "blocked", reason: null };
    const problem = segmentProblem(last, p, kind, paths);
    if (problem) return { p, state: "blocked", reason: problem };
  }
  return { p, state: joined ? "join" : "free", reason: null };
}
