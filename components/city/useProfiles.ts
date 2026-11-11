import { useMemo } from "react";
import { computeProfiles, FLAT, type Profile } from "@/lib/city/grade";
import { useCity } from "@/lib/city/store";
import { buildFrames } from "@/lib/city/road-geometry";
import { sizeOf, type BuildingKind } from "@/lib/city/economy";
import { buildingGround } from "@/lib/city/placement";
import { cutTerrain, levelPads, type CutLine, type DepthGrid, type Pad } from "@/lib/city/terrain";
import { HALF_WIDTH, NETWORK_OF } from "@/lib/city/types";
import { useDepthGrid } from "./useWater";

/** Height profiles of all roads and tracks (bridges, ramps), recomputed when anything changes. */
export function useProfiles(): Map<string, Profile> {
  const roads = useCity((s) => s.roads);
  const rails = useCity((s) => s.rails);
  const separations = useCity((s) => s.separations);
  const grid = useDepthGrid();
  return useMemo(() => computeProfiles([...roads, ...rails], grid, separations), [roads, rails, grid, separations]);
}

export const profileOf = (profiles: Map<string, Profile>, id: string) => profiles.get(id) ?? FLAT;

/**
 * Buildings whose ground is not levelled: houses (many, and small enough to sit on a slope),
 * farms and sheep farms (fields follow the land) and mines (built into the mountain on purpose).
 */
const UNLEVELLED = new Set<BuildingKind>(["house", "farm", "sheepfarm", "coalmine", "ironmine", "uraniummine"]);

/** Terrain with cuttings along paths laid into slopes and levelled building plots (the ground mesh shows this). */
export function useShapedGrid(): DepthGrid {
  const roads = useCity((s) => s.roads);
  const rails = useCity((s) => s.rails);
  // Only buildings with a levelled plot matter here: a key so the grid (and the ground mesh)
  // is not rebuilt for every new house.
  const padKey = useCity((s) =>
    s.buildings
      .filter((b) => !UNLEVELLED.has(b.kind))
      .map((b) => `${b.kind},${b.x},${b.z},${b.rot},${b.level}`)
      .join("|"),
  );
  const grid = useDepthGrid();
  const profiles = useProfiles();
  const pads = useMemo((): Pad[] => {
    if (!padKey) return [];
    return padKey.split("|").map((k) => {
      const [kind, ...rest] = k.split(",");
      const [x, z, rot, level] = rest.map(Number);
      const b = { id: "", kind: kind as BuildingKind, x, z, rot, level, variant: 0 };
      const [w, d] = sizeOf(b);
      const airport = kind === "airport";
      // Same height as the model: mean ground of the plot (`buildingGround`). Airports clear
      // whole hills; other buildings only get a short embankment around their plot.
      return { x, z, rot, w, d, y: buildingGround(b, grid), reach: airport ? undefined : 14, margin: airport ? undefined : 0.5 };
    });
  }, [padKey, grid]);
  return useMemo(() => {
    const lines: CutLine[] = [];
    for (const path of [...roads, ...rails]) {
      const profile = profiles.get(path.id);
      if (!profile || profile.max === 0) continue;
      const frames = buildFrames(path.points, path.kind, profile);
      const isRail = NETWORK_OF[path.kind] === "rail";
      lines.push({
        points: frames.filter((_, i) => i % 2 === 0).map((f) => ({ x: f.p.x, z: f.p.z, y: f.p.y })),
        half: HALF_WIDTH[path.kind] + (isRail ? 0.8 : 1.5),
        tunnelCover: isRail ? 8.4 : 6.8,
      });
    }
    // Plots are levelled first; roads beside them then cut into the levelled ground.
    return cutTerrain(levelPads(grid, pads), lines);
  }, [roads, rails, grid, profiles, pads]);
}
