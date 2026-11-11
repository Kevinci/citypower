import { useEffect, useMemo } from "react";
import type * as THREE from "three";
import { occupant } from "@/lib/city/adjacency";
import { WATER_MATERIALS } from "@/lib/city/materials";
import { distanceToPath, findCrossings, type Crossing } from "@/lib/city/network";
import { useCity } from "@/lib/city/store";
import { naturalDepthGrid, sampleDepth } from "@/lib/city/terrain";
import { HALF_WIDTH, type Canal, type Path } from "@/lib/city/types";
import { buildCanalLayers } from "@/lib/city/water-geometry";
import { LayerMeshes } from "./LayerMeshes";
import { PathConstruction } from "./PathConstruction";

const NO_SHADOWS: readonly string[] = [];

/**
 * Which bank pieces to leave out.
 *  - Walls and cap stones: only inside other canals (junctions) and where the canal opens
 *    into natural water. Roads and tracks crossing the canal are bridges high above it, so
 *    quay and towpath continue underneath.
 *  - Towpath: additionally wherever a road or track runs on it at ground level (ending at
 *    or running along the canal), so it sits flush against the quay.
 */
function bankSkips(canal: Canal, canals: Canal[], crossers: Path[], crossings: Crossing[]) {
  const natural = naturalDepthGrid();
  const bridging = new Set(crossings.filter((c) => c.a === canal.id).map((c) => c.b));
  const alongside = crossers.filter((c) => !bridging.has(c.id));

  const wall = (p: THREE.Vector3) => {
    const q = { x: p.x, z: p.z };
    if (sampleDepth(natural, p.x, p.z) > 0.6) return true;
    for (const o of canals) {
      if (o.id !== canal.id && distanceToPath(q, o) < HALF_WIDTH[o.kind] - 0.2) return true;
    }
    return false;
  };
  const towpath = (p: THREE.Vector3) =>
    wall(p) || occupant({ x: p.x, z: p.z }, alongside, { margin: 0.2 }) !== null;
  return { wall, towpath };
}

function CanalView({
  canal,
  canals,
  crossers,
  crossings,
  building,
}: {
  canal: Canal;
  canals: Canal[];
  crossers: Path[];
  crossings: Crossing[];
  building: boolean;
}) {
  const layers = useMemo(() => {
    const skip = bankSkips(canal, canals, crossers, crossings);
    return buildCanalLayers(canal.points, canal.kind, skip.wall, skip.towpath);
  }, [canal, canals, crossers, crossings]);
  useEffect(() => () => Object.values(layers).forEach((g) => g?.dispose()), [layers]);

  if (building) return <PathConstruction path={canal} layers={layers} materials={WATER_MATERIALS} shadowKeys={NO_SHADOWS} />;
  return <LayerMeshes layers={layers} materials={WATER_MATERIALS} shadowKeys={NO_SHADOWS} />;
}

/** All built canals. Water and the dug-out bed come from the terrain depth grid. */
export function Canals() {
  const canals = useCity((s) => s.canals);
  const roads = useCity((s) => s.roads);
  const rails = useCity((s) => s.rails);
  const jobs = useCity((s) => s.jobs);
  const crossers = useMemo<Path[]>(() => [...roads, ...rails], [roads, rails]);
  const crossings = useMemo(() => findCrossings(canals, crossers), [canals, crossers]);

  return (
    <group>
      {canals.map((c) => (
        <CanalView
          key={c.id}
          canal={c}
          canals={canals}
          crossers={crossers}
          crossings={crossings}
          building={jobs.includes(c.id)}
        />
      ))}
    </group>
  );
}
