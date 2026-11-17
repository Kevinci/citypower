import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { residentsOf } from "@/lib/city/economy";
import { FLAT, type Profile } from "@/lib/city/grade";
import { mulberry32 } from "@/lib/city/random";
import { buildFrames, cumulative, type Frame } from "@/lib/city/road-geometry";
import { useCity } from "@/lib/city/store";
import type { Road } from "@/lib/city/types";
import { FIGURE_DISTANCE, skipMatrices } from "./Animals";
import { useProfiles } from "./useProfiles";

/**
 * People in the streets: pedestrians on the sidewalks and cyclists on cycle paths and at
 * the edge of streets. Rigged, animated characters by Quaternius (CC0) with their real
 * walk cycle; bicycles by Poly by Google (CC-BY 3.0). Numbers follow the population.
 */

const MAN = "/models/people/man.glb";
const WOMAN = "/models/people/woman.glb";
const BICYCLE = "/models/people/bicycle.glb";
useGLTF.preload(MAN);
useGLTF.preload(WOMAN);
useGLTF.preload(BICYCLE);

const MAX_WALKERS = 46;
const MAX_CYCLISTS = 16;
/** One pedestrian per this many residents. */
const RESIDENTS_PER_WALKER = 7;
const WALK_SPEED = 1.35;
const BIKE_SPEED = 4.5;
const PERSON_HEIGHT = 1.75;
const BIKE_LENGTH = 1.75;
/** Height of the seated rider's origin above the road (pose dependent, saddle top ≈ 1.03 m). */
const RIDER_LIFT = 0.55;
/** Saddle position along the bike, from its centre (handlebar ≈ +0.3 m). */
const SADDLE_Z = -0.43;

/** Centres the turned bicycle on its group origin with the tyres on the ground. */
function placeBike(bike: THREE.Object3D) {
  bike.position.set(0, 0, 0);
  bike.updateMatrix();
  const box = new THREE.Box3().setFromObject(bike);
  const centre = box.getCenter(new THREE.Vector3());
  bike.position.set(-centre.x, -box.min.y, -centre.z);
}

/** Paths people move along: sidewalks (both sides) and the cycle lanes. */
interface Track {
  frames: Frame[];
  dist: number[];
  length: number;
  offset: number;
  /** Height above the path surface (pedestrians stand on the raised sidewalk). */
  lift: number;
}

/** Pedestrians' feet above the road profile: sidewalk kerb plus the model's foot offset. */
const WALK_LIFT = 0.5;

function tracksFor(roads: Road[], profiles: Map<string, Profile>, kind: "walk" | "bike"): Track[] {
  const out: Track[] = [];
  for (const r of roads) {
    const sides: number[] =
      kind === "walk"
        ? r.kind === "street"
          ? [5.1, -5.1]
          : r.kind === "bike"
            ? [1.8, -1.8]
            : []
        : r.kind === "bike"
          ? [0.7, -0.7]
          : r.kind === "street"
            ? [3.1]
            : [];
    if (sides.length === 0) continue;
    const frames = buildFrames(r.points, r.kind, profiles.get(r.id) ?? FLAT);
    const dist = cumulative(frames);
    const length = dist[dist.length - 1];
    if (length < 20) continue;
    for (const offset of sides) out.push({ frames, dist, length, offset, lift: kind === "walk" ? WALK_LIFT : 0 });
  }
  return out;
}

/** Position and heading on a track at distance s (dir = ±1). */
function pose(track: Track, s: number, dir: number, out: THREE.Vector3) {
  let i = 0;
  while (i < track.dist.length - 2 && track.dist[i + 1] < s) i++;
  const f0 = track.frames[i];
  const f1 = track.frames[i + 1] ?? f0;
  const span = track.dist[i + 1] - track.dist[i] || 1;
  const t = Math.min(1, Math.max(0, (s - track.dist[i]) / span));
  out.copy(f0.p).lerp(f1.p, t);
  // Right-hand side of the travel direction for cyclists on streets; sidewalks either side.
  out.x += f0.n.x * track.offset * dir;
  out.z += f0.n.z * track.offset * dir;
  out.y += track.lift;
  return Math.atan2(f0.t.x * dir, f0.t.z * dir);
}

/** A loaded rigged character, normalised to real height, facing +z. */
function useCharacter(url: string) {
  const gltf = useGLTF(url);
  return useMemo(() => {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const walk =
      gltf.animations.find((a) => /walk/i.test(a.name)) ?? gltf.animations.find((a) => /run/i.test(a.name)) ?? gltf.animations[0];
    // Seated pose for riding a bicycle.
    const sit =
      gltf.animations.find((a) => /sitidle/i.test(a.name)) ?? gltf.animations.find((a) => /sitting/i.test(a.name)) ?? walk;
    return { scene: gltf.scene, scale: PERSON_HEIGHT / (size.y || 1), walk, sit };
  }, [gltf]);
}

interface Mover {
  track: Track;
  s: number;
  dir: number;
  speed: number;
  object: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  /** Looping clip; (re)started on mount, since unmounting stops all actions. */
  action: THREE.AnimationAction | null;
  /** Rider (or walker) and its number among them: only the first N are shown. */
  bike: boolean;
  n: number;
}

/** Hides the movers beyond the current crowd size. */
function showOnly(all: Mover[], shown: Mover[]) {
  const on = new Set(shown);
  for (const m of all) {
    m.object.visible = on.has(m);
    skipMatrices(m.object, !m.object.visible);
  }
}

