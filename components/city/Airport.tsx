import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { sizeOf, type Building } from "@/lib/city/economy";
import { NIGHT } from "@/lib/city/night";
import { useCity } from "@/lib/city/store";
import type { DepthGrid } from "@/lib/city/terrain";
import { windowGlow } from "./nightGlow";

/**
 * Airport in three levels: Flugplatz (grass strip, hangar, small planes), Regionalflughafen
 * (asphalt runway, terminal, tower, cargo hall, jets) and Flughafen (long runway, big terminal
 * with jet bridges, hotel, cargo centre, wide-bodies).
 *
 * Local layout: x runs along the road (and the runway), the road is at −z (front). The terrain
 * under the plot is levelled (hills cut, hollows filled, 1 : 1.5 slopes around, see
 * `levelPads`), so the airfield lies on the natural grass. Planes fly a fixed real-time schedule (stopped while paused
 * or while the airport is shut down): push back, taxi, take off towards +x, climb out of
 * sight, come back on the approach from −x, land, taxi to their stand.
 */

/* ---------- materials and shared geometry ---------- */

let assets: ReturnType<typeof createAssets> | null = null;

/**
 * Clean, saturated, faceted materials inspired by Kenney's modular low-poly kits.
 * Keep these as shared materials: the airport contains many repeated small meshes.
 */
function createAssets() {
    const m = (color: string, roughness = 0.82, metalness = 0) =>
        new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });

    return {
        box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
        // Ground and airfield.
        mown: m("#78a94b"),
        asphalt: m("#626d78"),
        apron: m("#aeb8bd"),
        white: m("#f4f2e8"),
        yellow: m("#f4c542"),
        grassDark: m("#56863b"),
        concrete: m("#e7e5dc"),
        concreteShade: m("#c9d0d0"),
        // Terminal, tower cab and jet-bridge glass: most panes lit at night.
        glass: windowGlow(m("#68b6cc", 0.28, 0.08), "kit", 0.85),
        // Terminal window bands, hotel and car-park floors: many lit at night.
        darkGlass: windowGlow(m("#24495d", 0.3, 0.08), "slate", 0.7),
        glassLight: windowGlow(m("#a8e0e8", 0.25, 0.05), "kit", 0.85),
        hall: m("#d7e0e2"),
        cladBlue: m("#4387b5"),
        steel: m("#667783", 0.55, 0.15),
        roof: m("#3e596b"),
        roofLight: m("#59788a"),
        accent: m("#f2b544"),
        red: m("#d84a43"),
        orange: m("#ee8738"),
        green: m("#5d9b61"),
        dark: m("#34434b"),
        // Plane materials retained for the existing aircraft models.
        hull: m("#f4f5f7", 0.42, 0.08),
        hullGrey: m("#cfd5d8", 0.45, 0.08),
        tailBlue: m("#2876b7", 0.45, 0.08),
        tailOrange: m("#e07a32", 0.45, 0.08),
        windows: m("#1d3444", 0.35, 0.08),
        engine: m("#89969d", 0.5, 0.2),
        prop: m("#29343a", 0.7),
    };
}
function useAssets() {
    assets ??= createAssets();
    return assets;
}

function Box({ m, x = 0, z = 0, w, d, y0 = 0, y1 }: { m: THREE.Material; x?: number; z?: number; w: number; d: number; y0?: number; y1: number }) {
    const a = useAssets();
    return <mesh geometry={a.box} material={m} position={[x, y0, z]} scale={[w, y1 - y0, d]} castShadow receiveShadow />;
}

/** Flat boxes (markings) merged into one geometry: [x, z, w, d] in local metres. */
function flatBoxes(rects: [number, number, number, number][], y0: number, y1: number) {
    if (rects.length === 0) return null;
    const parts = rects.map(([x, z, w, d]) => new THREE.BoxGeometry(w, y1 - y0, d).translate(x, (y0 + y1) / 2, z));
    const merged = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    return merged;
}

/* ---------- layout per level ---------- */

export interface AirportLayout {
    w: number;
    d: number;
    /** Runway: centre line z, width, start and end x (take-off towards +x). */
    runwayZ: number;
    runwayW: number;
    x0: number;
    x1: number;
    grass: boolean;
    /** Parallel taxiway z (grass track at level 1). */
    taxiZ: number;
    taxiW: number;
    /** Apron band z range. */
    apron: [number, number];
    apronX: [number, number];
}

export function airportLayout(level: number): AirportLayout {
    const [w, d] = sizeOf({ kind: "airport", level });
    const front = -d / 2;
    // Same plot at every level (380 × 130 m): buildings at the road, apron, taxiway, runway at the back.
    if (level <= 1)
        return { w, d, runwayZ: d / 2 - 25, runwayW: 20, x0: -w / 2 + 60, x1: w / 2 - 20, grass: true, taxiZ: front + 77, taxiW: 0, apron: [front + 25, front + 51], apronX: [-w / 2 + 10, -w / 2 + 120] };
    if (level === 2)
        return { w, d, runwayZ: d / 2 - 23, runwayW: 30, x0: -w / 2 + 10, x1: w / 2 - 10, grass: false, taxiZ: front + 77, taxiW: 12, apron: [front + 27, front + 69], apronX: [-w / 2 + 10, w / 2 - 10] };
    return { w, d, runwayZ: d / 2 - 21, runwayW: 36, x0: -w / 2 + 10, x1: w / 2 - 10, grass: false, taxiZ: front + 77, taxiW: 14, apron: [front + 27, front + 69], apronX: [-w / 2 + 10, w / 2 - 10] };
}

