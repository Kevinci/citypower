import type { Building } from "./economy";
import { connectRoads } from "./network";
import { mulberry32 } from "./random";
import { OUTER_HALF_WIDTH, type Road } from "./types";

/**
 * Starting village in the flat centre of every world: a main street and a cross street
 * with a junction, houses along both, a church and a small well (Brunnen, waterworks
 * level 1) as the first water supply. Layout varies a little with the seed.
 */
export function generateVillage(seed: number): { roads: Road[]; buildings: Building[] } {
  const rnd = mulberry32(seed * 31 + 5);
  const main: Road = { id: "village-main", kind: "street", points: [{ x: -150, z: 0 }, { x: 150, z: 0 }] };
  const cross: Road = { id: "village-cross", kind: "street", points: [{ x: 0, z: -110 }, { x: 0, z: 110 }] };
  const { roads, created } = connectRoads([main], cross);
  const allRoads = created ? [...roads, created] : roads;

  const buildings: Building[] = [];
  let n = 0;
  const add = (b: Omit<Building, "id">) => buildings.push({ ...b, id: `village-${n++}` });
  const setback = OUTER_HALF_WIDTH.street + 1.5;

  // Church on the north side of the main street, well on the south side.
  const churchX = 46 + Math.floor(rnd() * 3) * 20;
  add({ kind: "church", x: churchX, z: -(setback + 12), rot: Math.PI, level: 1, variant: 0 });
  const wellX = -(46 + Math.floor(rnd() * 3) * 20);
  add({ kind: "waterworks", x: wellX, z: setback + 9, rot: 0, level: 1, variant: 0 });

  const free = (x: number, z: number) =>
    buildings.every((b) => Math.abs(b.x - x) > 14 || Math.abs(b.z - z) > (b.kind === "church" ? 18 : 12));
  const houseZ = setback + 4;
  // Houses along the main street (front to the street on both sides).
  for (const x of [-130, -110, -90, -70, -50, -30, 30, 50, 70, 90, 110, 130]) {
    for (const side of [-1, 1]) {
      if (rnd() < 0.18) continue;
      const z = side * houseZ;
      if (!free(x, z)) continue;
      add({ kind: "house", x, z, rot: side < 0 ? Math.PI : 0, level: Math.abs(x) < 60 ? 2 : 1, variant: Math.floor(rnd() * 6) });
    }
  }
  // Houses along the cross street.
  for (const z of [-92, -72, -52, -32, 32, 52, 72, 92]) {
    for (const side of [-1, 1]) {
      if (rnd() < 0.25) continue;
      const x = side * houseZ;
      if (!free(x, z)) continue;
      add({ kind: "house", x, z, rot: side < 0 ? -Math.PI / 2 : Math.PI / 2, level: Math.abs(z) < 50 ? 2 : 1, variant: Math.floor(rnd() * 6) });
    }
  }
  return { roads: allRoads, buildings };
}
