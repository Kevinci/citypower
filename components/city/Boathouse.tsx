import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { sizeOf, type Building } from "@/lib/city/economy";
import { BOAT_JETTY } from "@/lib/city/placement";
import { mulberry32 } from "@/lib/city/random";
import { useCity } from "@/lib/city/store";
import { sampleDepth, WATER_LEVEL, WET_DEPTH, type DepthGrid } from "@/lib/city/terrain";

/**
 * The mayor's boathouse (16 × 26 m plot, street side at −z, jetty at +z out over the water).
 *
 * Level 1 Bootshaus: timber boathouse with a gable roof, white-framed windows with mullions,
 * flower boxes, door with a lantern, stone chimney; terrace, steps down to the jetty, an
 * L-shaped jetty head (to the left – the sports boat's way out on the right stays clear).
 * Level 2 Bootshaus mit Lounge: pergola with sofas on the lake terrace, loungers on the jetty.
 * Level 3 Luxus-Bootshaus: a motor yacht moored off the jetty head, hot tub, flag, more lights.
 *
 * The sports boat casts off now and then (real time, stopped while paused), runs a lap on a
 * circle that lies in open water (found once from the depth grid) and comes back.
 */

const GROUNDED = { base: true };
const JETTY_W = 3;

let mats: ReturnType<typeof makeMaterials> | null = null;
function makeMaterials() {
  const std = (color: string, roughness = 0.8, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  return {
    timber: std("#c08a56"),
    boards: std("#a8744a"),
    frame: std("#f6f4ee", 0.6),
    roof: std("#3d4650", 0.7, { side: THREE.DoubleSide }),
    stone: std("#9c968c", 0.9),
    door: std("#2f5d50", 0.6),
    deck: std("#9c7046", 0.9),
    post: std("#5e4630", 0.9),
    glass: std("#2a3a4c", 0.12, { metalness: 0.4, emissive: new THREE.Color("#ffcf7a"), emissiveIntensity: 0.25 }),
    terrace: std("#d8cdb3", 0.9),
    lantern: new THREE.MeshStandardMaterial({ color: "#fff3c4", emissive: new THREE.Color("#ffd27a"), emissiveIntensity: 1.2, toneMapped: false }),
    flowers: std("#d6334f", 0.8),
    leaves: std("#3f8f3a", 0.8),
    sofa: std("#f0ece2", 0.8),
    cushion: std("#1a8fc8", 0.8),
    water: std("#5fd0ee", 0.1, { emissive: new THREE.Color("#2aa6c9"), emissiveIntensity: 0.35 }),
    flag: std("#c0272d", 0.7, { side: THREE.DoubleSide }),
    hull: std("#f6f6f4", 0.35),
    stripe: std("#1a3d7a", 0.4),
    teak: std("#a0703f", 0.7),
    seat: std("#efe9de", 0.7),
    engine: std("#22262b", 0.4, { metalness: 0.5 }),
    tinted: std("#1c2733", 0.1, { metalness: 0.5 }),
    windshield: std("#9cc9e6", 0.05, { metalness: 0.2, transparent: true, opacity: 0.6 }),
    wake: new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.45, depthWrite: false }),
  };
}
const materials = () => (mats ??= makeMaterials());

const unit = new THREE.BoxGeometry(1, 1, 1);
type B = [x: number, z: number, w: number, d: number, y0: number, y1: number];
function Boxes({ list, m, shadow = true }: { list: B[]; m: THREE.Material; shadow?: boolean }) {
  const geometry = useMemo(
    () => (list.length ? mergeGeometries(list.map(([x, z, w, d, y0, y1]) => unit.clone().scale(w, Math.max(0.01, y1 - y0), d).translate(x, (y0 + y1) / 2, z)))! : new THREE.BufferGeometry()),
    [list],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} material={m} castShadow={shadow} receiveShadow />;
}

/* ---------- house ---------- */

/** House footprint (local): x −6..5, z from the front at −12 to −4 (water side). */
const HX0 = -6;
const HX1 = 5;
const HZ0 = -12;
const HZ1 = -4;
const WALL = 3.2;
const RIDGE = 2.3;