/* ---------- planes ---------- */

export type PlaneType = "prop" | "jet" | "wide" | "cargo";

const PLANE: Record<PlaneType, { length: number; span: number; radius: number; gear: number; tail: "tailBlue" | "tailOrange"; low: boolean; engines: number }> = {
    prop: { length: 8.5, span: 11, radius: 0.65, gear: 0.9, tail: "tailBlue", low: false, engines: 0 },
    jet: { length: 30, span: 28, radius: 1.9, gear: 1.6, tail: "tailBlue", low: true, engines: 2 },
    wide: { length: 42, span: 40, radius: 2.9, gear: 2.2, tail: "tailBlue", low: true, engines: 2 },
    cargo: { length: 36, span: 34, radius: 2.4, gear: 1.9, tail: "tailOrange", low: true, engines: 4 },
};

/** One plane along +x (nose), wheels at y = 0. Made of a few primitive meshes. */
export function PlaneModel({ type }: { type: PlaneType }) {
    const a = useAssets();
    const p = PLANE[type];
    const r = p.radius;
    const body = p.length * 0.72;
    const y = p.gear + r;
    const wingY = p.low ? y - r * 0.55 : y + r * 0.8;
    const wingX = p.low ? -p.length * 0.04 : p.length * 0.05;
    const chord = Math.max(1.4, p.length * 0.16);
    const sweep = p.low ? 0.45 : 0;
    const hull = type === "cargo" ? a.hullGrey : a.hull;
    return (
        <group>
            {/* Fuselage, nose and tail cone. */}
            <mesh position={[0, y, 0]} rotation={[0, 0, Math.PI / 2]} material={hull} castShadow>
                <cylinderGeometry args={[r, r, body, 16]} />
            </mesh>
            <mesh position={[body / 2, y, 0]} scale={[p.length * 0.12, r, r]} material={hull} castShadow>
                <sphereGeometry args={[1, 16, 10, 0, Math.PI * 2, 0, Math.PI]} />
            </mesh>
            <mesh position={[-body / 2 - p.length * 0.08, y + r * 0.35, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.9]} material={hull} castShadow>
                <cylinderGeometry args={[r * 0.35, r, p.length * 0.16, 16]} />
            </mesh>
            {/* Window band and cockpit (no windows on freighters except the cockpit). */}
            {type !== "cargo" &&
                [-1, 1].map((s) => (
                    <mesh key={s} geometry={a.box} material={a.windows} position={[0, y + r * 0.2, s * r * 0.97]} scale={[body * 0.85, r * 0.18, 0.08]} />
                ))}
            <mesh geometry={a.box} material={a.windows} position={[body / 2 + p.length * 0.05, y + r * 0.35, 0]} scale={[p.length * 0.05, r * 0.3, r * 1.3]} rotation={[0, 0, -0.5]} />
            {/* Wings (swept for jets) and tailplane. */}
            {[-1, 1].map((s) => (
                <mesh
                    key={s}
                    geometry={a.box}
                    material={hull}
                    position={[wingX - (p.span / 4) * Math.sin(sweep), wingY, (s * p.span) / 4]}
                    rotation={[0, -s * sweep, 0]}
                    scale={[chord, 0.25 + r * 0.06, p.span / 2]}
                    castShadow
                />
            ))}
            {[-1, 1].map((s) => (
                <mesh
                    key={s}
                    geometry={a.box}
                    material={hull}
                    position={[-body / 2 - p.length * 0.1 - (p.span / 9) * Math.sin(sweep), y + r * 0.5, (s * p.span) / 9]}
                    rotation={[0, -s * sweep, 0]}
                    scale={[chord * 0.55, 0.18, p.span / 4.5]}
                    castShadow
                />
            ))}
            {/* Fin in the livery colour. */}
            <mesh
                geometry={a.box}
                material={a[p.tail]}
                position={[-body / 2 - p.length * 0.08, y + r * 0.6, 0]}
                rotation={[0, 0, sweep * 0.9]}
                scale={[chord * 0.75, p.length * 0.2, 0.25 + r * 0.05]}
                castShadow
            />
            {/* Engines under the wings, or a propeller at the nose. */}
            {p.engines > 0 &&
                Array.from({ length: p.engines }, (_, i) => {
                    const side = i % 2 ? 1 : -1;
                    const k = p.engines === 4 ? (i < 2 ? 0.2 : 0.38) : 0.28;
                    const z = side * p.span * k;
                    const x = wingX + chord * 0.55 - Math.abs(z) * Math.tan(sweep) * 0.9;
                    return (
                        <mesh key={i} position={[x, wingY - r * 0.45, z]} rotation={[0, 0, Math.PI / 2]} material={a.engine} castShadow>
                            <cylinderGeometry args={[r * 0.42, r * 0.36, chord * 0.9, 12]} />
                        </mesh>
                    );
                })}
            {type === "prop" && <mesh geometry={a.box} material={a.prop} position={[body / 2 + p.length * 0.12, y, 0]} scale={[0.08, 2.2, 0.18]} />}
            {/* Navigation lights: red on the left wing tip (−z, nose +x), green on the right, white strobes on tail and belly. */}
            {[-1, 1].map((s) => (
                <mesh
                    key={`nav${s}`}
                    geometry={NAV_LAMP}
                    material={s < 0 ? LIGHT.navRed : LIGHT.navGreen}
                    position={[wingX - (p.span / 2) * Math.sin(sweep) * 0.95, wingY + 0.2, (s * p.span) / 2]}
                    scale={0.25 + r * 0.12}
                />
            ))}
            <mesh geometry={NAV_LAMP} material={LIGHT.strobe} position={[-body / 2 - p.length * 0.17, y + r * 0.35, 0]} scale={0.3 + r * 0.12} />
            <mesh geometry={NAV_LAMP} material={LIGHT.beacon} position={[0, y + r + 0.15, 0]} scale={0.3 + r * 0.12} />
            <mesh geometry={NAV_LAMP} material={LIGHT.beacon} position={[0, y - r - 0.15, 0]} scale={0.3 + r * 0.12} />
            {/* Landing gear. */}
            {[
                [body * 0.38, 0],
                [wingX - chord * 0.2, r * 0.8],
                [wingX - chord * 0.2, -r * 0.8],
            ].map(([x, z], i) => (
                <mesh key={i} geometry={a.box} material={a.prop} position={[x, 0, z]} scale={[0.5 + r * 0.15, p.gear + 0.2, 0.3 + r * 0.1]} />
            ))}
        </group>
    );
}

