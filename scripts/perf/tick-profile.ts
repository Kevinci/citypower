/**
 * Game-tick benchmark outside the browser (same code as the store's tick, without React):
 *   node --import ./scripts/perf/register.mjs scripts/perf/tick-profile.ts <save.json> [rounds]
 * Add --cpu-prof to write a CPU profile. Reports the median/p95 of every tick section.
 */
import { readFileSync } from "node:fs";
import { simulate } from "../../lib/city/economy";
import { growOnce, decay } from "../../lib/city/growth";
import { railEconomy } from "../../lib/city/railway";
import { stepIncidents } from "../../lib/city/incidents";
import { depthGrid, setWorldSeed } from "../../lib/city/terrain";
import { shipUpkeep } from "../../lib/city/shipping";
import { mulberry32 } from "../../lib/city/random";
import type { SaveGame } from "../../lib/city/save";

const file = process.argv[2];
const rounds = Number(process.argv[3] ?? 30);
const save = JSON.parse(readFileSync(file, "utf8")) as SaveGame;
setWorldSeed(save.seed);
const t = (label: string, times: Record<string, number[]>, fn: () => unknown) => {
  const s = performance.now();
  const r = fn();
  (times[label] ??= []).push(performance.now() - s);
  return r;
};
const times: Record<string, number[]> = {};
const grid = t("depthGrid (einmalig)", times, () => depthGrid(save.canals)) as ReturnType<typeof depthGrid>;
let buildings = save.buildings;
const rnd = mulberry32(1);
let id = 0;
let minutes = save.gameMinutes;
for (let i = 0; i < rounds; i++) {
  const water: Record<string, string | null> = {};
  const economy = t("simulate", times, () =>
    simulate(buildings, save.roads, save.taxRate, save.businessTaxRate ?? 0.15, save.cables ?? [], save.canals, save.storage ?? {}, shipUpkeep(save.ships ?? []), water),
  ) as ReturnType<typeof simulate>;
  t("Bahn", times, () => railEconomy(buildings, save.rails, save.trains ?? [], economy.residents));
  const grown = t("Wachstum", times, () =>
    growOnce(buildings, save.roads, [...save.roads, ...save.rails, ...save.canals], grid, economy, rnd, () => `b-${id++}`, save.permits ?? "all", minutes),
  ) as ReturnType<typeof growOnce>;
  buildings = grown.buildings;
  buildings = (t("Verfall", times, () => decay(buildings, economy, rnd, 1)) as typeof buildings | null) ?? buildings;
  t("Einsätze", times, () => stepIncidents([], buildings, save.roads, economy, minutes, 1, rnd, () => `i-${id++}`, -Infinity));
  minutes += 1;
}
const fmt = (l: number[]) => {
  const s = [...l].sort((a, b) => a - b);
  return `median ${s[Math.floor(s.length / 2)].toFixed(2)} ms · p95 ${s[Math.floor(s.length * 0.95)].toFixed(2)} ms · n ${s.length}`;
};
console.log(`Spielstand: ${save.buildings.length} Gebäude, ${save.roads.length} Straßen`);
for (const [k, v] of Object.entries(times)) console.log(`${k.padEnd(22)} ${fmt(v)}`);