/** A window or glass door: white frame, glass, cross mullions; on a wall facing ±z or ±x. */
function windowParts(out: { frame: B[]; glass: B[] }, x: number, z: number, w: number, y0: number, y1: number, facing: "z-" | "z+" | "x-" | "x+", door = false) {
  const along = facing[0] === "z";
  const sign = facing[1] === "+" ? 1 : -1;
  const f = 0.09;
  const box = (off: number, a: number, wa: number, ya: number, yb: number, depth: number, list: B[]) =>
    list.push(along ? [a, z + sign * off, wa, depth, ya, yb] : [x + sign * off, a, depth, wa, ya, yb]);
  const c = along ? x : z;
  box(0.04, c, w + 2 * f, y0 - f, y1 + f, 0.1, out.frame);
  box(0.07, c, w, y0, y1, 0.08, out.glass);
  // Mullions: a cross on windows, a middle bar on glass doors.
  box(0.12, c, 0.06, y0, y1, 0.04, out.frame);
  if (!door) box(0.12, c, w, (y0 + y1) / 2 - 0.03, (y0 + y1) / 2 + 0.03, 0.04, out.frame);
  // Sill.
  box(0.12, c, w + 0.3, y0 - f - 0.06, y0 - f, 0.18, out.frame);
}

function houseParts() {
  const out = { frame: [] as B[], glass: [] as B[] };
  const walls: B[] = [[(HX0 + HX1) / 2, (HZ0 + HZ1) / 2, HX1 - HX0, HZ1 - HZ0, 0, WALL]];
  // Vertical board battens on the long walls.
  const boards: B[] = [];
  for (let x = HX0 + 0.3; x < HX1; x += 0.7) {
    boards.push([x, HZ0 - 0.03, 0.08, 0.06, 0.1, WALL], [x, HZ1 + 0.03, 0.08, 0.06, 0.1, WALL]);
  }
  // Street side: door left, two windows; water side: wide glass doors and a window; one window per gable.
  const door: B[] = [[-3.8, HZ0 - 0.06, 1.1, 0.1, 0.05, 2.25]];
  out.frame.push([-3.8, HZ0 - 0.04, 1.35, 0.1, 0, 2.4]);
  windowParts(out, -0.6, HZ0, 1.5, 1.1, 2.4, "z-");
  windowParts(out, 2.6, HZ0, 1.5, 1.1, 2.4, "z-");
  windowParts(out, -2.2, HZ1, 4, 0.15, 2.6, "z+", true);
  windowParts(out, 2.8, HZ1, 1.6, 1.1, 2.4, "z+");
  windowParts(out, HX0, (HZ0 + HZ1) / 2, 1.4, 1.2, 2.3, "x-");
  windowParts(out, HX1, (HZ0 + HZ1) / 2, 1.4, 1.2, 2.3, "x+");
  // Flower boxes under the street windows.
  const flowerBox: B[] = [
    [-0.6, HZ0 - 0.25, 1.6, 0.3, 0.75, 0.95],
    [2.6, HZ0 - 0.25, 1.6, 0.3, 0.75, 0.95],
  ];
  const flowers: B[] = [];
  for (const cx of [-0.6, 2.6]) for (let k = -2; k <= 2; k++) flowers.push([cx + k * 0.3, HZ0 - 0.25, 0.18, 0.18, 0.95, 1.12]);
  const chimney: B[] = [[HX1 - 1.5, (HZ0 + HZ1) / 2 + 1.2, 0.8, 0.8, WALL, WALL + RIDGE + 0.6]];
  const lamp: B[] = [[-3.8 + 0.9, HZ0 - 0.15, 0.2, 0.2, 2.3, 2.6]];
  return { walls, boards, door, frame: out.frame, glass: out.glass, flowerBox, flowers, chimney, lamp };
}

/** Gable roof over the house, ridge along x, with overhang; white barge boards on the gables. */
function roofGeometry() {
  const o = 0.5;
  const halfD = (HZ1 - HZ0) / 2 + o;
  const shape = new THREE.Shape();
  shape.moveTo(-halfD, -0.25);
  shape.lineTo(halfD, -0.25);
  shape.lineTo(0, RIDGE);
  shape.closePath();
  const len = HX1 - HX0 + 2 * o;
  // Shape in (z, y), extruded along x.
  return new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false })
    .rotateY(Math.PI / 2)
    .translate(HX0 - o, WALL, (HZ0 + HZ1) / 2);
}

/* ---------- jetty, lounge, extras per level ---------- */

