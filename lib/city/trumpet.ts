import { pairKey, type Separations } from "./grade";
import { findCrossings } from "./network";
import { arc, axisOf, comb, crossesWater, entryLane, exitLane, frameAt, RAMP_LANE_V, rightOf, roomAhead, type Axis } from "./ramps";
import type { DepthGrid } from "./terrain";
import type { Path, Road, Vec2 } from "./types";

/**
 * Autobahndreieck as a trumpet ("Trompete"): motorway B ends at motorway A.
 *
 * The usual German three-leg form with only one structure and little land (RAA / lecture
 * notes): B is cut back before A, two direct ramps on B's side handle the right turns,
 * and on the far side a loop plus a semi-direct ramp around it (the trumpet's bell) handle
 * the left turns. Both left-turn ramps cross A on bridges (grade separation is automatic:
 * ramps always pass over motorways). Right-hand traffic.
 *
 * Local frame: d = direction along A whose right side faces B; rd = right of d (towards B).
 */

const PICK_RADIUS = 70;
/** B's end must lie this close to A's centre line. */
const MAX_GAP = 35;
/** B is cut back to end this far from A's centre line. */
const STEM_CUT = 35;
const LOOP_RADIUS = 28;
/** Loop exit: taper start along A (−d direction) after passing B. */
const LOOP_EXIT = 10;
/** Where the loop's return leg crosses A (distance along −d from B's axis). */
const RETURN_X = 28;

export interface TrumpetPlan {
  a: Road;
  b: Road;
  /** B shortened so it ends before the junction. */
  stem: Road;
  /** Ramps in travel direction; `over` lists pairs (upper, lower) by index. */
  ramps: Vec2[][];
  over: [number, number][];
}

/** Station of a road end and the direction (+1/−1) leading away from it into the road. */
function endInfo(road: Road, end: "start" | "end") {
  const pts = road.points;
  return end === "start" ? { p: pts[0], out: 1 } : { p: pts[pts.length - 1], out: -1 };
}

/** Road shortened by `cut` metres at the given end. */
function trim(road: Road, end: "start" | "end", cut: number): Road | null {
  const pts = end === "start" ? road.points : [...road.points].reverse();
  let rest = cut;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len > rest + 1) {
      const t = rest / len;
      const kept = [{ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, ...pts.slice(i + 1)];
      return { ...road, points: end === "start" ? kept : kept.reverse() };
    }
    rest -= len;
  }
  return null;
}

