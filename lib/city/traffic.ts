import * as THREE from "three";
import { FLAT, type Profile } from "./grade";
import { mulberry32 } from "./random";
import { buildFrames, cumulative, type Frame } from "./road-geometry";
import { HALF_WIDTH, OUTER_HALF_WIDTH, type Road, type RoadKind } from "./types";

/**
 * Autonomous road traffic.
 *
 * The finished road network becomes a lane graph: every road is cut at its junction
 * nodes into segments, each segment gives one directed edge per travel direction
 * (right-hand traffic: forward travel uses the +n side). Ramps are one-way and attach to
 * the motorway through virtual nodes where they leave or join it.
 * Cars follow edges, keep distance to the car ahead and pick a random next edge at every
 * node (straight on is preferred, U-turns only at dead ends).
 */

/** Lateral lane centres (m, on the right of the travel direction). */
const LANES: Partial<Record<RoadKind, number[]>> = {
  street: [1.9],
  highway: [3.4, 7.1],
  ramp: [0],
};

/** Cruising speed per road kind, m/s. */
const SPEED: Partial<Record<RoadKind, number>> = { street: 12, highway: 25, ramp: 15 };

/** Vehicles keep this much space to the one ahead (m, bumper to bumper incl. length). */
const SAFE_GAP = 9;
/** Cars on the network: one per this many metres of lane, capped. */
const METRES_PER_CAR = 85;
const MAX_CARS = 120;

export const drivable = (r: Road) => r.kind in LANES;

export interface Edge {
  index: number;
  road: Road;
  frames: Frame[];
  dist: number[];
  /** Station where the edge starts (in travel direction) and its length. */
  s0: number;
  length: number;
  /** +1 = along the road's point order, -1 = against it. */
  dir: 1 | -1;
  from: string;
  to: string;
  lanes: number[];
  speed: number;
  /** Traffic light at the end of this edge, if any. */
  signal?: { id: number; group: number; stop: number };
}

/** Light cycle: group 0 green, yellow, all red, group 1 green, yellow, all red. */
const GREEN = 14;
const YELLOW = 3;
const ALL_RED = 2;
export const SIGNAL_CYCLE = 2 * (GREEN + YELLOW + ALL_RED);

export type LightState = "green" | "yellow" | "red";

export interface SignalHead {
  /** Pole position (on the right before the stop line) and the way the head faces. */
  pole: THREE.Vector3;
  yaw: number;
  group: number;
  /** Stop line centre and its direction across the lane. */
  stopLine: THREE.Vector3;
  stopYaw: number;
  stopWidth: number;
}

export interface Signal {
  id: number;
  offset: number;
  heads: SignalHead[];
}

