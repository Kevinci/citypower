"use client";

import { useProgress } from "@react-three/drei";
import { Bungee } from "next/font/google";
import { useEffect, useState } from "react";

/** Bungee (David Jonathan Ross, SIL Open Font License): city signage lettering. */
const bungee = Bungee({ weight: "400", subsets: ["latin"] });

/** Parts of the house, built up in this order (each its own layer). */
const PARTS: { d: string; className?: string; fill?: boolean }[] = [
  { d: "M14 140h172", className: "text-slate-500" },
  { d: "M52 140V72M148 72v68" },
  { d: "M40 72 100 26l60 46z", className: "fill-sky-400/15 stroke-none", fill: true },
  { d: "M40 74 100 26l60 48" },
  { d: "M128 49V32h12v26" },
  { d: "M88 140v-34h24v34" },
  { d: "M64 84h16v16H64zM120 84h16v16h-16zM72 84v16M64 92h16M128 84v16M120 92h16" },
  { d: "M134 26c-6-5 6-9 0-15s4-9 2-11", className: "text-slate-400/70" },
];
/** Length of one build cycle (s) and the step between two parts. */
const CYCLE = 4.8;
const STEP = 0.32;

/**
 * The house builds itself part by part, again and again. Every part is its own HTML layer
 * animated only by opacity and transform (`animate-assemble`), which the browser runs on the
 * compositor – so it stays smooth while the main thread is busy building the world. (The old
 * stroke drawing animated stroke-dashoffset on the main thread and stuttered.)
 */
function House() {
  return (
    <div className="relative h-52 w-64 text-sky-300 drop-shadow-[0_0_14px_rgba(125,211,252,0.45)]">
      {PARTS.map((p, i) => (
        <svg
          key={i}
          viewBox="0 0 200 160"
          className={`animate-assemble absolute inset-0 h-full w-full will-change-[transform,opacity] ${p.className ?? ""}`}
          style={{ animationDelay: `${i * STEP}s`, animationDuration: `${CYCLE}s` }}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={p.d} className={p.fill ? "fill-sky-400/15 stroke-none" : undefined} />
        </svg>
      ))}
    </div>
  );
}

/** The house of the loading screen as a small static logo (HUD). */
export function HouseLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 160" className={className} fill="none" stroke="currentColor" strokeWidth={12} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M40 72 100 26l60 46z" className="fill-sky-400/25 stroke-none" />
      <path d="M14 140h172" className="text-slate-400" stroke="currentColor" />
      <path d="M52 140V72M148 72v68M40 74 100 26l60 48M128 49V32h12v26M88 140v-34h24v34" />
      <path d="M64 84h16v16H64zM120 84h16v16h-16z" strokeWidth={9} />
    </svg>
  );
}

/** Loaders must stay idle this long before the screen fades (a new batch often starts right after one ends). */
const SETTLE_MS = 600;
/** Never keep the player waiting longer than this, even if some asset hangs. */
const MAX_WAIT_MS = 45000;
const FADE_MS = 700;

/**
 * Full-screen loading screen: the world loads in the background behind it. It fades out once
 * the scene has drawn (`ready`) and every model and texture has finished loading, and is
 * removed after the fade.
 */
export function LoadingScreen({ ready }: { ready: boolean }) {
  const { progress, active } = useProgress();
  const [settled, setSettled] = useState(false);
  const [gone, setGone] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), MAX_WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!ready || active) return;
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [ready, active]);
  const done = (ready && settled) || timedOut;
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setGone(true), FADE_MS);
    return () => clearTimeout(t);
  }, [done]);

  // One bar for the whole load: models and textures (0–85 %), building the scene (85–95 %),
  // the last frames until the loaders are quiet (100 %). Never goes backwards.
  const raw = done ? 100 : ready ? 95 : active ? Math.min(85, progress * 0.85) : progress >= 100 ? 90 : Math.min(85, progress * 0.85);
  const [shownMax, setShownMax] = useState(0);
  if (raw > shownMax) setShownMax(raw);
  if (gone) return null;
  const shown = Math.round(Math.max(shownMax, raw));
  return (
    <div
      className={`pointer-events-auto absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-[#202327] transition-opacity duration-700 ${
        done ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      {/* Soft light behind the house. */}
      <div className="absolute h-80 w-80 rounded-full bg-sky-500/10 blur-3xl" />
      <House />
      <h1 className={`${bungee.className} relative text-5xl tracking-wider text-white sm:text-6xl`}>
        City<span className="text-sky-400">power</span>
      </h1>
      <div className="relative h-1 w-56 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-sky-400" style={{ width: `${shown}%` }} />
      </div>
      <p className="relative font-mono text-xs tracking-widest text-slate-400 uppercase">
        {shown >= 95 ? "Letzte Handgriffe …" : shown >= 85 ? "Stadt wird gebaut …" : "Lade Welt …"} {shown} %
      </p>
    </div>
  );
}
