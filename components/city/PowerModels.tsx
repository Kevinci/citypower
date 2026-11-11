import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { photoMaterial, withPhoto } from "./photoMaterial";

/**
 * Models of the electricity chain: power station (hydro / coal / nuclear by level),
 * transformer station (grows with its level) and mines (coal, iron ore, uranium).
 * Local frame as for all buildings: front (road side) towards −z, ground at y = 0.
 * The cable terminal (feedPoint in power.ts) is kept free: PowerLines puts a pylon there.
 */

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Industrial hall facade: brick with tall steel windows (repeat along the wall). */
function hallTexture() {
  return canvasTexture(128, 128, (g) => {
    g.fillStyle = "#94503a";
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = "rgba(0,0,0,0.12)";
    for (let y = 0; y < 128; y += 4) g.fillRect(0, y, 128, 1);
    g.fillStyle = "#2d3b45";
    g.fillRect(40, 14, 48, 96);
    g.fillStyle = "#6f7a82";
    for (let y = 14; y <= 110; y += 16) g.fillRect(40, y, 48, 2);
    for (const x of [40, 56, 72, 86]) g.fillRect(x, 14, 2, 96);
    g.fillStyle = "#c9b48f";
    g.fillRect(36, 110, 56, 5);
  });
}

/** Concrete with formwork joints and stains. */
function concreteTexture() {
  return canvasTexture(128, 128, (g) => {
    const img = g.createImageData(128, 128);
    let s = 9;
    for (let i = 0; i < 128 * 128; i++) {
      s = (s * 16807) % 2147483647;
      const n = 196 + ((s / 2147483647) - 0.5) * 22;
      img.data[i * 4] = n;
      img.data[i * 4 + 1] = n - 2;
      img.data[i * 4 + 2] = n - 6;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = "rgba(60,60,60,0.25)";
    for (let y = 0; y < 128; y += 32) g.fillRect(0, y, 128, 1);
    g.fillStyle = "rgba(80,75,70,0.12)";
    for (let x = 6; x < 128; x += 23) g.fillRect(x, 0, 3, 128);
  });
}

/** Red-white striped chimney band texture. */
function chimneyTexture() {
  return canvasTexture(16, 128, (g) => {
    g.fillStyle = "#a33a2a";
    g.fillRect(0, 0, 16, 128);
    g.fillStyle = "#efeae2";
    for (let y = 0; y < 128; y += 32) g.fillRect(0, y, 16, 12);
  });
}

let mats: ReturnType<typeof createMaterials> | null = null;
function createMaterials() {
  const concreteMap = concreteTexture();
  const hallMap = hallTexture();
  return {
    concrete: withPhoto(new THREE.MeshStandardMaterial({ map: concreteMap, roughness: 0.9 }), { texture: "concrete_wall_008", tile: 3, mode: "grain", strength: 0.6 }),
    tower: withPhoto(new THREE.MeshStandardMaterial({ map: concreteMap, color: "#e2ded6", roughness: 0.92, side: THREE.DoubleSide }), { texture: "concrete_wall_008", tile: 4, mode: "grain", strength: 0.6 }),
    hall: withPhoto(new THREE.MeshStandardMaterial({ map: hallMap, roughness: 0.85 }), { texture: "red_brick_03", tile: 1.6, mode: "grain", strength: 0.7 }),
    roof: photoMaterial({ texture: "corrugated_iron_02", tile: 2, mode: "grain", strength: 0.7, color: "#4d555b", roughness: 0.7, metalness: 0.2 }),
    steel: photoMaterial({ texture: "metal_plate", tile: 2.5, mode: "grain", strength: 0.5, color: "#7d878e", roughness: 0.45, metalness: 0.7 }),
    blue: new THREE.MeshStandardMaterial({ color: "#2f5f8a", roughness: 0.5, metalness: 0.4 }),
    green: new THREE.MeshStandardMaterial({ color: "#56705a", roughness: 0.6, metalness: 0.3 }),
    gravel: photoMaterial({ texture: "gravel_floor", tile: 2.5, color: "#d2cec6", roughness: 1 }),
    chimney: new THREE.MeshStandardMaterial({ map: chimneyTexture(), roughness: 0.8 }),
    coal: new THREE.MeshStandardMaterial({ color: "#1b1b1c", roughness: 0.95, flatShading: true }),
    ore: new THREE.MeshStandardMaterial({ color: "#7e4430", roughness: 0.95, flatShading: true }),
    goldOre: new THREE.MeshStandardMaterial({ color: "#8a7a52", roughness: 0.75, metalness: 0.35, flatShading: true }),
    yellowcake: new THREE.MeshStandardMaterial({ color: "#c7bf6a", roughness: 0.9, flatShading: true }),
    barrel: new THREE.MeshStandardMaterial({ color: "#e0b81f", roughness: 0.5, metalness: 0.3 }),
    brick: withPhoto(new THREE.MeshStandardMaterial({ map: hallMap, color: "#d9c7bd", roughness: 0.9 }), { texture: "red_brick_03", tile: 1.6, mode: "grain", strength: 0.8 }),
    water: new THREE.MeshStandardMaterial({ color: "#2f6f86", roughness: 0.15 }),
    steam: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, transparent: true, opacity: 0.7, depthWrite: false }),
    fence: new THREE.MeshStandardMaterial({ color: "#9aa3a8", roughness: 0.6, metalness: 0.5, transparent: true, opacity: 0.55 }),
    warn: new THREE.MeshStandardMaterial({ color: "#f2c230", roughness: 0.6 }),
    dome: photoMaterial({ texture: "concrete_wall_008", tile: 4, mode: "grain", strength: 0.5, color: "#d9d6cf", roughness: 0.6 }),
  };
}
const useMats = () => (mats ??= createMaterials());