/**
 * Advances movers along their tracks, turning around at the ends. Movers far from the camera
 * keep walking but are not drawn or animated (each figure is several skinned draw calls).
 */
function step(movers: Mover[], dt: number, tmp: THREE.Vector3, camera: THREE.Vector3) {
  for (const m of movers) {
    m.s += m.speed * m.dir * dt;
    if (m.s > m.track.length - 2 || m.s < 2) {
      m.dir = -m.dir;
      m.s = Math.min(m.track.length - 2, Math.max(2, m.s));
    }
    const yaw = pose(m.track, m.s, m.dir, tmp);
    m.object.position.copy(tmp);
    m.object.rotation.y = yaw;
    m.object.visible = tmp.distanceTo(camera) < FIGURE_DISTANCE;
    // Hidden figures (and their skeletons) are skipped by the per-frame matrix update.
    skipMatrices(m.object, !m.object.visible);
    if (m.object.visible) m.mixer.update(dt * (m.speed / WALK_SPEED));
  }
}

export function People() {
  const roads = useCity((s) => s.roads);
  const jobs = useCity((s) => s.jobs);
  const residents = useCity((s) => s.buildings.reduce((sum, b) => sum + residentsOf(b), 0));
  const profiles = useProfiles();
  const man = useCharacter(MAN);
  const woman = useCharacter(WOMAN);
  const bicycle = useGLTF(BICYCLE);

  const finished = useMemo(() => roads.filter((r) => !jobs.includes(r.id)), [roads, jobs]);
  // Rounded so the crowd is not rebuilt for every new resident.
  const walkers = Math.min(MAX_WALKERS, Math.round(residents / RESIDENTS_PER_WALKER / 4) * 4);
  const cyclists = Math.min(MAX_CYCLISTS, Math.round(residents / 30 / 2) * 2);

  const group = useMemo(() => new THREE.Group(), []);
  const movers = useMemo(() => {
    const rnd = mulberry32(77);
    const walkTracks = tracksFor(finished, profiles, "walk");
    const bikeTracks = tracksFor(finished, profiles, "bike");
    const list: Mover[] = [];
    const character = (i: number, riding = false) => {
      // The man model's sitting clip shifts him off the saddle: riders use the woman model.
      const c = riding ? woman : i % 2 === 0 ? man : woman;
      const object = cloneSkinned(c.scene);
      // The source scene may carry a rotation; facing is set by us alone.
      object.rotation.set(0, 0, 0);
      object.scale.setScalar(c.scale);
      object.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.frustumCulled = false;
        }
      });
      const mixer = new THREE.AnimationMixer(object);
      const clip = riding ? c.sit : c.walk;
      const action = clip ? mixer.clipAction(clip) : null;
      action?.play();
      if (action) action.time = rnd() * 2;
      return { object, mixer, action };
    };
    if (walkTracks.length > 0) {
      // All possible walkers are made once; more residents only show more of them (cloning
      // the whole crowd again whenever the count changed was a hitch while the town grew).
      for (let i = 0; i < MAX_WALKERS; i++) {
        const track = walkTracks[Math.floor(rnd() * walkTracks.length)];
        const { object, mixer, action } = character(i);
        list.push({ track, s: 2 + rnd() * (track.length - 4), dir: rnd() < 0.5 ? 1 : -1, speed: WALK_SPEED * (0.85 + rnd() * 0.3), object, mixer, action, bike: false, n: i });
      }
    }
    if (bikeTracks.length > 0) {
      const bikeBox = new THREE.Box3().setFromObject(bicycle.scene);
      const bikeSize = bikeBox.getSize(new THREE.Vector3());
      const bikeScale = BIKE_LENGTH / Math.max(bikeSize.x, bikeSize.z);
      for (let i = 0; i < MAX_CYCLISTS; i++) {
        const track = bikeTracks[Math.floor(rnd() * bikeTracks.length)];
        const rider = character(i + 1, true);
        const bike = bicycle.scene.clone();
        bike.scale.setScalar(bikeScale);
        // The model's handlebar points to −z (or −x): turn it to face +z, the travel direction.
        bike.rotation.y = bikeSize.x > bikeSize.z ? -Math.PI / 2 : Math.PI;
        placeBike(bike);
        bike.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = true;
        });
        const unit = new THREE.Group();
        unit.add(bike);
        // Seated on the saddle (hips of the sitting pose sit just in front of the origin).
        rider.object.position.set(0, RIDER_LIFT, SADDLE_Z - 0.03);
        unit.add(rider.object);
        list.push({ track, s: 2 + rnd() * (track.length - 4), dir: rnd() < 0.5 ? 1 : -1, speed: BIKE_SPEED * (0.8 + rnd() * 0.4), object: unit, mixer: rider.mixer, action: rider.action, bike: true, n: i });
      }
    }
    return list;
  }, [finished, profiles, man, woman, bicycle]);
  const shown = useMemo(() => movers.filter((m) => m.n < (m.bike ? cyclists : walkers)), [movers, walkers, cyclists]);
  useEffect(() => showOnly(movers, shown), [movers, shown]);

  useEffect(() => {
    for (const m of movers) {
      group.add(m.object);
      m.action?.play();
    }
    return () => {
      for (const m of movers) {
        group.remove(m.object);
        m.mixer.stopAllAction();
      }
    };
  }, [movers, group]);

  const tmp = useRef(new THREE.Vector3());
  useFrame(({ camera }, dt) => step(shown, Math.min(dt, 0.1), tmp.current, camera.position));

  return <primitive object={group} />;
}
