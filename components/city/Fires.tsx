"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Incident } from "@/lib/city/incidents";
import { buildingGround } from "@/lib/city/placement";
import { useCity } from "@/lib/city/store";
import { useDepthGrid } from "./useWater";

/**
 * House fires: flickering flames on the roof and a column of smoke, for every open fire
 * incident. Once the fire engine is at the scene the flames die down and the smoke turns
 * to steam until the incident is resolved.
 */

/** Height of the flames above the ground per house level (roughly the roof line). */
const ROOF_HEIGHT = [0, 4.5, 7.5, 12.5, 23, 40, 68, 112];
const FLAMES = 6;
const PUFFS = 5;

const FLAME_GEOMETRY = new THREE.ConeGeometry(0.7, 2.6, 7);
FLAME_GEOMETRY.translate(0, 1.3, 0);
const FLAME_MATERIAL = new THREE.MeshBasicMaterial({
  color: new THREE.Color(3.2, 1.1, 0.15),
  toneMapped: false,
  transparent: true,
  opacity: 0.85,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const CORE_MATERIAL = new THREE.MeshBasicMaterial({
  color: new THREE.Color(4, 2.6, 0.6),
  toneMapped: false,
  transparent: true,
  opacity: 0.9,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const SMOKE_GEOMETRY = new THREE.IcosahedronGeometry(1, 1);
const SMOKE_MATERIAL = new THREE.MeshStandardMaterial({ color: "#3a3a3c", roughness: 1, transparent: true, opacity: 0.55, depthWrite: false });
const STEAM_MATERIAL = new THREE.MeshStandardMaterial({ color: "#d8d8d8", roughness: 1, transparent: true, opacity: 0.4, depthWrite: false });

/** Per-frame flicker and smoke drift (outside the component for the React compiler). */
function animateFire(group: THREE.Group, t: number, heat: number) {
  const flames = group.children[0] as THREE.Group;
  const smoke = group.children[1] as THREE.Group;
  flames.children.forEach((f, i) => {
    const n = 0.75 + 0.35 * Math.sin(t * 11 + i * 1.7) * Math.cos(t * 7.3 + i);
    f.scale.set(n * heat, (0.8 + 0.5 * Math.abs(Math.sin(t * 9 + i * 2.1))) * heat, n * heat);
    f.rotation.y = t * 2 + i;
    f.visible = heat > 0.05;
  });
  smoke.children.forEach((p, i) => {
    const mesh = p as THREE.Mesh;
    const phase = ((t * 0.35 + i / PUFFS) % 1 + 1) % 1;
    const rise = phase * 14;
    p.position.set(Math.sin(i * 2.4 + t * 0.5) * (0.4 + phase * 1.5) + phase * 2, 1.5 + rise, Math.cos(i * 1.9 + t * 0.4) * (0.4 + phase * 1.5));
    const s = 0.7 + phase * 2.2 * (0.5 + 0.5 * heat);
    p.scale.set(s, s * 0.8, s);
    mesh.material = heat > 0.5 ? SMOKE_MATERIAL : STEAM_MATERIAL;
    p.visible = phase < 0.92;
  });
}

function Fire({ incident }: { incident: Incident }) {
  const house = useCity((s) => s.buildings.find((b) => b.id === incident.building));
  const grid = useDepthGrid();
  const y = useMemo(() => (house ? buildingGround(house, grid) + ROOF_HEIGHT[Math.min(house.level, ROOF_HEIGHT.length - 1)] : 0), [house, grid]);
  const group = useRef<THREE.Group>(null);
  const heat = useRef(1);
  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    // Being put out: the flames shrink over ~25 s.
    const target = incident.onSite ? 0 : 1;
    heat.current += (target - heat.current) * Math.min(1, dt / 8);
    animateFire(g, state.clock.elapsedTime, heat.current);
  });
  if (!house) return null;
  const spread = Math.min(4, 1.5 + house.level);
  return (
    <group ref={group} position={[house.x, y, house.z]}>
      <group>
        {Array.from({ length: FLAMES }, (_, i) => {
          const a = (i / FLAMES) * Math.PI * 2;
          return (
            <group key={i} position={[Math.cos(a) * spread * 0.6, -0.5, Math.sin(a) * spread * 0.6]}>
              <mesh geometry={FLAME_GEOMETRY} material={FLAME_MATERIAL} />
              <mesh geometry={FLAME_GEOMETRY} material={CORE_MATERIAL} scale={[0.5, 0.6, 0.5]} />
            </group>
          );
        })}
      </group>
      <group>
        {Array.from({ length: PUFFS }, (_, i) => (
          <mesh key={i} geometry={SMOKE_GEOMETRY} material={SMOKE_MATERIAL} />
        ))}
      </group>
    </group>
  );
}

export function Fires() {
  const fires = useCity((s) => s.incidents);
  const list = fires.filter((i) => i.kind === "fire");
  if (list.length === 0) return null;
  return (
    <group>
      {list.map((i) => (
        <Fire key={i.id} incident={i} />
      ))}
    </group>
  );
}