/** Seconds of each part of a flight cycle (real time, so it looks the same at every speed). */
const T = { push: 5, taxiOut: 18, roll: 8, climb: 24, away: 60, approach: 26, rollout: 8, taxiIn: 18 };
const CYCLE = 240;
const ACTIVE = T.push + T.taxiOut + T.roll + T.climb + T.away + T.approach + T.rollout + T.taxiIn;
const CLIMB_DISTANCE = 2300;
const CLIMB_HEIGHT = 280;
const APPROACH_DISTANCE = 2400;
const APPROACH_HEIGHT = 150;

interface Flight {
    type: PlaneType;
    /** Stand on the apron (nose towards the terminal, −z). */
    sx: number;
    sz: number;
    /** Start of its cycle (s). */
    offset: number;
}

/** Point at arc length s along a polyline. */
function along(pts: [number, number][], s: number): [number, number] {
    for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[i + 1];
        const l = Math.hypot(bx - ax, bz - az);
        if (s <= l || i === pts.length - 2) {
            const t = l > 0 ? Math.min(1, s / l) : 1;
            return [ax + (bx - ax) * t, az + (bz - az) * t];
        }
        s -= l;
    }
    return pts[pts.length - 1];
}
const lengthOf = (pts: [number, number][]) => pts.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

/** Moves along a ground path at constant speed, nose along the path (or reversing). */
function groundMove(o: THREE.Object3D, pts: [number, number][], u: number, reverse = false) {
    const len = lengthOf(pts);
    const [x, z] = along(pts, u * len);
    const [ax, az] = along(pts, Math.min(len, u * len + 10));
    const [bx, bz] = along(pts, Math.max(0, u * len - 10));
    const dx = reverse ? bx - ax : ax - bx;
    const dz = reverse ? bz - az : az - bz;
    o.position.set(x, 0, z);
    if (Math.hypot(dx, dz) > 0.01) o.rotation.set(0, Math.atan2(-dz, dx), 0);
}

/** Places a plane for the time `t` (s) of its schedule. */
function fly(o: THREE.Object3D, f: Flight, L: AirportLayout, t: number, length: number) {
    let k = (((t - f.offset) % CYCLE) + CYCLE) % CYCLE;
    o.visible = true;
    o.rotation.order = "YZX";
    const back: [number, number] = [f.sx, f.sz + 14 + length * 0.3];
    const lineUp = L.x0 + 10;
    if (k < CYCLE - ACTIVE) {
        // Parked at the stand.
        o.position.set(f.sx, 0, f.sz);
        o.rotation.set(0, Math.PI / 2, 0);
        return;
    }
    k -= CYCLE - ACTIVE;
    if (k < T.push) return groundMove(o, [[f.sx, f.sz], back], k / T.push, true);
    k -= T.push;
    if (k < T.taxiOut)
        return groundMove(o, [back, [back[0], L.taxiZ], [lineUp, L.taxiZ], [lineUp, L.runwayZ], [lineUp + 1, L.runwayZ]], k / T.taxiOut);
    k -= T.taxiOut;
    const runway = L.x1 - L.x0;
    const liftOff = lineUp + runway * 0.62;
    if (k < T.roll) {
        const u = k / T.roll;
        o.position.set(lineUp + (liftOff - lineUp) * u * u, 0, L.runwayZ);
        o.rotation.set(0, 0, u > 0.85 ? (u - 0.85) * 0.8 : 0);
        return;
    }
    k -= T.roll;
    if (k < T.climb) {
        const u = k / T.climb;
        const x = liftOff + CLIMB_DISTANCE * u * (0.7 + 0.3 * u);
        const y = CLIMB_HEIGHT * Math.pow(u, 1.25);
        const slope = (CLIMB_HEIGHT * 1.25 * Math.pow(Math.max(u, 0.02), 0.25)) / (CLIMB_DISTANCE * (0.7 + 0.6 * u));
        o.position.set(x, y, L.runwayZ);
        o.rotation.set(0, 0, Math.min(0.2, Math.atan(slope) + 0.04));
        return;
    }
    k -= T.climb;
    if (k < T.away) {
        o.visible = false;
        return;
    }
    k -= T.away;
    const touch = L.x0 + 30;
    if (k < T.approach) {
        const u = k / T.approach;
        const x = touch - APPROACH_DISTANCE * (1 - u);
        o.position.set(x, APPROACH_HEIGHT * Math.pow(1 - u, 1.15), L.runwayZ);
        // Slightly nose-up on the glide path, flare at the end.
        o.rotation.set(0, 0, u > 0.9 ? 0.06 : 0.02);
        return;
    }
    k -= T.approach;
    const exit = touch + runway * 0.5;
    if (k < T.rollout) {
        const u = k / T.rollout;
        o.position.set(touch + (exit - touch) * (1 - (1 - u) * (1 - u)), 0, L.runwayZ);
        o.rotation.set(0, 0, 0);
        return;
    }
    k -= T.rollout;
    groundMove(o, [[exit, L.runwayZ], [exit + 1, L.runwayZ], [exit, L.taxiZ], [f.sx, L.taxiZ], [f.sx, f.sz]], Math.min(1, k / T.taxiIn));
}

