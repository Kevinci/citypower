import type * as THREE from "three";
import { pathsNear, occupant, waterAt } from "./adjacency";
import type { Junction } from "./network";
import { band, buildFrames, MeshBuilder, tube, type Frame } from "./road-geometry";
import { naturalDepthGrid, sampleDepth, type DepthGrid } from "./terrain";
import { HALF_WIDTH, OUTER_HALF_WIDTH, type Path, type Road } from "./types";
import type { Profile } from "./grade";

/** How far beyond the road edge a danger (water, track) still gets a barrier. */
const LOOKOUT = [1, 2.5, 4, 5.5];
/** Gaps in a barrier up to this many frames (≈ metres) are closed. */
const MAX_GAP = 3;
/** Shorter barrier pieces are dropped. */
const MIN_RUN = 6;
const GUARDRAIL_POST_SPACING = 2;
const RAILING_POST_SPACING = 2.5;

type Style = "guardrail" | "railing";

const styleOf = (road: Road): Style => (road.kind === "bike" ? "railing" : "guardrail");

/** Distance of the barrier line from the centre line. */
const barrierOffset = (road: Road) => OUTER_HALF_WIDTH[road.kind] + (road.kind === "bike" ? 0.1 : 0.25);

/** Closes short gaps and removes short pieces in a per-frame mask. */
function cleanMask(mask: boolean[]): boolean[] {
  const out = [...mask];
  let i = 0;
  while (i < out.length) {
    if (out[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && !out[j]) j++;
    if (i > 0 && j < out.length && j - i <= MAX_GAP) for (let k = i; k < j; k++) out[k] = true;
    i = j;
  }
  i = 0;
  while (i < out.length) {
    if (!out[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && out[j]) j++;
    if (j - i < MIN_RUN) for (let k = i; k < j; k++) out[k] = false;
    i = j;
  }
  return out;
}

function runs(mask: boolean[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= mask.length; i++) {
    if (i < mask.length && mask[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  return out;
}

/**
 * Barrier along `frames` at lateral `offset`; `side` (+1/-1) is the side away from the road,
 * the beam is mounted on the road-facing side of the posts.
 */
function barrierRun(mb: MeshBuilder, frames: Frame[], offset: number, side: number, style: Style, along0: number) {
  if (frames.length < 2) return;
  const o = offset;
  const toRoad = -side;
  // Posts.
  const spacing = style === "guardrail" ? GUARDRAIL_POST_SPACING : RAILING_POST_SPACING;
  let d = 0;
  let next = 0;
  for (let i = 0; i < frames.length; i++) {
    if (i > 0) d += frames[i - 1].p.distanceTo(frames[i].p);
    if (d + 1e-6 < next) continue;
    next = d + spacing;
    const f = frames[i];
    const c = f.p.clone().addScaledVector(f.n, o);
    if (style === "guardrail") mb.box(c, f.t, f.n, 0.07, 0.05, 0, 0.72, along0 + d);
    else mb.box(c, f.t, f.n, 0.03, 0.03, 0, 1.1, along0 + d);
  }
  if (style === "guardrail") {
    // W-beam profile: four bands zig-zagging between 0.42 m and 0.76 m.
    const near = o + toRoad * 0.09;
    const far = o + toRoad * 0.16;
    band(mb, frames, [near, 0.42], [far, 0.51]);
    band(mb, frames, [far, 0.51], [near, 0.59]);
    band(mb, frames, [near, 0.59], [far, 0.67]);
    band(mb, frames, [far, 0.67], [near, 0.76]);
  } else {
    tube(mb, frames, o, 1.08, 0.035, 6);
    tube(mb, frames, o, 0.55, 0.02, 5);
  }
}

/**
 * Guardrails (roads) or railings (cycle paths) wherever a road runs next to something
 * dangerous: water (rivers, lakes, finished canals) or a railway on that side, plus a
 * barrier across a road end that stops at the water or at a track. Lifted parts are skipped
 * (bridges and embankments have railings), and so are places where another path joins.
 */
export function buildRoadBarriers(
  road: Road,
  grid: DepthGrid,
  others: Path[],
  junctions: Junction[],
  profile?: Profile,
): THREE.BufferGeometry | null {
  const frames = buildFrames(road.points, road.kind, profile);
  if (frames.length < 2) return null;
  // Only paths and junctions near this road matter (every frame is tested against them).
  others = pathsNear(road.points, others, 60);
  {
    const xs = road.points.map((p) => p.x);
    const zs = road.points.map((p) => p.z);
    const [x0, x1, z0, z1] = [Math.min(...xs) - 60, Math.max(...xs) + 60, Math.min(...zs) - 60, Math.max(...zs) + 60];
    junctions = junctions.filter((j) => j.x >= x0 - j.radius && j.x <= x1 + j.radius && j.z >= z0 - j.radius && j.z <= z1 + j.radius);
  }
  const style = styleOf(road);
  const outer = OUTER_HALF_WIDTH[road.kind];
  const offset = barrierOffset(road);
  const exclude = [road.id];

  // Lifted parts (bridges, embankments) carry their own railings.
  const onBridge = frames.map((f) => f.p.y - Math.max(0, -sampleDepth(grid, f.p.x, f.p.z)) > 0.05);

  const dangerAt = (x: number, z: number) =>
    waterAt(grid, { x, z }, 0.3) || occupant({ x, z }, others, { networks: ["rail", "water"], exclude }) !== null;
  const blockedAt = (x: number, z: number) =>
    occupant({ x, z }, others, { exclude, core: true, margin: 0.3 }) !== null ||
    junctions.some((j) => Math.hypot(x - j.x, z - j.z) < j.radius + 2.5);

  // Barrier positions to try, from the outer edge inwards to just beside the carriageway:
  // a road built so close that its sidewalk reaches the quay gets the barrier on the curb.
  const candidates: number[] = [];
  for (let o = offset; o >= HALF_WIDTH[road.kind] + 0.3; o -= 0.5) candidates.push(o);

  const natural = naturalDepthGrid();
  const mb = new MeshBuilder();
  for (const side of [-1, 1]) {
    const placed = frames.map((f, i) => {
      if (onBridge[i]) return null;
      const danger = LOOKOUT.some((d) =>
        dangerAt(f.p.x + f.n.x * side * (outer + d), f.p.z + f.n.z * side * (outer + d)),
      ) || waterAt(grid, { x: f.p.x + f.n.x * side * outer, z: f.p.z + f.n.z * side * outer }, 0.3);
      if (!danger) return null;
      for (const o of candidates) {
        const bx = f.p.x + f.n.x * side * o;
        const bz = f.p.z + f.n.z * side * o;
        // Canals are tested by their exact quay line (occupant), natural water by the grid.
        if (!blockedAt(bx, bz) && !waterAt(natural, { x: bx, z: bz }, 0.3)) return o;
      }
      return null;
    });
    const mask = cleanMask(placed.map((o) => o !== null));
    for (const [a, b] of runs(mask)) {
      // One offset per run: the innermost one any frame of the run needed.
      const o = Math.min(...placed.slice(a, b + 1).map((v) => v ?? offset));
      barrierRun(mb, frames.slice(a, b + 1), side * o, side, style, a);
    }
  }

  // Road ends facing water or a track.
  const ends: [Frame, number][] = [
    [frames[0], -1],
    [frames[frames.length - 1], 1],
  ];
  for (const [f, dir] of ends) {
    const out = f.t.clone().multiplyScalar(dir);
    const joined = others.some(
      (o) => o.id !== road.id && o.points.some((q) => Math.hypot(q.x - f.p.x, q.z - f.p.z) < 1),
    );
    if (joined) continue;
    const ahead = [1, 3, 5, 7].some((d) => dangerAt(f.p.x + out.x * d, f.p.z + out.z * d));
    if (!ahead) continue;
    // Frames across the road end; their normal points away from the road.
    const across: Frame[] = [];
    const steps = Math.ceil(outer * 2);
    for (let k = 0; k <= steps; k++) {
      const o = -outer + (2 * outer * k) / steps;
      across.push({ p: f.p.clone().addScaledVector(f.n, o).addScaledVector(out, 0.3), t: f.n.clone(), n: out.clone() });
    }
    barrierRun(mb, across, 0, 1, style, 0);
  }

  return mb.geometry();
}