function siteParts(w: number, d: number, deckY: number, level: number) {
  const front = -d / 2;
  const shore = d / 2 - BOAT_JETTY;
  const back = d / 2;
  const jx = -w / 2 + 1.5 + JETTY_W / 2;
  const terrace: B[] = [[0, (front + shore) / 2, w, shore - front, 0, 0.12]];
  // Steps of ~0.3 m over the last 1.6 m of the terrace; the last one is level with the deck.
  const steps: B[] = [];
  const n = Math.round(Math.abs(deckY) / 0.3);
  for (let i = 0; i < n; i++) {
    const top = (deckY * (i + 1)) / n;
    steps.push([jx, shore - 1.6 + ((i + 0.5) * 1.6) / n, JETTY_W, 1.6 / n + 0.02, Math.min(top, 0) - 0.3, top]);
  }
  // Walkway out, and the head as an L to the left: the boat leaves on the right of the walkway.
  const headX0 = -w / 2;
  const headX1 = jx + JETTY_W / 2;
  const deck: B[] = [
    [jx, (shore + back - 1) / 2, JETTY_W, back - 1 - shore, deckY - 0.2, deckY],
    [(headX0 + headX1) / 2, back - 2, headX1 - headX0, 2.6, deckY - 0.2, deckY],
  ];
  const posts: B[] = [];
  for (let z = shore + 1; z <= back - 1; z += 2.5) for (const sx of [-1, 1]) posts.push([jx + sx * (JETTY_W / 2 - 0.15), z, 0.25, 0.25, deckY - 3, deckY + 0.15]);
  for (const x of [headX0 + 0.3, headX1 - 0.3]) posts.push([x, back - 0.9, 0.25, 0.25, deckY - 3, deckY + 0.9]);
  const lanterns: B[] = [
    [headX0 + 0.3, back - 0.9, 0.35, 0.35, deckY + 0.9, deckY + 1.3],
    [headX1 - 0.3, back - 0.9, 0.35, 0.35, deckY + 0.9, deckY + 1.3],
  ];
  if (level >= 3) for (let z = shore + 2; z < back - 3; z += 4) lanterns.push([jx - JETTY_W / 2 + 0.2, z, 0.25, 0.25, deckY, deckY + 0.6]);
  // Lounge (level 2+): pergola over the lake terrace with sofas; loungers on the jetty head.
  const pergolaPosts: B[] = [];
  const pergolaSlats: B[] = [];
  const sofas: B[] = [];
  const cushions: B[] = [];
  if (level >= 2) {
    const z0 = HZ1 + 0.3;
    const z1 = shore - 1.8;
    for (const x of [HX1 - 0.2, w / 2 - 0.4]) for (const z of [z0, z1]) pergolaPosts.push([x, z, 0.18, 0.18, 0.1, 2.7]);
    for (let x = HX1; x <= w / 2 - 0.4; x += 0.45) pergolaSlats.push([x, (z0 + z1) / 2, 0.08, z1 - z0 + 0.4, 2.7, 2.85]);
    const sx = (HX1 + w / 2) / 2;
    sofas.push([sx, z0 + 0.6, 2.2, 0.8, 0.1, 0.55], [sx, z0 + 0.25, 2.2, 0.2, 0.55, 0.95]);
    cushions.push([sx - 0.5, z0 + 0.45, 0.5, 0.15, 0.55, 0.9], [sx + 0.5, z0 + 0.45, 0.5, 0.15, 0.55, 0.9]);
    for (const lx of [headX0 + 1.2, headX0 + 2.6]) {
      sofas.push([lx, back - 2, 0.8, 1.9, deckY, deckY + 0.35]);
      cushions.push([lx, back - 2.1, 0.7, 1.6, deckY + 0.35, deckY + 0.42]);
    }
  }
  // Luxury (level 3): hot tub on the walkway, a flag pole on the head.
  const flagPole: B[] = level >= 3 ? [[headX0 + 0.4, back - 2.8, 0.12, 0.12, deckY, deckY + 6]] : [];
  // The sports boat's berth on the right of the walkway, bow out to the lake.
  const berth = { x: jx + JETTY_W / 2 + 2.7, z: (shore + back) / 2 - 0.5 };
  // The yacht lies off the jetty head, left of the boat's way out.
  const yacht = { x: headX0 - 3.5, z: back + 3.2 };
  return { terrace, steps, deck, posts, lanterns, pergolaPosts, pergolaSlats, sofas, cushions, flagPole, berth, yacht, tub: { x: jx, z: back - 5 } };
}

