import { useGLTF } from "@react-three/drei";
import type { ThreeElements } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export interface BakedPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export interface BakedModel {
  parts: BakedPart[];
  /** Model size before baking, in the file's own units. */
  originalSize: THREE.Vector3;
}

/**
 * "height": normalise so the Y extent is 1 unit (trees, props).
 * "longest": normalise so the largest extent is 1 unit (vehicles, whose length is not along Y).
 */
export type NormaliseMode = "height" | "longest";

/**
 * Bakes every mesh of a glTF scene into one set of world-space geometries, normalised so
 * the base sits on y = 0 and the centre on x = z = 0. Instances then only need a uniform
 * scale to set their real size in metres.
 */
export function bakeModel(scene: THREE.Object3D, mode: NormaliseMode = "height"): BakedModel {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const height = (mode === "height" ? size.y : Math.max(size.x, size.y, size.z)) || 1;

  const toCentre = new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z);
  const toUnit = new THREE.Matrix4().makeScale(1 / height, 1 / height, 1 / height);
  const normalise = toUnit.multiply(toCentre);

  const parts: BakedPart[] = [];
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const geometry = obj.geometry.clone().applyMatrix4(obj.matrixWorld).applyMatrix4(normalise);
    const material = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    parts.push({ geometry, material });
  });

  return { parts, originalSize: size };
}

/** Loads a glTF file and returns its baked, normalised parts. */
export function useBakedModel(url: string, mode: NormaliseMode = "height"): BakedModel {
  const gltf = useGLTF(url);
  return useMemo(() => bakeModel(gltf.scene, mode), [gltf.scene, mode]);
}

/**
 * One glTF model as many instances. Each matrix places one copy in the world.
 * Matrices should include the desired real-world height as their scale.
 */
export function InstancedModel({ url, matrices }: { url: string; matrices: THREE.Matrix4[] }) {
  const { parts } = useBakedModel(url);
  return (
    <>
      {parts.map((part, i) => (
        <InstancedPart key={i} geometry={part.geometry} material={part.material} matrices={matrices} />
      ))}
    </>
  );
}

function InstancedPart({
  geometry,
  material,
  matrices,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrices: THREE.Matrix4[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
  }, [matrices]);

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, Math.max(1, matrices.length)]}
      count={matrices.length}
      castShadow
      receiveShadow
      frustumCulled={false}
    />
  );
}

/**
 * A single model with its own transform. `length` is the real size in metres along the
 * model's longest axis, `rotationY` turns it so its nose points along +z.
 */
export function PlacedModel({
  url,
  length,
  rotationY = 0,
  ...group
}: ThreeElements["group"] & { url: string; length: number; rotationY?: number }) {
  const { parts } = useBakedModel(url, "longest");
  return (
    <group {...group} rotation={[0, rotationY, 0]} scale={length}>
      {parts.map((part, i) => (
        <mesh key={i} geometry={part.geometry} material={part.material} castShadow receiveShadow />
      ))}
    </group>
  );
}
