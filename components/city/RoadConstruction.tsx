import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { constructionDuration, constructionProgress, crewSize } from "@/lib/city/construction";
import {
  clipAlong,
  createAlongRange,
  ROAD_MATERIAL_KEYS,
  ROAD_MATERIALS,
  SITE_MATERIALS,
  type RoadMaterialKey,
} from "@/lib/city/materials";
import {
  buildFrames,
  buildSiteLayers,
  frameDistances,
  SITE_SPEC,
  type Elevation,
  type Frame,
  type RoadLayers,
  type SiteLayerKey,
} from "@/lib/city/road-geometry";
import { useCity } from "@/lib/city/store";
import type { Road } from "@/lib/city/types";
import { LayerMeshes } from "./LayerMeshes";
import { DumpTruck } from "./models/DumpTruck";
import { Excavator } from "./models/Excavator";
import { Worker } from "./models/Worker";

const CONE_COUNT = 6;
/** The open site must be at least this long before the crew shows up. */
const MIN_ZONE_FOR_CREW = 2;
/** Walking speed of a worker in m/s. */
const WALK_SPEED = 1.4;
/** A worker patrols at most this far back and forth, in metres. */
const PATROL_MAX = 16;
/** Seconds a worker stops to shovel at each end of the patrol. */
const DIG_PAUSE = 1.6;

