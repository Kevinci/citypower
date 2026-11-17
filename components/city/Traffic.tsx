import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { sizeOf, type Building } from "@/lib/city/economy";
import type { Incident } from "@/lib/city/incidents";
import { NIGHT } from "@/lib/city/night";
import { mulberry32 } from "@/lib/city/random";
import { useCity } from "@/lib/city/store";
import {
  buildLaneGraph,
  carTarget,
  closeStreet,
  edgePose,
  laneShift,
  lightState,
  nearestEdge,
  nearestEdges,
  passingTraffic,
  placeCar,
  routeEdges,
  spawnCars,
  stepCars,
  type Car,
  type LaneGraph,
} from "@/lib/city/traffic";
import { useProfiles } from "./useProfiles";

/**
 * Vehicles from Kenney "Car Kit" (CC0, kenney.nl), see public/models/CREDITS.md.
 *
 * The models are stylised ("chibi": width and height ≈ half the length). Each axis is
 * therefore scaled separately to real dimensions in metres – length, width, height of a
 * typical vehicle of that class – so cars fit their lanes. `paint`: body colour is replaced
 * per car by a realistic paint colour (liveries such as taxi or police keep theirs).
 */
const VEHICLES = [
  { file: "sedan", size: [4.7, 1.82, 1.45], weight: 5, paint: true },
  { file: "suv", size: [4.6, 1.88, 1.68], weight: 4, paint: true },
  { file: "hatchback-sports", size: [4.15, 1.78, 1.42], weight: 4, paint: true },
  { file: "suv-luxury", size: [4.95, 1.95, 1.75], weight: 2, paint: true },
  { file: "sedan-sports", size: [4.5, 1.85, 1.3], weight: 1.5, paint: true },
  { file: "van", size: [5.0, 1.95, 1.95], weight: 2, paint: true },
  { file: "truck", size: [5.3, 1.9, 1.8], weight: 1.2, paint: true },
  { file: "taxi", size: [4.8, 1.83, 1.55], weight: 1, paint: false },
  { file: "delivery", size: [6.8, 2.2, 2.75], weight: 1.5, paint: true },
  { file: "police", size: [4.85, 1.85, 1.55], weight: 0.4, paint: false },
  { file: "ambulance", size: [6.2, 2.1, 2.75], weight: 0.3, paint: false },
  { file: "garbage-truck", size: [8.5, 2.5, 3.4], weight: 0.3, paint: false },
  // Only on missions (weight 0): the fire engine from the same kit.
  { file: "firetruck", size: [7.6, 2.5, 3.2], weight: 0, paint: false },
] as const;
const POLICE_TYPE = VEHICLES.findIndex((v) => v.file === "police");
const AMBULANCE_TYPE = VEHICLES.findIndex((v) => v.file === "ambulance");
const FIRE_TYPE = VEHICLES.findIndex((v) => v.file === "firetruck");
const SEDAN_TYPE = 0;

/** Props from the Car Kit at the scene of an incident: cones for the cordon, debris of a crash. */
const PROPS = [
  { file: "cone", size: [0.45, 0.75, 0.45] },
  { file: "debris-tire", size: [0.65, 0.22, 0.65] },
  { file: "debris-door", size: [1.0, 0.12, 1.1] },
  { file: "debris-plate-a", size: [0.9, 0.08, 0.7] },
  { file: "debris-bumper", size: [1.6, 0.25, 0.5] },
] as const;
const CONE = 0;

/**
 * Typical German car colours with their rough share (white, black, grey and silver
 * dominate; some blue, red, green, beige).
 */
const PAINTS: [string, number][] = [
  ["#f2f2ef", 22],
  ["#1b1c1f", 20],
  ["#7c8187", 18],
  ["#b9bcc0", 14],
  ["#1f3a6b", 9],
  ["#8e1b1b", 6],
  ["#2b4a37", 3],
  ["#c9b99a", 3],
  ["#4a6d8c", 3],
  ["#d4691e", 2],
];
const PAINT_POOL = PAINTS.flatMap(([c, w]) => Array.from({ length: w }, () => new THREE.Color(c)));

const url = (file: string) => `/models/vehicles/cars/${file}.glb`;
VEHICLES.forEach((v) => useGLTF.preload(url(v.file)));
PROPS.forEach((p) => useGLTF.preload(url(p.file)));

/** Height of the car body's base above the lane surface (road layers sit at ~2 cm). */
const RIDE_HEIGHT = 0.03;
/** How quickly the drawn car follows its lane position (1/s): smooths turns and merges. */
const EASE = 6;

/** Weighted type list for spawning (type indices repeated by weight). */
const TYPE_POOL = VEHICLES.flatMap((v, i) => Array.from({ length: Math.round(v.weight * 2) }, () => i));

/**
 * Merges all meshes of a car model into one geometry, base on y = 0, centred, nose along +z,
 * scaled to 1 m length. One instanced mesh per type then draws every car of that type.
 */