/** Light shown to a group at time t (seconds). */
export function lightState(signal: Signal, group: number, t: number): LightState {
  const phase = (((t + signal.offset) % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  const half = GREEN + YELLOW + ALL_RED;
  const local = group === 0 ? phase : (phase + half) % SIGNAL_CYCLE;
  if (local < GREEN) return "green";
  if (local < GREEN + YELLOW) return "yellow";
  return "red";
}

export interface LaneGraph {
  edges: Edge[];
  signals: Signal[];
  /** Node key → edges starting there. */
  outgoing: Map<string, number[]>;
  totalLength: number;
}

const keyOf = (x: number, z: number) => `${Math.round(x * 2)}:${Math.round(z * 2)}`;

function stationOfPoint(frames: Frame[], dist: number[], x: number, z: number) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < frames.length; i++) {
    const d = (frames[i].p.x - x) ** 2 + (frames[i].p.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { s: dist[best], d: Math.sqrt(bestD) };
}

export function buildLaneGraph(roads: Road[], profiles: Map<string, Profile>): LaneGraph {
  const usable = roads.filter(drivable);
  const prepared = usable.map((road) => {
    const frames = buildFrames(road.points, road.kind, profiles.get(road.id) ?? FLAT);
    return { road, frames, dist: cumulative(frames) };
  });

  // Count how many roads use each control point: shared points are junction nodes.
  const usage = new Map<string, number>();
  for (const r of usable) for (const p of r.points) usage.set(keyOf(p.x, p.z), (usage.get(keyOf(p.x, p.z)) ?? 0) + 1);

  // Nodes per road as (station, key).
  const nodes = new Map<string, { s: number; key: string }[]>();
  for (const { road, frames, dist } of prepared) {
    const list: { s: number; key: string }[] = [];
    const last = road.points.length - 1;
    road.points.forEach((p, i) => {
      const k = keyOf(p.x, p.z);
      if (i === 0 || i === last || (usage.get(k) ?? 0) > 1) {
        list.push({ s: stationOfPoint(frames, dist, p.x, p.z).s, key: k });
      }
    });
    nodes.set(road.id, list);
  }

  // Ramps leave and join motorways without a shared point: add virtual nodes on the
  // motorway where a ramp end lies on it.
  const motorways = prepared.filter((p) => p.road.kind === "highway");
  for (const ramp of prepared.filter((p) => p.road.kind === "ramp")) {
    const ends = [0, ramp.road.points.length - 1];
    for (const e of ends) {
      const p = ramp.road.points[e];
      for (const m of motorways) {
        const st = stationOfPoint(m.frames, m.dist, p.x, p.z);
        if (st.d > 14) continue;
        const key = `v:${ramp.road.id}:${e}`;
        nodes.get(m.road.id)?.push({ s: st.s, key });
        const list = nodes.get(ramp.road.id);
        const own = list?.find((n) => n.key === keyOf(p.x, p.z));
        if (own) own.key = key;
      }
    }
  }

  const edges: Edge[] = [];
  const outgoing = new Map<string, number[]>();
  let totalLength = 0;
  const add = (e: Omit<Edge, "index">) => {
    const edge = { ...e, index: edges.length };
    edges.push(edge);
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.index);
    outgoing.set(edge.from, list);
    totalLength += edge.length * edge.lanes.length;
  };

  for (const { road, frames, dist } of prepared) {
    const list = (nodes.get(road.id) ?? []).sort((a, b) => a.s - b.s);
    const lanes = LANES[road.kind] ?? [0];
    const speed = SPEED[road.kind] ?? 10;
    for (let k = 0; k < list.length - 1; k++) {
      const a = list[k];
      const b = list[k + 1];
      const length = b.s - a.s;
      if (length < 1) continue;
      add({ road, frames, dist, s0: a.s, length, dir: 1, from: a.key, to: b.key, lanes, speed });
      if (road.kind !== "ramp") add({ road, frames, dist, s0: b.s, length, dir: -1, from: b.key, to: a.key, lanes, speed });
    }
  }
  const signals = buildSignals(edges);
  return { edges, outgoing, totalLength, signals };
}

/**
 * Traffic lights at every node where three or more approaches meet (junctions and the
 * T-junctions of motorway ramps). Approaches roughly parallel to the first one form group
 * 0, the crossing ones group 1, so opposite directions get green together.
 */
function buildSignals(edges: Edge[]): Signal[] {
  const incoming = new Map<string, Edge[]>();
  for (const e of edges) {
    if (e.to.startsWith("v:")) continue;
    const list = incoming.get(e.to) ?? [];
    list.push(e);
    incoming.set(e.to, list);
  }
  const signals: Signal[] = [];
  const pos = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const ref = new THREE.Vector3();
  for (const [node, list] of incoming) {
    if (list.length < 3) continue;
    // Stop lines just before the widest crossing road.
    const widest = Math.max(...list.map((e) => HALF_WIDTH[e.road.kind]));
    const stop = widest + 2.5;
    let hash = 0;
    for (let i = 0; i < node.length; i++) hash = (hash * 31 + node.charCodeAt(i)) >>> 0;
    const signal: Signal = { id: signals.length, offset: hash % SIGNAL_CYCLE, heads: [] };
    edgePose(list[0], list[0].length - 0.5, 0, pos, ref);
    for (const e of list) {
      if (e.length < stop + 4) continue;
      edgePose(e, e.length - 0.5, 0, pos, dir);
      const group = Math.abs(dir.dot(ref)) > 0.7 ? 0 : 1;
      e.signal = { id: signal.id, group, stop };
      const yaw = Math.atan2(dir.x, dir.z);
      const pole = new THREE.Vector3();
      const lane = (LANES[e.road.kind] ?? [0])[0];
      edgePose(e, e.length - stop, OUTER_HALF_WIDTH[e.road.kind] - 0.6, pole, dir);
      const stopLine = new THREE.Vector3();
      edgePose(e, e.length - stop + 0.6, lane, stopLine, dir);
      signal.heads.push({ pole, yaw: yaw + Math.PI, group, stopLine, stopYaw: yaw, stopWidth: lane * 2 + 0.2 });
    }
    if (signal.heads.length >= 3) signals.push(signal);
    else for (const e of list) if (e.signal?.id === signal.id) e.signal = undefined;
  }
  return signals;
}

/** Frame index at or before station s. */
function frameIndex(dist: number[], s: number) {
  let lo = 0;
  let hi = dist.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (dist[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const tmpA = new THREE.Vector3();

/** World position and heading on an edge at progress x with a lane offset. */
export function edgePose(edge: Edge, x: number, lane: number, out: THREE.Vector3, heading: THREE.Vector3) {
  const s = edge.s0 + edge.dir * Math.min(edge.length, Math.max(0, x));
  const i = frameIndex(edge.dist, s);
  const j = Math.min(edge.frames.length - 1, i + 1);
  const f0 = edge.frames[i];
  const f1 = edge.frames[j];
  const span = edge.dist[j] - edge.dist[i];
  const t = span > 0 ? (s - edge.dist[i]) / span : 0;
  out.copy(f0.p).lerp(f1.p, t);
  tmpA.copy(f0.n).lerp(f1.n, t);
  out.addScaledVector(tmpA, lane * edge.dir);
  heading.copy(f0.t).lerp(f1.t, t).multiplyScalar(edge.dir).normalize();
}

export interface Car {
  edge: number;
  x: number;
  lane: number;
  speed: number;
  type: number;
  next: number | null;
  /** Rendered pose, eased towards the lane position for smooth turns and lane changes. */
  pos: THREE.Vector3;
  yaw: number;
}

function startDir(edge: Edge, v: THREE.Vector3) {
  const tmp = new THREE.Vector3();
  edgePose(edge, 0.5, 0, tmp, v);
  return v;
}

function endDir(edge: Edge, v: THREE.Vector3) {
  const tmp = new THREE.Vector3();
  edgePose(edge, edge.length - 0.5, 0, tmp, v);
  return v;
}

/** Picks the edge a car takes after `edge`, or null if there is none. */
export function chooseNext(graph: LaneGraph, edge: Edge, rnd: () => number): number | null {
  const out = graph.outgoing.get(edge.to) ?? [];
  const inDir = endDir(edge, new THREE.Vector3());
  const options: { e: number; w: number }[] = [];
  let uTurn: number | null = null;
  const d = new THREE.Vector3();
  for (const e of out) {
    const cand = graph.edges[e];
    if (cand.road.id === edge.road.id && cand.dir !== edge.dir && Math.abs(cand.s0 - (edge.s0 + edge.dir * edge.length)) < 1) {
      uTurn = e;
      continue;
    }
    const dot = inDir.dot(startDir(cand, d));
    if (dot < -0.2) continue;
    // Prefer going straight; motorway traffic mostly stays on the motorway.
    let w = 0.6 + 2 * Math.max(0, dot);
    if (edge.road.kind === "highway" && cand.road.kind === "ramp") w *= 0.35;
    options.push({ e, w });
  }
  if (options.length === 0) return uTurn;
  const total = options.reduce((s, o) => s + o.w, 0);
  let r = rnd() * total;
  for (const o of options) {
    r -= o.w;
    if (r <= 0) return o.e;
  }
  return options[options.length - 1].e;
}

/** Target number of cars for a lane graph. */
export const carTarget = (graph: LaneGraph) => Math.min(MAX_CARS, Math.floor(graph.totalLength / METRES_PER_CAR));

export function spawnCars(graph: LaneGraph, count: number, types: number[], seed = 7): Car[] {
  const rnd = mulberry32(seed);
  const cars: Car[] = [];
  if (graph.edges.length === 0) return cars;
  const heading = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const edge = graph.edges[Math.floor(rnd() * graph.edges.length)];
    const lane = edge.lanes[Math.floor(rnd() * edge.lanes.length)];
    const x = rnd() * edge.length;
    const pos = new THREE.Vector3();
    edgePose(edge, x, lane, pos, heading);
    cars.push({
      edge: edge.index,
      x,
      lane,
      speed: edge.speed * 0.5,
      type: types[Math.floor(rnd() * types.length)],
      next: null,
      pos,
      yaw: Math.atan2(heading.x, heading.z),
    });
  }
  return cars;
}

/**
 * Advances all cars by dt seconds: car following on the same edge and onto the next one,
 * edge changes at nodes, and eased lane offsets.
 */
export function stepCars(graph: LaneGraph, cars: Car[], dt: number, rnd: () => number, time: number) {
  // Cars per edge, sorted by progress, for the car-following check.
  const byEdge = new Map<number, Car[]>();
  for (const c of cars) {
    const list = byEdge.get(c.edge);
    if (list) list.push(c);
    else byEdge.set(c.edge, [c]);
  }
  for (const list of byEdge.values()) list.sort((a, b) => a.x - b.x);

  for (const car of cars) {
    const edge = graph.edges[car.edge];
    if (!edge) continue;
    if (car.next === null) car.next = chooseNext(graph, edge, rnd);

    // Distance to the car ahead in the same lane (this edge, then the next one).
    let gap = Infinity;
    const same = byEdge.get(car.edge) ?? [];
    for (const o of same) {
      if (o !== car && o.x > car.x && Math.abs(o.lane - car.lane) < 1) {
        gap = Math.min(gap, o.x - car.x);
      }
    }
    // Look onto the next edge too, unless it is a U-turn: the oncoming lane is not "ahead".
    const next = car.next !== null ? graph.edges[car.next] : null;
    const uTurn = next !== null && next.road.id === edge.road.id && next.dir !== edge.dir;
    if (gap === Infinity && next && !uTurn) {
      const nextLane = next.lanes.includes(car.lane) ? car.lane : null;
      for (const o of byEdge.get(next.index) ?? []) {
        if (nextLane === null || Math.abs(o.lane - nextLane) < 1) gap = Math.min(gap, edge.length - car.x + o.x);
      }
    }
    // Traffic light ahead: red (and yellow if there is still room to stop) is a wall at the stop line.
    if (edge.signal) {
      const signal = graph.signals[edge.signal.id];
      const state = signal ? lightState(signal, edge.signal.group, time) : "green";
      const toStop = edge.length - edge.signal.stop - car.x;
      const canStop = toStop > (car.speed * car.speed) / (2 * 6);
      if (toStop > -0.5 && (state === "red" || (state === "yellow" && canStop))) {
        gap = Math.min(gap, Math.max(0, toStop) + SAFE_GAP - 1.5);
      }
    }
    const want = gap === Infinity ? edge.speed : Math.max(0, Math.min(edge.speed, (gap - SAFE_GAP) * 1.2));
    // Smooth acceleration / braking.
    car.speed += THREE.MathUtils.clamp(want - car.speed, -8 * dt, 3 * dt);
    car.x += car.speed * dt;

    // Edge change.
    let guard = 0;
    while (car.x > graph.edges[car.edge].length && guard++ < 4) {
      const done = graph.edges[car.edge];
      if (car.next === null) {
        car.x = done.length;
        car.speed = 0;
        break;
      }
      car.x -= done.length;
      car.edge = car.next;
      const nextEdge = graph.edges[car.edge];
      if (!nextEdge.lanes.includes(car.lane)) car.lane = nextEdge.lanes[Math.floor(rnd() * nextEdge.lanes.length)];
      car.next = chooseNext(graph, nextEdge, rnd);
    }
  }
}
