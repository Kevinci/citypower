import { AMBULANCE_RADIUS, BUILDINGS, SERVICE_RADIUS, vehiclesOf, type Building, type BuildingKind, type EconomyStats } from "./economy";
import type { Road, Vec2 } from "./types";

/**
 * Incidents the emergency services respond to: traffic accidents on the streets and house
 * fires. The store spawns them (rarely) per game minute; the *player* raises the alarm
 * (`dispatch`), which picks the station that sends a vehicle (same road network, within the
 * station's reach, a vehicle free). The scene then drives the vehicle there in real time
 * (Traffic.tsx) and reports back when it is done. Without an alarm an accident blocks the
 * road for a long while and a burning house burns down to a ruin that has to be demolished.
 */

export type IncidentKind = "accident" | "fire";

export interface Incident {
  id: string;
  kind: IncidentKind;
  /** Where it happened (an accident lies on the road's centre line). */
  x: number;
  z: number;
  /** The street (accident) or the house (fire). */
  road?: string;
  building?: string;
  /** Game minute it started. */
  t0: number;
  /** Station whose vehicle responds, or null if none can. */
  station: string | null;
  /** The vehicle has arrived and the site is cordoned off. */
  onSite?: boolean;
  /** Someone is hurt: an ambulance is needed too. */
  injured?: boolean;
  /** Hospital whose ambulance responds, and whether it has taken the patient away. */
  ambulance?: string | null;
  ambulanceDone?: boolean;
  /** Police / fire brigade finished, waiting only for the ambulance (and the police at a fire). */
  cleared?: boolean;
  /** Fire: police station whose patrol car closes the street and diverts the traffic, and whether it has left. */
  police?: string | null;
  policeDone?: boolean;
}

/** Every unit has finished: the incident can go. */
export const incidentDone = (inc: Incident) => !!inc.cleared && (!inc.ambulance || !!inc.ambulanceDone) && (!inc.police || !!inc.policeDone);

/** Share of accidents / fires with injured people. */
const INJURED_SHARE = { accident: 0.6, fire: 0.4 } as const;

/** Ambulances of a hospital out on calls. */
export function busyAmbulances(incidents: Incident[], hospitalId: string) {
  let n = 0;
  for (const i of incidents) if (i.ambulance === hospitalId && !i.ambulanceDone) n++;
  return n;
}

/** Nearest hospital on the incident's road network with a free ambulance, or the reason why none. */
export function dispatchAmbulance(inc: Incident, buildings: Building[], incidents: Incident[], economy: EconomyStats): { hospital: string | null; reason: string | null } {
  const net = networkOfIncident(inc, economy);
  let best: { id: string; d: number } | null = null;
  let inReach = false;
  for (const b of buildings) {
    if (b.kind !== "hospital" || net === null || economy.networkOf[b.id] !== net) continue;
    const d = Math.hypot(b.x - inc.x, b.z - inc.z);
    if (d > AMBULANCE_RADIUS) continue;
    inReach = true;
    if (busyAmbulances(incidents, b.id) >= vehiclesOf(b)) continue;
    if (!best || d < best.d) best = { id: b.id, d };
  }
  if (best) return { hospital: best.id, reason: null };
  return { hospital: null, reason: inReach ? "alle Krankenwagen im Einsatz" : `kein Krankenhaus im Straßennetz bis ${AMBULANCE_RADIUS} m` };
}

/** Incidents at once, at most. */
export const MAX_INCIDENTS = 4;
/** Game minutes until an accident nobody attends is cleared, and a house nobody saves burns down. */
export const ACCIDENT_CLEAR = 120;
export const FIRE_BURN = 60;
/** Safety net: an attended incident ends by itself after this long (no road for the vehicle …). */
const ATTENDED_MAX = 240;
/** Rare: chance per game minute, a base plus a share per km of street / per house, capped; and a pause after each. */
const ACCIDENT_BASE = 0.0012;
const ACCIDENT_PER_KM = 0.0003;
const ACCIDENT_CAP = 0.0025;
const FIRE_BASE = 0.0006;
const FIRE_PER_HOUSE = 0.000008;
const FIRE_CAP = 0.0015;
export const MIN_GAP = 120;

export const INCIDENT_LABEL: Record<IncidentKind, string> = { accident: "Unfall", fire: "Hausbrand" };
export const STATION_OF: Record<IncidentKind, BuildingKind> = { accident: "police", fire: "firestation" };

