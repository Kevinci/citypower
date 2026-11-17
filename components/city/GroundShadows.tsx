import { useEffect, useMemo, type RefObject } from "react";
import * as THREE from "three";
import { hiddenByBatcher, unitSignature } from "./StaticBatcher";

/**
 * Contact shadows ("ambient occlusion" at the foot of buildings): a soft dark rim on the
 * ground around every building part that stands on it. Cheap replacement for SSAO – one
 * instanced, transparent quad per part, all in a single draw call.
 *
 * Parts are found automatically: every shadow-casting mesh below a group marked with
 * `userData.base` (a building at its ground height) whose bottom is on the ground, plus all
 * instances of instanced meshes marked with `userData.contact` (house walls).
 */

const CAPACITY = 6000;
/** Parts lower than this (slabs, yards, fields) get no contact shadow. */
const MIN_HEIGHT = 1.8;
/** Bottom of a part at most this far above the building base counts as "on the ground". */
const GROUND_TOLERANCE = 0.3;
/** Biggest footprint (m²): bigger boxes are fences or areas, not buildings. */
const MAX_AREA = 2500;
const OPACITY = 0.5;

const instance = new THREE.Matrix4();
const world = new THREE.Matrix4();
const c0 = new THREE.Vector3();
const cx = new THREE.Vector3();
const cz = new THREE.Vector3();
const top = new THREE.Vector3();
const out = new THREE.Matrix4();
const pos = new THREE.Vector3();
const scale = new THREE.Vector3();
const quat = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function makeMaterial() {
  const m = new THREE.MeshBasicMaterial({
    color: "#0b0f08",
    transparent: true,
    opacity: OPACITY,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float aMargin;\nvarying vec2 vQ;\nvarying vec2 vHalf;\nvarying float vMargin;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
        transformed.xz += sign(position.xz) * aMargin / size;
        vQ = transformed.xz * size;
        vHalf = size * 0.5;
        vMargin = aMargin;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vQ;\nvarying vec2 vHalf;\nvarying float vMargin;")
      .replace(
        "#include <alphatest_fragment>",
        `float edge = length(max(abs(vQ) - (vHalf - 0.4), 0.0));
        float k = 1.0 - clamp(edge / (vMargin + 0.4), 0.0, 1.0);
        diffuseColor.a *= pow(k, 1.7);
        #include <alphatest_fragment>`,
      );
  };
  m.customProgramCacheKey = () => "ground-shadows";
  return m;
}

/** Adds one shadow for a part with local bounding box `box` and world matrix `m` (base at `baseY`). */
function addPart(mesh: THREE.InstancedMesh, margins: Float32Array, n: number, box: THREE.Box3, m: THREE.Matrix4, baseY: number) {
  c0.set(box.min.x, box.min.y, box.min.z).applyMatrix4(m);
  cx.set(box.max.x, box.min.y, box.min.z).applyMatrix4(m);
  cz.set(box.min.x, box.min.y, box.max.z).applyMatrix4(m);
  top.set(box.min.x, box.max.y, box.min.z).applyMatrix4(m);
  const height = top.y - c0.y;
  if (height < MIN_HEIGHT || c0.y - baseY > GROUND_TOLERANCE) return n;
  const sx = Math.hypot(cx.x - c0.x, cx.z - c0.z);
  const sz = Math.hypot(cz.x - c0.x, cz.z - c0.z);
  if (sx < 0.8 || sz < 0.8 || sx * sz > MAX_AREA) return n;
  pos.set((cx.x + cz.x) / 2, baseY + 0.05, (cx.z + cz.z) / 2);
  quat.setFromAxisAngle(UP, -Math.atan2(cx.z - c0.z, cx.x - c0.x));
  mesh.setMatrixAt(n, out.compose(pos, quat, scale.set(sx, 1, sz)));
  margins[n] = THREE.MathUtils.clamp(height * 0.5, 2.2, 7);
  return n + 1;
}

/** Shadows of one building, kept while the building's batch signature stays the same. */
const unitCache = new WeakMap<THREE.Object3D, { signature: number; matrices: Float32Array; margins: Float32Array }>();
const scratch = new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), 256);
const scratchMargins = new Float32Array(256);

