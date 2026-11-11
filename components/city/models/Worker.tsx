import { useFrame, type ThreeElements } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

const VEST = "#ff7a1a";
const STRIPE = "#e8f0f2";
const TROUSERS = "#2b3a55";
const SKIN = "#d9a77f";
const HELMET = "#ffd21f";
const HANDLE = "#7a5a36";
const BLADE = "#8a9098";

type WorkerProps = ThreeElements["group"] & {
  /** Offset into the animation cycles so a crew does not move in lockstep. */
  phase?: number;
  /** 1 = walking, 0 = shovelling. Read every frame, so pass a ref. */
  activity?: { current: number };
};

/**
 * Construction worker, ~1.8 m tall, facing +z, origin between the feet.
 * Walking: legs and arms swing, slight bob. Shovelling: bend down, lift, straighten.
 * Poses blend smoothly when the activity changes.
 */
export function Worker({ phase = 0, activity, ...props }: WorkerProps) {
  const body = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const walkBlend = useRef(0);

  useFrame(({ clock }, dt) => {
    const target = activity?.current ?? 0;
    walkBlend.current = THREE.MathUtils.damp(walkBlend.current, target, 8, dt);
    const w = walkBlend.current;
    const t = clock.getElapsedTime();

    // Walk cycle
    const stride = Math.sin(t * 7 + phase);
    // Shovel cycle
    const dig = (Math.sin(t * 2.1 + phase) + 1) / 2;

    if (legL.current) legL.current.rotation.x = stride * 0.55 * w;
    if (legR.current) legR.current.rotation.x = -stride * 0.55 * w;
    if (torso.current) torso.current.rotation.x = THREE.MathUtils.lerp(0.1 + dig * 0.65, 0.05, w);
    if (armL.current) armL.current.rotation.x = THREE.MathUtils.lerp(-0.3 - dig * 1.1, -stride * 0.5, w);
    if (armR.current) armR.current.rotation.x = THREE.MathUtils.lerp(-0.5 - dig * 0.9, -0.35, w);
    if (body.current) body.current.position.y = Math.abs(Math.sin(t * 7 + phase)) * 0.04 * w;
  });

  return (
    <group {...props}>
      <group ref={body}>
        {/* Legs pivot at the hips */}
        <group ref={legL} position={[-0.11, 0.9, 0]}>
          <mesh position={[0, -0.45, 0]} castShadow>
            <capsuleGeometry args={[0.09, 0.7, 4, 8]} />
            <meshStandardMaterial color={TROUSERS} roughness={0.9} />
          </mesh>
        </group>
        <group ref={legR} position={[0.11, 0.9, 0]}>
          <mesh position={[0, -0.45, 0]} castShadow>
            <capsuleGeometry args={[0.09, 0.7, 4, 8]} />
            <meshStandardMaterial color={TROUSERS} roughness={0.9} />
          </mesh>
        </group>

        {/* Upper body pivots at the hips */}
        <group ref={torso} position={[0, 0.88, 0]}>
          <mesh position={[0, 0.3, 0]} castShadow>
            <capsuleGeometry args={[0.18, 0.38, 4, 10]} />
            <meshStandardMaterial color={VEST} roughness={0.7} />
          </mesh>
          {/* Reflective stripe on the vest */}
          <mesh position={[0, 0.26, 0]}>
            <cylinderGeometry args={[0.185, 0.185, 0.05, 12]} />
            <meshStandardMaterial color={STRIPE} roughness={0.3} emissive={STRIPE} emissiveIntensity={0.15} />
          </mesh>
          {/* Head and helmet */}
          <mesh position={[0, 0.72, 0]} castShadow>
            <sphereGeometry args={[0.12, 12, 10]} />
            <meshStandardMaterial color={SKIN} roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.77, 0]} castShadow>
            <sphereGeometry args={[0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={HELMET} roughness={0.4} />
          </mesh>

          {/* Arms pivot at the shoulders */}
          <group ref={armL} position={[-0.24, 0.52, 0]}>
            <mesh position={[0, -0.24, 0]} castShadow>
              <capsuleGeometry args={[0.055, 0.4, 4, 8]} />
              <meshStandardMaterial color={VEST} roughness={0.7} />
            </mesh>
          </group>
          <group ref={armR} position={[0.24, 0.52, 0]}>
            <mesh position={[0, -0.24, 0]} castShadow>
              <capsuleGeometry args={[0.055, 0.4, 4, 8]} />
              <meshStandardMaterial color={VEST} roughness={0.7} />
            </mesh>
            {/* Shovel held in the right hand */}
            <group position={[-0.12, -0.48, 0.05]} rotation={[0.2, 0, 0.5]}>
              <mesh position={[0, -0.35, 0]} castShadow>
                <cylinderGeometry args={[0.02, 0.02, 1.1, 6]} />
                <meshStandardMaterial color={HANDLE} roughness={0.8} />
              </mesh>
              <mesh position={[0, -0.95, 0]} castShadow>
                <boxGeometry args={[0.22, 0.28, 0.03]} />
                <meshStandardMaterial color={BLADE} roughness={0.4} metalness={0.6} />
              </mesh>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