const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

function Block({ m, x = 0, z = 0, y0 = 0, w, d, h, rotY = 0 }: { m: THREE.Material; x?: number; z?: number; y0?: number; w: number; d: number; h: number; rotY?: number }) {
  return <mesh geometry={unitBox} material={m} position={[x, y0, z]} scale={[w, h, d]} rotation={[0, rotY, 0]} castShadow receiveShadow />;
}

/** Hyperbolic cooling tower (radius at the base, total height). */
function coolingTowerGeometry(r: number, h: number) {
  const pts: THREE.Vector2[] = [];
  const throatY = h * 0.75;
  const throat = r * 0.62;
  const c = throatY / Math.sqrt((r / throat) ** 2 - 1);
  for (let i = 0; i <= 24; i++) {
    const y = (h * i) / 24;
    pts.push(new THREE.Vector2(throat * Math.sqrt(1 + ((y - throatY) / c) ** 2), y));
  }
  return new THREE.LatheGeometry(pts, 40);
}
const towerCache = new Map<string, THREE.BufferGeometry>();
const towerGeometry = (r: number, h: number) => {
  const k = `${r}:${h}`;
  if (!towerCache.has(k)) towerCache.set(k, coolingTowerGeometry(r, h));
  return towerCache.get(k)!;
};

/** Slowly rising steam puffs. */
function Steam({ x, y, z, size }: { x: number; y: number; z: number; size: number }) {
  const m = useMats();
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    g.children.forEach((c, i) => {
      const t = (clock.elapsedTime * 0.12 + i / g.children.length) % 1;
      c.position.set(Math.sin(i * 2.1) * size * 0.25 + t * size * 0.8, t * size * 2.6, Math.cos(i * 1.7) * size * 0.25);
      c.scale.setScalar(size * (0.55 + t * 0.9));
    });
  });
  return (
    <group ref={group} position={[x, y, z]}>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} material={m.steam}>
          <sphereGeometry args={[1, 12, 10]} />
        </mesh>
      ))}
    </group>
  );
}

