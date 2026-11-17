/**
 * Supply-chain report for a save (shoes, furniture and their inputs):
 *   node --import ./scripts/perf/register.mjs scripts/perf/chains.ts <save.json>
 */
import { readFileSync } from "node:fs";
import { simulate, levelName } from "../../lib/city/economy";
import { setWorldSeed } from "../../lib/city/terrain";
import { shipUpkeep } from "../../lib/city/shipping";
import type { SaveGame } from "../../lib/city/save";

const save = JSON.parse(readFileSync(process.argv[2], "utf8")) as SaveGame;
setWorldSeed(save.seed);
const e = simulate(save.buildings, save.roads, save.taxRate, save.businessTaxRate ?? 0.15, save.cables ?? [], save.canals, save.storage ?? {}, shipUpkeep(save.ships ?? []), {});
console.log(`Einwohner ${e.residents}, shod ${(e.shod * 100).toFixed(1)} %, furnished ${(e.furnished * 100).toFixed(1)} %, Möbelbedarf ${e.furnitureDemand?.toFixed(1)}`);
const kinds = ["slaughterhouse", "tannery", "rubberfactory", "shoefactory", "shoeshop", "sawmill", "steelworks", "recycling", "furniture", "furniturestore"];
for (const k of kinds) {
  const list = save.buildings.filter((b) => b.kind === k);
  if (!list.length) continue;
  const sum: Record<string, [number, number]> = {};
  const ins: Record<string, [number, number]> = {};
  const problems = new Map<string, number>();
  let staff = 0;
  const levels: number[] = [];
  for (const b of list) {
    const st = e.status[b.id];
    levels.push(b.level);
    staff += st?.staffing ?? 0;
    for (const [g, o] of Object.entries(st?.outputs ?? {})) { const s = (sum[g] ??= [0, 0]); s[0] += o!.made; s[1] += o!.max; }
    for (const [g, o] of Object.entries(st?.inputs ?? {})) { const s = (ins[g] ??= [0, 0]); s[0] += o!.got; s[1] += o!.need; }
    if (st?.problem) problems.set(st.problem, (problems.get(st.problem) ?? 0) + 1);
  }
  console.log(`\n${levelName(list[0])} (${k}) × ${list.length}, Stufen ${levels.join(",")}, Besetzung Ø ${((staff / list.length) * 100).toFixed(0)} %`);
  for (const [g, [a, m]] of Object.entries(ins)) console.log(`  in  ${g}: ${a.toFixed(1)} / ${m.toFixed(1)}`);
  for (const [g, [a, m]] of Object.entries(sum)) console.log(`  out ${g}: ${a.toFixed(1)} / ${m.toFixed(1)}`);
  for (const [p, n] of problems) console.log(`  ! ${n}× ${p}`);
}
console.log(`\nBeschäftigung ${(e.employment * 100).toFixed(1)} %, Arbeitslose ${Math.round(e.unemployed)}`);
for (const k of kinds) {
  const list = save.buildings.filter((b) => b.kind === k);
  const p = list.map((b) => e.status[b.id]?.finance?.profit ?? 0);
  if (p.length) console.log(`Gewinn ${k}: Ø ${(p.reduce((a, b) => a + b, 0) / p.length).toFixed(0)} €/min, min ${Math.min(...p).toFixed(0)}`);
}
