import { RoundedBox } from "@react-three/drei";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

const YELLOW = "#f4b30c";
const YELLOW_DARK = "#d99a06";
const TRACK = "#1c1f24";
const STEEL = "#2c3139";
const BUCKET = "#3e444e";
const GLASS = "#1d2b36";

interface PartProps {
  size: [number, number, number];
  color: string;
  radius?: number;
  roughness?: number;
  metalness?: number;
  position?: [number, number, number];
}

function Part({ size, color, radius = 0.08, roughness = 0.5, metalness = 0.08, position }: PartProps) {
  return (
    <RoundedBox args={size} radius={radius} smoothness={4} position={position} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
    </RoundedBox>
  );
}

type ExcavatorProps = ThreeElements["group"] & {
  /**
   * true = the arm digs in a loop. false = parked in the idle pose.
   * Pass a mutable ref to switch digging on and off per frame without re-rendering.
   */
  working?: boolean | { current: boolean };
};

/**
 * Stylised mini excavator, ~4.7 m long, origin at ground level, facing +z.
 */
export function Excavator({ working = false, ...props }: ExcavatorProps) {
  const swing = useRef<THREE.Group>(null);
  const boom = useRef<THREE.Group>(null);
  const stick = useRef<THREE.Group>(null);
  const bucket = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const active = typeof working === "object" ? working.current : working;
    if (!active) return;
    const t = clock.getElapsedTime();
    const dig = (Math.sin(t * 1.4) + 1) / 2; // 0..1 digging cycle
    if (boom.current) boom.current.rotation.x = THREE.MathUtils.lerp(-0.9, 0.15, dig);
    if (stick.current) stick.current.rotation.x = THREE.MathUtils.lerp(1.5, 0.5, dig);
    if (bucket.current) bucket.current.rotation.x = THREE.MathUtils.lerp(-0.4, 0.9, dig);
    if (swing.current) swing.current.rotation.y = Math.sin(t * 0.7) * 0.35;
  });

  return (
    <group {...props}>
      {/* Undercarriage: two rubber tracks */}
      <Part size={[0.5, 0.6, 3.0]} color={TRACK} radius={0.22} position={[-0.95, 0.3, 0]} />
      <Part size={[0.5, 0.6, 3.0]} color={TRACK} radius={0.22} position={[0.95, 0.3, 0]} />
      <Part size={[1.5, 0.12, 2.6]} color={STEEL} radius={0.04} position={[0, 0.62, 0]} />

      {/* Upper body, rotates on the carriage */}
      <group ref={swing} position={[0, 0.66, 0]}>
        <Part size={[1.75, 0.35, 2.4]} color={YELLOW} position={[0, 0.2, -0.1]} />
        <Part size={[1.7, 0.8, 0.7]} color={YELLOW_DARK} position={[0, 0.55, -1.45]} />
        <Part size={[1.1, 1.1, 1.3]} color={YELLOW} position={[-0.35, 0.9, -0.5]} />
        <Part size={[0.9, 0.6, 0.04]} color={GLASS} roughness={0.12} metalness={0.3} radius={0.02} position={[-0.35, 0.95, 0.17]} />
        <Part size={[1.25, 0.1, 1.45]} color={STEEL} radius={0.04} position={[-0.35, 1.5, -0.5]} />
        <Part size={[0.7, 0.45, 0.7]} color={STEEL} position={[0.45, 0.45, -0.9]} />

        {/* Boom: pivots at the front-right of the upper body */}
        <group ref={boom} position={[0.5, 0.3, 0.4]} rotation={[-0.5, 0, 0]}>
          <Part size={[0.3, 0.32, 2.1]} color={YELLOW} position={[0, 0, 1.05]} />
          <Part size={[0.08, 0.08, 1.4]} color={STEEL} radius={0.03} position={[0.2, 0.25, 0.8]} />

          {/* Stick (arm) */}
          <group ref={stick} position={[0, 0, 2.1]} rotation={[1.1, 0, 0]}>
            <Part size={[0.24, 0.26, 1.7]} color={STEEL} position={[0, 0, 0.85]} />

            {/* Bucket */}
            <group ref={bucket} position={[0, 0, 1.7]} rotation={[0.3, 0, 0]}>
              <Part size={[0.72, 0.5, 0.55]} color={BUCKET} radius={0.12} roughness={0.7} position={[0, -0.2, 0.2]} />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
