"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, type RefObject } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { timed } from "@/lib/city/perf";

/**
 * Static batching for the single buildings (performance, same look): every building group
 * (`userData.base`) is made of many small meshes – boxes, roofs, kit models – each one a draw
 * call, twice with shadows, plus a matrix update per frame. Here the static parts of a
 * building are merged per material and drawn as one instance of a shared `BatchedMesh` per
 * material (one draw call for all buildings, culled per building). The original meshes stay
 * in the scene graph, hidden and frozen (`userData.batched`), so React keeps owning them and
 * contact shadows still find them.
 *
 * Not batched: animated subtrees (`userData.dynamic` – sails, rides, smoke, animals),
 * instanced / skinned meshes, transparent or multi-material meshes.
 * Changes (upgrade, models that load later, demolition) are found by a per-building
 * signature, checked round-robin a few buildings per frame.
 */

const KEEP = ["position", "normal", "uv"] as const;
/** Buildings whose signature is checked per frame, and frames between unit discoveries. */
const CHECK_PER_FRAME = 16;
const DISCOVER_EVERY = 20;

interface Part {
  batch: Batch;
  geometryId: number;
  instanceId: number;
}
interface Entry {
  /** World bounding sphere of the building's batched parts, and whether it is drawn now. */
  sphere: THREE.Sphere;
  shown: boolean;
  signature: number;
  parts: Part[];
  meshes: THREE.Mesh[];
  /** Groups hidden because everything below them is batched, and objects frozen (no matrix updates). */
  hiddenGroups: THREE.Object3D[];
  frozen: THREE.Object3D[];
  /** Roots of static subtrees taken out of three's per-frame matrix traversal. */
  roots: THREE.Object3D[];
}
interface Batch {
  mesh: THREE.BatchedMesh;
  deleted: number;
}

const tmp = new THREE.Matrix4();
const projScreen = new THREE.Matrix4();
const frustum = new THREE.Frustum();
const probe = new THREE.Sphere();
/** Extra radius for the view test (m): buildings just off screen still cast their shadows into it. */
const SHADOW_MARGIN = 45;
/** Groups the batcher hid (all their meshes are batched). */
const hiddenByUs = new WeakSet<THREE.Object3D>();
export const hiddenByBatcher = (o: THREE.Object3D) => hiddenByUs.has(o);
/** Signature of every batched unit (changes when the building does): lets others cache per building. */
export const unitSignature = new WeakMap<THREE.Object3D, number>();
/** Units checked per frame while a full pass is pending (after the buildings changed). */
const CHECK_BURST = 100;

/** Material with its own shader hook (photo textures, window glow …). */
const hooked = (m: THREE.Material) => m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile;

function batchable(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as unknown as THREE.BatchedMesh).isBatchedMesh)
    return false;
  if (Array.isArray(m.material)) return false;
  const mat = m.material as THREE.Material & { vertexColors?: boolean; map?: THREE.Texture | null };
  if (!mat || mat.transparent || mat.vertexColors || !mat.visible) return false;
  return !!m.geometry?.getAttribute("position");
}

/** Static meshes of a building (skipping animated subtrees and nested buildings). */
function staticMeshes(unit: THREE.Object3D) {
  const out: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D) => {
    for (const c of o.children) {
      if (c.userData.dynamic || c.userData.base) continue;
      // Hidden by the game itself (not by us): leave it alone.
      if (!c.visible && !c.userData.batched && !hiddenByUs.has(c)) continue;
      if (batchable(c)) out.push(c);
      walk(c);
    }
  };
  walk(unit);
  return out;
}

/** Matrix of a mesh relative to its building, from the local matrices (frozen meshes have stale world matrices). */
function relative(mesh: THREE.Object3D, unit: THREE.Object3D, out: THREE.Matrix4) {
  mesh.updateMatrix();
  out.copy(mesh.matrix);
  let p = mesh.parent;
  while (p && p !== unit) {
    p.updateMatrix();
    out.premultiply(p.matrix);
    p = p.parent;
  }
  return out;
}

/** Numeric hash (FNV-style) over the building's place and every static part: geometry, material, flags, transform. */
function signatureOf(unit: THREE.Object3D, meshes: THREE.Mesh[]) {
  unit.updateWorldMatrix(true, false);
  let h = 2166136261 ^ meshes.length;
  const mix = (v: number) => {
    h = Math.imul(h ^ (Math.round(v * 1000) | 0), 16777619);
  };
  for (const e of unit.matrixWorld.elements) mix(e);
  // Every static descendant's own transform (also parts that are not batched, e.g. glass).
  const walk = (o: THREE.Object3D) => {
    for (const c of o.children) {
      if (c.userData.dynamic || c.userData.base) continue;
      mix(c.position.x + c.position.y * 3 + c.position.z * 7 + c.scale.x * 11 + c.scale.y * 13 + c.scale.z * 17 + c.quaternion.y * 19 + c.quaternion.w * 23);
      walk(c);
    }
  };
  walk(unit);
  for (const m of meshes) {
    relative(m, unit, tmp);
    mix(m.geometry.id);
    mix((m.material as THREE.Material).id);
    mix(+m.castShadow * 2 + +m.receiveShadow);
    const e = tmp.elements;
    for (const i of [0, 2, 5, 8, 10, 12, 13, 14]) mix(e[i]);
  }
  return h >>> 0;
}

