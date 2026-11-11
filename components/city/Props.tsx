import { Excavator } from "./models/Excavator";
import { PlacedModel } from "./models/BakedModel";

/** Crane by J-Toastie (Poly Pizza, CC BY 3.0), see public/models/CREDITS.md. */
const CRANE_URL = "/models/vehicles/crane_jtoastie.glb";

/** Fixed construction-site props. */
export const PROPS = [
  { kind: "excavator", x: -58, z: 40, rotation: 2.4, clearance: 8 },
  { kind: "excavator", x: -52, z: 46, rotation: 0.9, clearance: 8 },
  { kind: "crane", x: -92, z: -68, rotation: 0, clearance: 12 },
] as const;

export function Props() {
  return (
    <group>
      {PROPS.map((p, i) =>
        p.kind === "crane" ? (
          <PlacedModel key={i} url={CRANE_URL} length={28} position={[p.x, 0, p.z]} rotationY={p.rotation} />
        ) : (
          <Excavator key={i} position={[p.x, 0, p.z]} rotation={[0, p.rotation, 0]} />
        ),
      )}
    </group>
  );
}
