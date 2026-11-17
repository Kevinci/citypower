"use client";

import { useEffect, useRef, useState } from "react";
import { jailed } from "@/lib/city/mayor";
import { betLabel, colourOf, type RouletteBet, type RouletteSpin } from "@/lib/city/roulette";
import { useCity } from "@/lib/city/store";
import { euro, Pill } from "./Hud";
import { Frame, Heading } from "./PanelParts";
import { sound } from "./sound/engine";

const CHIPS = [1000, 10000, 100000, 1000000];
const OUTSIDE: RouletteBet[] = [{ type: "red" }, { type: "black" }, { type: "even" }, { type: "odd" }, { type: "low" }, { type: "high" }, { type: "dozen", d: 1 }, { type: "dozen", d: 2 }, { type: "dozen", d: 3 }];
const SPIN_MS = 1600;

const sameBet = (a: RouletteBet, b: RouletteBet) => JSON.stringify(a) === JSON.stringify(b);
const CELL: Record<"green" | "red" | "black", string> = {
  green: "bg-[#1f7a43] text-white",
  red: "bg-[#c0272d] text-white",
  black: "bg-[#1b1d22] text-white",
};

/** Roulette in the Spielbank: the mayor bets from his private account. */
export function RoulettePanel() {
  const account = useCity((s) => s.mayor.account);
  const inJail = useCity((s) => jailed(s.mayor, s.gameMinutes));
  const history = useCity((s) => s.rouletteHistory);
  const play = useCity((s) => s.playRoulette);
  const [bet, setBet] = useState<RouletteBet>({ type: "red" });
  const [stake, setStake] = useState(CHIPS[1]);
  const [spinning, setSpinning] = useState(false);
  const [shown, setShown] = useState<number | null>(null);
  const [result, setResult] = useState<RouletteSpin | null>(null);
  // Payout already booked but not yet revealed (the account shows the stake gone meanwhile).
  const [hidden, setHidden] = useState(0);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    },
    [],
  );

  const spin = () => {
    if (spinning) return;
    const outcome = play(bet, stake);
    if (!outcome) return;
    // The ball runs over random numbers for a moment, then lands on the drawn one.
    sound.play("spin");
    setSpinning(true);
    setResult(null);
    setHidden(outcome.payout);
    const t0 = performance.now();
    timer.current = window.setInterval(() => {
      if (performance.now() - t0 >= SPIN_MS) {
        window.clearInterval(timer.current!);
        timer.current = null;
        setShown(outcome.n);
        setResult(outcome);
        sound.play(outcome.payout > 0 ? "win" : "lose");
        setHidden(0);
        setSpinning(false);
        return;
      }
      setShown(Math.floor(Math.random() * 37));
    }, 70);
  };

  const n = shown;
  return (
    <Frame title="Spielbank – Roulette" icon="casino">
      <Heading>Privatkonto</Heading>
      <div className="px-4 font-mono text-xl text-[#2c8f4e]">{euro(Math.round(account - hidden))}</div>
      {inJail && <div className="mx-4 mt-1 rounded bg-[#f3e1df] px-2 py-1 text-[11px] text-[#c0392b]">Im Gefängnis wird nicht gespielt.</div>}

      <div className="flex items-center justify-center gap-4 py-3">
        <div
          className={`grid h-24 w-24 place-items-center rounded-full border-[6px] border-[#c9a227] font-mono text-4xl font-bold shadow-inner transition ${
            n === null ? "bg-[#2c3640] text-white/40" : CELL[colourOf(n)]
          } ${spinning ? "animate-pulse" : ""}`}
        >
          {n ?? "?"}
        </div>
        <div className="w-32 text-[12px]">
          {result ? (
            result.payout > 0 ? (
              <span className="font-semibold text-[#2c8f4e]">Gewonnen: +{euro(result.payout - result.stake)}</span>
            ) : (
              <span className="font-semibold text-[#c0392b]">Verloren: −{euro(result.stake)}</span>
            )
          ) : (
            <span className="text-[#7a8794]">{spinning ? "Rien ne va plus …" : "Faites vos jeux!"}</span>
          )}
        </div>
      </div>

      <Heading>Einsatz</Heading>
      <div className="flex flex-wrap gap-1.5 px-4">
        {CHIPS.map((c) => (
          <Pill key={c} active={stake === c} onClick={() => setStake(c)} disabled={c > account}>
            {euro(c)}
          </Pill>
        ))}
      </div>

      <Heading>Setzen auf: {betLabel(bet)}</Heading>
      <div className="grid grid-cols-3 gap-1 px-4">
        {OUTSIDE.map((b) => (
          <button
            key={betLabel(b)}
            type="button"
            onClick={() => setBet(b)}
            className={`rounded border px-1 py-1 text-[11px] font-semibold ${sameBet(b, bet) ? "border-[#c9a227] ring-2 ring-[#c9a227]" : "border-black/15"} ${
              b.type === "red" ? CELL.red : b.type === "black" ? CELL.black : "bg-[#1f7a43] text-white"
            }`}
          >
            {betLabel(b)} <span className="font-normal opacity-70">{b.type === "dozen" ? "2:1" : "1:1"}</span>
          </button>
        ))}
      </div>
      <div className="mt-1.5 px-4">
        <button
          type="button"
          onClick={() => setBet({ type: "number", n: 0 })}
          className={`mb-1 w-full rounded py-0.5 text-[11px] font-semibold ${CELL.green} ${sameBet(bet, { type: "number", n: 0 }) ? "ring-2 ring-[#c9a227]" : ""}`}
        >
          0
        </button>
        <div className="grid grid-cols-12 gap-[2px]">
          {Array.from({ length: 36 }, (_, i) => i + 1).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setBet({ type: "number", n: k })}
              className={`rounded py-0.5 font-mono text-[10px] ${CELL[colourOf(k)]} ${sameBet(bet, { type: "number", n: k }) ? "ring-2 ring-[#c9a227]" : ""}`}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="pt-1 text-[10px] text-[#7a8794]">Einzelne Zahl zahlt 35 : 1. Bei der 0 verlieren alle anderen Einsätze.</div>
      </div>

      <div className="flex justify-center py-3">
        <Pill tone="go" onClick={spin} disabled={spinning || inJail || stake > account}>
          Drehen – {euro(stake)} auf {betLabel(bet)}
        </Pill>
      </div>

      {history.length > 0 && (
        <>
          <Heading>Letzte Runden</Heading>
          <div className="flex flex-wrap gap-1 px-4">
            {history.slice(spinning ? 1 : 0).map((h, i) => (
              <span key={i} title={`${betLabel(h.bet)}: ${h.payout > 0 ? "+" + euro(h.payout - h.stake) : "−" + euro(h.stake)}`} className={`grid h-6 w-6 place-items-center rounded-full font-mono text-[10px] ${CELL[colourOf(h.n)]} ${h.payout > 0 ? "ring-2 ring-[#2c8f4e]" : ""}`}>
                {h.n}
              </span>
            ))}
          </div>
        </>
      )}
    </Frame>
  );
}