/** Plans a trumpet for the motorway ending nearest to `click`, or null. */
export function planTrumpet(
  click: Vec2,
  roads: Road[],
  grid: DepthGrid,
  obstacles: Path[] = [],
): TrumpetPlan | null {
  const motorways = roads.filter((r) => r.kind === "highway");
  let pick: { a: Road; b: Road; end: "start" | "end"; d: number } | null = null;
  for (const b of motorways) {
    for (const end of ["start", "end"] as const) {
      const p = endInfo(b, end).p;
      const dClick = Math.hypot(p.x - click.x, p.z - click.z);
      if (dClick > PICK_RADIUS) continue;
      for (const a of motorways) {
        if (a.id === b.id) continue;
        const ax = axisOf(a, p.x, p.z);
        const f = frameAt(ax, ax.s);
        if (Math.hypot(f.p.x - p.x, f.p.z - p.z) > MAX_GAP) continue;
        if (!pick || dClick < pick.d) pick = { a, b, end, d: dClick };
      }
    }
  }
  if (!pick) return null;

  const { a, b, end } = pick;
  const bEnd = endInfo(b, end);
  const A: Axis = axisOf(a, bEnd.p.x, bEnd.p.z);
  const fa = frameAt(A, A.s);
  const C = { x: fa.p.x, z: fa.p.z };
  // B's own axis, referenced at its end; "out" = away from A.
  const B: Axis = axisOf(b, bEnd.p.x, bEnd.p.z);
  const fb = frameAt(B, B.s + bEnd.out * 20);
  const u = { x: fb.t.x * bEnd.out, z: fb.t.z * bEnd.out };
  // Travel direction on A whose right side faces B.
  const sA = u.x * fa.n.x + u.z * fa.n.z >= 0 ? 1 : -1;
  const d = { x: fa.t.x * sA, z: fa.t.z * sA };
  const rd = rightOf(d);
  const out = bEnd.out;
  const inn = -out;
  const V = RAMP_LANE_V;
  const R = LOOP_RADIUS;
  const at = (x: number, y: number) => comb([C, 1], [d, x], [rd, y]);

  // Right turns on B's side are the same in both variants.
  // R1 – A(+d) → B outbound, quadrant (−d, B side). R2 – B inbound → A(+d), quadrant (+d, B side).
  const r1 = [...exitLane(A, sA, -140, 20), at(-62, 32), at(-32, 62), ...entryLane(B, out, 160, 15)];
  const r2 = [...exitLane(B, inn, -140, 20), at(32, 62), at(62, 32), ...entryLane(A, sA, 140, 20)];

  /**
   * Variant "loop for A(−d) → B": A(−d) exits after passing B into a loop on the far side
   * at −d; the loop's return leg crosses A to B; B inbound runs straight over A and around
   * the loop (the trumpet's bell) onto A(−d).
   */
  const variantA = (): { ramps: Vec2[][]; over: [number, number][] } | null => {
    if (roomAhead(A, sA) < 150 || roomAhead(A, -sA) < 200 || roomAhead(B, out) < 170) return null;
    const loopStart = RETURN_X + R;
    const O = at(-loopStart, -(V + R));
    const r3a = [
      ...exitLane(A, -sA, LOOP_EXIT, loopStart - LOOP_EXIT - 30),
      ...arc(O, rd, { x: -d.x, z: -d.z }, R, 0, (3 * Math.PI) / 2).slice(1),
    ];
    const r3b = [at(-RETURN_X, -(V + R)), at(-RETURN_X, 22), at(-14, 45), ...entryLane(B, out, 100, 15)];
    const top = V + 2 * R + 25;
    const west = loopStart + R + 30;
    const r4 = [
      ...exitLane(B, inn, -80, 10),
      at(14, 18),
      at(14, -top),
      at(-west, -top),
      at(-west, -35),
      ...entryLane(A, -sA, 190, 25),
    ];
    // ramps: r1, r2, r3a, r3b, r4 – the return leg passes over the loop's exit lane.
    return { ramps: [r1, r2, r3a, r3b, r4], over: [[3, 2]] };
  };

  /**
   * Variant "loop for B → A(−d)" (the other-hand trumpet): B inbound runs over A into a
   * loop on the far side at +d and merges onto A(−d); A(−d) leaves before B and swings
   * around the loop, back over A onto B outbound.
   */
  const variantB = (): { ramps: Vec2[][]; over: [number, number][] } | null => {
    if (roomAhead(A, sA) < 160 || roomAhead(A, -sA) < 160 || roomAhead(B, out) < 170) return null;
    const O = at(V + R, -(V + R));
    const l1 = [
      ...exitLane(B, inn, -80, 10),
      at(V, -(V + R)),
      ...arc(O, { x: -d.x, z: -d.z }, { x: -rd.x, z: -rd.z }, R, 0, (3 * Math.PI) / 2).slice(1),
    ];
    // Merge from the loop end straight into the taper onto A(−d) (parallel lane = loop end leg).
    const l2 = [at(V + R, -V), ...entryLane(A, -sA, 28, 0).slice(1)];
    const top = V + 2 * R + 30;
    const sd = [
      ...exitLane(A, -sA, -150, 10),
      at(92, -45),
      at(92, -top),
      at(-32, -top),
      at(-32, 22),
      at(-14, 45),
      ...entryLane(B, out, 100, 15),
    ];
    // ramps: r1, r2, l1, l2, sd – the loop's entry leg passes over its own merge lane.
    return { ramps: [r1, r2, l1, l2, sd], over: [[2, 3]] };
  };

  const stem = trim(b, end, STEM_CUT + Math.hypot(bEnd.p.x - C.x, bEnd.p.z - C.z));
  if (!stem) return null;

  // Fit check: no water, nothing else in the way (the two motorways themselves are fine).
  const others = [...roads, ...obstacles].filter((o) => o.id !== a.id && o.id !== b.id);
  const fits = (ramps: Vec2[][]) =>
    ramps.every((ramp) => {
      if (crossesWater(ramp, grid)) return false;
      const probe: Path = { id: "__ramp__", kind: "ramp", points: ramp };
      return findCrossings([probe], others).length === 0;
    });
  for (const variant of [variantA, variantB]) {
    const plan = variant();
    if (plan && fits(plan.ramps)) return { a, b, stem, ...plan };
  }
  return null;
}

/** Separation records for the planned ramp ids (upper over lower). */
export function trumpetSeparations(ids: string[], over: [number, number][]): Separations {
  const out: Separations = {};
  for (const [u, l] of over) out[pairKey(ids[u], ids[l])] = ids[u];
  return out;
}