/** Open incidents a station is attending. */
export function busyVehicles(incidents: Incident[], stationId: string) {
  let n = 0;
  for (const i of incidents) {
    if (i.station === stationId) n++;
    if (i.police === stationId && !i.policeDone) n++;
  }
  return n;
}

/** Nearest station of the right kind on the incident's network with a free vehicle, in reach. */
function findStation(inc: Incident, net: number | null, buildings: Building[], incidents: Incident[], economy: EconomyStats): string | null {
  if (net === null) return null;
  const kind = STATION_OF[inc.kind];
  let best: { id: string; d: number } | null = null;
  for (const b of buildings) {
    if (b.kind !== kind || economy.networkOf[b.id] !== net) continue;
    const d = Math.hypot(b.x - inc.x, b.z - inc.z);
    if (d > SERVICE_RADIUS[kind]![b.level]) continue;
    if (busyVehicles(incidents, b.id) >= vehiclesOf(b)) continue;
    if (!best || d < best.d) best = { id: b.id, d };
  }
  return best?.id ?? null;
}

/**
 * The player raises the alarm: the incident gets its station, or the reason why none can
 * come (no station in reach of this road network, or every vehicle out).
 */
export function dispatch(inc: Incident, buildings: Building[], incidents: Incident[], economy: EconomyStats): { station: string | null; reason: string | null } {
  const net = networkOfIncident(inc, economy);
  const station = findStation(inc, net, buildings, incidents, economy);
  if (station) return { station, reason: null };
  const kind = STATION_OF[inc.kind];
  const label = BUILDINGS[kind].label;
  const inReach = buildings.some((b) => b.kind === kind && economy.networkOf[b.id] === net && Math.hypot(b.x - inc.x, b.z - inc.z) <= SERVICE_RADIUS[kind]![b.level]);
  return {
    station: null,
    reason: inReach
      ? `Alle ${kind === "police" ? "Streifenwagen" : "Löschfahrzeuge"} sind im Einsatz – ${label} ausbauen oder warten`
      : `Keine ${label} in Reichweite (gleiches Straßennetz, Umkreis der Wache)`,
  };
}

/** A fire: the nearest police station in reach with a free patrol car closes the street (optional). */
export function dispatchPolice(inc: Incident, buildings: Building[], incidents: Incident[], economy: EconomyStats): { station: string | null; reason: string | null } {
  const station = findStation({ ...inc, kind: "accident" }, networkOfIncident(inc, economy), buildings, incidents, economy);
  return { station, reason: station ? null : "kein Streifenwagen frei in Reichweite – die Feuerwehr sperrt selbst ab" };
}

function networkOfIncident(inc: Incident, economy: EconomyStats): number | null {
  if (inc.kind === "accident") return inc.road !== undefined ? (economy.roadNetworkOf[inc.road] ?? null) : null;
  return inc.building !== undefined ? (economy.networkOf[inc.building] ?? null) : null;
}

/** Random point on a polyline, by length. */
function randomPointOn(points: Vec2[], rnd: () => number): Vec2 {
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const l = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
    lengths.push(l);
    total += l;
  }
  let s = rnd() * total;
  for (let i = 0; i < lengths.length; i++) {
    if (s <= lengths[i] || i === lengths.length - 1) {
      // Not right at the ends (junctions): keep 8 m clear where possible.
      const t = lengths[i] > 20 ? Math.min(lengths[i] - 8, Math.max(8, s)) / lengths[i] : 0.5;
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, z: points[i].z + (points[i + 1].z - points[i].z) * t };
    }
    s -= lengths[i];
  }
  return points[0];
}

export interface IncidentStep {
  incidents: Incident[];
  buildings: Building[];
  /** Message for the ticker, or null. */
  notice: string | null;
  /** Game minute of the newest incident (for the pause between incidents). */
  lastAt: number;
}

/**
 * One game tick (`minutes` game minutes) of incidents: stale ones vanish, old unattended ones
 * end (an accident clears, a house burns down to a ruin), and – rarely – a new one starts.
 */
