import { useMemo } from "react";
import * as THREE from "three";
import { JOBCENTRE_RADIUS, RECREATION_RADIUS, SERVICE_RADIUS, type BuildingKind } from "@/lib/city/economy";
import { buildingGround } from "@/lib/city/placement";
import { useCity } from "@/lib/city/store";
import { useShapedGrid } from "./useProfiles";

/**
 * Area of the selected job centre (orange: residents there are placed anywhere in the road
 * network), park (green) or playground (yellow, residents within walk there): a disc with a
 * solid rim, drawn over everything like a map marking.
 */
const AREAS: Partial<Record<BuildingKind, { radius: number[]; fill: THREE.Material; rim: THREE.Material }>> = {
  jobcenter: { radius: JOBCENTRE_RADIUS, ...materials("#f39c12", "#e67e22") },
  park: { radius: RECREATION_RADIUS.park!, ...materials("#5fbf4a", "#2e8b3a") },
  playground: { radius: RECREATION_RADIUS.playground!, ...materials("#f4d03f", "#d4ac0d") },
  police: { radius: SERVICE_RADIUS.police!, ...materials("#3d8fd6", "#1f4e8c") },
  firestation: { radius: SERVICE_RADIUS.firestation!, ...materials("#e8604f", "#b4221c") },
};

function materials(fill: string, rim: string) {
  return {
    fill: new THREE.MeshBasicMaterial({ color: fill, transparent: true, opacity: 0.12, depthTest: false, side: THREE.DoubleSide }),
    rim: new THREE.MeshBasicMaterial({ color: rim, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }),
  };
}

export function JobCentreArea() {
  const selected = useCity((s) => s.buildings.find((b) => b.id === s.selected && !!AREAS[b.kind]));
  const grid = useShapedGrid();
  const y = useMemo(() => (selected ? buildingGround(selected, grid) + 0.6 : 0), [selected, grid]);
  if (!selected) return null;
  const area = AREAS[selected.kind]!;
  const r = area.radius[selected.level];
  return (
    <group position={[selected.x, y, selected.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh material={area.fill} renderOrder={8}>
        <circleGeometry args={[r, 96]} />
      </mesh>
      <mesh material={area.rim} renderOrder={9}>
        <ringGeometry args={[r - 1.5, r, 96]} />
      </mesh>
    </group>
  );
}
