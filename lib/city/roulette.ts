/**
 * European roulette (one zero) for the mayor in the Spielbank: stakes come from the private
 * account. Payouts as at the table: single number 35 : 1, dozen 2 : 1, the even chances 1 : 1;
 * the zero loses every outside bet (the house edge, 2.7 %).
 */

export type RouletteBet =
  | { type: "number"; n: number }
  | { type: "red" }
  | { type: "black" }
  | { type: "even" }
  | { type: "odd" }
  | { type: "low" }
  | { type: "high" }
  | { type: "dozen"; d: 1 | 2 | 3 };

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const isRed = (n: number) => RED.has(n);
export const colourOf = (n: number): "green" | "red" | "black" => (n === 0 ? "green" : RED.has(n) ? "red" : "black");

/** Stake back plus winnings for a hit (×36 for a number, ×3 dozen, ×2 even chances), 0 for a miss. */
export function payoutOf(bet: RouletteBet, n: number, stake: number): number {
  const hit =
    bet.type === "number"
      ? n === bet.n
      : n === 0
        ? false
        : bet.type === "red"
          ? RED.has(n)
          : bet.type === "black"
            ? !RED.has(n)
            : bet.type === "even"
              ? n % 2 === 0
              : bet.type === "odd"
                ? n % 2 === 1
                : bet.type === "low"
                  ? n <= 18
                  : bet.type === "high"
                    ? n >= 19
                    : Math.ceil(n / 12) === bet.d;
  if (!hit) return 0;
  const factor = bet.type === "number" ? 36 : bet.type === "dozen" ? 3 : 2;
  return stake * factor;
}

export function betLabel(bet: RouletteBet) {
  switch (bet.type) {
    case "number":
      return `Zahl ${bet.n}`;
    case "red":
      return "Rot";
    case "black":
      return "Schwarz";
    case "even":
      return "Gerade";
    case "odd":
      return "Ungerade";
    case "low":
      return "1–18";
    case "high":
      return "19–36";
    case "dozen":
      return `${bet.d}. Dutzend`;
  }
}

export interface RouletteSpin {
  n: number;
  bet: RouletteBet;
  stake: number;
  payout: number;
}
