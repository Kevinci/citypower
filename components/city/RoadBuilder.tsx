import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { GHOST_MATERIALS, PREVIEW_MATERIALS } from "@/lib/city/materials";
import { snapToQuay } from "@/lib/city/adjacency";
import { checkPoint, type PointCheck } from "@/lib/city/joins";
import { terrainProfile } from "@/lib/city/grade";
import { buildFrames, buildRoadLayers, MeshBuilder, strip, type Elevation } from "@/lib/city/road-geometry";
import { naturalDepthGrid, raycastTerrain, terrainHeight } from "@/lib/city/terrain";
import { isPathTool, joinsAtGrade, pathsFor, PLACEMENT_TOOLS, snapCablePoint, useCity } from "@/lib/city/store";
import { NETWORK_OF, OUTER_HALF_WIDTH, type BuildKind, type Vec2 } from "@/lib/city/types";
import { planCloverleaf, planCloverleafPrefab } from "@/lib/city/cloverleaf";
import { planTrumpet } from "@/lib/city/trumpet";
import { planInterchange } from "@/lib/city/interchange";
import { bulldozeTarget } from "@/lib/city/bulldoze";
import { useProfiles } from "./useProfiles";
import { useDepthGrid } from "./useWater";
import { LayerMeshes } from "./LayerMeshes";

type GhostKey = "body" | "edge";

/** Simple translucent footprint for drafting tracks and canals: body plus edge lines. */
function buildGhost(points: Vec2[], kind: BuildKind, elevation?: Elevation) {
  const frames = buildFrames(points, kind, elevation);
  const half = OUTER_HALF_WIDTH[kind];
  const body = new MeshBuilder();
  const edge = new MeshBuilder();
  strip(body, frames, -half, half, 0.06);
  strip(edge, frames, half - 0.3, half, 0.07);
  strip(edge, frames, -half, -half + 0.3, 0.07);
  if (NETWORK_OF[kind] === "rail") strip(edge, frames, -0.1, 0.1, 0.07, { dash: { on: 2, off: 2 } });
  const out: Partial<Record<GhostKey, THREE.BufferGeometry>> = {};
  const b = body.geometry();
  const e = edge.geometry();
  if (b) out.body = b;
  if (e) out.edge = e;
  return out;
}

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
/** Terrain height under a point (markers sit on mountains). */
const groundAt = (p: Vec2) => Math.max(0, terrainHeight(naturalDepthGrid(), p.x, p.z));
const CLICK_TOLERANCE_PX = 5;

/**
 * Path building interaction for roads, tracks and canals.
 * Pointer input is read on the canvas and projected onto the ground plane, so it works
 * even when the cursor is over an existing road. A press that moves more than a few
 * pixels is a camera drag and never places a point.
 */
