"use client";

import type { ReactNode } from "react";
import { useCity } from "@/lib/city/store";
import type { StatSample } from "@/lib/city/wellbeing";
import { GameIcon } from "./GameIcon";
import { panel, Pill } from "./Hud";

/** Building blocks of the big HUD panels (bank, town hall, tax office). */

export const pct = (v: number) => `${Math.round(v * 100)} %`;

export function Heading({ children }: { children: ReactNode }) {
  return <div className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a8794]">{children}</div>;
}

export function Line({ label, value, tone, sub }: { label: string; value: string; tone?: "good" | "bad"; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-4 py-[2px] text-[12px]">
      <span className="text-[#1d5f86]">
        {label}
        {sub && <span className="ml-1 text-[10px] text-[#7a8794]">{sub}</span>}
      </span>
      <span className={`font-mono ${tone === "bad" ? "text-[#c0392b]" : tone === "good" ? "text-[#2c8f4e]" : "text-[#1d2a35]"}`}>{value}</span>
    </div>
  );
}

/** Horizontal bar 0..1, red when low. */
export function Bar({ value, warn = 0.6 }: { value: number; warn?: number }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className="relative block h-2 w-full overflow-hidden rounded-full bg-[#2c3640]/10">
      <span
        className={`absolute inset-y-0 left-0 rounded-full ${v < warn * 0.6 ? "bg-[#c0392b]" : v < warn ? "bg-[#e0a030]" : "bg-[#2c8f4e]"}`}
        style={{ width: `${v * 100}%` }}
      />
    </span>
  );
}

/** Small line chart of one value over the trend samples. */
export function Trend<T = StatSample>({
  samples,
  pick,
  label,
  format,
  zero = true,
}: {
  samples: T[];
  pick: (s: T) => number;
  label: string;
  format: (v: number) => string;
  /** Scale from 0 (default) or from the lowest value (prices). */
  zero?: boolean;
}) {
  const W = 300;
  const H = 54;
  const values = samples.map(pick);
  const last = values[values.length - 1];
  if (values.length < 2)
    return (
      <div className="px-4 py-1 text-[11px] text-[#7a8794]">
        {label}: noch keine Daten (alle 30 Spielminuten ein Messpunkt)
      </div>
    );
  const min = zero ? Math.min(...values, 0) : Math.min(...values);
  const max = Math.max(...values, min + 1);
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => H - 4 - ((v - min) / (max - min)) * (H - 8);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const rising = last >= values[0];
  const colour = rising ? "#2c8f4e" : "#c0392b";
  return (
    <div className="px-4 py-1">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-[#1d5f86]">{label}</span>
        <span className="font-mono font-semibold" style={{ color: colour }}>
          {format(last)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-0.5 h-12 w-full rounded-md bg-white/70" preserveAspectRatio="none">
        {min < 0 && <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="#2c3640" strokeOpacity={0.25} strokeDasharray="4 3" />}
        <polygon points={`0,${H} ${points} ${W},${H}`} fill={colour} fillOpacity={0.12} />
        <polyline points={points} fill="none" stroke={colour} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export function Frame({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  const setPanel = useCity((s) => s.setPanel);
  return (
    <div className={`pointer-events-auto absolute right-3 top-14 bottom-20 flex w-[min(380px,calc(100vw-24px))] flex-col overflow-hidden ${panel}`}>
      <div className="flex items-center gap-2 border-b border-black/10 px-4 py-2">
        <GameIcon name={icon} size={22} />
        <span className="flex-1 text-sm font-semibold text-[#1d5f86]">{title}</span>
        <Pill onClick={() => setPanel(null)}>Schließen</Pill>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3 text-[#1d2a35]">{children}</div>
    </div>
  );
}

