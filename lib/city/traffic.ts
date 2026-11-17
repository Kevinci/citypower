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
  /** Seconds left of pulling over for an emergency vehicle behind (0 = driving normally). */
  yieldT: number;
  /** Emergency vehicle on a mission: follows `route` instead of choosing at random. */
  role?: "police" | "fire" | "ambulance";
  /** Edge indices to drive, and the index of the current one in it. */
  route?: number[];
  routeAt?: number;
  /** Progress on the last route edge where the vehicle stops (and parks). */
  stopAt?: number;
  /** Standing still at its destination (or a wreck): blocks the lane behind it. */
  parked?: boolean;
  /** Extra yaw for a wreck lying askew. */
  skew?: number;
}

/** Speed factor of emergency vehicles over the road's cruising speed. */
const EMERGENCY_SPEED = 1.8;

/** How far cars pull over to the right for an emergency vehicle (m), and how far it looks ahead. */
export const YIELD_SHIFT = 1.4;
const YIELD_RANGE = 60;
/** Emergency vehicles pass on the left of pulled-over cars, and further out round parked ones. */
const PASS_SHIFT = -1.0;
const PASS_PARKED_SHIFT = -2.3;

/** Lane offset to draw a car at: pulled over, or passing on the left (emergency, see `passingTraffic`). */
export function laneShift(car: Car, passing: 0 | 1 | 2) {
  if (car.yieldT > 0) return YIELD_SHIFT;
  return passing === 2 ? PASS_PARKED_SHIFT : passing === 1 ? PASS_SHIFT : 0;
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

/**
 * Picks the edge a car takes after `edge`, or null if there is none. Closed edges (a street
 * cordoned off at an incident) are never taken: traffic turns off elsewhere, turns round on a
 * street, and waits at the node on a motorway (no turning there).
 */
export function chooseNext(graph: LaneGraph, edge: Edge, rnd: () => number, closed?: Set<number>): number | null {
  const out = graph.outgoing.get(edge.to) ?? [];
  const inDir = endDir(edge, new THREE.Vector3());
  const options: { e: number; w: number }[] = [];
  let uTurn: number | null = null;
  let blocked = false;
  const d = new THREE.Vector3();
  for (const e of out) {
    const cand = graph.edges[e];
    if (closed?.has(e)) {
      blocked = true;
      continue;
    }
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
  if (options.length === 0) return blocked && edge.road.kind !== "street" ? null : uTurn;
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
      yieldT: 0,
    });
  }
  return cars;
}

/** A car placed on an edge (emergency vehicle at its station, wreck at an accident). */
export function placeCar(graph: LaneGraph, edge: number, x: number, lane: number, type: number, extra: Partial<Car> = {}): Car {
  const pos = new THREE.Vector3();
  const heading = new THREE.Vector3();
  edgePose(graph.edges[edge], x, lane, pos, heading);
  return { edge, x, lane, speed: 0, type, next: null, pos, yaw: Math.atan2(heading.x, heading.z), yieldT: 0, ...extra };
}

/**
 * Advances all cars by dt seconds: car following on the same edge and onto the next one,
 * edge changes at nodes, and eased lane offsets.
 */
