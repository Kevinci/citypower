"use client";

import { createRoot, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { create } from "zustand";
import { planCloverleafPrefab } from "@/lib/city/cloverleaf";
import type { Building } from "@/lib/city/economy";
import { computeProfiles } from "@/lib/city/grade";
import { planInterchange } from "@/lib/city/interchange";
import { RAIL_MATERIALS, ROAD_MATERIALS, WATER_MATERIALS } from "@/lib/city/materials";
import { buildRailLayers } from "@/lib/city/rail-geometry";
import { buildRoadLayers } from "@/lib/city/road-geometry";
import { TERRAIN_N } from "@/lib/city/terrain";
import { planTrumpet } from "@/lib/city/trumpet";
import type { Road, RoadKind, Vec2 } from "@/lib/city/types";
import { buildCanalLayers } from "@/lib/city/water-geometry";
import {
  Exchange,
  GoldSmelter,
  Jeweller,
  Bakery,
  Butcher,
  ClothingFactory,
  FashionShop,
  ChickenFarm,
  Trader,
  FoodFactory,
  Discounter,
  SheepFarm,
  Spinning,
  Cinema,
  Farm,
  FurnitureFactory,
  FurnitureStore,
  Hospital,
  HouseModel,
  Mill,
  Restaurant,
  Sawmill,
  School,
  Slaughterhouse,
  Steelworks,
  Waterworks,
} from "./Buildings";
import { Airport } from "./Airport";
import { LayerMeshes } from "./LayerMeshes";
import { Mine, PowerPlant, Transformer } from "./PowerModels";

/**
 * 3D preview images for the build menu cards, rendered from the real game geometry and
 * building models. One hidden canvas renders every subject in turn (one WebGL context
 * for all cards) and stores PNG data URLs; cards show them as soon as they exist.
 */

export type ThumbKey =
  | "street"
  | "highway"
  | "bike"
  | "rail"
  | "rail2"
  | "canal"
  | "interchange"
  | "cloverleaf"
  | "trumpet"
  | "farm"
  | "bakery"
  | "waterworks"
  | "hospital"
  | "mill"
  | "school"
  | "steelworks"
  | "sawmill"
  | "furniture"
  | "furniturestore"
  | "slaughterhouse"
  | "butcher"
  | "restaurant"
  | "cinema"
  | "powerplant"
  | "transformer"
  | "coalmine"
  | "ironmine"
  | "uraniummine"
  | "sheepfarm"
  | "spinning"
  | "clothing"
  | "fashion"
  | "chickenfarm"
  | "trader"
  | "airport"
  | "foodfactory"
  | "discounter"
  | "goldmine"
  | "goldsmelter"
  | "jeweller"
  | "exchange";

const useThumbStore = create<{ images: Partial<Record<ThumbKey, string>> }>(() => ({ images: {} }));
export const useThumbnail = (key: string) => useThumbStore((s) => s.images[key as ThumbKey]);

const WIDTH = 256;
const HEIGHT = 160;
/** Flat world for planners and fields (no water, no mountains). */
const FLAT = new Float32Array(TERRAIN_N * TERRAIN_N);

/* ---------- subjects ---------- */

function RoadPiece({ points, kind }: { points: Vec2[]; kind: RoadKind }) {
  const layers = useMemo(() => buildRoadLayers(points, kind), [points, kind]);
  return <LayerMeshes layers={layers} materials={ROAD_MATERIALS} />;
}

function Roads({ roads }: { roads: Road[] }) {
  return (
    <>
      {roads.map((r) => (
        <RoadPiece key={r.id} points={r.points} kind={r.kind as RoadKind} />
      ))}
    </>
  );
}

function RailPiece({ kind }: { kind: "rail" | "rail2" }) {
  const layers = useMemo(() => buildRailLayers([{ x: -22, z: 0 }, { x: 22, z: 0 }], kind), [kind]);
  return <LayerMeshes layers={layers} materials={RAIL_MATERIALS} />;
}

const canalWater = new THREE.MeshStandardMaterial({ color: "#2f6f86", roughness: 0.08, metalness: 0.1 });
const canalBed = new THREE.MeshStandardMaterial({ color: "#3a3326", roughness: 1 });

function CanalPiece() {
  const layers = useMemo(() => buildCanalLayers([{ x: -26, z: 0 }, { x: 26, z: 0 }], "canal"), []);
  return (
    <>
      <LayerMeshes layers={layers} materials={WATER_MATERIALS} />
      <mesh position={[0, -0.9, 0]} rotation={[-Math.PI / 2, 0, 0]} material={canalWater}>
        <planeGeometry args={[52, 16]} />
      </mesh>
      <mesh position={[0, -3.3, 0]} rotation={[-Math.PI / 2, 0, 0]} material={canalBed}>
        <planeGeometry args={[52, 16]} />
      </mesh>
    </>
  );
}

const motorway = (id: string, a: Vec2, b: Vec2): Road => ({ id, kind: "highway", points: [a, b] });
const asRamps = (ramps: Vec2[][]): Road[] => ramps.map((points, i) => ({ id: `r${i}`, kind: "ramp", points }));

/** Real interchange layouts from the planners, on sample motorways in a flat world. */
function interchangeRoads(kind: "interchange" | "cloverleaf" | "trumpet"): Road[] {
  if (kind === "cloverleaf") {
    const a = motorway("a", { x: -260, z: 0 }, { x: 260, z: 0 });
    const plan = planCloverleafPrefab({ x: 0, z: 0 }, [a], {}, FLAT);
    return plan ? [a, ...(plan.newMotorway ? [plan.newMotorway] : []), ...asRamps(plan.ramps)] : [a];
  }
  if (kind === "trumpet") {
    const a = motorway("a", { x: -300, z: 0 }, { x: 300, z: 0 });
    const b = motorway("b", { x: 0, z: -280 }, { x: 0, z: -14 });
    const plan = planTrumpet({ x: 0, z: -14 }, [a, b], FLAT);
    return plan ? [a, plan.stem, ...asRamps(plan.ramps)] : [a, b];
  }
  const a = motorway("a", { x: 0, z: -260 }, { x: 0, z: 260 });
  const street: Road = { id: "s", kind: "street", points: [{ x: -170, z: 0 }, { x: 170, z: 0 }] };
  const seps = { "a|s": "s" };
  const profiles = computeProfiles([a, street], FLAT, seps);
  const plan = planInterchange({ x: 0, z: 0 }, [a, street], profiles, seps, FLAT);
  return plan ? [a, street, ...asRamps(plan.ramps)] : [a, street];
}

const origin = (kind: Building["kind"]): Building => ({ id: "thumb", kind, x: 0, z: 0, rot: 0, level: 2, variant: 1 });

const grass = new THREE.MeshStandardMaterial({ color: "#7fa65a", roughness: 1 });

/** Subject plus a patch of meadow under it. Camera framing is computed from `subject`. */
function subject(key: ThumbKey): { node: ReactNode; ground: number; tilt: number } {
  switch (key) {
    case "street":
      return { node: <RoadPiece points={[{ x: -20, z: 8 }, { x: 0, z: 8 }, { x: 0, z: -14 }]} kind="street" />, ground: 60, tilt: 0.8 };
    case "highway":
      return { node: <RoadPiece points={[{ x: -26, z: 0 }, { x: 26, z: 0 }]} kind="highway" />, ground: 80, tilt: 0.8 };
    case "bike":
      return { node: <RoadPiece points={[{ x: -10, z: 4 }, { x: 0, z: 4 }, { x: 0, z: -8 }]} kind="bike" />, ground: 30, tilt: 0.8 };
    case "rail":
    case "rail2":
      return { node: <RailPiece kind={key} />, ground: 60, tilt: 0.7 };
    case "canal":
      return { node: <CanalPiece />, ground: 70, tilt: 0.8 };
    case "interchange":
    case "cloverleaf":
    case "trumpet":
      return { node: <Roads roads={interchangeRoads(key)} />, ground: 900, tilt: 1.15 };
    case "farm":
      return { node: <Farm b={origin("farm")} grid={FLAT} y={0} />, ground: 120, tilt: 0.75 };
    case "sheepfarm":
      return { node: <SheepFarm b={{ ...origin("sheepfarm"), level: 3 }} grid={FLAT} y={0} />, ground: 110, tilt: 0.75 };
    case "spinning":
      return { node: <Spinning />, ground: 60, tilt: 0.55 };
    case "clothing":
      return { node: <ClothingFactory />, ground: 60, tilt: 0.55 };
    case "fashion":
      return { node: <FashionShop />, ground: 40, tilt: 0.5 };
    case "chickenfarm":
      return { node: <ChickenFarm />, ground: 50, tilt: 0.6 };
    case "airport":
      return { node: <Airport b={origin("airport")} grid={FLAT} y={0} preview />, ground: 420, tilt: 0.7 };
    case "trader":
      return { node: <Trader level={2} />, ground: 55, tilt: 0.55 };
    case "foodfactory":
      return { node: <FoodFactory />, ground: 60, tilt: 0.55 };
    case "discounter":
      return { node: <Discounter />, ground: 50, tilt: 0.55 };
    case "bakery":
      return {
        node: (
          <group>
            <Bakery />
            <group position={[15, 0, 0]}>
              <HouseModel />
            </group>
          </group>
        ),
        ground: 70,
        tilt: 0.55,
      };
    case "waterworks":
      return { node: <Waterworks level={3} />, ground: 60, tilt: 0.55 };
    case "hospital":
      return { node: <Hospital />, ground: 70, tilt: 0.55 };
    case "mill":
      return { node: <Mill />, ground: 40, tilt: 0.45 };
    case "school":
      return { node: <School />, ground: 60, tilt: 0.6 };
    case "steelworks":
      return { node: <Steelworks />, ground: 110, tilt: 0.55 };
    case "sawmill":
      return { node: <Sawmill />, ground: 80, tilt: 0.6 };
    case "furniture":
      return { node: <FurnitureFactory />, ground: 70, tilt: 0.6 };
    case "furniturestore":
      return { node: <FurnitureStore />, ground: 50, tilt: 0.5 };
    case "slaughterhouse":
      return { node: <Slaughterhouse />, ground: 60, tilt: 0.6 };
    case "butcher":
      return { node: <Butcher />, ground: 40, tilt: 0.5 };
    case "restaurant":
      return { node: <Restaurant />, ground: 40, tilt: 0.5 };
    case "cinema":
      return { node: <Cinema />, ground: 50, tilt: 0.5 };
    case "powerplant":
      return { node: <PowerPlant level={2} />, ground: 90, tilt: 0.55 };
    case "transformer":
      return { node: <Transformer level={2} />, ground: 30, tilt: 0.6 };
    case "coalmine":
    case "ironmine":
    case "uraniummine":
    case "goldmine":
      return { node: <Mine kind={key} />, ground: 60, tilt: 0.55 };
    case "goldsmelter":
      return { node: <GoldSmelter level={2} />, ground: 50, tilt: 0.55 };
    case "jeweller":
      return { node: <Jeweller />, ground: 36, tilt: 0.5 };
    case "exchange":
      return { node: <Exchange />, ground: 50, tilt: 0.5 };
  }
}

/** Points the camera at an object from the south-east, fitting it into the view. */
function frame(camera: THREE.PerspectiveCamera, object: THREE.Object3D, tilt: number) {
  const box = new THREE.Box3().setFromObject(object);
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x * 0.75, size.z * 0.75, size.y * 1.3) * 0.5;
  const dist = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dir = new THREE.Vector3(0.62, Math.tan(tilt), 0.78).normalize();
  camera.position.copy(centre).addScaledVector(dir, dist);
  camera.near = dist / 50;
  camera.far = dist * 4;
  camera.lookAt(centre);
  camera.updateProjectionMatrix();
}

