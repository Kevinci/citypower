import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32 } from "@/lib/city/random";
import { useCity } from "@/lib/city/store";
import {
  buildLaneGraph,
  carTarget,
  edgePose,
  lightState,
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
] as const;

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

/** Eases every car towards its lane pose and writes the instance matrices per type. */
function drawCars(graph: LaneGraph, cars: Car[], meshes: (THREE.InstancedMesh | null)[], dt: number) {
  const counts = new Array(VEHICLES.length).fill(0);
  const k = 1 - Math.exp(-EASE * dt);
  for (let ci = 0; ci < cars.length; ci++) {
    const car = cars[ci];
    const edge = graph.edges[car.edge];
    if (!edge) continue;
    edgePose(edge, car.x, car.lane, target, heading);
    target.y += RIDE_HEIGHT;
    car.pos.lerp(target, k);
    // Shortest-way yaw easing.
    const yaw = Math.atan2(heading.x, heading.z);
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

/** Autonomous cars on all finished streets, motorways and ramps. */
export function Traffic() {
  const roads = useCity((s) => s.roads);
  const jobs = useCity((s) => s.jobs);
  const profiles = useProfiles();
  const models = useCarModels();

  const graph = useMemo(
    () => buildLaneGraph(roads.filter((r) => !jobs.includes(r.id)), profiles),
    [roads, jobs, profiles],
  );

  const cars = useRef<Car[]>([]);
  const rnd = useRef(mulberry32(99));
  useEffect(() => {
    cars.current = spawnCars(graph, carTarget(graph), TYPE_POOL, graph.edges.length);
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
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    time.current += dt;
    stepCars(graph, cars.current, dt, rnd.current, time.current);
    drawCars(graph, cars.current, meshes.current, dt);
    drawLights(graph, lamps.current, time.current);
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
    </group>
  );
}
