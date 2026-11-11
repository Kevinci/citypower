import { Instance, Instances } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { occupant } from "@/lib/city/adjacency";
import { heightAtPoint, liftAtPoint, LIFTED, overOf, type Profile } from "@/lib/city/grade";
import { RAIL_MATERIALS } from "@/lib/city/materials";
import { findCrossings, type Crossing } from "@/lib/city/network";
import { buildRailLayers, railLift, type LevelCrossing } from "@/lib/city/rail-geometry";
import { useCity } from "@/lib/city/store";
import type { DepthGrid } from "@/lib/city/terrain";
import { OUTER_HALF_WIDTH, type Path, type Rail, type Road } from "@/lib/city/types";
import { LayerMeshes } from "./LayerMeshes";
import { PathConstruction } from "./PathConstruction";
import { Structure } from "./Structure";
import { profileOf, useProfiles } from "./useProfiles";
import { useDepthGrid } from "./useWater";

const RAIL_SHADOW_KEYS = ["sleeper", "rail", "mast"] as const;

/** Road–rail crossings with the data both sides need. */
export interface RailRoadCrossing extends Crossing {
  road: Road;
  rail: Rail;
}

/** Level crossings: road–rail crossings at grade. Grade-separated pairs are bridges instead. */
export function useRailRoadCrossings(): RailRoadCrossing[] {
  const roads = useCity((s) => s.roads);
  const rails = useCity((s) => s.rails);
  const separations = useCity((s) => s.separations);
  const profiles = useProfiles();
  const grid = useDepthGrid();
  return useMemo(() => {
    const byId = new Map<string, Road | Rail>([...roads, ...rails].map((p) => [p.id, p]));
    return findCrossings(rails, roads)
      .map((c) => ({ ...c, rail: byId.get(c.a) as Rail, road: byId.get(c.b) as Road }))
      .filter(
        (c) =>
          overOf(c.rail, c.road, separations) === null &&
          // Lifted at this point (ramp, viaduct): it is a bridge, not a level crossing.
          liftAtPoint(c.rail, profileOf(profiles, c.rail.id), c.x, c.z, grid) < LIFTED &&
          liftAtPoint(c.road, profileOf(profiles, c.road.id), c.x, c.z, grid) < LIFTED,
      );
  }, [roads, rails, separations, profiles, grid]);
}

/** Length of track on each side of a crossing that the road surface covers. */
export const crossingHalfLength = (c: RailRoadCrossing) => OUTER_HALF_WIDTH[c.road.kind] / c.sin;

/** Radius around a crossing in which the road drops curbs, sidewalks and markings. */
export const crossingCutRadius = (c: RailRoadCrossing) =>
  Math.hypot(OUTER_HALF_WIDTH[c.road.kind], OUTER_HALF_WIDTH[c.rail.kind] / c.sin + 1.5);

function RailView({
  rail,
  crossings,
  building,
  grid,
  neighbours,
  profile,
}: {
  rail: Rail;
  crossings: LevelCrossing[];
  building: boolean;
  grid: DepthGrid;
  neighbours: Path[];
  profile: Profile;
}) {
  const layers = useMemo(() => {
    const exclude = [rail.id];
    // Masts and ballast flanks must not end up inside a neighbouring road, track or canal.
    const blocked = (x: number, z: number) => occupant({ x, z }, neighbours, { exclude, margin: 0.2 }) !== null;
    return buildRailLayers(rail.points, rail.kind, crossings, railLift(rail.id), blocked, profile);
  }, [rail, crossings, neighbours, profile]);
  useEffect(() => () => Object.values(layers).forEach((g) => g?.dispose()), [layers]);

  return (
    <group>
      {building ? (
        <PathConstruction
          path={rail}
          layers={layers}
          materials={RAIL_MATERIALS}
          shadowKeys={RAIL_SHADOW_KEYS}
          profile={profile}
        />
      ) : (
        <LayerMeshes layers={layers} materials={RAIL_MATERIALS} shadowKeys={RAIL_SHADOW_KEYS} />
      )}
      <Structure path={rail} profile={profile} grid={grid} />
    </group>
  );
}

