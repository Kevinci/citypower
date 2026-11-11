import { mulberry32 } from "./random";

/**
 * The town's gold reserve and the gold price of the stock exchange (Börse).
 *
 * Bars lie in the bank's vault (`gold` in the store and save). Money can be turned into bars and
 * back at the gold price. With a Börse in town that is the market price `goldPrice(minutes)`,
 * which moves like a market; without one the bank only knows the fixed reference price.
 *
 * The market is faked for now: no state, no supply and demand. The price is a sum of smooth
 * value noise at several time scales (weeks, days, hours, minutes) around a slow drift, so it
 * has trends, swings and jitter – and every game minute always has the same price (deterministic,
 * nothing to save). Replace `goldPrice` with a real model later; everything else reads it.
 */

/** Reference price of one bar (€): the bank's fixed price without a Börse, and the market's mean. */
export const GOLD_BASE_PRICE = 1000;
/** Buying costs a little more, selling brings a little less (the bank's margin). */
export const GOLD_SPREAD = 0.02;
export const DAY = 24 * 60;

/** Value noise: a random value per whole step, smoothly interpolated in between (−1..1). */
function noise(t: number, seed: number) {
  const i = Math.floor(t);
  const f = t - i;
  const at = (k: number) => mulberry32((k * 374761393 + seed * 668265263) | 0)() * 2 - 1;
  const s = f * f * (3 - 2 * f);
  return at(i) * (1 - s) + at(i + 1) * s;
}

/** Time scales of the market (period in game minutes, amplitude as a share of the price). */
const SCALES: [number, number][] = [
  [12 * DAY, 0.22], // long trends over weeks
  [3 * DAY, 0.1], // swings over days
  [8 * 60, 0.04], // moves within a day
  [60, 0.015], // hourly jitter
  [7, 0.004], // ticks
];

/** Market price of one bar at a game minute (roughly 0.6–1.45 × the reference price). */
export function goldPrice(minutes: number): number {
  let wave = 0;
  SCALES.forEach(([period, amp], k) => (wave += amp * noise(minutes / period, 9173 + k * 101)));
  return Math.round(GOLD_BASE_PRICE * Math.exp(wave));
}

/** Price the bank works with: the market price with a Börse, otherwise the fixed reference. */
export const goldQuote = (minutes: number, exchange: boolean) => (exchange ? goldPrice(minutes) : GOLD_BASE_PRICE);
export const goldBuyPrice = (minutes: number, exchange: boolean) => Math.round(goldQuote(minutes, exchange) * (1 + GOLD_SPREAD));
export const goldSellPrice = (minutes: number, exchange: boolean) => Math.round(goldQuote(minutes, exchange) * (1 - GOLD_SPREAD));

/** Price history up to `minutes`: `points` samples evenly over the last `span` game minutes. */
export function goldHistory(minutes: number, span = 3 * DAY, points = 144): { t: number; price: number }[] {
  const out: { t: number; price: number }[] = [];
  const from = Math.max(0, minutes - span);
  const step = Math.max(1, (minutes - from) / points);
  for (let t = from; t < minutes; t += step) out.push({ t, price: goldPrice(t) });
  out.push({ t: minutes, price: goldPrice(minutes) });
  return out;
}

/** Day statistics for the price board: opening price (midnight), high and low so far today. */
export function goldDay(minutes: number) {
  const open = Math.floor(minutes / DAY) * DAY;
  let high = -Infinity;
  let low = Infinity;
  for (let t = open; t <= minutes; t += 5) {
    const p = goldPrice(t);
    high = Math.max(high, p);
    low = Math.min(low, p);
  }
  const now = goldPrice(minutes);
  return { open: goldPrice(open), high: Math.max(high, now), low: Math.min(low, now), now };
}
