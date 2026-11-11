import { insideFootprint, sizeOf, type Building } from "./economy";
import { footprintSamples } from "./placement";
import { cableGrids, feedPoint, gridOf, polylineDistance } from "./power";
import type { Cable, Vec2 } from "./types";

/**
 * Wires transformers without power to the grid: a straight overhead line from the
 * transformer's terminal to the nearest cable of a grid that has a power station. Lines
 * never pass over buildings (the same rule as for drawn cables); a transformer that gets
 * wired becomes part of the grid, so the next one may hang on its line (chains).
 */

/** Longest automatic line (m). */
const MAX_LENGTH = 900;
/** Buildings must stay this far from the line (placement forbids buildings under cables at 3 m). */
const CLEARANCE = 3.5;
/** Detours: nearest cables tried, bend distances from the transformer and directions. */
const DETOUR_TARGETS = 12;
const DETOUR_RADII = [15, 30, 50, 80];
const DETOUR_ANGLES = 24;

export interface AutoCableResult {
  cables: Cable[];
  /** New lines, their total length (m) and the transformers that could not be wired. */
  added: Cable[];
  length: number;
  failed: string[];
}

function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  return { x: a.x + dx * t, z: a.z + dz * t };
}

/** True if the straight line a→b passes over no building (except the ones in `skip`). */
function lineIsFree(a: Vec2, b: Vec2, buildings: Building[], samples: Map<string, Vec2[]>, skip: Set<string>) {
  const minX = Math.min(a.x, b.x) - 60;
  const maxX = Math.max(a.x, b.x) + 60;
  const minZ = Math.min(a.z, b.z) - 60;
  const maxZ = Math.max(a.z, b.z) + 60;
  for (const o of buildings) {
    if (skip.has(o.id) || o.x < minX || o.x > maxX || o.z < minZ || o.z > maxZ) continue;
    let pts = samples.get(o.id);
    if (!pts) samples.set(o.id, (pts = footprintSamples(o)));
    if (pts.some((p) => polylineDistance(p, [a, b]) < CLEARANCE)) return false;
  }
  return true;
}

/**
 * Transformers (all, or only `only`) not on a powered grid get a line to the nearest powered
 * cable. `newId` names the new cables.
 */
export function autoConnectTransformers(buildings: Building[], cables: Cable[], newId: () => string, only?: string): AutoCableResult {
  const plants = buildings.filter((b) => b.kind === "powerplant");
  let all = cables;
  const added: Cable[] = [];
  let length = 0;
  const samples = new Map<string, Vec2[]>();
  const poweredGrids = (list: Cable[]) => {
    const grids = cableGrids(list);
    const powered = new Set<number>();
    for (const p of plants) {
      const g = gridOf(p, list, grids);
      if (g !== null) powered.add(g);
    }
    return { grids, powered };
  };
  let { grids, powered } = poweredGrids(all);
  const isPowered = (t: Building) => {
    const g = gridOf(t, all, grids);
    return g !== null && powered.has(g);
  };
  let open = buildings.filter((b) => b.kind === "transformer" && (!only || b.id === only) && !isPowered(b));
  // Greedy: always wire the transformer closest to the grid first, so later ones can chain.
  while (open.length > 0 && powered.size > 0) {
    let best: { t: Building; points: Vec2[]; d: number } | null = null;
    for (const t of open) {
      const from = feedPoint(t)!;
      const options: { to: Vec2; d: number }[] = [];
      for (const c of all) {
        if (!powered.has(grids.get(c.id)!)) continue;
        for (let i = 0; i < c.points.length - 1; i++) {
          const to = closestOnSegment(from, c.points[i], c.points[i + 1]);
          options.push({ to, d: Math.hypot(to.x - from.x, to.z - from.z) });
        }
        if (c.points.length === 1) options.push({ to: c.points[0], d: Math.hypot(c.points[0].x - from.x, c.points[0].z - from.z) });
      }
      options.sort((a, b) => a.d - b.d);
      // Buildings the line ends at (plant, other transformers) may be touched.
      const skip = new Set(buildings.filter((o) => o.id === t.id || ((o.kind === "powerplant" || o.kind === "transformer") && options.length > 0 && insideFootprint(o, options[0].to.x, options[0].to.z, 4))).map((o) => o.id));
      const endsAt = (to: Vec2) => {
        const end = new Set(skip);
        for (const b of buildings) if ((b.kind === "powerplant" || b.kind === "transformer") && insideFootprint(b, to.x, to.z, 4)) end.add(b.id);
        return end;
      };
      let straight = false;
      for (const o of options) {
        if (o.d > MAX_LENGTH || (best && o.d >= best.d)) break;
        if (lineIsFree(from, o.to, buildings, samples, endsAt(o.to))) {
          best = { t, points: [from, o.to], d: o.d };
          straight = true;
          break;
        }
      }
      // Built in: one bend (an angle pylon) around the houses, for the nearest few cables.
      if (!straight) {
        for (const o of options.slice(0, DETOUR_TARGETS)) {
          if (o.d > MAX_LENGTH) break;
          const end = endsAt(o.to);
          for (const r of DETOUR_RADII) {
            for (let k = 0; k < DETOUR_ANGLES; k++) {
              const a = (k / DETOUR_ANGLES) * Math.PI * 2;
              const w = { x: from.x + Math.cos(a) * r, z: from.z + Math.sin(a) * r };
              const d = r + Math.hypot(o.to.x - w.x, o.to.z - w.z);
              if (d > MAX_LENGTH || (best && d >= best.d)) continue;
              if (lineIsFree(from, w, buildings, samples, skip) && lineIsFree(w, o.to, buildings, samples, end)) best = { t, points: [from, w, o.to], d };
            }
          }
        }
      }
    }
    // Last resort: a path search around the houses, straightened to a few pylons.
    if (!best) {
      for (const t of open) {
        const from = feedPoint(t)!;
        const route = gridRoute(from, all.filter((c) => powered.has(grids.get(c.id)!)), buildings, samples, t.id);
        if (route && (!best || route.d < best.d)) best = { t, points: route.points, d: route.d };
      }
    }
    if (!best) break;
    const cable: Cable = { id: newId(), points: best.points };
    all = [...all, cable];
    added.push(cable);
    length += best.d;
    ({ grids, powered } = poweredGrids(all));
    open = open.filter((t) => !isPowered(t));
  }
  return { cables: all, added, length, failed: open.map((t) => t.id) };
}