/** Frames the subject (isometric view from the south-east) and captures the canvas. */
function Capture({ children, tilt, onShot }: { children: ReactNode; tilt: number; onShot: (url: string) => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const group = useRef<THREE.Group>(null);

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    frame(camera, g, tilt);
    // Textures load asynchronously: render a few times and keep the latest image.
    let shots = 0;
    const id = window.setInterval(() => {
      gl.render(scene, camera);
      onShot(gl.domElement.toDataURL("image/png"));
      if (++shots >= 6) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [gl, scene, camera, tilt, onShot]);

  return <group ref={group}>{children}</group>;
}

function ThumbScene({ k, onShot }: { k: ThumbKey; onShot: (url: string) => void }) {
  const s = subject(k);
  return (
    <>
      <hemisphereLight args={["#eaf4ff", "#6b7d55", 1.6]} />
      <directionalLight position={[60, 120, 40]} intensity={2.4} color="#fff3df" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} material={grass}>
        <circleGeometry args={[s.ground, 48]} />
      </mesh>
      <Capture tilt={s.tilt} onShot={onShot}>
        {s.node}
      </Capture>
    </>
  );
}

const ORDER: ThumbKey[] = [
  "street",
  "highway",
  "bike",
  "farm",
  "bakery",
  "waterworks",
  "hospital",
  "mill",
  "school",
  "sawmill",
  "steelworks",
  "furniture",
  "furniturestore",
  "slaughterhouse",
  "butcher",
  "restaurant",
  "cinema",
  "powerplant",
  "transformer",
  "coalmine",
  "ironmine",
  "uraniummine",
  "sheepfarm",
  "spinning",
  "clothing",
  "fashion",
  "chickenfarm",
  "trader",
  "airport",
  "foodfactory",
  "discounter",
  "goldmine",
  "goldsmelter",
  "jeweller",
  "exchange",
  "rail",
  "rail2",
  "canal",
  "interchange",
  "cloverleaf",
  "trumpet",
];

let started = false;

/** Renders all card previews once (client only). */
export async function renderThumbnails() {
  if (started || typeof document === "undefined") return;
  started = true;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const root = createRoot(canvas);
  await root.configure({
    gl: { preserveDrawingBuffer: true, alpha: true, antialias: true },
    size: { width: WIDTH, height: HEIGHT, top: 0, left: 0 },
    dpr: 2,
    frameloop: "never",
    camera: { fov: 30, position: [0, 50, 50] },
    events: undefined,
  });
  for (const k of ORDER) {
    const onShot = (url: string) => useThumbStore.setState((s) => ({ images: { ...s.images, [k]: url } }));
    root.render(<ThumbScene key={k} k={k} onShot={onShot} />);
    await new Promise((r) => setTimeout(r, 1700));
  }
  // Second pass: everything (textures, models) is loaded by now.
  for (const k of ORDER) {
    const onShot = (url: string) => useThumbStore.setState((s) => ({ images: { ...s.images, [k]: url } }));
    root.render(<ThumbScene key={`${k}-2`} k={k} onShot={onShot} />);
    await new Promise((r) => setTimeout(r, 700));
  }
  root.unmount();
}