function bakeCar(scene: THREE.Object3D, paint: boolean): { geometry: THREE.BufferGeometry; material: THREE.Material } {
  scene.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  let material: THREE.Material | null = null;
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    // Keep only the attributes all parts share, so they can be merged.
    for (const name of Object.keys(g.attributes)) {
      if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
    }
    parts.push(g.index ? g.toNonIndexed() : g);
    material ??= Array.isArray(o.material) ? o.material[0] : o.material;
  });
  const merged = mergeGeometries(parts) ?? new THREE.BoxGeometry(1, 1, 1);
  merged.computeBoundingBox();
  const box = merged.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  merged.translate(-centre.x, -box.min.y, -centre.z);
  // Kenney cars are modelled along z; normalise every axis to 1 m so the instance scale
  // can set real width, height and length independently.
  if (size.x > size.z) {
    merged.rotateY(Math.PI / 2);
    [size.x, size.z] = [size.z, size.x];
  }
  merged.scale(1 / (size.x || 1), 1 / (size.y || 1), 1 / (size.z || 1));
  merged.computeVertexNormals();
  return { geometry: merged, material: carMaterial(material ?? new THREE.MeshStandardMaterial(), paint) };
}

/**
 * Car paint shader on top of the Kenney palette texture:
 *  - saturated, not too light texels are body paint: replaced by the per-instance colour
 *    (keeping the texture's shading gradient) when `paint` is set,
 *  - paint is glossy and slightly metallic, everything else (tyres, plastics, glass) matte,
 *  - road grime darkens the lowest part of the body.
 */
