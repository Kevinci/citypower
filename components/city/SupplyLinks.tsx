import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GOOD_COLOUR, type Flow } from "@/lib/city/economy";
import { buildingGround } from "@/lib/city/placement";
import { useCity } from "@/lib/city/store";
import { useDepthGrid } from "./useWater";

/** Dots per link travelling from supplier to customer. */
const DOTS = 6;
const LIFT = 6;

interface Link {
  curve: THREE.QuadraticBezierCurve3;
  colour: THREE.Color;
  /** Line width grows with the delivered amount. */
  width: number;
}

/**
 * Supply chains in the world: an arc per delivery (supplier → customer) in the colour of
 * the good, with dots travelling along it. Shown for the selected building, or for all
 * buildings when `showSupply` is on.
 */
export function SupplyLinks() {
  const flows = useCity((s) => s.economy?.flows);
  const buildings = useCity((s) => s.buildings);
  const selected = useCity((s) => s.selected);
  const showAll = useCity((s) => s.showSupply);
  const grid = useDepthGrid();

  const links = useMemo<Link[]>(() => {
    if (!flows) return [];
    const shown: Flow[] = showAll ? flows : flows.filter((f) => f.from === selected || f.to === selected);
    const byId = new Map(buildings.map((b) => [b.id, b]));
    return shown
      .map((f) => {
        const a = byId.get(f.from);
        const b = byId.get(f.to);
        if (!a || !b) return null;
        const pa = new THREE.Vector3(a.x, buildingGround(a, grid) + LIFT, a.z);
        const pb = new THREE.Vector3(b.x, buildingGround(b, grid) + LIFT, b.z);
        const mid = pa.clone().lerp(pb, 0.5);
        mid.y += Math.max(12, pa.distanceTo(pb) * 0.25);
        return {
          curve: new THREE.QuadraticBezierCurve3(pa, mid, pb),
          colour: new THREE.Color(GOOD_COLOUR[f.good]),
          width: 0.35 + Math.min(1.2, f.amount / 10),
        };
      })
      .filter((l): l is Link => l !== null);
  }, [flows, buildings, selected, showAll, grid]);

  return (
    <group>
      {links.map((l, i) => (
        <Arc key={i} link={l} />
      ))}
    </group>
  );
}

function Arc({ link }: { link: Link }) {
  const tube = useMemo(() => new THREE.TubeGeometry(link.curve, 40, link.width * 0.35, 6, false), [link]);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ color: link.colour, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false }),
    [link],
  );
  const dotMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: link.colour, toneMapped: false }), [link]);
  useEffect(
    () => () => {
      tube.dispose();
      material.dispose();
      dotMaterial.dispose();
    },
    [tube, material, dotMaterial],
  );
  const dots = useRef<THREE.Group>(null);
  useFrame(({ clock }) => moveDots(dots.current, link.curve, clock.getElapsedTime()));
  return (
    <group>
      <mesh geometry={tube} material={material} renderOrder={3} />
      <group ref={dots}>
        {Array.from({ length: DOTS }, (_, i) => (
          <mesh key={i} material={dotMaterial} renderOrder={4}>
            <sphereGeometry args={[link.width * 0.9, 10, 8]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Spreads the dots along the curve and moves them towards the customer. */
function moveDots(group: THREE.Group | null, curve: THREE.Curve<THREE.Vector3>, t: number) {
  if (!group) return;
  const speed = 0.12;
  group.children.forEach((c, i) => {
    const u = (t * speed + i / group.children.length) % 1;
    curve.getPoint(u, c.position);
  });
}