export function stepCars(graph: LaneGraph, cars: Car[], dt: number, rnd: () => number, time: number, closed?: Set<number>) {
  // Cars per edge, sorted by progress, for the car-following check.
  const byEdge = new Map<number, Car[]>();
  for (const c of cars) {
    const list = byEdge.get(c.edge);
    if (list) list.push(c);
    else byEdge.set(c.edge, [c]);
  }
  for (const list of byEdge.values()) list.sort((a, b) => a.x - b.x);

  // Emergency vehicles on the move: everything ahead of them pulls over to the right.
  for (const car of cars) {
    if (!car.role || car.parked) continue;
    const edge = graph.edges[car.edge];
    if (!edge) continue;
    for (const o of byEdge.get(car.edge) ?? []) if (!o.role && !o.parked && o.x > car.x && o.x - car.x < YIELD_RANGE) o.yieldT = 2.5;
    const left = YIELD_RANGE - (edge.length - car.x);
    if (left > 0 && car.next !== null) for (const o of byEdge.get(car.next) ?? []) if (!o.role && !o.parked && o.x < left) o.yieldT = 2.5;
  }

  // Effective lane: pulled-over cars have left the lane.
  const laneOf = (c: Car) => c.lane + (c.yieldT > 0 ? YIELD_SHIFT : 0);

  for (const car of cars) {
    const edge = graph.edges[car.edge];
    if (!edge) continue;
    if (car.yieldT > 0) car.yieldT -= dt;
    if (car.parked) {
      car.speed = 0;
      continue;
    }
    // A street closed meanwhile: choose again (emergency vehicles drive in anyway).
    if (!car.route && car.next !== null && closed?.has(car.next)) car.next = null;
    if (car.next === null) car.next = car.route ? (car.route[(car.routeAt ?? 0) + 1] ?? null) : chooseNext(graph, edge, rnd, closed);

    // Distance to the car ahead in the same lane (this edge, then the next one).
    let gap = Infinity;
    const same = byEdge.get(car.edge) ?? [];
    const myLane = laneOf(car);
    for (const o of same) {
      // Emergency vehicles drive round parked vehicles (another unit at a scene, a wreck they are not heading for).
      if (car.role && o.parked) continue;
      if (o !== car && o.x > car.x && Math.abs(laneOf(o) - myLane) < 1) {
        gap = Math.min(gap, o.x - car.x);
      }
    }
    // Look onto the next edge too, unless it is a U-turn: the oncoming lane is not "ahead".
    const next = car.next !== null ? graph.edges[car.next] : null;
    const uTurn = next !== null && next.road.id === edge.road.id && next.dir !== edge.dir;
    if (gap === Infinity && next && !uTurn) {
      const nextLane = next.lanes.includes(car.lane) ? car.lane : null;
      for (const o of byEdge.get(next.index) ?? []) {
        if (car.role && o.parked) continue;
        if (nextLane === null || Math.abs(laneOf(o) - nextLane) < 1) gap = Math.min(gap, edge.length - car.x + o.x);
      }
    }
    // Destination on the last route edge: stop there (or just behind the queue in front of it).
    if (car.route && car.stopAt !== undefined && car.next === null) {
      const blocked = gap < SAFE_GAP + 0.5 && car.x >= car.stopAt - 30;
      gap = Math.min(gap, car.stopAt - car.x + SAFE_GAP);
      if ((car.x >= car.stopAt - 0.3 || blocked) && car.speed < 0.3) {
        car.parked = true;
        car.speed = 0;
        continue;
      }
    }
    // Traffic light ahead: red (and yellow if there is still room to stop) is a wall at the stop line.
    if (edge.signal && !car.role) {
      const signal = graph.signals[edge.signal.id];
      const state = signal ? lightState(signal, edge.signal.group, time) : "green";
      const toStop = edge.length - edge.signal.stop - car.x;
      const canStop = toStop > (car.speed * car.speed) / (2 * 6);
      if (toStop > -0.5 && (state === "red" || (state === "yellow" && canStop))) {
        gap = Math.min(gap, Math.max(0, toStop) + SAFE_GAP - 1.5);
      }
    }
    // Emergency vehicles with blue lights drive well above the limit (in town ~78 km/h instead of 43).
    const top = car.role ? edge.speed * EMERGENCY_SPEED : edge.speed;
    let want = gap === Infinity ? top : Math.max(0, Math.min(top, (gap - SAFE_GAP) * 1.2));
    // Pulled over: crawl until the emergency vehicle has passed.
    if (car.yieldT > 0) want = Math.min(want, 1.5);
    // Smooth acceleration / braking.
    car.speed += THREE.MathUtils.clamp(want - car.speed, -8 * dt, (car.role ? 5.5 : 3) * dt);
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
      if (car.route) {
        car.routeAt = (car.routeAt ?? 0) + 1;
        car.next = car.route[car.routeAt + 1] ?? null;
      } else car.next = chooseNext(graph, nextEdge, rnd, closed);
    }
  }
}

/** The edge in the opposite travel direction between the same two nodes, or null (one-way). */
export function reverseEdge(graph: LaneGraph, edge: Edge): Edge | null {
  const end = edge.s0 + edge.dir * edge.length;
  for (const e of graph.outgoing.get(edge.to) ?? []) {
    const o = graph.edges[e];
    if (o.road.id === edge.road.id && o.dir !== edge.dir && Math.abs(o.s0 - end) < 1) return o;
  }
  return null;
}

/**
 * The police closes a street at an incident (`sites` = the scene on each travel direction):
 * cars already on it in front of the scene turn round and drive back out; cars heading for it
 * choose again (see `stepCars`). Motorway traffic cannot turn and queues instead.
 */