function carMaterial(source: THREE.Material, paint: boolean): THREE.Material {
  const src = source as THREE.MeshStandardMaterial;
  const material = new THREE.MeshStandardMaterial({ map: src.map, color: "#ffffff", roughness: 0.75, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vCarY;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCarY = position.y;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vCarY;\nfloat carPaint = 0.0;")
      .replace(
        "#include <color_fragment>",
        `{
          vec3 c = diffuseColor.rgb;
          float hi = max(c.r, max(c.g, c.b));
          float lo = min(c.r, min(c.g, c.b));
          float sat = (hi - lo) / max(hi, 1e-3);
          float lum = dot(c, vec3(0.299, 0.587, 0.114));
          carPaint = smoothstep(0.28, 0.45, sat) * (1.0 - smoothstep(0.75, 0.9, lum));
          // three r187 defines USE_COLOR in the fragment shader for instance colours
          // (vColor is a vec4 there).
          #if defined(USE_COLOR) && ${paint ? 1 : 0}
            // Keep the palette's light-to-dark gradient as shading of the new paint.
            float shade = clamp(lum / max(hi, 1e-3), 0.55, 1.15);
            diffuseColor.rgb = mix(c, vColor.rgb * shade, carPaint);
          #endif
          // Road grime on the lowest 25 % of the body.
          diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.04, 0.28, vCarY));
        }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(0.85, 0.3, carPaint);",
      )
      .replace(
        "#include <metalnessmap_fragment>",
        "#include <metalnessmap_fragment>\nmetalnessFactor = mix(0.0, 0.35, carPaint);",
      );
  };
  material.customProgramCacheKey = () => `car-paint:${paint}`;
  return material;
}

function useCarModels() {
  const gltfs = useGLTF(VEHICLES.map((v) => url(v.file)));
  return useMemo(() => gltfs.map((g, i) => bakeCar(g.scene, VEHICLES[i].paint)), [gltfs]);
}

function usePropModels() {
  const gltfs = useGLTF(PROPS.map((p) => url(p.file)));
  return useMemo(() => gltfs.map((g) => bakeCar(g.scene, false)), [gltfs]);
}

const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const scale = new THREE.Vector3();
const target = new THREE.Vector3();
const heading = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

/* ---------- traffic lights ---------- */

const LAMPS = [
  { name: "red", y: 0.38, on: new THREE.Color(4, 0.25, 0.15), off: new THREE.Color(0.12, 0.02, 0.02), state: "red" },
  { name: "yellow", y: 0, on: new THREE.Color(4, 2.4, 0.2), off: new THREE.Color(0.12, 0.08, 0.01), state: "yellow" },
  { name: "green", y: -0.38, on: new THREE.Color(0.3, 4, 0.9), off: new THREE.Color(0.01, 0.1, 0.03), state: "green" },
] as const;
const LAMP_GEOMETRY = new THREE.CircleGeometry(0.15, 16);
// Bright colours above 1 so the active lamp blooms; not tone mapped.
const LAMP_MATERIAL = new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide });
const HEAD_HEIGHT = 3.1;

const lampMatrix = new THREE.Matrix4();
const lampPos = new THREE.Vector3();
const lampQuat = new THREE.Quaternion();
const one = new THREE.Vector3(1, 1, 1);

/** Lights the active lamp of every signal head for time t. */
function drawLights(graph: LaneGraph, lamps: (THREE.InstancedMesh | null)[], t: number) {
  let n = 0;
  for (const sig of graph.signals) {
    for (const head of sig.heads) {
      const state = lightState(sig, head.group, t);
      lampQuat.setFromAxisAngle(up, head.yaw);
      LAMPS.forEach((lamp, i) => {
        const mesh = lamps[i];
        if (!mesh) return;
        // Lamp on the front face of the head, which faces oncoming traffic (+z local).
        lampPos.set(0, HEAD_HEIGHT + lamp.y, 0.17).applyQuaternion(lampQuat).add(head.pole);
        lampMatrix.compose(lampPos, lampQuat, one);
        mesh.setMatrixAt(n, lampMatrix);
        mesh.setColorAt(n, state === lamp.state ? lamp.on : lamp.off);
      });
      n++;
    }
  }
  for (const mesh of lamps) {
    if (!mesh) continue;
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

/** Static parts of all traffic lights: poles, signal heads and stop lines. */
function SignalHardware({ graph }: { graph: LaneGraph }) {
  const { poles, heads, stops } = useMemo(() => {
    const poles: THREE.Matrix4[] = [];
    const heads: THREE.Matrix4[] = [];
    const stops: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    for (const sig of graph.signals) {
      for (const h of sig.heads) {
        q.setFromAxisAngle(up, h.yaw);
        poles.push(new THREE.Matrix4().compose(h.pole.clone().setY(h.pole.y + 1.75), q, one));
        heads.push(new THREE.Matrix4().compose(h.pole.clone().setY(h.pole.y + HEAD_HEIGHT), q, one));
        const sq = new THREE.Quaternion().setFromAxisAngle(up, h.stopYaw);
        stops.push(
          new THREE.Matrix4().compose(h.stopLine.clone().setY(h.stopLine.y + 0.045), sq, new THREE.Vector3(h.stopWidth, 1, 1)),
        );
      }
    }
    return { poles, heads, stops };
  }, [graph]);

  if (poles.length === 0) return null;
  return (
    <group>
      <Instanced matrices={poles} castShadow>
        <cylinderGeometry args={[0.07, 0.09, 3.5, 8]} />
        <meshStandardMaterial color="#5d6267" roughness={0.5} metalness={0.6} />
      </Instanced>
      <Instanced matrices={heads} castShadow>
        <boxGeometry args={[0.44, 1.2, 0.3]} />
        <meshStandardMaterial color="#1d1f22" roughness={0.6} />
      </Instanced>
      <Instanced matrices={stops}>
        <boxGeometry args={[1, 0.01, 0.4]} />
        <meshStandardMaterial color="#f3f0e7" roughness={0.55} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />
      </Instanced>
    </group>
  );
}

function Instanced({
  matrices,
  children,
  castShadow,
}: {
  matrices: THREE.Matrix4[];
  children: React.ReactNode;
  castShadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    setInstances(mesh, matrices);
  }, [matrices]);
  return (
    <instancedMesh
      key={matrices.length}
      ref={ref}
      args={[undefined, undefined, Math.max(1, matrices.length)]}
      castShadow={castShadow}
      receiveShadow
      frustumCulled={false}
    >
      {children}
    </instancedMesh>
  );
}

function setInstances(mesh: THREE.InstancedMesh, matrices: THREE.Matrix4[]) {
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.count = matrices.length;
  mesh.instanceMatrix.needsUpdate = true;
}

/** Instance colours must exist before the first render so the paint shader compiles with them. */
function ensureInstanceColor(mesh: THREE.InstancedMesh | null) {
  if (mesh && !mesh.instanceColor) {
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3).fill(1), 3);
  }
}

/* ---------- car lights at night: headlights, tail lights and a pool of light on the road ---------- */

const HEADLIGHT_GEOMETRY = new THREE.BoxGeometry(0.34, 0.14, 0.06);
const HEADLIGHT_MATERIAL = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 3.4, 3.0), toneMapped: false });
const TAILLIGHT_MATERIAL = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 0.2, 0.08), toneMapped: false });
const BEAM_GEOMETRY = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
/** Soft wedge of light fading away from the car (canvas gradient). */
function beamTexture() {
  const cv = document.createElement("canvas");
  cv.width = 64;
  cv.height = 128;
  const g = cv.getContext("2d")!;
  // Canvas top (v = 1) ends up at the car (plane +y → −z after rotateX(−π/2)): bright and
  // narrow there, wide and faint at the far end (bottom).
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, "rgba(255,240,200,0.9)");
  grad.addColorStop(0.5, "rgba(255,240,200,0.35)");
  grad.addColorStop(1, "rgba(255,240,200,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(22, 0);
  g.lineTo(42, 0);
  g.lineTo(64, 128);
  g.lineTo(0, 128);
  g.closePath();
  g.fill();
  // Soft sides: fade the wedge out towards its left and right edges.
  const side = g.createLinearGradient(0, 0, 64, 0);
  side.addColorStop(0, "rgba(0,0,0,0)");
  side.addColorStop(0.35, "rgba(0,0,0,1)");
  side.addColorStop(0.65, "rgba(0,0,0,1)");
  side.addColorStop(1, "rgba(0,0,0,0)");
  g.globalCompositeOperation = "destination-in";
  g.fillStyle = side;
  g.fillRect(0, 0, 64, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let beamMaterial: THREE.MeshBasicMaterial | null = null;
const BEAM_MATERIAL = () =>
  (beamMaterial ??= new THREE.MeshBasicMaterial({
    map: beamTexture(),
    color: new THREE.Color(1.2, 1.1, 0.9),
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -8,
  }));
const BEAM_LENGTH = 9;
const BEAM_WIDTH = 3.2;

interface CarLights {
  head: THREE.InstancedMesh | null;
  tail: THREE.InstancedMesh | null;
  beam: THREE.InstancedMesh | null;
}

const lightPos = new THREE.Vector3();
const lightScale = new THREE.Vector3();

/** Writes the lamp instances of every car (nothing by day). */
function drawCarLights(cars: Car[], lights: CarLights) {
  const night = NIGHT.value;
  let n = 0;
  let b = 0;
  if (night > 0.05) {
    for (const car of cars) {
      // Wrecks have no lights on.
      if (car.skew) continue;
      const [length, width, height] = VEHICLES[car.type].size;
      quat.setFromAxisAngle(up, car.yaw);
      for (const side of [-1, 1]) {
        lightPos.set(side * width * 0.32, height * 0.42, length / 2 - 0.02).applyQuaternion(quat).add(car.pos);
        lampMatrix.compose(lightPos, quat, one);
        lights.head?.setMatrixAt(n, lampMatrix);
        lightPos.set(side * width * 0.34, height * 0.5, -length / 2 + 0.02).applyQuaternion(quat).add(car.pos);
        lampMatrix.compose(lightPos, quat, one);
        lights.tail?.setMatrixAt(n, lampMatrix);
        n++;
      }
      // The pool of light lies on the road ahead of the bonnet.
      lightPos.set(0, 0.03, length / 2 + BEAM_LENGTH / 2 - 0.5).applyQuaternion(quat).add(car.pos);
      lightScale.set(BEAM_WIDTH, 1, BEAM_LENGTH);
      lampMatrix.compose(lightPos, quat, lightScale);
      lights.beam?.setMatrixAt(b++, lampMatrix);
    }
  }
  for (const mesh of [lights.head, lights.tail]) {
    if (!mesh) continue;
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }
  if (lights.beam) {
    lights.beam.count = b;
    lights.beam.instanceMatrix.needsUpdate = true;
    (lights.beam.material as THREE.MeshBasicMaterial).opacity = 0.45 * night;
  }
  HEADLIGHT_MATERIAL.color.setRGB(3.5 * night, 3.4 * night, 3.0 * night);
  TAILLIGHT_MATERIAL.color.setRGB(3.0 * night, 0.2 * night, 0.08 * night);
}

/** Eases every car towards its lane pose and writes the instance matrices per type. */
function drawCars(graph: LaneGraph, cars: Car[], meshes: (THREE.InstancedMesh | null)[], dt: number) {
  const counts = new Array(VEHICLES.length).fill(0);
  const k = 1 - Math.exp(-EASE * dt);
  for (let ci = 0; ci < cars.length; ci++) {
    const car = cars[ci];
    const edge = graph.edges[car.edge];
    if (!edge) continue;
    const passing = car.role && !car.parked ? passingTraffic(graph, cars, car) : 0;
    edgePose(edge, car.x, car.lane + laneShift(car, passing), target, heading);
    target.y += RIDE_HEIGHT;
    car.pos.lerp(target, k);
    // Shortest-way yaw easing (a wreck keeps its skew).
    const yaw = Math.atan2(heading.x, heading.z) + (car.skew ?? 0);
    const dy = Math.atan2(Math.sin(yaw - car.yaw), Math.cos(yaw - car.yaw));
    car.yaw += dy * k;

    const mesh = meshes[car.type];
    if (!mesh) continue;
    quat.setFromAxisAngle(up, car.yaw);
    const [length, width, height] = VEHICLES[car.type].size;
    scale.set(width, height, length);
    matrix.compose(car.pos, quat, scale);
    const slot = counts[car.type]++;
    mesh.setMatrixAt(slot, matrix);
    // Stable paint per car (by its index in the fleet).
    mesh.setColorAt(slot, PAINT_POOL[(ci * 7919 + 13) % PAINT_POOL.length]);
  }
  meshes.forEach((mesh, i) => {
    if (!mesh) return;
    mesh.count = counts[i];
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
}

/* ---------- emergency missions: police to accidents, fire engines to house fires ---------- */

/** Seconds a vehicle works at the scene (real time, like the traffic); the ambulance loads the patient. */
const ON_SITE_SECONDS = { accident: 45, fire: 60 } as const;
const AMBULANCE_SECONDS = 30;
/** Seconds after which a mission without a drivable route counts as done anyway. */
const NO_ROUTE_SECONDS = 12;
/** The patrol car at a fire stays this long after the fire engine has left. */
const POLICE_LINGER = 8;

/**
 * Which vehicle of an incident: the main unit (police at an accident, fire engine at a fire),
 * the ambulance (reports `ambulanceDone`) or the patrol car closing the street at a fire
 * (reports `policeDone`).
 */
type Unit = "main" | "ambulance" | "police";

interface Mission {
  id: string;
  kind: Incident["kind"];
  unit: Unit;
  car: Car;
  phase: "out" | "onsite" | "back";
  timer: number;
  /** Edge and progress of the station's driveway, and of the scene. */
  home: { edge: number; x: number };
  site: { edge: number; x: number };
  /** Wreck car of an accident (shared with `syncWrecks`; blocks the lane until the police has cleared it). */
  wreck: Car | null;
  /** Cones and debris at the scene (instance matrices), placed on arrival. */
  cones: THREE.Matrix4[];
  debris: { type: number; m: THREE.Matrix4 }[];
}

/** Station driveway: the middle of the plot's front edge, out on the street. */
function stationExit(graph: LaneGraph, station: Building) {
  const [, d] = sizeOf(station);
  const fx = station.x - Math.sin(station.rot) * (d / 2 + 4);
  const fz = station.z - Math.cos(station.rot) * (d / 2 + 4);
  return nearestEdge(graph, fx, fz, ["street"]);
}

const BLUE_ON = new THREE.Color(0.25, 0.7, 6);
const BLUE_OFF = new THREE.Color(0.02, 0.05, 0.25);

/** Scatters cones (and debris for a crash) around the scene; all on the lane surface. */
function cordon(graph: LaneGraph, mission: Mission, rnd: () => number) {
  const edge = graph.edges[mission.site.edge];
  const pos = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const coneScale = new THREE.Vector3(...PROPS[CONE].size);
  const lane = mission.car.lane;
  const cones: THREE.Matrix4[] = [];
  const put = (x: number, off: number) => {
    edgePose(edge, x, off, pos, dir);
    q.setFromAxisAngle(up, rnd() * Math.PI);
    cones.push(new THREE.Matrix4().compose(pos, q, coneScale));
  };
  if (mission.kind === "accident") {
    // A diagonal row of cones closing the lane behind the police car, and some around the wreck.
    const behind = mission.car.x - 4;
    for (let i = 0; i < 5; i++) put(behind - i * 2.2, lane + 1.9 - i * 0.9);
    const w = mission.wreck ? mission.wreck.x : mission.site.x;
    put(w + 4, lane - 1.6);
    put(w + 4.5, lane + 1.5);
    put(w + 7, lane);
    // Debris around the wreck.
    const debris: Mission["debris"] = [];
    for (let i = 1; i < PROPS.length; i++) {
      edgePose(edge, w - 2 + rnd() * 6, lane - 2.2 + rnd() * 4.4, pos, dir);
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      debris.push({ type: i, m: new THREE.Matrix4().compose(pos, q, new THREE.Vector3(...PROPS[i].size)) });
    }
    mission.debris = debris;
  } else {
    // Cones along the kerb around the fire engine.
    const kerb = lane + 2.3;
    for (let i = 0; i < 6; i++) put(mission.car.x - 7 + i * 3.2, i === 0 || i === 5 ? kerb - 1.2 : kerb);
  }
  mission.cones = cones;
}

/**
 * Every accident has a wreck on the lane, attended or not (unattended ones block the road for
 * a long time – that is the point of a police station). Wrecks vanish with their incident.
 */
function syncWrecks(graph: LaneGraph, wrecks: Map<string, Car>, cars: Car[], incidents: Incident[]) {
  const live = new Set(incidents.filter((i) => i.kind === "accident").map((i) => i.id));
  for (const [id, wreck] of wrecks) {
    if (live.has(id)) continue;
    const wi = cars.indexOf(wreck);
    if (wi >= 0) cars.splice(wi, 1);
    wrecks.delete(id);
  }
  for (const inc of incidents) {
    if (inc.kind !== "accident" || wrecks.has(inc.id)) continue;
    const site = nearestEdge(graph, inc.x, inc.z, ["street", "highway"]);
    if (!site) continue;
    const edge = graph.edges[site.edge];
    const wreck = placeCar(graph, site.edge, Math.max(2, Math.min(edge.length - 2, site.x)), edge.lanes[0], SEDAN_TYPE, { parked: true, skew: 0.55 });
    wreck.yaw += 0.55;
    cars.push(wreck);
    wrecks.set(inc.id, wreck);
  }
}

/**
 * Keeps the missions in step with the store's incidents: new attended incidents get a vehicle
 * leaving its station, incidents that vanished (house demolished, station gone) recall it.
 */
function syncMissions(graph: LaneGraph, missions: Mission[], cars: Car[], incidents: Incident[], buildings: Building[], wrecks: Map<string, Car>) {
  const live: Record<Unit, Set<string>> = {
    main: new Set(incidents.filter((i) => i.station && !i.cleared).map((i) => i.id)),
    ambulance: new Set(incidents.filter((i) => i.ambulance && !i.ambulanceDone).map((i) => i.id)),
    police: new Set(incidents.filter((i) => i.police && !i.policeDone).map((i) => i.id)),
  };
  for (let m = missions.length - 1; m >= 0; m--) {
    const mission = missions[m];
    if (mission.phase !== "back" && !live[mission.unit].has(mission.id)) removeMission(missions, cars, m);
  }
  for (const inc of incidents) {
    for (const unit of ["main", "ambulance", "police"] as const) {
      if (live[unit].has(inc.id) && !missions.some((m) => m.id === inc.id && m.unit === unit)) startMission(graph, missions, cars, inc, buildings, wrecks, unit);
    }
  }
}

/** Sends a vehicle from its station (or the hospital) to the scene. */
function startMission(graph: LaneGraph, missions: Mission[], cars: Car[], inc: Incident, buildings: Building[], wrecks: Map<string, Car>, unit: Unit) {
  const ambulance = unit === "ambulance";
  const station = buildings.find((b) => b.id === (unit === "ambulance" ? inc.ambulance : unit === "police" ? inc.police : inc.station));
  if (!station) return;
  const home = stationExit(graph, station);
  // The scene lies on both travel directions of its road: take the one reached sooner.
  let site: { edge: number; x: number } | null = null;
  let route: number[] | null = null;
  let bestLength = Infinity;
  for (const option of home ? nearestEdges(graph, inc.x, inc.z, ["street", "highway"]) : []) {
    const r = routeEdges(graph, home!.edge, option.edge);
    const length = r ? r.reduce((s, e) => s + graph.edges[e].length, 0) + (r.length === 1 && option.x < home!.x ? 1e6 : 0) : Infinity;
    if (!site || length < bestLength) {
      site = option;
      route = r;
      bestLength = length;
    }
  }
  if (!home || !site) return;
  const police = unit === "police" || (unit === "main" && inc.kind === "accident");
  const type = ambulance ? AMBULANCE_TYPE : police ? POLICE_TYPE : FIRE_TYPE;
  const siteEdge = graph.edges[site.edge];
  // The wreck lies on the first edge found for the scene; the police may arrive on the other
  // travel direction, so the mission keeps its own reference only when it is on the same edge.
  const wreck = inc.kind === "accident" ? (wrecks.get(inc.id) ?? null) : null;
  const wreckAhead = wreck && wreck.edge === site.edge ? wreck.x : null;
  // Stop behind the wreck (accident) or at the house (fire); the ambulance stops past the scene,
  // the patrol car at a fire behind the fire engine.
  const offset = ambulance ? (inc.kind === "accident" ? -10 : -11) : unit === "police" ? 13 : inc.kind === "accident" ? 9 : 2;
  const stopAt = Math.max(1, Math.min(siteEdge.length - 1, (wreckAhead ?? site.x) - offset));
  const car = placeCar(graph, home.edge, home.x, graph.edges[home.edge].lanes[0], type, {
    role: ambulance ? "ambulance" : police ? "police" : "fire",
    route: route ?? undefined,
    routeAt: 0,
    stopAt: route ? (route.length === 1 && stopAt < home.x ? home.x : stopAt) : home.x,
    next: route && route.length > 1 ? route[1] : null,
    // No way there: it stays at the station (and the incident counts as handled after a while).
    parked: !route,
  });
  // Same edge but the scene lies behind the driveway: drive round the block if possible.
  if (route && route.length === 1 && stopAt < home.x) {
    const loop = loopRoute(graph, home.edge);
    if (loop) {
      car.route = loop;
      car.next = loop[1];
      car.stopAt = stopAt;
    }
  }
  cars.push(car);
  missions.push({ id: inc.id, kind: inc.kind, unit, car, phase: "out", timer: route ? 0 : NO_ROUTE_SECONDS, home, site: { edge: site.edge, x: stopAt }, wreck: unit === "main" ? wreck : null, cones: [], debris: [] });
}

/** A route leaving an edge and coming back onto it (round the block), or null. */
function loopRoute(graph: LaneGraph, edge: number): number[] | null {
  let best: number[] | null = null;
  for (const n of graph.outgoing.get(graph.edges[edge].to) ?? []) {
    const r = routeEdges(graph, n, edge);
    if (r && (!best || r.length < best.length)) best = [edge, ...r];
  }
  return best;
}

function removeMission(missions: Mission[], cars: Car[], m: number) {
  const mission = missions[m];
  const ci = cars.indexOf(mission.car);
  if (ci >= 0) cars.splice(ci, 1);
  missions.splice(m, 1);
}

/** Advances the missions: arrival, working at the scene, return to the station. */
function stepMissions(
  graph: LaneGraph,
  missions: Mission[],
  cars: Car[],
  dt: number,
  rnd: () => number,
  onSite: (id: string) => void,
  resolve: (id: string) => void,
  ambulanceDone: (id: string) => void,
  policeDone: (id: string) => void,
) {
  for (let m = missions.length - 1; m >= 0; m--) {
    const mission = missions[m];
    const car = mission.car;
    const finish = mission.unit === "ambulance" ? ambulanceDone : mission.unit === "police" ? policeDone : resolve;
    if (mission.phase === "out") {
      // No route: the vehicle "handles it" off screen after a moment.
      if (!car.route) {
        mission.timer -= dt;
        if (mission.timer <= 0) {
          finish(mission.id);
          removeMission(missions, cars, m);
        }
        continue;
      }
      if (car.parked) {
        mission.phase = "onsite";
        mission.timer = mission.unit === "ambulance" ? AMBULANCE_SECONDS : mission.unit === "police" ? POLICE_LINGER : ON_SITE_SECONDS[mission.kind];
        if (mission.unit === "main") {
          cordon(graph, mission, rnd);
          onSite(mission.id);
        }
      }
    } else if (mission.phase === "onsite") {
      mission.timer -= dt;
      // The patrol car at a fire keeps the street closed while the fire brigade is coming or at work.
      if (mission.unit === "police" && missions.some((o) => o.id === mission.id && o.unit === "main" && o.phase !== "back")) mission.timer = POLICE_LINGER;
      if (mission.timer <= 0) {
        // Cleared: the wreck is towed (with the incident, see syncWrecks), the fire is out, the
        // patient is on board. Drive home.
        finish(mission.id);
        mission.cones = [];
        mission.debris = [];
        mission.wreck = null;
        const back = routeEdges(graph, car.edge, mission.home.edge) ?? (car.edge === mission.home.edge ? loopRoute(graph, car.edge) : null);
        if (!back || (back.length === 1 && mission.home.x < car.x)) {
          removeMission(missions, cars, m);
          continue;
        }
        car.parked = false;
        car.route = back;
        car.routeAt = 0;
        car.next = back[1] ?? null;
        car.stopAt = mission.home.x;
        mission.phase = "back";
      }
    } else if (car.parked || !graph.edges[car.edge]) {
      removeMission(missions, cars, m);
    }
  }
}

/** A street closed at an incident: the scene on each travel direction, cones across both entries. */
interface Closure {
  sites: { edge: number; x: number }[];
  cones: THREE.Matrix4[];
}

/**
 * Full closure while any vehicle of an incident stands at the scene: both travel directions of
 * the street from junction to junction. Cars on it turn round, the rest is diverted
 * (`closeStreet`, `stepCars`). Returns the closed edges.
 */
function syncClosures(graph: LaneGraph, missions: Mission[], closures: Map<string, Closure>, cars: Car[], incidents: Incident[], rnd: () => number) {
  const active = new Set<string>();
  for (const m of missions) if (m.phase === "onsite") active.add(m.id);
  for (const id of closures.keys()) if (!active.has(id)) closures.delete(id);
  for (const id of active) {
    if (closures.has(id)) continue;
    const inc = incidents.find((i) => i.id === id);
    if (!inc) continue;
    const sites = nearestEdges(graph, inc.x, inc.z, ["street", "highway"]).map((o) => ({ edge: o.edge, x: o.x }));
    closeStreet(graph, cars, sites);
    // A row of cones across the carriageway at the entry of each travel direction.
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3(...PROPS[CONE].size);
    const cones: THREE.Matrix4[] = [];
    for (const site of sites) {
      const edge = graph.edges[site.edge];
      const x = Math.min(5, edge.length * 0.25);
      const width = Math.max(...edge.lanes) + 1.6;
      for (let off = 0.3; off <= width; off += 0.9) {
        edgePose(edge, x + (off / width) * 1.5, off, pos, dir);
        q.setFromAxisAngle(up, rnd() * Math.PI);
        cones.push(new THREE.Matrix4().compose(pos, q, scale));
      }
    }
    closures.set(id, { sites, cones });
  }
  const closed = new Set<number>();
  for (const c of closures.values()) for (const s of c.sites) closed.add(s.edge);
  return closed;
}

/** Writes the cordon props and the blue lights of all missions. */
function drawScenes(missions: Mission[], closures: Map<string, Closure>, props: (THREE.InstancedMesh | null)[], lamps: THREE.InstancedMesh | null, t: number) {
  const counts = new Array(PROPS.length).fill(0);
  const cones = props[CONE];
  const putCone = (m: THREE.Matrix4) => {
    if (cones && counts[CONE] < MAX_CONES) cones.setMatrixAt(counts[CONE]++, m);
  };
  for (const mission of missions) {
    mission.cones.forEach(putCone);
    for (const d of mission.debris) props[d.type]?.setMatrixAt(counts[d.type]++, d.m);
  }
  for (const c of closures.values()) c.cones.forEach(putCone);
  props.forEach((mesh, i) => {
    if (!mesh) return;
    mesh.count = counts[i];
    mesh.instanceMatrix.needsUpdate = true;
  });
  if (!lamps) return;
  let n = 0;
  const flash = Math.floor(t * 5) % 2 === 0;
  for (const mission of missions) {
    const car = mission.car;
    const [length, width, height] = VEHICLES[car.type].size;
    quat.setFromAxisAngle(up, car.yaw);
    for (const side of [-1, 1]) {
      lampPos.set(side * width * 0.28, height + 0.12, length * 0.12).applyQuaternion(quat).add(car.pos);
      lampMatrix.compose(lampPos, quat, one);
      lamps.setMatrixAt(n, lampMatrix);
      lamps.setColorAt(n, (side < 0) === flash ? BLUE_ON : BLUE_OFF);
      n++;
    }
  }
  lamps.count = n;
  lamps.instanceMatrix.needsUpdate = true;
  if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
}

const LAMP_BOX = new THREE.BoxGeometry(0.3, 0.2, 0.36);
/** Cars drawn at most (traffic cap plus wrecks and emergency vehicles). */
const MAX_CARS_DRAWN = 160;
const BLUE_LAMP_MATERIAL = new THREE.MeshBasicMaterial({ toneMapped: false });
const MAX_MISSIONS = 12;
/** Cones: the scenes' own plus two rows per closed street (a motorway row is wide). */
const MAX_CONES = 30 * MAX_MISSIONS;

/** Autonomous cars on all finished streets, motorways and ramps. */
export function Traffic() {
  const roads = useCity((s) => s.roads);
  const jobs = useCity((s) => s.jobs);
  const profiles = useProfiles();
  const models = useCarModels();
  const propModels = usePropModels();

  const graph = useMemo(
    () => buildLaneGraph(roads.filter((r) => !jobs.includes(r.id)), profiles),
    [roads, jobs, profiles],
  );

  const cars = useRef<Car[]>([]);
  const missions = useRef<Mission[]>([]);
  const wrecks = useRef<Map<string, Car>>(new Map());
  const closures = useRef<Map<string, Closure>>(new Map());
  const rnd = useRef(mulberry32(99));
  useEffect(() => {
    cars.current = spawnCars(graph, carTarget(graph), TYPE_POOL, graph.edges.length);
    // A new graph invalidates every edge index: missions start over from their stations.
    missions.current = [];
    wrecks.current = new Map();
    closures.current = new Map();
  }, [graph]);

  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  useEffect(
    () => () => {
      for (const m of models) m.geometry.dispose();
    },
    [models],
  );

  const time = useRef(0);
  const lamps = useRef<(THREE.InstancedMesh | null)[]>([]);
  const props = useRef<(THREE.InstancedMesh | null)[]>([]);
  const blueLamps = useRef<THREE.InstancedMesh | null>(null);
  const carLights = useRef<CarLights>({ head: null, tail: null, beam: null });
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    time.current += dt;
    // Incidents and buildings are read from the store directly: no re-render per change.
    const store = useCity.getState();
    syncWrecks(graph, wrecks.current, cars.current, store.incidents);
    syncMissions(graph, missions.current, cars.current, store.incidents, store.buildings, wrecks.current);
    const closed = syncClosures(graph, missions.current, closures.current, cars.current, store.incidents, rnd.current);
    stepCars(graph, cars.current, dt, rnd.current, time.current, closed);
    stepMissions(graph, missions.current, cars.current, dt, rnd.current, store.incidentOnSite, store.resolveIncident, store.ambulanceDone, store.policeDone);
    drawCars(graph, cars.current, meshes.current, dt);
    drawCarLights(cars.current, carLights.current);
    drawLights(graph, lamps.current, time.current);
    drawScenes(missions.current, closures.current, props.current, blueLamps.current, time.current);
    if ((process.env.NODE_ENV !== "production" || window.location.search.includes("bench"))) (window as unknown as { __traffic?: unknown }).__traffic = { graph, missions: missions.current, cars: cars.current, closures: closures.current };
  });

  const heads = useMemo(() => graph.signals.flatMap((sig) => sig.heads), [graph]);

  return (
    <group>
      <SignalHardware graph={graph} />
      {heads.length > 0 &&
        LAMPS.map((lamp, i) => (
          <instancedMesh
            key={`${lamp.name}-${heads.length}`}
            ref={(el) => {
              lamps.current[i] = el;
            }}
            args={[LAMP_GEOMETRY, LAMP_MATERIAL, heads.length]}
            frustumCulled={false}
          />
        ))}
      {models.map((m, i) => (
        <instancedMesh
          key={VEHICLES[i].file}
          ref={(el) => {
            meshes.current[i] = el;
            ensureInstanceColor(el);
          }}
          args={[m.geometry, m.material, 200]}
          count={0}
          castShadow
          receiveShadow
          frustumCulled={false}
        />
      ))}
      {propModels.map((m, i) => (
        <instancedMesh
          key={PROPS[i].file}
          ref={(el) => {
            props.current[i] = el;
          }}
          args={[m.geometry, m.material, i === CONE ? MAX_CONES : MAX_MISSIONS]}
          count={0}
          castShadow
          receiveShadow
          frustumCulled={false}
        />
      ))}
      <instancedMesh
        ref={(el) => {
          blueLamps.current = el;
          ensureInstanceColor(el);
        }}
        args={[LAMP_BOX, BLUE_LAMP_MATERIAL, 2 * MAX_MISSIONS]}
        count={0}
        frustumCulled={false}
      />
      {/* Car lights at night (two head and two tail lamps per car, a pool of light ahead). */}
      <instancedMesh
        ref={(el) => {
          carLights.current.head = el;
        }}
        args={[HEADLIGHT_GEOMETRY, HEADLIGHT_MATERIAL, 2 * MAX_CARS_DRAWN]}
        count={0}
        frustumCulled={false}
      />
      <instancedMesh
        ref={(el) => {
          carLights.current.tail = el;
        }}
        args={[HEADLIGHT_GEOMETRY, TAILLIGHT_MATERIAL, 2 * MAX_CARS_DRAWN]}
        count={0}
        frustumCulled={false}
      />
      <instancedMesh
        ref={(el) => {
          carLights.current.beam = el;
        }}
        args={[BEAM_GEOMETRY, BEAM_MATERIAL(), MAX_CARS_DRAWN]}
        count={0}
        frustumCulled={false}
        renderOrder={2}
      />
    </group>
  );
}
