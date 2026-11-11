import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { powerOf, TRANSFORMER_RADIUS } from "@/lib/city/power";
import { CABLE_COST_PER_M, useCity } from "@/lib/city/store";
import { sampleDepth, type DepthGrid } from "@/lib/city/terrain";
import type { Building } from "@/lib/city/economy";
import { footprintGeometry } from "./WaterCoverage";
import type { Cable, Vec2 } from "@/lib/city/types";
import { useDepthGrid } from "./useWater";

/**
 * Overhead power lines (Freileitungen): lattice pylons at every drawn point and at most
 * SPAN metres apart, four conductors on two cross-arms plus an earth wire, sagging between
 * the pylons. Also draws the draft line while the cable tool is active and the supply
 * circles of transformer stations.
 */

const SPAN = 55;
const PYLON_H = 18;
/** Conductor attachment points (local x across the line, y), below the insulators. */
const ATTACH: [number, number][] = [
  [-4.6, 12.6],
  [4.6, 12.6],
  [-3.2, 15.2],
  [3.2, 15.2],
  [0, PYLON_H + 0.3],
];

const steel = new THREE.MeshStandardMaterial({ color: "#8c9399", roughness: 0.55, metalness: 0.6 });
const wire = new THREE.MeshStandardMaterial({ color: "#3a3d40", roughness: 0.5, metalness: 0.5 });
const insulator = new THREE.MeshStandardMaterial({ color: "#c7d3d9", roughness: 0.3 });
const ghostSteel = new THREE.MeshBasicMaterial({ color: "#ffb703", transparent: true, opacity: 0.55, depthWrite: false });
const ghostWire = new THREE.MeshBasicMaterial({ color: "#ffb703", transparent: true, opacity: 0.8, depthWrite: false });
// Overlapping circles must not add up (same trick as WaterCoverage).
const coverageMaterial = new THREE.MeshBasicMaterial({
  color: "#f1c40f",
  transparent: true,
  opacity: 0.22,
  depthWrite: true,
  depthFunc: THREE.LessDepth,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
});
const coverageFaint = coverageMaterial.clone();
coverageFaint.opacity = 0.1;

/** Cylinder between two points. */
function beam(a: THREE.Vector3, b: THREE.Vector3, r: number) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 4, 1).translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q).translate(a.x, a.y, a.z);
  return g.toNonIndexed();
}

/** One lattice pylon (local x across the line, z along it), merged. */
function pylonGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const halfAt = (y: number) => 1.7 - (1.2 * y) / PYLON_H;
  const levels = [0, 4, 8, 11.5, 14, 16.5, PYLON_H];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      // Legs, tapering to the top.
      for (let i = 0; i < levels.length - 1; i++) {
        const y0 = levels[i];
        const y1 = levels[i + 1];
        parts.push(beam(v(sx * halfAt(y0), y0, sz * halfAt(y0)), v(sx * halfAt(y1), y1, sz * halfAt(y1)), 0.09));
      }
    }
  }
  // Horizontal rings and X-bracing on all four faces.
  for (let i = 0; i < levels.length - 1; i++) {
    const y0 = levels[i];
    const y1 = levels[i + 1];
    const h0 = halfAt(y0);
    const h1 = halfAt(y1);
    for (const [ax, az, bx, bz] of [
      [-1, -1, 1, -1],
      [1, -1, 1, 1],
      [1, 1, -1, 1],
      [-1, 1, -1, -1],
    ]) {
      parts.push(beam(v(ax * h1, y1, az * h1), v(bx * h1, y1, bz * h1), 0.05));
      parts.push(beam(v(ax * h0, y0, az * h0), v(bx * h1, y1, bz * h1), 0.04));
      parts.push(beam(v(bx * h0, y0, bz * h0), v(ax * h1, y1, az * h1), 0.04));
    }
  }
  // Cross-arms (triangular) with hanging insulators.
  for (const [half, y] of [
    [5, 13.6],
    [3.6, 16.2],
  ]) {
    const w = halfAt(y);
    for (const sz of [-1, 1]) {
      parts.push(beam(v(-half, y, 0), v(half, y, 0), 0.07));
      parts.push(beam(v(-half, y, 0), v(-w, y + 1.2, sz * w), 0.05));
      parts.push(beam(v(half, y, 0), v(w, y + 1.2, sz * w), 0.05));
    }
  }
  // Earth-wire peak.
  parts.push(beam(v(0, PYLON_H, 0), v(0, PYLON_H + 0.6, 0), 0.08));
  const lattice = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  const insulators = mergeGeometries(
    ATTACH.slice(0, 4).map(([x, y]) => new THREE.CylinderGeometry(0.16, 0.16, 1, 6).translate(x, y + 0.5, 0).toNonIndexed()),
  )!;
  return { lattice, insulators };
}

