"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { downloadSave, readSaveFile, readSlot, SLOT_COUNT, writeSlot, type SaveGame } from "@/lib/city/save";
import { ADMIN_MONEY_STEPS, useIsAdmin } from "@/lib/city/admin";
import { GameIcon } from "./GameIcon";
import { HouseLogo } from "./LoadingScreen";
import { CityPanels } from "./CityPanels";
import { SoundDirector, useSoundSettings, VOLUME_STEPS } from "./SoundDirector";
import { loanPayments } from "@/lib/city/finance";
import { PERMIT_LABEL } from "@/lib/city/growth";
import { SALE_WINDOW, salesRate } from "@/lib/city/shipping";
import { treasuryReport } from "@/lib/city/treasury";
import { accessRoad, BUILDINGS, GOOD_ICON, levelName, MAYOR_PRIVATE, RECIPES, type BuildingKind, type Good } from "@/lib/city/economy";
import { NETWORK_COLOURS, networkGaps, rankedNetworks } from "./RoadNetworks";
import { polylineLength } from "@/lib/city/road-geometry";
import { CABLE_COST_PER_M, clockMinutes, CROSSING_MODE_LABEL, isPathTool, useCity, type Tool } from "@/lib/city/store";
import { BUILD_LABEL } from "@/lib/city/types";
import { ACCIDENT_CLEAR, FIRE_BURN, INCIDENT_LABEL } from "@/lib/city/incidents";

/*
 * HUD in the style of SimCity (2013): clean light panels with a soft gradient, dark
 * outlined pill buttons, round glyph buttons in a bottom bar, one blue accent colour and
 * red only for problems. Category buttons open a drawer of cards above the bar.
 */

export const euro = (v: number) => `${Math.round(v).toLocaleString("de-DE")} €`;

/** Shared panel look: white→light grey gradient, hairline border, soft shadow. */
export const panel =
  "rounded-xl border border-white/80 bg-gradient-to-b from-white/95 to-[#e4e8ec]/95 shadow-[0_6px_24px_rgba(20,40,60,0.28)] ring-1 ring-black/5 backdrop-blur-sm";

/* ---------- glyph icons (24×24, currentColor) ---------- */

const ICONS: Record<string, ReactNode> = {
  road: <path d="M9 3 6 21M15 3l3 18M12 5v2.5M12 10.5v3M12 16.5V19" />,
  highway: <path d="M7 3 4 21M17 3l3 18M10 3l-1 18M14 3l1 18M12 5v2M12 10v2M12 15v2" />,
  rail: <path d="M8 3v18M16 3v18M5 6h14M5 10h14M5 14h14M5 18h14" />,
  water: <path d="M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />,
  interchange: <path d="M12 3v18M3 12h18M12 7a5 5 0 1 0 5 5" />,
  economy: <path d="M3 21V10l5 3V10l5 3V5h5v16zM7 17h2M12 17h2M17 17h1" />,
  shop: <path d="M4 10h16l-1-5H5zM5 10v10h14V10M9 20v-5h6v5M4 10c0 1.5 1.3 2.5 2.7 2.5S9.3 11.5 9.3 10c0 1.5 1.2 2.5 2.7 2.5s2.7-1 2.7-2.5c0 1.5 1.2 2.5 2.6 2.5S20 11.5 20 10" />,
  undo: <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  pause: <path d="M9 5v14M15 5v14" />,
  play: <path d="m8 5 11 7-11 7z" />,
  fast: <path d="m4 6 8 6-8 6zM12 6l8 6-8 6z" />,
  faster: <path d="m2 6 6.5 6L2 18zM8.5 6 15 12l-6.5 6zM15 6l6.5 6-6.5 6z" />,
  globe: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  upgrade: <path d="M12 19V5M6 11l6-6 6 6" />,
  demolish: <path d="M4 20h16M7 20l2-9h6l2 9M9 11l1-4h4l1 4M10 7V4h4v3" />,
  warn: <path d="M12 3 2 20h20zM12 10v4M12 17v.5" />,
  supply: <path d="M4 17c4-10 12-10 16 0M4 17h.01M20 17h.01M12 9.5v.01" />,
  service: <path d="M12 3v18M3 12h18M7 7h10v10H7z" />,
  /** Small UI glyphs (instead of text symbols that some systems draw as emoji). */
  trendUp: <path d="M5 16 12 7l7 9z" fill="currentColor" />,
  trendDown: <path d="M5 8l7 9 7-9z" fill="currentColor" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  arrowRight: <path d="M4 12h15m-5-5 5 5-5 5" />,
  /** Shield: police and fire brigade. */
  shield: <path d="M12 3 4 6v6c0 4.5 3.5 8 8 9 4.5-1 8-4.5 8-9V6zM12 7v10M8 12h8" />,
  power: <path d="M13 2 5 13h6l-1 9 8-11h-6z" />,
  /** Airliner seen from above. */
  plane: <path d="M12 2.5c.9 0 1.4 1 1.4 2.2v4.6l7.6 4.4v2l-7.6-2.3v4.1l2.2 1.7v1.6L12 19.9l-3.6.9v-1.6l2.2-1.7v-4.1L3 15.7v-2l7.6-4.4V4.7c0-1.2.5-2.2 1.4-2.2z" />,
  /** Road network: three junctions joined by roads. */
  network: <path d="M12 4.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM6 15.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM18 15.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM11 8.3 7 15.7M13 8.3l4 7.4M8 17.5h8" />,
  drop: <path d="M12 3c3.5 4.5 6 8 6 11a6 6 0 0 1-12 0c0-3 2.5-6.5 6-11z" />,
  /** Excavator: tracks, cab, boom and bucket. */
  bulldoze: <path d="M4 17h9a2 2 0 0 1 0 4H4a2 2 0 0 1 0-4zM3 17v-4h5V9h4l2 4v4M10 9v4M14 12l4-7 3 4M21 9l1 4h-3.5l.8-3" />,
  people: <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M16 11a3 3 0 1 0 0-6M21 20c0-3-1.8-5.3-4.5-5.9" />,
};

export function Icon({ name, className = "h-5 w-5" }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

/** Round glyph button of the bottom bar. */
function RoundButton({
  icon,
  label,
  active,
  onClick,
  small,
}: {
  icon: keyof typeof ICONS;
  label: string;
  active?: boolean;
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`grid place-items-center rounded-full border-2 transition ${small ? "h-8 w-8" : "h-11 w-11"} ${
        active
          ? "border-[#1a9bd7] bg-gradient-to-b from-[#4fc0f0] to-[#1a8fc8] text-white shadow-[0_0_0_3px_rgba(26,155,215,0.25)]"
          : "border-[#3d4650] bg-gradient-to-b from-white to-[#d6dce2] text-[#2c3640] hover:from-white hover:to-white"
      }`}
    >
      <Icon name={icon} className={small ? "h-4 w-4" : "h-5 w-5"} />
    </button>
  );
}

