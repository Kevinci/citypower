"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { sizeOf, type Building } from "@/lib/city/economy";
import { railNetworks, railOf, TRAIN_TYPES, trainType, type Train, type TrainType } from "@/lib/city/railway";
import { useCity } from "@/lib/city/store";
import { buildRailGraph, stopsAt, twinOf } from "@/lib/city/train-graph";
import { edgePose, nearestEdge, routeEdges, type LaneGraph } from "@/lib/city/traffic";
import type { Rail } from "@/lib/city/types";
import { windowGlow } from "./nightGlow";
import { useProfiles } from "./useProfiles";

/**
 * Trains of the signal boxes (Kenney "Train Kit", CC0). Each train shuttles between the
 * stations of its track network in real time: it drives to the next station, stops with
 * its middle at the platform, waits, and goes on; at the end of the line it reverses (push-pull,
 * the cars stay where they are). Pure animation – the money is computed in railway.ts.
 */

/** Rail top above the track frame (ballast + sleeper + rail). */
const RAIL_TOP = 0.64;
/** Real car lengths (m) and the gap between cars; width and height scale of the chibi models. */
const CAR_LENGTH = 19;
const LOCO_LENGTH = 16;
const GAP = 0.9;
const WIDTH_SCALE = 2.3;
const HEIGHT_SCALE = 2.45;
/** Seconds at a station, braking/acceleration (m/s²). */
const DWELL = 12;
const ACCEL = 0.8;
const BRAKE = 1.1;
/**
 * Yaw that turns a model nose first. The Kenney cab cars (city-a, bullet-a) have their sloped nose
 * at +z (measured: roof height falls off towards +z), so they need no turn; wagons are symmetric.
 */
const MODEL_YAW = 0;
const MAX_PER_MODEL = 48;
/** Length over which a train changes tracks before a stop and after leaving (m). */
const SWITCH = 90;

const MODELS = [...new Set(TRAIN_TYPES.flatMap((t) => t.cars))];
const MODEL_INDEX = new Map(MODELS.map((m, i) => [m, i]));
const url = (f: string) => `/models/trains/${f}.glb`;
MODELS.forEach((m) => useGLTF.preload(url(m)));
const carLength = (model: string) => (model.includes("diesel") || model.includes("locomotive") ? LOCO_LENGTH : CAR_LENGTH);

/** Merges a model's meshes into one geometry: centred, base at y = 0, real proportions. */
function bake(scene: THREE.Object3D, model: string): THREE.BufferGeometry {
  scene.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
    parts.push(g.index ? g.toNonIndexed() : g);
  });
  const merged = mergeGeometries(parts) ?? new THREE.BoxGeometry(1, 1, 1);
  merged.computeBoundingBox();
  const box = merged.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  merged.translate(-centre.x, -box.min.y, -centre.z);
  merged.scale(WIDTH_SCALE, HEIGHT_SCALE, carLength(model) / (size.z || 1));
  merged.computeVertexNormals();
  return merged;
}

function useTrainModels() {
  const gltfs = useGLTF(MODELS.map(url));
  return useMemo(() => {
    let material: THREE.MeshStandardMaterial | null = null;
    const geometries = gltfs.map((g, i) => {
      if (!material) {
        g.scene.traverse((o) => {
          if (material || !(o instanceof THREE.Mesh)) return;
          const src = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
          // Lit windows at night, like the houses.
          material = windowGlow(new THREE.MeshStandardMaterial({ map: src.map, roughness: 0.55, metalness: 0.15 }), "kit", 0.9);
        });
      }
      return bake(g.scene, MODELS[i]);
    });
    return { geometries, material: material ?? new THREE.MeshStandardMaterial() };
  }, [gltfs]);
}

/* ---------- driving ---------- */

interface Leg {
  route: number[];
  /** Route coordinate where each edge starts (0 = start of the first edge). */
  starts: number[];
  /** Double track: lane at the departure and at the stop (switching to the platform track), and where it stops. */
  startLane: number;
  endLane: number;
  end: number;
}
interface Run {
  train: Train;
  type: TrainType;
  length: number;
  /** Car offsets from the head to each car's middle. */
  offsets: number[];
  leg: Leg | null;
  /** Head position on the leg, and where it stops. */
  s: number;
  stopS: number;
  /** The leg before, for the cars still on it, and the head's position on it when the new leg began. */
  prev: (Leg & { at: number }) | null;
  v: number;
  dwell: number;
  /** Stations in line order and the index of the next stop in the shuttle sequence. */
  line: { x: number; z: number }[];
  seq: number[];
  next: number;
  /** Reversed (push-pull): the cars are drawn in reverse order and turned. */
  flip: boolean;
  retry: number;
}