const groundY = (grid: DepthGrid, p: Vec2) => Math.max(0, -sampleDepth(grid, p.x, p.z));

/** Pylon positions with heading (yaw of the cross-arm normal = line direction). */
function pylonsOf(points: Vec2[]): { p: Vec2; yaw: number }[] {
  const out: { p: Vec2; yaw: number }[] = [];
  const dirAt = (i: number) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    return Math.atan2(b.x - a.x, b.z - a.z);
  };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    out.push({ p: a, yaw: i === 0 ? yaw : dirAt(i) });
    const n = Math.ceil(len / SPAN);
    for (let k = 1; k < n; k++) out.push({ p: { x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n }, yaw });
  }
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  if (last && prev) out.push({ p: last, yaw: Math.atan2(last.x - prev.x, last.z - prev.z) });
  return out;
}

/** Conductors between consecutive pylons, as thin sagging tubes, merged. */
function wiresGeometry(lines: Vec2[][], grid: DepthGrid) {
  const parts: THREE.BufferGeometry[] = [];
  for (const points of lines) {
    const pylons = pylonsOf(points);
    for (let i = 0; i < pylons.length - 1; i++) {
      const a = pylons[i];
      const b = pylons[i + 1];
      const ya = groundY(grid, a.p);
      const yb = groundY(grid, b.p);
      const span = Math.hypot(b.p.x - a.p.x, b.p.z - a.p.z);
      if (span < 0.5) continue;
      const sag = span * 0.035;
      for (const [lx, ly] of ATTACH) {
        const at = (pyl: { p: Vec2; yaw: number }, y: number) =>
          new THREE.Vector3(pyl.p.x + Math.cos(pyl.yaw) * lx, y + ly, pyl.p.z - Math.sin(pyl.yaw) * lx);
        const pa = at(a, ya);
        const pb = at(b, yb);
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 10; k++) {
          const t = k / 10;
          const q = pa.clone().lerp(pb, t);
          q.y -= 4 * sag * t * (1 - t);
          pts.push(q);
        }
        const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, ly > PYLON_H ? 0.04 : 0.06, 3, false);
        parts.push(tube.toNonIndexed());
        tube.dispose();
      }
    }
  }
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

function setPylons(mesh: THREE.InstancedMesh | null, pylons: { p: Vec2; yaw: number }[], grid: DepthGrid) {
  if (!mesh) return;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  pylons.forEach((pl, i) => {
    q.setFromAxisAngle(up, pl.yaw);
    m.compose(new THREE.Vector3(pl.p.x, groundY(grid, pl.p), pl.p.z), q, one);
    mesh.setMatrixAt(i, m);
  });
  mesh.count = pylons.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

let pylonTemplate: ReturnType<typeof pylonGeometry> | null = null;
const usePylon = () => (pylonTemplate ??= pylonGeometry());

/** Pylons and wires for a set of lines (finished cables or the draft). */
function Lines({ lines, ghost = false }: { lines: Vec2[][]; ghost?: boolean }) {
  const grid = useDepthGrid();
  const template = usePylon();
  const pylons = useMemo(() => lines.flatMap((l) => (l.length > 1 ? pylonsOf(l) : [])), [lines]);
  const wires = useMemo(() => wiresGeometry(lines, grid), [lines, grid]);
  useEffect(() => () => wires?.dispose(), [wires]);
  const lattice = useRef<THREE.InstancedMesh>(null);
  const insul = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    setPylons(lattice.current, pylons, grid);
    setPylons(insul.current, pylons, grid);
  }, [pylons, grid]);
  const n = Math.max(1, pylons.length);
  if (pylons.length === 0) return null;
  return (
    <group>
      <instancedMesh key={`l${n}`} ref={lattice} args={[template.lattice, ghost ? ghostSteel : steel, n]} castShadow={!ghost} frustumCulled={false} />
      <instancedMesh key={`i${n}`} ref={insul} args={[template.insulators, ghost ? ghostSteel : insulator, n]} frustumCulled={false} />
      {wires && <mesh geometry={wires} material={ghost ? ghostWire : wire} castShadow={!ghost} />}
    </group>
  );
}