/** All planes of one airport. */
function Planes({ flights, layout, active }: { flights: Flight[]; layout: AirportLayout; active: boolean }) {
    const refs = useRef<(THREE.Group | null)[]>([]);
    const clock = useRef(0);
    useFrame((_, dt) => {
        const running = active && useCity.getState().speed > 0;
        if (running) clock.current += Math.min(dt, 0.1);
        flights.forEach((f, i) => {
            const o = refs.current[i];
            // Shut down: everyone at the stand; paused: frozen where they are.
            if (o) fly(o, f, layout, active ? clock.current : f.offset, PLANE[f.type].length);
        });
    });
    return (
        <>
            {flights.map((f, i) => (
                <group
                    key={i}
                    ref={(o) => {
                        refs.current[i] = o;
                    }}
                    position={[f.sx, 0, f.sz]}
                    rotation={[0, Math.PI / 2, 0]}
                >
                    <PlaneModel type={f.type} />
                </group>
            ))}
        </>
    );
}

/** Which planes an airport level has and where they park. */
function flightsOf(level: number, L: AirportLayout): Flight[] {
    const stand = (L.apron[0] + L.apron[1]) / 2;
    const list: { type: PlaneType; x: number }[] =
        level <= 1
            ? [
                { type: "prop", x: -160 },
                { type: "prop", x: -135 },
            ]
            : level === 2
                ? [
                    { type: "jet", x: -110 },
                    { type: "jet", x: -60 },
                    { type: "cargo", x: 110 },
                ]
                : [
                    { type: "wide", x: -125 },
                    { type: "jet", x: -80 },
                    { type: "wide", x: -35 },
                    { type: "jet", x: 10 },
                    { type: "cargo", x: 100 },
                    { type: "cargo", x: 150 },
                ];
    return list.map((p, i) => ({ type: p.type, sx: p.x, sz: stand, offset: (i * CYCLE) / list.length + 30 }));
}

/* ---------- ground: platform, runway, buildings ---------- */

function useMarkings(L: AirportLayout) {
    return useMemo(() => {
        const white: [number, number, number, number][] = [];
        const yellow: [number, number, number, number][] = [];
        const len = L.x1 - L.x0;
        if (L.grass) {
            // Grass strip: white edge markers every 30 m.
            for (let x = L.x0; x <= L.x1; x += 30) for (const s of [-1, 1]) white.push([x, L.runwayZ + (s * L.runwayW) / 2, 3, 1]);
        } else {
            // Threshold stripes, centre line dashes, edge lines, touchdown zone, taxiway centre line.
            const stripes = L.runwayW >= 40 ? 12 : 8;
            for (const end of [L.x0 + 8, L.x1 - 8])
                for (let i = 0; i < stripes; i++) white.push([end, L.runwayZ - L.runwayW / 2 + 3 + ((L.runwayW - 6) * (i + 0.5)) / stripes, 22, 1.4]);
            for (let x = L.x0 + 40; x < L.x1 - 40; x += 40) white.push([x + 12, L.runwayZ, 24, 0.9]);
            for (const s of [-1, 1]) white.push([(L.x0 + L.x1) / 2, L.runwayZ + s * (L.runwayW / 2 - 1), len, 0.6]);
            for (const end of [L.x0 + 70, L.x1 - 70]) for (const s of [-1, 1]) white.push([end, L.runwayZ + s * L.runwayW * 0.25, 30, 3]);
            yellow.push([(L.x0 + L.x1) / 2, L.taxiZ, L.x1 - L.x0 - 20, 0.5]);
        }
        return { white: flatBoxes(white, 0.06, 0.1), yellow: flatBoxes(yellow, 0.06, 0.1) };
    }, [L]);
}

