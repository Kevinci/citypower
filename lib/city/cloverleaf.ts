import { overOf, pairKey, type Separations } from "./grade";
import { findCrossings } from "./network";
import {
  arc,
  axisOf,
  comb,
  crossesWater,
  entryLane,
  exitLane,
  frameAt,
  onAxis,
  RAMP_LANE_V,
  rightOf,
  roomAhead,
} from "./ramps";
import type { DepthGrid } from "./terrain";
import type { Path, Road, Vec2 } from "./types";

/**
 * Motorway interchange "Kleeblatt" (cloverleaf) where two motorways cross.
 *
 * For every travel direction d of either motorway (right-hand traffic, rd = right of d):
 *  - right turn: an outer connector ("Tangente") leaves before the crossing, swings wide
 *    around the quadrant (−d, rd) and joins the other motorway heading towards rd;
 *  - left turn: a 270° loop leaves after the crossing into the quadrant (+d, rd), turns
 *    right three quarters of a circle and joins the other motorway heading away from rd.
 * Each of the four quadrants gets exactly one loop and one outer connector. Ramps are stored
 * in travel direction and attach to the motorways like the diamond ramps do (their height
 * follows the motorway, see grade.ts).
 */

const PICK_RADIUS = 60;
/** Loop radius (indirect ramp, RAA: small radius, low ramp speed). */
const LOOP_RADIUS = 28;
/** Outer connectors (Tangenten): where their exit taper starts / entry taper ends. */
const OUTER_ATTACH = 150;
/** How far out the outer connectors swing (outside the loops). */
const OUTER_SWING = 95;
/** Each motorway needs this much length on both sides of the crossing. */
const NEEDED = OUTER_ATTACH + 10;

export interface CloverleafPlan {
  a: Road;
  b: Road;
  ramps: Vec2[][];
  /**
   * Grade-separation decisions: [upper, lower], each a ramp index or a road id. The upper
   * motorway bridges the weaving lanes of the lower one, and its own weaving lanes pass
   * over them.
   */
  over: [number | string, number | string][];
  /** Why it cannot be built here (shown in red), or null if it fits. */
  problem: string | null;
  /** For a placed prefab: the new crossing motorway that has to be built as well. */
  newMotorway?: Road;
}

/** Plans the eight ramps for the motorway × motorway crossing nearest to `click`, or null. */
export function planCloverleaf(
  click: Vec2,
  roads: Road[],
  seps: Separations,
  grid: DepthGrid,
  obstacles: Path[] = [],
): CloverleafPlan | null {
  const motorways = roads.filter((r) => r.kind === "highway");
  let pick: { x: number; z: number; a: Road; b: Road } | null = null;
  let bestD = PICK_RADIUS;
  for (const c of findCrossings(motorways, motorways)) {
    if (c.a >= c.b) continue;
    const a = motorways.find((m) => m.id === c.a);
    const b = motorways.find((m) => m.id === c.b);
    if (!a || !b || !overOf(a, b, seps)) continue;
    // Shared end points are joins, not crossings.
    if ([a, b].every((m) => m.points.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 0.5))) continue;
    const d = Math.hypot(c.x - click.x, c.z - click.z);
    if (d < bestD) {
      bestD = d;
      pick = { x: c.x, z: c.z, a, b };
    }
  }
  if (!pick) return null;
  return layoutCloverleaf(pick, roads, seps, grid, obstacles);
}

