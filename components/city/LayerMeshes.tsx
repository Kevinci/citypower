import type * as THREE from "three";

/** Layer keys that cast shadows by default (raised parts of roads). */
const DEFAULT_SHADOW_KEYS = ["curb", "median"];

/**
 * Renders one geometry layer per surface material.
 * `shadows` should be off while a path is only partly revealed: shadow maps ignore the
 * reveal clipping and would show shadows of parts that are not visible yet.
 */
export function LayerMeshes<K extends string>({
  layers,
  materials,
  shadows = true,
  shadowKeys = DEFAULT_SHADOW_KEYS,
}: {
  layers: Partial<Record<K, THREE.BufferGeometry>>;
  materials: Record<K, THREE.Material>;
  shadows?: boolean;
  shadowKeys?: readonly string[];
}) {
  return (
    <>
      {(Object.keys(layers) as K[]).map((key) => (
        <mesh
          key={key}
          geometry={layers[key]}
          material={materials[key]}
          receiveShadow
          castShadow={shadows && shadowKeys.includes(key)}
        />
      ))}
    </>
  );
}
