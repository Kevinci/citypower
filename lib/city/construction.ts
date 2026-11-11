import type { RoadKind } from "./types";

/** Hard upper limit for any construction animation, in seconds. */
export const MAX_BUILD_SECONDS = 15;
/** Even a tiny piece of road shows the site for this long. */
export const MIN_BUILD_SECONDS = 3;
/** Fixed time for setting up the site (cones, digging the first metres). */
const SETUP_SECONDS = 2;
/**
 * Build rate in metres of finished road per second. Highways are slower: wider, two
 * carriageways and a median.
 */
const BUILD_RATE: Record<RoadKind, number> = { street: 20, highway: 12, bike: 30, ramp: 16 };

/**
 * Construction time for a road:
 *
 *   duration = clamp(SETUP + length / rate(kind), MIN, MAX)
 *
 * Examples: 50 m street → 4.5 s, 200 m street → 12 s, 100 m highway → 10.3 s.
 * Everything longer than ~260 m of street or ~155 m of highway hits the 15 s cap.
 */
export function constructionDuration(lengthM: number, kind: RoadKind): number {
  const raw = SETUP_SECONDS + Math.max(0, lengthM) / BUILD_RATE[kind];
  return Math.min(MAX_BUILD_SECONDS, Math.max(MIN_BUILD_SECONDS, raw));
}

/** Share of the duration in which the digging front travels the whole road. */
const FRONT_SHARE = 0.7;

/**
 * Where the work is along the road at time t (seconds), as distances from the road start:
 *  - `front`: the digging front. Beyond it the ground is untouched.
 *  - `built`: finished road behind it. Between `built` and `front` is the open site.
 * The front runs during the first 70 % of the time, the finished road follows 30 % later,
 * so the open site is about 40 % of the road long and closes at the very end.
 */
export function constructionProgress(t: number, duration: number, lengthM: number) {
  const k = Math.min(1, Math.max(0, t / duration));
  const front = lengthM * Math.min(1, k / FRONT_SHARE);
  const built = lengthM * Math.min(1, Math.max(0, (k - (1 - FRONT_SHARE)) / FRONT_SHARE));
  return { front, built, done: k >= 1 };
}

/** Workers on a site: 3 for short roads, one more per 120 m, at most 5. */
export function crewSize(lengthM: number): number {
  return Math.min(5, Math.max(3, 3 + Math.floor(Math.max(0, lengthM) / 120)));
}