/** Lays out the ramps for a known crossing of motorways a and b at (x, z). */
function layoutCloverleaf(
  pick: { x: number; z: number; a: Road; b: Road },
  roads: Road[],
  seps: Separations,
  grid: DepthGrid,
  obstacles: Path[],
): CloverleafPlan {
  const A = axisOf(pick.a, pick.x, pick.z);
  const B = axisOf(pick.b, pick.x, pick.z);
  let problem: string | null = null;
  for (const ax of [A, B]) {
    if (roomAhead(ax, 1) < NEEDED || roomAhead(ax, -1) < NEEDED) {
      problem = `Zu wenig Platz: jede Autobahn braucht ${NEEDED} m auf beiden Seiten`;
    }
  }
  const C = { x: pick.x, z: pick.z };
  const tA = frameAt(A, A.s).t;
  const tB = frameAt(B, B.s).t;
  const V = RAMP_LANE_V;
  const R = LOOP_RADIUS;
  // Loop centre sits diagonally in the quadrant so both loop ends run parallel to the
  // motorways at the ramp-lane offset (tangential exit and entry).
  const L = V + R;

  const ramps: Vec2[][] = [];
  const upper = overOf(pick.a, pick.b, seps) ?? pick.a;
  const auxOf: { road: Road; index: number }[] = [];
  const moves = [
    { own: A, sign: 1, t: tA, other: B, tOther: tB },
    { own: A, sign: -1, t: tA, other: B, tOther: tB },
    { own: B, sign: 1, t: tB, other: A, tOther: tA },
    { own: B, sign: -1, t: tB, other: A, tOther: tA },
  ];
  for (const m of moves) {
    const d = { x: m.t.x * m.sign, z: m.t.z * m.sign };
    const rd = rightOf(d);
    // Direction on the other motorway that points to our right.
    const eSign = m.tOther.x * rd.x + m.tOther.z * rd.z >= 0 ? 1 : -1;
    const e = { x: m.tOther.x * eSign, z: m.tOther.z * eSign };

    // Right turn (Tangente): parallel exit well before the crossing, wide curve around the
    // quadrant (−d, +e) outside the loop, parallel entry onto the other motorway heading +e.
    ramps.push([
      ...exitLane(m.own, m.sign, -OUTER_ATTACH, 10),
      comb([C, 1], [d, -OUTER_SWING], [e, 40]),
      comb([C, 1], [d, -OUTER_SWING + 6], [e, OUTER_SWING - 6]),
      comb([C, 1], [d, -40], [e, OUTER_SWING]),
      ...entryLane(m.other, eSign, OUTER_ATTACH, 10),
    ]);

    // Weaving lane (Verflechtungsstreifen) on the right of d: a continuous extra lane from
    // before to after the crossing. The loop of the other motorway merges into it at −L, our
    // own loop leaves it at +L; traffic in between weaves between lane and carriageway.
    const auxIn = onAxis(m.own, m.sign, -L, V);
    const auxOut = onAxis(m.own, m.sign, L, V);
    auxOf.push({ road: m.own.road, index: ramps.length });
    ramps.push([onAxis(m.own, m.sign, -L - 22, 11.5), auxIn, auxOut, onAxis(m.own, m.sign, L + 22, 11.5)]);

    // Left turn (Schleife): 270° clockwise loop in quadrant (+d, +e) from our weaving lane
    // to the weaving lane of the other motorway heading −e.
    const O = comb([C, 1], [d, L], [e, L]);
    ramps.push([
      auxOut,
      ...arc(O, { x: -e.x, z: -e.z }, d, R, 0, (3 * Math.PI) / 2).slice(1, -1),
      onAxis(m.other, -eSign, -L, V),
    ]);
  }

  // The upper motorway bridges the lower one's weaving lanes; its own weaving lanes pass
  // over those of the lower one.
  const over: [number | string, number | string][] = [];
  for (const lo of auxOf.filter((x) => x.road.id !== upper.id)) {
    over.push([upper.id, lo.index]);
    for (const hi of auxOf.filter((x) => x.road.id === upper.id)) over.push([hi.index, lo.index]);
  }

  // Everything must fit: no water, nothing else built in the way.
  const others = [...roads, ...obstacles].filter((o) => o.id !== pick.a.id && o.id !== pick.b.id);
  for (const ramp of ramps) {
    if (problem) break;
    if (crossesWater(ramp, grid)) problem = "Rampen würden durch Wasser führen";
    const probe: Path = { id: "__ramp__", kind: "ramp", points: ramp };
    if (findCrossings([probe], others).length > 0) problem = "Andere Wege liegen im Weg";
  }
  return { a: pick.a, b: pick.b, ramps, over, problem };
}

/** Length of the crossing motorway a prefab brings along, on each side of the crossing. */
const PREFAB_HALF = NEEDED + 40;
/** The cursor must be this close to a motorway to place a prefab on it. */
const PREFAB_SNAP = 45;

/**
 * Prefab cloverleaf: placed onto a single motorway at the cursor. Brings its own crossing
 * motorway (at right angles, PREFAB_HALF on each side), which bridges the existing one.
 * `id` is the id the new motorway gets when built.
 */
export function planCloverleafPrefab(
  cursor: Vec2,
  roads: Road[],
  seps: Separations,
  grid: DepthGrid,
  obstacles: Path[] = [],
  id = "__prefab__",
): CloverleafPlan | null {
  let best: { road: Road; d: number } | null = null;
  for (const m of roads) {
    if (m.kind !== "highway") continue;
    const ax = axisOf(m, cursor.x, cursor.z);
    const f = frameAt(ax, ax.s);
    const d = Math.hypot(f.p.x - cursor.x, f.p.z - cursor.z);
    if (d < PREFAB_SNAP && (!best || d < best.d)) best = { road: m, d };
  }
  if (!best) return null;
  const A = axisOf(best.road, cursor.x, cursor.z);
  const f = frameAt(A, A.s);
  const C = { x: f.p.x, z: f.p.z };
  const b: Road = {
    id,
    kind: "highway",
    points: [comb([C, 1], [f.n, -PREFAB_HALF]), comb([C, 1], [f.n, PREFAB_HALF])],
  };
  // The new motorway goes over the existing one.
  const prefabSeps = { ...seps, [pairKey(b.id, best.road.id)]: b.id };
  const plan = layoutCloverleaf({ x: C.x, z: C.z, a: best.road, b }, [...roads, b], prefabSeps, grid, obstacles);
  if (!plan.problem) {
    const others = [...roads, ...obstacles].filter((o) => o.id !== best.road.id);
    if (findCrossings([b], others).length > 0) plan.problem = "Die neue Autobahn würde andere Wege kreuzen";
  }
  return { ...plan, newMotorway: b };
}
