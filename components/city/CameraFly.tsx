"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { useCity } from "@/lib/city/store";

/** Flight time to a building (s). */
const DURATION = 1.4;

interface Flight {
  n: number;
  t: number;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  offset: THREE.Vector3;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** One step of the flight (outside the component: it moves the camera and the controls). */
function stepFlight(f: Flight, dt: number, camera: THREE.Camera, target: THREE.Vector3) {
  f.t = Math.min(1, f.t + dt / DURATION);
  target.lerpVectors(f.fromTarget, f.toTarget, easeInOut(f.t));
  camera.position.copy(target).add(f.offset);
}

/**
 * Flies the camera to `focus` (set by `flyTo`, e.g. a loss-making business in the tax office):
 * the orbit pivot glides to the building, the camera keeps its angle and comes in to a
 * comfortable distance (at most 160 m away).
 */
export function CameraFly() {
  const focus = useCity((s) => s.focus);
  const flight = useRef<Flight | null>(null);
  useFrame((state, dt) => {
    const controls = state.controls as unknown as { target: THREE.Vector3 } | null;
    if (!controls) return;
    const camera = state.camera;
    if (focus && flight.current?.n !== focus.n) {
      const offset = camera.position.clone().sub(controls.target);
      if (offset.length() > 160) offset.setLength(160);
      flight.current = { n: focus.n, t: 0, fromTarget: controls.target.clone(), toTarget: new THREE.Vector3(focus.x, 0, focus.z), offset };
    }
    const f = flight.current;
    if (f && f.t < 1) stepFlight(f, dt, camera, controls.target);
  });
  return null;
}