const legEdge = (leg: Leg, s: number) => {
  let i = 0;
  while (i < leg.route.length - 1 && leg.starts[i + 1] <= s) i++;
  return i;
};

/** Head on a leg → (edge, x on it). */
function headOf(graph: LaneGraph, run: Run): { edge: number; x: number } | null {
  if (!run.leg) return null;
  const i = legEdge(run.leg, run.s);
  return { edge: run.leg.route[i], x: Math.min(graph.edges[run.leg.route[i]].length, run.s - run.leg.starts[i]) };
}

/** Plans the leg to the next stop from (edge, x); both directions of the stop's track are tried. */
function legTo(graph: LaneGraph, from: { edge: number; x: number }, stop: { x: number; z: number }, length: number) {
  let best: { leg: Leg; s: number; stopS: number } | null = null;
  for (const option of stopsAt(graph, stop.x, stop.z)) {
    const route = routeEdges(graph, from.edge, option.edge);
    if (!route) continue;
    const target = Math.min(graph.edges[option.edge].length - 1, option.x + length / 2);
    if (route.length === 1 && target <= from.x + 1) continue;
    const starts: number[] = [];
    let acc = 0;
    for (const e of route) {
      starts.push(acc);
      acc += graph.edges[e].length;
    }
    const stopS = starts[starts.length - 1] + target;
    // Double track: stop on the track next to the platform (the right-hand one may be the far one).
    const edge = graph.edges[option.edge];
    const base = edge.lanes[0];
    let endLane = base;
    if (base !== 0) {
      edgePose(edge, target, base, pos, dir);
      const near = Math.hypot(pos.x - stop.x, pos.z - stop.z);
      edgePose(edge, target, -base, pos, dir);
      if (Math.hypot(pos.x - stop.x, pos.z - stop.z) < near) endLane = -base;
    }
    if (!best || stopS - from.x < best.stopS - best.s)
      best = { leg: { route, starts, startLane: graph.edges[from.edge].lanes[0], endLane, end: stopS }, s: from.x, stopS };
  }
  return best;
}

/** Next leg of a train: forward, or reversed at a station / dead end if that is shorter. */
function plan(graph: LaneGraph, run: Run, start?: { edge: number; x: number }) {
  const stop = run.line[run.seq[run.next]];
  const head = start ?? headOf(graph, run);
  if (!head || !stop) return false;
  const forward = legTo(graph, head, stop, run.length);
  // Reversing: the new head is the old tail, on the twin edge.
  const twin = twinOf(graph, graph.edges[head.edge]);
  const back = twin ? legTo(graph, { edge: twin.index, x: Math.min(twin.length, twin.length - head.x + run.length) }, stop, run.length) : null;
  const useBack = !!back && (!forward || back.stopS - back.s + 40 < forward.stopS - forward.s);
  const chosen = useBack ? back : forward;
  if (!chosen) return false;
  // Leave on the track it stopped on (a reversed train is on the twin edge: the lane sign flips).
  const was = run.leg?.endLane;
  if (was !== undefined && graph.edges[head.edge].lanes[0] !== 0) chosen.leg.startLane = useBack ? -was : was;
  run.prev = !useBack && run.leg ? { ...run.leg, at: run.s } : null;
  if (useBack) run.flip = !run.flip;
  run.leg = chosen.leg;
  run.s = chosen.s;
  run.stopS = chosen.stopS;
  return true;
}

function step(graph: LaneGraph, runs: Run[], dt: number) {
  for (const run of runs) {
    if (!run.leg) {
      run.retry -= dt;
      continue;
    }
    if (run.dwell > 0) {
      run.dwell -= dt;
      if (run.dwell <= 0) {
        run.next = (run.next + 1) % run.seq.length;
        if (!plan(graph, run)) run.dwell = 5;
      }
      continue;
    }
    const left = run.stopS - run.s;
    const want = Math.min(run.type.speed, Math.sqrt(2 * BRAKE * Math.max(0, left)));
    run.v += THREE.MathUtils.clamp(want - run.v, -BRAKE * 2 * dt, ACCEL * dt);
    run.s = Math.min(run.stopS, run.s + run.v * dt);
    if (left < 0.4 && run.v < 0.6) {
      run.v = 0;
      run.dwell = DWELL;
    }
  }
}

