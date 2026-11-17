"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

interface RainProps {
    count?: number;
    speed?: number;
    wind?: number;
    area?: number;
    height?: number;
    opacity?: number;
}

export function Rain({
                         count = 3500,
                         speed = 28,
                         wind = 2.5,
                         area = 70,
                         height = 45,
                         opacity = 0.55,
                     }: RainProps) {
    const rainRef = useRef<THREE.InstancedMesh>(null);
    const { camera } = useThree();

    const dummy = useMemo(() => new THREE.Object3D(), []);

    const drops = useMemo(() => {
        return Array.from({ length: count }, () => ({
            x: (Math.random() - 0.5) * area,
            y: Math.random() * height,
            z: (Math.random() - 0.5) * area,
            length: 0.6 + Math.random() * 1.2,
            velocity: 0.75 + Math.random() * 0.5,
        }));
    }, [count, area, height]);

    const geometry = useMemo(() => {
        const geo = new THREE.CylinderGeometry(
            0.012,
            0.012,
            1,
            4
        );

        return geo;
    }, []);

    const material = useMemo(
        () =>
            new THREE.MeshBasicMaterial({
                color: "#d5eaff",
                transparent: true,
                opacity: 0.35,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                length: 1.2 + Math.random() * 1.8,
            }),
        []
    );

    useFrame((_, delta) => {
        const mesh = rainRef.current;
        if (!mesh) return;

        const dt = Math.min(delta, 0.05);

        for (let i = 0; i < count; i++) {
            const drop = drops[i];

            drop.y -= speed * drop.velocity * dt;
            drop.x += wind * dt;

            // Reset the drop above the camera when it leaves the rain area.
            if (drop.y < -height / 2) {
                drop.y = height / 2 + Math.random() * 5;
                drop.x = (Math.random() - 0.5) * area;
                drop.z = (Math.random() - 0.5) * area;
            }

            // Keep the rain centered around the camera.
            dummy.position.set(
                camera.position.x + drop.x,
                camera.position.y + drop.y,
                camera.position.z + drop.z
            );

            // Slanted rain direction.
            dummy.rotation.set(0, 0, -0.08 - wind * 0.015);

            dummy.scale.set(1, drop.length, 1);
            dummy.updateMatrix();

            mesh.setMatrixAt(i, dummy.matrix);
        }

        mesh.instanceMatrix.needsUpdate = true;
    });

    return (
        <instancedMesh
            ref={rainRef}
            args={[geometry, material, count]}
            frustumCulled={false}
        />
    );
}
