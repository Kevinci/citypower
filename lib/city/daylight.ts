/**
 * Day and night from the game clock. One game day is 1,440 game minutes (24 real minutes
 * at speed 1). Everything visual reads `daylightAt(gameMinutes)`: sky blend between the
 * Kenney skyboxes (night → morning → day → morning (dusk) → night), sun direction and
 * colour, moonlight at night, sky-light strength, haze colour and street lamps.
 */

export type SkyName = "night" | "morning" | "day";

export interface Daylight {
  /** Hour of the day, 0..24. */
  hour: number;
  /** 0 at night, 1 in full daylight (smooth). */
  daylight: number;
  /** Sky textures to blend and the blend factor (0 = a, 1 = b). */
  sky: { a: SkyName; b: SkyName; t: number };
  /** Direction towards the light (sun by day, moon at night), unit length. */
  lightDir: [number, number, number];
  lightIntensity: number;
  lightColor: [number, number, number];
  /** Strength of the HDRI sky light (image-based lighting). */
  environment: number;
  /** Colour of the distance haze (fog). */
  haze: [number, number, number];
  /** Glow of the street lamps (emissive intensity). */
  lamps: number;
  /** Lights on: 0 by day, 1 at night (windows, car lights, signs). */
  lights: number;
}

export const hourOf = (gameMinutes: number) => ((gameMinutes % 1440) + 1440) % 1440 / 60;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Sunrise and sunset (hours). */
export const SUNRISE = 6;
export const SUNSET = 20;

/** Sky blend for an hour: dawn and dusk both use the "morning" skybox. */
function skyAt(h: number): Daylight["sky"] {
  if (h < 4.5 || h >= 21) return { a: "night", b: "night", t: 0 };
  if (h < 5.5) return { a: "night", b: "morning", t: smooth(4.5, 5.5, h) };
  if (h < 7) return { a: "morning", b: "morning", t: 0 };
  if (h < 8.5) return { a: "morning", b: "day", t: smooth(7, 8.5, h) };
  if (h < 18) return { a: "day", b: "day", t: 0 };
  if (h < 19.2) return { a: "day", b: "morning", t: smooth(18, 19.2, h) };
  if (h < 20) return { a: "morning", b: "morning", t: 0 };
  return { a: "morning", b: "night", t: smooth(20, 21, h) };
}

const SUN_DAY: [number, number, number] = [1, 0.894, 0.749]; // #ffe4bf
const SUN_LOW: [number, number, number] = [1, 0.62, 0.35]; // low sun: orange
const MOON: [number, number, number] = [0.6, 0.68, 0.9];
const HAZE_DAY: [number, number, number] = [0.776, 0.827, 0.875]; // #c6d3df
const HAZE_DUSK: [number, number, number] = [0.82, 0.66, 0.56];
const HAZE_NIGHT: [number, number, number] = [0.1, 0.12, 0.19];
/** Fixed moon direction (high in the south-west). */
const MOON_DIR: [number, number, number] = [-0.45, 0.72, -0.5];

export function daylightAt(gameMinutes: number): Daylight {
  const hour = hourOf(gameMinutes);
  // Sun path: rises in the east, culminates at 60° around 13:00, sets in the west.
  const f = (hour - SUNRISE) / (SUNSET - SUNRISE);
  const elevation = Math.sin(Math.PI * Math.min(1, Math.max(0, f))) * (Math.PI / 3);
  const azimuth = lerp(2.1, -1.2, f);
  const sunDir: [number, number, number] = [Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth)];
  const sinEl = f <= 0 || f >= 1 ? 0 : Math.sin(elevation);
  const daylight = smooth(0.0, 0.3, sinEl);
  // Low sun is orange and weak; at night the moon takes over from a fixed direction.
  const sunColor = mix3(SUN_LOW, SUN_DAY, smooth(0.08, 0.45, sinEl));
  const sunIntensity = 3.3 * smooth(0, 0.25, sinEl);
  const moon = 1 - smooth(0.0, 0.12, sinEl);
  const m = MOON_DIR;
  const dir: [number, number, number] = daylight > 0.02 ? sunDir : m;
  const len = Math.hypot(...dir) || 1;
  return {
    hour,
    daylight,
    sky: skyAt(hour),
    lightDir: [dir[0] / len, dir[1] / len, dir[2] / len],
    lightIntensity: Math.max(sunIntensity, 0.35 * moon),
    lightColor: daylight > 0.02 ? sunColor : MOON,
    environment: 0.06 + 0.64 * daylight,
    haze: mix3(HAZE_NIGHT, mix3(HAZE_DUSK, HAZE_DAY, smooth(0.15, 0.6, sinEl)), smooth(0, 0.12, sinEl) * 0.85 + 0.15 * daylight),
    lamps: 1.6 * (1 - smooth(0.05, 0.3, sinEl)) + 0.1,
    lights: 1 - smooth(0.05, 0.3, sinEl),
  };
}
