import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";
import { useCity } from "@/lib/city/store";
import { sound } from "./sound/engine";
import { naturalDepthGrid, sampleDepth } from "@/lib/city/terrain";
import { routeToEdge } from "@/lib/city/waterways";
import { runBench } from "./Benchmark";
import { simState, simTimings } from "@/lib/city/sim-client";

/**
 * Development (or `?bench` in the URL): exposes the store and camera as `window.__city`, so the scene can be
 * driven from the browser console or DevTools scripts (build paths, move the camera).
 *
 *   __city.store.setState({ tool: "rail", draft: [{x:0,z:0},{x:80,z:0}] }); __city.store.getState().finishDraft()
 *   __city.look(x, z, distance)
 */
export function DevHandle() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;

  useEffect(() => {
    // Development, or any build opened with `?bench` (performance test on other machines).
    if (process.env.NODE_ENV !== "development" && !new URLSearchParams(window.location.search).has("bench")) return;
    const w = window as unknown as Record<string, unknown>;
    const look = (x: number, z: number, distance = 120, angle = 0.9) => {
      if (!controls) return;
      controls.target.set(x, 0, z);
      camera.position.set(x + distance * 0.55, distance * Math.sin(angle), z + distance * 0.6);
      controls.update();
    };
    w.__city = {
      store: useCity,
      /** Sound engine (sound/engine.ts): `__city.sound.play("cash")`, needs a click on the page first. */
      sound,
      camera,
      scene,
      gl,
      /** Water depth (> 0) or terrain height (< 0) at a point of the natural world. */
      depth: (x: number, z: number) => sampleDepth(naturalDepthGrid(), x, z),
      /** Ship route from a point through deep water to the map edge. */
      route: (x: number, z: number) => routeToEdge({ x, z }, naturalDepthGrid()),
      /** Client (screen) coordinates of a ground point, for synthetic pointer events. */
      screen(x: number, z: number, y = 0) {
        const v = new THREE.Vector3(x, y, z).project(camera);
        const r = gl.domElement.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
      look,
      /** Simulation worker: state and the duration of its last requests. */
      sim: () => ({ state: simState(), ...simTimings }),
      /** Performance test (see Benchmark.ts): `await __city.bench({ rounds, seconds, skip })`. */
      bench: (opts?: Parameters<typeof runBench>[1]) => runBench({ gl, look }, opts),
    };
    return () => {
      delete w.__city;
    };
  }, [camera, controls, scene, gl]);

  return null;
}