/** Disc of radius r draped over the terrain. */
function discGeometry(c: Vec2, r: number, grid: DepthGrid) {
  const g = new THREE.RingGeometry(0.01, r, 72, 12).rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + c.x;
    const z = pos.getZ(i) + c.z;
    pos.setXYZ(i, x, Math.max(0, -sampleDepth(grid, x, z)) + 0.35, z);
  }
  return g;
}

const unpoweredMaterial = new THREE.MeshBasicMaterial({
  color: "#e0352b",
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  side: THREE.DoubleSide,
});

/** Red footprints of buildings that need power but get less than 90 % of it. */
function Unpowered({ buildings }: { buildings: Building[] }) {
  const grid = useDepthGrid();
  const geometry = useMemo(() => (buildings.length > 0 ? footprintGeometry(buildings, grid) : null), [buildings, grid]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return <mesh geometry={geometry} material={unpoweredMaterial} renderOrder={7} />;
}

function Coverage({ transformers, faint }: { transformers: Building[]; faint: boolean }) {
  const grid = useDepthGrid();
  const geometry = useMemo(() => {
    if (transformers.length === 0) return null;
    const parts = transformers.map((t) => discGeometry(t, TRANSFORMER_RADIUS[t.level], grid).toNonIndexed());
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    return merged;
  }, [transformers, grid]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return <mesh geometry={geometry} material={faint ? coverageFaint : coverageMaterial} renderOrder={5} />;
}

export function PowerLines() {
  const cables = useCity((s) => s.cables);
  const tool = useCity((s) => s.tool);
  const draft = useCity((s) => s.draft);
  const cursor = useCity((s) => s.cursor);
  const placing = useCity((s) => s.placing);
  const buildings = useCity((s) => s.buildings);
  const selectedId = useCity((s) => s.selected);
  const economy = useCity((s) => s.economy);
  const overlay = useCity((s) => s.showPower);

  const lines = useMemo(() => cables.map((c: Cable) => c.points), [cables]);
  const draftLines = useMemo(() => {
    if (tool !== "cable") return [];
    const pts = cursor && draft.length > 0 ? [...draft, cursor] : draft;
    return pts.length > 1 ? [pts] : [];
  }, [tool, draft, cursor]);

  // Supply circles: of the selected transformer's or plant's grid, or of all transformers
  // while laying cables, placing a transformer or with the power overlay on.
  const transformers = useMemo(() => buildings.filter((b) => b.kind === "transformer"), [buildings]);
  const selected = buildings.find((b) => b.id === selectedId);
  const shown = useMemo(() => {
    if (!selected || (selected.kind !== "transformer" && selected.kind !== "powerplant")) return null;
    const st = economy?.status[selected.id];
    const grid = selected.kind === "transformer" ? st?.transformer?.grid : st?.plant?.grid;
    if (grid === null || grid === undefined) return selected.kind === "transformer" ? [selected] : [];
    return transformers.filter((t) => economy?.status[t.id]?.transformer?.grid === grid);
  }, [selected, economy, transformers]);
  const showAll = overlay || tool === "cable" || placing === "transformer";
  const unpowered = useMemo(
    () => (showAll && economy ? buildings.filter((b) => powerOf(b) > 0 && (economy.status[b.id]?.power ?? 0) < 0.9) : []),
    [showAll, economy, buildings],
  );

  return (
    <group>
      <Lines lines={lines} />
      {draftLines.length > 0 && <Lines lines={draftLines} ghost />}
      {shown && <Coverage transformers={shown} faint={false} />}
      {!shown && showAll && <Coverage transformers={transformers} faint={!overlay} />}
      {showAll && <Unpowered buildings={unpowered} />}
    </group>
  );
}

/** Cost of a draft line, for the draft chip. */
export const cableCost = (points: Vec2[]) => {
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) len += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
  return Math.round(len * CABLE_COST_PER_M);
};