/** Dark-outlined pill (tabs and secondary actions). */
export function Pill({
  children,
  active,
  onClick,
  tone = "default",
  disabled,
  title,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  tone?: "default" | "danger" | "go";
  disabled?: boolean;
  title?: string;
}) {
  const colours = active
    ? "border-[#1a9bd7] text-[#1a8fc8] bg-white shadow-[0_0_0_2px_rgba(26,155,215,0.25)]"
    : tone === "danger"
      ? "border-[#c0392b] text-[#c0392b] bg-gradient-to-b from-white to-[#f3e1df]"
      : tone === "go"
        ? "border-[#2c8f4e] text-white bg-gradient-to-b from-[#4cc277] to-[#2c8f4e]"
        : "border-[#3d4650] text-[#2c3640] bg-gradient-to-b from-white to-[#dfe4e9]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-full border-2 px-3 py-0.5 text-[11px] font-semibold tracking-wide transition hover:brightness-105 disabled:opacity-40 ${colours}`}
    >
      {children}
    </button>
  );
}

/* ---------- top left: city panel ---------- */

function BudgetLine({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-3 py-[2px] text-[11px]">
      <span className="text-[#1d5f86]">
        {label}
        {sub && <span className="ml-1 text-[10px] text-[#7a8794]">{sub}</span>}
      </span>
      <span className={`font-mono ${value < 0 ? "text-[#c0392b]" : "text-[#1d2a35]"}`}>
        {value < 0 ? "−" : "+"}
        {euro(Math.abs(value))}
      </span>
    </div>
  );
}

/** Short budget without a tax office: where the money comes from and where it goes. */
function BudgetPanel() {
  const economy = useCity((s) => s.economy);
  const loans = useCity((s) => s.loans);
  const buildings = useCity((s) => s.buildings);
  const businessTaxRate = useCity((s) => s.businessTaxRate);
  const shipSales = useCity((s) => s.shipSales);
  const gameMinutes = useCity((s) => s.gameMinutes);
  if (!economy) return null;
  const r = treasuryReport(economy, buildings, loans, businessTaxRate, salesRate(shipSales, gameMinutes));
  return (
    <div className="border-t border-black/10 bg-white/60 py-1">
      <div className="px-3 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a8794]">Einnahmen der Stadt / min</div>
      {r.income.map((l) => (
        <BudgetLine key={l.id} label={l.label} sub={l.sub} value={l.value} />
      ))}
      <div className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a8794]">Ausgaben der Stadt / min</div>
      {r.spending.map((l) => (
        <BudgetLine key={l.id} label={l.label} value={-l.value} />
      ))}
      <div className="mt-0.5 border-t border-black/10 pt-0.5">
        <BudgetLine label="Saldo" value={r.balance} />
      </div>
      <div className="px-3 pt-1 text-[10px] leading-snug text-[#7a8794]">
        Steuersätze, Auswertungen und Steuerzahler gibt es im Finanzamt (Versorgung{" "}
        <Icon name="arrowRight" className="inline h-2.5 w-2.5 align-[-1px]" /> Finanzamt).
      </div>
    </div>
  );
}

