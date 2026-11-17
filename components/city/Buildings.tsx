import { useFrame } from "@react-three/fiber";
import { memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { flattenMap, photoMaterial, setPhotoFlat, withPhoto } from "./photoMaterial";
import { signGlow, windowGlow } from "./nightGlow";
import { Prison, TrainDepot, TrainStation } from "./RailwayBuildings";
import { BUILDINGS, sizeOf, type Building } from "@/lib/city/economy";
import { buildingGround } from "@/lib/city/placement";
import { goldDay } from "@/lib/city/gold";
import { setRoadPack } from "@/lib/city/materials";
import { useCity } from "@/lib/city/store";
import { sampleDepth, type DepthGrid } from "@/lib/city/terrain";
import { Airport } from "./Airport";
import { BEEF_COAT, DAIRY_COAT, Fence, Herd, localHeight, mudMaterial, type Area } from "./Animals";
import { Church } from "./Church";
import { GroundShadows } from "./GroundShadows";
import { StaticBatches } from "./StaticBatcher";
import { Gardens, HousePack } from "./HousePack";
import { KitContainers, RoofSolar } from "./KitProps";
import { PACK_SPECS, PackBuilding } from "./PackBuildings";
import { PackFarmyard, PackPigHut, PackShelter, PackTrough, packFieldMaterials } from "./FarmPack";
import { BANK_WEALTH, PackBank, PackChurch, PackTownHall, TOWNHALL_RESIDENTS } from "./LandmarksPack";
import { Mine, PowerPlant, Transformer } from "./PowerModels";
import { Villa } from "./Villa";
import { Casino } from "./Casino";
import { Pizzeria } from "./Pizzeria";
import { NewspaperHouse } from "./NewspaperHouse";
import { BoathouseScene } from "./Boathouse";
import { useDepthGrid } from "./useWater";

/* ---------- procedural textures ---------- */

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Plastered facade with `floors` rows of windows (white: tinted per house by instance colour). */
/** Facade with `floors` window rows; `modern` = big windows with balcony slabs, no shutters. */
/** Glass curtain wall with `floors` storeys: mullions, spandrel bands, a few lit panes (white base, tinted per instance). */
function glassFacadeTexture(floors: number) {
  const rowH = 40;
  const h = floors * rowH + 40;
  return canvasTexture(256, h, (g) => {
    let r = 1234567;
    const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
    g.fillStyle = "#c9d3da";
    g.fillRect(0, 0, 256, h);
    for (let f = 0; f < floors; f++) {
      const row = 14 + f * rowH;
      for (let c = 0; c < 8; c++) {
        const lit = rnd() < 0.12;
        g.fillStyle = lit ? "#e8dcb0" : rnd() < 0.5 ? "#4f6577" : "#5a7184";
        g.fillRect(4 + c * 32, row, 28, rowH - 10);
      }
      // Spandrel band between storeys.
      g.fillStyle = "#9fb0bc";
      g.fillRect(0, row + rowH - 10, 256, 4);
    }
    // Lobby: tall glass with a dark frame.
    g.fillStyle = "#2d3a44";
    g.fillRect(0, h - 26, 256, 26);
    g.fillStyle = "#6f8799";
    g.fillRect(70, h - 24, 116, 22);
  });
}

function facadeTexture(floors = 2, modern = false) {
  const rowH = 66;
  const h = floors * rowH + 28;
  return canvasTexture(256, h, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 256, h);
    // Plinth.
    g.fillStyle = "#9a9a96";
    g.fillRect(0, h - 14, 256, 14);
    for (let f = 0; f < floors && modern; f++) {
      const row = 18 + f * rowH;
      for (const x of [14, 134]) {
        g.fillStyle = "#3b4a5a";
        g.fillRect(x, row, 108, 40);
        g.fillStyle = "#d8dde2";
        g.fillRect(x + 52, row, 4, 40);
      }
      // Balcony slab and railing under the windows.
      g.fillStyle = "#b9bcbf";
      g.fillRect(8, row + 40, 240, 6);
      g.fillStyle = "#8d949a";
      g.fillRect(8, row + 46, 240, 12);
    }
    for (let f = 0; f < floors && !modern; f++) {
      const row = 22 + f * rowH;
      for (const x of [30, 108, 186]) {
        g.fillStyle = "#e9e6df";
        g.fillRect(x - 4, row - 4, 48, 48);
        g.fillStyle = "#3b4a5a";
        g.fillRect(x, row, 40, 40);
        g.fillStyle = "#e9e6df";
        g.fillRect(x + 18, row, 4, 40);
        g.fillRect(x, row + 18, 40, 4);
        // Shutters.
        g.fillStyle = "#6b4a35";
        g.fillRect(x - 14, row - 2, 9, 44);
        g.fillRect(x + 45, row - 2, 9, 44);
      }
    }
    // Front door in the middle of the ground floor.
    if (floors <= 2) {
      g.fillStyle = "#5b3a26";
      g.fillRect(112, h - 14 - 50, 32, 50);
    }
  });
}

function roofTexture() {
  const t = canvasTexture(128, 128, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 8) {
      g.fillStyle = y % 16 === 0 ? "#d8d8d8" : "#cfcfcf";
      g.fillRect(0, y, 128, 7);
      g.fillStyle = "#9a9a9a";
      for (let x = (y / 8) % 2 ? 0 : 8; x < 128; x += 16) g.fillRect(x, y, 1, 7);
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  return t;
}

function shopTexture() {
  return canvasTexture(256, 128, (g) => {
    g.fillStyle = "#f3ead8";
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = "#2f3b46";
    g.fillRect(20, 52, 150, 60);
    g.fillRect(190, 46, 44, 74);
    g.fillStyle = "#c9a26b";
    g.fillRect(20, 52, 150, 4);
    g.fillStyle = "#3b4a5a";
    for (const x of [30, 90]) g.fillRect(x, 10, 40, 28);
  });
}

function signTexture(text: string, bg = "#5a2e1a", fg = "#f5e7c4", font = "bold 34px Georgia, serif") {
  return canvasTexture(256, 64, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = fg;
    g.font = font;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 128, 34);
  });
}

function stripeTexture(a: string, b: string, n: number) {
  const t = canvasTexture(64, 64, (g) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? a : b;
      g.fillRect((64 / n) * i, 0, 64 / n, 64);
    }
  });
  return t;
}