export function RoadBuilder() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const tool = useCity((s) => s.tool);
  const draft = useCity((s) => s.draft);
  const cursor = useCity((s) => s.cursor);
  const join = useCity((s) => s.cursorJoin);

  // Why a point cannot go here: shown in the ticker while hovering (cleared once it fits).
  useEffect(() => {
    const reason = join?.state === "blocked" ? join.reason : null;
    if (reason) useCity.setState({ notice: reason });
    return () => {
      if (reason && useCity.getState().notice === reason) useCity.setState({ notice: null });
    };
  }, [join]);

  useEffect(() => {
    const el = gl.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();

    /** Cursor point and, for path tools, the join verdict (green / red ring). */
    const toGround = (e: PointerEvent): { p: Vec2; check: PointCheck | null } | null => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      // Land on the terrain (mountains), fall back to the plain.
      const onTerrain = raycastTerrain(ray.ray.origin, ray.ray.direction, naturalDepthGrid());
      if (onTerrain) hit.set(onTerrain.x, onTerrain.y, onTerrain.z);
      else if (!ray.ray.intersectPlane(groundPlane, hit)) return null;
      const st = useCity.getState();
      const last = st.draft[st.draft.length - 1];
      if (!st.tool) return null;
      const tool = st.tool;
      // Power lines snap to pylons and power buildings, at any angle.
      if (tool === "cable") return { p: snapCablePoint({ x: hit.x, z: hit.z }, st.cables, st.buildings), check: null };
      // One-click tools pick a place, no snapping.
      if (!isPathTool(tool)) return { p: { x: hit.x, z: hit.z }, check: null };
      // Only snap to paths the new one will actually join at grade (not a motorway it bridges).
      const joinable = pathsFor(st, tool).filter((o) => joinsAtGrade(st.crossingMode, tool, o.kind));
      const check = checkPoint({ x: hit.x, z: hit.z }, joinable, last, tool);
      // Roads and tracks drawn onto a canal end flush at its quay.
      const p = NETWORK_OF[tool] === "water" ? check.p : snapToQuay(check.p, last, st.canals);
      return { p, check };
    };

    let down: { x: number; y: number } | null = null;

    const onMove = (e: PointerEvent) => {
      const st = useCity.getState();
      if (!st.tool) return;
      const at = toGround(e);
      st.setCursor(at?.p ?? null, at?.check ? { state: at.check.state, reason: at.check.reason } : null);
    };
    const onLeave = () => useCity.getState().setCursor(null);
    const onDown = (e: PointerEvent) => {
      if (e.button === 0) down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_TOLERANCE_PX;
      down = null;
      if (moved) return;
      const st = useCity.getState();
      if (!st.tool) return;
      const at = toGround(e);
      if (at) st.addPoint(at.p);
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
    };
  }, [gl, camera]);

  // Live preview: placed points plus the cursor position as the next point.
  const previewPoints = useMemo(() => {
    if (!tool) return [];
    return cursor ? [...draft, cursor] : draft;
  }, [tool, draft, cursor]);

  const previewLayers = useMemo(() => {
    if (!isPathTool(tool) || previewPoints.length < 2) return null;
    // The preview follows the terrain like the finished path will.
    const elevation = terrainProfile({ id: "__draft__", kind: tool, points: previewPoints }, naturalDepthGrid());
    if (tool === "street" || tool === "highway" || tool === "bike")
      return { road: buildRoadLayers(previewPoints, tool, [], elevation) };
    return { ghost: buildGhost(previewPoints, tool, elevation) };
  }, [tool, previewPoints]);

  // Interchange tool: plan under the cursor, shown green when it fits, red ring when not.
  const roads = useCity((s) => s.roads);
  const separations = useCity((s) => s.separations);
  const profiles = useProfiles();
  const grid = useDepthGrid();
  const interchange = useMemo(() => {
    if (!tool || !PLACEMENT_TOOLS.includes(tool) || !cursor) return null;
    const st = useCity.getState();
    const obstacles = [...st.rails, ...st.canals];
    const plan =
      tool === "interchange"
        ? planInterchange(cursor, roads, profiles, separations, grid, obstacles)
        : tool === "cloverleaf"
          ? (planCloverleaf(cursor, roads, separations, grid, obstacles) ??
            planCloverleafPrefab(cursor, roads, separations, grid, obstacles))
          : planTrumpet(cursor, roads, grid, obstacles);
    if (!plan) return { ok: false, geometry: null, problem: null };
    const problem = "problem" in plan ? plan.problem : null;
    // Ghost of everything that would be built: ramps and, for a prefab, its motorway.
    const mb = new MeshBuilder();
    if ("newMotorway" in plan && plan.newMotorway) {
      const m = plan.newMotorway;
      strip(mb, buildFrames(m.points, m.kind), -OUTER_HALF_WIDTH.highway, OUTER_HALF_WIDTH.highway, 0.32);
    }
    for (const ramp of plan.ramps) {
      const frames = buildFrames(ramp, "ramp");
      strip(mb, frames, -OUTER_HALF_WIDTH.ramp, OUTER_HALF_WIDTH.ramp, 0.3);
    }
    return { ok: !problem, geometry: mb.geometry(), problem };
  }, [tool, cursor, roads, profiles, separations, grid]);
  useEffect(() => () => interchange?.geometry?.dispose(), [interchange]);
  // Tell the status bar why a placement does not fit.
  useEffect(() => {
    if (tool && PLACEMENT_TOOLS.includes(tool)) useCity.setState({ notice: interchange?.problem ?? null });
  }, [interchange, tool]);

  // Bulldozer: the piece under the cursor, drawn red.
  const rails = useCity((s) => s.rails);
  const canals = useCity((s) => s.canals);
  const cables = useCity((s) => s.cables);
  const bulldoze = useMemo(() => {
    if (tool !== "bulldoze" || !cursor) return null;
    const target = bulldozeTarget(cursor, { roads, rails, canals, cables });
    if (!target) return null;
    const mb = new MeshBuilder();
    strip(mb, buildFrames([target.a, target.b], "street"), -target.half - 0.5, target.half + 0.5, 0);
    return { geometry: mb.geometry(), y: Math.max(groundAt(target.a), groundAt(target.b)) + 0.4 };
  }, [tool, cursor, roads, rails, canals, cables]);
  useEffect(() => () => bulldoze?.geometry?.dispose(), [bulldoze]);

  const ghostMaterials = useMemo(
    () => ({
      body: isPathTool(tool) && NETWORK_OF[tool] === "water" ? GHOST_MATERIALS.water : GHOST_MATERIALS.rail,
      edge: GHOST_MATERIALS.edge,
    }),
    [tool],
  );

  useEffect(() => {
    return () => {
      const layers = previewLayers?.road ?? previewLayers?.ghost;
      if (layers) Object.values(layers).forEach((g) => g?.dispose());
    };
  }, [previewLayers]);

  if (!tool) return null;
  const ringSize = isPathTool(tool) ? Math.max(1.1, OUTER_HALF_WIDTH[tool] * 0.45) : 1.1;

  return (
    <group>
      {previewLayers?.road && <LayerMeshes layers={previewLayers.road} materials={PREVIEW_MATERIALS} />}
      {previewLayers?.ghost && <LayerMeshes layers={previewLayers.ghost} materials={ghostMaterials} shadows={false} />}
      {interchange?.geometry && (
        <mesh
          geometry={interchange.geometry}
          material={interchange.ok ? GHOST_MATERIALS.valid : GHOST_MATERIALS.invalid}
          renderOrder={5}
        />
      )}

      {draft.map((p, i) => (
        <mesh key={`${p.x}:${p.z}:${i}`} position={[p.x, groundAt(p) + 0.25, p.z]}>
          <sphereGeometry args={[0.45, 16, 12]} />
          <meshStandardMaterial color="#ffb703" emissive="#ffb703" emissiveIntensity={0.5} />
        </mesh>
      ))}

      {bulldoze?.geometry && <mesh geometry={bulldoze.geometry} material={GHOST_MATERIALS.invalid} position={[0, bulldoze.y, 0]} renderOrder={7} />}
      {cursor && !PLACEMENT_TOOLS.includes(tool) && tool !== "bulldoze" && (
        // Green = attaches cleanly to an existing path, red = not possible here, yellow = free point.
        <mesh position={[cursor.x, groundAt(cursor) + 0.3, cursor.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={6}>
          <ringGeometry args={[ringSize, ringSize + Math.max(0.4, ringSize * 0.3), 40]} />
          <meshBasicMaterial
            color={join?.state === "join" ? "#35d06b" : join?.state === "blocked" ? "#ef4444" : "#ffb703"}
            transparent
            opacity={0.95}
            depthWrite={false}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>
      )}
      {cursor && PLACEMENT_TOOLS.includes(tool) && (
        // Large placement ring: green = an interchange fits here, red = nothing to attach to.
        <mesh position={[cursor.x, groundAt(cursor) + 0.3, cursor.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={6}>
          <ringGeometry args={[8, 10, 48]} />
          <meshBasicMaterial
            color={interchange?.ok ? "#35d06b" : "#ef4444"}
            transparent
            opacity={0.9}
            depthWrite={false}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
}
