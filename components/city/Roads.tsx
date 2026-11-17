import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { occupant, pathsNear } from "@/lib/city/adjacency";
import { buildRoadBarriers } from "@/lib/city/barrier-geometry";
import { BARRIER_MATERIAL, ROAD_MATERIALS } from "@/lib/city/materials";
import { distanceToPath, findJunctions, type Junction } from "@/lib/city/network";
import {
  buildFrames,
  buildJunctionLayer,
  buildRoadLayers,
  lampSpots,
  type LampSpot,
} from "@/lib/city/road-geometry";
import { useCity } from "@/lib/city/store";
import { NETWORK_OF, OUTER_HALF_WIDTH, type Path, type Road, type RoadKind } from "@/lib/city/types";
import { heightAtPoint, type Profile } from "@/lib/city/grade";
import type { DepthGrid } from "@/lib/city/terrain";
import { LayerMeshes } from "./LayerMeshes";
import { StaticBatches } from "./StaticBatcher";

/** Marks a finished road as a unit for the StaticBatcher (same flag as building groups). */
const BATCH_UNIT = { base: true };
import { crossingCutRadius, useRailRoadCrossings } from "./Rails";
import { RoadConstruction } from "./RoadConstruction";
import { Structure } from "./Structure";
import { profileOf, useProfiles } from "./useProfiles";
import { useDepthGrid } from "./useWater";

/** Lamp spacing along the road and lateral offset from the centre line. */
const LAMP_LAYOUT: Record<RoadKind, { spacing: number; offset: number }> = {
  street: { spacing: 16, offset: 5.1 },
  // Motorways and their ramps are unlit outside towns in Germany: no lamps.
  highway: { spacing: Infinity, offset: 13 },
  bike: { spacing: 28, offset: 2.3 },
  ramp: { spacing: Infinity, offset: 5 },
};

/** Lamp heads: one shared material so the night can switch the glow on (`setLampGlow` from Sky.tsx). */
const LAMP_HEAD = new THREE.MeshStandardMaterial({ color: "#fff7e6", emissive: "#ffd48a", emissiveIntensity: 1.6, toneMapped: false });
export function setLampGlow(intensity: number) {
  LAMP_HEAD.emissiveIntensity = intensity;
}

/** Lamp spots of every finished road, reported by the road views (road id → spots). */
type LampReport = (id: string, spots: LampSpot[]) => void;

const POST_GEOMETRY = new THREE.CylinderGeometry(0.08, 0.11, 6.5, 8);
const HEAD_GEOMETRY = new THREE.BoxGeometry(0.35, 0.14, 0.7);
const POST_CLASSIC = new THREE.MeshStandardMaterial({ color: "#c9ced6", roughness: 0.35, metalness: 0.7 });
// City Pack style: matte light blue-grey posts like the lamps of Kenney's road tiles.
const POST_PACK = new THREE.MeshStandardMaterial({ color: "#b6bfe5", roughness: 0.7, metalness: 0.1 });

