import * as THREE from "three";

/**
 * Pig model chosen by the player (docs/glb/pink pig 3d model.glb, generated with Tripo),
 * reduced for the game from 319,000 to 3,000 triangles with meshoptimizer and a 512 px colour
 * texture (public/models/animals/pig.glb, 119 KB).
 *
 * The file has no rig, so one is made here when it loads, like the cow's: a body bone, a
 * head bone and four leg bones; every vertex is weighted to a leg (low and near that leg's
 * foot), to the head (front of the snout) or to the body, blended at the joints. The clips
 * below move those bones – legs stepping in diagonal pairs, the head going down to eat –
 * and the herd code drives them like the cow's walk / eat / idle.
 */
export const PIG_URL = "/models/animals/pig.glb";

/** The model is long along x with the head at −x; this turn makes it face +z like the other animals. */
const PIG_YAW = Math.PI / 2;

/** Hip height of the legs and where the head joins the body (model units, pig about 1 long). */
const HIP_Y = 0.3;
const LEG_RADIUS = 0.14;
const NECK_X = -0.24;

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Builds the rigged pig from the loaded scene: root → model (turned to face +z) → skinned mesh
 * with bones torso, head, legFL, legFR, legBL, legBR (names used by the clips).
 */
export function rigPig(scene: THREE.Object3D): THREE.Group {
  let source: THREE.Mesh | null = null;
  scene.traverse((o) => {
    if (!source && (o as THREE.Mesh).isMesh) source = o as THREE.Mesh;
  });
  const root = new THREE.Group();
  root.name = "pig";
  if (!source) return root;
  const mesh0 = source as THREE.Mesh;
  const geometry = mesh0.geometry.clone();
  const pos = geometry.attributes.position as THREE.BufferAttribute;

  // Feet: the four clusters of the lowest vertices (front/back × left/right).
  const feet = [
    { name: "legFL", x: 0, z: 0, n: 0, front: true, left: true },
    { name: "legFR", x: 0, z: 0, n: 0, front: true, left: false },
    { name: "legBL", x: 0, z: 0, n: 0, front: false, left: true },
    { name: "legBR", x: 0, z: 0, n: 0, front: false, left: false },
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) >= 0.12) continue;
    minX = Math.min(minX, pos.getX(i));
    maxX = Math.max(maxX, pos.getX(i));
  }
  const midX = (minX + maxX) / 2;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) >= 0.12) continue;
    const f = feet.find((q) => q.front === pos.getX(i) < midX && q.left === pos.getZ(i) > 0)!;
    f.x += pos.getX(i);
    f.z += pos.getZ(i);
    f.n++;
  }
  for (const f of feet) {
    if (!f.n) continue;
    f.x /= f.n;
    f.z /= f.n;
  }

  // Bones: torso at the origin, legs at the hips above the feet, head at the neck.
  const torso = new THREE.Bone();
  torso.name = "torso";
  const head = new THREE.Bone();
  head.name = "head";
  head.position.set(NECK_X, 0.4, 0);
  torso.add(head);
  const legs = feet.map((f) => {
    const b = new THREE.Bone();
    b.name = f.name;
    b.position.set(f.x, HIP_Y, f.z);
    torso.add(b);
    return b;
  });
  const bones = [torso, head, ...legs];

  // Weights: two influences per vertex (body + the leg or the head it belongs to).
  const skinIndex = new Uint16Array(pos.count * 4);
  const skinWeight = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let bone = 0;
    let w = 0;
    // Leg: low, and near that leg's foot column.
    let best = Infinity;
    feet.forEach((f, k) => {
      const d = Math.hypot(x - f.x, z - f.z);
      if (d < best) {
        best = d;
        bone = 2 + k;
      }
    });
    if (best < LEG_RADIUS) w = smooth(HIP_Y + 0.02, HIP_Y - 0.08, y);
    // Head: in front of the neck (only where no leg already claims the vertex).
    if (w < 0.01) {
      const wh = smooth(NECK_X + 0.06, NECK_X - 0.08, x) * smooth(0.16, 0.24, y);
      if (wh > 0) {
        bone = 1;
        w = wh;
      }
    }
    skinIndex.set([0, bone, 0, 0], i * 4);
    skinWeight.set([1 - w, w, 0, 0], i * 4);
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));

  const mesh = new THREE.SkinnedMesh(geometry, mesh0.material);
  mesh.castShadow = true;
  mesh.add(torso);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));

  const model = new THREE.Group();
  model.rotation.y = PIG_YAW;
  model.add(mesh);
  root.add(model);
  return root;
}

/** Axes in model space: the pig walks towards −x, legs and head swing about z, the head turns about y. */
const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const quat = (axis: THREE.Vector3, a: number) => new THREE.Quaternion().setFromAxisAngle(axis, a).toArray();

/** Quaternion track turning `node` about `axis` through the given angles over `duration` seconds (looping). */
function swing(node: string, axis: THREE.Vector3, angles: number[], duration: number) {
  const times = angles.map((_, i) => (duration * i) / (angles.length - 1));
  return new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, times, angles.flatMap((a) => quat(axis, a)));
}

/** Walk, eat and idle clips for the bones of `rigPig`. */
export function pigClips() {
  const step = 0.6;
  // Positive angle about z swings the foot backwards (towards +x).
  const legs = (a: number) => [a, 0, -a, 0, a];
  const walk = new THREE.AnimationClip("Walk", step, [
    // Trot: diagonal pairs step together.
    swing("legFL", Z, legs(0.45), step),
    swing("legBR", Z, legs(0.45), step),
    swing("legFR", Z, legs(-0.45), step),
    swing("legBL", Z, legs(-0.45), step),
    new THREE.VectorKeyframeTrack("torso.position", [0, step / 4, step / 2, (3 * step) / 4, step], [0, 0, 0, 0, 0.02, 0, 0, 0, 0, 0, 0.02, 0, 0, 0, 0]),
    swing("torso", X, [0, 0.03, 0, -0.03, 0], step),
    swing("head", Z, [0, 0.06, 0, 0.06, 0], step),
  ]);
  const eat = new THREE.AnimationClip("Eating", 2.4, [
    // Head down to the ground, snout rooting.
    swing("head", Z, [0.55, 0.7, 0.55, 0.72, 0.55], 2.4),
  ]);
  const idle = new THREE.AnimationClip("Idle", 4, [
    // Looking around, an ear-flick nod now and then.
    swing("head", Y, [0, 0.35, 0.35, -0.3, 0], 4),
  ]);
  return { walk, eat, idle };
}