/** Crop/pasture surface: meadow photo, tinted; wheat additionally gets drill rows. */
function fieldMaterial(tint: THREE.Color, rows: boolean) {
  const loader = new THREE.TextureLoader();
  const map = loader.load("/textures/aerial_grass_rock_diff_1k.jpg");
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(4, 4);
  map.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map, color: tint, roughness: 1 });
  if (rows) {
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        diffuseColor.rgb *= 0.82 + 0.18 * step(0.5, fract(vMapUv.x * 24.0));`,
      );
    };
    m.customProgramCacheKey = () => "field-rows";
  }
  return flattenMap(m);
}

/* ---------- shared geometry ---------- */

/** Gable roof over a unit box (x: −0.5..0.5 along the ridge, z: −0.5..0.5, y: 0..1). */
function roofGeometry(): { slopes: THREE.BufferGeometry; gables: THREE.BufferGeometry } {
  const slopes = new THREE.BufferGeometry();
  // Two slopes, UVs in "tile" space along the slope.
  const p = [
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, 0, -0.5, 1, 0, // front slope
    0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 1, 0, // back slope
  ];
  slopes.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  slopes.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1], 2));
  slopes.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  slopes.computeVertexNormals();
  const gables = new THREE.BufferGeometry();
  gables.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0], 3),
  );
  gables.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1, 0, 0, 1, 0, 0.5, 1], 2));
  gables.setIndex([0, 1, 2, 3, 4, 5]);
  gables.computeVertexNormals();
  return { slopes, gables };
}

/**
 * Placement of the roof slopes over a wall box of size (w, d) with ridge height h: the slopes
 * sit on the wall tops (eaves line at the wall faces, so nothing can be seen through below
 * the roof) and continue down past them by the overhang. The gables use the unit roof scaled
 * to (w, h, d) and fill the triangle under the slopes exactly.
 */
function roofSlopes(w: number, d: number, h: number, eaves: number, verge = eaves) {
  const drop = (h * 2 * eaves) / d;
  return { y: -drop, scale: [w + 2 * verge, h + drop, d + 2 * eaves] as [number, number, number] };
}

const WALL_COLOURS = ["#f4f1ea", "#efe2c4", "#f1e6a8", "#efd3c8", "#dcdcd6", "#e8d7b5"];
const ROOF_COLOURS = ["#a8432c", "#8c3a28", "#6d4a3a", "#4a4d52", "#b5522f", "#7a2f22"];

/** Lazily created shared assets (textures need the DOM). */
let assets: ReturnType<typeof createAssets> | null = null;
function createAssets() {
  const facade = facadeTexture();
  const roofTex = roofTexture();
  const roof = roofGeometry();
  return {
    box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    roof,
    wall: windowGlow(new THREE.MeshStandardMaterial({ map: facade, roughness: 0.9 }), "slate"),
    plain: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9 }),
    towerCrown: photoMaterial({ texture: "metal_plate", tile: 2, mode: "grain", strength: 0.5, color: "#ffffff", roughness: 0.5, metalness: 0.5 }),
    roofMat: withPhoto(new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.75, side: THREE.DoubleSide }), { texture: "clay_roof_tiles_02", tile: 2.4, mode: "grain", strength: 0.75 }),
    /** Clay tiles for single buildings (houses get their tint per instance instead). */
    roofRed: photoMaterial({ texture: "clay_roof_tiles_02", tile: 2.4, color: "#e0a090", roughness: 0.75, side: THREE.DoubleSide }),
    plaster: withPhoto(new THREE.MeshStandardMaterial({ map: facadeTexture(2), color: "#efe2c4", roughness: 0.9 }), { texture: "painted_plaster_wall", tile: 2.5, mode: "grain", strength: 0.5 }),
    hospitalFacade: withPhoto(new THREE.MeshStandardMaterial({ map: facadeTexture(4), color: "#f4f6f8", roughness: 0.8 }), { texture: "painted_plaster_wall", tile: 2.5, mode: "grain", strength: 0.4 }),
    schoolFacade: withPhoto(new THREE.MeshStandardMaterial({ map: facadeTexture(2), color: "#e9c46a", roughness: 0.85 }), { texture: "painted_plaster_wall", tile: 2.5, mode: "grain", strength: 0.5 }),
    hall: photoMaterial({ texture: "corrugated_iron_02", tile: 2, mode: "grain", strength: 0.8, color: "#8f9aa2", roughness: 0.6, metalness: 0.3 }),
    rust: photoMaterial({ texture: "corrugated_iron_02", tile: 2, mode: "grain", strength: 0.8, color: "#7a4a33", roughness: 0.8, metalness: 0.3 }),
    coal: new THREE.MeshStandardMaterial({ color: "#22211f", roughness: 1, flatShading: true }),
    smoke: new THREE.MeshStandardMaterial({ color: "#c9c9c9", roughness: 1, transparent: true, opacity: 0.5, depthWrite: false }),
    log: photoMaterial({ texture: "weathered_plank_siding", tile: 2.5, color: "#e8c39a", roughness: 0.9 }),
    plank: photoMaterial({ texture: "weathered_plank_siding", tile: 2.5, mode: "grain", strength: 0.7, color: "#c79a62", roughness: 0.85 }),
    sail: new THREE.MeshStandardMaterial({ color: "#efe8d8", roughness: 0.9 }),
    sack: new THREE.MeshStandardMaterial({ color: "#d8cdb3", roughness: 1 }),
    yard: photoMaterial({ texture: "concrete_pavers_02", tile: 3, color: "#d6d6d6", roughness: 0.9 }),
    gravel: photoMaterial({ texture: "gravel_floor", tile: 2.5, color: "#e8e2d8", roughness: 1 }),
    pitch: new THREE.MeshStandardMaterial({ color: "#3f8b4c", roughness: 1 }),
    shop: withPhoto(new THREE.MeshStandardMaterial({ map: shopTexture(), roughness: 0.85 }), { texture: "painted_plaster_wall", tile: 2.5, mode: "grain", strength: 0.45 }),
    sign: new THREE.MeshStandardMaterial({ map: signTexture("BÄCKEREI"), roughness: 0.6 }),
    signButcher: new THREE.MeshStandardMaterial({ map: signTexture("METZGEREI"), roughness: 0.6 }),
    signFurniture: new THREE.MeshStandardMaterial({ map: signTexture("MÖBELHAUS"), roughness: 0.6 }),
    signRestaurant: new THREE.MeshStandardMaterial({ map: signTexture("RESTAURANT"), roughness: 0.6 }),
    signBank: signGlow(new THREE.MeshStandardMaterial({ map: signTexture("BANK"), roughness: 0.6 }), 1.6),
    marble: photoMaterial({ texture: "concrete_wall_008", tile: 3, color: "#fbf7ef", roughness: 0.6 }),
    signExchange: new THREE.MeshStandardMaterial({ map: signTexture("BÖRSE", "#e9dcc2", "#3a3226", "bold 40px Georgia, serif"), roughness: 0.7 }),
    signTownhall: new THREE.MeshStandardMaterial({ map: signTexture("RATHAUS"), roughness: 0.6 }),
    signStore: new THREE.MeshStandardMaterial({ map: signTexture("LAGER", "#2b3a47", "#f2c230", "bold 34px Arial, sans-serif"), roughness: 0.6 }),
    signLogistics: new THREE.MeshStandardMaterial({ map: signTexture("LOGISTIK", "#1d4f7a", "#ffffff", "bold 32px Arial, sans-serif"), roughness: 0.6 }),
    signHarbour: new THREE.MeshStandardMaterial({ map: signTexture("HAFEN", "#1d4f7a", "#ffffff", "bold 34px Arial, sans-serif"), roughness: 0.6 }),
    craneYellow: new THREE.MeshStandardMaterial({ color: "#d9a21b", roughness: 0.55, metalness: 0.3 }),
    cladBlue: photoMaterial({ texture: "corrugated_iron_02", tile: 2, mode: "grain", strength: 0.7, color: "#3d6f9e", roughness: 0.55, metalness: 0.3 }),
    officeGlass: new THREE.MeshStandardMaterial({ color: "#6f93ab", roughness: 0.08, metalness: 0.55 }),
    signTaxOffice: new THREE.MeshStandardMaterial({ map: signTexture("FINANZAMT", "#1f5f3f", "#f4f1ea", "bold 30px Arial, sans-serif"), roughness: 0.6 }),
    sandstone: photoMaterial({ texture: "sandstone_brick_wall_01", tile: 2.5, color: "#f2e6cf", roughness: 0.85 }),
    clockFace: new THREE.MeshStandardMaterial({ color: "#f6f2e6", roughness: 0.5 }),
    gold: new THREE.MeshStandardMaterial({ color: "#c9a23a", roughness: 0.35, metalness: 0.8 }),
    flagRed: new THREE.MeshStandardMaterial({ color: "#b8332a", roughness: 0.8, side: THREE.DoubleSide }),
    flagBlue: new THREE.MeshStandardMaterial({ color: "#1a6fa8", roughness: 0.8, side: THREE.DoubleSide }),
    signPool: new THREE.MeshStandardMaterial({ map: signTexture("SCHWIMMBAD"), roughness: 0.6 }),
    signFair: new THREE.MeshStandardMaterial({ map: signTexture("JAHRMARKT"), roughness: 0.6, emissive: "#ffcf6b", emissiveIntensity: 0.2 }),
    signJobs: new THREE.MeshStandardMaterial({ map: signTexture("ARBEITSAMT"), roughness: 0.6 }),
    signPolice: new THREE.MeshStandardMaterial({ map: signTexture("POLIZEI", "#1f4e8c", "#ffffff", "bold 36px Arial, sans-serif"), roughness: 0.5 }),
    signFire: new THREE.MeshStandardMaterial({ map: signTexture("FEUERWEHR", "#b4221c", "#ffffff", "bold 32px Arial, sans-serif"), roughness: 0.5 }),
    policeStripe: new THREE.MeshStandardMaterial({ color: "#1f4e8c", roughness: 0.5 }),
    rollerDoor: new THREE.MeshStandardMaterial({ color: "#c0272d", roughness: 0.55, metalness: 0.2 }),
    signRecycling: new THREE.MeshStandardMaterial({ map: signTexture("RECYCLING"), roughness: 0.6 }),
    signJeweller: new THREE.MeshStandardMaterial({ map: signTexture("JUWELIER", "#14181d", "#e8c45a", "italic bold 34px Georgia, serif"), roughness: 0.4, emissive: "#e8c45a", emissiveIntensity: 0.12 }),
    signSmelter: new THREE.MeshStandardMaterial({ map: signTexture("GOLDSCHMELZE", "#3a2f22", "#f2c230", "bold 28px Arial, sans-serif"), roughness: 0.6 }),
    darkFacade: photoMaterial({ texture: "painted_plaster_wall", tile: 2.5, mode: "grain", strength: 0.4, color: "#2a2f36", roughness: 0.6 }),
    goldBar: new THREE.MeshStandardMaterial({ color: "#e8b923", roughness: 0.25, metalness: 1 }),
    melt: new THREE.MeshStandardMaterial({ color: "#ff8a1f", roughness: 0.4, emissive: "#ff6a00", emissiveIntensity: 1.6 }),
    goldOre: new THREE.MeshStandardMaterial({ color: "#8a7a52", roughness: 0.75, metalness: 0.35, flatShading: true }),
    glassLit: new THREE.MeshStandardMaterial({ color: "#3a3326", roughness: 0.1, metalness: 0.4, emissive: "#ffd98a", emissiveIntensity: 0.35 }),
    awningDark: new THREE.MeshStandardMaterial({ color: "#1c2128", roughness: 0.7, side: THREE.DoubleSide }),
    smelterRoof: photoMaterial({ texture: "corrugated_iron_02", tile: 2, mode: "grain", strength: 0.7, color: "#4d555b", roughness: 0.7, metalness: 0.2 }),
    poolWater: new THREE.MeshStandardMaterial({ color: "#2f9fc9", roughness: 0.05, metalness: 0.1 }),
    poolTile: photoMaterial({ texture: "concrete_tiles", tile: 1.5, mode: "grain", strength: 0.6, color: "#e4eef1", roughness: 0.5 }),
    slide: new THREE.MeshStandardMaterial({ color: "#e8452c", roughness: 0.35 }),
    paintRed: new THREE.MeshStandardMaterial({ color: "#c9302c", roughness: 0.5 }),
    paintYellow: new THREE.MeshStandardMaterial({ color: "#f2c230", roughness: 0.5 }),
    paintBlue: new THREE.MeshStandardMaterial({ color: "#2d6fb7", roughness: 0.5 }),
    paintGreen: new THREE.MeshStandardMaterial({ color: "#3c9a5f", roughness: 0.5 }),
    paintWhite: new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.5 }),
    hedge: photoMaterial({ texture: "forest_leaves_02", tile: 1.2, mode: "grain", strength: 0.95, color: "#3f6b34", roughness: 1 }),
    lawn: photoMaterial({ texture: "forest_leaves_02", tile: 6, mode: "grain", strength: 0.35, color: "#3f6a2a", roughness: 1 }),
    sand: new THREE.MeshStandardMaterial({ color: "#bfa576", roughness: 1 }),
    leaves: photoMaterial({ texture: "forest_leaves_02", tile: 1.5, mode: "grain", strength: 0.9, color: "#3d7a2e", roughness: 1 }),
    leavesLight: photoMaterial({ texture: "forest_leaves_02", tile: 1.5, mode: "grain", strength: 0.9, color: "#6a9a35", roughness: 1 }),
    pond: new THREE.MeshStandardMaterial({ color: "#2f6f86", roughness: 0.08, metalness: 0.1 }),
    /** Gable walls: white plaster with grain (houses tint it per instance). */
    gable: photoMaterial({ texture: "painted_plaster_wall", tile: 2.5, mode: "grain", strength: 0.55, color: "#ffffff", roughness: 0.9 }),
    gableCream: photoMaterial({ texture: "painted_plaster_wall", tile: 2.5, mode: "grain", strength: 0.55, color: "#efe2c4", roughness: 0.9 }),
    signShoeFactory: new THREE.MeshStandardMaterial({ map: signTexture("SCHUHFABRIK"), roughness: 0.6 }),
    signShoes: new THREE.MeshStandardMaterial({ map: signTexture("SCHUHE"), roughness: 0.6 }),
    signSpinning: new THREE.MeshStandardMaterial({ map: signTexture("SPINNEREI"), roughness: 0.6 }),
    signTextile: new THREE.MeshStandardMaterial({ map: signTexture("TEXTIL", "#24456e", "#ffffff", "bold 34px Arial, sans-serif"), roughness: 0.6 }),
    signFashion: new THREE.MeshStandardMaterial({ map: signTexture("MODE", "#1d1d1f", "#f4f1ea", "italic bold 36px Georgia, serif"), roughness: 0.5 }),
    awningBlue: new THREE.MeshStandardMaterial({ map: stripeTexture("#3f6fb5", "#f4f1ea", 8), roughness: 0.8, side: THREE.DoubleSide }),
    woolBale: new THREE.MeshStandardMaterial({ color: "#efe9d8", roughness: 1 }),
    yarnPink: new THREE.MeshStandardMaterial({ color: "#d98fb0", roughness: 0.9 }),
    clothBlue: new THREE.MeshStandardMaterial({ color: "#3f6fb5", roughness: 0.9 }),
    clothRed: new THREE.MeshStandardMaterial({ color: "#b8332a", roughness: 0.9 }),
    signTrader: new THREE.MeshStandardMaterial({ map: signTexture("IMPORT · EXPORT", "#1d3f5e", "#f2c230", "bold 26px Arial, sans-serif"), roughness: 0.6 }),
    signFood: new THREE.MeshStandardMaterial({ map: signTexture("LEBENSMITTEL", "#e5543a", "#ffffff", "bold 26px Arial, sans-serif"), roughness: 0.6 }),
    signDiscount: new THREE.MeshStandardMaterial({ map: signTexture("DISCOUNT", "#f2c230", "#c0261c", "bold 36px Arial, sans-serif"), roughness: 0.5 }),
    signEggs: new THREE.MeshStandardMaterial({ map: signTexture("FRISCHE EIER", "#f4f1ea", "#7a4a2a", "bold 26px Georgia, serif"), roughness: 0.6 }),
    hen: new THREE.MeshStandardMaterial({ color: "#f6f2e8", roughness: 0.9 }),
    henBrown: new THREE.MeshStandardMaterial({ color: "#a8643a", roughness: 0.9 }),
    comb: new THREE.MeshStandardMaterial({ color: "#d63a2a", roughness: 0.7 }),
    run: photoMaterial({ texture: "gravel_floor", tile: 2.5, color: "#c9b48a", roughness: 1 }),
    stainless: new THREE.MeshStandardMaterial({ color: "#d4d8db", roughness: 0.3, metalness: 0.7 }),
    cocoaSack: new THREE.MeshStandardMaterial({ color: "#8a6a44", roughness: 1 }),
    parkLine: new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.8 }),
    signRubber: new THREE.MeshStandardMaterial({ map: signTexture("GUMMIWERK", "#2b2b2b", "#f2c230", "bold 32px Arial, sans-serif"), roughness: 0.6 }),
    tanLiquid: new THREE.MeshStandardMaterial({ color: "#5a3a1c", roughness: 0.15 }),
    hide: new THREE.MeshStandardMaterial({ color: "#b48a64", roughness: 0.9, side: THREE.DoubleSide }),
    rubberBlack: new THREE.MeshStandardMaterial({ color: "#232323", roughness: 0.75 }),
    latex: new THREE.MeshStandardMaterial({ color: "#e7dfc4", roughness: 0.8 }),
    awningBrown: new THREE.MeshStandardMaterial({ map: stripeTexture("#7a4a2a", "#f4f1ea", 8), roughness: 0.8, side: THREE.DoubleSide }),
    signBakeFactory: new THREE.MeshStandardMaterial({ map: signTexture("BACKFABRIK"), roughness: 0.6 }),
    signCentre: new THREE.MeshStandardMaterial({ map: signTexture("MÖBELZENTRUM", "#1f5aa6", "#ffd21f", "bold 30px Arial, sans-serif"), roughness: 0.5, emissive: "#ffd21f", emissiveIntensity: 0.08 }),
    centreBlue: photoMaterial({ texture: "corrugated_iron_02", tile: 2, mode: "grain", strength: 0.6, color: "#1f5aa6", roughness: 0.6, metalness: 0.2 }),
    centreYellow: new THREE.MeshStandardMaterial({ color: "#ffd21f", roughness: 0.5 }),
    asphalt: photoMaterial({ texture: "asphalt_02", tile: 4, color: "#9a9a9a", roughness: 0.95 }),
    signCinema: new THREE.MeshStandardMaterial({ map: signTexture("KINO"), roughness: 0.6, emissive: "#ffcf6b", emissiveIntensity: 0.25 }),
    awningGreen: new THREE.MeshStandardMaterial({ map: stripeTexture("#2c6e49", "#f4f1ea", 8), roughness: 0.8, side: THREE.DoubleSide }),
    cinemaWall: photoMaterial({ texture: "concrete_wall_008", tile: 3, mode: "grain", strength: 0.7, color: "#8d3442", roughness: 0.8 }),
    poster: new THREE.MeshStandardMaterial({ color: "#f2c14e", roughness: 0.5, emissive: "#f2c14e", emissiveIntensity: 0.15 }),
    parasol: new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.8 }),
    glass: new THREE.MeshStandardMaterial({ color: "#2d4656", roughness: 0.15, metalness: 0.5 }),
    tiles: photoMaterial({ texture: "concrete_tiles", tile: 2, mode: "grain", strength: 0.6, color: "#e9ecec", roughness: 0.6 }),
    fence: photoMaterial({ texture: "weathered_plank_siding", tile: 2, mode: "grain", strength: 0.6, color: "#8a6440", roughness: 0.9 }),
    straw: new THREE.MeshStandardMaterial({ color: "#d9b75a", roughness: 1 }),
    awning: new THREE.MeshStandardMaterial({ map: stripeTexture("#c0392b", "#f4f1ea", 8), roughness: 0.8, side: THREE.DoubleSide }),
    brick: photoMaterial({ texture: "red_brick_03", tile: 1.6, color: "#e6cfc6", roughness: 0.9 }),
    wood: photoMaterial({ texture: "weathered_plank_siding", tile: 2.5, mode: "grain", strength: 0.75, color: "#8c3a26", roughness: 0.85 }),
    stone: photoMaterial({ texture: "castle_wall_slates", tile: 2.5, color: "#dcd6cb", roughness: 0.95 }),
    concrete: photoMaterial({ texture: "concrete_wall_008", tile: 3, color: "#f0ede6", roughness: 0.85 }),
    // Double-sided: also used for roof slopes, whose faces must show from above.
    slate: photoMaterial({ texture: "roof_slates_02", tile: 3, color: "#8e959b", roughness: 0.7, side: THREE.DoubleSide }),
    copper: new THREE.MeshStandardMaterial({ color: "#5f8f7c", roughness: 0.6, metalness: 0.3 }),
    steel: photoMaterial({ texture: "metal_plate", tile: 2.5, mode: "grain", strength: 0.5, color: "#a7b0b7", roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide }),
    water: new THREE.MeshStandardMaterial({ color: "#3c7d95", roughness: 0.1 }),
    // Fields: the meadow photo texture tinted, so they have the same grain as the ground.
    // Tints above 1: the photo is dark (≈ 0.3 luminance).
    wheat: fieldMaterial(new THREE.Color(2.6, 2.05, 0.8), true),
    pasture: fieldMaterial(new THREE.Color(0.7, 1.45, 0.45), false),
    ring: new THREE.MeshBasicMaterial({ color: "#ffb703", transparent: true, opacity: 0.9, depthWrite: false }),
  };
}
const useAssets = () => {
  assets ??= createAssets();
  return assets;
};

/* ---------- houses (instanced) ---------- */

/** Marks a building group standing at its ground height, and the instanced house walls (`GroundShadows`). */
const GROUNDED = { base: true };
/** Animated subtree inside a building: not merged by the StaticBatcher. */
export const DYNAMIC = { dynamic: true };
const CONTACT = { contact: true };

/** Dimensions per house level: footprint, wall height, roof height. */
const HOUSE_DIMS = [
  null,
  { w: 8, d: 7.5, wall: 3.2, roof: 3.4, floors: 1 }, // Einfamilienhaus
  { w: 10, d: 9, wall: 5.8, roof: 4.2, floors: 2 }, // Doppelhaus
  { w: 11, d: 10, wall: 11.6, roof: 2.6, floors: 4 }, // Mehrfamilienhaus
  { w: 11, d: 10, wall: 23, roof: 0.8, floors: 8 }, // Wohnblock (almost flat roof)
  { w: 11, d: 10, wall: 40, roof: 0.6, floors: 14 }, // Hochhaus
  { w: 11, d: 10, wall: 68, roof: 0.6, floors: 24 }, // Turmhochhaus
  { w: 11, d: 10, wall: 112, roof: 0.6, floors: 40 }, // Wolkenkratzer (glass curtain wall)
] as const;
const HOUSE_LEVELS = [1, 2, 3, 4, 5, 6, 7] as const;
/** Towers from this level get a plant-room crown on the roof, the skyscraper also a spire. */
const CROWN_LEVEL = 6;
const SPIRE_COLOUR = new THREE.Color("#c4ccd2");
/** Facade colours of towers (light concrete, steel blue and glass tints instead of the house paints). */
const TOWER_COLOURS = ["#f1f1ee", "#dfe7ee", "#e8e4dc", "#d6e2e8", "#eef0f2", "#cfd9df"];
const HOUSE_WALL_H = HOUSE_DIMS[2].wall;
const HOUSE_ROOF_H = HOUSE_DIMS[2].roof;

function setInstances(mesh: THREE.InstancedMesh | null, items: { m: THREE.Matrix4; c: THREE.Color }[]) {
  if (!mesh) return;
  items.forEach((it, i) => {
    mesh.setMatrixAt(i, it.m);
    mesh.setColorAt(i, it.c);
  });
  mesh.count = items.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** Facade materials per level (window rows match the storeys). */
let facades: THREE.MeshStandardMaterial[] | null = null;
const facadeFor = (level: number) => {
  facades ??= [1, 1, 2, 4, 8, 14, 24, 40].map((f, i) =>
    i === 7
      ? // Skyscraper: glass curtain wall, glossy.
        new THREE.MeshStandardMaterial({ map: glassFacadeTexture(f), roughness: 0.25, metalness: 0.35 })
      : withPhoto(new THREE.MeshStandardMaterial({ map: facadeTexture(f, i >= 4), roughness: 0.9 }), {
          texture: i >= 4 ? "concrete_wall_008" : "painted_plaster_wall",
          tile: 2.5,
          mode: "grain",
          strength: 0.45,
        }),
  );
  return facades[level];
};

/** All houses of one level, instanced: walls, gables and roof slopes. */
function HouseLevel({ level, houses, grid }: { level: (typeof HOUSE_LEVELS)[number]; houses: Building[]; grid: DepthGrid }) {
  const a = useAssets();
  const dims = HOUSE_DIMS[level];
  const walls = useRef<THREE.InstancedMesh>(null);
  const gables = useRef<THREE.InstancedMesh>(null);
  const roofs = useRef<THREE.InstancedMesh>(null);
  const crowns = useRef<THREE.InstancedMesh>(null);
  const spires = useRef<THREE.InstancedMesh>(null);
  const tower = level >= CROWN_LEVEL;
  const data = useMemo(() => {
    const slopes = roofSlopes(dims.w, dims.d, dims.roof, 0.7, 0.6);
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    return houses.map((b) => {
      const y = buildingGround(b, grid);
      q.setFromAxisAngle(up, b.rot);
      const pos = new THREE.Vector3(b.x, y, b.z);
      const top = pos.clone().setY(y + dims.wall);
      return {
        wall: new THREE.Matrix4().compose(pos, q, new THREE.Vector3(dims.w, dims.wall, dims.d)),
        roof: new THREE.Matrix4().compose(top.clone().setY(top.y + slopes.y), q, new THREE.Vector3(...slopes.scale)),
        gable: new THREE.Matrix4().compose(top, q, new THREE.Vector3(dims.w, dims.roof, dims.d)),
        // Plant-room crown (set back from the edges) and, on the skyscraper, a spire.
        crown: new THREE.Matrix4().compose(top.clone().setY(top.y + dims.roof), q, new THREE.Vector3(dims.w * 0.62, level === 7 ? 6 : 3.5, dims.d * 0.62)),
        spire: new THREE.Matrix4().compose(top.clone().setY(top.y + dims.roof + 6), q, new THREE.Vector3(0.5, 18, 0.5)),
        wallColour: new THREE.Color(level >= CROWN_LEVEL ? TOWER_COLOURS[b.variant % TOWER_COLOURS.length] : WALL_COLOURS[b.variant % WALL_COLOURS.length]),
        roofColour: new THREE.Color(ROOF_COLOURS[(b.variant * 7 + 3) % ROOF_COLOURS.length]),
      };
    });
  }, [houses, grid, dims, level]);

  useLayoutEffect(() => {
    setInstances(walls.current, data.map((d) => ({ m: d.wall, c: d.wallColour })));
    setInstances(gables.current, data.map((d) => ({ m: d.gable, c: d.wallColour })));
    setInstances(roofs.current, data.map((d) => ({ m: d.roof, c: d.roofColour })));
    if (tower) setInstances(crowns.current, data.map((d) => ({ m: d.crown, c: d.wallColour })));
    if (level === 7) setInstances(spires.current, data.map((d) => ({ m: d.spire, c: SPIRE_COLOUR })));
  }, [data, tower, level]);

  const n = Math.max(1, data.length);
  return (
    <group>
      <instancedMesh key={`w${n}`} ref={walls} args={[a.box, facadeFor(level), n]} userData={CONTACT} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh key={`g${n}`} ref={gables} args={[a.roof.gables, a.gable, n]} castShadow frustumCulled={false} />
      <instancedMesh key={`r${n}`} ref={roofs} args={[a.roof.slopes, a.roofMat, n]} castShadow receiveShadow frustumCulled={false} />
      {tower && <instancedMesh key={`c${n}`} ref={crowns} args={[a.box, a.towerCrown, n]} castShadow receiveShadow frustumCulled={false} />}
      {level === 7 && <instancedMesh key={`s${n}`} ref={spires} args={[a.box, a.towerCrown, n]} castShadow frustumCulled={false} />}
    </group>
  );
}

function Houses({ houses, grid }: { houses: Building[]; grid: DepthGrid }) {
  const byLevel = useMemo(() => HOUSE_LEVELS.map((l) => houses.filter((h) => h.level === l)), [houses]);
  return (
    <group>
      {HOUSE_LEVELS.map((l) =>
        byLevel[l - 1].length > 0 ? <HouseLevel key={l} level={l} houses={byLevel[l - 1]} grid={grid} /> : null,
      )}
    </group>
  );
}

/* ---------- single buildings ---------- */

/** Box from y0 to y1 with size (w, d) at local (x, z). */
function Box({ m, x = 0, z = 0, w, d, y0 = 0, y1, rotY = 0 }: { m: THREE.Material; x?: number; z?: number; w: number; d: number; y0?: number; y1: number; rotY?: number }) {
  const a = useAssets();
  return <mesh geometry={a.box} material={m} position={[x, y0, z]} scale={[w, y1 - y0, d]} rotation={[0, rotY, 0]} castShadow receiveShadow />;
}

/** Gable roof over a box of size (w, d) at local (x, z), ridge along x. */
function Roof({ m, g, x = 0, z = 0, w, d, y, h, overhang = 0.6 }: { m?: THREE.Material; g?: THREE.Material; x?: number; z?: number; w: number; d: number; y: number; h: number; overhang?: number }) {
  const a = useAssets();
  const slopes = roofSlopes(w, d, h, overhang);
  return (
    <group position={[x, y, z]}>
      <mesh geometry={a.roof.slopes} material={m ?? a.roofRed} position-y={slopes.y} scale={slopes.scale} castShadow receiveShadow />
      <mesh geometry={a.roof.gables} material={g ?? a.gableCream} scale={[w, h, d]} castShadow />
    </group>
  );
}

/** One house as a single model (the village draws houses instanced; this is for previews). */
export function HouseModel() {
  const a = useAssets();
  const [w, d] = BUILDINGS.house.size;
  return (
    <group>
      <Box m={a.plaster} w={w} d={d} y1={HOUSE_WALL_H} />
      <Roof w={w} d={d} y={HOUSE_WALL_H} h={HOUSE_ROOF_H} />
    </group>
  );
}

function BakeryShop() {
  const a = useAssets();
  return (
    <group>
      <Box m={a.shop} w={13} d={12} y1={6} />
      <Roof w={13} d={12} y={6} h={4} />
      {/* Awning over the shop window and the sign board. */}
      <mesh geometry={a.box} material={a.awning} position={[-1.5, 3.2, -6.9]} scale={[9, 0.12, 1.8]} rotation={[0.3, 0, 0]} castShadow />
      <mesh geometry={a.box} material={a.sign} position={[0, 4.4, -6.15]} scale={[6, 1.3, 0.2]} />
      {/* Bakehouse chimney. */}
      <Box m={a.brick} w={1} d={1} y1={10.5} x={4} z={3} />
    </group>
  );
}

/** Small delivery van (box body and cab), facing −z. */
function Van({ x, z, rot = 0 }: { x: number; z: number; rot?: number }) {
  const a = useAssets();
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <Box m={a.paintWhite} w={2.1} d={3.6} y0={0.5} y1={2.8} z={0.6} />
      <Box m={a.paintWhite} w={2.1} d={1.6} y0={0.5} y1={2.1} z={-1.9} />
      <Box m={a.glass} w={1.9} d={0.1} y0={1.3} y1={2} z={-2.72} />
      {[-1.2, 1.4].map((wz) =>
        [-1.05, 1.05].map((wx) => (
          <mesh key={`${wx}${wz}`} position={[wx, 0.4, wz]} rotation={[0, 0, Math.PI / 2]} material={a.coal}>
            <cylinderGeometry args={[0.4, 0.4, 0.3, 12]} />
          </mesh>
        )),
      )}
    </group>
  );
}

/** Bakery; level 2 Backfabrik: shop at the road, production hall, flour silo, loading dock. */
export function Bakery({ level = 1 }: { level?: number }) {
  const a = useAssets();
  if (level < 2) return <BakeryShop />;
  return (
    <group>
      <group position={[-8, 0, -4.5]}>
        <BakeryShop />
      </group>
      {/* Production hall with ovens' exhaust stacks and a sign. */}
      <Box m={a.brick} w={16} d={16} y1={9} x={6} z={2} />
      <Box m={a.concrete} w={16.6} d={16.6} y0={9} y1={9.6} x={6} z={2} />
      {[1.5, 6, 10.5].map((x) => (
        <Box key={x} m={a.steel} w={0.9} d={0.9} y0={9.6} y1={13} x={x} z={5} />
      ))}
      {[0, 4, 8, 12].map((x) => (
        <Box key={x} m={a.glass} w={2.4} d={0.15} y0={3} y1={6.5} x={x} z={-6.05} />
      ))}
      <mesh geometry={a.box} material={a.signBakeFactory} position={[6, 7.4, -6.1]} scale={[8, 1.4, 0.15]} />
      {/* Loading dock with vans. */}
      <Box m={a.concrete} w={12} d={3} y1={1.2} x={6} z={-7.5} />
      <Box m={a.hall} w={12} d={3.4} y0={4.5} y1={4.8} x={6} z={-7.5} />
      <Van x={2} z={-9.5} rot={Math.PI} />
      <Van x={9} z={-9.5} rot={Math.PI} />
      {/* Flour silo behind the shop. */}
      <Silo x={-9} z={6} r={2.2} h={12} />
    </group>
  );
}

export function Waterworks({ level }: { level: number }) {
  const a = useAssets();
  return (
    <group>
      {/* Pump house and well (Brunnen). */}
      <Box m={a.brick} w={6} d={6} y1={3.6} x={-4} z={-3} />
      <Roof w={6} d={6} y={3.6} h={2.4} x={-4} z={-3} />
      <mesh position={[3, 0.5, -4]} material={a.stone} castShadow>
        <cylinderGeometry args={[1.7, 1.8, 1, 16]} />
      </mesh>
      <mesh position={[3, 1.02, -4]} material={a.water} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.4, 16]} />
      </mesh>
      {level >= 2 && (
        <mesh position={[3, 3.5, 3.5]} material={a.concrete} castShadow receiveShadow>
          <cylinderGeometry args={[4.5, 4.5, 7, 24]} />
        </mesh>
      )}
      {level >= 3 && (
        <group position={[-4, 0, 5]}>
          <mesh position={[0, 10, 0]} material={a.concrete} castShadow>
            <cylinderGeometry args={[1.6, 2.2, 20, 16]} />
          </mesh>
          <mesh position={[0, 23, 0]} material={a.concrete} castShadow>
            <cylinderGeometry args={[5, 3.5, 6, 24]} />
          </mesh>
          <mesh position={[0, 27.5, 0]} material={a.slate} castShadow>
            <coneGeometry args={[5.4, 3, 24]} />
          </mesh>
        </group>
      )}
    </group>
  );
}

/** Field draped over the terrain (local rectangle of a farm). */
function Field({ b, grid, x, z, w, d, m }: { b: Building; grid: DepthGrid; x: number; z: number; w: number; d: number; m: THREE.Material }) {
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(w, d, Math.ceil(w / 4), Math.ceil(d / 4)).rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const c = Math.cos(b.rot);
    const s = Math.sin(b.rot);
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i) + x;
      const lz = pos.getZ(i) + z;
      const wx = b.x + lx * c + lz * s;
      const wz = b.z - lx * s + lz * c;
      pos.setY(i, Math.max(0, -sampleDepth(grid, wx, wz)) + 0.08);
    }
    g.computeVertexNormals();
    return g;
  }, [b, grid, x, z, w, d]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  // Geometry is in world height but local x/z: place at the building origin, rotated.
  return (
    <group position={[b.x, 0, b.z]} rotation={[0, b.rot, 0]}>
      <mesh geometry={geometry} material={m} position={[x, 0, z]} receiveShadow />
    </group>
  );
}

export function Farm({ b, grid, y }: { b: Building; grid: DepthGrid; y: number }) {
  const a = useAssets();
  const style = useCity((s) => s.houseStyle);
  const [, depth] = BUILDINGS.farm.size;
  const front = -depth / 2;
  const height = useMemo(() => localHeight(b, grid, y), [b, grid, y]);
  const wheat = b.level >= 2 ? WHEAT_WITH_PIGS : WHEAT;
  return (
    <>
      <group position={[b.x, y, b.z]} rotation={[0, b.rot, 0]} userData={GROUNDED}>
        {style === "pack" ? (
          <Suspense fallback={null}>
            <PackFarmyard front={front} level={b.level} />
          </Suspense>
        ) : (
          <>
        {/* Farmyard at the road: farmhouse, barn, silo. */}
        <Box m={a.plaster} w={12} d={9} y1={6.5} x={-15} z={front + 8} />
        <Roof w={12} d={9} y={6.5} h={4} x={-15} z={front + 8} />
        <Box m={a.wood} w={16} d={13} y1={8} x={6} z={front + 10} />
        <Roof m={a.slate} g={a.wood} w={16} d={13} y={8} h={5} x={6} z={front + 10} />
        <mesh position={[20, 7, front + 9]} material={a.steel} castShadow>
          <cylinderGeometry args={[2.6, 2.6, 14, 20]} />
        </mesh>
        <mesh position={[20, 14.6, front + 9]} material={a.steel} castShadow>
          <sphereGeometry args={[2.6, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
        {b.level >= 3 && (
          <>
            {/* Estate: open machine shed between house and barn, second taller silo. */}
            <Box m={a.steel} w={6.6} d={0.25} y1={5} x={-5.5} z={front + 16.4} />
            <Box m={a.steel} w={0.25} d={13} y1={5} x={-8.7} z={front + 10} />
            <Box m={a.steel} w={0.25} d={13} y1={5} x={-2.3} z={front + 10} />
            <Box m={a.slate} w={7.2} d={13.6} y0={5} y1={5.35} x={-5.5} z={front + 10} />
            <Box m={a.straw} w={5.6} d={3} y1={1.6} x={-5.5} z={front + 13.8} />
            <mesh position={[25.3, 8.5, front + 9]} material={a.steel} castShadow>
              <cylinderGeometry args={[2.2, 2.2, 17, 20]} />
            </mesh>
            <mesh position={[25.3, 17.6, front + 9]} material={a.steel} castShadow>
              <coneGeometry args={[2.4, 1.6, 20]} />
            </mesh>
          </>
        )}
          </>
        )}
        {b.level >= 2 && <PigRun a={a} height={height} level={b.level} pack={style === "pack"} />}
        <Pasture a={a} height={height} level={b.level} pack={style === "pack"} />
      </group>
      {/* Fields, pasture and pig run behind the yard, following the terrain. */}
      <Field b={b} grid={grid} x={(WHEAT.x0 + WHEAT.x1) / 2} z={(wheat.z0 + wheat.z1) / 2} w={WHEAT.x1 - WHEAT.x0} d={wheat.z1 - wheat.z0} m={style === "pack" ? packFieldMaterials().wheat : a.wheat} />
      <Field b={b} grid={grid} x={(PASTURE.x0 + PASTURE.x1) / 2} z={(PASTURE.z0 + PASTURE.z1) / 2} w={PASTURE.x1 - PASTURE.x0} d={PASTURE.z1 - PASTURE.z0} m={style === "pack" ? packFieldMaterials().pasture : a.pasture} />
      {b.level >= 2 && (
        <Field b={b} grid={grid} x={(PIG_RUN.x0 + PIG_RUN.x1) / 2} z={(PIG_RUN.z0 + PIG_RUN.z1) / 2} w={PIG_RUN.x1 - PIG_RUN.x0} d={PIG_RUN.z1 - PIG_RUN.z0} m={style === "pack" ? packFieldMaterials().mud : mudMaterial()} />
      )}
    </>
  );
}

/* Farm layout behind the yard (local coordinates, front of the plot at z = −31). */
const PASTURE: Area = { x0: -27, x1: -2, z0: -12, z1: 30 };
const PIG_RUN: Area = { x0: 1, x1: 27, z0: -11, z1: 6 };
const WHEAT = { x0: 0, x1: 27, z0: -10, z1: 29 };
const WHEAT_WITH_PIGS = { ...WHEAT, z0: 8 };
const inset = (r: Area, m: number): Area => ({ x0: r.x0 + m, x1: r.x1 - m, z0: r.z0 + m, z1: r.z1 - m });
const COW_AREA = inset(PASTURE, 2);
const BEEF_AREA: Area = { ...COW_AREA, z1: 12 };
const PIG_AREA: Area = { ...inset(PIG_RUN, 1.2), z1: PIG_RUN.z1 - 4.5 };

type Assets = ReturnType<typeof useAssets>;

/** Fenced cow pasture with water trough and an open shelter; beef cattle from level 2. */
function Pasture({ a, height, level, pack }: { a: Assets; height: (x: number, z: number) => number; level: number; pack: boolean }) {
  const shelterY = height(-22.5, 26.5);
  const troughY = height(-5, -8.5);
  if (pack)
    return (
      <group>
        <Fence area={PASTURE} height={(x, z) => height(x, z) + 0.08} kind="pasture" />
        <PackShelter y={shelterY} />
        <PackTrough x={-5} z={-8.5} y={troughY} w={3.4} />
        <Herd kind="cow" count={level >= 3 ? 9 : 6} area={COW_AREA} seed={11} height={(x, z) => height(x, z) + 0.08} coat={DAIRY_COAT} />
        {level >= 2 && <Herd kind="cow" count={3} area={BEEF_AREA} seed={23} height={(x, z) => height(x, z) + 0.08} coat={BEEF_COAT} />}
      </group>
    );
  return (
    <group>
      <Fence area={PASTURE} height={(x, z) => height(x, z) + 0.08} kind="pasture" />
      {/* Open shelter: roof on posts. */}
      <group position={[-22.5, shelterY, 26.5]}>
        {[
          [-3.5, -2],
          [3.5, -2],
          [-3.5, 2],
          [3.5, 2],
        ].map(([x, z]) => (
          <Box key={`${x}${z}`} m={a.log} w={0.3} d={0.3} y1={3} x={x} z={z} />
        ))}
        <Box m={a.wood} w={7.6} d={0.2} y1={2.6} z={2.1} />
        <Roof m={a.slate} g={a.wood} w={8} d={4.6} y={3} h={1.2} />
      </group>
      {/* Water trough. */}
      <group position={[-5, troughY, -8.5]}>
        <Box m={a.steel} w={3.2} d={0.9} y1={0.7} />
        <Box m={a.water} w={2.9} d={0.6} y0={0.6} y1={0.66} />
      </group>
      <Herd kind="cow" count={level >= 3 ? 9 : 6} area={COW_AREA} seed={11} height={(x, z) => height(x, z) + 0.08} coat={DAIRY_COAT} />
      {level >= 2 && <Herd kind="cow" count={3} area={BEEF_AREA} seed={23} height={(x, z) => height(x, z) + 0.08} coat={BEEF_COAT} />}
    </group>
  );
}

/** Pig run: muddy, fenced, with pig arks (corrugated half-tubes) and a feeding trough. */
function PigRun({ a, height, level, pack }: { a: Assets; height: (x: number, z: number) => number; level: number; pack: boolean }) {
  if (pack)
    return (
      <group>
        <Fence area={PIG_RUN} height={(x, z) => height(x, z) + 0.08} kind="pigs" />
        {[6, 13.5, 21].map((x) => (
          <PackPigHut key={x} x={x} z={3.5} y={height(x, 3.5) + 0.05} />
        ))}
        <PackTrough x={20} z={-9.6} y={height(20, -9.6)} w={5} feed />
        <Herd kind="pig" count={level >= 3 ? 13 : 9} area={PIG_AREA} seed={5} height={(x, z) => height(x, z) + 0.08} />
      </group>
    );
  return (
    <group>
      <Fence area={PIG_RUN} height={(x, z) => height(x, z) + 0.08} kind="pigs" />
      {[6, 13.5, 21].map((x) => (
        <group key={x} position={[x, height(x, 3.5) + 0.05, 3.5]}>
          {/* Half-tube along z, open towards the front (−z); closed back wall. */}
          <mesh rotation={[Math.PI / 2, 0, 0]} material={a.steel} castShadow receiveShadow>
            <cylinderGeometry args={[1.25, 1.25, 3.2, 18, 1, true, Math.PI / 2, Math.PI]} />
          </mesh>
          <mesh position={[0, 0, 1.6]} material={a.steel}>
            <circleGeometry args={[1.25, 18, 0, Math.PI]} />
          </mesh>
          {/* Straw bedding at the entrance. */}
          <Box m={a.straw} w={2.2} d={1.2} y1={0.1} z={-2} />
        </group>
      ))}
      {/* Feeding trough along the front fence. */}
      <group position={[20, height(20, -9.6), -9.6]}>
        <Box m={a.steel} w={5} d={0.7} y1={0.45} />
        <Box m={a.straw} w={4.7} d={0.45} y0={0.4} y1={0.47} />
      </group>
      <Herd kind="pig" count={level >= 3 ? 13 : 9} area={PIG_AREA} seed={5} height={(x, z) => height(x, z) + 0.08} />
    </group>
  );
}

const RED_CROSS = new THREE.MeshBasicMaterial({ color: "#d62f2f" });

export function Hospital() {
  const a = useAssets();
  return (
    <group>
      {/* Main wing with four storeys and a flat roof, entrance canopy at the front. */}
      <Box m={a.hospitalFacade} w={28} d={11} y1={13} z={-3} />
      <Box m={a.concrete} w={28.6} d={11.6} y0={13} y1={13.6} z={-3} />
      <Box m={a.hospitalFacade} w={11} d={10} y1={8} x={-8} z={6.5} />
      <Box m={a.concrete} w={11.6} d={10.6} y0={8} y1={8.6} x={-8} z={6.5} />
      <Box m={a.concrete} w={8} d={3} y0={3.2} y1={3.6} z={-10} />
      {/* Red cross on the front and helipad on the roof. */}
      <mesh position={[9, 10, -8.56]} material={RED_CROSS} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[1, 3.4]} />
      </mesh>
      <mesh position={[9, 10, -8.56]} material={RED_CROSS} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[3.4, 1]} />
      </mesh>
      <mesh position={[6, 13.65, -3]} rotation={[-Math.PI / 2, 0, 0]} material={a.slate}>
        <circleGeometry args={[4, 24]} />
      </mesh>
    </group>
  );
}

/** Classic German post windmill (Bockwindmühle) with turning sails. */
/** Steel grain silo with a cone roof and stiffening rings. */
function Silo({ x, z, r = 3, h = 15 }: { x: number; z: number; r?: number; h?: number }) {
  const a = useAssets();
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, h / 2, 0]} material={a.steel} castShadow receiveShadow>
        <cylinderGeometry args={[r, r, h, 24]} />
      </mesh>
      {[0.3, 0.6, 0.9].map((f) => (
        <mesh key={f} position={[0, h * f, 0]} material={a.hall}>
          <cylinderGeometry args={[r + 0.06, r + 0.06, 0.25, 24]} />
        </mesh>
      ))}
      <mesh position={[0, h + r * 0.3, 0]} material={a.steel} castShadow>
        <coneGeometry args={[r + 0.15, r * 0.6, 24]} />
      </mesh>
      {/* Ladder. */}
      <Box m={a.hall} w={0.5} d={0.12} y1={h} z={-r - 0.1} />
    </group>
  );
}

/** Windmill with turning sails and a small store house; `x` shifts it inside a larger plot. */
function Windmill({ x = 0 }: { x?: number }) {
  const a = useAssets();
  const sails = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (sails.current) sails.current.rotation.z += dt * 0.8;
  });
  return (
    <group position={[x, 0, 0]}>
      {/* Stone base, wooden body on top, small store house beside it. */}
      <mesh position={[0, 1.5, 0]} material={a.stone} castShadow receiveShadow>
        <cylinderGeometry args={[3.6, 4.2, 3, 12]} />
      </mesh>
      <Box m={a.wood} w={5.5} d={6.5} y0={3} y1={11} />
      <Roof m={a.slate} g={a.wood} w={6.5} d={5.5} y={11} h={3.2} overhang={0.3} />
      <group ref={sails} position={[0, 9, -3.6]} userData={DYNAMIC}>
        {[0, 1, 2, 3].map((i) => (
          <group key={i} rotation={[0, 0, (i * Math.PI) / 2]}>
            <mesh position={[0, 4.6, 0]} material={a.wood} castShadow>
              <boxGeometry args={[0.35, 9, 0.25]} />
            </mesh>
            <mesh position={[0.9, 5.4, 0.05]} material={a.sail} castShadow>
              <boxGeometry args={[1.6, 7, 0.08]} />
            </mesh>
          </group>
        ))}
        <mesh rotation={[Math.PI / 2, 0, 0]} material={a.steel}>
          <cylinderGeometry args={[0.6, 0.6, 0.8, 12]} />
        </mesh>
      </group>
      <Box m={a.plaster} w={6} d={5} y1={3.4} x={-6} z={3} />
      <Roof w={6} d={5} y={3.4} h={2.4} x={-6} z={3} />
    </group>
  );
}

/**
 * Mill by level: 1 windmill, 2 + one silo, 3 + two silos with a conveyor bridge, 4 Mühlenfabrik
 * (brick roller mill, office, four silos, loading yard). Local origin = plot centre.
 */
export function Mill({ level = 1 }: { level?: number }) {
  const a = useAssets();
  const sacks = (x: number, z: number) =>
    [0, 1, 2].map((i) => <Box key={i} m={a.sack} w={0.8} d={0.6} y1={0.5} x={x + i * 0.9} z={z} />);
  if (level >= 4)
    return (
      <group>
        {/* Loading yard in front. */}
        <Box m={a.yard} w={40} d={7} y1={0.05} z={-11} />
        {/* Roller mill: five storeys of brick, slate roof, hoist bay. */}
        <Box m={a.brick} w={16} d={14} y1={17} x={-11} z={3} />
        <Roof m={a.slate} g={a.brick} w={16} d={14} y={17} h={4} x={-11} z={3} />
        {[3, 6.5, 10, 13.5].map((y) =>
          [-16, -12.5, -9, -5.5].map((x) => <Box key={`${x}${y}`} m={a.glass} w={1.6} d={0.15} y0={y} y1={y + 2} x={x} z={-4.05} />),
        )}
        <Box m={a.wood} w={3} d={0.2} y1={4} x={-11} z={-4.1} />
        {/* Office annex. */}
        <Box m={a.plaster} w={8} d={6} y1={7} x={-15} z={-6.5} />
        <Roof w={8} d={6} y={7} h={2.4} x={-15} z={-6.5} />
        {/* Four silos and the conveyor bridge to the mill. */}
        {[
          [7, -2],
          [14, -2],
          [7, 6],
          [14, 6],
        ].map(([x, z]) => (
          <Silo key={`${x}${z}`} x={x} z={z} r={3.3} h={20} />
        ))}
        <Box m={a.hall} w={14} d={2} y0={19} y1={21} x={-1} z={2} />
        <Box m={a.hall} w={12} d={2} y0={21} y1={22.2} x={10.5} z={2} />
        {sacks(-2, -9)}
      </group>
    );
  return (
    <group>
      <Windmill x={level === 1 ? 0 : level === 2 ? -3 : -6} />
      {level >= 2 && <Silo x={level === 2 ? 7.5 : 5} z={2} r={3} h={15} />}
      {level >= 3 && <Silo x={11.5} z={2} r={3} h={15} />}
      {/* Conveyor bridge from the silos to the mill. */}
      {level >= 3 && <Box m={a.hall} w={13} d={1.2} y0={14} y1={15} x={1.5} z={2} />}
      {sacks(level === 1 ? 3 : 0, level === 1 ? -5.5 : -6.5)}
    </group>
  );
}

/** Two-storey school with flat roof, playground and sports pitch behind it. */
/**
 * School: L-shaped two-storey block, schoolyard and sports pitch. Level 2 (Gesamtschule)
 * stacks two more storeys on the front block and adds a gym; level 3 (Schulzentrum) raises
 * the wing as well and links it to the yard with a glass canteen. The plot stays the same.
 */
export function School({ level = 1 }: { level?: number }) {
  const a = useAssets();
  const front = level >= 2 ? 16 : 8;
  const wing = level >= 3 ? 16 : 8;
  return (
    <group>
      <Box m={a.schoolFacade} w={26} d={9} y1={8} z={-7} />
      {level >= 2 && <Box m={a.schoolFacade} w={26} d={9} y0={8} y1={16} z={-7} />}
      <Box m={a.concrete} w={26.6} d={9.6} y0={front} y1={front + 0.5} z={-7} />
      <Box m={a.schoolFacade} w={9} d={12} y1={8} x={-8.5} z={3.5} />
      {level >= 3 && <Box m={a.schoolFacade} w={9} d={12} y0={8} y1={16} x={-8.5} z={3.5} />}
      <Box m={a.concrete} w={9.6} d={12.6} y0={wing} y1={wing + 0.5} x={-8.5} z={3.5} />
      {/* Entrance canopy with clock. */}
      <Box m={a.concrete} w={6} d={2.4} y0={3} y1={3.4} z={-12.4} />
      <mesh position={[6, 6.2, -11.56]} rotation={[0, Math.PI, 0]}>
        <circleGeometry args={[0.8, 20]} />
        <meshStandardMaterial color="#f4f4f0" />
      </mesh>
      {/* Schoolyard and sports pitch. */}
      <Box m={a.yard} w={14} d={10} y1={0.06} x={7} z={5} />
      <Box m={a.pitch} w={12} d={7} y1={0.08} x={7} z={5} />
      {[-4, 4].map((x) => (
        <Box key={x} m={a.steel} w={0.15} d={2} y1={1.4} x={7 + x * 1.35} z={5} />
      ))}
      {level >= 2 && (
        <>
          {/* Gym behind the pitch, with high windows. */}
          <Box m={a.hall} w={14} d={3.4} y1={6.5} x={7} z={11.3} />
          <Box m={a.officeGlass} w={13} d={0.1} y0={4.2} y1={5.8} x={7} z={9.55} />
          <Box m={a.concrete} w={14.4} d={3.8} y0={6.5} y1={6.9} x={7} z={11.3} />
          {/* Solar panels on the raised front block. */}
          {[-8, -2, 4, 10].map((x) => (
            <mesh key={x} position={[x, front + 1.1, -7]} rotation={[-0.5, 0, 0]} material={a.officeGlass} castShadow>
              <boxGeometry args={[4.5, 0.12, 3]} />
            </mesh>
          ))}
        </>
      )}
      {level >= 3 && (
        <>
          {/* Glass canteen between the wing and the yard. */}
          <Box m={a.officeGlass} w={3.6} d={9} y1={4.2} x={-2.2} z={4} />
          <Box m={a.concrete} w={4} d={9.4} y0={4.2} y1={4.6} x={-2.2} z={4} />
        </>
      )}
    </group>
  );
}

/** Steelworks: rolling-mill hall, blast furnace, cooling tower-like stacks and smoke. */
export function Steelworks() {
  const a = useAssets();
  const smoke = useRef<THREE.Group>(null);
  const smokeMats = useMemo(() => [0, 1, 2, 3, 4].map(() => a.smoke.clone()), [a]);
  useEffect(() => () => smokeMats.forEach((m) => m.dispose()), [smokeMats]);
  useFrame(({ clock }) => {
    const g = smoke.current;
    if (!g) return;
    g.children.forEach((c, i) => {
      const t = (clock.getElapsedTime() * 0.25 + i / g.children.length) % 1;
      c.position.y = t * 18;
      c.scale.setScalar(1 + t * 1.8);
      ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = 0.4 * (1 - t);
    });
  });
  return (
    <group>
      {/* Main hall with sawtooth roof. */}
      <Box m={a.hall} w={40} d={22} y1={13} x={-8} z={-6} />
      {[-24, -16, -8, 0, 8].map((x) => (
        <group key={x} position={[x + 4, 13, -6]} rotation={[0, Math.PI / 2, 0]}>
          <Roof m={a.steel} g={a.hall} w={22} d={8} y={0} h={3} overhang={0} />
        </group>
      ))}
      {/* Blast furnace with skip incline. */}
      <mesh position={[20, 11, -4]} material={a.rust} castShadow>
        <cylinderGeometry args={[4, 5.5, 22, 16]} />
      </mesh>
      <mesh position={[20, 24, -4]} material={a.rust} castShadow>
        <cylinderGeometry args={[2.5, 4, 4, 16]} />
      </mesh>
      <Box m={a.steel} w={1.4} d={22} y0={2} y1={3} x={14} z={6} rotY={0} />
      {/* Hot-blast stoves. */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[27, 9, -14 + i * 7]} material={a.concrete} castShadow>
          <cylinderGeometry args={[2.6, 2.6, 18, 16]} />
        </mesh>
      ))}
      {/* Chimneys with smoke. */}
      {[-24, -16].map((x) => (
        <mesh key={x} position={[x, 16, 9]} material={a.brick} castShadow>
          <cylinderGeometry args={[1.2, 1.8, 32, 12]} />
        </mesh>
      ))}
      <group ref={smoke} position={[-24, 32, 9]} userData={DYNAMIC}>
        {smokeMats.map((m, i) => (
          <mesh key={i} material={m}>
            <sphereGeometry args={[1.6, 10, 8]} />
          </mesh>
        ))}
      </group>
      {/* Coal and ore heaps, steel coils. */}
      <mesh position={[-22, 0, 17]} material={a.coal} castShadow>
        <coneGeometry args={[6, 5, 14]} />
      </mesh>
      <mesh position={[-8, 0, 17]} material={a.rust} castShadow>
        <coneGeometry args={[5, 4, 14]} />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[4 + i * 3, 1.1, 16]} rotation={[0, 0, Math.PI / 2]} material={a.steel} castShadow>
          <cylinderGeometry args={[1.1, 1.1, 1.6, 16]} />
        </mesh>
      ))}
    </group>
  );
}

/** Sawmill: wooden halls, log storage and board stacks. */
function SawmillBase() {
  const a = useAssets();
  return (
    <group>
      <Box m={a.wood} w={22} d={14} y1={8} x={-8} z={-7} />
      <Roof m={a.slate} g={a.wood} w={22} d={14} y={8} h={5} x={-8} z={-7} />
      <Box m={a.plank} w={12} d={10} y1={6} x={12} z={-9} />
      <Roof m={a.slate} g={a.plank} w={12} d={10} y={6} h={3.5} x={12} z={-9} />
      {/* Log piles. */}
      {[0, 1, 2].map((row) =>
        [0, 1, 2, 3, 4].map((i) => (
          <mesh
            key={`${row}-${i}`}
            position={[-14 + i * 1.3 + (row % 2) * 0.65, 0.6 + row * 1.1, 8]}
            rotation={[Math.PI / 2, 0, 0]}
            material={a.log}
            castShadow
          >
            <cylinderGeometry args={[0.6, 0.6, 10, 10]} />
          </mesh>
        )),
      )}
      {/* Board stacks. */}
      {[0, 1, 2].map((i) => (
        <Box key={i} m={a.plank} w={3} d={6} y1={1.6 + i * 0.3} x={4 + i * 4} z={8} />
      ))}
      <Box m={a.steel} w={0.8} d={0.8} y1={12} x={-15} z={-12} />
    </group>
  );
}

/** Log pile: rows of logs lying along z. */
function LogPile({ x, z, n = 5, rows = 3, len = 10 }: { x: number; z: number; n?: number; rows?: number; len?: number }) {
  const a = useAssets();
  return (
    <group position={[x, 0, z]}>
      {Array.from({ length: rows }, (_, row) =>
        Array.from({ length: n - row }, (_, i) => (
          <mesh key={`${row}-${i}`} position={[i * 1.3 + row * 0.65, 0.6 + row * 1.1, 0]} rotation={[Math.PI / 2, 0, 0]} material={a.log} castShadow>
            <cylinderGeometry args={[0.6, 0.6, len, 10]} />
          </mesh>
        )),
      )}
    </group>
  );
}

/**
 * Holzfabrik by level: 2 Großsägewerk adds a sawing line hall, drying kilns and more logs,
 * 3 Holzwerk a big processing hall, a gantry crane over the log yard and a sawdust silo.
 * The original yard keeps its place at the road (shifted with the deeper plot).
 */
export function Sawmill({ level = 1 }: { level?: number }) {
  const a = useAssets();
  const shift = level >= 3 ? -6 : level >= 2 ? -3 : 0;
  return (
    <group>
      <group position={[0, 0, shift]}>
        <SawmillBase />
      </group>
      {level >= 2 && (
        <>
          {/* Sawing line hall and drying kilns behind the yard. */}
          <Box m={a.hall} w={14} d={10} y1={7} x={17} z={8} />
          <Roof m={a.slate} g={a.hall} w={14} d={10} y={7} h={2.5} x={17} z={8} />
          {[-22, -17].map((x) => (
            <group key={x}>
              <Box m={a.brick} w={4} d={8} y1={5} x={x} z={13} />
              <Box m={a.concrete} w={4.4} d={8.4} y0={5} y1={5.4} x={x} z={13} />
            </group>
          ))}
          <LogPile x={-8} z={15} n={6} rows={3} len={8} />
        </>
      )}
      {level >= 3 && (
        <>
          <Box m={a.hall} w={22} d={14} y1={11} x={14} z={-5} />
          <Roof m={a.slate} g={a.hall} w={22} d={14} y={11} h={3} x={14} z={-5} />
          {/* Gantry crane over the log yard. */}
          {[-24, 2].map((x) => (
            <Box key={x} m={a.paintYellow} w={0.8} d={0.8} y1={10} x={x} z={20} />
          ))}
          <Box m={a.paintYellow} w={27} d={1} y0={10} y1={11} x={-11} z={20} />
          <Box m={a.steel} w={1.5} d={1.5} y0={8} y1={10} x={-6} z={20} />
          <LogPile x={-22} z={20} n={7} rows={4} len={6} />
          <Silo x={26} z={18} r={2.6} h={14} />
        </>
      )}
    </group>
  );
}

/** Furniture factory: brick workshop with sawtooth roof, timber store and steel racks. */
function FurnitureFactoryBase() {
  const a = useAssets();
  return (
    <group>
      <Box m={a.brick} w={28} d={16} y1={9} x={-4} z={-5} />
      {[-14, -7, 0, 7].map((x) => (
        <group key={x} position={[x + 3.5, 9, -5]} rotation={[0, Math.PI / 2, 0]}>
          <Roof m={a.slate} g={a.brick} w={16} d={7} y={0} h={2.6} overhang={0} />
        </group>
      ))}
      {/* Office at the road with large windows. */}
      <Box m={a.plaster} w={10} d={8} y1={7} x={14} z={-9} />
      <Box m={a.glass} w={8} d={0.2} y0={1.5} y1={5.5} x={14} z={-13.1} />
      <Box m={a.concrete} w={10.6} d={8.6} y0={7} y1={7.5} x={14} z={-9} />
      {/* Board stacks and steel profiles in the yard. */}
      {[0, 1, 2].map((i) => (
        <Box key={i} m={a.plank} w={3} d={5} y1={1.4 + i * 0.4} x={-14 + i * 4.5} z={9} />
      ))}
      {[0, 1].map((i) => (
        <Box key={`s${i}`} m={a.steel} w={6} d={1.2} y1={0.8 + i * 0.4} x={4} z={7 + i * 2.2} />
      ))}
      {/* Finished goods: wrapped furniture on pallets. */}
      {[0, 1, 2].map((i) => (
        <Box key={`p${i}`} m={a.sack} w={2.2} d={2.2} y1={2} x={11 + i * 3} z={8} />
      ))}
      <mesh position={[-16, 7, -12]} material={a.steel} castShadow>
        <cylinderGeometry args={[0.6, 0.6, 14, 10]} />
      </mesh>
    </group>
  );
}

/** Möbelfabrik by level: 2 adds an assembly hall, 3 a high-bay warehouse with truck dock. */
export function FurnitureFactory({ level = 1 }: { level?: number }) {
  const a = useAssets();
  const shift = level >= 3 ? -6 : level >= 2 ? -3 : 0;
  return (
    <group>
      <group position={[0, 0, shift]}>
        <FurnitureFactoryBase />
      </group>
      {level >= 2 && (
        <>
          {/* Assembly hall with saw-tooth roof behind the main hall. */}
          <Box m={a.brick} w={20} d={12} y1={8} x={-10} z={11} />
          {[-17, -10, -3].map((x) => (
            <group key={x} position={[x, 8, 11]} rotation={[0, Math.PI / 2, 0]}>
              <Roof m={a.slate} g={a.brick} w={12} d={7} y={0} h={2.4} overhang={0} />
            </group>
          ))}
        </>
      )}
      {level >= 3 && (
        <>
          {/* High-bay warehouse and truck dock. */}
          <Box m={a.hall} w={18} d={16} y1={15} x={17} z={10} />
          <Box m={a.concrete} w={18.4} d={16.4} y0={15} y1={15.5} x={17} z={10} />
          <Box m={a.concrete} w={14} d={3} y1={1.2} x={17} z={0.5} />
          <Van x={13} z={-2} rot={Math.PI} />
          <Van x={19} z={-2} rot={Math.PI} />
          <mesh position={[24, 9, -1]} material={a.steel} castShadow>
            <cylinderGeometry args={[0.7, 0.7, 18, 10]} />
          </mesh>
        </>
      )}
    </group>
  );
}

/**
 * Furniture store: big flat-roofed store with glass front, sign and car park. Level 2 adds an
 * upper sales floor, level 3 (Wohnwelt) a glass corner tower, a pylon sign and a café canopy.
 */
export function FurnitureStore({ level = 1 }: { level?: number }) {
  const a = useAssets();
  if (level >= 4) return <FurnitureCentre />;
  const top = level >= 2 ? 12.5 : 8;
  return (
    <group>
      <Box m={a.plaster} w={22} d={13} y1={8} z={1.5} />
      {level >= 2 && (
        <>
          {/* Upper sales floor with a ribbon window. */}
          <Box m={a.hall} w={22} d={13} y0={8} y1={top} z={1.5} />
          <Box m={a.glass} w={20} d={0.2} y0={9} y1={11.4} z={-5.05} />
        </>
      )}
      <Box m={a.concrete} w={22.6} d={13.6} y0={top} y1={top + 0.6} z={1.5} />
      <Box m={a.glass} w={16} d={0.2} y0={0.2} y1={5.6} x={-2} z={-5.1} />
      <mesh geometry={a.box} material={a.signFurniture} position={[0, 6.4, -5.2]} scale={[10, 1.5, 0.2]} />
      {/* Entrance canopy (the Wohnwelt enters through its glass tower). */}
      {level < 3 && <Box m={a.concrete} w={6} d={2.4} y0={3.6} y1={4} x={7} z={-6.2} />}
      {level >= 3 && (
        <>
          {/* Glass corner tower over the entrance. */}
          <Box m={a.glass} w={5} d={6} y0={0.05} y1={16} x={8.5} z={-4.5} />
          <Box m={a.concrete} w={5.4} d={6.4} y0={16} y1={16.5} x={8.5} z={-4.5} />
          {/* Pylon sign at the road. */}
          <Box m={a.steel} w={0.5} d={0.5} y1={11} x={-11.5} z={-9.2} />
          <mesh geometry={a.box} material={a.signFurniture} position={[-11.5, 11, -9.2]} scale={[5, 1.8, 0.4]} castShadow />
          {/* Café canopy with tables on the left of the front. */}
          <Box m={a.awning} w={6} d={2.2} y0={3} y1={3.2} x={-7.5} z={-6.3} />
          {[-9.5, -5.5].map((x) => (
            <Box key={x} m={a.plain} w={0.9} d={0.9} y0={0.75} y1={0.8} x={x} z={-6.4} />
          ))}
          {/* Rooftop solar panels. */}
          {[-7, -1, 5].map((x) => (
            <Box key={x} m={a.glass} w={4.6} d={9} y0={top + 0.6} y1={top + 0.75} x={x - 2} z={2} />
          ))}
        </>
      )}
      {/* Car park in front of the store. */}
      <Box m={a.yard} w={22} d={4.4} y1={0.05} z={-7.6} />
      {[-9, -5, -1, 3].map((x) => (
        <Box key={x} m={a.plain} w={0.12} d={4} y0={0.05} y1={0.07} x={x} z={-7.6} />
      ))}
    </group>
  );
}

/** Car colours for the furniture centre's car park. */
const PARKED = ["paintRed", "paintBlue", "paintWhite", "paintGreen", "steel", "coal"] as const;

/**
 * Möbelzentrum (furniture store level 4): a huge blue box with a yellow band and sign,
 * glass entrance, flags, a big car park with parked cars and a loading dock at the back.
 */
function FurnitureCentre() {
  const a = useAssets();
  return (
    <group>
      {/* Car park in front, with bays and parked cars. */}
      <Box m={a.asphalt} w={62} d={14} y1={0.05} z={-15.5} />
      {Array.from({ length: 24 }, (_, i) => -29 + i * 2.5).map((x) => (
        <Box key={x} m={a.plain} w={0.12} d={4.5} y0={0.05} y1={0.07} x={x} z={-16} />
      ))}
      {Array.from({ length: 14 }, (_, i) => i).map((i) => {
        const x = -27.75 + ((i * 7) % 23) * 2.5;
        return (
          <group key={i} position={[x, 0, -16]}>
            <Box m={a[PARKED[i % PARKED.length]]} w={1.8} d={4.2} y0={0.3} y1={1.2} />
            <Box m={a.glass} w={1.6} d={2.2} y0={1.2} y1={1.7} />
          </group>
        );
      })}
      {/* The blue box with the yellow band. */}
      <Box m={a.centreBlue} w={58} d={30} y1={15} z={6} />
      <Box m={a.centreYellow} w={58.2} d={30.2} y0={13} y1={14.2} z={6} />
      <Box m={a.concrete} w={58.6} d={30.6} y0={15} y1={15.5} z={6} />
      <mesh geometry={a.box} material={a.signCentre} position={[-8, 9.2, -9.15]} scale={[20, 5, 0.2]} />
      {/* Glass entrance block and canopy. */}
      <Box m={a.glass} w={12} d={3} y1={8} x={14} z={-10} />
      <Box m={a.centreYellow} w={14} d={5} y0={8} y1={8.6} x={14} z={-10.5} />
      {/* Flags. */}
      {[-30, -26, 26, 30].map((x, i) => (
        <group key={x} position={[x, 0, -23]}>
          <Box m={a.steel} w={0.15} d={0.15} y1={9} />
          <Box m={i % 2 ? a.centreYellow : a.centreBlue} w={1.8} d={0.05} y0={7} y1={8.4} x={0.9} />
        </group>
      ))}
      {/* Loading dock at the back. */}
      <Box m={a.concrete} w={20} d={3} y1={1.2} x={-14} z={22.5} />
      <Van x={-20} z={25} />
      <Van x={-14} z={25} />
    </group>
  );
}

const PEN_AREA: Area = { x0: -12, x1: 4, z0: 5.5, z1: 10.5 };
const penHeight = () => 0.05;

/** Gerberei: brick workshop, tanning pits, drying racks with hides, barrels and a chimney. */
export function Tannery() {
  const a = useAssets();
  return (
    <group>
      <Box m={a.gravel} w={28} d={22} y1={0.05} />
      <Box m={a.brick} w={16} d={10} y1={7} x={-6} z={-5} />
      <Roof m={a.roofRed} g={a.brick} w={16} d={10} y={7} h={3.6} x={-6} z={-5} />
      <Box m={a.brick} w={1.2} d={1.2} y1={13} x={-12} z={-1} />
      {/* Tanning pits in a grid. */}
      {[0, 1, 2].map((i) =>
        [0, 1].map((k) => (
          <group key={`${i}${k}`} position={[-10 + i * 5, 0, 5 + k * 4.5]}>
            <Box m={a.stone} w={4} d={3.6} y1={0.6} />
            <Box m={a.tanLiquid} w={3.4} d={3} y0={0.6} y1={0.62} />
          </group>
        )),
      )}
      {/* Drying racks with hides. */}
      {[3, 7.5].map((z) => (
        <group key={z} position={[8, 0, z]}>
          {[-5, 5].map((x) => (
            <Box key={x} m={a.log} w={0.2} d={0.2} y1={3} x={x} />
          ))}
          <Box m={a.log} w={10.2} d={0.15} y0={2.9} y1={3.05} />
          {[-3.6, -1.2, 1.2, 3.6].map((x) => (
            <Box key={x} m={a.hide} w={2} d={0.05} y0={1.2} y1={2.9} x={x} />
          ))}
        </group>
      ))}
      {/* Barrels of tanning liquor at the workshop. */}
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[4 + i * 1.3, 0.6, -8]} material={a.wood} castShadow>
          <cylinderGeometry args={[0.55, 0.5, 1.2, 12]} />
        </mesh>
      ))}
    </group>
  );
}

/** Gummifabrik: vulcanising hall with sign, latex tanks, chimney, caoutchouc bales, tyre stacks. */
export function RubberFactory() {
  const a = useAssets();
  return (
    <group>
      <Box m={a.yard} w={34} d={26} y1={0.05} />
      <Box m={a.hall} w={22} d={14} y1={9} x={-4} z={-2} />
      {[-12, -4, 4].map((x) => (
        <group key={x} position={[x, 9, -2]} rotation={[0, Math.PI / 2, 0]}>
          <Roof m={a.slate} g={a.hall} w={14} d={8} y={0} h={2.4} overhang={0} />
        </group>
      ))}
      <mesh geometry={a.box} material={a.signRubber} position={[-4, 7, -9.1]} scale={[9, 1.6, 0.2]} />
      {/* Latex tanks and chimney. */}
      {[3, 9].map((z) => (
        <mesh key={z} position={[13, 4, z]} material={a.paintWhite} castShadow>
          <cylinderGeometry args={[2.4, 2.4, 8, 20]} />
        </mesh>
      ))}
      <mesh position={[13, 9, -6]} material={a.brick} castShadow>
        <cylinderGeometry args={[0.8, 1.1, 18, 12]} />
      </mesh>
      {/* Caoutchouc bales and tyre stacks in the yard. */}
      {[0, 1, 2].map((i) => (
        <Box key={i} m={a.latex} w={1.6} d={1.2} y1={1 + (i % 2) * 0.6} x={-14 + i * 2} z={9} />
      ))}
      {[0, 1, 2, 3].map((i) => (
        <group key={i} position={[-4 + i * 2.6, 0, 10]}>
          {[0, 1, 2, 3, 4].map((k) => (
            <mesh key={k} position={[0, 0.2 + k * 0.38, 0]} rotation={[Math.PI / 2, 0, 0]} material={a.rubberBlack} castShadow>
              <torusGeometry args={[0.8, 0.28, 8, 18]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** Schuhfabrik: three-storey brick factory with window rows, sign, chimney and loading van. */
export function ShoeFactory({ level = 1 }: { level?: number }) {
  const a = useAssets();
  // Grows upwards: 3, 5, 7 window rows on the same plot.
  const rows = [3, 3, 5, 7][level] ?? 3;
  const hall = 12 + (rows - 3) * 3.5;
  return (
    <group>
      <Box m={a.yard} w={32} d={22} y1={0.05} />
      <Box m={a.brick} w={24} d={12} y1={hall} x={-3} z={1} />
      <Roof m={a.slate} g={a.brick} w={24} d={12} y={hall} h={3.5} x={-3} z={1} />
      {Array.from({ length: rows }, (_, i) => 2 + i * 3.5).map((y) =>
        [-12, -8, -4, 0, 4, 8].map((x) => <Box key={`${x}${y}`} m={a.glass} w={2.2} d={0.15} y0={y} y1={y + 2} x={x - 1} z={-5.05} />),
      )}
      <mesh geometry={a.box} material={a.signShoeFactory} position={[-3, hall - 0.5, -5.1]} scale={[10, 1.4, 0.15]} />
      <Box m={a.wood} w={3} d={0.2} y1={1.8} x={-3} z={-5.1} />
      <Box m={a.brick} w={1.4} d={1.4} y1={18} x={12} z={5} />
      <Box m={a.concrete} w={6} d={5} y1={4} x={12} z={-3} />
      <Van x={12} z={-8} rot={Math.PI} />
    </group>
  );
}

/** Schuhgeschäft: small shop with brown awning and sign. */
export function ShoeShop() {
  const a = useAssets();
  return (
    <group>
      <Box m={a.shop} w={13} d={12} y1={6} />
      <Roof w={13} d={12} y={6} h={4} />
      <mesh geometry={a.box} material={a.awningBrown} position={[-1.5, 3.2, -6.9]} scale={[9, 0.12, 1.8]} rotation={[0.3, 0, 0]} castShadow />
      <mesh geometry={a.box} material={a.signShoes} position={[0, 4.4, -6.15]} scale={[6, 1.3, 0.2]} />
    </group>
  );
}

/* ---------- textile chain: sheep farm, spinning mill, clothing factory, fashion shop ---------- */

/** Sheep per farm level (the pasture grows with the plot). */
const SHEEP_COUNT = [0, 10, 16, 24, 34];

/**
 * Schaffarm: farmhouse and long sheep barn at the road, fenced pasture behind with the
 * herd. Level 2 adds a shearing shed with wool bales, 3 a feed silo, hay racks and an open
 * shelter on the pasture, 4 (Wollgut) a wool store with loading ramp and van.
 */
export function SheepFarm({ b, grid, y }: { b: Building; grid: DepthGrid; y: number }) {
  const a = useAssets();
  const [w, d] = sizeOf(b);
  const front = -d / 2;
  const lv = b.level;
  const height = useMemo(() => localHeight(b, grid, y), [b, grid, y]);
  const pasture = useMemo<Area>(() => ({ x0: -w / 2 + 2, x1: w / 2 - 2, z0: front + 17, z1: d / 2 - 2 }), [w, d, front]);
  const herdArea = useMemo(() => inset(pasture, 1.5), [pasture]);
  const ground = useMemo(() => (x: number, z: number) => height(x, z) + 0.08, [height]);
  const barnX = w / 2 - 10;
  return (
    <>
      <group position={[b.x, y, b.z]} rotation={[0, b.rot, 0]} userData={GROUNDED}>
        <Box m={a.gravel} w={w - 2} d={14} y1={0.04} z={front + 8} />
        {/* Farmhouse and the long sheep barn. */}
        <Box m={a.plaster} w={10} d={8} y1={6} x={-w / 2 + 7} z={front + 6} />
        <Roof w={10} d={8} y={6} h={3.6} x={-w / 2 + 7} z={front + 6} />
        <Box m={a.wood} w={16} d={9} y1={5} x={barnX} z={front + 7.5} />
        <Roof m={a.slate} g={a.wood} w={16} d={9} y={5} h={3.4} x={barnX} z={front + 7.5} />
        <Box m={a.straw} w={3} d={0.2} y1={2.6} x={barnX} z={front + 2.9} />
        {lv >= 2 && (
          <>
            {/* Shearing shed with wool bales. */}
            <Box m={a.hall} w={9} d={7} y1={4.5} x={-3} z={front + 6} />
            <Roof m={a.slate} g={a.hall} w={9} d={7} y={4.5} h={2} x={-3} z={front + 6} />
            {[0, 1, 2, 3].map((i) => (
              <Box key={i} m={a.woolBale} w={1.3} d={1.3} y1={1.1 + (i % 2) * 1.1} x={-6.5 + (i >> 1) * 1.5} z={front + 1.6} />
            ))}
          </>
        )}
        {lv >= 3 && (
          <>
            {/* Feed silo behind the barn and hay racks on the pasture. */}
            <mesh position={[barnX, 5, front + 14.2]} material={a.steel} castShadow>
              <cylinderGeometry args={[1.8, 1.8, 10, 18]} />
            </mesh>
            <mesh position={[barnX, 10.6, front + 14.2]} material={a.steel} castShadow>
              <coneGeometry args={[2, 1.4, 18]} />
            </mesh>
            {[-0.3, 0.3].map((f) => (
              <group key={f} position={[w * f, height(w * f, (pasture.z0 + pasture.z1) / 2), (pasture.z0 + pasture.z1) / 2]}>
                <Box m={a.log} w={3} d={1.4} y1={1.2} />
                <Box m={a.straw} w={2.6} d={1.1} y0={1.2} y1={1.7} />
              </group>
            ))}
          </>
        )}
        {lv >= 3 && (
          <group position={[pasture.x1 - 6, height(pasture.x1 - 6, pasture.z1 - 4), pasture.z1 - 4]}>
            {/* Open shelter on posts at the back of the pasture. */}
            {[
              [-3.5, -2],
              [3.5, -2],
              [-3.5, 2],
              [3.5, 2],
            ].map(([x, z]) => (
              <Box key={`${x}${z}`} m={a.log} w={0.3} d={0.3} y1={2.6} x={x} z={z} />
            ))}
            <Box m={a.wood} w={7.6} d={0.2} y1={2.2} z={2.1} />
            <Roof m={a.slate} g={a.wood} w={8} d={4.6} y={2.6} h={1.1} />
          </group>
        )}
        {lv >= 4 && (
          <>
            {/* Wool store with loading ramp. */}
            <Box m={a.hall} w={9} d={9} y1={6} x={7.5} z={front + 7} />
            <Box m={a.concrete} w={9.4} d={9.4} y0={6} y1={6.4} x={7.5} z={front + 7} />
            <Box m={a.concrete} w={7} d={1.6} y1={1} x={7.5} z={front + 1.8} />
            <Van x={-12} z={front + 2} rot={Math.PI / 2} />
          </>
        )}
        {/* Water trough. */}
        <group position={[-w / 2 + 8, height(-w / 2 + 8, pasture.z0 + 3), pasture.z0 + 3]}>
          <Box m={a.steel} w={3.2} d={0.9} y1={0.7} />
          <Box m={a.water} w={2.9} d={0.6} y0={0.6} y1={0.66} />
        </group>
        <Fence area={pasture} height={ground} kind="pasture" />
        <Herd kind="sheep" count={SHEEP_COUNT[lv] ?? 10} area={herdArea} seed={31 + lv} height={ground} />
      </group>
      <Field b={b} grid={grid} x={0} z={(pasture.z0 + pasture.z1) / 2} w={pasture.x1 - pasture.x0} d={pasture.z1 - pasture.z0} m={a.pasture} />
    </>
  );
}

/** Spinnerei: brick mill with window rows, stair tower and chimney; levels add halls behind. */
export function Spinning({ level = 1 }: { level?: number }) {
  const a = useAssets();
  const [, d] = sizeOf({ kind: "spinning", level });
  const shift = -(d - 24) / 2;
  return (
    <group>
      <group position={[0, 0, shift]}>
        <Box m={a.yard} w={30} d={24} y1={0.05} />
        <Box m={a.brick} w={22} d={11} y1={13} x={-3} z={-2} />
        <Roof m={a.slate} g={a.brick} w={22} d={11} y={13} h={3.2} x={-3} z={-2} />
        {[2, 6, 10].map((y) =>
          [-12, -8, -4, 0, 4].map((x) => <Box key={`${x}${y}`} m={a.glass} w={2} d={0.15} y0={y} y1={y + 2.2} x={x + 1} z={-7.55} />),
        )}
        <mesh geometry={a.box} material={a.signSpinning} position={[-3, 0.6, -7.7]} scale={[8, 1.3, 0.15]} />
        {/* Stair tower with a pyramid roof. */}
        <Box m={a.brick} w={4.5} d={4.5} y1={17} x={10} z={-4} />
        <mesh position={[10, 18.4, -4]} rotation={[0, Math.PI / 4, 0]} material={a.slate} castShadow>
          <coneGeometry args={[3.4, 2.8, 4]} />
        </mesh>
        <mesh position={[11, 11, 7]} material={a.brick} castShadow>
          <cylinderGeometry args={[0.7, 1.1, 22, 12]} />
        </mesh>
        {/* Wool bales and yarn cones in the yard. */}
        {[0, 1, 2, 3, 4].map((i) => (
          <Box key={i} m={a.woolBale} w={1.4} d={1.4} y1={1.2 + (i % 2) * 1.2} x={-13 + (i >> 1) * 1.6} z={8} />
        ))}
        {[0, 1, 2].map((i) => (
          <mesh key={`y${i}`} position={[-3 + i * 1.6, 0.6, 8]} material={a.yarnPink} castShadow>
            <cylinderGeometry args={[0.5, 0.7, 1.2, 12]} />
          </mesh>
        ))}
      </group>
      {level >= 2 && (
        <>
          {/* Weaving shed with saw-tooth roof at the back of the plot (it only grows backwards). */}
          <Box m={a.brick} w={20} d={10} y1={7} x={-4} z={d / 2 - 6} />
          {[-11, -4, 3].map((x) => (
            <group key={x} position={[x, 7, d / 2 - 6]} rotation={[0, Math.PI / 2, 0]}>
              <Roof m={a.slate} g={a.brick} w={10} d={7} y={0} h={2.2} overhang={0} />
            </group>
          ))}
        </>
      )}
      {level >= 3 && (
        <>
          {/* Modern spinning hall and yarn store between the old mill and the shed. */}
          <Box m={a.hall} w={8} d={16} y1={10} x={11} z={d / 2 - 9} />
          <Box m={a.concrete} w={8.4} d={16.4} y0={10} y1={10.5} x={11} z={d / 2 - 9} />
          <Box m={a.concrete} w={7} d={4.5} y1={5} x={-9} z={d / 2 - 13.5} />
          <Box m={a.hall} w={7.3} d={4.8} y0={5} y1={5.4} x={-9} z={d / 2 - 13.5} />
          <Van x={13.5} z={-d / 2 + 3} rot={Math.PI} />
        </>
      )}
    </group>
  );
}

/** Kleidungsfabrik: flat-roofed factory with glass band, fabric rolls; levels add halls behind. */
export function ClothingFactory({ level = 1 }: { level?: number }) {
  const a = useAssets();
  const [, d] = sizeOf({ kind: "clothing", level });
  const shift = -(d - 24) / 2;
  return (
    <group>
      <group position={[0, 0, shift]}>
        <Box m={a.yard} w={34} d={24} y1={0.05} />
        <Box m={a.concrete} w={24} d={13} y1={9} x={-4} z={-1} />
        <Box m={a.glass} w={23} d={0.15} y0={4} y1={7} x={-4} z={-7.55} />
        <Box m={a.cladBlue} w={24.4} d={13.4} y0={9} y1={10} x={-4} z={-1} />
        <mesh geometry={a.box} material={a.signTextile} position={[-4, 9, -7.8]} scale={[8, 1.4, 0.15]} />
        <Box m={a.glass} w={3.4} d={0.15} y1={2.8} x={-4} z={-7.55} />
        {/* Office block at the road. */}
        <Box m={a.plaster} w={8} d={7} y1={7} x={12} z={-6} />
        <Box m={a.glass} w={6.5} d={0.15} y0={1.2} y1={6} x={12} z={-9.55} />
        {/* Fabric rolls and wrapped clothes in the yard. */}
        {[a.clothBlue, a.clothRed, a.yarnPink, a.clothBlue].map((m, i) => (
          <mesh key={i} position={[-14 + i * 1.6, 0.7, 9]} rotation={[Math.PI / 2, 0, 0]} material={m} castShadow>
            <cylinderGeometry args={[0.65, 0.65, 3, 14]} />
          </mesh>
        ))}
        {[0, 1, 2].map((i) => (
          <Box key={`p${i}`} m={a.sack} w={2} d={2} y1={1.8} x={4 + i * 2.6} z={9} />
        ))}
        <Van x={12} z={4} rot={Math.PI / 2} />
      </group>
      {level >= 2 && (
        <>
          {/* Sewing hall with saw-tooth roof at the back of the plot (it only grows backwards). */}
          <Box m={a.concrete} w={22} d={11} y1={7} x={-5} z={d / 2 - 6} />
          {[-13, -5, 3].map((x) => (
            <group key={x} position={[x, 7, d / 2 - 6]} rotation={[0, Math.PI / 2, 0]}>
              <Roof m={a.steel} g={a.concrete} w={11} d={8} y={0} h={2.2} overhang={0} />
            </group>
          ))}
        </>
      )}
      {level >= 3 && (
        <>
          {/* High-bay warehouse beside the sewing hall, vans waiting in between. */}
          <Box m={a.cladBlue} w={9} d={14} y1={14} x={12} z={d / 2 - 8} />
          <Box m={a.concrete} w={9.4} d={14.4} y0={14} y1={14.5} x={12} z={d / 2 - 8} />
          <Van x={-2} z={d / 2 - 15} rot={Math.PI / 2} />
          <Van x={4} z={d / 2 - 15} rot={Math.PI / 2} />
        </>
      )}
    </group>
  );
}

/** Modegeschäft: boutique with shop windows, blue awning and sign. */
export function FashionShop() {
  const a = useAssets();
  return (
    <group>
      <Box m={a.shop} w={14} d={12} y1={7} />
      <Box m={a.concrete} w={14.4} d={12.4} y0={7} y1={7.6} />
      {[-4.2, 4.2].map((x) => (
        <Box key={x} m={a.glass} w={4.4} d={0.15} y0={0.4} y1={3} x={x} z={-6.05} />
      ))}
      <Box m={a.glass} w={2.2} d={0.15} y1={2.8} z={-6.05} />
      <mesh geometry={a.box} material={a.awningBlue} position={[0, 3.3, -6.9]} scale={[13, 0.12, 1.8]} rotation={[0.3, 0, 0]} castShadow />
      <mesh geometry={a.box} material={a.signFashion} position={[0, 5, -6.15]} scale={[6, 1.5, 0.2]} />
    </group>
  );
}

/* ---------- food chain: hen house, import-export company, food factory, discounter ---------- */

/** Fenced chicken run behind the hen houses (local area). */
const HEN_RUN: Area = { x0: -1, x1: 13, z0: -3, z1: 15 };

/** Places small static hens (body + head) in an area, deterministic. */
function placeHens(bodies: THREE.InstancedMesh | null, heads: THREE.InstancedMesh | null, area: Area, count: number, seed: number) {
  if (!bodies || !heads) return;
  let r = seed;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    const x = area.x0 + 0.6 + rnd() * (area.x1 - area.x0 - 1.2);
    const z = area.z0 + 0.6 + rnd() * (area.z1 - area.z0 - 1.2);
    const rot = rnd() * Math.PI * 2;
    q.setFromAxisAngle(up, rot);
    bodies.setMatrixAt(i, m.compose(new THREE.Vector3(x, 0.28, z), q, new THREE.Vector3(0.32, 0.26, 0.42)));
    const hx = x + Math.sin(rot) * 0.32;
    const hz = z + Math.cos(rot) * 0.32;
    heads.setMatrixAt(i, m.compose(new THREE.Vector3(hx, 0.5, hz), q, new THREE.Vector3(0.14, 0.15, 0.14)));
  }
  bodies.count = count;
  heads.count = count;
  bodies.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
}

function Hens({ area, count, seed, brown = false }: { area: Area; count: number; seed: number; brown?: boolean }) {
  const a = useAssets();
  const bodies = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const sphere = useMemo(() => new THREE.SphereGeometry(1, 10, 8), []);
  useLayoutEffect(() => placeHens(bodies.current, heads.current, area, count, seed), [area, count, seed]);
  useEffect(() => () => sphere.dispose(), [sphere]);
  return (
    <>
      <instancedMesh ref={bodies} args={[sphere, brown ? a.henBrown : a.hen, count]} castShadow frustumCulled={false} />
      <instancedMesh ref={heads} args={[sphere, a.comb, count]} frustumCulled={false} />
    </>
  );
}

/** Hühnerhof: farmhouse with egg shop sign, two long hen houses, fenced run with hens, egg van. */
export function ChickenFarm() {
  const a = useAssets();
  return (
    <group>
      <Box m={a.gravel} w={28} d={9} y1={0.04} z={-12} />
      {/* Farmhouse at the road. */}
      <Box m={a.plaster} w={9} d={7.5} y1={5.5} x={-9} z={-11} />
      <Roof w={9} d={7.5} y={5.5} h={3.4} x={-9} z={-11} />
      <mesh geometry={a.box} material={a.signEggs} position={[-9, 2.9, -14.85]} scale={[5, 1, 0.15]} />
      {/* Two long hen houses with a ventilation ridge. */}
      {[-9.5, -3].map((x) => (
        <group key={x}>
          <Box m={a.plank} w={5} d={22} y1={3} x={x} z={4} />
          <group position={[x, 3, 4]} rotation={[0, Math.PI / 2, 0]}>
            <Roof m={a.slate} g={a.plank} w={22} d={5} y={0} h={1.6} overhang={0.4} />
          </group>
          <Box m={a.glass} w={0.12} d={18} y0={1.6} y1={2.3} x={x + 2.56} z={4} />
        </group>
      ))}
      {/* Run with hens. */}
      <Box m={a.run} w={14} d={18} y1={0.05} x={6} z={6} />
      <Box m={a.fence} w={14} d={0.1} y1={1.4} x={6} z={-3} />
      <Box m={a.fence} w={14} d={0.1} y1={1.4} x={6} z={15} />
      <Box m={a.fence} w={0.1} d={18} y1={1.4} x={13} z={6} />
      <Hens area={HEN_RUN} count={34} seed={7} />
      <Hens area={HEN_RUN} count={12} seed={19} brown />
      <Box m={a.straw} w={1.6} d={1.6} y1={1} x={11} z={0} />
      <Van x={5} z={-11} rot={Math.PI / 2} />
      <Pallets x={-2} z={-13.5} n={3} />
    </group>
  );
}

/**
 * Import-Export-Kontor by level: office house with sign and a store hall; the store and the
 * container yard grow with every level (2 Handelshaus, 3 Handelszentrum).
 */
export function Trader({ level = 1 }: { level?: number }) {
  const a = useAssets();
  const [w, d] = sizeOf({ kind: "trader", level });
  const front = -d / 2;
  return (
    <group>
      <Box m={a.yard} w={w} d={d} y1={0.05} />
      {/* Office at the road: three storeys, glass bands, sign. */}
      <Box m={a.plaster} w={10} d={8} y1={10} x={-w / 2 + 6} z={front + 5} />
      {[1.2, 4.4, 7.6].map((y) => (
        <Box key={y} m={a.officeGlass} w={9} d={0.12} y0={y} y1={y + 2} x={-w / 2 + 6} z={front + 0.95} />
      ))}
      <Box m={a.concrete} w={10.4} d={8.4} y0={10} y1={10.5} x={-w / 2 + 6} z={front + 5} />
      <mesh geometry={a.box} material={a.signTrader} position={[-w / 2 + 6, 10.9, front + 1.2]} scale={[8.5, 1.4, 0.2]} />
      <mesh position={[-w / 2 + 11.6, 6, front + 1.5]} material={a.steel}>
        <cylinderGeometry args={[0.08, 0.08, 12, 6]} />
      </mesh>
      <mesh position={[-w / 2 + 12.3, 11.2, front + 1.5]} material={a.flagBlue}>
        <boxGeometry args={[1.4, 0.9, 0.04]} />
      </mesh>
      {/* Store hall: bigger at every level. */}
      <StoreHall x={w / 2 - (level >= 3 ? 14 : level >= 2 ? 10 : 8)} z={front + (level >= 3 ? 14 : level >= 2 ? 11 : 9)} w={level >= 3 ? 26 : level >= 2 ? 18 : 14} d={level >= 3 ? 18 : level >= 2 ? 14 : 11} h={level >= 3 ? 11 : 8} doors={level >= 3 ? 4 : level >= 2 ? 3 : 2} />
      {/* Container yard and sacks of cocoa and coffee. */}
      <Containers x={-w / 2 + 6} z={front + 12} rows={level >= 2 ? 3 : 2} layers={level >= 3 ? 3 : 2} />
      {level >= 3 && <Containers x={-w / 2 + 14} z={front + 22} rows={4} layers={2} />}
      {[0, 1, 2, 3].map((i) => (
        <Box key={i} m={i % 2 ? a.cocoaSack : a.sack} w={1.3} d={0.9} y1={0.7} x={-w / 2 + 12 + (i % 2) * 1.4} z={front + 9 + (i >> 1) * 1} />
      ))}
      <Van x={w / 2 - 4} z={front + 2.5} rot={Math.PI / 2} />
      {level >= 2 && <Van x={w / 2 - 9} z={front + 2.5} rot={Math.PI / 2} />}
    </group>
  );
}

/** Lebensmittelfabrik: production hall with red band and sign, milk and flour silos; levels add halls behind. */
export function FoodFactory({ level = 1 }: { level?: number }) {
  const a = useAssets();
  const [, d] = sizeOf({ kind: "foodfactory", level });
  const shift = -(d - 26) / 2;
  return (
    <group>
      <group position={[0, 0, shift]}>
        <Box m={a.yard} w={36} d={26} y1={0.05} />
        <Box m={a.concrete} w={24} d={14} y1={10} x={-5} z={-2} />
        <Box m={a.paintRed} w={24.3} d={14.3} y0={8.4} y1={9.4} x={-5} z={-2} />
        <Box m={a.glass} w={22} d={0.15} y0={3.5} y1={6.5} x={-5} z={-9.05} />
        <mesh geometry={a.box} material={a.signFood} position={[-5, 10.7, -9.1]} scale={[10, 1.5, 0.2]} />
        <Box m={a.glass} w={3.6} d={0.15} y1={3} x={-12} z={-9.05} />
        {/* Stainless silos for milk, flour and cocoa. */}
        {[0, 1, 2].map((i) => (
          <group key={i} position={[11 + (i % 2) * 4.2, 0, -6 + i * 4.4]}>
            <mesh position={[0, 6.5, 0]} material={a.stainless} castShadow receiveShadow>
              <cylinderGeometry args={[1.8, 1.8, 11, 18]} />
            </mesh>
            <mesh position={[0, 12.6, 0]} material={a.stainless} castShadow>
              <coneGeometry args={[1.8, 1.4, 18]} />
            </mesh>
          </group>
        ))}
        <mesh position={[-15, 9, 4]} material={a.brick} castShadow>
          <cylinderGeometry args={[0.6, 0.9, 18, 12]} />
        </mesh>
        <Pallets x={-14} z={7} n={6} />
        <Van x={4} z={9} rot={Math.PI / 2} />
      </group>
      {level >= 2 && (
        <>
          {/* Packing hall behind the factory. */}
          <Box m={a.hall} w={24} d={10} y1={8} x={-5} z={d / 2 - 6.5} />
          <Box m={a.concrete} w={24.4} d={10.4} y0={8} y1={8.5} x={-5} z={d / 2 - 6.5} />
        </>
      )}
      {level >= 3 && (
        <>
          {/* High-bay store with truck docks. */}
          <Box m={a.cladBlue} w={14} d={16} y1={15} x={18} z={d / 2 - 10} />
          <Box m={a.concrete} w={14.4} d={16.4} y0={15} y1={15.5} x={18} z={d / 2 - 10} />
          <Van x={14} z={d / 2 - 20} rot={Math.PI} />
          <Van x={20} z={d / 2 - 20} rot={Math.PI} />
        </>
      )}
    </group>
  );
}

/** Discounter: flat store at the back with glass front and sign, car park at the road. */
export function Discounter() {
  const a = useAssets();
  return (
    <group>
      <Box m={a.asphalt} w={30} d={14} y1={0.04} z={-7} />
      {Array.from({ length: 9 }, (_, i) => (
        <Box key={i} m={a.parkLine} w={0.15} d={5} y1={0.06} x={-12 + i * 3} z={-4} />
      ))}
      <Box m={a.hall} w={26} d={14} y1={6} z={7} />
      <Box m={a.paintWhite} w={26.4} d={14.4} y0={6} y1={6.6} z={7} />
      <RoofSolar x={0} y={6.6} z={7.5} cols={4} rows={3} />
      <Box m={a.glass} w={12} d={0.15} y0={0.3} y1={4.2} x={-5} z={-0.05} />
      <Box m={a.paintRed} w={26.2} d={0.3} y0={4.4} y1={6} z={-0.1} />
      <mesh geometry={a.box} material={a.signDiscount} position={[6, 5.2, -0.35]} scale={[8, 1.4, 0.2]} />
      {/* Sign pylon at the road. */}
      <Box m={a.steel} w={0.4} d={0.4} y1={7} x={13} z={-12.5} />
      <mesh geometry={a.box} material={a.signDiscount} position={[13, 7.5, -12.5]} scale={[3.6, 2, 0.4]} castShadow />
      {/* Trolley shelter. */}
      <Box m={a.steel} w={4} d={2} y0={2.2} y1={2.4} x={10} z={-1.5} />
      {[8.2, 11.8].map((x) => (
        <Box key={x} m={a.steel} w={0.12} d={0.12} y1={2.2} x={x} z={-1.5} />
      ))}
      <Van x={-8} z={-9} />
      <Van x={1} z={-9} />
    </group>
  );
}

/**
 * Slaughterhouse: tiled hall, cold store, livestock pen and chimney. Großschlachthof adds a
 * cutting hall and a cold store with refrigerated vans behind; Fleischwerk a big processing
 * plant with its own chimney. The original buildings stay at the road (`shift`).
 */
export function Slaughterhouse({ level = 1 }: { level?: number }) {
  const a = useAssets();
  const [, d] = sizeOf({ kind: "slaughterhouse", level });
  // The original buildings stay at the road; the plot grows to the back.
  const shift = -(d - 24) / 2;
  const back = d / 2;
  return (
    <group>
      <group position={[0, 0, shift]}>
        <SlaughterhouseBase />
      </group>
      {level === 2 && (
        <>
          {/* Cutting hall and cold store behind, refrigerated van at the dock. */}
          <Box m={a.tiles} w={18} d={6} y1={6} x={-6} z={back - 4} />
          <Box m={a.concrete} w={18.4} d={6.4} y0={6} y1={6.5} x={-6} z={back - 4} />
          <Box m={a.hall} w={9} d={7} y1={7} x={10} z={back - 4.5} />
          <Box m={a.concrete} w={9.4} d={7.4} y0={7} y1={7.5} x={10} z={back - 4.5} />
          <Van x={13.5} z={back - 10} rot={Math.PI / 2} />
        </>
      )}
      {level >= 3 && (
        <>
          {/* Processing plant (sausage and packing lines) with exhaust stacks, cutting hall, cold store. */}
          <Box m={a.cladBlue} w={16} d={13} y1={11} x={7} z={back - 8.5} />
          <Box m={a.concrete} w={16.4} d={13.4} y0={11} y1={11.5} x={7} z={back - 8.5} />
          {[3, 11].map((x) => (
            <Box key={x} m={a.steel} w={0.9} d={0.9} y0={11.5} y1={15} x={x} z={back - 6} />
          ))}
          <Box m={a.tiles} w={14} d={9} y1={7} x={-8} z={back - 6} />
          <Box m={a.concrete} w={14.4} d={9.4} y0={7} y1={7.5} x={-8} z={back - 6} />
          <Box m={a.brick} w={1.4} d={1.4} y1={18} x={-13} z={back - 0.8} />
          <Van x={13.5} z={back - 18} rot={Math.PI / 2} />
        </>
      )}
    </group>
  );
}

function SlaughterhouseBase() {
  const a = useAssets();
  return (
    <group>
      <Box m={a.tiles} w={20} d={14} y1={8} x={-4} z={-3} />
      <Roof m={a.slate} g={a.tiles} w={20} d={14} y={8} h={3} x={-4} z={-3} />
      {/* Cold store. */}
      <Box m={a.hall} w={9} d={10} y1={6} x={11} z={-5} />
      <Box m={a.concrete} w={9.4} d={10.4} y0={6} y1={6.4} x={11} z={-5} />
      {/* Livestock pen behind the hall. */}
      <Box m={a.yard} w={18} d={7} y1={0.05} x={-4} z={8} />
      {[-13, 5].map((x) => (
        <Box key={x} m={a.fence} w={0.15} d={7} y1={1.1} x={x} z={8} />
      ))}
      <Box m={a.fence} w={18} d={0.15} y1={1.1} x={-4} z={11.5} />
      <Herd kind="pig" count={4} area={PEN_AREA} seed={41} height={penHeight} />
      <Herd kind="cow" count={2} area={PEN_AREA} seed={43} height={penHeight} coat={BEEF_COAT} />
      <Box m={a.brick} w={1.2} d={1.2} y1={14} x={-12} z={-8} />
    </group>
  );
}

/** Butcher's shop: small shop with red-white awning and sign. */
export function Butcher({ level = 1 }: { level?: number }) {
  const a = useAssets();
  const [, d] = sizeOf({ kind: "butcher", level });
  // The shop stays at the road; the plot grows to the back.
  const shift = -(d - 12) / 2;
  const back = d / 2;
  return (
    <group>
      <group position={[0, 0, shift]}>
        <ButcherBase />
      </group>
      {level === 2 && (
        <>
          {/* Sausage kitchen with flat roof and vent behind the shop. */}
          <Box m={a.plaster} w={10} d={6} y1={4.5} x={-1.5} z={back - 4} />
          <Box m={a.concrete} w={10.4} d={6.4} y0={4.5} y1={4.9} x={-1.5} z={back - 4} />
          <Box m={a.steel} w={0.6} d={0.6} y0={4.9} y1={6.5} x={-4} z={back - 4} />
          <Van x={5} z={back - 3.5} />
        </>
      )}
      {level >= 3 && (
        <>
          {/* Production hall (sausage and smoking lines), cold store and delivery vans. */}
          <Box m={a.tiles} w={10} d={9} y1={6.5} x={-1.5} z={back - 6} />
          <Box m={a.concrete} w={10.4} d={9.4} y0={6.5} y1={7} x={-1.5} z={back - 6} />
          {[-4, 2].map((x) => (
            <Box key={x} m={a.steel} w={0.7} d={0.7} y0={7} y1={9.5} x={x} z={back - 4} />
          ))}
          <Box m={a.hall} w={6} d={5} y1={5} x={-3} z={back - 13} />
          <Box m={a.concrete} w={6.3} d={5.3} y0={5} y1={5.4} x={-3} z={back - 13} />
          <Van x={5.2} z={back - 13} />
          <Van x={5.2} z={back - 5} />
        </>
      )}
    </group>
  );
}

function ButcherBase() {
  const a = useAssets();
  return (
    <group>
      <Box m={a.tiles} w={13} d={12} y1={6} />
      <Box m={a.glass} w={8} d={0.2} y0={0.6} y1={3.2} x={-1.5} z={-6.05} />
      <Roof w={13} d={12} y={6} h={4} />
      <mesh geometry={a.box} material={a.awning} position={[-1.5, 3.2, -6.9]} scale={[9, 0.12, 1.8]} rotation={[0.3, 0, 0]} castShadow />
      <mesh geometry={a.box} material={a.signButcher} position={[0, 4.4, -6.15]} scale={[6, 1.3, 0.2]} />
      {/* Smokehouse at the back. */}
      <Box m={a.brick} w={3} d={3} y1={4} x={4} z={4} />
      <Box m={a.brick} w={0.8} d={0.8} y1={8} x={4} z={4} />
    </group>
  );
}

/** Restaurant: inn with green awning, sign and a beer garden with parasols. */
export function Restaurant() {
  const a = useAssets();
  return (
    <group>
      <Box m={a.plaster} w={12} d={10} y1={6} x={-1} z={-1} />
      <Box m={a.glass} w={8} d={0.2} y0={0.8} y1={3.4} x={-2} z={-6.05} />
      <Roof w={12} d={10} y={6} h={3.6} x={-1} z={-1} />
      <mesh geometry={a.box} material={a.awningGreen} position={[-2, 3.4, -6.9]} scale={[9, 0.12, 1.8]} rotation={[0.3, 0, 0]} castShadow />
      <mesh geometry={a.box} material={a.signRestaurant} position={[-1, 4.5, -6.15]} scale={[6, 1.2, 0.2]} />
      <Box m={a.brick} w={0.9} d={0.9} y1={9.5} x={3} z={2} />
      {/* Beer garden beside the house. */}
      <Box m={a.yard} w={4} d={10} y1={0.05} x={6} z={-1} />
      {[-4, 0, 3].map((z) => (
        <group key={z} position={[6, 0, z]}>
          <Box m={a.plank} w={1.6} d={0.9} y0={0.7} y1={0.78} />
          <Box m={a.steel} w={0.08} d={0.08} y1={2.3} />
          <mesh position={[0, 2.3, 0]} material={a.parasol} castShadow>
            <coneGeometry args={[1.3, 0.6, 12]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Bank: classical temple front – steps, four columns, pediment, gilded sign. */
/** Town wealth thresholds (€) for the bank's office tower: 0 = none, then 6 / 12 / 20 floors. */
const BANK_FLOORS = [0, 6, 12, 20];
/** Residents for the town hall to add floors (1, 2) and a glass administration tower (2). */

export function Bank() {
  const a = useAssets();
  // Only the wealth tier re-renders the bank, not every change of the balance.
  const tier = useCity((s) => BANK_WEALTH.filter((w) => s.money >= w).length);
  const floors = BANK_FLOORS[tier];
  return (
    <group>
      {floors > 0 && (
        <group position={[0, 0, 4.2]}>
          {/* Office tower rising behind the portico: stone frame, glass bands, gilded crown. */}
          {Array.from({ length: floors }, (_, f) => (
            <group key={f}>
              <Box m={a.sandstone} w={13} d={5.2} y0={9 + f * 3.6} y1={10 + f * 3.6} />
              <Box m={a.officeGlass} w={12.6} d={4.9} y0={10 + f * 3.6} y1={12.6 + f * 3.6} />
            </group>
          ))}
          <Box m={a.sandstone} w={13.4} d={5.6} y0={9 + floors * 3.6} y1={10 + floors * 3.6} />
          <Box m={a.gold} w={6} d={2.4} y0={10 + floors * 3.6} y1={11.2 + floors * 3.6} />
          <mesh geometry={a.box} material={a.signBank} position={[0, 7.6 + floors * 3.6, -2.7]} scale={[6, 1.2, 0.15]} />
        </group>
      )}
      {/* Plinth and front steps. */}
      <Box m={a.stone} w={18} d={14} y1={1} z={0.5} />
      {[0, 1, 2].map((i) => (
        <Box key={i} m={a.stone} w={12 - i} d={1} y1={0.35 * (i + 1)} z={-7 + i * 0.5} />
      ))}
      {/* Hall behind the portico. */}
      <Box m={a.sandstone} w={16} d={11} y0={1} y1={9} z={1.5} />
      <Box m={a.glass} w={3} d={0.2} y0={1} y1={5} z={-4.05} />
      {/* Tall arched-looking windows on the sides and the back. */}
      {[-1.5, 2, 5.5].map((z) =>
        [-8.05, 8.05].map((x) => <Box key={`${x}${z}`} m={a.glass} w={0.15} d={1.6} y0={2.4} y1={7.4} x={x} z={z} />),
      )}
      {[-4.5, 0, 4.5].map((x) => (
        <Box key={x} m={a.glass} w={1.6} d={0.15} y0={2.4} y1={7.4} x={x} z={7.05} />
      ))}
      {/* Portico: columns with base and capital. */}
      {[-5.4, -1.8, 1.8, 5.4].map((x) => (
        <group key={x} position={[x, 1, -5.6]}>
          <Box m={a.sandstone} w={1.3} d={1.3} y1={0.4} />
          <mesh position={[0, 3.9, 0]} material={a.sandstone} castShadow>
            <cylinderGeometry args={[0.42, 0.5, 7, 16]} />
          </mesh>
          <Box m={a.sandstone} w={1.3} d={1.3} y0={7.4} y1={7.8} />
        </group>
      ))}
      {/* Entablature with the sign, pediment roof running front to back. */}
      <Box m={a.sandstone} w={16.6} d={12.8} y0={8.8} y1={10} z={0.6} />
      <mesh geometry={a.box} material={a.signBank} position={[0, 9.05, -5.85]} scale={[6, 0.8, 0.15]} />
      <group rotation={[0, Math.PI / 2, 0]} position={[0, 0, 0.6]}>
        <Roof m={a.slate} g={a.sandstone} w={12.8} d={16.6} y={10} h={2.6} overhang={0.3} />
      </group>
      <mesh position={[0, 12.9, -5.9]} material={a.gold} castShadow>
        <sphereGeometry args={[0.35, 12, 8]} />
      </mesh>
    </group>
  );
}

/** Draws the live price line onto the exchange's ticker board (outside the component: it mutates the texture). */
function drawTicker(texture: THREE.CanvasTexture, now: number, open: number) {
  const c = texture.image as HTMLCanvasElement;
  const g = c.getContext("2d")!;
  const up = now >= open;
  const change = Math.abs(now / open - 1) * 100;
  g.fillStyle = "#07090c";
  g.fillRect(0, 0, c.width, c.height);
  g.font = "bold 40px 'Courier New', monospace";
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.fillStyle = "#ffc23a";
  g.fillText("GOLD", 18, c.height / 2);
  g.fillStyle = "#f4f1ea";
  g.fillText(`${now.toLocaleString("de-DE")} €`, 160, c.height / 2);
  g.fillStyle = up ? "#3ddc6a" : "#ff4d4d";
  g.textAlign = "right";
  const label = `${change.toFixed(1).replace(".", ",")} %`;
  g.fillText(label, c.width - 18, c.height / 2);
  // Trend triangle drawn as a shape (a text symbol can come out as a coloured emoji).
  const tx = c.width - 18 - g.measureText(label).width - 26;
  const cy = c.height / 2;
  g.beginPath();
  if (up) {
    g.moveTo(tx, cy + 11);
    g.lineTo(tx + 11, cy - 11);
    g.lineTo(tx + 22, cy + 11);
  } else {
    g.moveTo(tx, cy - 11);
    g.lineTo(tx + 11, cy + 11);
    g.lineTo(tx + 22, cy - 11);
  }
  g.closePath();
  g.fill();
  texture.needsUpdate = true;
}

/**
 * Börse: classical exchange hall on a plinth with wide steps, six columns, a pediment and a
 * glass roof light. Above the entrance a black ticker board shows the live gold price.
 */
export function Exchange() {
  const a = useAssets();
  // Re-draw the board only when the price on it changes (every few game minutes).
  const minute = useCity((s) => Math.floor(s.gameMinutes / 5) * 5);
  const ticker = useMemo(() => canvasTexture(640, 64, () => {}), []);
  const tickerMat = useMemo(() => new THREE.MeshStandardMaterial({ map: ticker, emissiveMap: ticker, emissive: "#ffffff", emissiveIntensity: 0.9, roughness: 0.3 }), [ticker]);
  useEffect(() => {
    const day = goldDay(minute);
    drawTicker(ticker, day.now, day.open);
  }, [minute, ticker]);
  useEffect(
    () => () => {
      ticker.dispose();
      tickerMat.dispose();
    },
    [ticker, tickerMat],
  );
  return (
    <group>
      {/* Plinth and wide front steps. */}
      <Box m={a.stone} w={28} d={20} y1={1.4} z={1} />
      {[0, 1, 2, 3].map((i) => (
        <Box key={i} m={a.stone} w={20 - i * 0.6} d={1} y1={0.35 * (i + 1)} z={-10.5 + i * 0.6} />
      ))}
      {/* Trading hall. */}
      <Box m={a.marble} w={26} d={15} y0={1.4} y1={12} z={3} />
      <Box m={a.marble} w={26.6} d={15.6} y0={12} y1={13} z={3} />
      {/* Glass roof light over the trading floor. */}
      <Box m={a.glass} w={14} d={9} y0={13} y1={14.6} z={4} />
      {/* Tall windows on the sides. */}
      {[-1, 3, 7].map((z) =>
        [-13.05, 13.05].map((x) => <Box key={`${x}${z}`} m={a.glass} w={0.15} d={1.8} y0={3.5} y1={10} x={x} z={z} />),
      )}
      {[-9, -4.5, 0, 4.5, 9].map((x) => (
        <Box key={x} m={a.glass} w={1.8} d={0.15} y0={3.5} y1={10} x={x} z={10.55} />
      ))}
      {/* Entrance doors. */}
      {[-4, 0, 4].map((x) => (
        <Box key={x} m={a.glass} w={2.4} d={0.2} y0={1.4} y1={5.6} x={x} z={-4.55} />
      ))}
      {/* Portico: six columns with base and capital. */}
      {[-10, -6, -2, 2, 6, 10].map((x) => (
        <group key={x} position={[x, 1.4, -8.4]}>
          <Box m={a.marble} w={1.5} d={1.5} y1={0.45} />
          <mesh position={[0, 4.75, 0]} material={a.marble} castShadow>
            <cylinderGeometry args={[0.5, 0.6, 8.6, 16]} />
          </mesh>
          <Box m={a.marble} w={1.5} d={1.5} y0={9.05} y1={9.5} />
        </group>
      ))}
      {/* Entablature with the ticker board on the frieze (above the columns, seen from the street). */}
      <Box m={a.marble} w={24} d={5} y0={10.9} y1={12.4} z={-7.4} />
      <mesh position={[0, 11.65, -9.95]} scale={[12.5, 1.25, 0.12]} material={tickerMat}>
        <boxGeometry />
      </mesh>
      {/* The name in the pediment. */}
      <mesh geometry={a.box} material={a.signExchange} position={[0, 13.5, -9.85]} scale={[6, 1.1, 0.12]} />
      <group rotation={[0, Math.PI / 2, 0]} position={[0, 0, -7.4]}>
        <Roof m={a.slate} g={a.marble} w={5} d={24} y={12.4} h={3.2} overhang={0.3} />
      </group>
      {/* Gilded globe on top of the pediment. */}
      <mesh position={[0, 16, -9.6]} material={a.gold} castShadow>
        <sphereGeometry args={[0.55, 16, 12]} />
      </mesh>
    </group>
  );
}

/** Town hall: two-storey hall with red roof, clock tower in front, flags and a forecourt. */
export function TownHall() {
  const a = useAssets();
  // The town hall grows with the town: more floors, a taller tower, later an administration tower.
  const tier = useCity((s) => TOWNHALL_RESIDENTS.filter((r) => (s.economy?.residents ?? 0) >= r).length);
  const hall = 9 + tier * 3.5;
  const wing = 7 + tier * 3.5;
  const tower = 22 + tier * 7;
  return (
    <group>
      {/* Forecourt. */}
      <Box m={a.yard} w={24} d={5} y1={0.06} z={-8.5} />
      {/* Main hall and side wings. */}
      <Box m={a.plaster} w={22} d={11} y1={hall} z={2} />
      <Roof w={22} d={11} y={hall} h={5} z={2} />
      {[-12.5, 12.5].map((x) => (
        <group key={x}>
          <Box m={a.plaster} w={3} d={9} y1={wing} x={x} z={2} />
          <Box m={a.slate} w={3.4} d={9.4} y0={wing} y1={wing + 0.4} x={x} z={2} />
        </group>
      ))}
      {tier >= 2 && (
        <group position={[0, 0, 5]}>
          {/* Glass administration tower behind the old hall. */}
          <Box m={a.officeGlass} w={10} d={5} y1={46} />
          {Array.from({ length: 12 }, (_, f) => (
            <Box key={f} m={a.concrete} w={10.2} d={5.2} y0={3.8 * f + 3.4} y1={3.8 * f + 3.8} />
          ))}
          <Box m={a.concrete} w={10.6} d={5.6} y0={46} y1={47} />
          <Box m={a.steel} w={0.2} d={0.2} y0={47} y1={53} x={3} />
        </group>
      )}
      {/* Clock tower over the entrance. */}
      <Box m={a.sandstone} w={6} d={6} y1={tower} z={-4.5} />
      <Box m={a.sandstone} w={6.6} d={6.6} y0={tower} y1={tower + 0.6} z={-4.5} />
      <mesh position={[0, tower + 3.6, -4.5]} rotation={[0, Math.PI / 4, 0]} material={a.copper} castShadow>
        <coneGeometry args={[4.6, 6, 4]} />
      </mesh>
      <mesh position={[0, tower + 7, -4.5]} material={a.gold}>
        <sphereGeometry args={[0.4, 12, 8]} />
      </mesh>
      {/* Clock: face with hands, on the front of the tower. */}
      <group position={[0, tower - 3.5, -7.55]}>
        <mesh material={a.clockFace} rotation={[0, Math.PI, 0]}>
          <circleGeometry args={[1.7, 32]} />
        </mesh>
        <mesh geometry={a.box} material={a.coal} position={[0, 0, -0.06]} scale={[0.14, 1.2, 0.05]} />
        <mesh geometry={a.box} material={a.coal} position={[0, 0, -0.06]} scale={[0.9, 0.14, 0.05]} />
      </group>
      {/* Entrance with the sign above it. */}
      <Box m={a.wood} w={2.6} d={0.2} y1={4} z={-7.55} />
      <mesh geometry={a.box} material={a.signTownhall} position={[0, 5.2, -7.6]} scale={[5, 1, 0.15]} />
      {/* Flagpoles on the forecourt. */}
      {[
        [-8, a.flagRed],
        [8, a.flagBlue],
      ].map(([x, m]) => (
        <group key={x as number} position={[x as number, 0, -9.5]}>
          <Box m={a.steel} w={0.15} d={0.15} y1={10} />
          <mesh geometry={a.box} material={m as THREE.Material} position={[1.1, 8.4, 0]} scale={[2.2, 1.4, 0.04]} castShadow />
        </group>
      ))}
    </group>
  );
}

/** Roll-off skip in a colour, open at the top, with a heap of material inside. */
function Skip({ x, z, m, fill, rot = 0 }: { x: number; z: number; m: THREE.Material; fill: THREE.Material; rot?: number }) {
  const a = useAssets();
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <Box m={m} w={2.4} d={5.2} y1={0.2} />
      {[-1, 1].map((side) => (
        <Box key={side} m={m} w={0.12} d={5.2} y0={0.2} y1={1.8} x={side * 1.14} />
      ))}
      {[-1, 1].map((side) => (
        <Box key={`e${side}`} m={m} w={2.4} d={0.12} y0={0.2} y1={1.8} z={side * 2.54} />
      ))}
      <mesh position={[0, 1.2, 0]} scale={[1, 0.5, 2.2]} material={fill} castShadow>
        <sphereGeometry args={[1.05, 10, 6]} />
      </mesh>
      <Box m={a.steel} w={0.6} d={0.3} y0={0.6} y1={1.8} z={-2.7} />
    </group>
  );
}

/**
 * Recyclinghof: fenced concrete yard with coloured skips, bunkers of sorted material, a
 * sorting hall and an office at the gate. Level 2 adds a baler with bales, level 3 a blue
 * sorting plant with a conveyor to the hall. The plot grows only to the back.
 */
/* ---------- gold: smelter and jeweller ---------- */

/** Stack of gold bars on a pallet (rows × columns, layers). */
function BarStack({ x, z, layers = 3 }: { x: number; z: number; layers?: number }) {
  const a = useAssets();
  return (
    <group position={[x, 0, z]}>
      <Box m={a.plank} w={1.4} d={1.2} y1={0.15} />
      {Array.from({ length: layers * 6 }, (_, i) => {
        const layer = Math.floor(i / 6);
        const k = i % 6;
        return <Box key={i} m={a.goldBar} w={0.38} d={0.18} y0={0.15 + layer * 0.1} y1={0.24 + layer * 0.1} x={-0.45 + (k % 3) * 0.45} z={-0.4 + Math.floor(k / 3) * 0.8} />;
      })}
    </group>
  );
}

/**
 * Goldschmelze: brick melt shop with a tall chimney and a glowing furnace mouth, ore bunker,
 * bars on pallets at the front. Level 2 (Scheideanstalt) adds a refining hall with a second
 * stack behind, level 3 (Goldraffinerie) a clad electrolysis hall and a guarded vault.
 */
export function GoldSmelter({ level = 1 }: { level?: number }) {
  const a = useAssets();
  const [, d] = sizeOf({ kind: "goldsmelter", level });
  const shift = -(d - 22) / 2;
  const back = d / 2;
  return (
    <group>
      <Box m={a.concrete} w={26} d={d} y1={0.06} />
      <group position={[0, 0, shift]}>
        {/* Melt shop. */}
        <Box m={a.brick} w={14} d={12} y1={8} x={-4} z={1} />
        <Box m={a.smelterRoof} w={14.6} d={12.6} y0={8} y1={8.5} x={-4} z={1} />
        <Box m={a.steel} w={4} d={0.15} y1={4.5} x={-7} z={-5.05} />
        {/* Furnace glow behind the open door. */}
        <Box m={a.melt} w={2.4} d={0.1} y0={0.6} y1={2.2} x={-7} z={-4.9} />
        <mesh position={[0, 9, 5]} material={a.brick} castShadow>
          <cylinderGeometry args={[0.8, 1.1, 18, 12]} />
        </mesh>
        <mesh geometry={a.box} material={a.signSmelter} position={[-1.5, 6.4, -5.1]} scale={[6.5, 1.2, 0.15]} />
        {/* Ore bunker and heap. */}
        {[-1, 1].map((side) => (
          <Box key={side} m={a.concrete} w={0.4} d={6} y1={2.4} x={8 + side * 3} z={3} />
        ))}
        <Box m={a.concrete} w={6.4} d={0.4} y1={2.4} x={8} z={5.8} />
        <mesh position={[8, 0.2, 3]} scale={[2.4, 1.6, 2.4]} material={a.goldOre} castShadow>
          <coneGeometry args={[1, 1.6, 8]} />
        </mesh>
        {/* Bars ready at the front, behind a fence. */}
        <BarStack x={4} z={-6.5} />
        <BarStack x={6} z={-6.5} layers={2} />
        <Box m={a.fence} w={8} d={0.08} y1={2} x={6} z={-8.5} />
      </group>
      {level >= 2 && (
        <>
          {/* Refining hall with a second, thinner stack. */}
          <Box m={a.hall} w={16} d={7} y1={6.5} x={-3} z={back - 4} />
          <Box m={a.concrete} w={16.4} d={7.4} y0={6.5} y1={6.9} x={-3} z={back - 4} />
          <mesh position={[8, 7, back - 3]} material={a.steel} castShadow>
            <cylinderGeometry args={[0.45, 0.6, 14, 10]} />
          </mesh>
        </>
      )}
      {level >= 3 && (
        <>
          {/* Electrolysis hall and the guarded vault. */}
          <Box m={a.cladBlue} w={12} d={7} y1={8} x={-6} z={back - 11.5} />
          <Box m={a.concrete} w={12.4} d={7.4} y0={8} y1={8.4} x={-6} z={back - 11.5} />
          <Box m={a.concrete} w={7} d={6} y1={4} x={7} z={back - 11} />
          <Box m={a.steel} w={2.4} d={0.2} y0={0.3} y1={3} x={7} z={back - 14.05} />
          <Box m={a.goldBar} w={7.2} d={0.1} y0={3.6} y1={3.9} x={7} z={back - 14.05} />
        </>
      )}
    </group>
  );
}

/**
 * Juwelier: town house with a dark shop front (gold lettering, lit display windows, canopy) and a
 * light upper floor. Level 2 adds a goldsmith's workshop behind, level 3 (Schmuckhaus) a third
 * storey with a gold-framed upper window band; the plot grows to the back like the butcher's.
 */
export function Jeweller({ level = 1 }: { level?: number }) {
  const a = useAssets();
  const [, d] = sizeOf({ kind: "jeweller", level });
  const shift = -(d - 12) / 2;
  const back = d / 2;
  const top = level >= 3 ? 11.5 : 8;
  return (
    <group>
      <group position={[0, 0, shift]}>
        {/* Shop floor: dark stone front, light plaster storeys above with a gold cornice. */}
        <Box m={a.darkFacade} w={12} d={12} y1={4.2} />
        <Box m={a.gold} w={12.2} d={12.2} y0={4.2} y1={4.45} />
        <Box m={a.plaster} w={12} d={12} y0={4.45} y1={top} />
        {level >= 3 && <Box m={a.gold} w={12.2} d={12.2} y0={8} y1={8.2} />}
        <Box m={a.concrete} w={12.5} d={12.5} y0={top} y1={top + 0.5} />
        {/* Display windows with gold frames and a glass door between them. */}
        {[-3.6, 3.6].map((x) => (
          <group key={x}>
            <Box m={a.gold} w={3.8} d={0.12} y0={0.5} y1={3.3} x={x} z={-6.02} />
            <Box m={a.glassLit} w={3.5} d={0.14} y0={0.65} y1={3.15} x={x} z={-6.06} />
          </group>
        ))}
        <Box m={a.glass} w={1.8} d={0.14} y1={2.9} z={-6.06} />
        <Box m={a.gold} w={2.1} d={0.1} y0={2.9} y1={3.1} z={-6.04} />
        <mesh geometry={a.box} material={a.awningDark} position={[0, 3.55, -6.7]} scale={[11.5, 0.1, 1.4]} rotation={[0.25, 0, 0]} castShadow />
        <mesh geometry={a.box} material={a.signJeweller} position={[0, level >= 3 ? 9.8 : 6.2, -6.1]} scale={[level >= 3 ? 8 : 6.5, level >= 3 ? 1.7 : 1.4, 0.15]} />
      </group>
      {level >= 2 && (
        <>
          {/* Goldsmith's workshop behind: low brick wing with a skylight and a small chimney. */}
          <Box m={a.brick} w={10} d={6} y1={4} z={back - 3} />
          <Box m={a.concrete} w={10.3} d={6.3} y0={4} y1={4.3} z={back - 3} />
          <Box m={a.glass} w={4} d={2.5} y0={4.3} y1={4.7} z={back - 3} x={-1.5} />
          <mesh position={[3.5, 5.6, back - 2]} material={a.brick} castShadow>
            <boxGeometry args={[0.7, 3, 0.7]} />
          </mesh>
        </>
      )}
      {level >= 3 && (
        <>
          {/* Courtyard between the shop and the workshop, with a security van. */}
          <Box m={a.concrete} w={12} d={8} y1={0.05} z={back - 10} />
          <Van x={-2} z={back - 10} rot={Math.PI / 2} />
        </>
      )}
    </group>
  );
}

export function RecyclingYard({ level = 1 }: { level?: number }) {
  const a = useAssets();
  const [, d] = sizeOf({ kind: "recycling", level });
  const shift = -(d - 24) / 2;
  const back = d / 2;
  return (
    <group>
      <Box m={a.concrete} w={30} d={d} y1={0.06} />
      {/* Fence round the yard with the gate at the front. */}
      {[-1, 1].map((side) => (
        <Box key={side} m={a.fence} w={0.08} d={d} y1={2} x={side * 14.9} />
      ))}
      <Box m={a.fence} w={30} d={0.08} y1={2} z={back - 0.1} />
      {[-1, 1].map((side) => (
        <Box key={`g${side}`} m={a.fence} w={9} d={0.08} y1={2} x={side * 10.5} z={-back + 0.1} />
      ))}
      <group position={[0, 0, shift]}>
        {/* Office and sign at the gate. */}
        <Box m={a.plaster} w={6} d={4} y1={3.2} x={10} z={-8} />
        <Box m={a.glass} w={4} d={0.15} y0={1} y1={2.6} x={10} z={-10.05} />
        <mesh geometry={a.box} material={a.signRecycling} position={[10, 3.6, -10.05]} scale={[5.5, 1, 0.15]} />
        {/* Skips for wood, metal, paper and glass. */}
        <Skip x={-11} z={-5} m={a.paintBlue} fill={a.plank} />
        <Skip x={-7.5} z={-5} m={a.paintGreen} fill={a.steel} />
        <Skip x={-4} z={-5} m={a.paintYellow} fill={a.sack} />
        <Skip x={-0.5} z={-5} m={a.paintRed} fill={a.glass} />
        {/* Concrete bunkers with sorted heaps. */}
        {[-10, -4, 2].map((x, i) => (
          <group key={x} position={[x, 0, 5]}>
            {[-1, 1].map((side) => (
              <Box key={side} m={a.concrete} w={0.4} d={5} y1={2.2} x={side * 2.6} />
            ))}
            <Box m={a.concrete} w={5.6} d={0.4} y1={2.2} z={2.3} />
            <mesh position={[0, 0.2, 0.4]} scale={[2.2, 1.4, 2]} material={[a.plank, a.rust, a.coal][i]} castShadow>
              <coneGeometry args={[1, 1.6, 8]} />
            </mesh>
          </group>
        ))}
        {/* Sorting hall. */}
        <Box m={a.hall} w={9} d={10} y1={7} x={9.5} z={4} />
        <Box m={a.concrete} w={9.4} d={10.4} y0={7} y1={7.4} x={9.5} z={4} />
        <Box m={a.steel} w={4} d={0.15} y1={4.5} x={9.5} z={-1.05} />
      </group>
      {level >= 2 && (
        <>
          {/* Baler with stacked bales at the back. */}
          <Box m={a.paintGreen} w={3} d={6} y1={2.6} x={-9} z={back - 5} />
          <Box m={a.steel} w={1.2} d={1.2} y0={2.6} y1={4.2} x={-9} z={back - 3.5} />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Box key={i} m={[a.sack, a.plank, a.steel][i % 3]} w={1.3} d={1.1} y0={(i >> 1) * 1.1} y1={(i >> 1) * 1.1 + 1.05} x={-4 + (i % 2) * 1.4} z={back - 2.5} />
          ))}
          {level === 2 && <Van x={4} z={back - 4} rot={Math.PI / 2} />}
        </>
      )}
      {level >= 3 && (
        <>
          {/* Sorting plant with a conveyor up into it. */}
          <Box m={a.cladBlue} w={12} d={9} y1={10} x={8} z={back - 6} />
          <Box m={a.concrete} w={12.4} d={9.4} y0={10} y1={10.5} x={8} z={back - 6} />
          <mesh position={[0, 4, back - 8.5]} rotation={[0, 0, Math.atan2(6, 7)]} material={a.steel} castShadow>
            <boxGeometry args={[9, 0.3, 1.2]} />
          </mesh>
          <mesh position={[11, 12, back - 4]} material={a.steel} castShadow>
            <cylinderGeometry args={[0.6, 0.6, 3, 10]} />
          </mesh>
        </>
      )}
    </group>
  );
}

/** Deciduous tree for parks: trunk and two leafy spheres (`s` scales it). */
function ParkTree({ x, z, s = 1, light = false }: { x: number; z: number; s?: number; light?: boolean }) {
  const a = useAssets();
  const crown = light ? a.leavesLight : a.leaves;
  return (
    <group position={[x, 0, z]} scale={s}>
      <mesh position={[0, 1.6, 0]} material={a.log} castShadow>
        <cylinderGeometry args={[0.22, 0.3, 3.2, 8]} />
      </mesh>
      <mesh position={[0, 4.4, 0]} material={crown} castShadow>
        <sphereGeometry args={[2.4, 14, 10]} />
      </mesh>
      <mesh position={[0.9, 5.6, 0.4]} material={crown} castShadow>
        <sphereGeometry args={[1.6, 12, 8]} />
      </mesh>
    </group>
  );
}

function Bench({ x, z, rot = 0 }: { x: number; z: number; rot?: number }) {
  const a = useAssets();
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <Box m={a.plank} w={1.8} d={0.5} y0={0.42} y1={0.5} />
      <Box m={a.plank} w={1.8} d={0.08} y0={0.5} y1={0.95} z={0.22} />
      {[-0.75, 0.75].map((bx) => (
        <Box key={bx} m={a.steel} w={0.08} d={0.45} y1={0.42} x={bx} />
      ))}
    </group>
  );
}

/**
 * Stadtpark (40 × 32 m, same plot at every level): lawn, gravel paths, a small pond, trees,
 * benches and a hedge; level 2 adds a pavilion and lamps, level 3 a fountain, flower beds and
 * a footbridge over the pond.
 */
export function Park({ level = 1 }: { level?: number }) {
  const a = useAssets();
  return (
    <group>
      <Box m={a.lawn} w={40} d={32} y1={0.06} />
      {/* Hedge round the park with an entrance at the front. */}
      {[-1, 1].map((side) => (
        <Box key={side} m={a.hedge} w={17} d={0.8} y1={1.1} x={side * 11.5} z={-15.6} />
      ))}
      <Box m={a.hedge} w={40} d={0.8} y1={1.1} z={15.6} />
      {[-1, 1].map((side) => (
        <Box key={`s${side}`} m={a.hedge} w={0.8} d={32} y1={1.1} x={side * 19.6} />
      ))}
      {/* Paths: entrance to the centre, a cross path. */}
      <Box m={a.gravel} w={2.6} d={16} y0={0.06} y1={0.09} z={-8} />
      <Box m={a.gravel} w={30} d={2.4} y0={0.06} y1={0.09} x={-3} z={0} />
      {/* Pond with a stone rim. */}
      <mesh position={[9, 0.08, 7]} scale={[7.5, 1, 4.8]} material={a.stone} receiveShadow>
        <cylinderGeometry args={[1, 1, 0.16, 32]} />
      </mesh>
      <mesh position={[9, 0.12, 7]} scale={[7, 1, 4.3]} material={a.pond}>
        <cylinderGeometry args={[1, 1, 0.12, 32]} />
      </mesh>
      {[
        [-14, -9, 1],
        [-15, 8, 1.15],
        [-6, 11, 0.9],
        [14, -9, 1.1],
        [16, 12, 0.85],
        [-9, -11, 0.8],
      ].map(([x, z, sc], i) => (
        <ParkTree key={i} x={x} z={z} s={sc} light={i % 2 === 1} />
      ))}
      <Bench x={-3} z={-1.8} />
      <Bench x={5} z={-1.8} />
      <Bench x={2.5} z={2.6} rot={Math.PI} />
      {level >= 2 && (
        <>
          {/* Pavilion: eight posts and a green roof, with lamps along the paths. */}
          <group position={[-10, 0, 7]}>
            <mesh position={[0, 0.15, 0]} material={a.stone} receiveShadow>
              <cylinderGeometry args={[3.4, 3.6, 0.3, 8]} />
            </mesh>
            {Array.from({ length: 8 }, (_, i) => {
              const ang = (i / 8) * Math.PI * 2;
              return <Box key={i} m={a.paintWhite} w={0.22} d={0.22} y0={0.3} y1={3} x={Math.cos(ang) * 3} z={Math.sin(ang) * 3} />;
            })}
            <mesh position={[0, 3.7, 0]} material={a.copper} castShadow>
              <coneGeometry args={[4, 1.6, 8]} />
            </mesh>
          </group>
          {[-12, 0, 12].map((x) => (
            <group key={x} position={[x, 0, -3.2]}>
              <Box m={a.steel} w={0.12} d={0.12} y1={3.4} />
              <Box m={a.paintWhite} w={0.4} d={0.4} y0={3.4} y1={3.8} />
            </group>
          ))}
          <ParkTree x={4} z={12.5} s={1.2} />
          <Bench x={-10} z={2.6} rot={Math.PI} />
        </>
      )}
      {level >= 3 && (
        <>
          {/* Fountain where the paths meet, flower beds and a footbridge over the pond. */}
          <group position={[0, 0, 0]}>
            <mesh position={[0, 0.35, 0]} material={a.stone} castShadow receiveShadow>
              <cylinderGeometry args={[2.6, 2.8, 0.7, 24]} />
            </mesh>
            <mesh position={[0, 0.72, 0]} material={a.poolWater}>
              <cylinderGeometry args={[2.3, 2.3, 0.06, 24]} />
            </mesh>
            <mesh position={[0, 1.4, 0]} material={a.stone} castShadow>
              <cylinderGeometry args={[0.35, 0.5, 1.4, 12]} />
            </mesh>
            <mesh position={[0, 2.25, 0]} material={a.stone}>
              <cylinderGeometry args={[0.9, 0.4, 0.3, 16]} />
            </mesh>
          </group>
          {[
            [-8, -7, a.paintRed],
            [6, -7, a.paintYellow],
            [-8, -12, a.paintYellow],
            [6, -12, a.paintRed],
          ].map(([x, z, m], i) => (
            <group key={i}>
              <Box m={a.yard} w={5} d={2.6} y1={0.25} x={x as number} z={z as number} />
              <Box m={m as THREE.Material} w={4.4} d={2} y0={0.25} y1={0.55} x={x as number} z={z as number} />
            </group>
          ))}
          <Box m={a.plank} w={1.8} d={9.4} y0={0.3} y1={0.45} x={9} z={7} />
          {[-1, 1].map((side) => (
            <Box key={side} m={a.wood} w={0.08} d={9.4} y0={0.45} y1={1.3} x={9 + side * 0.9} z={7} />
          ))}
          <ParkTree x={-17} z={-2} s={1.1} light />
          <ParkTree x={17} z={2} s={1} />
        </>
      )}
    </group>
  );
}

/** Swing frame with two seats (A-frames, top bar, chains). */
function Swing({ x, z }: { x: number; z: number }) {
  const a = useAssets();
  return (
    <group position={[x, 0, z]}>
      {[-2, 2].map((sx) => (
        <group key={sx} position={[sx, 0, 0]}>
          {[-1, 1].map((sz) => (
            <mesh key={sz} position={[0, 1.25, sz * 0.5]} rotation={[sz * 0.38, 0, 0]} material={a.paintBlue} castShadow>
              <cylinderGeometry args={[0.07, 0.07, 2.7, 6]} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={[0, 2.5, 0]} rotation={[0, 0, Math.PI / 2]} material={a.paintBlue} castShadow>
        <cylinderGeometry args={[0.08, 0.08, 4.2, 6]} />
      </mesh>
      {[-0.9, 0.9].map((sx) => (
        <group key={sx} position={[sx, 0, 0]}>
          {[-0.22, 0.22].map((cx) => (
            <Box key={cx} m={a.steel} w={0.03} d={0.03} y0={0.55} y1={2.5} x={cx} />
          ))}
          <Box m={a.rubberBlack} w={0.55} d={0.25} y0={0.5} y1={0.56} />
        </group>
      ))}
    </group>
  );
}

/** Slide: tower with ladder and roof, red chute down to the sand. */
function SlideTower({ x, z, h = 2 }: { x: number; z: number; h?: number }) {
  const a = useAssets();
  const len = Math.hypot(h, h * 1.8);
  return (
    <group position={[x, 0, z]}>
      {[
        [-0.8, -0.8],
        [0.8, -0.8],
        [-0.8, 0.8],
        [0.8, 0.8],
      ].map(([px, pz]) => (
        <Box key={`${px}${pz}`} m={a.wood} w={0.15} d={0.15} y1={h + 1.6} x={px} z={pz} />
      ))}
      <Box m={a.plank} w={1.8} d={1.8} y0={h - 0.1} y1={h} />
      <mesh position={[0, h + 2, 0]} rotation={[0, Math.PI / 4, 0]} material={a.paintRed} castShadow>
        <coneGeometry args={[1.5, 0.9, 4]} />
      </mesh>
      {/* Ladder at the back. */}
      {[-0.35, 0.35].map((lx) => (
        <Box key={lx} m={a.wood} w={0.08} d={0.08} y1={h} x={lx} z={-1.1} />
      ))}
      {Array.from({ length: Math.floor(h / 0.4) }, (_, i) => (
        <Box key={i} m={a.wood} w={0.7} d={0.06} y0={0.3 + i * 0.4} y1={0.36 + i * 0.4} z={-1.1} />
      ))}
      <mesh position={[0, h / 2, 0.9 + (h * 1.8) / 2]} rotation={[Math.atan2(h, h * 1.8), 0, 0]} material={a.slide} castShadow>
        <boxGeometry args={[0.8, 0.1, len]} />
      </mesh>
    </group>
  );
}

/**
 * Spielplatz (22 × 16 m): fenced sand area with swings, slide, sandpit and seesaw; level 2
 * adds a climbing frame and a bigger slide tower, level 3 a pirate ship and a water play table.
 */
export function Playground({ level = 1 }: { level?: number }) {
  const a = useAssets();
  return (
    <group>
      <Box m={a.lawn} w={22} d={16} y1={0.05} />
      <Box m={a.sand} w={19} d={13} y0={0.05} y1={0.1} z={0.5} />
      {/* Low wooden fence with a gate at the front. */}
      {[-1, 1].map((side) => (
        <Box key={side} m={a.plank} w={9} d={0.1} y1={0.9} x={side * 6} z={-7.8} />
      ))}
      <Box m={a.plank} w={22} d={0.1} y1={0.9} z={7.8} />
      {[-1, 1].map((side) => (
        <Box key={`s${side}`} m={a.plank} w={0.1} d={15.6} y1={0.9} x={side * 10.9} />
      ))}
      <Swing x={-5.5} z={3.5} />
      <SlideTower x={4.5} z={-1.5} />
      {/* Sandpit with a wooden frame. */}
      <group position={[-5, 0, -3.5]}>
        {[-1, 1].map((side) => (
          <Box key={side} m={a.plank} w={4} d={0.2} y1={0.35} z={side * 1.6} />
        ))}
        {[-1, 1].map((side) => (
          <Box key={`e${side}`} m={a.plank} w={0.2} d={3.4} y1={0.35} x={side * 1.9} />
        ))}
        <Box m={a.sand} w={3.6} d={3} y0={0.1} y1={0.2} />
        <Box m={a.paintYellow} w={0.5} d={0.5} y0={0.2} y1={0.5} x={0.6} z={0.4} />
      </group>
      {/* Seesaw. */}
      <group position={[0, 0, 5]}>
        <Box m={a.steel} w={0.3} d={0.3} y1={0.55} />
        <Box m={a.paintGreen} w={3.6} d={0.35} y0={0.5} y1={0.6} rotY={0} />
      </group>
      <Bench x={8} z={6.5} rot={Math.PI} />
      {level >= 2 && (
        <>
          {/* Climbing frame: a cube of bars. */}
          <group position={[-0.5, 0, -2]}>
            {[0, 1, 2].map((ix) =>
              [0, 1, 2].map((iz) => <Box key={`${ix}${iz}`} m={a.paintYellow} w={0.08} d={0.08} y1={2.2} x={ix * 1.1 - 1.1} z={iz * 1.1 - 1.1} />),
            )}
            {[0.7, 1.45, 2.2].map((y) => (
              <group key={y}>
                {[-1.1, 0, 1.1].map((p) => (
                  <group key={p}>
                    <Box m={a.paintYellow} w={2.3} d={0.06} y0={y} y1={y + 0.06} z={p} />
                    <Box m={a.paintYellow} w={0.06} d={2.3} y0={y} y1={y + 0.06} x={p} />
                  </group>
                ))}
              </group>
            ))}
          </group>
          <SlideTower x={8} z={2} h={3} />
        </>
      )}
      {level >= 3 && (
        <>
          {/* Pirate ship: hull, deck, mast and sail. */}
          <group position={[-6, 0, 0.5]} rotation={[0, Math.PI / 2, 0]}>
            <Box m={a.wood} w={2.6} d={6} y0={0.1} y1={1.4} />
            <mesh position={[0, 0.75, 3.4]} rotation={[0, Math.PI / 4, 0]} material={a.wood} castShadow>
              <boxGeometry args={[1.84, 1.3, 1.84]} />
            </mesh>
            <Box m={a.plank} w={2.8} d={6.2} y0={1.4} y1={1.5} />
            <Box m={a.wood} w={0.18} d={0.18} y0={1.5} y1={6} />
            <Box m={a.sail} w={0.05} d={2.6} y0={2.6} y1={5.4} x={0.15} />
            <Box m={a.flagRed} w={0.04} d={0.8} y0={5.6} y1={6.1} x={0.1} z={0.4} />
          </group>
          {/* Water play table. */}
          <group position={[5, 0, 5.5]}>
            <Box m={a.concrete} w={3} d={1.2} y1={0.7} />
            <Box m={a.poolWater} w={2.6} d={0.8} y0={0.7} y1={0.74} />
            <Box m={a.steel} w={0.1} d={0.1} y0={0.7} y1={1.5} x={-1.3} />
          </group>
        </>
      )}
    </group>
  );
}

/**
 * Job centre: plastered office block with a glass entrance and sign, bike stands and a
 * forecourt; level 2 adds a wing, level 3 a taller second building.
 */
const CHAR = new THREE.MeshStandardMaterial({ color: "#2b2725", roughness: 1 });
const ASH = new THREE.MeshStandardMaterial({ color: "#4d4844", roughness: 1 });
const SOOT = new THREE.MeshStandardMaterial({ color: "#5f5852", roughness: 1 });

/** Burnt-out house: charred wall stumps of uneven height, no roof, ash and rubble on the plot. */
export function Ruin() {
  const a = useAssets();
  // Wall pieces: [x, z, w, d, height] around an 8 × 7.5 m house.
  const walls: [number, number, number, number, number][] = [
    [-2.6, -3.75, 2.8, 0.3, 2.6],
    [1.2, -3.75, 1.6, 0.3, 1.4],
    [3.2, -3.75, 1.6, 0.3, 3.1],
    [-4, -1.5, 0.3, 4.2, 2.2],
    [-4, 2.4, 0.3, 2.6, 0.9],
    [4, 0.2, 0.3, 5, 1.7],
    [-1.5, 3.75, 4.6, 0.3, 1.3],
    [2.8, 3.75, 2.2, 0.3, 2.4],
  ];
  return (
    <group>
      <mesh geometry={a.box} material={ASH} position={[0, 0, 0]} scale={[8.6, 0.12, 8.1]} receiveShadow />
      {walls.map(([x, z, w, d, h], i) => (
        <mesh key={i} geometry={a.box} material={i % 3 === 0 ? SOOT : CHAR} position={[x, 0, z]} scale={[w, h, d]} castShadow receiveShadow />
      ))}
      {/* Rubble heaps and a fallen beam. */}
      {[
        [-1, 0.5, 2.2],
        [1.8, -1, 1.6],
        [-2.4, 1.8, 1.3],
      ].map(([x, z, r], i) => (
        <mesh key={i} position={[x, 0.05, z]} material={CHAR} scale={[r, 0.5, r * 0.8]} castShadow>
          <sphereGeometry args={[1, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
      ))}
      <mesh geometry={a.box} material={CHAR} position={[0.4, 0.4, 0.8]} rotation={[0, 0.6, 0.35]} scale={[5.5, 0.25, 0.25]} castShadow />
    </group>
  );
}

export function JobCentre({ level = 1 }: { level?: number }) {
  const a = useAssets();
  return (
    <group>
      <Box m={a.yard} w={20} d={4} y1={0.06} z={-6} />
      <group position={[-2, 0, 1.5]}>
        <Box m={a.plaster} w={14} d={10} y1={7.2} />
        {[2, 5].map((y) => (
          <Box key={y} m={a.officeGlass} w={12.4} d={10.1} y0={y - 1.2} y1={y + 0.4} />
        ))}
        <Box m={a.concrete} w={14.4} d={10.4} y0={7.2} y1={7.7} />
        {/* Glass entrance with canopy and sign. */}
        <Box m={a.glass} w={4} d={0.3} y0={0} y1={3} x={-3} z={-5.1} />
        <Box m={a.concrete} w={5.5} d={1.8} y0={3.1} y1={3.35} x={-3} z={-5.8} />
        <mesh geometry={a.box} material={a.signJobs} position={[2.5, 4.4, -5.15]} scale={[7, 1.2, 0.2]} />
      </group>
      {/* Bike stands by the door. */}
      {[-6, -4.5, -3, -1.5].map((x) => (
        <Box key={x} m={a.steel} w={0.08} d={1.2} y0={0} y1={0.8} x={x + 10} z={-5.5} />
      ))}
      {level >= 2 && (
        <group position={[8, 0, 2.5]}>
          <Box m={a.plaster} w={5} d={8} y1={4.2} />
          <Box m={a.officeGlass} w={5.1} d={6.6} y0={1.6} y1={3} />
          <Box m={a.concrete} w={5.4} d={8.4} y0={4.2} y1={4.6} />
        </group>
      )}
      {level >= 3 && (
        <group position={[8, 0, 2.5]}>
          {[1, 2, 3].map((f) => (
            <group key={f}>
              <Box m={a.concrete} w={5} d={8} y0={1.2 + f * 3.4} y1={2.2 + f * 3.4} />
              <Box m={a.officeGlass} w={4.8} d={7.8} y0={2.2 + f * 3.4} y1={4.6 + f * 3.4} />
            </group>
          ))}
          <Box m={a.concrete} w={5.4} d={8.4} y0={14.8} y1={15.4} />
        </group>
      )}
    </group>
  );
}

/** Tax office: four-storey office block with window bands, entrance hall, car park and bike racks. */
/**
 * Police station: two-storey office block with a blue band and sign, glass entrance, radio
 * mast; level 2 adds a side wing with the garage for the patrol cars, level 3 a third floor.
 */
export function PoliceStation({ level = 1 }: { level?: number }) {
  const a = useAssets();
  const floors = level >= 3 ? 3 : 2;
  const h = floors * 3.4;
  return (
    <group>
      {/* Yard at the front where the patrol cars park. */}
      <Box m={a.yard} w={22} d={5} y1={0.06} z={-6.2} />
      <group position={[-3, 0, 2]}>
        <Box m={a.hospitalFacade} w={15} d={11} y1={h} />
        {Array.from({ length: floors }, (_, f) => (
          <Box key={f} m={a.officeGlass} w={15.1} d={11.1} y0={f * 3.4 + 1.2} y1={f * 3.4 + 2.6} />
        ))}
        <Box m={a.policeStripe} w={15.2} d={11.2} y0={h - 0.5} y1={h} />
        <Box m={a.concrete} w={15.4} d={11.4} y0={h} y1={h + 0.4} />
        {/* Entrance with canopy and the sign above it. */}
        <Box m={a.glass} w={4.5} d={0.3} y1={3} x={-2} z={-5.55} />
        <Box m={a.concrete} w={6} d={1.8} y0={3.1} y1={3.35} x={-2} z={-6.2} />
        <mesh geometry={a.box} material={a.signPolice} position={[3, 4.2, -5.6]} scale={[7, 1.4, 0.2]} />
        {/* Radio mast on the roof. */}
        <Box m={a.steel} w={0.12} d={0.12} y0={h + 0.4} y1={h + 7} x={5.5} z={3.5} />
        <Box m={a.steel} w={1.4} d={0.08} y0={h + 5.5} y1={h + 5.6} x={5.5} z={3.5} />
      </group>
      {level >= 2 && (
        <group position={[7.5, 0, 3.5]}>
          {/* Garage wing for the patrol cars. */}
          <Box m={a.hospitalFacade} w={6} d={8} y1={3.6} />
          <Box m={a.policeStripe} w={6.2} d={8.2} y0={3.2} y1={3.6} />
          <Box m={a.concrete} w={6.4} d={8.4} y0={3.6} y1={4} />
          <Box m={a.steel} w={4} d={0.15} y0={0.05} y1={2.9} z={-4.05} />
        </group>
      )}
    </group>
  );
}

/**
 * Fire station: garage hall with red roller doors (2 / 3 / 4 by level), hose tower with a
 * red top, sign over the doors; level 2 adds a second hall behind, level 3 a taller tower.
 */
export function FireStation({ level = 1 }: { level?: number }) {
  const a = useAssets();
  const doors = Math.min(4, 1 + level);
  const hallW = 4.5 * doors + 2;
  const towerH = level >= 3 ? 18 : 13;
  return (
    <group>
      <Box m={a.yard} w={26} d={6} y1={0.06} z={-7} />
      <group position={[-(28 - hallW) / 2 + 2, 0, -0.5]}>
        <Box m={a.hospitalFacade} w={hallW} d={13} y1={5.6} />
        <Box m={a.paintRed} w={hallW + 0.2} d={13.2} y0={5.1} y1={5.6} />
        <Box m={a.concrete} w={hallW + 0.4} d={13.4} y0={5.6} y1={6} />
        {Array.from({ length: doors }, (_, i) => (
          <Box key={i} m={a.rollerDoor} w={3.6} d={0.15} y0={0.05} y1={4.2} x={-hallW / 2 + 1 + 2.25 + i * 4.5} z={-6.55} />
        ))}
        <mesh geometry={a.box} material={a.signFire} position={[0, 6.4, -6.5]} scale={[Math.min(hallW - 1, 9), 1.5, 0.3]} />
      </group>
      {/* Hose tower at the right with a red cap. */}
      <group position={[11, 0, 4]}>
        <Box m={a.hospitalFacade} w={4.2} d={4.2} y1={towerH} />
        {[0.3, 0.55, 0.8].map((f) => (
          <Box key={f} m={a.glass} w={0.9} d={0.1} y0={towerH * f} y1={towerH * f + 1.6} z={-2.15} />
        ))}
        <Box m={a.paintRed} w={4.6} d={4.6} y0={towerH} y1={towerH + 0.7} />
        <Box m={a.steel} w={0.1} d={0.1} y0={towerH + 0.7} y1={towerH + 4} />
      </group>
      {level >= 2 && (
        <group position={[-4, 0, 7.5]}>
          {/* Second hall at the back: workshop and crew quarters. */}
          <Box m={a.hospitalFacade} w={16} d={5} y1={4.2} />
          <Box m={a.officeGlass} w={16.1} d={5.1} y0={1.4} y1={2.8} />
          <Box m={a.paintRed} w={16.2} d={5.2} y0={3.8} y1={4.2} />
          <Box m={a.concrete} w={16.4} d={5.4} y0={4.2} y1={4.6} />
        </group>
      )}
    </group>
  );
}

export function TaxOffice() {
  const a = useAssets();
  const floors = [0, 1, 2, 3];
  return (
    <group>
      {/* Forecourt and car park on the left. */}
      <Box m={a.yard} w={14} d={4} y1={0.06} x={4} z={-7} />
      <Box m={a.asphalt} w={8} d={15} y1={0.05} x={-7.5} z={0.5} />
      {[-4, -1, 2, 5].map((z) => (
        <Box key={z} m={a.paintWhite} w={0.15} d={2.6} y0={0.05} y1={0.07} x={-7.5} z={z + 1.5} />
      ))}
      {/* Office block: concrete floors with glass bands between. */}
      <group position={[4, 0, 1]}>
        {floors.map((f) => (
          <group key={f}>
            <Box m={a.concrete} w={15} d={12} y0={f * 3.4} y1={f * 3.4 + 1.1} />
            <Box m={a.officeGlass} w={14.6} d={11.6} y0={f * 3.4 + 1.1} y1={f * 3.4 + 3.4} />
            {/* Vertical fins in front of the windows. */}
            {[-6, -3, 0, 3, 6].map((x) => (
              <Box key={x} m={a.concrete} w={0.3} d={0.3} y0={f * 3.4 + 1.1} y1={f * 3.4 + 3.4} x={x} z={-5.95} />
            ))}
          </group>
        ))}
        <Box m={a.concrete} w={15.4} d={12.4} y0={13.6} y1={14.4} />
        {/* Plant room on the roof. */}
        <Box m={a.hall} w={4} d={3} y0={14.4} y1={16.2} x={3} z={2} />
        {/* Entrance hall with canopy and sign. */}
        <Box m={a.officeGlass} w={5} d={1.6} y1={3.4} z={-6.6} />
        <Box m={a.concrete} w={7} d={3} y0={3.4} y1={3.75} z={-7.1} />
        <mesh geometry={a.box} material={a.signTaxOffice} position={[0, 4.4, -6.1]} scale={[6, 0.9, 0.15]} />
      </group>
      {/* Flagpole and bike racks. */}
      <group position={[11, 0, -7.5]}>
        <Box m={a.steel} w={0.15} d={0.15} y1={10} />
        <mesh geometry={a.box} material={a.flagBlue} position={[1.1, 8.4, 0]} scale={[2.2, 1.4, 0.04]} castShadow />
      </group>
      {[-1.5, -0.5, 0.5].map((x) => (
        <Box key={x} m={a.steel} w={0.08} d={1.2} y0={0.2} y1={0.9} x={x - 1} z={-7.6} />
      ))}
      {/* Hedge along the back. */}
      <Box m={a.hedge} w={22} d={1} y1={1.4} z={8.3} />
    </group>
  );
}

/** Stack of shipping containers (rows × layers), colours cycling. */
/** Container stacks: Kenney's City Kit containers (KitProps.tsx). */
const Containers = KitContainers;

/** Pallet stacks with crates in front of a warehouse door. */
function Pallets({ x, z, n }: { x: number; z: number; n: number }) {
  const a = useAssets();
  return (
    <group position={[x, 0, z]}>
      {Array.from({ length: n }, (_, i) => (
        <group key={i} position={[(i % 3) * 1.6, 0, Math.floor(i / 3) * 1.6]}>
          <Box m={a.plank} w={1.2} d={1.2} y1={0.15} />
          <Box m={i % 2 ? a.sack : a.plank} w={1.1} d={1.1} y0={0.15} y1={1.2 + (i % 3) * 0.3} />
        </group>
      ))}
    </group>
  );
}

/** One storage hall with roller doors on the front (local −z). */
function StoreHall({ x = 0, z = 0, w, d, h, doors }: { x?: number; z?: number; w: number; d: number; h: number; doors: number }) {
  const a = useAssets();
  return (
    <group position={[x, 0, z]}>
      <Box m={a.concrete} w={w} d={d} y1={1.2} />
      <Box m={a.hall} w={w} d={d} y0={1.2} y1={h} />
      <Roof m={a.hall} g={a.hall} w={w} d={d} y={h} h={1.6} overhang={0.4} />
      {Array.from({ length: doors }, (_, i) => (
        <group key={i} position={[-w / 2 + (w / doors) * (i + 0.5), 0, -d / 2 - 0.06]}>
          <Box m={a.paintWhite} w={3.6} d={0.12} y0={1.2} y1={5} />
          <Box m={a.steel} w={4.2} d={1.6} y0={0} y1={1.2} z={-0.8} />
        </group>
      ))}
    </group>
  );
}

/**
 * Warehouse levels: 1 Lagerhalle (one hall), 2 Großlager (second hall, container yard),
 * 3 Logistikzentrum (high-bay store, dock hall, trucks). The plot grows away from the
 * road; the first hall keeps its place at the road.
 */
export function Warehouse({ level }: { level: number }) {
  const a = useAssets();
  const shift = level >= 3 ? -7 : level >= 2 ? -3 : 0;
  return (
    <group>
      <group position={[0, 0, shift]}>
        <Box m={a.yard} w={30} d={8} y1={0.05} z={-7} />
        <StoreHall w={24} d={12} h={8} doors={4} z={2} x={-1} />
        <mesh geometry={a.box} material={a.signStore} position={[-1, 9.1, -4.1]} scale={[6, 1.2, 0.15]} />
        <Pallets x={-11} z={-6} n={6} />
        <Van x={9} z={-6} rot={Math.PI / 2} />
      </group>
      {level === 2 && (
        <group>
          <Box m={a.yard} w={40} d={10} y1={0.04} z={8} />
          <StoreHall w={18} d={9} h={7} doors={3} x={-10} z={9.5} />
          <Containers x={6} z={5} rows={3} layers={2} />
          <Containers x={14} z={5} rows={3} layers={1} />
        </group>
      )}
      {level >= 3 && (
        <group>
          <Box m={a.asphalt} w={56} d={20} y1={0.05} z={8} />
          {/* High-bay store with blue cladding and the logistics sign. */}
          <Box m={a.concrete} w={16} d={22} y1={1} x={20} z={4} />
          <Box m={a.cladBlue} w={16} d={22} y0={1} y1={20} x={20} z={4} />
          <Box m={a.concrete} w={16.4} d={22.4} y0={20} y1={20.6} x={20} z={4} />
          <RoofSolar x={20} y={20.6} z={4} cols={2} rows={5} />
          <mesh geometry={a.box} material={a.signLogistics} position={[20, 16, -7.1]} scale={[11, 2.2, 0.15]} />
          {/* Dock hall at the back with trucks at the gates. */}
          <StoreHall w={30} d={8} h={7} doors={5} x={-12} z={13} />
          {[-22, -16, -10].map((x) => (
            <Van key={x} x={x} z={5.5} rot={Math.PI} />
          ))}
          <Containers x={4} z={3} rows={3} layers={2} />
        </group>
      )}
    </group>
  );
}

/** Inland harbour: quay wall at the back (water), portal crane, shed, containers, office, sign. */
export function Harbour() {
  const a = useAssets();
  return (
    <group>
      <Box m={a.yard} w={40} d={16} y1={0.08} z={-4} />
      {/* Quay: the back 8 m are built out into the water, a solid block down to the bed. */}
      <Box m={a.concrete} w={40} d={8} y0={-7} y1={0.12} z={8} />
      <Box m={a.concrete} w={40} d={0.6} y0={0.12} y1={0.4} z={11.7} />
      {[-17, -9, -1, 7, 15].map((x) => (
        <mesh key={x} position={[x, 0.75, 11.4]} material={a.coal} castShadow>
          <cylinderGeometry args={[0.3, 0.35, 0.8, 10]} />
        </mesh>
      ))}
      {/* Crane rails and portal crane with its boom out over the water. */}
      {[5.5, 10].map((z) => (
        <Box key={z} m={a.steel} w={40} d={0.3} y0={0.08} y1={0.2} z={z} />
      ))}
      <group position={[-2, 0, 0]}>
        {[
          [-3, 5.5],
          [3, 5.5],
          [-3, 10],
          [3, 10],
        ].map(([x, z]) => (
          <Box key={`${x}${z}`} m={a.craneYellow} w={0.8} d={0.8} y0={0.2} y1={12} x={x} z={z} />
        ))}
        <Box m={a.craneYellow} w={7.6} d={6} y0={12} y1={13.4} z={7.75} />
        <Box m={a.craneYellow} w={1.2} d={26} y0={13.4} y1={14.6} z={13} />
        <Box m={a.paintWhite} w={2.4} d={2.6} y0={10.4} y1={12} x={2.4} z={11} />
        <Box m={a.steel} w={0.08} d={0.08} y0={5} y1={13.4} z={20} />
        <Box m={a.paintRed} w={6} d={2.4} y0={2.4} y1={5} z={20} />
      </group>
      {/* Shed, containers and harbour office. */}
      <StoreHall w={14} d={9} h={7} doors={3} x={-12} z={-4} />
      <Containers x={6} z={-6} rows={3} layers={3} />
      <Containers x={14} z={-6} rows={2} layers={2} />
      <Box m={a.brick} w={6} d={5} y1={6} x={15} z={3} />
      <Box m={a.officeGlass} w={6.1} d={5.1} y0={3.6} y1={4.8} x={15} z={3} />
      <mesh geometry={a.box} material={a.signHarbour} position={[15, 6.7, 0.4]} scale={[5, 1.1, 0.15]} />
      <Box m={a.slate} w={6.4} d={5.4} y0={6} y1={6.4} x={15} z={3} />
    </group>
  );
}

/** Spiral water slide from the tower top down into the pool. */
function slideGeometry() {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const a = t * Math.PI * 2.4;
    pts.push(new THREE.Vector3(Math.cos(a) * 3.2 * (1 - t * 0.3), 7.6 - t * 7.2, Math.sin(a) * 3.2 * (1 - t * 0.3) - t * 2));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.55, 12, false);
}
let slideGeo: THREE.TubeGeometry | null = null;

/** Outdoor pool: bath house at the road, sports pool, kids' pool, slide, diving tower, loungers. */
export function Pool() {
  const a = useAssets();
  slideGeo ??= slideGeometry();
  return (
    <group>
      {/* Bath house with glass front and sign. */}
      <Box m={a.plaster} w={22} d={7} y1={5} z={-10} />
      <Box m={a.concrete} w={22.6} d={7.6} y0={5} y1={5.5} z={-10} />
      <Box m={a.glass} w={12} d={0.2} y0={0.3} y1={3.8} x={-2} z={-13.55} />
      <mesh geometry={a.box} material={a.signPool} position={[5.5, 4.2, -13.6]} scale={[7, 1.1, 0.15]} />
      {/* Deck and hedge around it. */}
      <Box m={a.poolTile} w={34} d={20} y1={0.15} z={3.5} />
      {[
        [0, 13.6, 35, 0.8],
        [-17.4, 3.5, 0.8, 21],
        [17.4, 3.5, 0.8, 21],
      ].map(([x, z, w, d]) => (
        <Box key={`${x}${z}`} m={a.hedge} w={w} d={d} y1={1.6} x={x} z={z} />
      ))}
      {/* Sports pool with lane ropes. */}
      <Box m={a.poolTile} w={21} d={11} y1={0.35} x={-5} z={3} />
      <Box m={a.poolWater} w={20} d={10} y0={0.35} y1={0.38} x={-5} z={3} />
      {[-1, 1, 3, 5, 7].map((z) => (
        <Box key={z} m={a.paintRed} w={20} d={0.08} y0={0.38} y1={0.44} x={-5} z={z - 1} />
      ))}
      {/* Diving tower at the far end. */}
      <Box m={a.concrete} w={1.2} d={1.2} y1={5} x={-14} z={10} />
      <Box m={a.paintBlue} w={1.4} d={3.4} y0={5} y1={5.2} x={-14} z={8.3} />
      <Box m={a.paintBlue} w={1.2} d={2.6} y0={3} y1={3.15} x={-12.6} z={8.6} />
      {/* Kids' pool. */}
      <mesh position={[11, 0.25, 9]} material={a.poolTile} receiveShadow>
        <cylinderGeometry args={[3.6, 3.6, 0.5, 28]} />
      </mesh>
      <mesh position={[11, 0.51, 9]} material={a.poolWater}>
        <cylinderGeometry args={[3.2, 3.2, 0.02, 28]} />
      </mesh>
      {/* Slide tower and spiral slide into the plunge pool. */}
      <Box m={a.steel} w={2.2} d={2.2} y1={8} x={12} z={-2} />
      <Box m={a.paintYellow} w={2.6} d={2.6} y0={8} y1={8.3} x={12} z={-2} />
      <mesh geometry={slideGeo} material={a.slide} position={[12, 0.4, -2]} castShadow />
      <Box m={a.poolTile} w={6} d={5} y1={0.35} x={12} z={-5.5} />
      <Box m={a.poolWater} w={5.4} d={4.4} y0={0.35} y1={0.38} x={12} z={-5.5} />
      {/* Loungers and parasols on the lawn side. */}
      {[-12, -7, -2, 3].map((x, i) => (
        <group key={x} position={[x, 0.15, 11]}>
          <Box m={i % 2 ? a.paintBlue : a.paintWhite} w={0.8} d={2} y0={0.3} y1={0.4} />
          <Box m={a.steel} w={0.06} d={0.06} y1={2.4} x={1} />
          <mesh position={[1, 2.4, 0]} material={i % 2 ? a.paintYellow : a.awning} castShadow>
            <coneGeometry args={[1.4, 0.6, 12]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

const WHEEL_R = 11;
const WHEEL_Y = 13.5;
const GONDOLAS = 12;

/** Fair: Ferris wheel, carousel, stalls and an entrance arch. Wheel and carousel turn. */
export function Fair() {
  const a = useAssets();
  const wheel = useRef<THREE.Group>(null);
  const carousel = useRef<THREE.Group>(null);
  useFrame((_, dt) => turnRides(wheel.current, carousel.current, dt));
  return (
    <group>
      <Box m={a.gravel} w={42} d={32} y1={0.06} />
      {/* Entrance arch with sign. */}
      {[-4, 4].map((x) => (
        <Box key={x} m={a.paintRed} w={0.6} d={0.6} y1={6} x={x} z={-15.5} />
      ))}
      <mesh geometry={a.box} material={a.signFair} position={[0, 6, -15.5]} scale={[9.2, 1.6, 0.4]} castShadow />
      {/* Ferris wheel: A-frames, rim, spokes, gondolas that stay upright. */}
      <group position={[8, 0, 6]}>
        {[-1.6, 1.6].map((z) => (
          <group key={z} position={[0, 0, z]}>
            {[-1, 1].map((side) => (
              <mesh key={side} position={[side * 3.4, WHEEL_Y / 2, 0]} rotation={[0, 0, side * 0.25]} material={a.paintWhite} castShadow>
                <boxGeometry args={[0.5, WHEEL_Y + 1, 0.5]} />
              </mesh>
            ))}
          </group>
        ))}
        <mesh position={[0, WHEEL_Y, 0]} rotation={[Math.PI / 2, 0, 0]} material={a.steel}>
          <cylinderGeometry args={[0.5, 0.5, 3.6, 12]} />
        </mesh>
        <group ref={wheel} position={[0, WHEEL_Y, 0]} userData={DYNAMIC}>
          {[-0.7, 0.7].map((z) => (
            <mesh key={z} position={[0, 0, z]} material={a.paintWhite} castShadow>
              <torusGeometry args={[WHEEL_R, 0.18, 8, 64]} />
            </mesh>
          ))}
          {Array.from({ length: GONDOLAS }, (_, i) => {
            const ang = (i / GONDOLAS) * Math.PI * 2;
            return (
              <group key={i} rotation={[0, 0, ang]}>
                <mesh position={[0, WHEEL_R / 2, 0]} material={a.paintWhite}>
                  <boxGeometry args={[0.12, WHEEL_R, 0.12]} />
                </mesh>
                {/* Gondola pivot on the rim; the gondola itself is turned back upright each frame. */}
                <group position={[0, WHEEL_R, 0]}>
                  <group name="gondola">
                    <mesh position={[0, -1.1, 0]} material={[a.paintRed, a.paintYellow, a.paintBlue, a.paintGreen][i % 4]} castShadow>
                      <cylinderGeometry args={[0.9, 0.7, 1.4, 10]} />
                    </mesh>
                    <mesh position={[0, -0.25, 0]} material={a.paintWhite}>
                      <coneGeometry args={[1, 0.5, 10]} />
                    </mesh>
                  </group>
                </group>
              </group>
            );
          })}
        </group>
      </group>
      {/* Carousel: base, turning top with striped roof, horses on poles. */}
      <group position={[-10, 0, 3]}>
        <mesh position={[0, 0.3, 0]} material={a.paintWhite} receiveShadow>
          <cylinderGeometry args={[5.2, 5.4, 0.6, 32]} />
        </mesh>
        <group ref={carousel} userData={DYNAMIC}>
          <mesh position={[0, 2.5, 0]} material={a.paintYellow}>
            <cylinderGeometry args={[0.5, 0.5, 4.4, 12]} />
          </mesh>
          <mesh position={[0, 5.3, 0]} material={a.awning} castShadow>
            <coneGeometry args={[5.8, 2, 24]} />
          </mesh>
          {Array.from({ length: 8 }, (_, i) => {
            const ang = (i / 8) * Math.PI * 2;
            return (
              <group key={i} position={[Math.cos(ang) * 3.8, 0, Math.sin(ang) * 3.8]} rotation={[0, -ang, 0]}>
                <Box m={a.gold} w={0.08} d={0.08} y0={0.6} y1={4.3} />
                <Box m={[a.paintWhite, a.wood, a.paintBlue][i % 3]} w={0.4} d={1.4} y0={1.4} y1={2.1} />
              </group>
            );
          })}
        </group>
      </group>
      {/* Stalls along the front. */}
      {[
        [-16, a.awning],
        [-11, a.awningGreen],
        [11, a.awning],
        [16, a.awningGreen],
      ].map(([x, m]) => (
        <group key={x as number} position={[x as number, 0, -12]}>
          <Box m={a.plank} w={4} d={3} y1={2.6} />
          <mesh geometry={a.box} material={m as THREE.Material} position={[0, 2.6, -1.2]} scale={[4.4, 0.12, 1.6]} rotation={[0.35, 0, 0]} castShadow />
          <Box m={a.paintWhite} w={4.2} d={3.2} y0={2.6} y1={2.8} />
        </group>
      ))}
    </group>
  );
}

/** Per-frame ride motion (outside the component for the React compiler). */
function turnRides(wheel: THREE.Group | null, carousel: THREE.Group | null, dt: number) {
  if (wheel) {
    wheel.rotation.z += dt * 0.12;
    // Keep every gondola hanging straight down.
    wheel.traverse((o) => {
      if (o.name === "gondola" && o.parent?.parent) o.rotation.z = -(o.parent.parent.rotation.z + wheel.rotation.z);
    });
  }
  if (carousel) carousel.rotation.y += dt * 0.6;
}

/** Cinema: tall windowless auditorium, glass foyer, marquee sign and posters. */
export function Cinema() {
  const a = useAssets();
  return (
    <group>
      <Box m={a.cinemaWall} w={18} d={13} y1={11} x={0} z={2.5} />
      <Box m={a.concrete} w={18.4} d={13.4} y0={11} y1={11.5} x={0} z={2.5} />
      {/* Foyer with glass front. */}
      <Box m={a.glass} w={14} d={5} y1={5} z={-6.5} />
      <Box m={a.concrete} w={15} d={6} y0={5} y1={5.5} z={-6.5} />
      {/* Marquee with the name and poster cases. */}
      <mesh geometry={a.box} material={a.signCinema} position={[0, 6.2, -9.4]} scale={[10, 2, 0.4]} castShadow />
      {[-6.5, 6.5].map((x) => (
        <Box key={x} m={a.poster} w={1.6} d={0.15} y0={0.8} y1={3.4} x={x} z={-9.1} />
      ))}
    </group>
  );
}

/**
 * One building. Memoised: a new or changed building must not re-render all the others
 * (the whole town took ~40 ms per growth step, a visible hitch every game tick).
 */
const SingleBuilding = memo(function SingleBuilding({ b, grid }: { b: Building; grid: DepthGrid }) {
  const y = useMemo(() => buildingGround(b, grid), [b, grid]);
  const style = useCity((s) => s.houseStyle);
  if (b.kind === "farm") return <Farm b={b} grid={grid} y={y} />;
  if (b.kind === "sheepfarm") return <SheepFarm b={b} grid={grid} y={y} />;
  if (b.kind === "airport") return <Airport b={b} grid={grid} y={y} />;
  if (b.kind === "boathouse") return <BoathouseScene b={b} grid={grid} y={y} />;
  // City Pack style: factories, bakery and butcher from the Kenney kits (classic while they load).
  const pack = style === "pack" && !!PACK_SPECS[b.kind];
  const landmark = style === "pack" && (b.kind === "bank" || b.kind === "townhall" || b.kind === "church");
  const classic = (
    <>
      {b.kind === "church" && <Church />}
      {b.kind === "bakery" && <Bakery level={b.level} />}
      {b.kind === "waterworks" && <Waterworks level={b.level} />}
      {b.kind === "hospital" && <Hospital />}
      {b.kind === "mill" && <Mill level={b.level} />}
      {b.kind === "school" && <School level={b.level} />}
      {b.kind === "steelworks" && <Steelworks />}
      {b.kind === "sawmill" && <Sawmill level={b.level} />}
      {b.kind === "furniture" && <FurnitureFactory level={b.level} />}
      {b.kind === "furniturestore" && <FurnitureStore level={b.level} />}
      {b.kind === "slaughterhouse" && <Slaughterhouse level={b.level} />}
      {b.kind === "butcher" && <Butcher level={b.level} />}
      {b.kind === "restaurant" && <Restaurant />}
      {b.kind === "cinema" && <Cinema />}
      {b.kind === "bank" && <Bank />}
      {b.kind === "exchange" && <Exchange />}
      {b.kind === "pool" && <Pool />}
      {b.kind === "tannery" && <Tannery />}
      {b.kind === "rubberfactory" && <RubberFactory />}
      {b.kind === "shoefactory" && <ShoeFactory level={b.level} />}
      {b.kind === "shoeshop" && <ShoeShop />}
      {b.kind === "spinning" && <Spinning level={b.level} />}
      {b.kind === "clothing" && <ClothingFactory level={b.level} />}
      {b.kind === "fashion" && <FashionShop />}
      {b.kind === "chickenfarm" && <ChickenFarm />}
      {b.kind === "trader" && <Trader level={b.level} />}
      {b.kind === "foodfactory" && <FoodFactory level={b.level} />}
      {b.kind === "discounter" && <Discounter />}
      {b.kind === "fair" && <Fair />}
      {b.kind === "casino" && <Casino />}
      {b.kind === "pizzeria" && <Pizzeria />}
      {b.kind === "newspaper" && <NewspaperHouse />}
      {b.kind === "townhall" && <TownHall />}
      {b.kind === "taxoffice" && <TaxOffice />}
      {b.kind === "jobcenter" && <JobCentre level={b.level} />}
      {b.kind === "ruin" && <Ruin />}
      {b.kind === "prison" && <Prison level={b.level} />}
      {b.kind === "trainstation" && <TrainStation level={b.level} />}
      {b.kind === "traindepot" && <TrainDepot level={b.level} />}
      {b.kind === "police" && <PoliceStation level={b.level} />}
      {b.kind === "firestation" && <FireStation level={b.level} />}
      {b.kind === "park" && <Park level={b.level} />}
      {b.kind === "recycling" && <RecyclingYard level={b.level} />}
      {b.kind === "goldsmelter" && <GoldSmelter level={b.level} />}
      {b.kind === "jeweller" && <Jeweller level={b.level} />}
      {b.kind === "playground" && <Playground level={b.level} />}
      {b.kind === "warehouse" && <Warehouse level={b.level} />}
      {b.kind === "harbour" && <Harbour />}
      {b.kind === "powerplant" && <PowerPlant level={b.level} />}
      {b.kind === "transformer" && <Transformer level={b.level} />}
      {(b.kind === "coalmine" || b.kind === "ironmine" || b.kind === "uraniummine" || b.kind === "goldmine") && <Mine kind={b.kind} />}
    </>
  );
  return (
    <group position={[b.x, y, b.z]} rotation={[0, b.rot, 0]} userData={GROUNDED}>
      {b.kind === "villa" ? (
        // Kenney kit parts: a stone base stands in while they load.
        <Suspense fallback={<VillaPlaceholder />}>
          <Villa level={b.level} />
        </Suspense>
      ) : landmark ? (
        <Suspense fallback={classic}>{b.kind === "bank" ? <PackBank /> : b.kind === "church" ? <PackChurch /> : <PackTownHall />}</Suspense>
      ) : pack ? (
        <Suspense fallback={classic}>
          <PackBuilding b={b} />
        </Suspense>
      ) : (
        classic
      )}
    </group>
  );
});

function VillaPlaceholder() {
  const a = useAssets();
  return <Box m={a.concrete} w={56} d={48} y0={-14} y1={0.05} />;
}

function SelectionRing({ b, grid }: { b: Building; grid: DepthGrid }) {
  const a = useAssets();
  const y = useMemo(() => buildingGround(b, grid), [b, grid]);
  const [w, d] = sizeOf(b);
  const r = Math.hypot(w, d) / 2 + 2;
  return (
    <mesh position={[b.x, y + 0.3, b.z]} rotation={[-Math.PI / 2, 0, 0]} material={a.ring} renderOrder={4}>
      <ringGeometry args={[r, r + 1.2, 64]} />
    </mesh>
  );
}

/** All buildings of the world. */
export function Buildings() {
  const buildings = useCity((s) => s.buildings);
  const selected = useCity((s) => s.selected);
  const houseStyle = useCity((s) => s.houseStyle);
  // City Pack style: classic models (church, bank, town hall, farms …) lose their photo detail.
  useEffect(() => {
    setPhotoFlat(houseStyle === "pack");
    setRoadPack(houseStyle === "pack");
  }, [houseStyle]);
  const grid = useDepthGrid();
  const houses = useMemo(() => buildings.filter((b) => b.kind === "house"), [buildings]);
  const others = useMemo(() => buildings.filter((b) => b.kind !== "house"), [buildings]);
  const sel = buildings.find((b) => b.id === selected);
  const root = useRef<THREE.Group>(null);
  return (
    <>
      <group ref={root}>
        <Suspense fallback={null}>
          <Gardens houses={houses} grid={grid} />
        </Suspense>
        {houseStyle === "pack" ? (
          // The models load in the background; until then the box houses stand in.
          <Suspense fallback={<Houses houses={houses} grid={grid} />}>
            <HousePack houses={houses} grid={grid} />
          </Suspense>
        ) : (
          <Houses houses={houses} grid={grid} />
        )}
        {others.map((b) => (
          <SingleBuilding key={b.id} b={b} grid={grid} />
        ))}
      </group>
      <GroundShadows root={root} version={buildings} />
      {/* Static parts of all single buildings, merged per material (StaticBatcher.tsx). */}
      <StaticBatches scene={root} version={buildings} />
      {sel && <SelectionRing b={sel} grid={grid} />}
    </>
  );
}
