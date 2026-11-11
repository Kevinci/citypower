export type Vec2 = { x: number; z: number };

/** "ramp" = motorway on/off ramp, created by the interchange tool, not drawn directly. */
export type RoadKind = "street" | "highway" | "bike" | "ramp";
export type RailKind = "rail" | "rail2";
export type WaterwayKind = "canal";

/** Everything the player can draw as a path. */
export type BuildKind = RoadKind | RailKind | WaterwayKind;

/** Separate networks: paths only snap to and connect with paths of the same network. */
export type NetworkId = "road" | "rail" | "water";

/** A drawn path: control points on the ground plane, straight segments at 45° steps. */
export interface Path<K extends BuildKind = BuildKind> {
  id: string;
  kind: K;
  points: Vec2[];
}

export type Road = Path<RoadKind>;
export type Rail = Path<RailKind>;
export type Canal = Path<WaterwayKind>;

export const NETWORK_OF: Record<BuildKind, NetworkId> = {
  street: "road",
  highway: "road",
  bike: "road",
  ramp: "road",
  rail: "rail",
  rail2: "rail",
  canal: "water",
};

/** Allowed path directions in degrees. Every segment snaps to one of these. */
export const ROAD_ANGLE_STEP = Math.PI / 4;

/** Build grid in metres. Every placed point snaps to this grid. */
export const GRID_SIZE = 2;

export const snapToGrid = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;

export const BUILD_LABEL: Record<BuildKind, string> = {
  street: "Straße",
  highway: "Autobahn",
  bike: "Radweg",
  ramp: "Auffahrt",
  rail: "Gleis",
  rail2: "Doppelgleis",
  canal: "Kanal",
};

/**
 * Half width (m) of the part of a path that other things must keep clear of:
 * asphalt for roads, ballast bed for rails, water for canals.
 */
export const HALF_WIDTH: Record<BuildKind, number> = {
  street: 4,
  highway: 12,
  bike: 1.5,
  ramp: 3.5,
  rail: 2.6,
  rail2: 4.9,
  canal: 8,
};

/** Half width including sidewalks, quays and embankments; used for bridges and tree clearance. */
export const OUTER_HALF_WIDTH: Record<BuildKind, number> = {
  street: 6.2,
  highway: 12.3,
  bike: 2,
  ramp: 4.5,
  rail: 3,
  rail2: 5.3,
  canal: 11,
};

/**
 * Turning radius of the centre line at corners. Larger than the widest offset of the path,
 * so every edge becomes a concentric arc and inner edges never fold back.
 */
export const CORNER_RADIUS: Record<BuildKind, number> = {
  street: 12,
  highway: 28,
  bike: 6,
  ramp: 20,
  rail: 40,
  rail2: 44,
  canal: 22,
};

/** Overhead power line: pylons at every point and along the way, wires between them. */
export interface Cable {
  id: string;
  points: Vec2[];
}
