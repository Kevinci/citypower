import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { insideFootprint, MAYOR_PRIVATE, sizeOf, type Building } from "@/lib/city/economy";
import { buildingGround, planBuilding } from "@/lib/city/placement";
import { useCity } from "@/lib/city/store";
import { naturalDepthGrid, raycastTerrain, type DepthGrid } from "@/lib/city/terrain";
import { useDepthGrid } from "./useWater";

const CLICK_TOLERANCE_PX = 5;

/** Rough height of a building for picking (m): houses by level, a few tall landmarks, else 14 m. */
const HOUSE_PICK_HEIGHT = [0, 7, 10, 15, 26, 42, 70, 115];
const PICK_HEIGHT: Partial<Record<Building["kind"], number>> = { bank: 75, townhall: 34, church: 28, powerplant: 32, airport: 8, farm: 16, sheepfarm: 8, park: 6, playground: 5, ruin: 6, villa: 13 };
const pickHeight = (b: Building) => (b.kind === "house" ? (HOUSE_PICK_HEIGHT[b.level] ?? 12) : (PICK_HEIGHT[b.kind] ?? 14));

const local = new THREE.Ray();
const box = new THREE.Box3();
const hitPoint = new THREE.Vector3();
/** Nearest building whose box (plot × height, turned with the building) the ray hits. */
function pickBuilding(buildings: Building[], worldRay: THREE.Ray, grid: DepthGrid): Building | undefined {
  let best: Building | undefined;
  let bestT = Infinity;
  for (const b of buildings) {
    // Quick reject: the ray must pass near the building at all.
    const [w, d] = sizeOf(b);
    const r = Math.hypot(w, d) / 2 + 2;
    const toB = new THREE.Vector3(b.x, 0, b.z).sub(worldRay.origin);
    const along = toB.dot(worldRay.direction);
    if (along < 0) continue;
    const y = buildingGround(b, grid);
    // Ray in the building's frame (translate, then turn by −rot about y).
    const c = Math.cos(-b.rot);
    const s = Math.sin(-b.rot);
    const ox = worldRay.origin.x - b.x;
    const oz = worldRay.origin.z - b.z;
    local.origin.set(ox * c + oz * s, worldRay.origin.y - y, -ox * s + oz * c);
    local.direction.set(worldRay.direction.x * c + worldRay.direction.z * s, worldRay.direction.y, -worldRay.direction.x * s + worldRay.direction.z * c);
    box.min.set(-w / 2, 0, -d / 2);
    box.max.set(w / 2, pickHeight(b), d / 2);
    if (local.distanceSqToPoint(new THREE.Vector3(0, pickHeight(b) / 2, 0)) > (r + pickHeight(b)) ** 2) continue;
    if (!local.intersectBox(box, hitPoint)) continue;
    const t = hitPoint.distanceTo(local.origin);
    if (t < bestT) {
      bestT = t;
      best = b;
    }
  }
  return best;
}
const ghostOk = new THREE.MeshBasicMaterial({ color: "#35d06b", transparent: true, opacity: 0.45, depthWrite: false });
const ghostWarn = new THREE.MeshBasicMaterial({ color: "#f2b632", transparent: true, opacity: 0.45, depthWrite: false });
const ghostBad = new THREE.MeshBasicMaterial({ color: "#ef4444", transparent: true, opacity: 0.45, depthWrite: false });
const ghostBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

/**
 * Placing buildings from the economy menu (ghost that snaps next to the nearest street,
 * green = fits, red = why not in the status bar) and selecting buildings by clicking
 * them when no tool is active.
 */
export function BuildingTool() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const placing = useCity((s) => s.placing);
  const cursor = useCity((s) => s.cursor);
  const roads = useCity((s) => s.roads);
  const rails = useCity((s) => s.rails);
  const canals = useCity((s) => s.canals);
  const buildings = useCity((s) => s.buildings);
  // The villa's ghost checks the mayor's private account.
  const money = useCity((s) => (s.placing && MAYOR_PRIVATE.includes(s.placing) ? s.mayor.account : s.money));
  const grid = useDepthGrid();

  useEffect(() => {
    const el = gl.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const ground = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = raycastTerrain(ray.ray.origin, ray.ray.direction, naturalDepthGrid());
      if (hit) return { x: hit.x, z: hit.z };
      const p = new THREE.Vector3();
      return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? { x: p.x, z: p.z } : null;
    };
    let down: { x: number; y: number } | null = null;
    const onMove = (e: PointerEvent) => {
      if (useCity.getState().placing) useCity.getState().setCursor(ground(e));
    };
    const onDown = (e: PointerEvent) => {
      if (e.button === 0) down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_TOLERANCE_PX;
      down = null;
      if (moved) return;
      const st = useCity.getState();
      const p = ground(e);
      if (!p) return;
      if (st.placing) {
        st.placeBuilding(p);
        return;
      }
      if (st.tool) return;
      // The whole building is clickable (walls and roof, not only its ground plot): the
      // nearest building box the ray passes through wins, the ground plot as a fallback.
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = pickBuilding(st.buildings, ray.ray, naturalDepthGrid()) ?? st.buildings.find((b) => insideFootprint(b, p.x, p.z, 1.5));
      st.select(hit ? hit.id : null);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
    };
  }, [gl, camera]);

  const cables = useCity((s) => s.cables);
  const plan = useMemo(() => {
    if (!placing || !cursor) return null;
    return planBuilding(placing, cursor, roads, [...roads, ...rails, ...canals], buildings, grid, money, "__ghost__", cables);
  }, [placing, cursor, roads, rails, canals, buildings, grid, money, cables]);

  // Tell the status bar why it does not fit.
  useEffect(() => {
    if (!placing) return;
    const n = plan?.demolish?.length ?? 0;
    const demolish = n > 0 ? `${n} ${n === 1 ? "Wohnhaus" : "Wohnhäuser"} im Weg ${n === 1 ? "wird" : "werden"} abgerissen` : null;
    useCity.setState({ notice: plan?.problem ?? ([plan?.warning, demolish].filter(Boolean).join(" – ") || null) });
  }, [plan, placing]);

  if (!plan) return null;
  const [w, d] = sizeOf(plan.building);
  const height = plan.building.kind === "farm" ? 3 : 7;
  // Red: does not fit. Yellow: fits, but stands shut down until a street / water is added.
  const material = plan.problem ? ghostBad : plan.warning ? ghostWarn : ghostOk;
  return (
    <group position={[plan.building.x, plan.y, plan.building.z]} rotation={[0, plan.building.rot, 0]}>
      <mesh geometry={ghostBox} material={material} scale={[w, height, d]} renderOrder={5} />
      {/* Arrow towards the road (front). */}
      <mesh position={[0, height + 0.5, -d / 2 - 1.5]} rotation={[-Math.PI / 2, 0, 0]} material={material}>
        <coneGeometry args={[1.6, 3, 3]} />
      </mesh>
    </group>
  );
}