/** Grid cell size (m) and search reach around the transformer for `gridRoute`. */
const CELL = 2;
const ROUTE_REACH = 400;

/**
 * Shortest way over free ground (cells away from every building) from `from` to any of the
 * powered cables, then straightened: from each point the farthest point still in free line
 * of sight becomes the next pylon.
 */
function gridRoute(from: Vec2, powered: Cable[], buildings: Building[], samples: Map<string, Vec2[]>, own: string) {
  const n = Math.ceil((2 * ROUTE_REACH) / CELL);
  const x0 = from.x - ROUTE_REACH;
  const z0 = from.z - ROUTE_REACH;
  const idx = (i: number, j: number) => j * n + i;
  const centre = (i: number, j: number): Vec2 => ({ x: x0 + (i + 0.5) * CELL, z: z0 + (j + 0.5) * CELL });
  const blocked = new Uint8Array(n * n);
  const goal = new Map<number, Vec2>();
  for (const o of buildings) {
    if (o.id === own) continue;
    const r = Math.max(...sizeOf(o)) / 2 + CLEARANCE + CELL;
    if (Math.abs(o.x - from.x) > ROUTE_REACH + r || Math.abs(o.z - from.z) > ROUTE_REACH + r) continue;
    const i0 = Math.max(0, Math.floor((o.x - r - x0) / CELL));
    const i1 = Math.min(n - 1, Math.floor((o.x + r - x0) / CELL));
    const j0 = Math.max(0, Math.floor((o.z - r - z0) / CELL));
    const j1 = Math.min(n - 1, Math.floor((o.z + r - z0) / CELL));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const c = centre(i, j);
        if (insideFootprint(o, c.x, c.z, CLEARANCE + 0.5)) blocked[idx(i, j)] = 1;
      }
  }
  for (const c of powered)
    for (let k = 0; k < c.points.length - 1; k++) {
      const a = c.points[k];
      const b = c.points[k + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      for (let s = 0; s <= len; s += CELL / 2) {
        const p = { x: a.x + ((b.x - a.x) * s) / Math.max(len, 1e-6), z: a.z + ((b.z - a.z) * s) / Math.max(len, 1e-6) };
        const i = Math.floor((p.x - x0) / CELL);
        const j = Math.floor((p.z - z0) / CELL);
        if (i >= 0 && j >= 0 && i < n && j < n && !goal.has(idx(i, j))) goal.set(idx(i, j), p);
      }
    }
  if (goal.size === 0) return null;
  // Dijkstra on 8 neighbours (binary heap).
  const dist = new Float64Array(n * n).fill(Infinity);
  const prev = new Int32Array(n * n).fill(-1);
  const heap: [number, number][] = [];
  const push = (d: number, c: number) => {
    heap.push([d, c]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  const si = Math.floor((from.x - x0) / CELL);
  const sj = Math.floor((from.z - z0) / CELL);
  const start = idx(si, sj);
  dist[start] = 0;
  push(0, start);
  let end = -1;
  while (heap.length > 0) {
    const [d, c] = pop();
    if (d > dist[c]) continue;
    if (goal.has(c)) {
      end = c;
      break;
    }
    if (d > MAX_LENGTH) break;
    const i = c % n;
    const j = (c - i) / n;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const nc = idx(ni, nj);
        // The transformer's own cell may start inside the clearance of a close neighbour.
        if (blocked[nc] && d > 12) continue;
        const nd = d + (di && dj ? Math.SQRT2 : 1) * CELL;
        if (nd < dist[nc]) {
          dist[nc] = nd;
          prev[nc] = c;
          push(nd, nc);
        }
      }
  }
  if (end < 0) return null;
  const cells: Vec2[] = [];
  for (let c = end; c >= 0; c = prev[c]) cells.push(centre(c % n, Math.floor(c / n)));
  cells.reverse();
  cells[0] = from;
  cells[cells.length - 1] = goal.get(end)!;
  // Straighten: jump to the farthest cell still in free line of sight.
  const skip = new Set([own]);
  for (const b of buildings) if ((b.kind === "powerplant" || b.kind === "transformer") && insideFootprint(b, cells[cells.length - 1].x, cells[cells.length - 1].z, 4)) skip.add(b.id);
  const points: Vec2[] = [from];
  let k = 0;
  while (k < cells.length - 1) {
    let next = k + 1;
    for (let m = cells.length - 1; m > k + 1; m--) {
      if (lineIsFree(cells[k], cells[m], buildings, samples, skip)) {
        next = m;
        break;
      }
    }
    points.push(cells[next]);
    k = next;
  }
  let d = 0;
  for (let i = 1; i < points.length; i++) d += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return d <= MAX_LENGTH ? { points, d } : null;
}