function CoolingTower({ x, z, r, h }: { x: number; z: number; r: number; h: number }) {
  const m = useMats();
  return (
    <group position={[x, 0, z]}>
      <mesh geometry={towerGeometry(r, h)} material={m.tower} castShadow receiveShadow />
      <mesh position={[0, 0.6, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.water}>
        <circleGeometry args={[r * 0.95, 32]} />
      </mesh>
      <Steam x={0} y={h} z={0} size={r * 0.55} />
    </group>
  );
}

/** Switchyard next to the line terminal (front left): transformers, busbar gantries. */
function Switchyard() {
  const m = useMats();
  return (
    <group>
      <Block m={m.gravel} x={-14} z={-9} w={16} d={13} h={0.12} />
      {[-19, -9].map((x) => (
        <group key={x}>
          <Block m={m.green} x={x} z={-3.5} w={3.2} d={2.4} h={3} />
          {[-0.8, 0, 0.8].map((dx) => (
            <mesh key={dx} position={[x + dx, 3.6, -3.5]} material={m.steel} castShadow>
              <cylinderGeometry args={[0.18, 0.18, 1.4, 6]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* Busbar gantry from the terminal to the transformers. */}
      {[-20, -10].map((x) => (
        <Block key={x} m={m.steel} x={x} z={-14} w={0.35} d={0.35} h={9} />
      ))}
      <Block m={m.steel} x={-15} z={-14} y0={8.6} w={10.4} d={0.3} h={0.4} />
      {/* Fence around the yard. */}
      <Block m={m.fence} x={-14} z={-15.6} w={16} d={0.08} h={2.2} />
      <Block m={m.fence} x={-6.1} z={-9} w={0.08} d={13} h={2.2} />
    </group>
  );
}

/** Turbine hall: long brick hall with a shallow roof and a crane rail on top. */
function TurbineHall({ x, z, w, d, h }: { x: number; z: number; w: number; d: number; h: number }) {
  const m = useMats();
  return (
    <group position={[x, 0, z]}>
      <Block m={m.hall} w={w} d={d} h={h} />
      <Block m={m.roof} y0={h} w={w + 0.6} d={d + 0.6} h={0.6} />
      <Block m={m.roof} y0={h + 0.6} w={w * 0.6} d={d * 0.35} h={1.2} />
    </group>
  );
}

/** Reactor buildings (cylinder with dome) in a row; more units get smaller and closer. */
const REACTOR_LAYOUT: Record<number, { x: number[]; r: number }> = {
  1: { x: [12], r: 7 },
  2: { x: [6.5, 16.8], r: 5.2 },
  3: { x: [3, 11.4, 19.2], r: 3.9 },
};

function NuclearPlant({ reactors }: { reactors: number }) {
  const m = useMats();
  const layout = REACTOR_LAYOUT[Math.min(3, reactors)];
  const h = 7 + layout.r;
  return (
    <group>
      <TurbineHall x={8} z={-10} w={22} d={10} h={10} />
      {layout.x.map((x) => (
        <group key={x} position={[x, 0, 6]}>
          <mesh position={[0, h / 2, 0]} material={m.dome} castShadow receiveShadow>
            <cylinderGeometry args={[layout.r, layout.r, h, 32]} />
          </mesh>
          <mesh position={[0, h, 0]} material={m.dome} castShadow>
            <sphereGeometry args={[layout.r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
        </group>
      ))}
      {reactors === 1 && <Block m={m.concrete} x={2} z={8} w={6} d={10} h={9} />}
      {/* One cooling tower; it grows taller with every unit. */}
      <CoolingTower x={reactors >= 3 ? -12.5 : -11} z={7} r={reactors >= 3 ? 8.6 : 9.5} h={36 + (reactors - 1) * 8} />
      {/* Radiation warning stripes on the fence of the reactor area. */}
      <Block m={m.warn} x={12} z={-2.2} w={20} d={0.1} h={0.5} y0={1.2} />
    </group>
  );
}

export function PowerPlant({ level }: { level: number }) {
  const m = useMats();
  return (
    <group>
      <Block m={m.concrete} w={44} d={32} h={0.1} />
      <Switchyard />
      {level === 1 && (
        <group>
          <TurbineHall x={8} z={-2} w={24} d={14} h={11} />
          {/* Penstocks from the intake at the back (canal side) into the hall. */}
          {[2, 8, 14].map((px) => (
            <mesh key={px} position={[px, 1.8, 10]} rotation={[Math.PI / 2, 0, 0]} material={m.steel} castShadow>
              <cylinderGeometry args={[1.1, 1.1, 10, 16]} />
            </mesh>
          ))}
          {/* Intake structure with sluice gates. */}
          <Block m={m.concrete} x={8} z={15} w={22} d={2} h={6} />
          {[2, 8, 14].map((px) => (
            <Block key={px} m={m.blue} x={px} z={13.9} y0={1} w={3} d={0.3} h={4.5} />
          ))}
          <Block m={m.steel} x={8} z={15} y0={6} w={22} d={1} h={0.4} />
        </group>
      )}
      {level === 2 && (
        <group>
          <TurbineHall x={6} z={-8} w={22} d={12} h={11} />
          {/* Boiler house, chimney, coal yard with conveyor. */}
          <Block m={m.concrete} x={8} z={5} w={14} d={12} h={26} />
          <Block m={m.roof} x={8} z={5} y0={26} w={14.4} d={12.4} h={0.6} />
          <mesh position={[18, 24, 10]} material={m.chimney} castShadow>
            <cylinderGeometry args={[1.3, 2.1, 48, 20]} />
          </mesh>
          <CoolingTower x={-12} z={7} r={8.5} h={28} />
          <mesh position={[18.5, 0, -9]} material={m.coal} castShadow receiveShadow>
            <coneGeometry args={[4.5, 4, 9]} />
          </mesh>
          <mesh position={[16, 9, -2]} rotation={[0.9, 0, 0]} material={m.steel} castShadow>
            <boxGeometry args={[1.2, 1, 16]} />
          </mesh>
        </group>
      )}
      {level >= 3 && <NuclearPlant reactors={level - 2} />}
    </group>
  );
}

/** Transformer station: terminal pylon in front (from PowerLines), transformers, brick hut. */
export function Transformer({ level }: { level: number }) {
  const m = useMats();
  const units = level === 1 ? [0] : level === 2 ? [-2.6, 2.6] : [-4, 0, 4];
  return (
    <group>
      <Block m={m.gravel} w={12} d={10} h={0.1} />
      {units.map((x) => (
        <group key={x} position={[x, 0, 2.2]}>
          <Block m={m.green} w={2} d={1.6} h={2.2} />
          {[-0.5, 0.5].map((dx) => (
            <mesh key={dx} position={[dx, 2.7, 0]} material={m.steel} castShadow>
              <cylinderGeometry args={[0.12, 0.12, 1, 6]} />
            </mesh>
          ))}
        </group>
      ))}
      <Block m={m.brick} x={level >= 3 ? 0 : 3.5} z={4} w={level >= 3 ? 10 : 4} d={1.8} h={3} />
      <Block m={m.roof} x={level >= 3 ? 0 : 3.5} z={4} y0={3} w={level >= 3 ? 10.4 : 4.4} d={2.2} h={0.25} />
      {/* Fence with a warning sign. */}
      <Block m={m.fence} z={-4.9} w={12} d={0.08} h={2} />
      <Block m={m.fence} z={4.95} w={12} d={0.08} h={2} />
      <Block m={m.fence} x={-5.95} w={0.08} d={10} h={2} />
      <Block m={m.fence} x={5.95} w={0.08} d={10} h={2} />
      <Block m={m.warn} x={3} z={-5} y0={0.8} w={0.8} d={0.06} h={0.8} />
    </group>
  );
}

/** Mine: headframe with sheave wheels, winding house, spoil/ore heap, foundation for slopes. */
export function Mine({ kind }: { kind: "coalmine" | "ironmine" | "uraniummine" | "goldmine" }) {
  const m = useMats();
  const heap = kind === "coalmine" ? m.coal : kind === "ironmine" ? m.ore : kind === "goldmine" ? m.goldOre : m.yellowcake;
  return (
    <group>
      {/* Foundation: mines stand on mountain slopes. */}
      <Block m={m.concrete} y0={-10} w={30} d={24} h={10.15} />
      {/* Headframe: four-legged steel tower with an inclined strut and two wheels. */}
      <group position={[6, 0, 2]}>
        {[-1.6, 1.6].flatMap((x) =>
          [-1.6, 1.6].map((z) => <Block key={`${x}${z}`} m={m.steel} x={x} z={z} w={0.45} d={0.45} h={20} />),
        )}
        {[5, 10, 15, 20].map((y) => (
          <Block key={y} m={m.steel} y0={y - 0.3} w={3.8} d={3.8} h={0.3} />
        ))}
        <mesh position={[0, 10.5, 5.5]} rotation={[-0.55, 0, 0]} material={m.steel} castShadow>
          <boxGeometry args={[0.5, 23, 0.5]} />
        </mesh>
        {[-0.9, 0.9].map((x) => (
          <mesh key={x} position={[x, 21.2, 0]} rotation={[0, Math.PI / 2, 0]} material={m.steel} castShadow>
            <torusGeometry args={[1.5, 0.15, 6, 20]} />
          </mesh>
        ))}
      </group>
      {/* Winding house and shaft building. */}
      <Block m={m.brick} x={-6} z={5} w={12} d={9} h={7} />
      <Block m={m.roof} x={-6} z={5} y0={7} w={12.4} d={9.4} h={0.5} />
      <Block m={m.brick} x={6} z={2} w={6} d={6} h={4} />
      {/* Heap of what the mine brings up. */}
      <mesh position={[-7, 0, -6]} material={heap} castShadow receiveShadow>
        <coneGeometry args={[5, 4.5, 10]} />
      </mesh>
      {kind === "uraniummine" &&
        [0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[2 + i * 1.3, 0.6, -8]} material={m.barrel} castShadow>
            <cylinderGeometry args={[0.45, 0.45, 1.2, 12]} />
          </mesh>
        ))}
      {/* Mine car track. */}
      <Block m={m.steel} x={0} z={-3} w={18} d={0.2} h={0.15} />
      <Block m={m.steel} x={0} z={-2} w={18} d={0.2} h={0.15} />
    </group>
  );
}