/* ---------- boats ---------- */

/** Sports boat (7 m): pointed white hull with a navy stripe, teak deck, windshield, seats, outboard. Bow at +z. */
function boatGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-1.2, 3.4);
  shape.lineTo(1.2, 3.4);
  shape.lineTo(1.25, -1.0);
  shape.quadraticCurveTo(1.0, -2.9, 0, -3.6);
  shape.quadraticCurveTo(-1.0, -2.9, -1.25, -1.0);
  shape.closePath();
  const slab = (y0: number, h: number, s: number) => new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2).scale(s, 1, s).translate(0, y0, 0);
  return { hull: slab(0, 0.75, 1), stripe: slab(0.4, 0.14, 1.012), deck: slab(0.75, 0.06, 0.9) };
}

function SportBoat({ boat }: { boat: RefObject<THREE.Group | null> }) {
  const m = materials();
  const g = useMemo(() => boatGeometry(), []);
  useEffect(
    () => () => {
      g.hull.dispose();
      g.stripe.dispose();
      g.deck.dispose();
    },
    [g],
  );
  return (
    <group ref={boat}>
      <mesh geometry={g.hull} material={m.hull} castShadow />
      <mesh geometry={g.stripe} material={m.stripe} />
      <mesh geometry={g.deck} material={m.teak} receiveShadow />
      <mesh geometry={unit} material={m.windshield} position={[0, 1.1, 0.9]} rotation={[-0.5, 0, 0]} scale={[2.0, 0.7, 0.06]} />
      <mesh geometry={unit} material={m.seat} position={[0, 1.05, -0.6]} scale={[1.8, 0.45, 0.9]} castShadow />
      <mesh geometry={unit} material={m.seat} position={[0, 1.0, -2.2]} scale={[2.0, 0.35, 1.2]} castShadow />
      <mesh geometry={unit} material={m.engine} position={[0, 0.6, -3.65]} scale={[0.6, 1.0, 0.5]} castShadow />
      <mesh name="wake" geometry={unit} material={m.wake} position={[0, 0.02, -7]} scale={[2.4, 0.01, 7]} />
    </group>
  );
}

/** Motor yacht (16 m): long white hull with a navy boot stripe, two decks with tinted windows, flybridge, teak aft deck. Bow at +z. */
function yachtGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-2.1, 7.6);
  shape.lineTo(2.1, 7.6);
  shape.lineTo(2.2, -2.5);
  shape.quadraticCurveTo(1.8, -6.5, 0, -8.4);
  shape.quadraticCurveTo(-1.8, -6.5, -2.2, -2.5);
  shape.closePath();
  const slab = (y0: number, h: number, s: number) => new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2).scale(s, 1, s).translate(0, y0, 0);
  return { hull: slab(0, 1.9, 1), stripe: slab(0.2, 0.35, 1.01), deck: slab(1.9, 0.08, 0.95) };
}

function Yacht({ x, z, yaw, y }: { x: number; z: number; yaw: number; y: number }) {
  const m = materials();
  const g = useMemo(() => yachtGeometry(), []);
  useEffect(
    () => () => {
      g.hull.dispose();
      g.stripe.dispose();
      g.deck.dispose();
    },
    [g],
  );
  const decks: B[] = [
    [0, -0.5, 3.4, 8, 1.98, 3.6],
    [0, -1.2, 2.8, 5, 3.6, 5.0],
  ];
  const windows: B[] = [
    [0, -0.5, 3.46, 7.4, 2.5, 3.2],
    [0, -1.2, 2.86, 4.4, 4.0, 4.6],
  ];
  const rails: B[] = [
    [1.9, 0.5, 0.06, 13, 1.98, 2.9],
    [-1.9, 0.5, 0.06, 13, 1.98, 2.9],
  ];
  return (
    <group position={[x, y, z]} rotation={[0, yaw, 0]}>
      <mesh geometry={g.hull} material={m.hull} castShadow />
      <mesh geometry={g.stripe} material={m.stripe} />
      <mesh geometry={g.deck} material={m.teak} receiveShadow />
      <Boxes list={decks} m={m.hull} />
      <Boxes list={windows} m={m.tinted} shadow={false} />
      <Boxes list={rails} m={m.frame} shadow={false} />
      <mesh geometry={unit} material={m.windshield} position={[0, 5.3, 0.6]} rotation={[-0.4, 0, 0]} scale={[2.6, 0.6, 0.05]} />
      <mesh geometry={unit} material={m.engine} position={[0, 6.2, -1.6]} scale={[0.15, 2.2, 0.15]} />
    </group>
  );
}

