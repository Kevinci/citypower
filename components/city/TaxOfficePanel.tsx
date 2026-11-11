"use client";

import { BUILDINGS, BUSINESS_TAX_MAX, BUSINESS_TAX_MIN, levelName, TAX_MAX, TAX_MIN } from "@/lib/city/economy";
import { useCity } from "@/lib/city/store";
import { salesRate } from "@/lib/city/shipping";
import { treasuryReport, type MoneyLine, type Taxpayer } from "@/lib/city/treasury";
import { GameIcon } from "./GameIcon";
import { euro, Pill } from "./Hud";
import { Frame, Heading, Line, pct, Trend } from "./PanelParts";

/*
 * Tax office (Finanzamt): the one place for the town's money. All figures come from
 * `treasuryReport` (lib/city/treasury.ts); here the tax rates are set (they are no longer
 * in the city panel top left) and their effect is shown before the player commits.
 */

const signed = (v: number) => `${v < 0 ? "−" : "+"}${euro(Math.abs(v))}`;

/** One tax rate: − / + buttons, what one point brings and how it affects immigration. */
function RateControl({
  label,
  rate,
  set,
  min,
  max,
  high,
  low,
  point,
  hint,
}: {
  label: string;
  rate: number;
  set: (r: number) => void;
  min: number;
  max: number;
  high: number;
  low: number;
  point: number;
  hint: string;
}) {
  return (
    <div className="mx-4 my-1.5 rounded-lg border border-black/10 bg-white/70 px-3 py-2">
      <div className="flex items-center justify-between text-[12px]">
        <span className="font-semibold text-[#1d2a35]">{label}</span>
        <span className="flex items-center gap-1.5">
          <Pill onClick={() => set(rate - 0.01)} disabled={rate <= min + 1e-6}>
            −
          </Pill>
          <span className={`w-10 text-center font-mono font-semibold ${rate > high ? "text-[#c0392b]" : rate < low ? "text-[#2c8f4e]" : "text-[#1d2a35]"}`}>
            {Math.round(rate * 100)} %
          </span>
          <Pill onClick={() => set(rate + 0.01)} disabled={rate >= max - 1e-6}>
            +
          </Pill>
        </span>
      </div>
      <div className="mt-1 text-[11px] text-[#2c3640]">
        1 Prozentpunkt ≈ <span className="font-mono text-[#2c8f4e]">{euro(point)}</span> pro Minute
      </div>
      <div className="text-[10px] leading-snug text-[#7a8794]">{hint}</div>
    </div>
  );
}

function MoneyBars({ lines, top, sign }: { lines: MoneyLine[]; top: number; sign: 1 | -1 }) {
  return (
    <>
      {lines.map((r) => (
        <div key={r.id} className="grid grid-cols-[1fr_80px_72px] items-center gap-2 px-4 py-[2px] text-[12px]">
          <span className="truncate text-[#1d5f86]" title={r.sub}>
            {r.label}
            {r.sub && <span className="ml-1 text-[10px] text-[#7a8794]">{r.sub}</span>}
          </span>
          <span className={`h-2 rounded-full ${sign > 0 ? "bg-[#2c8f4e]/80" : "bg-[#c0392b]/75"}`} style={{ width: `${(r.value / top) * 100}%` }} />
          <span className={`text-right font-mono ${sign > 0 ? "text-[#1d2a35]" : "text-[#c0392b]"}`}>{signed(sign * r.value)}</span>
        </div>
      ))}
    </>
  );
}

function PayerRow({ p, value, tone }: { p: Taxpayer; value: number; tone: "good" | "bad" }) {
  const flyTo = useCity((s) => s.flyTo);
  return (
    <button
      type="button"
      onClick={() => flyTo(p.building.id)}
      title="Zum Gebäude fahren"
      className="flex w-full items-center gap-2 px-4 py-[3px] text-left text-[12px] hover:bg-white/60"
    >
      <GameIcon name={BUILDINGS[p.building.kind].icon} size={16} />
      <span className="flex-1 truncate text-[#1d2a35]">{levelName(p.building)}</span>
      <span className={`font-mono ${tone === "bad" ? "text-[#c0392b]" : "text-[#2c8f4e]"}`}>{signed(value)}</span>
    </button>
  );
}

