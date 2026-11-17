"use client";

import { BUILDINGS, HOUSE_LEVEL_NAME, levelName, PUBLIC } from "@/lib/city/economy";
import { DAY, GOLD_BASE_PRICE, GOLD_SPREAD, goldBuyPrice, goldDay, goldHistory, goldPrice, goldQuote, goldSellPrice } from "@/lib/city/gold";
import { useMemo, useState } from "react";
import { creditLimit, debtOf, LOAN_OFFERS, loanPayments, paymentOf, payoffOf } from "@/lib/city/finance";
import { useCity } from "@/lib/city/store";
import { PERMIT_LABEL, type Permits } from "@/lib/city/growth";
import { salesRate } from "@/lib/city/shipping";
import { treasuryReport } from "@/lib/city/treasury";
import { moodFactors, moodLabel, moodOf } from "@/lib/city/wellbeing";
import { GameIcon } from "./GameIcon";
import { euro, Icon, Pill } from "./Hud";
import { Bar, Frame, Heading, Line, pct, Trend } from "./PanelParts";
import { TaxOfficePanel } from "./TaxOfficePanel";
import { MayorPanel } from "./MayorPanel";
import { RoulettePanel } from "./RoulettePanel";
import { NewspaperPanel } from "./NewspaperPanel";

/*
 * Big HUD panels opened from a building card: the bank (finances and loans), the town
 * hall (analyses, how the citizens feel, building permits) and the tax office
 * (TaxOfficePanel). Same look as the rest of the HUD.
 */

/* ---------- bank ---------- */

