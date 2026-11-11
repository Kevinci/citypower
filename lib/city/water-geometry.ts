import type * as THREE from "three";
import type { WaterMaterialKey } from "./materials";
import { buildFrames, MeshBuilder, strip, wall, type Frame, type Skip } from "./road-geometry";
import { CANAL_DEPTH } from "./terrain";
import { HALF_WIDTH, OUTER_HALF_WIDTH, type WaterwayKind, type Vec2 } from "./types";

export type CanalLayers = Partial<Record<WaterMaterialKey, THREE.BufferGeometry>>;

const QUAY_TOP = 0.12;
const CAP_WIDTH = 0.5;
const COPING_Y = 0.06;

/**
 * Canal banks: vertical stone quay walls down to the canal bed, a cap stone along the top
 * and a paved towpath behind it. The water itself is the shared water plane; the terrain
 * is carved by the depth grid once the canal is finished.
 * `skip` removes walls and cap stones (bridges over the canal, junctions with other water);
 * `towpathSkip` removes towpath pieces (also where a road or track runs alongside).
 */
export function buildCanalLayers(
  points: Vec2[],
  kind: WaterwayKind,
  skip?: Skip,
  towpathSkip: Skip | undefined = skip,
): CanalLayers {
  const frames = buildFrames(points, kind);
  if (frames.length < 2) return {};
  const hw = HALF_WIDTH[kind];
  const outer = OUTER_HALF_WIDTH[kind];

  const m: Record<WaterMaterialKey, MeshBuilder> = { quay: new MeshBuilder(), towpath: new MeshBuilder() };

  for (const s of [-1, 1]) {
    const inner = s * hw;
    const cap = s * (hw + CAP_WIDTH);
    wall(m.quay, frames, inner, -CANAL_DEPTH - 0.2, QUAY_TOP, skip);
    strip(m.quay, frames, Math.min(inner, cap), Math.max(inner, cap), QUAY_TOP, { skip });
    wall(m.quay, frames, cap, COPING_Y, QUAY_TOP, skip);
    strip(m.towpath, frames, Math.min(cap, s * outer), Math.max(cap, s * outer), COPING_Y, { skip: towpathSkip });
  }

  // End walls with cap and towpath, unless the canal opens into other water there.
  for (const [f, dir] of [
    [frames[0], -1],
    [frames[frames.length - 1], 1],
  ] as const) {
    const out = f.t.clone().multiplyScalar(dir);
    if (skip && skip(f.p.clone().addScaledVector(out, 1.5))) continue;
    // Frames running outwards from the end line; offsets are measured across the canal.
    const beyond = (d: number): Frame => ({ p: f.p.clone().addScaledVector(out, d), t: out, n: f.n });
    strip(m.quay, [beyond(0), beyond(CAP_WIDTH)], -hw - CAP_WIDTH, hw + CAP_WIDTH, QUAY_TOP);
    if (!towpathSkip?.(beyond(CAP_WIDTH + 1).p)) {
      strip(m.towpath, [beyond(CAP_WIDTH), beyond(outer - hw)], -outer, outer, COPING_Y);
    }
    // Frames running across the canal along the end line, for the vertical wall faces.
    const along = (o: number, d: number): Frame => ({
      p: f.p.clone().addScaledVector(f.n, o).addScaledVector(out, d),
      t: f.n,
      n: out,
    });
    wall(m.quay, [along(-hw, 0), along(hw, 0)], 0, -CANAL_DEPTH - 0.2, QUAY_TOP);
    wall(m.quay, [along(-hw - CAP_WIDTH, CAP_WIDTH), along(hw + CAP_WIDTH, CAP_WIDTH)], 0, COPING_Y, QUAY_TOP);
  }

  const out: CanalLayers = {};
  (Object.keys(m) as WaterMaterialKey[]).forEach((key) => {
    const g = m[key].geometry();
    if (g) out[key] = g;
  });
  return out;
}
