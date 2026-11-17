import type { Separations } from "./grade";
import { sizeOf, type Building, type Storage } from "./economy";
import type { Ship, ShipSale } from "./shipping";
import type { Cable, Canal, Rail, Road } from "./types";
import type { Loan } from "./finance";
import type { StatSample } from "./wellbeing";
import type { Permits } from "./growth";
import type { Incident } from "./incidents";
import type { MayorState } from "./mayor";
import type { Edition, NewsEvent } from "./news";
import type { Train } from "./railway";

/**
 * Saved games. A save holds everything the player built plus the world seed (terrain,
 * rivers and lakes are regenerated from it). Stored in the browser (localStorage: an
 * autosave and three slots) and as a downloadable JSON file.
 */

export const SAVE_VERSION = 1;
/**
 * Plot layout revision (compatible changes): 2 = spinning mill and clothing factory grow only
 * to the back. Older saves are moved on load so the front stays at the street (`migrateLayout`).
 */
export const LAYOUT_VERSION = 2;
export const SLOT_COUNT = 3;
const KEY_AUTO = "citypower.save.auto";
const KEY_SLOT = (i: number) => `citypower.save.slot${i}`;

export interface SaveGame {
  version: number;
  /** ISO time the game was saved. */
  savedAt: string;
  seed: number;
  roads: Road[];
  rails: Rail[];
  canals: Canal[];
  /** Power lines; missing in older saves. */
  cables?: Cable[];
  buildings: Building[];
  separations: Separations;
  money: number;
  taxRate: number;
  /** Business tax (Gewerbesteuer); missing in older saves. */
  businessTaxRate?: number;
  gameMinutes: number;
  growthPoints: number;
  /** Bank loans and trend samples; missing in older saves. */
  loans?: Loan[];
  stats?: StatSample[];
  /** Building permits for homes (town hall); missing in older saves. */
  permits?: Permits;
  /** Warehouse stock, ships and recent cargo sales; missing in older saves. */
  storage?: Storage;
  ships?: Ship[];
  /** Trains of the signal boxes; missing in older saves. */
  trains?: Train[];
  shipSales?: ShipSale[];
  /** Gold bars in the bank's vault; missing in older saves. */
  gold?: number;
  /** Open accidents and fires; missing in older saves. */
  incidents?: Incident[];
  /** Private account, salary, bribes, suspicion of the mayor. */
  mayor?: Partial<MayorState>;
  /** Newspaper: recent events, printed editions, last edition read. */
  newsLog?: NewsEvent[];
  newspapers?: Edition[];
  newsRead?: number;
  /** Plot layout revision the save was written with; missing = 1. */
  layout?: number;
  /** For the slot list. */
  summary: { residents: number };
}

/** Basic shape check so a broken or foreign file cannot break the game. */
export function parseSave(raw: unknown): SaveGame | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<SaveGame>;
  if (s.version !== SAVE_VERSION) return null;
  if (typeof s.seed !== "number" || !Array.isArray(s.roads) || !Array.isArray(s.buildings)) return null;
  return {
    version: SAVE_VERSION,
    savedAt: s.savedAt ?? new Date().toISOString(),
    seed: s.seed,
    roads: s.roads,
    rails: Array.isArray(s.rails) ? s.rails : [],
    canals: Array.isArray(s.canals) ? s.canals : [],
    cables: Array.isArray(s.cables) ? s.cables : [],
    buildings: s.buildings,
    separations: s.separations ?? {},
    money: typeof s.money === "number" ? s.money : 0,
    taxRate: typeof s.taxRate === "number" ? s.taxRate : 0.1,
    businessTaxRate: typeof s.businessTaxRate === "number" ? s.businessTaxRate : 0.15,
    gameMinutes: typeof s.gameMinutes === "number" ? s.gameMinutes : 360,
    growthPoints: typeof s.growthPoints === "number" ? s.growthPoints : 0,
    loans: Array.isArray(s.loans) ? s.loans : [],
    stats: Array.isArray(s.stats) ? s.stats : [],
    permits: s.permits === "upgrades" || s.permits === "none" ? s.permits : "all",
    storage: s.storage && typeof s.storage === "object" ? s.storage : {},
    layout: typeof s.layout === "number" ? s.layout : 1,
    ships: Array.isArray(s.ships) ? s.ships : [],
    trains: Array.isArray(s.trains) ? s.trains : [],
    shipSales: Array.isArray(s.shipSales) ? s.shipSales : [],
    gold: typeof s.gold === "number" && s.gold >= 0 ? s.gold : 0,
    incidents: Array.isArray(s.incidents) ? s.incidents : [],
    mayor: s.mayor && typeof s.mayor === "object" ? s.mayor : undefined,
    newsLog: Array.isArray(s.newsLog) ? s.newsLog : [],
    newspapers: Array.isArray(s.newspapers) ? s.newspapers : [],
    newsRead: typeof s.newsRead === "number" ? s.newsRead : 0,
    summary: s.summary ?? { residents: 0 },
  };
}

function read(key: string): SaveGame | null {
  try {
    const text = window.localStorage.getItem(key);
    return text ? parseSave(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

function write(key: string, save: SaveGame): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export const readAutosave = () => read(KEY_AUTO);
export const writeAutosave = (save: SaveGame) => write(KEY_AUTO, save);
export const readSlot = (i: number) => read(KEY_SLOT(i));
export const writeSlot = (i: number, save: SaveGame) => write(KEY_SLOT(i), save);
export function deleteSlot(i: number) {
  try {
    window.localStorage.removeItem(KEY_SLOT(i));
  } catch {
    /* storage unavailable */
  }
}

/** Offers the save as a JSON file download. */
export function downloadSave(save: SaveGame) {
  const blob = new Blob([JSON.stringify(save)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = save.savedAt.slice(0, 16).replace(/[T:]/g, "-");
  a.href = url;
  a.download = `citypower-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Reads a save file chosen by the player. */
export async function readSaveFile(file: File): Promise<SaveGame | null> {
  try {
    return parseSave(JSON.parse(await file.text()));
  } catch {
    return null;
  }
}

/** Plot depths per level before layout 2 (they grew in width and depth). */
const OLD_DEPTH: Partial<Record<Building["kind"], number[]>> = {
  spinning: [24, 24, 30, 36],
  clothing: [24, 24, 30, 38],
};

/**
 * Moves buildings whose plot depth changed so their front edge stays where it was (the model
 * is placed by its centre, which sits half the depth behind the front).
 */
export function migrateLayout(buildings: Building[], layout: number): Building[] {
  if (layout >= LAYOUT_VERSION) return buildings;
  return buildings.map((b) => {
    const old = OLD_DEPTH[b.kind]?.[b.level];
    if (old === undefined) return b;
    const shift = (sizeOf(b)[1] - old) / 2;
    if (Math.abs(shift) < 1e-6) return b;
    return { ...b, x: b.x + Math.sin(b.rot) * shift, z: b.z + Math.cos(b.rot) * shift };
  });
}