function CityPanel() {
  const money = useCity((s) => s.money);
  const economy = useCity((s) => s.economy);
  const [showBudget, setShowBudget] = useState(false);
  const hasTaxOffice = useCity((s) => s.buildings.some((b) => b.kind === "taxoffice"));
  const setPanel = useCity((s) => s.setPanel);
  const freeze = useCity((s) => (s.permits !== "all" && s.buildings.some((b) => b.kind === "townhall") ? s.permits : null));
  const loans = useCity((s) => s.loans);
  const shipSales = useCity((s) => s.shipSales);
  const gameMinutes = useCity((s) => s.gameMinutes);
  // Ship sales come in lumps; the balance shows their average over the last game day.
  const shipRate = salesRate(shipSales, gameMinutes);
  const shipDay = shipRate * (SALE_WINDOW / 60);
  const balance = (economy?.balance ?? 0) - loanPayments(loans) + shipRate;
  // The latest sale flashes next to the money for a few game minutes.
  const last = shipSales[shipSales.length - 1];
  const lastSale = last && gameMinutes - last.t <= 20 ? last : null;
  return (
    <div className={`pointer-events-auto absolute left-3 top-3 w-72 overflow-hidden ${panel}`}>
      <div className="flex items-center gap-2 border-b border-black/10 px-3 py-1.5">
        <HouseLogo className="h-6 w-7 text-[#1a8fc8]" />
        <span className="text-sm font-semibold text-[#1d5f86]">Citypower</span>
      </div>
      <button
        type="button"
        onClick={() => (hasTaxOffice ? setPanel("taxoffice") : setShowBudget((v) => !v))}
        title={hasTaxOffice ? "Finanzamt öffnen: Steuern und Haushalt" : "Stadthaushalt anzeigen"}
        className="block w-full px-3 py-2 text-left hover:bg-white/50"
      >
        <div className={`flex items-center justify-between font-mono text-xs font-semibold ${balance >= 0 ? "text-[#2c8f4e]" : "text-[#c0392b]"}`}>
          <span>
            {balance >= 0 ? "+" : "−"}
            {euro(Math.abs(balance))} pro Minute
          </span>
          <span className="flex items-center gap-0.5 font-sans text-[10px] font-normal text-[#1a8fc8]">
            {hasTaxOffice ? "Finanzamt" : "Haushalt"}
            <Icon name={hasTaxOffice ? "chevronRight" : showBudget ? "chevronUp" : "chevronDown"} className="h-3 w-3" />
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-lg font-semibold tracking-tight text-[#1d2a35]">{euro(money)}</span>
          {lastSale && (
            <span key={lastSale.t} className="animate-pulse font-mono text-xs font-semibold text-[#2c8f4e]" title={`Schiffsexport${lastSale.ship ? ` „${lastSale.ship}“` : ""}`}>
              +{euro(lastSale.value)}
            </span>
          )}
        </div>
        {shipRate > 0 && (
          <div className="flex items-center gap-1 text-[10px] text-[#2c3640]" title="Schiffe verkaufen in Schüben; im Saldo steht der Schnitt des letzten Spieltags">
            <GameIcon name="ship" size={12} />
            Schiffe: +{euro(shipDay)} am letzten Tag
          </div>
        )}
      </button>
      {showBudget && !hasTaxOffice && <BudgetPanel />}
      <div className="flex items-center justify-between gap-2 whitespace-nowrap border-t border-black/10 px-3 py-1.5 text-xs text-[#2c3640]">
        <span className="flex items-center gap-1.5" title="Einwohner · Haushalte · Wachstum (Geburten und Zuzug)">
          <GameIcon name="people" size={15} />
          {count(economy?.residents ?? 0)}
          <span className="text-[10px] text-[#7a8794]">· {economy?.households ?? 0} Haush.</span>
          {economy && economy.births + economy.immigration > 0 && (
            <span className="font-mono text-[10px] text-[#2c8f4e]">+{((economy.births + economy.immigration) * 60).toFixed(0)}/h</span>
          )}
        </span>
        {economy && (
          <span className={economy.waterCapacity < economy.waterDemand ? "font-semibold text-[#c0392b]" : ""}>
            <GameIcon name="water" size={14} /> {count(economy.waterCapacity)}/{count(economy.waterDemand)}
          </span>
        )}
      </div>
      {economy && (
        <div className="flex items-center justify-between gap-2 whitespace-nowrap border-t border-black/10 px-3 py-1.5 text-xs text-[#2c3640]">
          <span
            className={economy.jobs > economy.workers * 1.05 ? "font-semibold text-[#c0392b]" : ""}
            title={economy.jobs > economy.workers * 1.05 ? "Arbeitsplätze / Arbeitskräfte – es fehlen Arbeitskräfte (Häuser ausbauen lassen)" : "Arbeitsplätze / Arbeitskräfte"}
          >
            <GameIcon name="jobs" size={14} /> {count(economy.jobs)} / {count(economy.workers)}
          </span>
          <span className={economy.employment < 0.7 ? "font-semibold text-[#c0392b]" : ""} title="Beschäftigung der Einwohner">
            {Math.round(economy.employment * 100)} % Arbeit
          </span>
          <span className={economy.education < 0.8 ? "font-semibold text-[#c0392b]" : ""} title="Schulplätze">
            <GameIcon name="education" size={14} /> {Math.round(economy.education * 100)} %
          </span>
          <span className={economy.powered < 0.6 ? "font-semibold text-[#c0392b]" : ""} title="Strom: gedeckter Bedarf">
            <GameIcon name="power" size={14} /> {Math.round(economy.powered * 100)} %
          </span>
        </div>
      )}
      {freeze && (
        <button
          type="button"
          onClick={() => setPanel("townhall")}
          className="block w-full border-t border-black/10 bg-[#f3e1df] px-3 py-1 text-left text-[11px] font-semibold text-[#c0392b] hover:brightness-105"
          title="Im Rathaus ändern"
        >
          {freeze === "none" ? "Baustopp: keine neuen Wohnhäuser" : "Nur Ausbau: keine neuen Wohnhäuser"}
        </button>
      )}
    </div>
  );
}

/** Whole number with thousands separators (German). */
const count = (n: number) => Math.round(n).toLocaleString("de-DE");

/* ---------- top centre: message ticker ---------- */

function Ticker() {
  const tool = useCity((s) => s.tool);
  const placing = useCity((s) => s.placing);
  const draft = useCity((s) => s.draft);
  const notice = useCity((s) => s.notice);
  const economy = useCity((s) => s.economy);
  const freeze = useCity((s) => (s.permits !== "all" && s.buildings.some((b) => b.kind === "townhall") ? s.permits : null));

  let text = "Willkommen! Wähle unten eine Kategorie zum Bauen. · Ziehen: verschieben · Rechts ziehen: drehen · Scrollen: Zoom";
  let alert = false;
  if (isPathTool(tool)) text = draft.length === 0 ? "Klicke, um den Startpunkt zu setzen" : "Weitere Punkte klicken · Enter = fertig · Esc = abbrechen";
  if (tool === "interchange") text = "Anschlussstelle: auf eine Straße setzen, die eine Autobahn kreuzt";
  if (tool === "cloverleaf") text = "Autobahnkreuz: auf eine Autobahn setzen – grün = passt, Klick = bauen";
  if (tool === "cable")
    text =
      draft.length === 0
        ? "Stromleitung: am Kraftwerk beginnen (rastet am Schaltfeld ein)"
        : "Masten setzen · an einer Trafostation oder Leitung enden · Enter = fertig · Esc = abbrechen";
  if (tool === "bulldoze") text = "Abriss: auf eine Straße, ein Gleis, einen Kanal oder eine Stromleitung klicken – rot = dieses Stück wird abgerissen · Esc = beenden";
  if (tool === "trumpet") text = "Autobahndreieck: auf das Ende einer Autobahn setzen, die an einer anderen endet";
  if (placing)
    text =
      placing === "transformer"
        ? "Trafostation frei setzen (keine Straße nötig) – gelb = Umkreis der vorhandenen, Klick = bauen"
        : `${BUILDINGS[placing].label} an eine Straße setzen – grün = passt, Klick = bauen`;
  if (!tool && !placing && freeze) text = `${PERMIT_LABEL[freeze]} (Rathaus)`;
  else if (!tool && !placing && economy?.growthLimit) {
    text = economy.growthLimit + (economy.growthLimit.includes("Krankenhaus") ? " – baue eins (Versorgung)" : "");
    alert = true;
  }
  if (notice) {
    text = notice;
    alert = /nicht|kein|zu |überschneid|wasser|brand|unfall|abgebrannt/i.test(notice) && !/gebaut|ausgebaut|ausgelöst/i.test(notice);
  }
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 w-[min(70vw,640px)] -translate-x-1/2">
      <div className={`flex items-center gap-2 px-4 py-1.5 text-xs ${panel} ${alert ? "text-[#c0392b]" : "text-[#2c3640]"}`}>
        {alert && <Icon name="warn" className="h-4 w-4 shrink-0" />}
        <span className="truncate">{text}</span>
      </div>
    </div>
  );
}

/* ---------- bottom bar and drawers ---------- */

type Category = "roads" | "interchanges" | "rail" | "water" | "air" | "services" | "safety" | "power" | "economy" | "industry";

interface Card {
  tool?: Tool;
  building?: BuildingKind;
  /** Key of the 3D preview image. */
  thumb: string;
  title: string;
  icon: string;
  price?: number;
  hotkey?: string;
  description: string;
}

const buildingCards = (kinds: BuildingKind[]): Card[] =>
  kinds.map((kind) => ({
    building: kind,
    thumb: kind,
    title: BUILDINGS[kind].label,
    icon: BUILDINGS[kind].icon,
    price: BUILDINGS[kind].cost,
    description: BUILDINGS[kind].description,
  }));

/** Sub-tabs of a big category; the category's cards are all of them in order. */
interface CardGroup {
  label: string;
  cards: Card[];
}
const grouped = (groups: [string, BuildingKind[]][]) => {
  const gs: CardGroup[] = groups.map(([label, kinds]) => ({ label, cards: buildingCards(kinds) }));
  return { groups: gs, cards: gs.flatMap((g) => g.cards) };
};

