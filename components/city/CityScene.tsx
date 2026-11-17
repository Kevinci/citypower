"use client";

import { Environment, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer, HueSaturation, SMAA, ToneMapping, Vignette, TiltShift2 } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Suspense, useRef } from "react";
import * as THREE from "three";
import { CameraBounds } from "./CameraBounds";
import { CameraFly } from "./CameraFly";
import { BuildingCard } from "./BuildingCard";
import { BuildingTool } from "./BuildingTool";
import { Buildings } from "./Buildings";
import { Ships } from "./Ships";
import { Sun } from "./Sun";
import { Sky } from "./Sky";
import { Canals } from "./Canals";
import { DevHandle } from "./DevHandle";
import { People } from "./People";
import { PowerLines } from "./PowerLines";
import { Rails } from "./Rails";
import { SupplyLinks } from "./SupplyLinks";
import { RoadBuilder } from "./RoadBuilder";
import { Roads } from "./Roads";
import { Traffic } from "./Traffic";
import { Fires } from "./Fires";
import { Trains } from "./Trains";
import { Trees } from "./Trees";
import { Water } from "./Water";
import { WaterCoverage } from "./WaterCoverage";
import { RoadNetworks } from "./RoadNetworks";
import { JobCentreArea } from "./JobCentreArea";
import { BuildGrid, Ground } from "./World";
import { WorldEdge } from "./WorldEdge";
import {Rain} from "@/components/weather/Rain";
import { useCity } from "@/lib/city/store";
import { Snow } from "@/components/weather/Snow";

/** Poly Haven "Kloofendal 48d Partly Cloudy (Pure Sky)", CC0: sky light only; the visible sky is the Kenney dome (Sky.tsx). */
/** Haze colour (sky near the horizon, by day – Sky.tsx tints it with the clock) and its range in metres. */
const HAZE = "#c6d3df";
const HAZE_NEAR = 450;
const HAZE_FAR = 3800;
const SKY_HDRI = "/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr";

/** Mounted once everything in the Suspense boundary has loaded; reports after a few drawn frames. */
function ReadySignal({ onReady }: { onReady?: () => void }) {
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    if (frames.current === 3) onReady?.();
  });
  return null;
}

export default function CityScene({ onReady }: { onReady?: () => void }) {
  const showRain = useCity((s) => s.showRain);
  const showSnow = useCity((s) => s.showSnow);
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      // near/far as tight as the camera limits allow: depth precision is what keeps thin
      // layers (markings over asphalt) from flickering at a distance.
      camera={{ position: [70, 85, 85], fov: 40, near: 2.5, far: 3200 }}
      // Tone mapping happens in the post-processing chain instead. No reversed depth buffer:
      // three does not flip polygonOffset for it, which the road layers rely on.
      gl={{ antialias: false, toneMapping: THREE.NoToneMapping, powerPreference: "high-performance" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Aerial perspective, not weather: only far land fades slightly into the sky colour. */}
      <fog attach="fog" args={[HAZE, HAZE_NEAR, HAZE_FAR]} />

      {showRain && (
          <Rain
              count={3500}
              speed={28}
              wind={2.5}
              opacity={0.55}
          />
      )}

      {showSnow && (
          <Snow
              count={3800}
              speed={2.5}
              wind={0.7}
              opacity={0.8}
          />
      )}

      <Suspense fallback={null}>
        <Environment files={SKY_HDRI} environmentIntensity={0.7} />
        <Sky />

        <Sun />

        <Ground />
        <WorldEdge />
        <Water />
        <BuildGrid />
        <Trees />
        <Buildings />
        <Ships />
        <BuildingTool />
        <BuildingCard />
        <SupplyLinks />
        <WaterCoverage />
        <RoadNetworks />
        <JobCentreArea />
        <PowerLines />
        <Roads />
        <Rails />
        <Canals />
        <Traffic />
        <Fires />
        <Trains />
        <People />
        <RoadBuilder />

        {/* No ambient occlusion pass: N8AO breaks on three 0.187 and SSAO costs ~25% frame time with the forest. */}
        {/* 4× MSAA on the scene buffer smooths thin markings and rails; SMAA cleans up the rest. */}
        <EffectComposer multisampling={4}>
          <Bloom intensity={0.25} luminanceThreshold={0.9} mipmapBlur />
          {showRain && (
          <TiltShift2
              blur={0.25}
              taper={1.8}
              samples={6}
          />
              )}
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          {/* Colour grade: ACES flattens saturation a little; give some back (merged into the same pass). */}
          <HueSaturation saturation={0.06} />
          <Vignette offset={0.25} darkness={0.45} />
          <SMAA />
        </EffectComposer>
        <ReadySignal onReady={onReady} />
      </Suspense>

      <OrbitControls
        makeDefault
        target={[0, 0, 0]}
        enableDamping
        dampingFactor={0.08}
        minDistance={12}
        maxDistance={520}
        // Never tilt down to the horizon or below it.
        minPolarAngle={0.15}
        maxPolarAngle={THREE.MathUtils.degToRad(80)}
        // Pan parallel to the ground instead of in screen space, so the pivot cannot sink.
        screenSpacePanning={false}
        mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
      />
      <CameraFly />
      <CameraBounds />
      <DevHandle />
    </Canvas>
  );
}
