import { sampleDepth, TERRAIN_N, TERRAIN_RES, WORLD_HALF, type DepthGrid } from "./terrain";
import type { Vec2 } from "./types";

/**
 * Waterways for inland shipping: the connected bodies of water deep enough for a
 * barge, and which of them leave the map (a river running off the edge – the way to the
 * markets). A harbour on a closed pond or lake is useless. Ships follow the cheapest
 * route through deep water from their harbour to the map edge (Dijkstra on the depth
 * grid, deep middle preferred over the banks).
 */

/** Depth (below 0) a fairway cell needs: 1 m of water (the water surface is at 0.9). */
export const FAIRWAY_DEPTH = 1.9;
/** Depth that counts as navigable for loaded barges (1.5 m of water). */
export const NAVIGABLE_DEPTH = 2.4;

interface Waterways {
  /** Component id per grid cell, −1 = not a fairway. */
  label: Int32Array;
  /** Components that touch the map edge. */
  outlet: Set<number>;
}

const cache = new WeakMap<DepthGrid, Waterways>();

const cellOf = (x: number, z: number) => {
  const c = Math.round((x + WORLD_HALF) / TERRAIN_RES);
  const r = Math.round((z + WORLD_HALF) / TERRAIN_RES);
  return c < 0 || r < 0 || c >= TERRAIN_N || r >= TERRAIN_N ? -1 : r * TERRAIN_N + c;
};
const worldOf = (i: number): Vec2 => ({ x: (i % TERRAIN_N) * TERRAIN_RES - WORLD_HALF, z: Math.floor(i / TERRAIN_N) * TERRAIN_RES - WORLD_HALF });
const onEdge = (i: number) => {
  const c = i % TERRAIN_N;
  const r = Math.floor(i / TERRAIN_N);
  return c === 0 || r === 0 || c === TERRAIN_N - 1 || r === TERRAIN_N - 1;
};

export function waterways(grid: DepthGrid): Waterways {
  const hit = cache.get(grid);
  if (hit) return hit;
  const label = new Int32Array(grid.length).fill(-1);
  const outlet = new Set<number>();
  const stack: number[] = [];
  let next = 0;
  for (let i = 0; i < grid.length; i++) {
    if (label[i] !== -1 || grid[i] < FAIRWAY_DEPTH) continue;
    const id = next++;
    label[i] = id;
    stack.push(i);
    while (stack.length > 0) {
      const j = stack.pop()!;
      if (onEdge(j)) outlet.add(id);
      const c = j % TERRAIN_N;
      for (const k of [c > 0 ? j - 1 : -1, c < TERRAIN_N - 1 ? j + 1 : -1, j - TERRAIN_N, j + TERRAIN_N]) {
        if (k < 0 || k >= grid.length || label[k] !== -1 || grid[k] < FAIRWAY_DEPTH) continue;
        label[k] = id;
        stack.push(k);
      }
    }
  }
  const w = { label, outlet };
  cache.set(grid, w);
  return w;
}

/** Nearest fairway cell to p within `radius` metres that belongs to a waterway leaving the map. */
export function nearestOutletCell(p: Vec2, grid: DepthGrid, radius = 60): number {
  const { label, outlet } = waterways(grid);
  let best = -1;
  let bestD = Infinity;
  for (let dz = -radius; dz <= radius; dz += TERRAIN_RES) {
    for (let dx = -radius; dx <= radius; dx += TERRAIN_RES) {
      const d = dx * dx + dz * dz;
      if (d > radius * radius || d >= bestD) continue;
      const i = cellOf(p.x + dx, p.z + dz);
      if (i < 0 || label[i] < 0 || !outlet.has(label[i])) continue;
      best = i;
      bestD = d;
    }
  }
  return best;
}

/** True if navigable water (deep enough for barges) that leaves the map lies near p. */
export function reachesMarkets(p: Vec2, grid: DepthGrid, radius = 60) {
  const i = nearestOutletCell(p, grid, radius);
  return i >= 0 && sampleDepth(grid, worldOf(i).x, worldOf(i).z) >= FAIRWAY_DEPTH;
}