/** Copy of a geometry in building space with exactly position / normal / uv, indexed. */
function prepared(mesh: THREE.Mesh, m: THREE.Matrix4) {
  const g = mesh.geometry.clone();
  for (const name of Object.keys(g.attributes)) if (!KEEP.includes(name as (typeof KEEP)[number])) g.deleteAttribute(name);
  g.morphAttributes = {};
  g.clearGroups();
  if (!g.getAttribute("normal")) g.computeVertexNormals();
  if (!g.getAttribute("uv")) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2));
  if (!g.index) {
    const n = g.getAttribute("position").count;
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  g.applyMatrix4(m);
  // Mirrored transforms flip the winding: keep the faces pointing outwards.
  if (m.determinant() < 0) {
    const idx = g.index!.array;
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  }
  return g;
}

/**
 * Materials written inline in JSX (`<meshStandardMaterial color=…>`) are new objects per mesh
 * and building, although they look the same. Plain ones (no shader hook) with the same
 * parameters share one batch; the first one seen draws for all.
 */
const canonical = new Map<string, THREE.Material>();
const keyOfMaterial = new WeakMap<THREE.Material, string>();
function shared(material: THREE.Material): THREE.Material {
  let key = keyOfMaterial.get(material);
  if (key === undefined) {
    const m = material as THREE.MeshStandardMaterial;
    const plain = material.type === "MeshStandardMaterial" && !hooked(material) && !m.map && !m.normalMap && !m.emissiveMap;
    key = plain
      ? [m.color.getHex(), m.emissive.getHex(), m.emissiveIntensity, m.roughness, m.metalness, m.side, +m.flatShading, +m.toneMapped, +m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits, m.alphaTest, +m.wireframe].join(",")
      : material.uuid;
    keyOfMaterial.set(material, key);
  }
  let c = canonical.get(key);
  if (!c) canonical.set(key, (c = material));
  return c;
}

export class StaticBatcher {
  readonly root = new THREE.Group();
  private batches = new Map<string, Batch>();
  private entries = new Map<THREE.Object3D, Entry>();
  private units: THREE.Object3D[] = [];
  private cursor = 0;
  private pending = 0;
  private frame = 0;

  constructor() {
    this.root.name = "static-batches";
  }

  private batchFor(material: THREE.Material, cast: boolean, receive: boolean, verts: number, index: number): Batch {
    const key = `${material.uuid}:${+cast}${+receive}`;
    let b = this.batches.get(key);
    if (!b) {
      // Small to start with (many materials are used by a single sign); grows by half when full.
      // Sized for its first geometry (a batch cannot be resized before it holds one).
      const mesh = new THREE.BatchedMesh(16, Math.max(1024, verts * 2), Math.max(2048, index * 2), material);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      // Culled once per building and frame by the batcher (see cull): three's own culling tests
      // every instance of every batch in every pass (~20 000 tests per frame in a big town).
      mesh.frustumCulled = false;
      mesh.perObjectFrustumCulled = false;
      // Opaque parts: no depth sorting needed.
      mesh.sortObjects = false;
      mesh.name = `batch:${material.name || material.type}`;
      this.root.add(mesh);
      b = { mesh, deleted: 0 };
      this.batches.set(key, b);
    }
    return b;
  }

  private add(batch: Batch, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): Part {
    const mesh = batch.mesh;
    const verts = geometry.getAttribute("position").count;
    const index = geometry.index!.count;
    if (mesh.unusedVertexCount < verts || mesh.unusedIndexCount < index) {
      if (batch.deleted > 0) {
        mesh.optimize();
        batch.deleted = 0;
      }
      if (mesh.unusedVertexCount < verts || mesh.unusedIndexCount < index) {
        const usedV = mesh.geometry.getAttribute("position").count - mesh.unusedVertexCount;
        const usedI = mesh.geometry.index!.count - mesh.unusedIndexCount;
        mesh.setGeometrySize(Math.max(usedV + verts, (usedV + verts) * 1.5) | 0, Math.max(usedI + index, (usedI + index) * 1.5) | 0);
      }
    }
    if (mesh.instanceCount >= mesh.maxInstanceCount) mesh.setInstanceCount(mesh.maxInstanceCount * 2);
    const geometryId = mesh.addGeometry(geometry);
    const instanceId = mesh.addInstance(geometryId);
    mesh.setMatrixAt(instanceId, matrix);
    return { batch, geometryId, instanceId };
  }

