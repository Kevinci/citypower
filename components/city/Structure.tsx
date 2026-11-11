import { useEffect, useMemo } from "react";
import { buildStructure } from "@/lib/city/bridge-geometry";
import type { Profile } from "@/lib/city/grade";
import { EMBANKMENT_MATERIAL, STEEL_MATERIALS, STRUCTURE_CONCRETE } from "@/lib/city/materials";
import type { DepthGrid } from "@/lib/city/terrain";
import * as THREE from "three";
import { occupant } from "@/lib/city/adjacency";
import { NETWORK_OF, type Path } from "@/lib/city/types";

const NONE: Path[] = [];
/** Dark inside of a tunnel mouth. */
const TUNNEL_MOUTH = new THREE.MeshBasicMaterial({ color: "#0c0d0f", side: THREE.DoubleSide });

/** Bridges, ramps and embankments under a lifted road or track. */
export function Structure({
  path,
  profile,
  grid,
  joining = NONE,
}: {
  path: Path;
  profile: Profile;
  grid: DepthGrid;
  /** Paths that join this one at grade: railings open for them. */
  joining?: Path[];
}) {
  const layers = useMemo(() => {
    const open =
      joining.length > 0
        ? // Motorways count with their full width (ramp tapers lie on them), others with sidewalks.
          (p: THREE.Vector3) =>
            occupant({ x: p.x, z: p.z }, joining, { margin: path.kind === "ramp" ? 1 : 0.3 }) !== null
        : undefined;
    return buildStructure(path, profile, grid, open);
  }, [path, profile, grid, joining]);
  useEffect(() => () => Object.values(layers).forEach((g) => g?.dispose()), [layers]);
  const steel = NETWORK_OF[path.kind] === "rail" ? STEEL_MATERIALS.rail : STEEL_MATERIALS.road;
  return (
    <group>
      {layers.concrete && <mesh geometry={layers.concrete} material={STRUCTURE_CONCRETE} castShadow receiveShadow />}
      {layers.steel && <mesh geometry={layers.steel} material={steel} castShadow receiveShadow />}
      {layers.embankment && <mesh geometry={layers.embankment} material={EMBANKMENT_MATERIAL} receiveShadow />}
      {layers.tunnel && <mesh geometry={layers.tunnel} material={TUNNEL_MOUTH} />}
    </group>
  );
}