/** The static, shadow-casting parts of one building (`userData.base` group). */
function collectUnit(unit: THREE.Object3D) {
  const baseY = unit.getWorldPosition(pos).y;
  let n = 0;
  const walk = (o: THREE.Object3D) => {
    for (const c of o.children) {
      if (n >= 256) return;
      const m = c as THREE.Mesh;
      // Batched parts are hidden (StaticBatcher draws them) but still cast contact shadows.
      if (m.isMesh && (c.visible || c.userData.batched) && m.castShadow && !(m as THREE.InstancedMesh).isInstancedMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh) {
        const material = m.material as THREE.Material;
        if (material && !material.transparent) {
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          n = addPart(scratch, scratchMargins, n, m.geometry.boundingBox!, m.matrixWorld, baseY);
        }
      }
      if (c.visible || hiddenByBatcher(c)) walk(c);
    }
  };
  walk(unit);
  return { matrices: (scratch.instanceMatrix.array as Float32Array).slice(0, n * 16), margins: scratchMargins.slice(0, n) };
}

/** Collects the contact shadows of all buildings below `root`. */
function collect(mesh: THREE.InstancedMesh, root: THREE.Object3D) {
  const margins = (mesh.geometry.getAttribute("aMargin") as THREE.InstancedBufferAttribute).array as Float32Array;
  const matrices = mesh.instanceMatrix.array as Float32Array;
  let n = 0;
  const walk = (o: THREE.Object3D) => {
    for (const c of o.children) {
      if (n >= CAPACITY) return;
      if (c.userData.base) {
        // Unchanged buildings (same batch signature) reuse their shadows: only new or changed
        // ones are measured again (it was a walk over every part of the town per new house).
        const signature = unitSignature.get(c);
        let hit = unitCache.get(c);
        if (!hit || signature === undefined || hit.signature !== signature) {
          c.updateWorldMatrix(true, true);
          hit = { signature: signature ?? NaN, ...collectUnit(c) };
          unitCache.set(c, hit);
        }
        const count = Math.min(hit.margins.length, CAPACITY - n);
        matrices.set(hit.matrices.subarray(0, count * 16), n * 16);
        margins.set(hit.margins.subarray(0, count), n);
        n += count;
        continue;
      }
      const im = c as THREE.InstancedMesh;
      if (im.isInstancedMesh && c.visible && c.userData.contact) {
        c.updateWorldMatrix(true, false);
        if (!im.geometry.boundingBox) im.geometry.computeBoundingBox();
        for (let i = 0; i < im.count && n < CAPACITY; i++) {
          im.getMatrixAt(i, instance);
          world.multiplyMatrices(im.matrixWorld, instance);
          const box = im.geometry.boundingBox!;
          n = addPart(mesh, margins, n, box, world, c0.set(0, box.min.y, 0).applyMatrix4(world).y);
        }
        continue;
      }
      if (c.visible) walk(c);
    }
  };
  walk(root);
  mesh.count = n;
  mesh.instanceMatrix.clearUpdateRanges();
  mesh.instanceMatrix.needsUpdate = true;
  mesh.geometry.getAttribute("aMargin").needsUpdate = true;
}

/** Contact shadows for everything below `root`; `version` changes when the buildings do. */
export function GroundShadows({ root, version }: { root: RefObject<THREE.Group | null>; version: unknown }) {
  const mesh = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    geometry.setAttribute("aMargin", new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1));
    const m = new THREE.InstancedMesh(geometry, makeMaterial(), CAPACITY);
    m.count = 0;
    m.frustumCulled = false;
    m.renderOrder = 1;
    return m;
  }, []);

  useEffect(() => {
    const run = () => root.current && collect(mesh, root.current);
    // Shortly after the change (the batcher has then seen the new or changed buildings; several
    // changes in a row are one run), and once more for parts that appear later (loaded models).
    const soon = setTimeout(run, 250);
    const later = setTimeout(run, 1500);
    return () => {
      clearTimeout(soon);
      clearTimeout(later);
    };
  }, [mesh, root, version]);

  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    },
    [mesh],
  );

  return <primitive object={mesh} />;
}