/** Index of the last frame at or before distance d (frames are ~1 m apart). */
function frameIndexAt(dist: number[], d: number) {
  let lo = 0;
  let hi = dist.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (dist[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Places an object on the road at distance d and lateral offset, facing `facing`. */
function place(
  obj: THREE.Object3D,
  frames: Frame[],
  dist: number[],
  d: number,
  offset: number,
  facing: (f: Frame) => THREE.Vector3,
) {
  const f = frames[frameIndexAt(dist, d)];
  obj.position.set(f.p.x + f.n.x * offset, f.p.y, f.p.z + f.n.z * offset);
  const dir = facing(f);
  obj.rotation.y = Math.atan2(dir.x, dir.z);
}

/** Current extent of the open site, written by the site every frame. */
interface SiteZone {
  built: number;
  front: number;
}

/**
 * One worker walking back and forth along a trench edge inside its own stretch of the site.
 * At each turning point it stops and shovels for a moment, facing the trench.
 */
function PatrollingWorker({
  index,
  count,
  zone,
  frames,
  dist,
  trench,
}: {
  index: number;
  count: number;
  zone: RefObject<SiteZone>;
  frames: Frame[];
  dist: number[];
  trench: [number, number];
}) {
  const group = useRef<THREE.Group>(null);
  const activity = useRef(0);

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const { built, front } = zone.current;
    const len = front - built;
    g.visible = len > MIN_ZONE_FOR_CREW;
    if (!g.visible) return;

    // Each worker owns one slice of the site and patrols around its centre.
    const range = Math.min(len * 0.8 / count, PATROL_MAX);
    const centre = built + (len * (index + 0.5)) / count;
    const walk = Math.max(range / WALK_SPEED, 0.4);
    const cycle = 2 * walk + 2 * DIG_PAUSE;
    const tau = (clock.getElapsedTime() + index * 2.3) % cycle;

    let s: number; // 0..1 along the patrol
    let dir: number; // walking direction along the road
    let walking: boolean;
    if (tau < walk) {
      s = tau / walk;
      dir = 1;
      walking = true;
    } else if (tau < walk + DIG_PAUSE) {
      s = 1;
      dir = 1;
      walking = false;
    } else if (tau < 2 * walk + DIG_PAUSE) {
      s = 1 - (tau - walk - DIG_PAUSE) / walk;
      dir = -1;
      walking = true;
    } else {
      s = 0;
      dir = -1;
      walking = false;
    }
    activity.current = walking ? 1 : 0;

    const d = THREE.MathUtils.clamp(centre - range / 2 + s * range, built + 0.5, front - 0.5);
    const leftSide = index % 2 === 0;
    const offset = leftSide ? trench[0] - 0.6 : trench[1] + 0.6;
    place(g, frames, dist, d, offset, (f) =>
      walking ? f.t.clone().multiplyScalar(dir) : f.n.clone().multiplyScalar(leftSide ? 1 : -1),
    );
  });

  return (
    <group ref={group} visible={false}>
      <Worker phase={index * 1.7} activity={activity} />
    </group>
  );
}

/**
 * Construction animation for a freshly built road. A work front runs from the start to the
 * end of the road: ahead of it is untouched grass, behind it the open site (torn-up soil, a
 * trench with water and gas pipes, workers, an excavator at the front, a truck) and behind
 * the site the finished road appears. Duration depends on length, capped at 15 s.
 */
export function RoadConstruction({ road, layers, profile }: { road: Road; layers: RoadLayers; profile?: Elevation }) {
  const finishJob = useCity((s) => s.finishJob);

  const frames = useMemo(() => buildFrames(road.points, road.kind, profile), [road, profile]);
  const dist = useMemo(() => frameDistances(frames), [frames]);
  const total = dist[dist.length - 1] ?? 0;
  // Merged onto an existing road: only the new part after `offset` is a construction site.
  const offset = Math.min(total, useCity.getState().jobOffsets[road.id] ?? 0);
  const length = total - offset;
  const duration = constructionDuration(length, road.kind);
  const site = useMemo(() => buildSiteLayers(road.points, road.kind, profile), [road, profile]);
  const { halfWidth, trench } = SITE_SPEC[road.kind];
  const trenchCentre = (trench[0] + trench[1]) / 2;

  // Per-road clones of the shared materials, clipped to the finished part and the open site.
  const { ranges, roadMaterials, siteMaterials } = useMemo(() => {
    const roadRange = createAlongRange(-1, 0);
    const siteRange = createAlongRange(0, 0);
    const roadMaterials = Object.fromEntries(
      ROAD_MATERIAL_KEYS.map((k) => [k, clipAlong(ROAD_MATERIALS[k], roadRange, `road-${k}`)]),
    ) as unknown as Record<RoadMaterialKey, THREE.Material>;
    const siteMaterials = Object.fromEntries(
      (Object.keys(SITE_MATERIALS) as SiteLayerKey[]).map((k) => [
        k,
        clipAlong(SITE_MATERIALS[k], siteRange, `site-${k}`),
      ]),
    ) as unknown as Record<SiteLayerKey, THREE.Material>;
    return { ranges: { road: roadRange, site: siteRange }, roadMaterials, siteMaterials };
  }, []);

  useEffect(() => {
    return () => {
      Object.values(roadMaterials).forEach((m) => m.dispose());
      Object.values(siteMaterials).forEach((m) => m.dispose());
    };
  }, [roadMaterials, siteMaterials]);
  useEffect(() => {
    return () => Object.values(site).forEach((g) => g?.dispose());
  }, [site]);

  // The frame loop writes the reveal uniforms through this ref.
  const rangesRef = useRef(ranges);
  useEffect(() => {
    rangesRef.current = ranges;
  }, [ranges]);

  const crew = crewSize(length);
  const zoneRef = useRef<SiteZone>({ built: 0, front: 0 });
  const excavatorRef = useRef<THREE.Group>(null);
  const truckRef = useRef<THREE.Group>(null);
  const conesRef = useRef<THREE.Group>(null);
  const elapsed = useRef(0);
  const done = useRef(false);

  useFrame((_, dt) => {
    if (done.current || frames.length < 2) return;
    elapsed.current += dt;
    const progress = constructionProgress(elapsed.current, duration, length);
    const front = offset + progress.front;
    const built = offset + progress.built;
    const finished = progress.done;

    const r = rangesRef.current;
    r.road.to.value = built;
    r.site.from.value = built;
    r.site.to.value = front;

    const zone = front - built;
    const crewVisible = zone > MIN_ZONE_FOR_CREW;
    const along = (f: Frame) => f.t;
    const back = (f: Frame) => f.t.clone().negate();

    zoneRef.current.built = built;
    zoneRef.current.front = front;

    // Excavator digs at the front, facing back into the trench it opens.
    if (excavatorRef.current) {
      excavatorRef.current.visible = front < total || crewVisible;
      place(excavatorRef.current, frames, dist, Math.min(total, front + 2), trenchCentre, back);
    }

    // Truck waits on the opened ground in the middle of the site.
    if (truckRef.current) {
      truckRef.current.visible = zone > 10;
      place(truckRef.current, frames, dist, built + zone * 0.5, -(halfWidth - 2.8), along);
    }

    // Cone line just ahead of the front.
    if (conesRef.current) {
      conesRef.current.visible = zone > 0.5;
      place(conesRef.current, frames, dist, Math.min(total, front + 4), 0, along);
    }

    if (finished) {
      done.current = true;
      finishJob(road.id);
    }
  });

  // Cones across the road width. Local -x is the road's +n side.
  const coneOffsets = Array.from(
    { length: CONE_COUNT },
    (_, i) => -halfWidth + 1 + ((2 * halfWidth - 2) * i) / (CONE_COUNT - 1),
  );

  return (
    <group>
      <LayerMeshes layers={layers} materials={roadMaterials} shadows={false} />

      {(Object.keys(site) as SiteLayerKey[]).map((key) => (
        <mesh key={key} geometry={site[key]} material={siteMaterials[key]} receiveShadow />
      ))}

      {Array.from({ length: crew }, (_, i) => (
        <PatrollingWorker
          key={i}
          index={i}
          count={crew}
          zone={zoneRef}
          frames={frames}
          dist={dist}
          trench={trench}
        />
      ))}

      <group ref={excavatorRef} visible={false}>
        <Excavator working />
      </group>
      <group ref={truckRef} visible={false}>
        <DumpTruck />
      </group>

      <group ref={conesRef} visible={false}>
        {coneOffsets.map((o) => (
          <group key={o} position={[-o, 0, 0]}>
            <mesh position={[0, 0.35, 0]} castShadow>
              <coneGeometry args={[0.22, 0.7, 12]} />
              <meshStandardMaterial color="#ff5a1f" roughness={0.6} />
            </mesh>
            <mesh position={[0, 0.38, 0]}>
              <cylinderGeometry args={[0.135, 0.165, 0.12, 12]} />
              <meshStandardMaterial color="#f4f4f4" roughness={0.4} />
            </mesh>
            <mesh position={[0, 0.02, 0]}>
              <boxGeometry args={[0.5, 0.04, 0.5]} />
              <meshStandardMaterial color="#2a2a2a" roughness={0.9} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}
