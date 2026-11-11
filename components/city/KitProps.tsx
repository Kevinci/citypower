"use client";

import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";

/**
 * Single props from the Kenney City Kits (CC0, public/models/city/) placed inside building
 * models: shipping containers, rooftop solar panels. Kenney's props are "chunky", so each
 * one is scaled per axis to real sizes.
 */

const CONTAINERS = ["a", "b", "c"].map((k) => `/models/city/industrial/shipping-container-${k}.glb`);
const SOLAR = "/models/city/industrial/solar-panel-landscape-group.glb";
[...CONTAINERS, SOLAR].forEach((u) => useGLTF.preload(u));

/** A copy of a model's scene with shadows on (shared geometry and materials). */
function useKitScene(url: string) {
  const { scene } = useGLTF(url);
  return useMemo(() => {
    const copy = scene.clone(true);
    // The industrial kit stores a node scale (0.27); sizes here are set from the mesh bounds.
    copy.children.forEach((c) => c.scale.set(1, 1, 1));
    copy.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return copy;
  }, [scene]);
}

/** Kenney's container: 1.38 × 1.29 × 3.04 units, long side along z. */
const CONTAINER_SCALE: [number, number, number] = [2.4 / 1.38, 2.55 / 1.29, 6 / 3.04];

function Container({ url, x, y, z }: { url: string; x: number; y: number; z: number }) {
  const scene = useKitScene(url);
  // Long side along local x, like the stacks it replaces.
  return <primitive object={scene} position={[x, y, z]} rotation={[0, Math.PI / 2, 0]} scale={CONTAINER_SCALE} />;
}

/**
 * Stack of 20-ft containers: `rows` side by side (along z), `layers` high, a few gaps at the
 * top. 6 × 2.4 × 2.55 m each.
 */
export function KitContainers({ x, z, rows, layers, rot = 0 }: { x: number; z: number; rows: number; layers: number; rot?: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      {Array.from({ length: rows * layers }, (_, i) => {
        const r = i % rows;
        const l = Math.floor(i / rows);
        if (l > 0 && (r + l) % 3 === 0) return null;
        return <Container key={i} url={CONTAINERS[(r * 2 + l) % CONTAINERS.length]} x={0} y={l * 2.6} z={r * 2.6} />;
      })}
    </group>
  );
}

/** Group of six panels (1.52 × 0.9 units) scaled to 4.6 × 2.7 m. */
function SolarGroup({ x, y, z }: { x: number; y: number; z: number }) {
  const scene = useKitScene(SOLAR);
  return <primitive object={scene} position={[x, y, z]} scale={[3, 3, 3]} />;
}

/** Solar field on a flat roof: `cols` × `rows` panel groups centred on (x, z) at roof height y. */
export function RoofSolar({ x, y, z, cols, rows }: { x: number; y: number; z: number; cols: number; rows: number }) {
  return (
    <group position={[x, y, z]}>
      {Array.from({ length: cols * rows }, (_, i) => (
        <SolarGroup key={i} x={((i % cols) - (cols - 1) / 2) * 5.2} y={0} z={(Math.floor(i / cols) - (rows - 1) / 2) * 3.4} />
      ))}
    </group>
  );
}
