import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { flattenMap } from "./photoMaterial";

/**
 * Village church: rubble-stone nave with a round choir, slate roof, sandstone plinth,
 * cornices and buttresses, stained-glass lancet windows, a west tower with clocks, belfry
 * openings, portal and a copper spire with ball and cross. Front (tower) faces −z.
 *
 * Photo textures (Poly Haven, CC0) are tiled in metres: every surface gets UVs scaled to its
 * real size, so stones and slates keep their size on every part.
 */

/** Metres covered by one texture tile. */
const STONE_TILE = 2.5;
const SLATE_TILE = 3;

const NAVE_W = 11;
const NAVE_Z0 = -6.2;
const NAVE_Z1 = 9;
const NAVE_H = 8.5;
const ROOF_H = 6.5;
const APSE_R = 4.4;
const APSE_H = 7;
const TOWER = 5.6;
const TOWER_Z = -9;
const TOWER_H = 21;
const SPIRE_H = 12;

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Deterministic value noise for the canvas textures. */
function speckle(g: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], amount: number, seed: number) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const n = (rnd() - 0.5) * amount;
    img.data[i * 4] = base[0] + n;
    img.data[i * 4 + 1] = base[1] + n * 0.9;
    img.data[i * 4 + 2] = base[2] + n * 0.8;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

/** Equilateral pointed-arch path in a box (x, y top-left, w, h). */
function lancet(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const spring = y + w * 0.866;
  g.beginPath();
  g.moveTo(x, y + h);
  g.lineTo(x, spring);
  g.arc(x + w, spring, w, Math.PI, Math.PI + Math.PI / 3);
  g.arc(x, spring, w, -Math.PI / 3, 0);
  g.lineTo(x + w, y + h);
  g.closePath();
}