/**
 * St. Andrew's cross signs (Andreaskreuz) at every level crossing: one on the right-hand
 * side of the road before the track, for both driving directions.
 */
function CrossingSigns({
  crossings,
  neighbours,
  profiles,
}: {
  crossings: RailRoadCrossing[];
  neighbours: Path[];
  profiles: Map<string, Profile>;
}) {
  const signs = useMemo(() => {
    const out: { x: number; y: number; z: number; rot: number }[] = [];
    for (const c of crossings) {
      const along = OUTER_HALF_WIDTH[c.rail.kind] / c.sin + 2.5;
      // Behind the sidewalk edge, on the right of each approach.
      const side = OUTER_HALF_WIDTH[c.road.kind] + 0.7;
      for (const dir of [-1, 1]) {
        // Road direction towards the crossing for this approach, and its right-hand normal.
        const tx = c.dirB.x * dir;
        const tz = c.dirB.z * dir;
        const rx = -tz;
        const rz = tx;
        const x = c.x - tx * along + rx * side;
        const z = c.z - tz * along + rz * side;
        // Skip signs that would stand on another road, track or in a canal.
        if (occupant({ x, z }, neighbours, { exclude: [c.road.id], margin: 0.4 }) !== null) continue;
        out.push({ x, y: heightAtPoint(c.road, profileOf(profiles, c.road.id), c.x, c.z), z, rot: Math.atan2(tx, tz) });
      }
    }
    return out;
  }, [crossings, neighbours, profiles]);

  if (signs.length === 0) return null;
  return (
    <>
      <Instances limit={signs.length} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 2.6, 8]} />
        <meshStandardMaterial color="#d8d8d8" roughness={0.4} metalness={0.6} />
        {signs.map((s, i) => (
          <Instance key={i} position={[s.x, s.y + 1.3, s.z]} />
        ))}
      </Instances>
      {[Math.PI / 4, -Math.PI / 4].map((tilt) => (
        <Instances key={tilt} limit={signs.length} castShadow>
          <boxGeometry args={[1.25, 0.16, 0.03]} />
          <meshStandardMaterial color="#d1242a" roughness={0.5} />
          {signs.map((s, i) => (
            <Instance key={i} position={[s.x, s.y + 2.45, s.z]} rotation={[0, s.rot, tilt]} />
          ))}
        </Instances>
      ))}
    </>
  );
}

/** All tracks, level crossings and rail bridges. */
export function Rails() {
  const rails = useCity((s) => s.rails);
  const jobs = useCity((s) => s.jobs);
  const roads = useCity((s) => s.roads);
  const crossings = useRailRoadCrossings();
  const grid = useDepthGrid();
  const canals = useCity((s) => s.canals);
  const profiles = useProfiles();
  const neighbours = useMemo<Path[]>(() => [...roads, ...rails, ...canals], [roads, rails, canals]);

  const byRail = useMemo(() => {
    const map = new Map<string, LevelCrossing[]>();
    for (const c of crossings) {
      const list = map.get(c.rail.id) ?? [];
      list.push({ x: c.x, z: c.z, halfLength: crossingHalfLength(c) });
      map.set(c.rail.id, list);
    }
    return map;
  }, [crossings]);

  return (
    <group>
      {rails.map((rail) => (
        <RailView
          key={rail.id}
          rail={rail}
          crossings={byRail.get(rail.id) ?? NO_CROSSINGS}
          building={jobs.includes(rail.id)}
          grid={grid}
          neighbours={neighbours}
          profile={profileOf(profiles, rail.id)}
        />
      ))}
      <CrossingSigns crossings={crossings} neighbours={neighbours} profiles={profiles} />
    </group>
  );
}

const NO_CROSSINGS: LevelCrossing[] = [];
