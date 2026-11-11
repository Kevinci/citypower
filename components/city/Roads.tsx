import { Instance, Instances } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import type * as THREE from "three";
import { occupant } from "@/lib/city/adjacency";
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

function StreetLamps({ spots }: { spots: LampSpot[] }) {
  // City Pack style: matte light blue-grey posts like the lamps of Kenney's road tiles.
  const pack = useCity((st) => st.houseStyle) === "pack";
  if (spots.length === 0) return null;
  return (
    <>
      <Instances limit={spots.length} castShadow>
        <cylinderGeometry args={[0.08, 0.11, 6.5, 8]} />
        <meshStandardMaterial color={pack ? "#b6bfe5" : "#c9ced6"} roughness={pack ? 0.7 : 0.35} metalness={pack ? 0.1 : 0.7} />
        {spots.map((s, i) => (
          <Instance key={i} position={[s.position.x, s.position.y + 3.25, s.position.z]} />
        ))}
      </Instances>
      <Instances limit={spots.length}>
        <boxGeometry args={[0.35, 0.14, 0.7]} />
        <meshStandardMaterial color="#fff7e6" emissive="#ffd48a" emissiveIntensity={1.6} toneMapped={false} />
        {spots.map((s, i) => (
          <Instance
            key={i}
            position={[s.position.x + s.inward.x * 0.45, s.position.y + 6.45, s.position.z + s.inward.z * 0.45]}
            rotation={[0, Math.atan2(s.inward.x, s.inward.z), 0]}
          />
        ))}
      </Instances>
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
}: {
  road: Road;
  junctions: Junction[];
  building: boolean;
  grid: DepthGrid;
  /** Everything built, including canals. */
  neighbours: Path[];
  /** Height profile: bridges and ramps. */
  profile: Profile;
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
    return [...lampSpots(frames, offset, spacing), ...lampSpots(frames, -offset, spacing)].filter(
      (s) =>
        junctions.every((j) => Math.hypot(s.position.x - j.x, s.position.z - j.z) > j.radius + 4) &&
        // Never inside a neighbouring road, track or canal.
        occupant({ x: s.position.x, z: s.position.z }, neighbours, { exclude, margin: 0.5 }) === null,
    );
  }, [road, junctions, neighbours, profile]);

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
  return (
    <group>
      {building ? (
        <RoadConstruction road={road} layers={layers} profile={profile} />
      ) : (
        <>
          <LayerMeshes layers={layers} materials={ROAD_MATERIALS} />
          <StreetLamps spots={lamps} />
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

  return (
    <group>
      {roads.map((road) => (
        <RoadView key={road.id} road={road} junctions={cuts} building={jobs.includes(road.id)} grid={grid} neighbours={neighbours} profile={profileOf(profiles, road.id)} />
      ))}
      {junctionGeometry && <mesh geometry={junctionGeometry} material={ROAD_MATERIALS.asphalt} receiveShadow />}
    </group>
  );
}
