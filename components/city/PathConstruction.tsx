import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { constructionDuration, constructionProgress } from "@/lib/city/construction";
import { clipAlong, createAlongRange, SITE_MATERIALS } from "@/lib/city/materials";
import { buildFrames, frameDistances, MeshBuilder, strip, type Elevation, type Frame } from "@/lib/city/road-geometry";
import { useCity } from "@/lib/city/store";
import { OUTER_HALF_WIDTH, type Path } from "@/lib/city/types";
import { LayerMeshes } from "./LayerMeshes";
import { DumpTruck } from "./models/DumpTruck";
import { Excavator } from "./models/Excavator";

function frameAt(frames: Frame[], dist: number[], d: number) {
  let i = 0;
  while (i < dist.length - 1 && dist[i + 1] <= d) i++;
  return frames[i];
}

/**
 * Construction animation for tracks and canals. Like the road site but without the utility
 * trench: an excavator opens the ground at the front, a dump truck waits on the open soil,
 * and the finished layers appear behind them. Calls finishJob when done.
 */
export function PathConstruction<K extends string>({
  path,
  layers,
  materials,
  shadowKeys,
  profile,
}: {
  path: Path;
  /** Height profile, so the site follows the terrain. */
  profile?: Elevation;
  layers: Partial<Record<K, THREE.BufferGeometry>>;
  materials: Record<K, THREE.Material>;
  shadowKeys?: readonly string[];
}) {
  const finishJob = useCity((s) => s.finishJob);
  const frames = useMemo(() => buildFrames(path.points, path.kind, profile), [path, profile]);
  const dist = useMemo(() => frameDistances(frames), [frames]);
  const total = dist[dist.length - 1] ?? 0;
  const offset = Math.min(total, useCity.getState().jobOffsets[path.id] ?? 0);
  const length = total - offset;
  // Rails and canals use the slower highway rate: heavier earthworks.
  const duration = constructionDuration(length, "highway");
  const half = OUTER_HALF_WIDTH[path.kind];

  const dirt = useMemo(() => {
    const mb = new MeshBuilder();
    strip(mb, frames, -half - 0.6, half + 0.6, 0.012);
    return mb.geometry();
  }, [frames, half]);

  const { doneRange, siteRange, clipped, dirtMaterial } = useMemo(() => {
    const doneRange = createAlongRange(-1, 0);
    const siteRange = createAlongRange(0, 0);
    const clipped = Object.fromEntries(
      (Object.keys(materials) as K[]).map((k) => [k, clipAlong(materials[k], doneRange, `path-${String(k)}`)]),
    ) as Record<K, THREE.Material>;
    const dirtMaterial = clipAlong(SITE_MATERIALS.dirt, siteRange, "path-dirt");
    return { doneRange, siteRange, clipped, dirtMaterial };
  }, [materials]);

  useEffect(
    () => () => {
      Object.values<THREE.Material>(clipped).forEach((m) => m.dispose());
      dirtMaterial.dispose();
    },
    [clipped, dirtMaterial],
  );
  useEffect(() => () => dirt?.dispose(), [dirt]);

  const ranges = useRef({ doneRange, siteRange });
  useEffect(() => {
    ranges.current = { doneRange, siteRange };
  }, [doneRange, siteRange]);

  const excavator = useRef<THREE.Group>(null);
  const truck = useRef<THREE.Group>(null);
  const elapsed = useRef(0);
  const done = useRef(false);

  useFrame((_, dt) => {
    if (done.current || frames.length < 2) return;
    elapsed.current += dt;
    const progress = constructionProgress(elapsed.current, duration, length);
    const front = offset + progress.front;
    const built = offset + progress.built;
    const finished = progress.done;
    ranges.current.doneRange.to.value = built;
    ranges.current.siteRange.from.value = built;
    ranges.current.siteRange.to.value = front;

    const place = (obj: THREE.Object3D | null, d: number, offset: number, back: boolean) => {
      if (!obj) return;
      const f = frameAt(frames, dist, d);
      obj.position.set(f.p.x + f.n.x * offset, f.p.y, f.p.z + f.n.z * offset);
      obj.rotation.y = Math.atan2(back ? -f.t.x : f.t.x, back ? -f.t.z : f.t.z);
    };
    if (excavator.current) {
      excavator.current.visible = front - built > 1;
      place(excavator.current, Math.min(total, front + 2), 0, true);
    }
    if (truck.current) {
      truck.current.visible = front - built > 10;
      place(truck.current, built + (front - built) * 0.5, -(half - 1.5), false);
    }

    if (finished) {
      done.current = true;
      finishJob(path.id);
    }
  });

  return (
    <group>
      <LayerMeshes layers={layers} materials={clipped} shadows={false} shadowKeys={shadowKeys} />
      {dirt && <mesh geometry={dirt} material={dirtMaterial} receiveShadow />}
      <group ref={excavator} visible={false}>
        <Excavator working />
      </group>
      <group ref={truck} visible={false}>
        <DumpTruck />
      </group>
    </group>
  );
}