const CATEGORIES: { id: Category; label: string; icon: keyof typeof ICONS; cards: Card[]; groups?: CardGroup[] }[] = [
  {
    id: "roads",
    label: "Straßen",
    icon: "road",
    cards: [
      { tool: "street", thumb: "street", title: BUILD_LABEL.street, icon: "road", hotkey: "1", description: "Zweispurig mit Gehwegen, Laternen und Leitungen" },
      { tool: "highway", thumb: "highway", title: BUILD_LABEL.highway, icon: "highway", hotkey: "2", description: "Vier Spuren, Mittelstreifen, höhenfreie Kreuzungen" },
      { tool: "bike", thumb: "bike", title: BUILD_LABEL.bike, icon: "bike", hotkey: "3", description: "Roter Zweirichtungsradweg" },
    ],
  },
  {
    id: "interchanges",
    label: "Autobahn-Knoten",
    icon: "interchange",
    cards: [
      { tool: "interchange", thumb: "interchange", title: "Anschlussstelle", icon: "interchange", hotkey: "7", description: "Raute mit vier Rampen an einer Straße" },
      { tool: "cloverleaf", thumb: "cloverleaf", title: "Autobahnkreuz", icon: "cloverleaf", hotkey: "8", description: "Kleeblatt mit Verflechtungsstreifen" },
      { tool: "trumpet", thumb: "trumpet", title: "Autobahndreieck", icon: "trumpet", hotkey: "9", description: "Trompete für eine endende Autobahn" },
    ],
  },
  {
    id: "rail",
    label: "Schiene",
    icon: "rail",
    cards: [
      { tool: "rail", thumb: "rail", title: BUILD_LABEL.rail, icon: "rail", hotkey: "4", description: "Eingleisig mit Oberleitung" },
      { tool: "rail2", thumb: "rail2", title: BUILD_LABEL.rail2, icon: "rail2", hotkey: "5", description: "Zweigleisig mit Oberleitung" },
      ...buildingCards(["trainstation", "traindepot"]),
    ],
  },
  {
    id: "water",
    label: "Wasserwege",
    icon: "water",
    cards: [
      { tool: "canal", thumb: "canal", title: BUILD_LABEL.canal, icon: "canal", hotkey: "6", description: "Kanal mit Kaimauern, im Flachland (sanfte Hügel bis 4 m im Einschnitt)" },
      ...buildingCards(["harbour"]),
    ],
  },
  {
    id: "air",
    label: "Luftfahrt",
    icon: "plane",
    cards: buildingCards(["airport"]),
  },
  {
    id: "services",
    label: "Versorgung",
    icon: "service",
    ...grouped([
      ["Grundversorgung", ["waterworks", "hospital", "school"]],
      ["Verwaltung & Finanzen", ["townhall", "taxoffice", "jobcenter", "bank", "exchange", "villa", "boathouse"]],
      ["Erholung", ["park", "playground"]],
    ]),
  },
  {
    id: "safety",
    label: "Sicherheit",
    icon: "shield",
    cards: buildingCards(["police", "firestation", "prison"]),
  },
  {
    id: "power",
    label: "Energie",
    icon: "power",
    cards: [
      ...buildingCards(["powerplant"]),
      {
        tool: "cable",
        thumb: "cable",
        title: "Stromleitung",
        icon: "cable",
        description: `Freileitung mit Masten vom Kraftwerk zu Trafostationen · ${CABLE_COST_PER_M} € pro Meter`,
      },
      ...buildingCards(["transformer", "coalmine", "uraniummine"]),
    ],
  },
  {
    id: "economy",
    label: "Wirtschaft",
    icon: "shop",
    ...grouped([
      ["Lebensmittel", ["bakery", "butcher", "discounter"]],
      ["Läden", ["furniturestore", "shoeshop", "fashion", "jeweller"]],
      ["Freizeit & Medien", ["restaurant", "pizzeria", "cinema", "pool", "fair", "casino", "newspaper"]],
    ]),
  },
  {
    id: "industry",
    label: "Industrie",
    icon: "economy",
    ...grouped([
      ["Landwirtschaft", ["farm", "mill", "chickenfarm", "sheepfarm", "slaughterhouse"]],
      ["Rohstoffe", ["ironmine", "goldmine", "sawmill", "recycling"]],
      ["Fabriken", ["steelworks", "furniture", "tannery", "rubberfactory", "shoefactory", "spinning", "clothing", "foodfactory", "goldsmelter"]],
      ["Handel & Lager", ["trader", "warehouse"]],
    ]),
  },
];