function Ground({ L }: { L: AirportLayout }) {
    const a = useAssets();
    const marks = useMarkings(L);
    useEffect(
        () => () => {
            marks.white?.dispose();
            marks.yellow?.dispose();
        },
        [marks],
    );
    const len = L.x1 - L.x0;
    const mid = (L.x0 + L.x1) / 2;
    return (
        <>
            {/* Runway (grass strip or asphalt), taxiway with links to the apron, apron. */}
            <Box m={L.grass ? a.mown : a.asphalt} w={len} d={L.runwayW} y1={0.05} x={mid} z={L.runwayZ} />
            {!L.grass && (
                <>
                    <Box m={a.asphalt} w={len - 20} d={L.taxiW} y1={0.05} x={mid} z={L.taxiZ} />
                    {[L.x0 + 10, mid, L.x1 - 10].map((x) => (
                        <Box key={x} m={a.asphalt} w={L.taxiW} d={Math.abs(L.runwayZ - L.taxiZ)} y1={0.045} x={x} z={(L.runwayZ + L.taxiZ) / 2} />
                    ))}
                    {[L.apronX[0] + 20, L.apronX[1] - 20].map((x) => (
                        <Box key={x} m={a.asphalt} w={L.taxiW} d={Math.abs(L.taxiZ - L.apron[1])} y1={0.045} x={x} z={(L.taxiZ + L.apron[1]) / 2} />
                    ))}
                </>
            )}
            <Box m={a.apron} w={L.apronX[1] - L.apronX[0]} d={L.apron[1] - L.apron[0]} y1={0.06} x={(L.apronX[0] + L.apronX[1]) / 2} z={(L.apron[0] + L.apron[1]) / 2} />
            {marks.white && <mesh geometry={marks.white} material={a.white} receiveShadow />}
            {marks.yellow && <mesh geometry={marks.yellow} material={a.yellow} receiveShadow />}
            {/* Windsock at the runway. */}
            <group position={[L.x0 + 40, 0, L.runwayZ - L.runwayW / 2 - 10]}>
                <Box m={a.steel} w={0.2} d={0.2} y1={6} />
                <mesh position={[1.6, 5.8, 0]} rotation={[0, 0, Math.PI / 2 + 0.25]} material={a.orange} castShadow>
                    <coneGeometry args={[0.5, 3, 10, 1, true]} />
                </mesh>
            </group>
        </>
    );
}

/** Small repeated facade windows keep the architecture readable at game-camera distance. */
function WindowStrip({
                         x, z, width, y, count, depth = 0.22, material,
                     }: {
    x: number; z: number; width: number; y: number; count: number;
    depth?: number; material: THREE.Material;
}) {
    const paneWidth = width / count;
    return (
        <group>
            {Array.from({ length: count }, (_, i) => (
                <Box
                    key={i}
                    m={material}
                    w={Math.max(0.7, paneWidth * 0.66)}
                    d={depth}
                    y0={y}
                    y1={y + 1.65}
                    x={x - width / 2 + paneWidth * (i + 0.5)}
                    z={z}
                />
            ))}
        </group>
    );
}

/** Square, stepped control tower with an overhanging polygonal glass cab. */
function Tower({ x, z, h, r }: { x: number; z: number; h: number; r: number }) {
    const a = useAssets();
    const cabH = Math.max(3.2, r * 1.05);
    return (
        <group position={[x, 0, z]}>
            <Box m={a.concrete} w={r * 1.25} d={r * 1.25} y1={h * 0.72} />
            <Box m={a.concreteShade} w={r * 1.65} d={r * 1.65} y0={h * 0.72} y1={h * 0.78} />
            <Box m={a.concrete} w={r * 0.9} d={r * 0.9} y0={h * 0.78} y1={h} />
            <mesh position={[0, h + cabH / 2, 0]} material={a.glass} castShadow>
                <cylinderGeometry args={[r * 1.45, r * 1.35, cabH, 8]} />
            </mesh>
            <Box m={a.darkGlass} w={r * 2.9} d={0.18} y0={h + 0.55} y1={h + cabH - 0.45} z={-r * 1.34} />
            <Box m={a.darkGlass} w={r * 2.9} d={0.18} y0={h + 0.55} y1={h + cabH - 0.45} z={r * 1.34} />
            <Box m={a.roof} w={r * 3.25} d={r * 3.25} y0={h + cabH} y1={h + cabH + 0.8} />
            <Box m={a.accent} w={r * 0.22} d={r * 0.22} y0={h + cabH + 0.8} y1={h + cabH + 3.2} />
            <Box m={a.dark} w={r * 0.18} d={r * 0.18} y0={h + cabH + 3.2} y1={h + cabH + 4.4} />
            {/* Flashing red obstacle light on the mast. */}
            <mesh geometry={NAV_LAMP} material={LIGHT.obstacle} position={[0, h + cabH + 4.7, 0]} scale={0.7} />
        </group>
    );
}

/** Modular terminal: broad glass frontage, solid corner piers, roof lip and entrance canopy. */
function Terminal({ x, z, w, d, h }: { x: number; z: number; w: number; d: number; h: number }) {
    const a = useAssets();
    const panes = Math.max(8, Math.floor(w / 5));
    const sidePanes = Math.max(2, Math.floor(d / 5));
    return (
        <group position={[x, 0, z]}>
            <Box m={a.concrete} w={w} d={d} y1={h} />
            <Box m={a.concreteShade} w={w + 1.8} d={d + 1.8} y0={h * 0.72} y1={h * 0.82} />
            {/* Tall glazed passenger hall on both long sides. */}
            <Box m={a.glass} w={w - 5} d={0.32} y0={1.5} y1={h - 1.5} z={-d / 2 - 0.08} />
            <Box m={a.glass} w={w - 5} d={0.32} y0={1.5} y1={h - 1.5} z={d / 2 + 0.08} />
            <WindowStrip x={0} z={-d / 2 - 0.27} width={w - 7} y={2} count={panes} material={a.darkGlass} />
            <WindowStrip x={0} z={d / 2 + 0.27} width={w - 7} y={2} count={panes} material={a.darkGlass} />
            {Array.from({ length: sidePanes }, (_, i) => (
                <Box
                    key={i}
                    m={a.darkGlass}
                    w={0.22}
                    d={Math.max(0.8, (d - 5) / sidePanes * 0.55)}
                    y0={2}
                    y1={h - 2}
                    x={-w / 2 - 0.18}
                    z={-d / 2 + (i + 0.5) * d / sidePanes}
                />
            ))}
            {/* Roof slab and a bright terminal fascia. */}
            <Box m={a.roof} w={w + 3} d={d + 3} y0={h} y1={h + 1.1} />
            <Box m={a.accent} w={w * 0.72} d={0.55} y0={h * 0.62} y1={h * 0.69} z={-d / 2 - 0.28} />
            {/* Covered passenger drop-off. */}
            <Box m={a.steel} w={w * 0.72} d={5.8} y0={4.1} y1={4.55} z={-d / 2 - 3.1} />
            {[-0.32, 0.32].map((side) => (
                <Box key={side} m={a.steel} w={0.45} d={0.45} y0={0} y1={4.1} x={side * w * 0.34} z={-d / 2 - 3.1} />
            ))}
            {/* Entrance doors. */}
            {[-1, 0, 1].map((i) => (
                <Box key={i} m={a.glassLight} w={2.2} d={0.2} y0={0.2} y1={3.2} x={i * 3.2} z={-d / 2 - 0.28} />
            ))}
        </group>
    );
}