function sandstoneTexture() {
  const t = canvasTexture(128, 128, (g) => {
    speckle(g, 128, 128, [205, 186, 150], 34, 7);
    g.globalAlpha = 0.25;
    g.fillStyle = "#8d7a5a";
    for (let y = 0; y < 128; y += 32) g.fillRect(0, y, 128, 1.5);
    for (let y = 0; y < 128; y += 32) for (let x = (y / 32) % 2 ? 0 : 32; x < 128; x += 64) g.fillRect(x, y, 1.5, 32);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Stained-glass lancet window in a sandstone surround. */
function windowTexture() {
  return canvasTexture(96, 256, (g) => {
    g.clearRect(0, 0, 96, 256);
    g.fillStyle = "#cdbb93";
    lancet(g, 0, 0, 96, 256);
    g.fill();
    g.save();
    lancet(g, 12, 12, 72, 236);
    g.clip();
    const colours = ["#24427a", "#7a1f2b", "#c9a227", "#2f6b4f", "#3a5ea8", "#8e3b6e"];
    let k = 3;
    for (let y = 0; y < 256; y += 14) {
      for (let x = 0; x < 96; x += 12) {
        k = (k * 7 + 5) % 13;
        g.fillStyle = colours[k % colours.length];
        g.globalAlpha = 0.75 + (k % 3) * 0.1;
        g.fillRect(x, y, 12, 14);
      }
    }
    g.globalAlpha = 1;
    // Lead cames: diamond lattice.
    g.strokeStyle = "#1b1b1d";
    g.lineWidth = 1.5;
    for (let d = -256; d < 352; d += 16) {
      g.beginPath();
      g.moveTo(d, 0);
      g.lineTo(d + 256, 256);
      g.moveTo(d + 256, 0);
      g.lineTo(d, 256);
      g.stroke();
    }
    g.restore();
    // Mullion and transom of sandstone.
    g.fillStyle = "#cdbb93";
    g.fillRect(45, 40, 6, 220);
    g.fillRect(12, 150, 72, 5);
    g.strokeStyle = "#9c8a66";
    g.lineWidth = 2;
    lancet(g, 12, 12, 72, 236);
    g.stroke();
  });
}

/** Round-arched portal: sandstone surround, planked oak door with iron hinges. */
function doorTexture() {
  return canvasTexture(128, 192, (g) => {
    g.fillStyle = "#cdbb93";
    g.beginPath();
    g.moveTo(0, 192);
    g.lineTo(0, 64);
    g.arc(64, 64, 64, Math.PI, 0);
    g.lineTo(128, 192);
    g.fill();
    g.fillStyle = "#4a2c19";
    g.beginPath();
    g.moveTo(16, 192);
    g.lineTo(16, 66);
    g.arc(64, 66, 48, Math.PI, 0);
    g.lineTo(112, 192);
    g.fill();
    g.fillStyle = "#3a2213";
    for (let x = 22; x < 112; x += 12) g.fillRect(x, 20, 2, 172);
    g.fillRect(63, 18, 3, 174);
    g.fillStyle = "#1e1e1e";
    for (const y of [80, 150]) {
      g.fillRect(20, y, 38, 5);
      g.fillRect(70, y, 38, 5);
    }
    g.beginPath();
    g.arc(56, 120, 4, 0, Math.PI * 2);
    g.arc(72, 120, 4, 0, Math.PI * 2);
    g.fill();
    // Voussoir joints.
    g.strokeStyle = "#9c8a66";
    g.lineWidth = 1.5;
    for (let a = 0; a <= 8; a++) {
      const t = Math.PI + (a / 8) * Math.PI;
      g.beginPath();
      g.moveTo(64 + Math.cos(t) * 50, 64 + Math.sin(t) * 50);
      g.lineTo(64 + Math.cos(t) * 64, 64 + Math.sin(t) * 64);
      g.stroke();
    }
  });
}

/** Tower clock: white dial, Roman-style bar markers, gilded ring and hands (10:10). */
function clockTexture() {
  return canvasTexture(256, 256, (g) => {
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = "#c9a23b";
    g.beginPath();
    g.arc(128, 128, 126, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#f3efe4";
    g.beginPath();
    g.arc(128, 128, 112, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#1d1d1f";
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const long = i % 5 === 0;
      g.save();
      g.translate(128, 128);
      g.rotate(a);
      g.fillRect(-(long ? 4 : 1.5), -106, long ? 8 : 3, long ? 22 : 8);
      g.restore();
    }
    const hand = (a: number, len: number, w: number) => {
      g.save();
      g.translate(128, 128);
      g.rotate(a);
      g.fillStyle = "#b8902c";
      g.fillRect(-w / 2, -len, w, len + 12);
      g.restore();
    };
    hand((10 / 12) * Math.PI * 2 + (10 / 60) * (Math.PI / 6), 58, 9);
    hand((10 / 60) * Math.PI * 2, 88, 6);
    g.fillStyle = "#b8902c";
    g.beginPath();
    g.arc(128, 128, 8, 0, Math.PI * 2);
    g.fill();
  });
}

/** Belfry opening: twin round arches with dark wooden louvres. */
function belfryTexture() {
  return canvasTexture(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = "#cdbb93";
    g.fillRect(0, 24, 128, 104);
    g.beginPath();
    g.arc(64, 64, 64, Math.PI, 0);
    g.fill();
    for (const cx of [36, 92]) {
      g.fillStyle = "#151515";
      g.beginPath();
      g.moveTo(cx - 22, 124);
      g.lineTo(cx - 22, 46);
      g.arc(cx, 46, 22, Math.PI, 0);
      g.lineTo(cx + 22, 124);
      g.fill();
      g.fillStyle = "#5a3b25";
      for (let y = 40; y < 124; y += 9) g.fillRect(cx - 22, y, 44, 4);
    }
  });
}

/** Copper sheet with patina: standing seams and run-off streaks. */
function patinaTexture() {
  const t = canvasTexture(128, 256, (g) => {
    speckle(g, 128, 256, [96, 150, 128], 26, 11);
    let s = 5;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = rnd() < 0.5 ? "rgba(60,95,80,0.35)" : "rgba(170,205,185,0.3)";
      const x = rnd() * 128;
      g.fillRect(x, rnd() * 128, 2 + rnd() * 4, 60 + rnd() * 160);
    }
    g.fillStyle = "rgba(40,70,58,0.7)";
    for (let x = 0; x < 128; x += 16) g.fillRect(x, 0, 2, 256);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function photo(name: string, colour: boolean) {
  const t = new THREE.TextureLoader().load(`/textures/${name}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let assets: ReturnType<typeof createAssets> | null = null;
function createAssets() {
  const decal = (map: THREE.Texture) =>
    new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.5, roughness: 0.6, side: THREE.DoubleSide });
  return {
    stone: flattenMap(
      new THREE.MeshStandardMaterial({
      map: photo("castle_wall_slates_diff_1k.jpg", true),
      normalMap: photo("castle_wall_slates_nor_1k.jpg", false),
      color: "#d8d2c6",
      roughness: 0.95,
    }),
    ),
    slate: flattenMap(
      new THREE.MeshStandardMaterial({
      map: photo("roof_slates_02_diff_1k.jpg", true),
      normalMap: photo("roof_slates_02_nor_1k.jpg", false),
      color: "#7d8288",
      roughness: 0.75,
      side: THREE.DoubleSide,
    }),
    ),
    sandstone: flattenMap(new THREE.MeshStandardMaterial({ map: sandstoneTexture(), roughness: 0.9 })),
    patina: new THREE.MeshStandardMaterial({ map: patinaTexture(), roughness: 0.55, metalness: 0.25, side: THREE.DoubleSide }),
    gold: new THREE.MeshStandardMaterial({ color: "#d4a83a", roughness: 0.3, metalness: 1 }),
    window: new THREE.MeshStandardMaterial({
      map: windowTexture(),
      transparent: true,
      alphaTest: 0.5,
      roughness: 0.25,
      metalness: 0.2,
      side: THREE.DoubleSide,
    }),
    door: decal(doorTexture()),
    clock: decal(clockTexture()),
    belfry: decal(belfryTexture()),
  };
}
const useChurchAssets = () => (assets ??= createAssets());

/* ---------- geometry with UVs in metres ---------- */

/** Box standing on y = 0, UVs scaled so one texture tile covers `tile` metres. */
function meterBox(w: number, h: number, d: number, tile: number) {
  const g = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // Face order of BoxGeometry: +x, −x, +y, −y, +z, −z.
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * dims[f][0]) / tile, (uv.getY(k) * dims[f][1]) / tile);
    }
  }
  return g;
}

function scaleUv(g: THREE.BufferGeometry, su: number, sv: number) {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}

/** Gable roof along z over the nave: slopes and the two gable triangles. */
function naveRoof(w: number, length: number, h: number, overhang: number) {
  const hw = w / 2 + overhang;
  const z0 = -length / 2 - overhang;
  const z1 = length / 2 + overhang;
  const slopeLen = Math.hypot(hw, h);
  const slopes = new THREE.BufferGeometry();
  // Eave rises 0 → h at the ridge; outer edge sits slightly below the wall top.
  const drop = (overhang * h) / (w / 2);
  slopes.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [-hw, -drop, z0, -hw, -drop, z1, 0, h, z1, 0, h, z0, hw, -drop, z1, hw, -drop, z0, 0, h, z0, 0, h, z1],
      3,
    ),
  );
  const u = (z1 - z0) / SLATE_TILE;
  const v = slopeLen / SLATE_TILE;
  slopes.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, u, 0, u, v, 0, v, 0, 0, u, 0, u, v, 0, v], 2));
  slopes.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  slopes.computeVertexNormals();

  const gables = new THREE.BufferGeometry();
  const gw = w / 2;
  const gz0 = -length / 2;
  const gz1 = length / 2;
  gables.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([gw, 0, gz0, -gw, 0, gz0, 0, h, gz0, -gw, 0, gz1, gw, 0, gz1, 0, h, gz1], 3),
  );
  const gu = w / STONE_TILE;
  const gv = h / STONE_TILE;
  gables.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, gu, 0, gu / 2, gv, 0, 0, gu, 0, gu / 2, gv], 2));
  gables.setIndex([0, 1, 2, 3, 4, 5]);
  gables.computeVertexNormals();
  return { slopes, gables };
}

function buildGeometry() {
  const naveLen = NAVE_Z1 - NAVE_Z0;
  // Half cylinder / half cone towards +z (theta measured from +z).
  const apseWall = scaleUv(
    new THREE.CylinderGeometry(APSE_R, APSE_R, APSE_H, 20, 1, true, -Math.PI / 2, Math.PI).translate(0, APSE_H / 2, 0),
    (Math.PI * APSE_R) / STONE_TILE,
    APSE_H / STONE_TILE,
  );
  const apseRoof = scaleUv(
    new THREE.ConeGeometry(APSE_R + 0.5, 3.6, 20, 1, true, -Math.PI / 2, Math.PI).translate(0, 1.8, 0),
    (Math.PI * APSE_R) / SLATE_TILE,
    4.5 / SLATE_TILE,
  );
  const spire = scaleUv(
    new THREE.ConeGeometry((TOWER / 2 + 0.35) * Math.SQRT2, SPIRE_H, 4, 1, true).rotateY(Math.PI / 4).translate(0, SPIRE_H / 2, 0),
    3,
    2,
  );
  return {
    nave: meterBox(NAVE_W, NAVE_H, naveLen, STONE_TILE),
    tower: meterBox(TOWER, TOWER_H, TOWER, STONE_TILE),
    roof: naveRoof(NAVE_W, naveLen, ROOF_H, 0.7),
    apseWall,
    apseRoof,
    spire,
    unit: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    plane: new THREE.PlaneGeometry(1, 1),
  };
}

/** Lancet windows and buttresses along both nave walls. */
const WINDOW_Z = [-3.5, 0.6, 4.7];
const BUTTRESS_Z = [-1.45, 2.65, 6.75];

export function Church() {
  const a = useChurchAssets();
  const geo = useMemo(() => buildGeometry(), []);
  useEffect(
    () => () => {
      for (const g of [geo.nave, geo.tower, geo.roof.slopes, geo.roof.gables, geo.apseWall, geo.apseRoof, geo.spire, geo.unit, geo.plane])
        g.dispose();
    },
    [geo],
  );

  const naveZ = (NAVE_Z0 + NAVE_Z1) / 2;
  const naveLen = NAVE_Z1 - NAVE_Z0;
  const block = (m: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, key?: string) => (
    <mesh key={key} geometry={geo.unit} material={m} position={[x, y, z]} scale={[w, h, d]} castShadow receiveShadow />
  );
  const towerFront = TOWER_Z - TOWER / 2;

  return (
    <group>
      {/* Nave, its roof and the round choir. */}
      <mesh geometry={geo.nave} material={a.stone} position={[0, 0, naveZ]} castShadow receiveShadow />
      <group position={[0, NAVE_H, naveZ]}>
        <mesh geometry={geo.roof.slopes} material={a.slate} castShadow receiveShadow />
        <mesh geometry={geo.roof.gables} material={a.stone} castShadow />
      </group>
      <mesh geometry={geo.apseWall} material={a.stone} position={[0, 0, NAVE_Z1]} castShadow receiveShadow />
      <mesh geometry={geo.apseRoof} material={a.slate} position={[0, APSE_H - 0.2, NAVE_Z1]} castShadow />
      {/* Sandstone plinth and eaves cornice. */}
      {block(a.sandstone, 0, 0, naveZ, NAVE_W + 0.4, 0.8, naveLen + 0.2)}
      {block(a.sandstone, 0, NAVE_H - 0.35, naveZ, NAVE_W + 0.5, 0.4, naveLen + 0.1)}
      {/* Buttresses with sloped sandstone caps. */}
      {BUTTRESS_Z.flatMap((z) =>
        [-1, 1].map((side) => (
          <group key={`${z}${side}`} position={[side * (NAVE_W / 2 + 0.4), 0, z]}>
            {block(a.stone, 0, 0, 0, 0.8, 5.2, 0.9)}
            {block(a.sandstone, 0, 5.2, 0, 0.95, 0.22, 1.05)}
            {block(a.stone, side * -0.1, 5.42, 0, 0.6, 1.2, 0.7)}
            {block(a.sandstone, side * -0.1, 6.62, 0, 0.72, 0.18, 0.82)}
          </group>
        )),
      )}
      {/* Stained-glass lancet windows on both sides and in the choir. */}
      {WINDOW_Z.flatMap((z) =>
        [-1, 1].map((side) => (
          <mesh
            key={`w${z}${side}`}
            geometry={geo.plane}
            material={a.window}
            position={[side * (NAVE_W / 2 + 0.03), 4.6, z]}
            rotation={[0, side * (Math.PI / 2), 0]}
            scale={[1.5, 4, 1]}
          />
        )),
      )}
      {[-0.7, 0, 0.7].map((t) => (
        <mesh
          key={`a${t}`}
          geometry={geo.plane}
          material={a.window}
          position={[Math.sin(t) * (APSE_R + 0.03), 3.9, NAVE_Z1 + Math.cos(t) * (APSE_R + 0.03)]}
          rotation={[0, t, 0]}
          scale={[1.1, 3.2, 1]}
        />
      ))}

      {/* West tower. */}
      <mesh geometry={geo.tower} material={a.stone} position={[0, 0, TOWER_Z]} castShadow receiveShadow />
      {block(a.sandstone, 0, 0, TOWER_Z, TOWER + 0.4, 0.9, TOWER + 0.4)}
      {block(a.sandstone, 0, 9, TOWER_Z, TOWER + 0.3, 0.35, TOWER + 0.3)}
      {block(a.sandstone, 0, 15.8, TOWER_Z, TOWER + 0.3, 0.35, TOWER + 0.3)}
      {block(a.sandstone, 0, TOWER_H - 0.1, TOWER_Z, TOWER + 0.7, 0.45, TOWER + 0.7)}
      {/* Corner quoins. */}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => block(a.sandstone, sx * (TOWER / 2 - 0.2), 0.9, TOWER_Z + sz * (TOWER / 2 - 0.2), 0.46, TOWER_H - 1, 0.46, `q${sx}${sz}`)),
      )}
      {/* Clock faces and belfry openings on all four sides. */}
      {[0, 1, 2, 3].map((i) => {
        const r = (i * Math.PI) / 2;
        const out = TOWER / 2 + 0.04;
        const x = Math.sin(r + Math.PI) * out;
        const z = TOWER_Z + Math.cos(r + Math.PI) * out;
        return (
          <group key={i}>
            <mesh geometry={geo.plane} material={a.clock} position={[x, 12.9, z]} rotation={[0, r + Math.PI, 0]} scale={[2.6, 2.6, 1]} />
            <mesh geometry={geo.plane} material={a.belfry} position={[x, 18.3, z]} rotation={[0, r + Math.PI, 0]} scale={[3.2, 3.2, 1]} />
          </group>
        );
      })}
      {/* Portal with steps. */}
      <mesh geometry={geo.plane} material={a.door} position={[0, 2.05, towerFront - 0.24]} rotation={[0, Math.PI, 0]} scale={[2.6, 3.9, 1]} />
      {block(a.sandstone, 0, 0, towerFront - 0.55, 3.2, 0.3, 1.1)}
      {block(a.sandstone, 0, 0, towerFront - 0.9, 3.6, 0.15, 1.6)}
      {/* Copper spire, ball and cross. */}
      <mesh geometry={geo.spire} material={a.patina} position={[0, TOWER_H + 0.3, TOWER_Z]} castShadow />
      <mesh material={a.gold} position={[0, TOWER_H + SPIRE_H + 0.6, TOWER_Z]} castShadow>
        <sphereGeometry args={[0.4, 16, 12]} />
      </mesh>
      {block(a.gold, 0, TOWER_H + SPIRE_H + 0.9, TOWER_Z, 0.14, 2.2, 0.14)}
      {block(a.gold, 0, TOWER_H + SPIRE_H + 2.2, TOWER_Z, 1.1, 0.14, 0.14)}
    </group>
  );
}