function Drawer({ category }: { category: (typeof CATEGORIES)[number] }) {
  const tool = useCity((s) => s.tool);
  const placing = useCity((s) => s.placing);
  const money = useCity((s) => s.money);
  const account = useCity((s) => s.mayor.account);
  const setTool = useCity((s) => s.setTool);
  const startPlacing = useCity((s) => s.startPlacing);
  // Sub-tab (opens on the one with the active card) and a search over every category.
  const activeGroup = category.groups?.findIndex((g) => g.cards.some((c) => c.building === placing || (c.tool && c.tool === tool))) ?? -1;
  const [group, setGroup] = useState(Math.max(0, activeGroup));
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const cards = q
    ? CATEGORIES.flatMap((c) => c.cards).filter((c) => c.title.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q))
    : (category.groups?.[group]?.cards ?? category.cards);
  return (
    <div className={`pointer-events-auto mx-auto mb-2 w-fit max-w-[min(96vw,980px)] ${panel}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-black/10 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#1d5f86]">{q ? "Suche" : category.label}</span>
        {!q && category.groups && (
          <div className="flex flex-wrap gap-1">
            {category.groups.map((g, i) => (
              <button
                key={g.label}
                type="button"
                onClick={() => setGroup(i)}
                className={`rounded-full border px-2.5 py-[2px] text-[11px] font-semibold transition ${
                  i === group ? "border-[#1a9bd7] bg-white text-[#1a8fc8] shadow-[0_0_0_2px_rgba(26,155,215,0.2)]" : "border-[#2c3640]/25 text-[#2c3640] hover:bg-white/70"
                }`}
              >
                {g.label} <span className="font-normal text-[#7a8794]">{g.cards.length}</span>
              </button>
            ))}
          </div>
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Keep building hotkeys (Space, digits …) out of the game while typing.
            e.stopPropagation();
            if (e.key === "Escape") setQuery("");
          }}
          placeholder="Gebäude suchen …"
          className="ml-auto w-40 rounded-full border border-[#2c3640]/25 bg-white/80 px-3 py-[3px] text-[11px] text-[#1d2a35] outline-none placeholder:text-[#7a8794] focus:border-[#1a9bd7]"
        />
      </div>
      {cards.length === 0 && <div className="px-4 py-3 text-[12px] text-[#7a8794]">Nichts gefunden.</div>}
      <div className="grid max-h-[46vh] grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2 overflow-y-auto p-2" style={{ width: `min(94vw, ${Math.min(6, Math.max(1, cards.length)) * 9.1 + 1}rem)` }}>
        {cards.map((card) => {
          const active = card.tool ? tool === card.tool : placing === card.building;
          // The villa is paid from the mayor's private account.
          const tooExpensive = card.price !== undefined && card.price > (card.building && MAYOR_PRIVATE.includes(card.building) ? account : money);
          return (
            <button
              key={card.title}
              type="button"
              disabled={tooExpensive}
              title={card.description}
              onClick={() => {
                if (card.tool) setTool(active ? null : card.tool);
                else if (card.building) startPlacing(active ? null : card.building);
              }}
              className={`group relative flex flex-col items-center rounded-lg border-2 p-2 text-center transition disabled:opacity-40 ${
                active
                  ? "border-[#1a9bd7] bg-white shadow-[0_0_0_3px_rgba(26,155,215,0.22)]"
                  : "border-transparent bg-white/60 hover:border-[#b9c4cd] hover:bg-white"
              }`}
            >
              {card.hotkey && (
                <kbd className="absolute right-1.5 top-1.5 rounded bg-[#2c3640]/10 px-1 font-mono text-[10px] text-[#2c3640]">
                  {card.hotkey}
                </kbd>
              )}
              <Illustration icon={card.icon} />
              <span className="mt-1.5 text-xs font-semibold text-[#1d2a35]">{card.title}</span>
              <span className={`text-[11px] font-mono ${tooExpensive ? "text-[#c0392b]" : "text-[#2c8f4e]"}`}>
                {card.price !== undefined ? euro(card.price) : " "}
              </span>
              {card.building && <RecipeLine kind={card.building} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "braucht … · liefert …" for a building card, from its recipe, water and workers. */
function RecipeLine({ kind }: { kind: BuildingKind }) {
  const spec = BUILDINGS[kind];
  const recipe = RECIPES[kind];
  const needs = [
    ...Object.entries(recipe?.inputs ?? {}).map(([g, v]) => [GOOD_ICON[g as Good], v ?? 0] as const),
    spec.water > 0 ? (["water", spec.water] as const) : null,
    spec.jobs > 0 ? (["worker", spec.jobs] as const) : null,
  ].filter((x): x is readonly [string, number] => !!x);
  const makes = Object.entries(recipe?.outputs ?? {}).map(([g, v]) => [GOOD_ICON[g as Good], v ?? 0] as const);
  const list = (items: readonly (readonly [string, number])[]) =>
    items.map(([icon, v]) => (
      <span key={icon} className="inline-flex items-center gap-0.5">
        <GameIcon name={icon} size={12} />
        {v}
      </span>
    ));
  return (
    <span className="mt-0.5 flex w-full flex-col gap-0.5 border-t border-black/10 pt-1 text-left text-[10px] leading-tight text-[#2c3640]">
      {needs.length > 0 && <span className="flex flex-wrap items-center gap-x-1.5">braucht {list(needs)}</span>}
      {makes.length > 0 && <span className="flex flex-wrap items-center gap-x-1.5 text-[#1d5f86]">liefert {list(makes)} /min</span>}
    </span>
  );
}

/** Card picture: the game's own illustration (no rendered 3D preview). */
function Illustration({ icon }: { icon: string }) {
  return (
    <span className="relative grid h-20 w-full place-items-center overflow-hidden rounded-md bg-gradient-to-b from-[#dceef8] to-[#a9cbe0]">
      <GameIcon name={icon} size={52} />
    </span>
  );
}

function DraftChip() {
  const tool = useCity((s) => s.tool);
  const draft = useCity((s) => s.draft);
  const cursor = useCity((s) => s.cursor);
  const crossingMode = useCity((s) => s.crossingMode);
  const cycleCrossingMode = useCity((s) => s.cycleCrossingMode);
  const finishDraft = useCity((s) => s.finishDraft);
  const cancelDraft = useCity((s) => s.cancelDraft);
  if (!isPathTool(tool) && tool !== "cable") return null;
  const preview = cursor && draft.length > 0 ? [...draft, cursor] : draft;
  return (
    <div className={`pointer-events-auto mx-auto mb-2 flex w-fit items-center gap-2 px-3 py-1.5 ${panel}`}>
      <span className="font-mono text-xs text-[#2c3640]">
        {draft.length} Pkt · {Math.round(polylineLength(preview))} m
      </span>
      {tool === "cable" && <span className="font-mono text-xs text-[#2c8f4e]">{euro(Math.round(polylineLength(preview) * CABLE_COST_PER_M))}</span>}
      {tool !== "canal" && tool !== "cable" && (
        <Pill onClick={cycleCrossingMode} title="Wie der neue Weg andere Wege kreuzt (Taste B)">
          Querung: {CROSSING_MODE_LABEL[crossingMode]}
        </Pill>
      )}
      {draft.length >= 2 && (
        <Pill tone="go" onClick={finishDraft}>
          Fertig
        </Pill>
      )}
      {draft.length > 0 && <Pill onClick={cancelDraft}>Abbrechen</Pill>}
    </div>
  );
}

/** Legend of the road network overlay: networks with their size, unconnected buildings, gaps. */
function NetworkLegend() {
  const roads = useCity((s) => s.roads);
  const buildings = useCity((s) => s.buildings);
  const info = useMemo(() => {
    const { nets, sizes } = rankedNetworks(roads);
    const served = sizes.map(() => 0);
    let unserved = 0;
    for (const b of buildings) {
      if (b.kind === "house") continue;
      const r = accessRoad(b, roads);
      const n = r ? nets.get(r.id) : undefined;
      if (n === undefined) unserved++;
      else served[n]++;
    }
    return { sizes, served, unserved, gaps: networkGaps(roads, nets).length };
  }, [roads, buildings]);
  return (
    <div className={`pointer-events-auto mr-3 mb-2 ml-auto flex w-fit max-w-[560px] flex-col gap-1 px-3 py-2 text-[11px] text-[#2c3640] ${panel}`}>
      <div className="font-semibold text-[#1d5f86]">
        {info.sizes.length === 1 ? "1 Straßennetz – alles verbunden" : `${info.sizes.length} getrennte Straßennetze`}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {info.sizes.slice(0, 8).map((n, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: NETWORK_COLOURS[i] }} />
            {n} Straßen · {info.served[i]} Betriebe
          </span>
        ))}
        {info.sizes.length > 8 && <span>+{info.sizes.length - 8} weitere</span>}
      </div>
      {info.unserved > 0 && <div className="text-[#c0392b]">{info.unserved} Gebäude ohne Straßenanschluss (rot)</div>}
      {info.gaps > 0 && <div className="text-[#c0392b]">{info.gaps} Straßenenden knapp vor einem anderen Netz (roter Ring) – dort verbinden</div>}
      <div className="text-[10px] text-[#7a8794]">Waren, Wasser und Kunden kommen nur innerhalb eines Netzes an.</div>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Game clock: follows the smooth clock (a minute at a time, also between the ticks at speed 2–3). */
function Clock() {
  const speed = useCity((s) => s.speed);
  const ticked = useCity((s) => s.gameMinutes);
  const [minutes, setMinutes] = useState(ticked);
  useEffect(() => {
    const update = () => setMinutes(Math.floor(clockMinutes()));
    update();
    if (speed === 0) return;
    const id = window.setInterval(update, 1000 / Math.max(1, speed) / 2);
    return () => window.clearInterval(id);
  }, [speed, ticked]);
  const day = Math.floor(minutes / 1440) + 1;
  const m = Math.floor(minutes) % 1440;
  return (
    <span className="font-mono text-[11px] text-[#2c3640]">
      Tag {day} · {pad(Math.floor(m / 60))}:{pad(m % 60)}
    </span>
  );
}

function BottomBar() {
  const [open, setOpen] = useState<Category | null>(null);
  const tool = useCity((s) => s.tool);
  const placing = useCity((s) => s.placing);
  const speed = useCity((s) => s.speed);
  const setSpeed = useCity((s) => s.setSpeed);
  const setTool = useCity((s) => s.setTool);
  const undo = useCity((s) => s.undo);
  const newWorld = useCity((s) => s.newWorld);
  const showSupply = useCity((s) => s.showSupply);
  const toggleSupply = useCity((s) => s.toggleSupply);
  const showPower = useCity((s) => s.showPower);
  const togglePower = useCity((s) => s.togglePower);
  const showWater = useCity((s) => s.showWater);
  const toggleWater = useCity((s) => s.toggleWater);
  const showNetworks = useCity((s) => s.showNetworks);
  const toggleNetworks = useCity((s) => s.toggleNetworks);

  // The category of the active tool stays highlighted even when the drawer is closed.
  const activeCategory = CATEGORIES.find((c) =>
    c.cards.some((card) => (card.tool && card.tool === tool) || (card.building && card.building === placing)),
  )?.id;
  const shown = CATEGORIES.find((c) => c.id === open);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0">
      <DraftChip />
      {showNetworks && <NetworkLegend />}
      {shown && <Drawer key={shown.id} category={shown} />}
      <div className="pointer-events-auto flex items-center justify-between gap-4 border-t border-white/80 bg-gradient-to-b from-white/95 to-[#d9dfe5]/95 px-3 py-1.5 shadow-[0_-4px_20px_rgba(20,40,60,0.2)]">
        {/* Speed controls and clock. */}
        <div className="flex items-center gap-1.5">
          <RoundButton small icon="pause" label="Pause" active={speed === 0} onClick={() => setSpeed(0)} />
          <RoundButton small icon="play" label="Normal" active={speed === 1} onClick={() => setSpeed(1)} />
          <RoundButton small icon="fast" label="Schnell" active={speed === 2} onClick={() => setSpeed(2)} />
          <RoundButton small icon="faster" label="Sehr schnell" active={speed === 3} onClick={() => setSpeed(3)} />
          <span className="ml-2">
            <Clock />
          </span>
        </div>

        {/* Categories. */}
        <div className="flex items-center gap-2">
          {CATEGORIES.map((c) => (
            <RoundButton
              key={c.id}
              icon={c.icon}
              label={c.label}
              active={open === c.id || (open === null && activeCategory === c.id)}
              onClick={() => {
                if (open === c.id) {
                  setOpen(null);
                  setTool(null);
                } else setOpen(c.id);
              }}
            />
          ))}
          <span className="mx-1 h-7 w-px bg-black/15" />
          <RoundButton
            icon="bulldoze"
            label="Abreißen: Straßen, Gleise, Kanäle, Stromleitungen"
            active={tool === "bulldoze"}
            onClick={() => {
              setOpen(null);
              setTool(tool === "bulldoze" ? null : "bulldoze");
            }}
          />
        </div>

        {/* Undo and world. */}
        <div className="flex items-center gap-1.5">
          <RoundButton small icon="power" label="Stromnetz anzeigen" active={showPower} onClick={togglePower} />
          <RoundButton small icon="drop" label="Wasserversorgung anzeigen" active={showWater} onClick={toggleWater} />
          <RoundButton small icon="network" label="Straßennetze anzeigen" active={showNetworks} onClick={toggleNetworks} />
          <RoundButton small icon="supply" label="Lieferketten anzeigen" active={showSupply} onClick={toggleSupply} />
          <RoundButton small icon="undo" label="Zurück (Strg+Z)" onClick={undo} />
          <RoundButton
            small
            icon="globe"
            label="Neue Welt erzeugen"
            onClick={() => {
              if (window.confirm("Neue Welt erzeugen? Alles Gebaute geht verloren.")) newWorld(Math.floor(Math.random() * 1e9));
            }}
          />
        </div>
      </div>
    </div>
  );
}

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Save / load menu (top right): three slots in the browser, export and import as a file. */
function SaveMenu({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const toSave = useCity((s) => s.toSave);
  const loadGame = useCity((s) => s.loadGame);
  const [slots, setSlots] = useState<(SaveGame | null)[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const refresh = () => setSlots(Array.from({ length: SLOT_COUNT }, (_, i) => readSlot(i)));

  return (
    <div className="relative flex flex-col items-end">
      <button
        type="button"
        onClick={() => {
          if (!open) refresh();
          setMessage(null);
          onToggle();
        }}
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-xs font-semibold transition ${
          open
            ? "border-[#1a9bd7] bg-white text-[#1a8fc8] shadow-[0_0_0_2px_rgba(26,155,215,0.25)]"
            : "border-[#3d4650] bg-gradient-to-b from-white to-[#dfe4e9] text-[#2c3640]"
        }`}
      >
        <GameIcon name="disk" size={14} /> Spielstand
      </button>
      {open && (
        <div className={`absolute right-0 top-full z-20 mt-1.5 w-72 overflow-hidden ${panel}`}>
          <div className="border-b border-black/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#1d5f86]">
            Speicherplätze
          </div>
          <div className="flex flex-col gap-1.5 p-2">
            {slots.map((slot, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-lg bg-white/70 px-2 py-1.5">
                <div className="min-w-0 text-[11px] leading-tight">
                  <div className="font-semibold text-[#1d2a35]">Platz {i + 1}</div>
                  <div className="truncate text-[#7a8794]">
                    {slot
                      ? `${dateTime(slot.savedAt)} · ${slot.summary.residents} Einw. · ${euro(slot.money)}`
                      : "leer"}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Pill
                    tone="go"
                    onClick={() => {
                      const ok = writeSlot(i, toSave());
                      setMessage(ok ? `Auf Platz ${i + 1} gespeichert` : "Speichern fehlgeschlagen (Browser-Speicher voll?)");
                      refresh();
                    }}
                  >
                    Speichern
                  </Pill>
                  <Pill
                    disabled={!slot}
                    onClick={() => {
                      if (slot && window.confirm(`Platz ${i + 1} laden? Nicht gespeicherter Fortschritt geht verloren.`)) {
                        loadGame(slot);
                        onToggle();
                      }
                    }}
                  >
                    Laden
                  </Pill>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-black/10 bg-gradient-to-b from-[#eef1f4] to-[#dfe4e9] px-3 py-2">
            <Pill onClick={() => downloadSave(toSave())} title="Spielstand als Datei herunterladen">
              Als Datei exportieren
            </Pill>
            <Pill onClick={() => fileInput.current?.click()} title="Spielstand-Datei laden">
              Datei laden
            </Pill>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                const save = await readSaveFile(file);
                if (!save) {
                  setMessage("Datei ist kein gültiger Citypower-Spielstand");
                  return;
                }
                loadGame(save);
                onToggle();
              }}
            />
          </div>
          <div className="border-t border-black/10 px-3 py-1.5 text-[10px] text-[#7a8794]">
            {message ?? "Automatisch gespeichert wird jede Minute und beim Schließen."}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Every built object except plain houses (fire ruins included), grouped by kind with the
 * number built; a click flies the camera there and selects it.
 */
function BuildingsMenu({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const buildings = useCity((s) => s.buildings);
  const status = useCity((s) => s.economy?.status);
  const flyTo = useCity((s) => s.flyTo);
  // Kinds folded out (ruins by default): with many buildings the list would run for screens.
  const [unfolded, setUnfolded] = useState<Set<BuildingKind>>(() => new Set(["ruin"]));
  const groups = useMemo(() => {
    const byKind = new Map<BuildingKind, typeof buildings>();
    for (const b of buildings) {
      if (b.kind === "house") continue;
      const list = byKind.get(b.kind);
      if (list) list.push(b);
      else byKind.set(b.kind, [b]);
    }
    // Ruins first (they need demolishing), then by name.
    return [...byKind.entries()].sort(([a], [b]) => (a === "ruin" ? -1 : b === "ruin" ? 1 : BUILDINGS[a].label.localeCompare(BUILDINGS[b].label, "de")));
  }, [buildings]);
  const total = groups.reduce((n, [, list]) => n + list.length, 0);
  return (
    <div className="relative flex flex-col items-end">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-xs font-semibold transition ${
          open
            ? "border-[#1a9bd7] bg-white text-[#1a8fc8] shadow-[0_0_0_2px_rgba(26,155,215,0.25)]"
            : "border-[#3d4650] bg-gradient-to-b from-white to-[#dfe4e9] text-[#2c3640]"
        }`}
      >
        <GameIcon name="townhall" size={14} /> Gebäude <span className="font-normal text-[#7a8794]">{total}</span>
      </button>
      {open && (
        <div className={`absolute right-0 top-full z-20 mt-1.5 w-72 overflow-hidden ${panel}`}>
          <div className="max-h-[70vh] overflow-y-auto">
            {groups.length === 0 && <div className="px-3 py-2 text-[12px] text-[#7a8794]">Noch nichts gebaut (Wohnhäuser zählen nicht).</div>}
            {groups.map(([kind, list]) => (
              <div key={kind}>
                <button
                  type="button"
                  aria-expanded={unfolded.has(kind)}
                  onClick={() =>
                    setUnfolded((prev) => {
                      const next = new Set(prev);
                      if (!next.delete(kind)) next.add(kind);
                      return next;
                    })
                  }
                  className={`flex w-full items-center gap-1.5 border-b border-black/10 bg-white/40 px-3 py-1 text-left text-[11px] font-semibold uppercase tracking-[0.08em] hover:bg-white/80 ${kind === "ruin" ? "text-[#c0392b]" : "text-[#1d5f86]"}`}
                >
                  <GameIcon name={BUILDINGS[kind].icon} size={14} />
                  <span className="flex-1">{BUILDINGS[kind].label}</span>
                  <span className="font-normal text-[#7a8794]">{list.length}</span>
                  <Icon name="chevronDown" className={`h-3 w-3 transition ${unfolded.has(kind) ? "rotate-180" : ""}`} />
                </button>
                {unfolded.has(kind) && list.map((b) => {
                  const off = kind !== "ruin" && status?.[b.id] && !status[b.id].connected;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        flyTo(b.id);
                        onToggle();
                      }}
                      className="flex w-full items-center gap-2 px-3 py-[3px] text-left text-[12px] text-[#1d2a35] hover:bg-white/80"
                    >
                      <span className="flex-1 truncate">{levelName(b)}</span>
                      {kind === "ruin" && <span className="text-[10px] text-[#c0392b]">abreißen</span>}
                      {off && <span className="text-[10px] text-[#c0392b]">stillgelegt</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The mayor's private account; a badge counts the confidential offers waiting. */
function MayorButton() {
  const account = useCity((s) => s.mayor.account);
  const offers = useCity((s) => s.mayor.offers.length);
  const scandal = useCity((s) => s.mayor.scandalUntil > s.gameMinutes);
  const open = useCity((s) => s.panel === "mayor");
  const setPanel = useCity((s) => s.setPanel);
  return (
    <button
      type="button"
      onClick={() => setPanel(open ? null : "mayor")}
      className={`relative flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-xs font-semibold transition ${
        open ? "border-[#1a9bd7] bg-white text-[#1a8fc8] shadow-[0_0_0_2px_rgba(26,155,215,0.25)]" : scandal ? "border-[#c0392b] bg-gradient-to-b from-white to-[#f3e1df] text-[#c0392b]" : "border-[#3d4650] bg-gradient-to-b from-white to-[#dfe4e9] text-[#2c3640]"
      }`}
      title="Bürgermeister: Privatkonto, Gehalt, Angebote"
    >
      <GameIcon name="villa" size={14} /> Bürgermeister <span className="font-mono font-normal text-[#2c8f4e]">{euro(Math.round(account))}</span>
      {offers > 0 && <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#c0392b] px-1 text-[10px] text-white">{offers}</span>}
    </button>
  );
}

/** The newspaper (once a publisher stands); a dot marks an edition not read yet. */
function NewspaperButton() {
  const has = useCity((s) => s.buildings.some((b) => b.kind === "newspaper"));
  const unread = useCity((s) => (s.newspapers[0]?.day ?? 0) > s.newsRead);
  const open = useCity((s) => s.panel === "newspaper");
  const setPanel = useCity((s) => s.setPanel);
  if (!has) return null;
  return (
    <button
      type="button"
      onClick={() => setPanel(open ? null : "newspaper")}
      title="Citypower Rundschau lesen"
      className={`relative flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-xs font-semibold transition ${
        open ? "border-[#1a9bd7] bg-white text-[#1a8fc8] shadow-[0_0_0_2px_rgba(26,155,215,0.25)]" : "border-[#3d4650] bg-gradient-to-b from-white to-[#dfe4e9] text-[#2c3640]"
      }`}
    >
      <GameIcon name="newspaper" size={14} /> Zeitung
      {unread && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#c0392b]" />}
    </button>
  );
}

/** Top right: building list, save menu and admin tools (one open at a time). */
function TopRight() {
  const [open, setOpen] = useState<"buildings" | "save" | "admin" | null>(null);
  return (
    <div className="pointer-events-auto absolute right-16 top-3 flex items-start gap-2">
      <NewspaperButton />
      <MayorButton />
      <BuildingsMenu open={open === "buildings"} onToggle={() => setOpen(open === "buildings" ? null : "buildings")} />
      <SaveMenu open={open === "save"} onToggle={() => setOpen(open === "save" ? null : "save")} />
      <AdminMenu open={open === "admin"} onToggle={() => setOpen(open === "admin" ? null : "admin")} />
    </div>
  );
}

/** Sound: music and effects separately, Aus / Leise / Mittel / Laut (remembered per browser). */
function SoundSettings() {
  const music = useSoundSettings((s) => s.music);
  const sfx = useSoundSettings((s) => s.sfx);
  const setMusic = useSoundSettings((s) => s.setMusic);
  const setSfx = useSoundSettings((s) => s.setSfx);
  const row = (label: string, value: number, set: (v: number) => void) => (
    <div className="flex items-center gap-1 px-2 py-1">
      <span className="w-14 text-[11px] text-[#1d5f86]">{label}</span>
      {VOLUME_STEPS.map((step) => (
        <Pill key={step.label} active={value === step.value} onClick={() => set(step.value)}>
          {step.label}
        </Pill>
      ))}
    </div>
  );
  return (
    <>
      <div className="border-b border-black/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#1d5f86]">Ton</div>
      <div className="py-1">
        {row("Musik", music, setMusic)}
        {row("Effekte", sfx, setSfx)}
      </div>
    </>
  );
}

/** Admin tools (top right). Visible only for admins, see lib/city/admin.ts. */
function AdminMenu({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const admin = useIsAdmin();

  const showRain = useCity((s) => s.showRain);
  const toggleRain = useCity((s) => s.toggleRain);

  const showSnow = useCity((s) => s.showSnow);
  const toggleSnow = useCity((s) => s.toggleSnow);

  const cheatMoney = useCity((s) => s.cheatMoney);
  const showFps = useDisplay((s) => s.showFps);
  const toggleFps = useDisplay((s) => s.toggleFps);
  const houseStyle = useCity((s) => s.houseStyle);
  const setHouseStyle = useCity((s) => s.setHouseStyle);
  if (!admin) return null;
  return (
    <div className="relative flex flex-col items-end">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-xs font-semibold transition ${
          open
            ? "border-[#1a9bd7] bg-white text-[#1a8fc8] shadow-[0_0_0_2px_rgba(26,155,215,0.25)]"
            : "border-[#3d4650] bg-gradient-to-b from-white to-[#dfe4e9] text-[#2c3640]"
        }`}
      >
        <GameIcon name="wrench" size={14} /> Einstellungen
      </button>
      {open && (
        <div className={`absolute right-0 top-full z-20 mt-1.5 w-[19rem] overflow-hidden ${panel}`}>
          <SoundSettings />
          <div className="border-y border-black/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#1d5f86]">
            Geld hinzufügen
          </div>
          <div className="flex flex-col gap-1.5 p-2">
            {ADMIN_MONEY_STEPS.map((amount) => (
              <Pill key={amount} tone="go" onClick={() => cheatMoney(amount)}>
                + {euro(amount)}
              </Pill>
            ))}
          </div>
          <div className="border-y border-black/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#1d5f86]">
            Hausmodelle
          </div>
          <div className="flex gap-1.5 p-2">
            <Pill active={houseStyle === "classic"} onClick={() => setHouseStyle("classic")}>
              Klassisch
            </Pill>
            <Pill active={houseStyle === "pack"} onClick={() => setHouseStyle("pack")}>
              City Pack
            </Pill>
          </div>
          <div className="border-y border-black/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#1d5f86]">
            Wetter
          </div>
          <div className="flex items-center justify-between gap-2 p-2">
            <span className="text-xs font-medium text-[#2c3640]">Regen</span>
            <Pill active={showRain} onClick={toggleRain}>
              {showRain ? "Aktiv" : "Deaktiviert"}
            </Pill>
          </div>
          <div className="flex items-center justify-between gap-2 p-2">
            <span className="text-xs font-medium text-[#2c3640]">
              Schnee
            </span>
            <Pill active={showSnow} onClick={toggleSnow}>
              {showSnow ? "Aktiv" : "Deaktiviert"}
            </Pill>
          </div>
          <div className="border-y border-black/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#1d5f86]">
            Anzeige
          </div>
          <div className="flex items-center justify-between gap-2 p-2">
            <span className="text-xs font-medium text-[#2c3640]">FPS anzeigen</span>
            <Pill active={showFps} onClick={toggleFps}>
              {showFps ? "Aktiv" : "Deaktiviert"}
            </Pill>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- FPS display (settings) ---------- */

const FPS_KEY = "citypower.showFps";
/** Per-browser display settings (like the house style: not part of the save game). */
const useDisplay = create<{ showFps: boolean; toggleFps: () => void }>((set, get) => ({
  // Read from the browser after mounting (the HUD is also rendered on the server).
  showFps: false,
  toggleFps: () => {
    const showFps = !get().showFps;
    try {
      localStorage.setItem(FPS_KEY, showFps ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
    set({ showFps });
  },
}));

/**
 * Frames per second of the browser (the 3D scene renders once per frame), refreshed twice a
 * second: average frame time and the slowest frame of the last half second.
 */
function FpsMeter() {
  const [stat, setStat] = useState<{ fps: number; ms: number; worst: number } | null>(null);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let start = last;
    let frames = 0;
    let worst = 0;
    const loop = (t: number) => {
      const dt = t - last;
      last = t;
      frames++;
      worst = Math.max(worst, dt);
      if (t - start >= 500) {
        const ms = (t - start) / frames;
        setStat({ fps: 1000 / ms, ms, worst });
        start = t;
        frames = 0;
        worst = 0;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (!stat) return null;
  const tone = stat.fps >= 50 ? "text-[#2c8f4e]" : stat.fps >= 30 ? "text-[#b7791f]" : "text-[#c0392b]";
  return (
    <div className={`pointer-events-none absolute right-16 top-12 z-10 px-2.5 py-1 font-mono text-[11px] ${panel}`} title="Bilder pro Sekunde">
      <span className={`font-semibold ${tone}`}>{Math.round(stat.fps)} FPS</span>
      <span className="text-[#7a8794]">
        {" · "}
        {stat.ms.toFixed(1).replace(".", ",")} ms · max {Math.round(stat.worst)} ms
      </span>
    </div>
  );
}

/* ---------- emergency calls: the player raises the alarm ---------- */

function EmergencyCalls() {
  const incidents = useCity((s) => s.incidents);
  const minutes = useCity((s) => s.gameMinutes);
  const raiseAlarm = useCity((s) => s.raiseAlarm);
  const flyToIncident = useCity((s) => s.flyToIncident);
  if (incidents.length === 0) return null;
  return (
    <div className="pointer-events-auto absolute left-1/2 top-12 flex w-[min(70vw,640px)] -translate-x-1/2 flex-col gap-1">
      {incidents.map((i) => {
        const left = Math.max(0, Math.ceil((i.kind === "fire" ? FIRE_BURN : ACCIDENT_CLEAR) - (minutes - i.t0)));
        const fire = i.kind === "fire";
        const needsAmbulance = !!i.injured && !i.ambulance && !i.ambulanceDone;
        const open = !i.station || needsAmbulance;
        const injured = i.injured
          ? i.ambulanceDone
            ? " · Verletzte versorgt"
            : i.ambulance
              ? " · Krankenwagen unterwegs"
              : " · Verletzte – Krankenwagen fehlt"
          : "";
        return (
          <div key={i.id} className={`flex items-center gap-2 px-3 py-1 text-xs ${panel} ${open ? "text-[#c0392b]" : "text-[#2c3640]"}`}>
            <GameIcon name={fire ? "firestation" : "police"} size={18} />
            <span className="flex-1 truncate">
              <b>Notruf: {INCIDENT_LABEL[i.kind]}</b>
              {" · "}
              {i.station
                ? i.onSite
                  ? fire
                    ? "Feuerwehr löscht, Straße gesperrt"
                    : "Polizei sperrt die Straße und räumt"
                  : fire
                    ? "Feuerwehr unterwegs"
                    : "Streifenwagen unterwegs"
                : fire
                  ? `brennt ab in ${left} min`
                  : `Straße blockiert, noch ${left} min`}
              {fire && i.police && !i.policeDone ? " · Polizei leitet den Verkehr um" : ""}
              {injured}
            </span>
            <Pill onClick={() => flyToIncident(i.id)} title="Kamera zum Einsatzort">
              Zeigen
            </Pill>
            {open && (
              <Pill
                tone="danger"
                onClick={() => raiseAlarm(i.id)}
                title={[!i.station && (fire ? "Feuerwehr" : "Polizei"), needsAmbulance && "Krankenwagen"].filter(Boolean).join(" und ") + " alarmieren"}
              >
                Alarm auslösen
              </Pill>
            )}
          </div>
        );
      })}
    </div>
  );
}

function readShowFps() {
  try {
    return localStorage.getItem(FPS_KEY) === "1";
  } catch {
    return false;
  }
}

export function Hud() {
  const showFps = useDisplay((s) => s.showFps);
  useEffect(() => useDisplay.setState({ showFps: readShowFps() }), []);
  return (
    <>
      <SoundDirector />
      <CityPanel />
      <TopRight />
      <Ticker />
      <EmergencyCalls />
      {showFps && <FpsMeter />}
      <BottomBar />
      <CityPanels />
    </>
  );
}