/** Wide low-poly hangar with a pitched roof and segmented apron doors. */
function Hangar({ x, z, w, d, h, m }: { x: number; z: number; w: number; d: number; h: number; m?: THREE.Material }) {
    const a = useAssets();
    const wall = m ?? a.hall;
    const roofWidth = Math.sqrt((d / 2) ** 2 + (d * 0.22) ** 2);
    const roofAngle = Math.atan2(d * 0.22, d / 2);
    const doorCount = Math.max(2, Math.floor(w / 12));
    return (
        <group position={[x, 0, z]}>
            <Box m={wall} w={w} d={d} y1={h} />
            {/* Two sloped roof planes create a simple gable silhouette. */}
            <mesh position={[0, h + d * 0.11, -d / 4]} rotation={[roofAngle, 0, 0]} material={a.roof} castShadow>
                <boxGeometry args={[w + 1.4, 0.8, roofWidth]} />
            </mesh>
            <mesh position={[0, h + d * 0.11, d / 4]} rotation={[-roofAngle, 0, 0]} material={a.roofLight} castShadow>
                <boxGeometry args={[w + 1.4, 0.8, roofWidth]} />
            </mesh>
            {/* Large sliding doors facing the apron (+z). */}
            <Box m={a.steel} w={w * 0.82} d={0.28} y0={0.2} y1={h * 0.86} z={d / 2 + 0.18} />
            {Array.from({ length: doorCount }, (_, i) => (
                <Box
                    key={i}
                    m={i % 2 ? a.concreteShade : a.concrete}
                    w={w * 0.82 / doorCount - 0.35}
                    d={0.18}
                    y0={0.45}
                    y1={h * 0.82}
                    x={-w * 0.41 + (i + 0.5) * (w * 0.82 / doorCount)}
                    z={d / 2 + 0.35}
                />
            ))}
            <Box m={a.accent} w={w * 0.9} d={0.3} y0={h * 0.88} y1={h * 0.96} z={d / 2 + 0.2} />
        </group>
    );
}

/** Compact parking lot with clear painted bays and a small entrance island. */
function Parking({ x, z, w, d }: { x: number; z: number; w: number; d: number }) {
    const a = useAssets();
    const lines = Math.floor(w / 3);
    return (
        <group position={[x, 0, z]}>
            <Box m={a.asphalt} w={w} d={d} y1={0.08} />
            {Array.from({ length: lines }, (_, i) => (
                <Box key={i} m={a.white} w={0.14} d={d * 0.42} y1={0.11} x={-w / 2 + 1.5 + i * 3} z={-d * 0.22} />
            ))}
            <Box m={a.grassDark} w={Math.min(3, w * 0.12)} d={d * 0.55} y1={0.18} x={w * 0.39} z={d * 0.18} />
        </group>
    );
}

/** Hotel facade with repeated dark windows and a contrasting roof cap. */
function Hotel({ x, z }: { x: number; z: number }) {
    const a = useAssets();
    const w = 22;
    const d = 16;
    const floors = 11;
    return (
        <group position={[x, 0, z]}>
            <Box m={a.concrete} w={w} d={d} y1={42} />
            {Array.from({ length: floors }, (_, floor) => (
                <group key={floor}>
                    <Box m={a.darkGlass} w={w - 2} d={0.24} y0={2 + floor * 3.5} y1={4.1 + floor * 3.5} z={-d / 2 - 0.14} />
                    <Box m={a.darkGlass} w={w - 2} d={0.24} y0={2 + floor * 3.5} y1={4.1 + floor * 3.5} z={d / 2 + 0.14} />
                    {Array.from({ length: 5 }, (_, i) => (
                        <Box key={i} m={a.glassLight} w={1.9} d={0.12} y0={2.2 + floor * 3.5} y1={3.8 + floor * 3.5} x={-8 + i * 4} z={-d / 2 - 0.29} />
                    ))}
                </group>
            ))}
            <Box m={a.roof} w={w + 1.4} d={d + 1.4} y0={42} y1={43.2} />
            <Box m={a.accent} w={w * 0.7} d={0.5} y0={0.8} y1={1.5} z={-d / 2 - 0.3} />
        </group>
    );
}

