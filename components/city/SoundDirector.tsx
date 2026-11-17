"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { jailed } from "@/lib/city/mayor";
import { useCity } from "@/lib/city/store";
import { sound } from "./sound/engine";

/** Volume steps in the settings menu. */
export const VOLUME_STEPS: { label: string; value: number }[] = [
  { label: "Aus", value: 0 },
  { label: "Leise", value: 0.35 },
  { label: "Mittel", value: 0.65 },
  { label: "Laut", value: 1 },
];
const KEY = "citypower.sound";

interface SoundSettings {
  music: number;
  sfx: number;
  setMusic: (v: number) => void;
  setSfx: (v: number) => void;
}

function save(music: number, sfx: number) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ music, sfx }));
  } catch {
    // Private mode / blocked storage: the setting just is not remembered.
  }
}

/** Per browser (localStorage), read after mounting (server rendering knows no storage). */
export const useSoundSettings = create<SoundSettings>((set, get) => ({
  music: 0.65,
  sfx: 0.65,
  setMusic: (music) => {
    set({ music });
    save(music, get().sfx);
  },
  setSfx: (sfx) => {
    set({ sfx });
    save(get().music, sfx);
  },
}));

function readSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const v = JSON.parse(raw) as { music?: number; sfx?: number };
    useSoundSettings.setState({ music: typeof v.music === "number" ? v.music : 0.65, sfx: typeof v.sfx === "number" ? v.sfx : 0.65 });
  } catch {
    // Ignore a broken entry.
  }
}

/**
 * Turns game events into sound: clicks on buttons, building and demolishing (history grew),
 * emergency calls, confidential offers, money from deals, scandals and prison; and sets the
 * music's intensity from what is at stake (open calls, a scandal, prison).
 */
export function SoundDirector() {
  const music = useSoundSettings((s) => s.music);
  const sfx = useSoundSettings((s) => s.sfx);
  useEffect(() => {
    sound.setVolumes(music, sfx);
  }, [music, sfx]);

  useEffect(() => {
    readSettings();
    const unlock = () => sound.ensure();
    const click = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("button")) sound.play("click");
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    window.addEventListener("click", click, true);

    const unsubscribe = useCity.subscribe((s, prev) => {
      // A world was loaded or created: nothing of this is an event.
      if (s.worldVersion !== prev.worldVersion) return;
      if (s.history.length > prev.history.length) {
        const fewer = s.buildings.length < prev.buildings.length || s.roads.length < prev.roads.length;
        sound.play(fewer ? "demolish" : "build");
      } else if (s.buildings !== prev.buildings && s.buildings.length === prev.buildings.length && s.buildings.some((b, i) => prev.buildings[i]?.id === b.id && prev.buildings[i].level < b.level && b.kind !== "house")) {
        sound.play("upgrade");
      }
      if (s.incidents.length > prev.incidents.length) sound.play("alarm");
      if (s.newspapers.length > 0 && s.newspapers[0] !== prev.newspapers[0]) sound.play("paper");
      if (s.mayor.offers.length > prev.mayor.offers.length) sound.play("offer");
      if (s.mayor.taken > prev.mayor.taken + 1000 && s.mayor.rackets === prev.mayor.rackets) sound.play("cash");
      if ((s.mayor.scandalUntil > 0 && prev.mayor.scandalUntil === 0) || (s.mayor.jailUntil > 0 && prev.mayor.jailUntil === 0)) sound.play("scandal");
    });

    // Music intensity: what is at stake right now.
    const mood = window.setInterval(() => {
      const s = useCity.getState();
      const open = s.incidents.some((i) => !i.station);
      const attended = s.incidents.length > 0;
      const now = s.gameMinutes;
      const level = jailed(s.mayor, now) ? 1 : s.mayor.scandalUntil > now ? 0.8 : open ? 0.85 : attended ? 0.6 : 0;
      sound.setIntensity(level);
      sound.setPaused(s.speed === 0);
    }, 1000);

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("click", click, true);
      unsubscribe();
      window.clearInterval(mood);
    };
  }, []);
  return null;
}