/** Binary min-heap of (cost, cell). */
class Heap {
  private cost: number[] = [];
  private cell: number[] = [];
  get size() {
    return this.cost.length;
  }
  push(c: number, i: number) {
    this.cost.push(c);
    this.cell.push(i);
    let k = this.cost.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.cost[p] <= this.cost[k]) break;
      [this.cost[p], this.cost[k]] = [this.cost[k], this.cost[p]];
      [this.cell[p], this.cell[k]] = [this.cell[k], this.cell[p]];
      k = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.cost[0], this.cell[0]];
    const lc = this.cost.pop()!;
    const li = this.cell.pop()!;
    if (this.cost.length > 0) {
      this.cost[0] = lc;
      this.cell[0] = li;
      let k = 0;
      for (;;) {
        const a = 2 * k + 1;
        const b = a + 1;
        let m = k;
        if (a < this.cost.length && this.cost[a] < this.cost[m]) m = a;
        if (b < this.cost.length && this.cost[b] < this.cost[m]) m = b;
        if (m === k) break;
        [this.cost[m], this.cost[k]] = [this.cost[k], this.cost[m]];
        [this.cell[m], this.cell[k]] = [this.cell[k], this.cell[m]];
        k = m;
      }
    }
    return top;
  }
}

/**
 * Route from `start` through deep water to the map edge (world points every ~10 m,
 * starting at `start`), or just [start] if no waterway leaves the map nearby.
 */
export function routeToEdge(start: Vec2, grid: DepthGrid): Vec2[] {
  const from = nearestOutletCell(start, grid);
  if (from < 0) return [start];
  const { label } = waterways(grid);
  const comp = label[from];
  const dist = new Float64Array(grid.length).fill(Infinity);
  const prev = new Int32Array(grid.length).fill(-1);
  const heap = new Heap();
  dist[from] = 0;
  heap.push(0, from);
  let goal = -1;
  const DIAG = Math.SQRT2;
  while (heap.size > 0) {
    const [d, i] = heap.pop();
    if (d > dist[i]) continue;
    if (onEdge(i)) {
      goal = i;
      break;
    }
    const c = i % TERRAIN_N;
    for (const [k, len] of [
      [c > 0 ? i - 1 : -1, 1],
      [c < TERRAIN_N - 1 ? i + 1 : -1, 1],
      [i - TERRAIN_N, 1],
      [i + TERRAIN_N, 1],
      [c > 0 ? i - TERRAIN_N - 1 : -1, DIAG],
      [c < TERRAIN_N - 1 ? i - TERRAIN_N + 1 : -1, DIAG],
      [c > 0 ? i + TERRAIN_N - 1 : -1, DIAG],
      [c < TERRAIN_N - 1 ? i + TERRAIN_N + 1 : -1, DIAG],
    ] as [number, number][]) {
      if (k < 0 || k >= grid.length || label[k] !== comp) continue;
      // Shallow water near the banks costs more: ships keep to the middle.
      const shallow = Math.max(0, 4 - grid[k]);
      const nd = d + len * (1 + shallow * shallow * 0.6);
      if (nd < dist[k]) {
        dist[k] = nd;
        prev[k] = i;
        heap.push(nd, k);
      }
    }
  }
  if (goal < 0) return [start];
  const cells: number[] = [];
  for (let i = goal; i >= 0; i = prev[i]) cells.push(i);
  cells.reverse();
  // Every 5th cell (10 m), smoothed with a moving average.
  const raw = cells.filter((_, k) => k % 5 === 0 || k === cells.length - 1).map(worldOf);
  const smooth = raw.map((p, k) => {
    const a = raw[Math.max(0, k - 1)];
    const b = raw[Math.min(raw.length - 1, k + 1)];
    return { x: (a.x + 2 * p.x + b.x) / 4, z: (a.z + 2 * p.z + b.z) / 4 };
  });
  return [start, ...smooth];
}
