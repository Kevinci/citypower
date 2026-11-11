import type { ThreeElements } from "@react-three/fiber";
import { PlacedModel } from "./BakedModel";

/** Dump truck by jeremy (Poly Pizza, CC BY 3.0), see public/models/CREDITS.md. */
const DUMP_TRUCK_URL = "/models/vehicles/dump_truck_jeremy.glb";
/** Real length of the truck in metres. */
export const DUMP_TRUCK_LENGTH = 6.5;

/** Dump truck, origin at ground level. */
export function DumpTruck(props: ThreeElements["group"]) {
  return <PlacedModel url={DUMP_TRUCK_URL} length={DUMP_TRUCK_LENGTH} {...props} />;
}
