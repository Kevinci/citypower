"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { TERRAIN_N, TERRAIN_RES, WATER_LEVEL, WORLD_HALF, type DepthGrid } from "@/lib/city/terrain";
import { useShapedGrid } from "./useProfiles";

/**
 * The cut face around the world, like a diorama slab: seen from the side, a strip of grass at
 * the top, dark topsoil below, then wavy layers of clay, sand and rock down to the base. Where
 * a river or lake crosses the edge, its water shows in section above the bed.
 *
 * One wall per side, a column of two vertices every grid step (top = terrain or water surface,
 * bottom = base); the layers are coloured in the shader from the depth below the surface and
 * the absolute height, so they stay level across hills.
 */

/** Base of the slab (m): thin but visible ("nicht viel aber sichtbar"); under deep water it reaches at least this far below the bed. */
const MIN_BASE = -12;
const BASE_BELOW = 3;
/** Grass and topsoil thickness (m). */
const GRASS = 1.4;
const TOPSOIL = 3.2;

function edgeMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float surface;
        attribute float water;
        varying float vSurface;
        varying float vWater;
        varying vec3 vEdgeWorld;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vSurface = surface;
        vWater = water;
        vEdgeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying float vSurface;
        varying float vWater;
        varying vec3 vEdgeWorld;
        float edgeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float edgeNoise(float x) {
          float i = floor(x); float f = fract(x);
          float s = f * f * (3.0 - 2.0 * f);
          return mix(edgeHash(vec2(i, 3.1)), edgeHash(vec2(i + 1.0, 3.1)), s);
        }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          // Position along the edge (x on the north/south faces, z on the east/west faces).
          float along = abs(vEdgeWorld.x) > ${(WORLD_HALF - 0.5).toFixed(1)} ? vEdgeWorld.z : vEdgeWorld.x;
          float y = vEdgeWorld.y;
          float below = vSurface - y;
          vec3 col;
          if (vWater > 0.5 && y > vSurface) {
            // Water in section: lighter at the top, deeper blue towards the bed.
            col = mix(vec3(0.10, 0.27, 0.34), vec3(0.20, 0.45, 0.52), clamp((y - vSurface) / 3.0, 0.0, 1.0));
          } else {
            float wob = (edgeNoise(along / 6.0) - 0.5) * 0.5 + (edgeNoise(along / 1.3) - 0.5) * 0.15;
            if (below < ${GRASS.toFixed(2)} + wob) {
              // Turf: green, a little darker at the roots.
              col = mix(vec3(0.27, 0.45, 0.16), vec3(0.17, 0.30, 0.10), clamp(below / ${GRASS.toFixed(2)}, 0.0, 1.0));
            } else if (below < ${(GRASS + TOPSOIL).toFixed(2)} + wob * 2.0) {
              col = vec3(0.26, 0.18, 0.11); // dark topsoil
            } else {
              // Strata by absolute height, gently waving along the edge.
              float h = y + (edgeNoise(along / 40.0) - 0.5) * 3.0 + (edgeNoise(along / 9.0) - 0.5) * 0.8;
              float band = fract(h / 4.0);
              vec3 clay = vec3(0.40, 0.26, 0.15);
              vec3 sand = vec3(0.55, 0.42, 0.26);
              vec3 rock = vec3(0.33, 0.31, 0.30);
              col = band < 0.45 ? clay : band < 0.62 ? sand : band < 0.9 ? clay * 0.85 : rock;
              // Pebbles.
              float speck = edgeHash(floor(vec2(along, y) * 2.5));
              col *= speck > 0.93 ? 0.75 : 1.0;
            }
            // Darker towards the base, so the slab reads as solid.
            col *= mix(0.6, 1.0, clamp((y - ${MIN_BASE.toFixed(1)}) / 20.0 + 0.5, 0.0, 1.0));
          }
          diffuseColor.rgb = col;
        }`,
      );
  };
  m.customProgramCacheKey = () => "world-edge";
  return m;
}

/**
 * Geometry of the four walls. Columns along each edge at every grid point; the top follows the
 * terrain (or the water surface where the edge is wet), the bottom is level at `base`.
 */
function edgeGeometry(grid: DepthGrid) {
  const at = (c: number, r: number) => grid[r * TERRAIN_N + c];
  const sides: { cells: (i: number) => [number, number]; normal: [number, number]; flip: boolean }[] = [
    { cells: (i) => [i, 0], normal: [0, -1], flip: false }, // north (z = −half)
    { cells: (i) => [i, TERRAIN_N - 1], normal: [0, 1], flip: true }, // south
    { cells: (i) => [0, i], normal: [-1, 0], flip: true }, // west
    { cells: (i) => [TERRAIN_N - 1, i], normal: [1, 0], flip: false }, // east
  ];
  const pos: number[] = [];
  const nor: number[] = [];
  const surf: number[] = [];
  const wet: number[] = [];
  const idx: number[] = [];
  for (const s of sides) {
    const start = pos.length / 3;
    for (let i = 0; i < TERRAIN_N; i++) {
      const [c, r] = s.cells(i);
      const x = -WORLD_HALF + c * TERRAIN_RES;
      const z = -WORLD_HALF + r * TERRAIN_RES;
      const ground = -at(c, r);
      const water = ground < WATER_LEVEL ? 1 : 0;
      const top = Math.max(ground, water ? WATER_LEVEL : ground);
      // Level base; only under a deep bed does the column reach a little lower.
      pos.push(x, top, z, x, Math.min(MIN_BASE, ground - BASE_BELOW), z);
      for (let k = 0; k < 2; k++) {
        nor.push(s.normal[0], 0, s.normal[1]);
        surf.push(ground);
        wet.push(water);
      }
      if (i > 0) {
        const a = start + (i - 1) * 2;
        const b = a + 2;
        // Faces point outward (seen from outside the map).
        if (s.flip) idx.push(a, a + 1, b, b, a + 1, b + 1);
        else idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("surface", new THREE.Float32BufferAttribute(surf, 1));
  g.setAttribute("water", new THREE.Float32BufferAttribute(wet, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function WorldEdge() {
  const grid = useShapedGrid();
  const material = useMemo(() => edgeMaterial(), []);
  const geometry = useMemo(() => edgeGeometry(grid), [grid]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} receiveShadow />;
}
