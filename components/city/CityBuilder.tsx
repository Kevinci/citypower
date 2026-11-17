"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useCity, type Tool } from "@/lib/city/store";
import { readAutosave, writeAutosave } from "@/lib/city/save";
import { Hud } from "./Hud";
import { LoadingScreen } from "./LoadingScreen";

/** Hotkeys 1–9 select these tools (fixed order). */
const TOOL_ORDER: Tool[] = ["street", "highway", "bike", "rail", "rail2", "canal", "interchange", "cloverleaf", "trumpet"];

const CityScene = dynamic(() => import("./CityScene"), {
  ssr: false,
  // The loading screen above covers the scene until it has drawn its first frames.
  loading: () => <div className="h-full w-full bg-[#202327]" />,
});

function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useCity.getState();
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;


      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        st.undo();
        return;
      }
      const hotkeyTool = TOOL_ORDER[Number(e.key) - 1];
      if (hotkeyTool) {
        st.setTool(st.tool === hotkeyTool ? null : hotkeyTool);
        return;
      }
      switch (e.key) {
        case " ":
          e.preventDefault();
          st.setSpeed(st.speed === 0 ? 1 : 0);
          break;
        case "b":
        case "B":
          st.cycleCrossingMode();
          break;
        case "Enter":
          st.finishDraft();
          break;
        case "Backspace":
          if (st.draft.length > 0) {
            e.preventDefault();
            st.removeLastPoint();
          }
          break;
        case "Escape":
          if (st.placing) st.startPlacing(null);
          else if (st.draft.length > 0) st.cancelDraft();
          else if (st.tool) st.setTool(null);
          else st.select(null);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Autosave interval in real seconds. */
const AUTOSAVE_SECONDS = 60;

/**
 * Simulation clock and persistence: continues the autosaved game on load (or creates a
 * new world), ticks once per second and autosaves every minute and when the page closes.
 */
function useSimulation() {
  useEffect(() => {
    const saved = readAutosave();
    if (saved) useCity.getState().loadGame(saved);
    else useCity.getState().newWorld(Math.floor(Math.random() * 1e9));
    // Game clock: one tick per real second, scheduled against the real time (no drift when a
    // tick or a frame takes long).
    let next = performance.now() + 1000;
    let timer = 0;
    const run = () => {
      // Economy and growth run in the simulation worker (store: tickAsync).
      void useCity.getState().tickAsync();
      // Behind by more than a tick (tab in the background, long stall): skip, never catch up in a burst.
      const now = performance.now();
      next = Math.max(next + 1000, now + 250);
      timer = window.setTimeout(run, next - now);
    };
    timer = window.setTimeout(run, 1000);
    const tick = { clear: () => window.clearTimeout(timer) };
    const save = () => writeAutosave(useCity.getState().toSave());
    const auto = window.setInterval(save, AUTOSAVE_SECONDS * 1000);
    window.addEventListener("pagehide", save);
    return () => {
      tick.clear();
      window.clearInterval(auto);
      window.removeEventListener("pagehide", save);
    };
  }, []);
}

export function CityBuilder() {
  useHotkeys();
  useSimulation();
  const worldVersion = useCity((s) => s.worldVersion);
  // The world version whose scene has rendered; a new world shows the loading screen again.
  const [ready, setReady] = useState<number | null>(null);
  const onReady = useCallback(() => setReady(worldVersion), [worldVersion]);
  return (
    <div className="relative h-dvh w-full select-none overflow-hidden bg-[#202327] font-sans">
      <div className="absolute inset-0">
        {/* A new world remounts the scene so every cache follows the new terrain. */}
        <CityScene key={worldVersion} onReady={onReady} />
      </div>
      <Hud />
      {/* Keyed by world: a new world or loaded game shows the loading screen again. */}
      <LoadingScreen key={worldVersion} ready={ready === worldVersion} />
    </div>
  );
}