interface Trip {
  points: THREE.Vector3[];
  lengths: number[];
  total: number;
}

/** A lap from the berth out onto the lake and back, or null if there is no open water for one. */
function planTrip(berth: THREE.Vector3, dir: THREE.Vector3, grid: DepthGrid, clockwise: boolean): Trip | null {
  const wet = (x: number, z: number) => sampleDepth(grid, x, z) > WET_DEPTH + 0.6;
  // Out past the jetty head (and a moored yacht) before turning.
  const out = berth.clone().addScaledVector(dir, 24);
  for (let r = 80; r >= 14; r -= 6) {
    const c = out.clone().addScaledVector(dir, r + 4);
    let ok = true;
    for (let t = 6; t <= r + 4 && ok; t += 3) ok = wet(out.x + dir.x * t, out.z + dir.z * t);
    for (let k = 0; k < 36 && ok; k++) {
      const a = (k / 36) * Math.PI * 2;
      ok = wet(c.x + Math.cos(a) * (r + 7), c.z + Math.sin(a) * (r + 7));
    }
    if (!ok) continue;
    const points = [berth.clone(), out.clone()];
    const a0 = Math.atan2(out.z - c.z, out.x - c.x);
    for (let k = 0; k <= 40; k++) {
      const a = a0 + (clockwise ? -1 : 1) * (k / 40) * Math.PI * 2;
      points.push(new THREE.Vector3(c.x + Math.cos(a) * r, 0, c.z + Math.sin(a) * r));
    }
    points.push(out.clone(), berth.clone());
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]));
    return { points, lengths, total: lengths[lengths.length - 1] };
  }
  return null;
}

interface BoatState {
  mode: "docked" | "trip";
  wait: number;
  s: number;
  yaw: number;
  speed: number;
  t: number;
}

const tmp = new THREE.Vector3();
/** Advances the boat (real seconds) and writes its pose. */
function stepBoat(state: BoatState, boat: THREE.Group, trip: Trip | null, berth: THREE.Vector3, berthYaw: number, dt: number, rnd: () => number) {
  state.t += dt;
  if (state.mode === "docked") {
    state.wait -= dt;
    state.yaw += Math.atan2(Math.sin(berthYaw - state.yaw), Math.cos(berthYaw - state.yaw)) * Math.min(1, dt * 1.5);
    tmp.copy(berth);
    state.speed = 0;
    if (state.wait <= 0 && trip) {
      state.mode = "trip";
      state.s = 0;
    } else if (state.wait <= 0) state.wait = 60;
  } else if (trip) {
    // Slow at the jetty, fast out on the lake.
    const want = Math.min(11, 1.5 + state.s * 0.35, 1.5 + (trip.total - state.s) * 0.3);
    state.speed += (want - state.speed) * Math.min(1, dt * 1.2);
    state.s += state.speed * dt;
    if (state.s >= trip.total) {
      state.mode = "docked";
      state.wait = 40 + rnd() * 80;
      tmp.copy(berth);
    } else {
      let i = 1;
      while (i < trip.lengths.length - 1 && trip.lengths[i] < state.s) i++;
      const a = trip.points[i - 1];
      const b = trip.points[i];
      const f = (state.s - trip.lengths[i - 1]) / Math.max(1e-6, trip.lengths[i] - trip.lengths[i - 1]);
      tmp.lerpVectors(a, b, f);
      const want = Math.atan2(b.x - a.x, b.z - a.z);
      state.yaw += Math.atan2(Math.sin(want - state.yaw), Math.cos(want - state.yaw)) * Math.min(1, dt * 2.5);
    }
  }
  boat.position.set(tmp.x, WATER_LEVEL - 0.25 + Math.sin(state.t * 1.6) * 0.05, tmp.z);
  boat.rotation.set(-0.07 * (state.speed / 11), state.yaw, Math.sin(state.t * 1.1) * 0.02);
  const wake = boat.getObjectByName("wake");
  if (wake) {
    wake.visible = state.speed > 1;
    wake.scale.set(2.4, 0.01, 1 + state.speed * 0.8);
    wake.position.z = -3.6 - wake.scale.z / 2;
  }
}