export function stepIncidents(
  incidents: Incident[],
  buildings: Building[],
  /** Finished streets and motorways (no construction sites). */
  roads: Road[],
  economy: EconomyStats,
  gameMinutes: number,
  minutes: number,
  rnd: () => number,
  newId: () => string,
  /** Game minute of the last incident that started. */
  lastAt: number,
): IncidentStep {
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const roadIds = new Set(roads.map((r) => r.id));
  let out = incidents;
  let changed = false;
  let buildingsOut = buildings;
  let notice: string | null = null;
  const next: Incident[] = [];
  for (const inc of incidents) {
    // Subject gone (road bulldozed, house replaced): nothing left to attend.
    if (inc.kind === "accident" && (inc.road === undefined || !roadIds.has(inc.road))) { changed = true; continue; }
    if (inc.kind === "fire" && (inc.building === undefined || !byId.has(inc.building))) { changed = true; continue; }
    let cur = inc;
    // Station demolished: the alarm has to be raised again (a finished one only waits for its ambulance).
    if (cur.station !== null && !byId.has(cur.station) && !cur.cleared) { cur = { ...cur, station: null, onSite: false }; changed = true; }
    if (cur.ambulance && !byId.has(cur.ambulance)) {
      cur = { ...cur, ambulance: null };
      changed = true;
    }
    if (cur.police && !byId.has(cur.police)) {
      cur = { ...cur, police: null };
      changed = true;
    }
    if (incidentDone(cur)) { changed = true; continue; }
    const age = gameMinutes - cur.t0;
    if (cur.station === null) {
      if (cur.kind === "accident" && age >= ACCIDENT_CLEAR) { changed = true; continue; }
      if (cur.kind === "fire" && age >= FIRE_BURN) {
        // Burnt down: the house is a ruin now (no residents, no taxes) until it is demolished.
        buildingsOut = buildingsOut.map((b) => (b.id === cur.building ? { ...b, kind: "ruin" as const, level: 1 } : b));
        notice = "Ein Wohnhaus ist abgebrannt – die Ruine muss abgerissen werden";
        changed = true;
        continue;
      }
    } else if (age >= ATTENDED_MAX) { changed = true; continue; }
    next.push(cur);
  }
  if (changed) out = next;

  // New incidents – rarely, and never right after the last one.
  if (out.length < MAX_INCIDENTS && minutes > 0 && gameMinutes - lastAt >= MIN_GAP) {
    const streets = roads.filter((r) => (r.kind === "street" || r.kind === "highway") && r.points.length >= 2);
    const km = streets.reduce((s, r) => s + lengthOf(r.points), 0) / 1000;
    const houses = buildings.filter((b) => b.kind === "house");
    const pAccident = streets.length > 0 ? Math.min(ACCIDENT_CAP, ACCIDENT_BASE + ACCIDENT_PER_KM * km) * minutes : 0;
    const pFire = houses.length > 0 ? Math.min(FIRE_CAP, FIRE_BASE + FIRE_PER_HOUSE * houses.length) * minutes : 0;
    let inc: Incident | null = null;
    if (rnd() < pAccident) {
      // Streets with more length are more likely (traffic).
      let s = rnd() * km * 1000;
      let road = streets[streets.length - 1];
      for (const r of streets) {
        s -= lengthOf(r.points);
        if (s <= 0) { road = r; break; }
      }
      const p = randomPointOn(road.points, rnd);
      inc = { id: newId(), kind: "accident", x: p.x, z: p.z, road: road.id, t0: gameMinutes, station: null, injured: rnd() < INJURED_SHARE.accident };
    } else if (rnd() < pFire) {
      const h = houses[Math.floor(rnd() * houses.length)];
      if (!out.some((i) => i.building === h.id)) inc = { id: newId(), kind: "fire", x: h.x, z: h.z, building: h.id, t0: gameMinutes, station: null, injured: rnd() < INJURED_SHARE.fire };
    }
    if (inc) {
      out = [...out, inc];
      lastAt = gameMinutes;
      notice =
        (inc.kind === "accident" ? "Unfall auf der Straße! Notruf: Alarm auslösen, sonst bleibt die Stelle lange blockiert" : "Hausbrand! Notruf: Alarm auslösen, sonst brennt das Haus ab") +
        (inc.injured ? " – es gibt Verletzte" : "");
    }
  }
  return { incidents: out, buildings: buildingsOut, notice, lastAt };
}

function lengthOf(points: Vec2[]) {
  let l = 0;
  for (let i = 0; i < points.length - 1; i++) l += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
  return l;
}