function Buildings({ level, L }: { level: number; L: AirportLayout }) {
    const a = useAssets();
    const front = -L.d / 2;
    if (level <= 1)
        return (
            <>
                <Hangar x={-160} z={front + 12} w={26} d={16} h={5} />
                {/* Small airfield clubhouse and observation room. */}
                <Box m={a.concrete} w={14} d={9} y1={4} x={-130} z={front + 9} />
                <Box m={a.glass} w={12} d={0.25} y0={1} y1={3.2} x={-130} z={front + 13.6} />
                <Box m={a.roof} w={15} d={10} y0={4} y1={4.8} x={-130} z={front + 9} />
                <Box m={a.darkGlass} w={4.2} d={4.2} y0={4.8} y1={7.1} x={-126} z={front + 9} />
                <Box m={a.accent} w={4.8} d={4.8} y0={7.1} y1={7.6} x={-126} z={front + 9} />
                <Parking x={-100} z={front + 8} w={24} d={12} />
                {/* Fuel tank and a small pump island. */}
                <mesh position={[-80, 1.6, front + 16]} rotation={[0, 0, Math.PI / 2]} material={a.red} castShadow>
                    <cylinderGeometry args={[1.5, 1.5, 6, 8]} />
                </mesh>
                <Box m={a.steel} w={3} d={2} y1={1.1} x={-73} z={front + 16} />
                <Box m={a.orange} w={0.3} d={0.3} y0={1.1} y1={2.2} x={-73} z={front + 16} />
            </>
        );
    if (level === 2)
        return (
            <>
                <Terminal x={-85} z={front + 13} w={90} d={22} h={11} />
                <Tower x={0} z={front + 14} h={22} r={3} />
                <Hangar x={110} z={front + 13} w={60} d={22} h={8} m={a.cladBlue} />
                <Parking x={-160} z={front + 12} w={40} d={20} />
                <Parking x={45} z={front + 9} w={40} d={14} />
            </>
        );
    return (
        <>
            <Terminal x={-80} z={front + 13} w={130} d={22} h={15} />
            {/* Jet bridges: blocky enclosed walkways with support pylons. */}
            {[-125, -80, -35, 10].map((x) => (
                <group key={x}>
                    <Box m={a.steel} w={3.4} d={6.5} y0={3.5} y1={6.5} x={x} z={front + 26} />
                    <Box m={a.glassLight} w={2.6} d={0.18} y0={4.1} y1={5.9} x={x} z={front + 29.3} />
                    <Box m={a.steel} w={0.5} d={0.5} y0={0} y1={3.5} x={x} z={front + 28.5} />
                </group>
            ))}
            <Tower x={30} z={front + 14} h={38} r={4} />
            <Hotel x={70} z={front + 12} />
            {/* Cargo centre with bright loading-bay doors. */}
            <Hangar x={145} z={front + 13} w={70} d={22} h={11} m={a.cladBlue} />
            {[-20, 0, 20].map((dx) => (
                <Box key={dx} m={a.accent} w={7} d={0.25} y0={1} y1={7.5} x={145 + dx} z={front + 24.3} />
            ))}
            {/* Multi-storey parking garage with open-looking dark floor bands. */}
            <Box m={a.concrete} w={34} d={22} y1={12} x={-167} z={front + 13} />
            {[3, 6, 9].map((y) => (
                <Box key={y} m={a.darkGlass} w={34.4} d={22.4} y0={y - 1.2} y1={y - 0.2} x={-167} z={front + 13} />
            ))}
            <Box m={a.roof} w={35} d={23} y0={12} y1={12.8} x={-167} z={front + 13} />
        </>
    );
}

/** Airport of a building record (all levels), with its planes. */
export function Airport({ b, y, preview = false }: { b: Building; grid?: DepthGrid; y: number; preview?: boolean }) {
    const L = useMemo(() => airportLayout(b.level), [b.level]);
    const active = useCity((s) => preview || (s.economy?.status[b.id]?.connected ?? false));
    const flights = useMemo(() => flightsOf(b.level, L), [b.level, L]);
    return (
        // The terrain under the plot is levelled to y (`levelPads` via useShapedGrid); a little
        // above it so the flat runway boxes do not flicker with the ground.
        <group position={[b.x, y + AIRPORT_LIFT, b.z]} rotation={[0, b.rot, 0]}>
            <group userData={GROUNDED}>
                <Ground L={L} />
                <Buildings level={b.level} L={L} />
            </group>
            {/* Airfield lighting (dark fixtures by day, lit at night); outside the grounded group. */}
            <AirfieldLights L={L} level={b.level} />
            {/* Outside the grounded group: moving planes get no contact shadow. */}
            <Planes flights={flights} layout={L} active={active && !preview} />
        </group>
    );
}

const GROUNDED = { base: true };
const AIRPORT_LIFT = 0.12;

/* ---------- airfield lighting at night ---------- */

/** Lamp colours (lit values above 1 so they bloom); fixtures show a dull tint by day. */
const LAMP_COLOURS = {
    edge: new THREE.Color(3.2, 3.0, 2.4),
    green: new THREE.Color(0.3, 3.4, 0.9),
    red: new THREE.Color(3.4, 0.25, 0.15),
    taxi: new THREE.Color(0.35, 0.8, 4),
    flood: new THREE.Color(3.4, 3.1, 2.4),
    navRed: new THREE.Color(4, 0.2, 0.15),
    navGreen: new THREE.Color(0.2, 4, 0.6),
    strobe: new THREE.Color(5, 5, 5),
    beacon: new THREE.Color(4.5, 0.3, 0.2),
    obstacle: new THREE.Color(4.5, 0.25, 0.15),
};
const FIXTURE = new THREE.Color("#5c6266");
type LampKey = keyof typeof LAMP_COLOURS;
const LIGHT = Object.fromEntries(
    Object.keys(LAMP_COLOURS).map((k) => [k, new THREE.MeshBasicMaterial({ color: FIXTURE.clone(), toneMapped: false })]),
) as Record<LampKey, THREE.MeshBasicMaterial>;
const NAV_LAMP = new THREE.SphereGeometry(1, 8, 6);
/** Flashing lamps: period (s) and lit share of it. */
const FLASH: Partial<Record<LampKey, [number, number]>> = { strobe: [1.3, 0.08], beacon: [1.0, 0.25], obstacle: [1.6, 0.5] };