export function BoathouseScene({ b, y, grid }: { b: Building; y: number; grid: DepthGrid }) {
  const m = materials();
  const [w, d] = sizeOf(b);
  const level = Math.max(1, Math.min(3, b.level));
  const deckY = WATER_LEVEL + 0.75 - y;
  const house = useMemo(() => houseParts(), []);
  const roof = useMemo(() => roofGeometry(), []);
  useEffect(() => () => roof.dispose(), [roof]);
  const site = useMemo(() => siteParts(w, d, deckY, level), [w, d, deckY, level]);
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const berth = useMemo(() => new THREE.Vector3(b.x + site.berth.x * c + site.berth.z * s, 0, b.z - site.berth.x * s + site.berth.z * c), [b.x, b.z, c, s, site.berth.x, site.berth.z]);
  const dir = useMemo(() => new THREE.Vector3(s, 0, c), [s, c]);
  const trip = useMemo(() => planTrip(berth, dir, grid, (b.id.charCodeAt(b.id.length - 1) & 1) === 0), [berth, dir, grid, b.id]);
  const boat = useRef<THREE.Group>(null);
  const state = useRef<BoatState>({ mode: "docked", wait: 20, s: 0, yaw: b.rot, speed: 0, t: 0 });
  const rnd = useMemo(() => mulberry32(b.id.length * 7919), [b.id]);
  useFrame((_, raw) => {
    if (!boat.current) return;
    const paused = useCity.getState().speed === 0;
    stepBoat(state.current, boat.current, trip, berth, b.rot, paused ? 0 : Math.min(raw, 0.1), rnd);
  });
  return (
    <>
      <group position={[b.x, y, b.z]} rotation={[0, b.rot, 0]} userData={GROUNDED}>
        <Boxes list={site.terrace} m={m.terrace} shadow={false} />
        <Boxes list={house.walls} m={m.timber} />
        <Boxes list={house.boards} m={m.boards} shadow={false} />
        <Boxes list={house.door} m={m.door} shadow={false} />
        <Boxes list={house.frame} m={m.frame} shadow={false} />
        <Boxes list={house.glass} m={m.glass} shadow={false} />
        <Boxes list={house.flowerBox} m={m.post} shadow={false} />
        <Boxes list={house.flowers} m={m.flowers} shadow={false} />
        <Boxes list={house.chimney} m={m.stone} />
        <Boxes list={house.lamp} m={m.lantern} shadow={false} />
        <mesh geometry={roof} material={m.roof} castShadow receiveShadow />
        {site.steps.length > 0 && <Boxes list={site.steps} m={m.deck} />}
        <Boxes list={site.deck} m={m.deck} />
        <Boxes list={site.posts} m={m.post} />
        <Boxes list={site.lanterns} m={m.lantern} shadow={false} />
        {level >= 2 && (
          <>
            <Boxes list={site.pergolaPosts} m={m.frame} />
            <Boxes list={site.pergolaSlats} m={m.frame} />
            <Boxes list={site.sofas} m={m.sofa} />
            <Boxes list={site.cushions} m={m.cushion} shadow={false} />
          </>
        )}
        {level >= 3 && (
          <>
            {/* Hot tub sunk into the walkway, flag on the jetty head. */}
            <mesh material={m.post} position={[site.tub.x, deckY + 0.25, site.tub.z]} castShadow>
              <cylinderGeometry args={[1.3, 1.3, 0.5, 20]} />
            </mesh>
            <mesh material={m.water} position={[site.tub.x, deckY + 0.51, site.tub.z]}>
              <cylinderGeometry args={[1.1, 1.1, 0.04, 20]} />
            </mesh>
            <Boxes list={site.flagPole} m={m.frame} />
            <mesh material={m.flag} position={[site.flagPole[0][0] + 0.9, deckY + 5.4, site.flagPole[0][1]]}>
              <planeGeometry args={[1.6, 1]} />
            </mesh>
          </>
        )}
      </group>
      {/* The yacht lies along the jetty head, bow to the left; the sports boat moves in world coordinates. */}
      {level >= 3 && (
        <Yacht
          x={b.x + site.yacht.x * c + site.yacht.z * s}
          z={b.z - site.yacht.x * s + site.yacht.z * c}
          yaw={b.rot - Math.PI / 2}
          y={WATER_LEVEL - 0.6}
        />
      )}
      <SportBoat boat={boat} />
    </>
  );
}
