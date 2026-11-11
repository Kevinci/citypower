import { HALF_WIDTH, type Cable, type Canal, type Rail, type Road, type Vec2 } from "./types";

/**
 * Bulldozer (Abriss): removes one piece of a road, track, canal or power line – the
 * segment between two consecutive points of the path under the cursor. Junctions and
 * the corners the player clicked are points, so this takes out the stretch from one
 * crossing or corner to the next instead of a whole long street. What is left on either
 * side stays as its own path.
 */

export type BulldozeNetwork = "roads" | "rails" | "canals" | "cables";

export interface BulldozeTarget {
  network: BulldozeNetwork;
  id: string;
  /** Index of the segment points[segment] → points[segment + 1]. */
  segment: number;
  a: Vec2;
  b: Vec2;
  /** Half width for the red preview. */
  half: number;
  label: string;
  length: number;
}

const LABEL: Record<string, string> = {
  street: "Straße",
  highway: "Autobahn",
  bike: "Radweg",
  ramp: "Rampe",
  rail: "Gleis",
  rail2: "Gleis",
  canal: "Kanal",
};

function segmentDistance(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l = dx * dx + dz * dz || 1;
  const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l));
  return Math.hypot(p.x - a.x - u * dx, p.z - a.z - u * dz);
}

/** The path segment under p (within the path's width plus a little), nearest first. */
export function bulldozeTarget(p: Vec2, s: { roads: Road[]; rails: Rail[]; canals: Canal[]; cables: Cable[] }): BulldozeTarget | null {
  let best: (BulldozeTarget & { d: number }) | null = null;
  const consider = (network: BulldozeNetwork, id: string, points: Vec2[], half: number, label: string) => {
    for (let i = 0; i < points.length - 1; i++) {
      const d = segmentDistance(p, points[i], points[i + 1]);
      if (d > half + 2 || (best && d >= best.d)) continue;
      const a = points[i];
      const b = points[i + 1];
      best = { network, id, segment: i, a, b, half, label, length: Math.hypot(b.x - a.x, b.z - a.z), d };
    }
  };
  for (const r of s.roads) consider("roads", r.id, r.points, HALF_WIDTH[r.kind], LABEL[r.kind] ?? "Weg");
  for (const r of s.rails) consider("rails", r.id, r.points, HALF_WIDTH[r.kind], LABEL[r.kind] ?? "Gleis");
  for (const c of s.canals) consider("canals", c.id, c.points, HALF_WIDTH[c.kind], LABEL[c.kind] ?? "Kanal");
  for (const c of s.cables) consider("cables", c.id, c.points, 2, "Stromleitung");
  if (!best) return null;
  const { d: _d, ...target } = best as BulldozeTarget & { d: number };
  void _d;
  return target;
}

/** The path without segment i: up to two pieces (the first keeps the id). */
export function splitOut<T extends { id: string; points: Vec2[] }>(path: T, i: number, newId: string): T[] {
  const before = path.points.slice(0, i + 1);
  const after = path.points.slice(i + 1);
  const out: T[] = [];
  if (before.length >= 2) out.push({ ...path, points: before });
  if (after.length >= 2) out.push({ ...path, id: out.length > 0 ? newId : path.id, points: after });
  return out;
}