const pos = new THREE.Vector3();
const dir = new THREE.Vector3();
const quat = new THREE.Quaternion();
const matrix = new THREE.Matrix4();
const one = new THREE.Vector3(1, 1, 1);
const up = new THREE.Vector3(0, 1, 0);

/** Pose at distance d along the leg (behind its start: on the previous leg). */
function sample(graph: LaneGraph, run: Run, d: number) {
  let leg: Leg = run.leg!;
  if (d < 0 && run.prev) {
    leg = run.prev;
    d = run.prev.at + d;
  }
  d = Math.max(0, d);
  const i = legEdge(leg, d);
  const edge = graph.edges[leg.route[i]];
  let lane = edge.lanes[0];
  if (lane !== 0) {
    // Switch tracks over the first / last SWITCH metres of the leg.
    const toEnd = THREE.MathUtils.smoothstep(1 - (leg.end - d) / SWITCH, 0, 1);
    const fromStart = 1 - THREE.MathUtils.smoothstep(d / SWITCH, 0, 1);
    if (i === leg.route.length - 1) lane = THREE.MathUtils.lerp(lane, leg.endLane, toEnd);
    if (i === 0) lane = THREE.MathUtils.lerp(lane, leg.startLane, fromStart);
  }
  edgePose(edge, d - leg.starts[i], lane, pos, dir);
}

function draw(graph: LaneGraph, runs: Run[], meshes: (THREE.InstancedMesh | null)[]) {
  const counts = new Array(MODELS.length).fill(0);
  for (const run of runs) {
    if (!run.leg) continue;
    const cars = run.type.cars;
    for (let k = 0; k < cars.length; k++) {
      const j = run.flip ? cars.length - 1 - k : k;
      const model = cars[j];
      // A cab at the tail (same model as the head) looks backwards: push-pull train.
      const tailCab = j === cars.length - 1 && j > 0 && model === cars[0];
      const mi = MODEL_INDEX.get(model)!;
      const mesh = meshes[mi];
      if (!mesh || counts[mi] >= MAX_PER_MODEL) continue;
      sample(graph, run, run.s - run.offsets[k]);
      pos.y += RAIL_TOP;
      quat.setFromAxisAngle(up, Math.atan2(dir.x, dir.z) + MODEL_YAW + (run.flip !== tailCab ? Math.PI : 0));
      matrix.compose(pos, quat, one);
      mesh.setMatrixAt(counts[mi]++, matrix);
    }
  }
  meshes.forEach((mesh, i) => {
    if (!mesh) return;
    mesh.count = counts[i];
    mesh.instanceMatrix.needsUpdate = true;
  });
}

/** Back edge middle of a station / signal box: the point on its track. */
const backPoint = (b: Building) => {
  const [, d] = sizeOf(b);
  return { x: b.x + Math.sin(b.rot) * (d / 2 + 3), z: b.z + Math.cos(b.rot) * (d / 2 + 3) };
};

/** Stations of one network in line order (along their main direction). */
function lineOf(stations: Building[]) {
  const pts = stations.map(backPoint);
  if (pts.length < 2) return pts;
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const cz = pts.reduce((a, p) => a + p.z, 0) / pts.length;
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  for (const p of pts) {
    sxx += (p.x - cx) ** 2;
    sxz += (p.x - cx) * (p.z - cz);
    szz += (p.z - cz) ** 2;
  }
  const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ax = Math.cos(angle);
  const az = Math.sin(angle);
  return pts.sort((a, b) => (a.x - cx) * ax + (a.z - cz) * az - ((b.x - cx) * ax + (b.z - cz) * az));
}