/** Writes static instance matrices once (posts and heads of all lamps). */
function fillLamps(posts: THREE.InstancedMesh, heads: THREE.InstancedMesh, spots: LampSpot[], postMaterial: THREE.Material) {
  posts.material = postMaterial;
  posts.castShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  spots.forEach((s, i) => {
    p.set(s.position.x, s.position.y + 3.25, s.position.z);
    posts.setMatrixAt(i, m.compose(p, q.identity(), one));
    p.set(s.position.x + s.inward.x * 0.45, s.position.y + 6.45, s.position.z + s.inward.z * 0.45);
    heads.setMatrixAt(i, m.compose(p, q.setFromAxisAngle(up, Math.atan2(s.inward.x, s.inward.z)), one));
  });
  for (const mesh of [posts, heads]) {
    mesh.count = spots.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
}

/**
 * All street lamps of the town in two instanced meshes (posts, heads). Static: matrices are
 * written when the roads change, never per frame (drei `Instances` per road recomputed
 * every instance each frame – ~300 meshes and 2 ms per frame in a big town).
 */
function StreetLamps({ spots }: { spots: LampSpot[] }) {
  const pack = useCity((st) => st.houseStyle) === "pack";
  const capacity = Math.max(64, spots.length);
  const posts = useMemo(() => new THREE.InstancedMesh(POST_GEOMETRY, POST_CLASSIC, capacity), [capacity]);
  const heads = useMemo(() => new THREE.InstancedMesh(HEAD_GEOMETRY, LAMP_HEAD, capacity), [capacity]);
  useEffect(() => fillLamps(posts, heads, spots, pack ? POST_PACK : POST_CLASSIC), [posts, heads, spots, pack]);
  useEffect(
    () => () => {
      posts.dispose();
      heads.dispose();
    },
    [posts, heads],
  );
  return (
    <>
      <primitive object={posts} />
      <primitive object={heads} />
    </>
  );
}

function RoadView({
  road,
  junctions,
  building,
  grid,
  neighbours,
  profile,
  onLamps,
}: {
  road: Road;
  junctions: Junction[];
  building: boolean;
  grid: DepthGrid;
  /** Everything built, including canals. */
  neighbours: Path[];
  /** Height profile: bridges and ramps. */
  profile: Profile;
  onLamps: LampReport;
}) {
  const layers = useMemo(() => {
    // A ramp's taper lies on the motorway: leave that part of the ramp out so the motorway
    // stays on top; on the motorway, the edge line turns into a broken line there.
    // Only the motorway a ramp is attached to counts (a weaving lane passing *under*
    // another motorway must not be cut out there).
    const attached = (ramp: Path, motorway: Path) =>
      [ramp.points[0], ramp.points[ramp.points.length - 1]].some((q) => distanceToPath(q, motorway) < 14);
    const against =
      road.kind === "ramp"
        ? neighbours.filter((n) => n.kind === "highway" && attached(road, n))
        : road.kind === "highway"
          ? neighbours.filter((n) => n.kind === "ramp" && attached(n, road))
          : [];
    const clip =
      against.length > 0
        ? // Ramp bands reach a little onto the motorway so no grass shows between them.
          (p: THREE.Vector3) =>
            occupant({ x: p.x, z: p.z }, against, { core: true, margin: road.kind === "ramp" ? -0.5 : 0 }) !== null
        : undefined;
    return buildRoadLayers(road.points, road.kind, junctions, profile, clip, road.id);
  }, [road, junctions, profile, neighbours]);

  const lamps = useMemo(() => {
    const frames = buildFrames(road.points, road.kind, profile);
    const { spacing, offset } = LAMP_LAYOUT[road.kind];
    const exclude = [road.id];
    const near = pathsNear(road.points, neighbours, 30);
    return [...lampSpots(frames, offset, spacing), ...lampSpots(frames, -offset, spacing)].filter(
      (s) =>
        junctions.every((j) => Math.hypot(s.position.x - j.x, s.position.z - j.z) > j.radius + 4) &&
        // Never inside a neighbouring road, track or canal.
        occupant({ x: s.position.x, z: s.position.z }, near, { exclude, margin: 0.5 }) === null,
    );
  }, [road, junctions, neighbours, profile]);

  // Lamps are drawn for all roads at once (StreetLamps in Roads).
  useEffect(() => {
    onLamps(road.id, building ? [] : lamps);
    return () => onLamps(road.id, []);
  }, [onLamps, road.id, lamps, building]);

  // Roads joining this one at a shared point (junctions): its railings open for them.
  const joining = useMemo(
    () =>
      neighbours.filter(
        (n) =>
          n.id !== road.id &&
          NETWORK_OF[n.kind] === "road" &&
          (n.points.some((q) => road.points.some((p) => Math.hypot(p.x - q.x, p.z - q.z) < 0.5)) ||
            // Ramps attached to this motorway (their taper lies on it) and, for a ramp, the
            // motorways it attaches to: railings and slopes open where they overlap.
            (road.kind === "highway" &&
              n.kind === "ramp" &&
              [n.points[0], n.points[n.points.length - 1]].some((q) => distanceToPath(q, road) < 14)) ||
            (road.kind === "ramp" &&
              n.kind === "highway" &&
              [road.points[0], road.points[road.points.length - 1]].some((q) => distanceToPath(q, n) < 14))),
      ),
    [neighbours, road],
  );

  const barriers = useMemo(
    () => buildRoadBarriers(road, grid, neighbours, junctions, profile),
    [road, grid, neighbours, junctions, profile],
  );
  useEffect(() => () => barriers?.dispose(), [barriers]);

  useEffect(() => {
    return () => {
      Object.values(layers).forEach((g) => g?.dispose());
    };
  }, [layers]);

  // While under construction the site animation renders the road and reveals it bit by bit.
  // Finished roads are static: their layers, barriers and structures are drawn in batches.
  return (
    <group userData={building ? undefined : BATCH_UNIT}>
      {building ? (
        <RoadConstruction road={road} layers={layers} profile={profile} />
      ) : (
        <>
          <LayerMeshes layers={layers} materials={ROAD_MATERIALS} />
          {barriers && <mesh geometry={barriers} material={BARRIER_MATERIAL} castShadow receiveShadow />}
        </>
      )}
      <Structure path={road} profile={profile} grid={grid} joining={joining} />
    </group>
  );
}

/** All roads and junction plazas. Roads that are still being built show the construction site. */
export function Roads() {
  const roads = useCity((s) => s.roads);
  const jobs = useCity((s) => s.jobs);

  const rails = useCity((s) => s.rails);
  const canals = useCity((s) => s.canals);
  const profiles = useProfiles();
  const neighbours = useMemo<Path[]>(() => [...roads, ...rails, ...canals], [roads, rails, canals]);
  const grid = useDepthGrid();
  const railCrossings = useRailRoadCrossings();

  const junctions = useMemo(() => findJunctions(roads), [roads]);
  // Level crossings cut curbs, sidewalks and markings like a junction, but get no plaza.
  const cuts = useMemo<Junction[]>(
    () => [
      ...junctions,
      ...railCrossings.map((c) => ({
        x: c.x,
        z: c.z,
        radius: crossingCutRadius(c),
        cut: true,
        // Only the strip of the track itself: sidewalks and markings run up to the plate.
        test: (x: number, z: number, extra: number) =>
          Math.hypot(x - c.x, z - c.z) < crossingCutRadius(c) + 2 &&
          distanceToPath({ x, z }, c.rail) < OUTER_HALF_WIDTH[c.rail.kind] + 0.2 + extra,
      })),
    ],
    [junctions, railCrossings],
  );
  // Plazas sit at the junction's height (junctions on ramps are lifted with the roads).
  const junctionGeometry = useMemo(() => {
    const lifted = junctions.map((j) => {
      let y = 0;
      for (const r of roads) {
        if (!r.points.some((p) => Math.hypot(p.x - j.x, p.z - j.z) < 1)) continue;
        y = Math.max(y, heightAtPoint(r, profileOf(profiles, r.id), j.x, j.z));
      }
      return { ...j, y };
    });
    return buildJunctionLayer(lifted);
  }, [junctions, roads, profiles]);

  useEffect(() => {
    return () => junctionGeometry?.dispose();
  }, [junctionGeometry]);

  // Street lamps of all roads, collected from the road views (batched: microtask after the reports).
  const lampMap = useRef(new Map<string, LampSpot[]>());
  const [lampSpotsAll, setLampSpotsAll] = useState<LampSpot[]>([]);
  const pending = useRef(false);
  const onLamps = useCallback<LampReport>((id, spots) => {
    if (spots.length === 0) lampMap.current.delete(id);
    else lampMap.current.set(id, spots);
    if (pending.current) return;
    pending.current = true;
    queueMicrotask(() => {
      pending.current = false;
      setLampSpotsAll([...lampMap.current.values()].flat());
    });
  }, []);

  const root = useRef<THREE.Group>(null);
  return (
    <group>
      <group ref={root}>
        {roads.map((road) => (
          <RoadView key={road.id} road={road} junctions={cuts} building={jobs.includes(road.id)} grid={grid} neighbours={neighbours} profile={profileOf(profiles, road.id)} onLamps={onLamps} />
        ))}
      </group>
      {/* All finished roads per material in one batch (StaticBatcher.tsx). */}
      <StaticBatches scene={root} version={roads} name="__roadBatcher" />
      <StreetLamps spots={lampSpotsAll} />
      {junctionGeometry && <mesh geometry={junctionGeometry} material={ROAD_MATERIALS.asphalt} receiveShadow />}
    </group>
  );
}
