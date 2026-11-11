import type { EconomyStats } from "./economy";

/**
 * How the citizens feel (Befinden der Bürger), for the town hall: every need scores 0..1,
 * the mood is the weighted mean. Pure analysis – it does not change the simulation.
 */

export interface MoodFactor {
  id: string;
  label: string;
  score: number;
  weight: number;
  /** Complaint shown when the score is low. */
  complaint: string;
}

const ratio = (got: number, need: number) => (need > 0.01 ? Math.max(0, Math.min(1, got / need)) : 1);

export function moodFactors(e: EconomyStats): MoodFactor[] {
  return [
    { id: "water", label: "Wasser", score: ratio(e.waterCapacity, e.waterDemand), weight: 3, complaint: "Das Wasser reicht nicht – Wasserwerk ausbauen" },
    { id: "bread", label: "Brot", score: ratio(e.breadSold, e.breadDemand), weight: 2, complaint: "Zu wenig Brot in den Bäckereien" },
    { id: "meat", label: "Fleisch", score: ratio(e.meatSold, e.meatDemand), weight: 1, complaint: "Die Metzger haben kaum Fleisch" },
    { id: "jobs", label: "Arbeit", score: Math.max(0, Math.min(1, (e.employment - 0.4) / 0.55)), weight: 2.5, complaint: "Viele Bürger finden keine Arbeit" },
    { id: "health", label: "Gesundheit", score: e.hospital ? ratio(e.hospitalCapacity, e.residents) : 0, weight: 2, complaint: "Es fehlt ein Krankenhaus" },
    { id: "education", label: "Bildung", score: e.education, weight: 1.5, complaint: "Zu wenig Schulplätze" },
    { id: "power", label: "Strom", score: e.powered, weight: 1.5, complaint: "Viele Häuser haben keinen Strom" },
    { id: "home", label: "Einrichtung", score: e.furnished, weight: 1, complaint: "Möbel sind kaum zu bekommen" },
    { id: "shoes", label: "Schuhe", score: e.shod, weight: 0.8, complaint: "Keine Schuhe zu kaufen – Schuhgeschäft fehlt" },
    { id: "clothes", label: "Kleidung", score: e.dressed, weight: 0.8, complaint: "Keine Kleidung zu kaufen – Modegeschäft fehlt" },
    { id: "food", label: "Lebensmittel", score: e.fed, weight: 0.8, complaint: "Kein Discounter – Lebensmittel fehlen" },
    { id: "jewellery", label: "Schmuck", score: e.adorned, weight: 0.4, complaint: "Kein Schmuck zu kaufen – Juwelier mit Gold beliefern" },
    { id: "spiced", label: "Reis & Gewürze", score: e.spiced, weight: 0.6, complaint: "Kein Reis, keine Gewürze – Kontor am Hafen + Discounter" },
    // Only once there is an airport: holidaymakers come back in a good mood.
    ...(e.airport ? [{ id: "holiday", label: "Urlaub", score: e.holiday, weight: 0.8, complaint: "Flüge ausgebucht – Flughafen ausbauen" }] : []),
    { id: "green", label: "Grünflächen", score: e.green, weight: 0.6, complaint: "Kein Park in der Nähe – Stadtpark bauen" },
    { id: "play", label: "Spielplätze", score: e.play, weight: 0.4, complaint: "Die Kinder haben keinen Spielplatz in der Nähe" },
    { id: "leisure", label: "Freizeit", score: e.leisure, weight: 1, complaint: "Langeweile – Restaurants, Kino, Schwimmbad oder Jahrmarkt fehlen" },
    {
      id: "taxes",
      label: "Steuern",
      score: Math.max(0, Math.min(1, 1 - (e.taxRate - 0.05) / 0.15)),
      weight: 1.5,
      complaint: "Die Einkommensteuer ist zu hoch",
    },
  ];
}

/** Weighted mood 0..1. */
export function moodOf(factors: MoodFactor[]) {
  const w = factors.reduce((s, f) => s + f.weight, 0);
  return w > 0 ? factors.reduce((s, f) => s + f.score * f.weight, 0) / w : 1;
}

export function moodLabel(m: number) {
  return m >= 0.85 ? "Begeistert" : m >= 0.7 ? "Zufrieden" : m >= 0.5 ? "Gemischt" : m >= 0.3 ? "Unzufrieden" : "Wütend";
}

/** One sample of the town's history (for the trend charts). */
export interface StatSample {
  /** Game minute. */
  t: number;
  money: number;
  residents: number;
  balance: number;
  mood: number;
  /** Town income (taxes and fees) per minute; missing in older saves. */
  income?: number;
}

/** A sample every half game hour, the last 3 game days. */
export const STAT_INTERVAL = 30;
export const STAT_LIMIT = 144;
