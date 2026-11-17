
"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface SnowProps {
    count?: number;
    speed?: number;
    wind?: number;
    spread?: number;
    opacity?: number;
}

interface SnowParticle {
    x: number;
    y: number;
    z: number;
    size: number;
    phase: number;
    drift: number;
}

export function Snow({
                         count = 1800,
                         speed = 2.5,
                         wind = 0.7,
                         spread = 55,
                         opacity = 0.8,
                     }: SnowProps) {
    const mesh = useRef<THREE.InstancedMesh>(null!);
    const dummy = useMemo(() => new THREE.Object3D(), []);

    // Weicher radialer Verlauf für unscharfe Schneeflocken
    const snowTexture = useMemo(() => {
        const size = 64;
        const data = new Uint8Array(size * size * 4);

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = (x - size / 2) / (size / 2);
                const dy = (y - size / 2) / (size / 2);
                const distance = Math.sqrt(dx * dx + dy * dy);

                // Weicher Gauß-Verlauf statt harter Kreis-Kante
                const alpha = Math.exp(-distance * distance * 5);

                const i = (y * size + x) * 4;

                data[i] = 255;
                data[i + 1] = 255;
                data[i + 2] = 255;
                data[i + 3] = Math.round(alpha * 255);
            }
        }

        const texture = new THREE.DataTexture(
            data,
            size,
            size,
            THREE.RGBAFormat,
        );

        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;

        return texture;
    }, []);

    // Zufällige Partikel
    const particles = useMemo<SnowParticle[]>(
        () =>
            Array.from({ length: count }, () => ({
                x: (Math.random() - 0.5) * spread,
                y: (Math.random() - 0.5) * spread,
                z: (Math.random() - 0.5) * spread,

                // Unterschiedliche Größen erzeugen Tiefenwirkung
                size: 0.035 + Math.random() * 0.13,

                phase: Math.random() * Math.PI * 2,
                drift: 0.3 + Math.random() * 0.7,
            })),
        [count, spread],
    );

    useFrame(({ camera, clock }, delta) => {
        if (!mesh.current) return;

        const time = clock.elapsedTime;

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];

            // Schnee fällt nach unten
            p.y -= speed * p.drift * delta;

            // Leichte seitliche Bewegung
            p.x +=
                (wind + Math.sin(time * 0.7 + p.phase) * 0.35) *
                delta *
                p.drift;

            // Partikel oberhalb der Kamera neu platzieren
            if (p.y < -spread / 2) {
                p.y = spread / 2;
                p.x = (Math.random() - 0.5) * spread;
                p.z = (Math.random() - 0.5) * spread;
            }

            // Kamera-relative Position
            dummy.position.set(
                camera.position.x + p.x,
                camera.position.y + p.y,
                camera.position.z + p.z,
            );

            // Schneeflocken immer zur Kamera ausrichten
            dummy.quaternion.copy(camera.quaternion);

            // Leichtes Größenflackern vermeiden, aber Bewegung variieren
            dummy.scale.setScalar(p.size);

            dummy.updateMatrix();
            mesh.current.setMatrixAt(i, dummy.matrix);
        }

        mesh.current.instanceMatrix.needsUpdate = true;
    });

    return (
        <instancedMesh
            ref={mesh}
            args={[undefined, undefined, count]}
            frustumCulled={false}
        >
            <planeGeometry args={[1, 1]} />

            <meshBasicMaterial
                map={snowTexture}
                color="#ffffff"
                transparent
                opacity={opacity}
                depthWrite={false}
                side={THREE.DoubleSide}
                blending={THREE.NormalBlending}
                toneMapped={false}
            />
        </instancedMesh>
    );
}
