import { FLAT, type Profile } from "./grade";
import { buildFrames, cumulative } from "./road-geometry";
import { nearestEdges, type Edge, type LaneGraph } from "./traffic";
import type { Rail, Road } from "./types";

/**
 * Track graph for trains, in the same shape as the road lane graph (traffic.ts), so routing
 * (`routeEdges`) and posing (`edgePose`) work the same way. Every track is cut at the points
 * it shares with other tracks; each piece gives one edge per direction. Double track runs on
 * the right-hand track (+2.25 m), single track on the centre line.
 */

const keyOf = (x: number, z: number) => `${Math.round(x * 2)}:${Math.round(z * 2)}`;

export function buildRailGraph(rails: Rail[], profiles: Map<string, Profile>): LaneGraph {
  const usage = new Map<string, number>();
  for (const r of rails) for (const p of r.points) usage.set(keyOf(p.x, p.z), (usage.get(keyOf(p.x, p.z)) ?? 0) + 1);
  const edges: Edge[] = [];
  const outgoing = new Map<string, number[]>();
  let totalLength = 0;
  const add = (e: Omit<Edge, "index">) => {
    const edge = { ...e, index: edges.length };
    edges.push(edge);
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.index);
    outgoing.set(edge.from, list);
    totalLength += edge.length;
  };
  for (const rail of rails) {
    const frames = buildFrames(rail.points, rail.kind, profiles.get(rail.id) ?? FLAT);
    const dist = cumulative(frames);
    // Station of each control point (nearest frame).
    const stationOf = (x: number, z: number) => {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < frames.length; i++) {
        const d = (frames[i].p.x - x) ** 2 + (frames[i].p.z - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return dist[best];
    };
    const last = rail.points.length - 1;
    const nodes = rail.points
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => i === 0 || i === last || (usage.get(keyOf(p.x, p.z)) ?? 0) > 1)
      .map(({ p }) => ({ s: stationOf(p.x, p.z), key: keyOf(p.x, p.z) }))
      .sort((a, b) => a.s - b.s);
    const lanes = rail.kind === "rail2" ? [2.25] : [0];
    // Edges carry the track as a "road" (only id, kind and points are read).
    const road = rail as unknown as Road;
    for (let k = 0; k < nodes.length - 1; k++) {
      const a = nodes[k];
      const b = nodes[k + 1];
      const length = b.s - a.s;
      if (length < 1) continue;
      add({ road, frames, dist, s0: a.s, length, dir: 1, from: a.key, to: b.key, lanes, speed: 30 });
      add({ road, frames, dist, s0: b.s, length, dir: -1, from: b.key, to: a.key, lanes, speed: 30 });
    }
  }
  return { edges, outgoing, totalLength, signals: [] };
}

/** The edge running the other way over the same piece of track. */
export function twinOf(graph: LaneGraph, edge: Edge): Edge | null {
  const end = edge.s0 + edge.dir * edge.length;
  for (const e of graph.edges) {
    if (e === edge || e.road.id !== edge.road.id || e.dir === edge.dir) continue;
    if (Math.abs(e.s0 - end) < 0.5 && Math.abs(e.length - edge.length) < 0.5) return e;
  }
  return null;
}

/** Where a train stops at a station: both directions of the track behind its platform. */
export function stopsAt(graph: LaneGraph, x: number, z: number) {
  return nearestEdges(graph, x, z);
}