export function closeStreet(graph: LaneGraph, cars: Car[], sites: { edge: number; x: number }[]) {
  for (const site of sites) {
    const edge = graph.edges[site.edge];
    if (!edge || edge.road.kind !== "street") continue;
    const back = reverseEdge(graph, edge);
    if (!back) continue;
    for (const car of cars) {
      if (car.role || car.parked || car.edge !== site.edge || car.x >= site.x - 4) continue;
      car.edge = back.index;
      car.x = Math.max(0, edge.length - car.x);
      if (!back.lanes.includes(car.lane)) car.lane = back.lanes[0];
      car.speed = Math.min(car.speed, 3);
      car.next = null;
    }
  }
}

/** What an emergency vehicle has to pass within `range` ahead: 0 nothing, 1 pulled-over cars, 2 a parked vehicle. */
export function passingTraffic(graph: LaneGraph, cars: Car[], car: Car, range = 25): 0 | 1 | 2 {
  const edge = graph.edges[car.edge];
  if (!edge || car.parked) return 0;
  let level: 0 | 1 | 2 = 0;
  for (const o of cars) {
    if (o === car || (o.yieldT <= 0 && !o.parked)) continue;
    const near =
      (o.edge === car.edge && o.x > car.x - 6 && o.x - car.x < range) ||
      (car.next !== null && o.edge === car.next && o.x < range - (edge.length - car.x));
    if (!near) continue;
    if (o.parked) return 2;
    level = 1;
  }
  return level;
}

/** Every edge passing within 0.5 m of the closest one to a point (both travel directions of a road). */
export function nearestEdges(graph: LaneGraph, x: number, z: number, kinds?: RoadKind[]): { edge: number; x: number; d: number }[] {
  const best = nearestEdge(graph, x, z, kinds);
  if (!best) return [];
  const out: { edge: number; x: number; d: number }[] = [];
  for (const e of graph.edges) {
    if (kinds && !kinds.includes(e.road.kind)) continue;
    if (e.road.id !== graph.edges[best.edge].road.id) continue;
    const one = nearestEdge({ ...graph, edges: [e] }, x, z);
    if (one && one.d <= best.d + 0.5) out.push({ edge: e.index, x: one.x, d: one.d });
  }
  return out;
}

/* ---------- routing for emergency vehicles ---------- */

/** Edge and progress on it closest to a point (streets, motorways and ramps). */
export function nearestEdge(graph: LaneGraph, x: number, z: number, kinds?: RoadKind[]): { edge: number; x: number; d: number } | null {
  let best: { edge: number; x: number; d: number } | null = null;
  for (const e of graph.edges) {
    if (kinds && !kinds.includes(e.road.kind)) continue;
    // Frames of the road between the edge's stations.
    const sA = e.dir === 1 ? e.s0 : e.s0 - e.length;
    const sB = sA + e.length;
    const i0 = frameIndex(e.dist, sA);
    const i1 = Math.min(e.frames.length - 1, frameIndex(e.dist, sB) + 1);
    for (let i = i0; i <= i1; i++) {
      const f = e.frames[i];
      const d = Math.hypot(f.p.x - x, f.p.z - z);
      if (!best || d < best.d) {
        const s = Math.min(sB, Math.max(sA, e.dist[i]));
        best = { edge: e.index, x: e.dir === 1 ? s - e.s0 : e.s0 - s, d };
      }
    }
  }
  return best;
}

/** Shortest chain of edges from one edge to another (both included), or null. */
export function routeEdges(graph: LaneGraph, from: number, to: number): number[] | null {
  if (from === to) return [from];
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const open: number[] = [from];
  const done = new Set<number>();
  while (open.length > 0) {
    // Smallest tentative distance (graphs are small enough for a linear scan).
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist.get(open[i])! < dist.get(open[bi])!) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur === to) break;
    if (done.has(cur)) continue;
    done.add(cur);
    const e = graph.edges[cur];
    const base = dist.get(cur)! + e.length;
    for (const n of graph.outgoing.get(e.to) ?? []) {
      const ne = graph.edges[n];
      // Turning round on the spot is a last resort.
      const uTurn = ne.road.id === e.road.id && ne.dir !== e.dir;
      const d = base + (uTurn ? 80 : 0);
      if (d < (dist.get(n) ?? Infinity)) {
        dist.set(n, d);
        prev.set(n, cur);
        open.push(n);
      }
    }
  }
  if (!dist.has(to)) return null;
  const route = [to];
  let cur = to;
  while (cur !== from) {
    cur = prev.get(cur)!;
    route.push(cur);
  }
  return route.reverse();
}