  private remove(unit: THREE.Object3D, restore: boolean) {
    const e = this.entries.get(unit);
    if (!e) return;
    for (const p of e.parts) {
      p.batch.mesh.deleteInstance(p.instanceId);
      p.batch.mesh.deleteGeometry(p.geometryId);
      p.batch.deleted++;
    }
    // Groups and matrices come back to life (a rebuild freezes them again).
    for (const g of e.hiddenGroups) {
      g.visible = true;
      hiddenByUs.delete(g);
    }
    for (const o of e.roots) delete (o as { updateMatrixWorld?: unknown }).updateMatrixWorld;
    for (const o of e.frozen) {
      o.matrixAutoUpdate = true;
      o.matrixWorldAutoUpdate = true;
    }
    if (restore) for (const m of e.meshes) unfreeze(m);
    this.entries.delete(unit);
  }

  /** (Re)batches one building if its signature changed. */
  private check(unit: THREE.Object3D) {
    const meshes = staticMeshes(unit);
    const signature = signatureOf(unit, meshes);
    const old = this.entries.get(unit);
    if (old && old.signature === signature) return;
    // Meshes that left the building (or the batch) get their own draw call back.
    if (old) {
      const keep = new Set(meshes);
      for (const m of old.meshes) if (!keep.has(m)) unfreeze(m);
    }
    this.remove(unit, false);
    const groups = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; geometries: THREE.BufferGeometry[] }>();
    for (const m of meshes) {
      const material = shared(m.material as THREE.Material);
      const key = `${material.uuid}:${+m.castShadow}${+m.receiveShadow}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { material, cast: m.castShadow, receive: m.receiveShadow, geometries: [] }));
      g.geometries.push(prepared(m, relative(m, unit, new THREE.Matrix4())));
    }
    const parts: Part[] = [];
    const box = new THREE.Box3();
    for (const g of groups.values()) {
      for (const geo of g.geometries) {
        geo.computeBoundingBox();
        box.union(geo.boundingBox!);
      }
      const merged = g.geometries.length === 1 ? g.geometries[0] : mergeGeometries(g.geometries, false);
      if (!merged) continue;
      parts.push(this.add(this.batchFor(g.material, g.cast, g.receive, merged.getAttribute("position").count, merged.index!.count), merged, unit.matrixWorld));
      for (const geo of g.geometries) geo.dispose();
      if (merged !== g.geometries[0]) merged.dispose();
    }
    // Hide the originals; keep their world matrices right for contact shadows.
    for (const m of meshes) {
      m.visible = false;
      m.userData.batched = true;
    }
    const { hiddenGroups, frozen, roots } = freeze(unit);
    const sphere = box.isEmpty() ? new THREE.Sphere() : box.getBoundingSphere(new THREE.Sphere()).applyMatrix4(unit.matrixWorld);
    unitSignature.set(unit, signature);
    this.entries.set(unit, { sphere, shown: true, signature, parts, meshes, hiddenGroups, frozen, roots });
  }

  /** Buildings below the scene root: the first `userData.base` group on every path. */
  private discover(scene: THREE.Object3D) {
    const units: THREE.Object3D[] = [];
    const walk = (o: THREE.Object3D) => {
      for (const c of o.children) {
        if (c === this.root) continue;
        if (c.userData.base) units.push(c);
        else if (!(c as THREE.Mesh).isMesh) walk(c);
      }
    };
    walk(scene);
    const found = new Set(units);
    for (const unit of [...this.entries.keys()]) if (!found.has(unit)) this.remove(unit, true);
    this.units = units;
  }

  /**
   * Shows the buildings in (or near) the view, hides the rest in every batch. The margin keeps
   * buildings just outside the picture, whose shadows still fall into it.
   */
  cull(camera: THREE.Camera) {
    camera.updateMatrixWorld();
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    for (const e of this.entries.values()) {
      probe.copy(e.sphere);
      probe.radius += SHADOW_MARGIN;
      const show = frustum.intersectsSphere(probe);
      if (show === e.shown) continue;
      e.shown = show;
      for (const p of e.parts) p.batch.mesh.setVisibleAt(p.instanceId, show);
    }
  }

  /** Per frame: discover buildings now and then, check a few signatures. */
  update(scene: THREE.Object3D, force = false) {
    if (force || this.frame++ % DISCOVER_EVERY === 0) this.discover(scene);
    // After a change every unit is checked once, spread over a few frames (no hitch).
    if (force) this.pending = this.units.length;
    const n = Math.min(this.pending > 0 ? CHECK_BURST : CHECK_PER_FRAME, this.units.length);
    this.pending = Math.max(0, this.pending - n);
    for (let i = 0; i < n; i++) {
      this.cursor = (this.cursor + 1) % Math.max(1, this.units.length);
      const unit = this.units[this.cursor];
      if (unit) this.check(unit);
    }
  }

  dispose() {
    for (const unit of [...this.entries.keys()]) this.remove(unit, true);
    for (const b of this.batches.values()) {
      b.mesh.dispose();
      this.root.remove(b.mesh);
    }
    this.batches.clear();
  }

  /** Draw calls saved: meshes hidden vs. batches drawn (for the benchmark). */
  stats() {
    let meshes = 0;
    for (const e of this.entries.values()) meshes += e.meshes.length;
    return { gebäude: this.entries.size, teileGebündelt: meshes, batches: this.batches.size };
  }
}

/**
 * After batching, the static part of a building needs no work per frame: every object outside
 * animated subtrees gets its matrices once and is then skipped by `updateMatrixWorld`; groups
 * holding only batched meshes are hidden, so the render and shadow walks skip them too.
 * Only the path down to animated subtrees stays live.
 */
function freeze(unit: THREE.Object3D) {
  const hiddenGroups: THREE.Object3D[] = [];
  const frozen: THREE.Object3D[] = [];
  const roots: THREE.Object3D[] = [];
  const frozenSet = new Set<THREE.Object3D>();
  unit.traverse((o) => o.updateMatrix());
  unit.updateMatrixWorld(true);
  /** Returns [has animated content, everything below is batched]. */
  const walk = (o: THREE.Object3D): [boolean, boolean] => {
    let live = !!o.userData.dynamic;
    let batchedOnly = (o as THREE.Mesh).isMesh ? !!o.userData.batched : true;
    let any = (o as THREE.Mesh).isMesh;
    if (!live) {
      for (const c of o.children) {
        const [l, b] = walk(c);
        live ||= l;
        batchedOnly &&= b;
        any = true;
      }
    }
    if (!live) {
      o.matrixAutoUpdate = false;
      o.matrixWorldAutoUpdate = false;
      frozen.push(o);
    } else if (!o.userData.dynamic) {
      // Static children of a live node leave the traversal as whole subtrees.
      for (const c of o.children) if (frozenSet.has(c)) roots.push(c);
    }
    if (!live) frozenSet.add(o);
    if (!live && batchedOnly && any && !(o as THREE.Mesh).isMesh && o.visible) {
      o.visible = false;
      hiddenByUs.add(o);
      hiddenGroups.push(o);
    }
    return [live, batchedOnly && !live];
  };
  // The unit's own transform stays live (signatureOf refreshes it; it moves on an upgrade).
  let liveUnit = false;
  for (const c of unit.children) liveUnit = walk(c)[0] || liveUnit;
  // Nothing animated inside: the whole unit is skipped by `scene.updateMatrixWorld` (three visits
  // every object each frame even when its matrices are frozen – 40 000 objects in a big town).
  if (!liveUnit) roots.push(unit);
  else for (const c of unit.children) if (frozenSet.has(c)) roots.push(c);
  for (const o of roots) (o as { updateMatrixWorld: () => void }).updateMatrixWorld = NOOP;
  return { hiddenGroups, frozen, roots };
}

const NOOP = () => {};

function unfreeze(m: THREE.Mesh) {
  if (!m.userData.batched) return;
  m.visible = true;
  m.userData.batched = false;
  m.matrixAutoUpdate = true;
  m.matrixWorldAutoUpdate = true;
}

/** Mounts the batches next to the buildings and keeps them in sync. */
export function StaticBatches({ scene, version, name = "__batcher" }: { scene: RefObject<THREE.Group | null>; version: unknown; name?: string }) {
  const batcher = useMemo(() => new StaticBatcher(), []);
  useEffect(() => () => batcher.dispose(), [batcher]);
  useEffect(() => {
    // New or changed buildings: a full pass on the next frame.
    batcher.update(scene.current ?? batcher.root, true);
  }, [batcher, scene, version]);
  useFrame(({ camera }) => {
    if (!scene.current) return;
    timed("frame: Gebäude bündeln", () => {
      batcher.update(scene.current!);
      batcher.cull(camera);
    });
  });
  useEffect(() => {
    if (process.env.NODE_ENV !== "development" && !window.location.search.includes("bench")) return;
    (window as unknown as Record<string, StaticBatcher>)[name] = batcher;
  }, [batcher, name]);
  return <primitive object={batcher.root} />;
}