export function TaxOfficePanel() {
  const economy = useCity((s) => s.economy);
  const buildings = useCity((s) => s.buildings);
  const loans = useCity((s) => s.loans);
  const stats = useCity((s) => s.stats);
  const money = useCity((s) => s.money);
  const taxRate = useCity((s) => s.taxRate);
  const setTaxRate = useCity((s) => s.setTaxRate);
  const businessTaxRate = useCity((s) => s.businessTaxRate);
  const shipSales = useCity((s) => s.shipSales);
  const gameMinutes = useCity((s) => s.gameMinutes);
  const setBusinessTaxRate = useCity((s) => s.setBusinessTaxRate);
  if (!economy) return null;
  const r = treasuryReport(economy, buildings, loans, businessTaxRate, salesRate(shipSales, gameMinutes));
  const top = Math.max(1, ...r.income.map((l) => l.value), ...r.spending.map((l) => l.value));
  const withIncome = stats.filter((s) => s.income !== undefined);
  return (
    <Frame title="Finanzamt – Steuern & Haushalt" icon="taxoffice">
      <div className="grid grid-cols-2 gap-2 px-4 pt-3">
        <div>
          <div className="text-[11px] text-[#7a8794]">Kasse</div>
          <div className="text-xl font-semibold tracking-tight text-[#1d2a35]">{euro(money)}</div>
        </div>
        <div>
          <div className="text-[11px] text-[#7a8794]">Saldo</div>
          <div className={`font-mono text-sm font-semibold ${r.balance >= 0 ? "text-[#2c8f4e]" : "text-[#c0392b]"}`}>{signed(r.balance)} / min</div>
          <div className={`font-mono text-[11px] ${r.perDay >= 0 ? "text-[#2c8f4e]" : "text-[#c0392b]"}`}>{signed(r.perDay)} / Spieltag</div>
        </div>
      </div>

      <Heading>Steuersätze</Heading>
      <RateControl
        label="Einkommensteuer"
        rate={taxRate}
        set={setTaxRate}
        min={TAX_MIN}
        max={TAX_MAX}
        high={0.15}
        low={0.08}
        point={r.incomeTaxPoint}
        hint="Anteil der Löhne. Hoch bringt Geld, aber weniger Zuzug und schlechtere Stimmung."
      />
      <RateControl
        label="Gewerbesteuer"
        rate={businessTaxRate}
        set={setBusinessTaxRate}
        min={BUSINESS_TAX_MIN}
        max={BUSINESS_TAX_MAX}
        high={0.25}
        low={0.1}
        point={r.businessTaxPoint}
        hint="Anteil der Betriebsgewinne. Über 15 % siedeln sich weniger Firmen an."
      />
      <Line
        label="Wirkung auf den Zuzug"
        value={`× ${r.attraction.toFixed(2)}`}
        tone={r.attraction < 0.9 ? "bad" : r.attraction > 1.05 ? "good" : undefined}
        sub="1,00 = neutral"
      />

      <Heading>Einnahmen pro Minute · {signed(r.totalIncome)}</Heading>
      <MoneyBars lines={r.income} top={top} sign={1} />
      <Heading>Ausgaben pro Minute · {signed(-r.totalSpending)}</Heading>
      {r.spending.length === 0 && <div className="px-4 text-[11px] text-[#7a8794]">Keine Ausgaben</div>}
      <MoneyBars lines={r.spending} top={top} sign={-1} />

      <Heading>Verlauf</Heading>
      <Trend samples={withIncome} pick={(s) => s.income ?? 0} label="Einnahmen pro Minute" format={euro} />
      <Trend samples={stats} pick={(s) => s.balance} label="Saldo pro Minute" format={euro} />

      <Heading>Kennzahlen</Heading>
      <Line label="Lohnsumme" value={`${euro(r.wageBase)} / min`} sub="Basis Einkommensteuer" />
      <Line label="Gewinne vor Steuer" value={`${euro(r.profitBase)} / min`} sub="Basis Gewerbesteuer" />
      <Line label="Gewinn aller Betriebe" value={`${euro(economy.businessProfit)} / min`} tone={economy.businessProfit < 0 ? "bad" : "good"} sub="nach Steuer" />
      <Line label="Einnahmen je Einwohner" value={`${r.perResident.toFixed(2)} € / min`} />
      <Line label="Beschäftigung" value={pct(economy.employment)} tone={economy.employment < 0.7 ? "bad" : undefined} />
      <Line label="Schulden" value={euro(r.debt)} tone={r.debt > 0 ? "bad" : "good"} sub={r.debtFreeDays !== null ? `schuldenfrei in ${r.debtFreeDays.toFixed(1)} Tagen` : "keine Kredite"} />

      <Heading>Steuern nach Branche</Heading>
      {r.sectors.length === 0 && <div className="px-4 text-[11px] text-[#7a8794]">Noch keine Betriebe.</div>}
      {r.sectors.map((s) => (
        <div key={s.kind} className="grid grid-cols-[18px_1fr_64px_70px] items-center gap-2 px-4 py-[2px] text-[12px]">
          <GameIcon name={BUILDINGS[s.kind].icon} size={16} />
          <span className="truncate text-[#1d5f86]">
            {s.label}
            <span className="ml-1 text-[10px] text-[#7a8794]">×{s.count}</span>
            {s.losing > 0 && <span className="ml-1 text-[10px] text-[#c0392b]">{s.losing} Verlust</span>}
          </span>
          <span className="text-right font-mono text-[11px] text-[#2c3640]" title="Steuer pro Minute">
            {euro(s.tax)}
          </span>
          <span className={`text-right font-mono text-[11px] ${s.profit < 0 ? "text-[#c0392b]" : "text-[#2c8f4e]"}`} title="Gewinn nach Steuer pro Minute">
            {signed(s.profit)}
          </span>
        </div>
      ))}
      {r.sectors.length > 0 && <div className="px-4 pt-0.5 text-[10px] text-[#7a8794]">Spalten: Steuer · Gewinn nach Steuer (je Minute)</div>}

      <Heading>Größte Steuerzahler</Heading>
      {r.topPayers.length === 0 && <div className="px-4 text-[11px] text-[#7a8794]">Noch keine Gewerbesteuer.</div>}
      {r.topPayers.map((p) => (
        <PayerRow key={p.building.id} p={p} value={p.tax} tone="good" />
      ))}

      <Heading>Betriebe mit Verlust</Heading>
      {r.losers.length === 0 && <div className="px-4 text-[12px] text-[#2c8f4e]">Alle Betriebe machen Gewinn.</div>}
      {r.losers.map((p) => (
        <PayerRow key={p.building.id} p={p} value={p.profit} tone="bad" />
      ))}
    </Frame>
  );
}