/** Sets every lamp material for the time of day (outside components for the React compiler). */
function updateLamps(t: number) {
    const night = NIGHT.value;
    for (const key of Object.keys(LAMP_COLOURS) as LampKey[]) {
        const flash = FLASH[key];
        const on = flash ? ((t % flash[0]) / flash[0] < flash[1] ? 1 : 0) : 1;
        // Strobes and beacons flash day and night (aircraft always run them); the rest only at night.
        const k = flash && key !== "obstacle" ? on : night * on;
        LIGHT[key].color.copy(FIXTURE).lerp(LAMP_COLOURS[key], k);
    }
    POOL_MATERIAL().opacity = 0.5 * night;
}

/** Radial light pool texture (canvas). */
let poolMaterial: THREE.MeshBasicMaterial | null = null;
const POOL_MATERIAL = () => {
    if (poolMaterial) return poolMaterial;
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const g = cv.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,240,205,1)");
    grad.addColorStop(0.5, "rgba(255,240,205,0.45)");
    grad.addColorStop(1, "rgba(255,240,205,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    poolMaterial = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -8,
    });
    return poolMaterial;
};

/** Small lamp boxes merged per colour: [x, z, w, h, d, y]. */
function lampBoxes(items: [number, number][], size: [number, number, number], y = 0) {
    if (items.length === 0) return null;
    const parts = items.map(([x, z]) => new THREE.BoxGeometry(...size).translate(x, y + size[1] / 2, z));
    const merged = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    return merged;
}

/**
 * Runway edge lights (white, every 30 m), threshold bars (green where planes land at −x and
 * take off, red at the far end), blue taxiway edge lights, and floodlight masts along the apron
 * with pools of light. Planes approach from −x and take off towards +x (see `fly`).
 */
function AirfieldLights({ L, level }: { L: AirportLayout; level: number }) {
    const a = useAssets();
    const parts = useMemo(() => {
        const edge: [number, number][] = [];
        const green: [number, number][] = [];
        const red: [number, number][] = [];
        const taxi: [number, number][] = [];
        const spacing = L.grass ? 40 : 30;
        for (let x = L.x0; x <= L.x1 + 0.1; x += spacing) for (const s of [-1, 1]) edge.push([x, L.runwayZ + s * (L.runwayW / 2 + 1.2)]);
        for (let z = -L.runwayW / 2; z <= L.runwayW / 2 + 0.1; z += L.runwayW / 6) {
            green.push([L.x0 - 1.5, L.runwayZ + z]);
            red.push([L.x1 + 1.5, L.runwayZ + z]);
        }
        if (L.taxiW > 0) {
            const mid = (L.x0 + L.x1) / 2;
            const len = L.x1 - L.x0 - 20;
            for (let x = mid - len / 2; x <= mid + len / 2 + 0.1; x += 20)
                for (const s of [-1, 1]) taxi.push([x, L.taxiZ + s * (L.taxiW / 2 + 0.8)]);
        }
        // Floodlight masts at the front of the apron (not at the grass strip's small apron).
        const masts: [number, number][] = [];
        const apronLen = L.apronX[1] - L.apronX[0];
        const n = Math.max(2, Math.round(apronLen / 70));
        for (let i = 0; i < n; i++) masts.push([L.apronX[0] + (apronLen * (i + 0.5)) / n, L.apron[1] + 2]);
        return {
            edge: lampBoxes(edge, [0.5, 0.45, 0.5]),
            green: lampBoxes(green, [0.6, 0.45, 0.6]),
            red: lampBoxes(red, [0.6, 0.45, 0.6]),
            taxi: lampBoxes(taxi, [0.4, 0.35, 0.4]),
            heads: lampBoxes(masts, [3, 0.5, 1.4], level >= 2 ? 18 : 12),
            masts,
        };
    }, [L, level]);
    useEffect(
        () => () => {
            for (const g of [parts.edge, parts.green, parts.red, parts.taxi, parts.heads]) g?.dispose();
        },
        [parts],
    );
    useFrame((state) => updateLamps(state.clock.elapsedTime));
    const mastH = level >= 2 ? 18 : 12;
    const poolR = level >= 2 ? 26 : 18;
    return (
        <group>
            {parts.edge && <mesh geometry={parts.edge} material={LIGHT.edge} />}
            {parts.green && <mesh geometry={parts.green} material={LIGHT.green} />}
            {parts.red && <mesh geometry={parts.red} material={LIGHT.red} />}
            {parts.taxi && <mesh geometry={parts.taxi} material={LIGHT.taxi} />}
            {parts.heads && <mesh geometry={parts.heads} material={LIGHT.flood} />}
            {parts.masts.map(([x, z]) => (
                <group key={x}>
                    <Box m={a.steel} w={0.45} d={0.45} y1={mastH} x={x} z={z} />
                    {/* Pool of light on the apron in front of the mast. */}
                    <mesh position={[x, 0.12, z - poolR * 0.55]} rotation={[-Math.PI / 2, 0, 0]} material={POOL_MATERIAL()} renderOrder={2}>
                        <planeGeometry args={[poolR * 2, poolR * 1.4]} />
                    </mesh>
                </group>
            ))}
        </group>
    );
}