/** Rebuilds the runs when trains, stations or tracks change; trains on an unchanged graph keep driving. */
function syncRuns(graph: LaneGraph, runs: Map<string, Run>, trains: Train[], buildings: Building[], rails: Rail[], reset: boolean) {
  if (reset) runs.clear();
  const nets = railNetworks(rails);
  const netOf = (b: Building) => {
    const r = railOf(b, rails);
    return r ? (nets.get(r.id) ?? null) : null;
  };
  const stationsByNet = new Map<number, Building[]>();
  for (const b of buildings) {
    if (b.kind !== "trainstation") continue;
    const n = netOf(b);
    if (n === null) continue;
    stationsByNet.set(n, [...(stationsByNet.get(n) ?? []), b]);
  }
  const live = new Set(trains.map((t) => t.id));
  for (const id of runs.keys()) if (!live.has(id)) runs.delete(id);
  trains.forEach((train, ti) => {
    const depot = buildings.find((b) => b.id === train.depot);
    const n = depot ? netOf(depot) : null;
    const line = n !== null ? lineOf(stationsByNet.get(n) ?? []) : [];
    const old = runs.get(train.id);
    if (old) {
      // Stations changed: keep driving, with the new line.
      if (line.length !== old.line.length) {
        old.line = line;
        old.seq = shuttle(line.length);
        old.next = old.seq.length > 0 ? old.next % old.seq.length : 0;
      }
      return;
    }
    if (!depot || line.length < 2) return;
    const type = trainType(train.type);
    const lengths = type.cars.map(carLength);
    const offsets: number[] = [];
    let acc = 0;
    for (const l of lengths) {
      offsets.push(acc + l / 2);
      acc += l + GAP;
    }
    const seq = shuttle(line.length);
    const run: Run = { train, type, length: acc - GAP, offsets, leg: null, s: 0, stopS: 0, prev: null, v: 0, dwell: 0, line, seq, next: ti % seq.length, flip: false, retry: 0 };
    const at = backPoint(depot);
    const start = nearestEdge(graph, at.x, at.z);
    if (start && plan(graph, run, start)) runs.set(train.id, run);
  });
}

/** Shuttle order over n stations in line: 0, 1, …, n−1, n−2, …, 1. */
function shuttle(n: number) {
  const seq: number[] = [];
  for (let i = 0; i < n; i++) seq.push(i);
  for (let i = n - 2; i > 0; i--) seq.push(i);
  return seq;
}

export function Trains() {
  const rails = useCity((s) => s.rails);
  const jobs = useCity((s) => s.jobs);
  const trains = useCity((s) => s.trains);
  const buildings = useCity((s) => s.buildings);
  const profiles = useProfiles();
  const models = useTrainModels();
  const finished = useMemo(() => rails.filter((r) => !jobs.includes(r.id)), [rails, jobs]);
  const graph = useMemo(() => buildRailGraph(finished, profiles), [finished, profiles]);
  const runs = useRef(new Map<string, Run>());
  const lastGraph = useRef<LaneGraph | null>(null);
  // Only the rail buildings matter for the line; a new house must not restart anything.
  const railBuildings = useMemo(() => buildings.filter((b) => b.kind === "trainstation" || b.kind === "traindepot"), [buildings]);
  useEffect(() => {
    syncRuns(graph, runs.current, trains, railBuildings, finished, lastGraph.current !== graph);
    lastGraph.current = graph;
    // Dev: `__trains.heads()` = head position, direction of travel and push-pull state of every train.
    if (process.env.NODE_ENV !== "production") {
      const list = runs.current;
      (window as unknown as { __trains?: unknown }).__trains = {
        graph,
        runs: list,
        heads: () =>
          [...list.values()].flatMap((run) => {
            if (!run.leg) return [];
            sample(graph, run, run.s);
            return [{ id: run.train.id, type: run.type.id, x: pos.x, z: pos.z, dx: dir.x, dz: dir.z, v: run.v, flip: run.flip }];
          }),
      };
    }
  }, [graph, trains, railBuildings, finished]);
  useEffect(() => () => models.geometries.forEach((g) => g.dispose()), [models]);

  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const list = [...runs.current.values()];
    // Paused game: trains stand still.
    if (useCity.getState().speed > 0) step(graph, list, dt);
    draw(graph, list, meshes.current);
  });

  return (
    <group>
      {models.geometries.map((g, i) => (
        <instancedMesh
          key={MODELS[i]}
          ref={(el) => {
            meshes.current[i] = el;
          }}
          args={[g, models.material, MAX_PER_MODEL]}
          count={0}
          castShadow
          receiveShadow
          frustumCulled={false}
        />
      ))}
    </group>
  );
}