function BankPanel() {
  const buildings = useCity((s) => s.buildings);
  const money = useCity((s) => s.money);
  const economy = useCity((s) => s.economy);
  const loans = useCity((s) => s.loans);
  const stats = useCity((s) => s.stats);
  const takeLoan = useCity((s) => s.takeLoan);
  const repayLoan = useCity((s) => s.repayLoan);
  const payments = loanPayments(loans);
  const balance = (economy?.balance ?? 0) - payments;
  const debt = debtOf(loans);
  const limit = creditLimit(economy);
  const businessTaxRate = useCity((s) => s.businessTaxRate);
  const shipSales = useCity((s) => s.shipSales);
  const gameMinutes = useCity((s) => s.gameMinutes);
  const rows = economy ? treasuryReport(economy, buildings, loans, businessTaxRate, salesRate(shipSales, gameMinutes)) : null;
  const top = rows ? Math.max(1, ...rows.income.map((r) => r.value), ...rows.spending.map((r) => r.value)) : 1;
  return (
    <Frame title="Bank – Finanzen der Stadt" icon="bank">
      <div className="px-4 pt-3">
        <div className="text-[11px] text-[#7a8794]">Kontostand</div>
        <div className="text-2xl font-semibold tracking-tight text-[#1d2a35]">{euro(money)}</div>
        <div className={`font-mono text-xs font-semibold ${balance >= 0 ? "text-[#2c8f4e]" : "text-[#c0392b]"}`}>
          {balance >= 0 ? "+" : "−"}
          {euro(Math.abs(balance))} pro Minute{payments > 0 && " (nach Kreditraten)"}
        </div>
      </div>

      <Heading>Verlauf</Heading>
      <Trend samples={stats} pick={(s) => s.money} label="Kontostand" format={euro} />
      <Trend samples={stats} pick={(s) => s.balance} label="Saldo pro Minute" format={euro} />

      {rows && (
        <>
          <Heading>Einnahmen pro Minute</Heading>
          {rows.income.map((r) => (
            <div key={r.label} className="grid grid-cols-[1fr_90px_70px] items-center gap-2 px-4 py-[2px] text-[12px]">
              <span className="text-[#1d5f86]">{r.label}</span>
              <span className="h-2 rounded-full bg-[#2c8f4e]/80" style={{ width: `${(r.value / top) * 100}%` }} />
              <span className="text-right font-mono text-[#1d2a35]">+{euro(r.value)}</span>
            </div>
          ))}
          <Heading>Ausgaben pro Minute</Heading>
          {rows.spending.length === 0 && <div className="px-4 text-[11px] text-[#7a8794]">Keine Ausgaben</div>}
          {rows.spending.map((r) => (
            <div key={r.label} className="grid grid-cols-[1fr_90px_70px] items-center gap-2 px-4 py-[2px] text-[12px]">
              <span className="text-[#1d5f86]">{r.label}</span>
              <span className="h-2 rounded-full bg-[#c0392b]/75" style={{ width: `${(r.value / top) * 100}%` }} />
              <span className="text-right font-mono text-[#c0392b]">−{euro(r.value)}</span>
            </div>
          ))}
        </>
      )}

      <GoldVault />

      <Heading>Kredite</Heading>
      <div className="px-4 py-1">
        <div className="flex items-baseline justify-between text-[12px]">
          <span className="text-[#1d5f86]">Kreditrahmen</span>
          <span className="font-mono text-[#1d2a35]">
            {euro(debt)} / {euro(limit)}
          </span>
        </div>
        <div className="mt-1">
          <Bar value={1 - debt / limit} warn={0.25} />
        </div>
        <div className="mt-1 text-[10px] leading-snug text-[#7a8794]">Der Rahmen wächst mit den Einwohnern und einem positiven Saldo.</div>
      </div>
      {loans.map((l) => (
        <div key={l.id} className="mx-4 my-1.5 rounded-lg border border-black/10 bg-white/70 px-3 py-2">
          <div className="flex items-baseline justify-between text-[12px]">
            <span className="font-semibold text-[#1d2a35]">{l.label}</span>
            <span className="font-mono text-[#c0392b]">−{euro(l.payment)} / min</span>
          </div>
          <div className="mt-1">
            <Bar value={1 - l.remaining / l.total} warn={0} />
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-[#2c3640]">
            <span>
              Rest {euro(l.remaining)} von {euro(l.total)}
            </span>
            <Pill onClick={() => repayLoan(l.id)} disabled={payoffOf(l) > money} title="Restschuld sofort zahlen, keine weiteren Zinsen">
              Ablösen {euro(payoffOf(l))}
            </Pill>
          </div>
        </div>
      ))}
      {loans.length === 0 && <div className="px-4 py-1 text-[11px] text-[#7a8794]">Keine laufenden Kredite.</div>}

      <Heading>Angebote</Heading>
      {LOAN_OFFERS.map((o) => {
        const fits = debt + o.amount <= limit;
        return (
          <div key={o.id} className="mx-4 my-1.5 flex items-center gap-3 rounded-lg border border-black/10 bg-white/70 px-3 py-2">
            <div className="flex-1 text-[12px]">
              <div className="font-semibold text-[#1d2a35]">
                {o.label} · <span className="font-mono text-[#2c8f4e]">{euro(o.amount)}</span>
              </div>
              <div className="text-[11px] text-[#2c3640]">
                {pct(o.interest)} Zinsen · {o.days} Tage · Rate {euro(paymentOf(o))} / min
              </div>
            </div>
            <Pill tone="go" disabled={!fits} onClick={() => takeLoan(o.id)} title={fits ? "Kredit aufnehmen" : "Übersteigt den Kreditrahmen"}>
              Aufnehmen
            </Pill>
          </div>
        );
      })}
    </Frame>
  );
}

/** The town's gold reserve: bars in the vault, price (from the Börse), buy and sell. */
function GoldVault() {
  const gold = useCity((s) => s.gold);
  const money = useCity((s) => s.money);
  const gameMinutes = useCity((s) => s.gameMinutes);
  const exchange = useCity((s) => s.buildings.some((b) => b.kind === "exchange"));
  const goldIn = useCity((s) => s.economy?.goldIn ?? 0);
  const tradeGold = useCity((s) => s.tradeGold);
  const setPanel = useCity((s) => s.setPanel);
  const price = goldQuote(gameMinutes, exchange);
  const buy = goldBuyPrice(gameMinutes, exchange);
  const sell = goldSellPrice(gameMinutes, exchange);
  const day = exchange ? goldDay(gameMinutes) : null;
  const change = day ? day.now / day.open - 1 : 0;
  const bars = Math.floor(gold + 1e-6);
  return (
    <>
      <Heading>Goldtresor</Heading>
      <div className="flex items-center gap-3 px-4 py-1">
        <GameIcon name="gold" size={30} />
        <div className="flex-1">
          <div className="text-[12px] text-[#1d2a35]">
            <span className="font-mono text-base font-semibold">{gold.toLocaleString("de-DE", { maximumFractionDigits: 1 })}</span> Goldbarren
          </div>
          <div className="text-[11px] text-[#2c3640]">Wert heute {euro(gold * sell)}</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[12px] text-[#1d2a35]">{euro(price)} / Barren</div>
          {exchange ? (
            <button className="font-mono text-[11px] underline-offset-2 hover:underline" onClick={() => setPanel("exchange")} title="Börse öffnen">
              <span className={change >= 0 ? "text-[#2c8f4e]" : "text-[#c0392b]"}>
                <Icon name={change >= 0 ? "trendUp" : "trendDown"} className="mr-0.5 inline h-3 w-3 align-[-1px]" />
                {pct(Math.abs(change))} heute
              </span>
            </button>
          ) : (
            <div className="text-[11px] text-[#7a8794]">Festpreis</div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-1">
        <span className="w-16 text-[11px] text-[#1d5f86]">Kaufen</span>
        {[1, 10, 100].map((n) => (
          <Pill key={n} tone="go" disabled={money < buy * n} onClick={() => tradeGold(n)} title={`${n} Barren für ${euro(buy * n)}`}>
            +{n}
          </Pill>
        ))}
        <span className="ml-auto font-mono text-[11px] text-[#2c3640]">{euro(buy)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-1">
        <span className="w-16 text-[11px] text-[#1d5f86]">Verkaufen</span>
        {[1, 10].map((n) => (
          <Pill key={n} disabled={bars < n} onClick={() => tradeGold(-n)} title={`${n} Barren für ${euro(sell * n)}`}>
            −{n}
          </Pill>
        ))}
        <Pill disabled={bars < 1} onClick={() => tradeGold(-bars)} title={`Alle ${bars} Barren für ${euro(sell * bars)}`}>
          Alle
        </Pill>
        <span className="ml-auto font-mono text-[11px] text-[#2c3640]">{euro(sell)}</span>
      </div>
      <div className="px-4 pb-1 text-[10px] leading-snug text-[#7a8794]">
        Die Barren gehören der Stadt.{" "}
        {exchange
          ? "Gehandelt wird zum Goldkurs der Börse – günstig kaufen, teuer verkaufen."
          : `Ohne Börse kauft und verkauft die Bank zum Festpreis von ${euro(GOLD_BASE_PRICE)}. Eine Börse bringt den echten Goldkurs.`}
        {goldIn > 0
          ? ` Die Goldschmelzen liefern gerade ${goldIn.toLocaleString("de-DE", { maximumFractionDigits: 2 })} Barren pro Minute in den Tresor.`
          : " Übrige Barren einer Goldschmelze im Straßennetz der Bank kommen automatisch in den Tresor."}
      </div>
    </>
  );
}

/* ---------- stock exchange ---------- */

/** Chart ranges of the price board. */
const RANGES = [
  { id: "day", label: "1 Tag", span: DAY, points: 144 },
  { id: "week", label: "7 Tage", span: 7 * DAY, points: 168 },
  { id: "month", label: "30 Tage", span: 30 * DAY, points: 180 },
] as const;

/** Price chart with a dashed line at the reference price and min/max labels. */
function PriceChart({ samples }: { samples: { t: number; price: number }[] }) {
  const W = 320;
  const H = 120;
  const values = samples.map((s) => s.price);
  const min = Math.min(...values, GOLD_BASE_PRICE) * 0.98;
  const max = Math.max(...values, GOLD_BASE_PRICE) * 1.02;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / (max - min)) * H;
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const rising = values[values.length - 1] >= values[0];
  const colour = rising ? "#2c8f4e" : "#c0392b";
  return (
    <div className="relative px-4 py-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full rounded-md bg-white/70" preserveAspectRatio="none">
        <line x1={0} x2={W} y1={y(GOLD_BASE_PRICE)} y2={y(GOLD_BASE_PRICE)} stroke="#2c3640" strokeOpacity={0.3} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        <polygon points={`0,${H} ${points} ${W},${H}`} fill={colour} fillOpacity={0.12} />
        <polyline points={points} fill="none" stroke={colour} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-0.5 flex justify-between font-mono text-[10px] text-[#7a8794]">
        <span>Tief {euro(Math.min(...values))}</span>
        <span>gestrichelt: Referenz {euro(GOLD_BASE_PRICE)}</span>
        <span>Hoch {euro(Math.max(...values))}</span>
      </div>
    </div>
  );
}

function ExchangePanel() {
  const gameMinutes = useCity((s) => s.gameMinutes);
  const gold = useCity((s) => s.gold);
  const setPanel = useCity((s) => s.setPanel);
  const hasBank = useCity((s) => s.buildings.some((b) => b.kind === "bank"));
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("day");
  const r = RANGES.find((x) => x.id === range)!;
  // The chart moves on with the clock; resampling every 5 game minutes is plenty.
  const now = Math.floor(gameMinutes / 5) * 5;
  const samples = useMemo(() => goldHistory(now, r.span, r.points), [now, r.span, r.points]);
  const day = goldDay(gameMinutes);
  const change = day.now / day.open - 1;
  const week = goldPrice(Math.max(0, gameMinutes - 7 * DAY));
  const weekChange = week > 0 ? day.now / week - 1 : 0;
  const up = change >= 0;
  return (
    <Frame title="Börse – Kurse" icon="exchange">
      <div className="px-4 pt-3">
        <div className="flex items-center gap-2 text-[11px] text-[#7a8794]">
          <GameIcon name="gold" size={18} /> Gold · Euro je Barren
        </div>
        <div className="flex items-baseline gap-3">
          <div className="text-3xl font-semibold tracking-tight text-[#1d2a35]">{euro(day.now)}</div>
          <div className={`font-mono text-sm font-semibold ${up ? "text-[#2c8f4e]" : "text-[#c0392b]"}`}>
            <Icon name={up ? "trendUp" : "trendDown"} className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
            {up ? "+" : "−"}
            {euro(Math.abs(day.now - day.open))} ({pct(Math.abs(change))})
          </div>
        </div>
        <div className="mt-1 grid grid-cols-4 gap-2 font-mono text-[11px] text-[#2c3640]">
          <div>
            <div className="text-[10px] text-[#7a8794]">Eröffnung</div>
            {euro(day.open)}
          </div>
          <div>
            <div className="text-[10px] text-[#7a8794]">Tageshoch</div>
            {euro(day.high)}
          </div>
          <div>
            <div className="text-[10px] text-[#7a8794]">Tagestief</div>
            {euro(day.low)}
          </div>
          <div>
            <div className="text-[10px] text-[#7a8794]">7 Tage</div>
            <span className={weekChange >= 0 ? "text-[#2c8f4e]" : "text-[#c0392b]"}>
              {weekChange >= 0 ? "+" : "−"}
              {pct(Math.abs(weekChange))}
            </span>
          </div>
        </div>
      </div>

      <Heading>Kursverlauf</Heading>
      <div className="flex gap-1.5 px-4 pb-1">
        {RANGES.map((x) => (
          <Pill key={x.id} active={x.id === range} onClick={() => setRange(x.id)}>
            {x.label}
          </Pill>
        ))}
      </div>
      <PriceChart samples={samples} />

      <Heading>Kursliste</Heading>
      <div className="grid grid-cols-[1fr_80px_70px] items-center gap-2 px-4 py-1 text-[12px]">
        <span className="flex items-center gap-1.5 font-semibold text-[#1d2a35]">
          <GameIcon name="gold" size={16} /> Gold
        </span>
        <span className="text-right font-mono text-[#1d2a35]">{euro(day.now)}</span>
        <span className={`text-right font-mono ${up ? "text-[#2c8f4e]" : "text-[#c0392b]"}`}>
          {up ? "+" : "−"}
          {pct(Math.abs(change))}
        </span>
      </div>
      <div className="px-4 py-1 text-[11px] text-[#7a8794]">Weitere Werte folgen.</div>

      <Heading>Goldtresor der Stadt</Heading>
      <div className="flex items-center justify-between gap-2 px-4 py-1 text-[12px]">
        <span className="text-[#1d5f86]">
          {gold.toLocaleString("de-DE", { maximumFractionDigits: 1 })} Barren · Wert {euro(gold * goldSellPrice(gameMinutes, true))}
        </span>
        <Pill tone="go" disabled={!hasBank} onClick={() => setPanel("bank")} title={hasBank ? "Gold über die Bank kaufen und verkaufen" : "Gehandelt wird über die Bank – erst eine Bank bauen"}>
          Handeln
        </Pill>
      </div>
      <div className="px-4 pb-2 text-[10px] leading-snug text-[#7a8794]">
        Die Bank kauft und verkauft Gold zu diesem Kurs (±{pct(GOLD_SPREAD)}). Der Kurs schwankt in Trends über Wochen, Ausschlägen über Tage und
        kleinen Bewegungen im Minutentakt.
      </div>
    </Frame>
  );
}

/* ---------- town hall ---------- */

function TownHallPanel() {
  const economy = useCity((s) => s.economy);
  const buildings = useCity((s) => s.buildings);
  const stats = useCity((s) => s.stats);
  const flyTo = useCity((s) => s.flyTo);
  const permits = useCity((s) => s.permits);
  const setPermits = useCity((s) => s.setPermits);
  if (!economy) return null;
  const factors = moodFactors(economy);
  const mood = moodOf(factors);
  const complaints = factors.filter((f) => f.score < 0.6).sort((a, b) => a.score * a.weight - b.score * b.weight);
  const houses = buildings.filter((b) => b.kind === "house");
  const firms = buildings.filter((b) => b.kind !== "house" && !PUBLIC.includes(b.kind));
  const losing = firms.filter((b) => (economy.status[b.id]?.finance?.profit ?? 0) < 0);
  const problems = buildings.filter((b) => b.kind !== "house" && economy.status[b.id]?.problem).slice(0, 6);
  const moodColour = mood >= 0.7 ? "#2c8f4e" : mood >= 0.5 ? "#c98a1a" : "#c0392b";
  return (
    <Frame title="Rathaus – Analysen & Bürger" icon="townhall">
      <div className="flex items-center gap-4 px-4 pt-3">
        <div className="grid h-16 w-16 place-items-center rounded-full border-4 text-lg font-bold" style={{ borderColor: moodColour, color: moodColour }}>
          {Math.round(mood * 100)}
        </div>
        <div>
          <div className="text-[11px] text-[#7a8794]">Stimmung der Bürger</div>
          <div className="text-xl font-semibold" style={{ color: moodColour }}>
            {moodLabel(mood)}
          </div>
          <div className="text-[11px] text-[#2c3640]">
            {economy.residents} Einwohner · {economy.households} Haushalte
          </div>
        </div>
      </div>

      <Heading>Baugenehmigungen für Wohnhäuser</Heading>
      <div className="px-4">
        <div className="flex gap-1.5">
          {(
            [
              ["all", "Erteilen"],
              ["upgrades", "Nur Ausbau"],
              ["none", "Baustopp"],
            ] as [Permits, string][]
          ).map(([p, label]) => (
            <Pill key={p} active={permits === p} tone={p === "none" && permits !== p ? "danger" : "default"} onClick={() => setPermits(p)}>
              {label}
            </Pill>
          ))}
        </div>
        <div className={`mt-1 text-[11px] leading-snug ${permits === "all" ? "text-[#2c3640]" : "font-semibold text-[#c0392b]"}`}>{PERMIT_LABEL[permits]}</div>
        <div className="mt-0.5 text-[10px] leading-snug text-[#7a8794]">
          Während des Baustopps kannst du in Ruhe Straßen und Leitungen planen. Zuzug wartet, bis wieder genehmigt wird. Betriebe und öffentliche Gebäude baust du weiterhin selbst.
        </div>
      </div>

      <Heading>Was den Bürgern wichtig ist</Heading>
      {[...factors]
        .sort((a, b) => a.score - b.score)
        .map((f) => (
          <div key={f.id} className="grid grid-cols-[90px_1fr_44px] items-center gap-2 px-4 py-[3px] text-[12px]">
            <span className="text-[#1d5f86]">{f.label}</span>
            <Bar value={f.score} />
            <span className="text-right font-mono text-[11px] text-[#2c3640]">{pct(f.score)}</span>
          </div>
        ))}

      <Heading>Beschwerden</Heading>
      {complaints.length === 0 && <div className="px-4 text-[12px] text-[#2c8f4e]">Keine größeren Beschwerden – weiter so!</div>}
      {complaints.slice(0, 5).map((f) => (
        <div key={f.id} className="flex items-start gap-2 px-4 py-[3px] text-[12px] text-[#c0392b]">
          <GameIcon name="cross" size={14} />
          <span>{f.complaint}</span>
        </div>
      ))}

      <Heading>Entwicklung</Heading>
      <Trend samples={stats} pick={(s) => s.residents} label="Einwohner" format={(v) => String(Math.round(v))} />
      <Trend samples={stats} pick={(s) => s.mood * 100} label="Stimmung" format={(v) => `${Math.round(v)} %`} />

      <Heading>Statistik</Heading>
      {HOUSE_LEVEL_NAME.slice(1).map((name, i) => {
        const n = houses.filter((h) => h.level === i + 1).length;
        return n > 0 ? <Line key={name} label={name} value={String(n)} /> : null;
      })}
      <Line label="Arbeitsplätze / Arbeitskräfte" value={`${Math.round(economy.jobs)} / ${Math.round(economy.workers)}`} />
      <Line label="Beschäftigung" value={pct(economy.employment)} tone={economy.employment < 0.7 ? "bad" : "good"} />
      <Line label="Wasser" value={`${Math.round(economy.waterCapacity)} / ${Math.round(economy.waterDemand)}`} tone={economy.waterCapacity < economy.waterDemand ? "bad" : "good"} sub="Angebot / Bedarf" />
      <Line label="Strom" value={pct(economy.powered)} tone={economy.powered < 0.6 ? "bad" : "good"} sub={`${Math.round(economy.powerSupplied)} / ${Math.round(economy.powerDemand)} kW`} />
      <Line label="Betriebe" value={String(firms.length)} sub={losing.length > 0 ? `${losing.length} mit Verlust` : "alle mit Gewinn"} tone={losing.length > 0 ? "bad" : undefined} />
      <Line label="Gewinn aller Betriebe" value={`${euro(economy.businessProfit)} / min`} tone={economy.businessProfit < 0 ? "bad" : "good"} />

      <Heading>Probleme in der Stadt</Heading>
      {problems.length === 0 && <div className="px-4 text-[12px] text-[#2c8f4e]">Alle Gebäude laufen.</div>}
      {problems.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => flyTo(b.id)}
          className="flex w-full items-start gap-2 px-4 py-[3px] text-left text-[12px] hover:bg-white/60"
          title="Zum Gebäude fahren"
        >
          <GameIcon name={BUILDINGS[b.kind].icon} size={16} />
          <span>
            <span className="font-semibold text-[#1d2a35]">{levelName(b)}:</span> <span className="text-[#c0392b]">{economy.status[b.id]?.problem}</span>
          </span>
        </button>
      ))}
    </Frame>
  );
}

export function CityPanels() {
  const open = useCity((s) => s.panel);
  if (open === "bank") return <BankPanel />;
  if (open === "townhall") return <TownHallPanel />;
  if (open === "taxoffice") return <TaxOfficePanel />;
  if (open === "exchange") return <ExchangePanel />;
  if (open === "mayor") return <MayorPanel />;
  if (open === "casino") return <RoulettePanel />;
  if (open === "newspaper") return <NewspaperPanel />;
  return null;
}
