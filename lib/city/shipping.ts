import { EXPORT_FACTOR, GOOD_LABEL, PRICE, SHIP_PRICE_FACTOR, STORABLE, storedTotal, traderCapacity, type Building, type Good, type ImportOrder, type Storage } from "./economy";

/**
 * Inland shipping (Binnenschifffahrt). Ships are bought at a harbour and always belong to
 * it. A docked ship loads goods from the warehouses on the harbour's road network (most
 * valuable first), sails off, sells the cargo downstream at SHIP_PRICE_FACTOR × the
 * wholesale price and comes back. The town bought the goods at the export price, so the
 * difference is its profit. Pure logic – the store calls `stepShips` every tick.
 *
 * Imports: at the market a ship takes on the open order of an import-export company near its
 * harbour (return freight) and unloads it into the company's store when it is back. The town
 * earns FREIGHT_PER_UNIT for it. A ship also sails without export cargo to fetch an order.
 */

export interface ShipType {
  id: string;
  label: string;
  /** Units of cargo. */
  capacity: number;
  cost: number;
  /** Running costs per minute (crew, fuel), paid by the town. */
  upkeep: number;
  /** Game minutes for the round trip (out and back). */
  trip: number;
  /** Model size in metres. */
  length: number;
  beam: number;
}

export const SHIP_TYPES: ShipType[] = [
  { id: "small", label: "Motorgüterschiff", capacity: 150, cost: 40_000, upkeep: 12, trip: 180, length: 34, beam: 6 },
  { id: "large", label: "Großmotorgüterschiff", capacity: 400, cost: 95_000, upkeep: 28, trip: 240, length: 48, beam: 8 },
  { id: "push", label: "Schubverband", capacity: 900, cost: 190_000, upkeep: 55, trip: 300, length: 66, beam: 9.5 },
];
export const shipType = (id: string) => SHIP_TYPES.find((t) => t.id === id) ?? SHIP_TYPES[0];

/** Ships one harbour can berth. */
export const HARBOUR_BERTHS = 3;
/** Game minutes at the quay for loading. */
export const LOAD_MINUTES = 30;
/** A ship only leaves with at least this share of its hold (or everything in stock). */
const MIN_LOAD = 0.25;
/** Freight the town earns per imported unit it ships home. */
export const FREIGHT_PER_UNIT = 6;
/** A ship sails just for an order if at least this much is open. */
const MIN_ORDER = 20;
/** Selling a ship gives back this share of its price. */
export const SHIP_RESALE = 0.5;

const NAMES = ["Rheinperle", "Lorelei", "Möwe", "Hanna", "Nordstern", "Glückauf", "Frieda", "Kranich", "Elbtal", "Seestern", "Bergfried", "Annemarie"];

export type ShipState = "docked" | "loading" | "out" | "back";
export const SHIP_STATE_LABEL: Record<ShipState, string> = {
  docked: "Liegt am Kai – wartet auf Ladung",
  loading: "Wird beladen",
  out: "Unterwegs zum Markt",
  back: "Auf der Rückfahrt",
};

export interface Ship {
  id: string;
  /** The harbour it belongs to. */
  harbour: string;
  type: string;
  name: string;
  state: ShipState;
  /** Game minutes spent in the current state. */
  t: number;
  cargo: Partial<Record<Good, number>>;
  /** Return freight for an import-export company (bought at the market, unloaded at home). */
  freight?: { trader: string; goods: Partial<Record<Good, number>> };
}

export const cargoValue = (cargo: Partial<Record<Good, number>>) =>
  (Object.keys(cargo) as Good[]).reduce((s, g) => s + (cargo[g] ?? 0) * PRICE[g] * SHIP_PRICE_FACTOR, 0);

/** Profit of selling one unit by ship instead of exporting it directly. */
export const shipMargin = (g: Good) => PRICE[g] * (SHIP_PRICE_FACTOR - EXPORT_FACTOR[g]);

export function newShip(type: ShipType, harbour: string, id: string, fleet: Ship[]): Ship {
  const used = new Set(fleet.map((s) => s.name));
  const name = NAMES.find((n) => !used.has(n)) ?? `${NAMES[fleet.length % NAMES.length]} ${fleet.length + 1}`;
  return { id, harbour, type: type.id, name, state: "docked", t: 0, cargo: {} };
}

/** Upkeep of all ships per harbour id. */
export function shipUpkeep(ships: Ship[]) {
  const out: Record<string, number> = {};
  for (const s of ships) out[s.harbour] = (out[s.harbour] ?? 0) + shipType(s.type).upkeep;
  return out;
}

export interface ShippingStep {
  ships: Ship[];
  storage: Storage;
  /** Money from cargo sold this step. */
  revenue: number;
  /** The single sales of this step (without time). */
  sales: Omit<ShipSale, "t">[];
  /** Ticker message, or null. */
  event: string | null;
}

/** Advances all ships by `minutes` game minutes. */
export function stepShips(
  ships: Ship[],
  buildings: Building[],
  storage: Storage,
  networkOf: Record<string, number | null>,
  minutes: number,
  /** Harbours without navigable water: their ships stay at the quay. */
  harbourWater: Record<string, string | null> = {},
  /** Open import orders per harbour id. */
  orders: Record<string, ImportOrder[]> = {},
): ShippingStep {
  if (ships.length === 0) return { ships, storage, revenue: 0, sales: [], event: null };
  // Orders still open after what ships already carry home.
  const carried = new Map<string, number>();
  const key = (trader: string, g: Good) => `${trader}|${g}`;
  for (const s of ships)
    if (s.freight) for (const [g, v] of Object.entries(s.freight.goods) as [Good, number][]) carried.set(key(s.freight.trader, g), (carried.get(key(s.freight.trader, g)) ?? 0) + v);
  const openOf = (o: ImportOrder) =>
    (Object.entries(o.goods) as [Good, number][]).map(([g, v]) => [g, Math.max(0, v - (carried.get(key(o.trader, g)) ?? 0))] as const);
  const openAt = (harbour: string) => (orders[harbour] ?? []).reduce((a, o) => a + openOf(o).reduce((b, [, v]) => b + v, 0), 0);
  let store = storage;
  let revenue = 0;
  const sales: Omit<ShipSale, "t">[] = [];
  let event: string | null = null;
  const warehouses = buildings.filter((b) => b.kind === "warehouse");
  const next = ships.map((ship) => {
    const type = shipType(ship.type);
    const t = ship.t + minutes;
    if (ship.state === "docked") {
      const net = networkOf[ship.harbour];
      if (net === null || net === undefined || harbourWater[ship.harbour]) return ship.t === 0 ? ship : { ...ship, t: 0 };
      const sources = warehouses.filter((w) => networkOf[w.id] === net && storedTotal(store[w.id]) > 1e-3);
      const available = sources.reduce((s, w) => s + storedTotal(store[w.id]), 0);
      const ordered = openAt(ship.harbour) >= MIN_ORDER;
      if (available < 1 && !ordered) return ship.t === 0 ? ship : { ...ship, t: 0 };
      // Wait up to two game hours for a quarter load, then leave with what there is
      // (at once if an import order waits at the market).
      if (available < type.capacity * MIN_LOAD && ship.t < 120 && !ordered) return { ...ship, t };
      // Load the most valuable goods first.
      const cargo: Partial<Record<Good, number>> = {};
      let room = type.capacity;
      const goods = [...STORABLE].sort((a, b) => PRICE[b] - PRICE[a]);
      store = { ...store };
      for (const g of goods) {
        for (const w of sources) {
          if (room < 1e-6) break;
          const have = store[w.id]?.[g] ?? 0;
          const take = Math.min(have, room);
          if (take < 1e-6) continue;
          store[w.id] = { ...store[w.id], [g]: have - take };
          cargo[g] = (cargo[g] ?? 0) + take;
          room -= take;
        }
      }
      return { ...ship, state: "loading" as const, t: 0, cargo };
    }
    if (ship.state === "loading") return t >= LOAD_MINUTES ? { ...ship, state: "out" as const, t: 0 } : { ...ship, t };
    if (ship.state === "out") {
      if (t < type.trip / 2) return { ...ship, t };
      const value = cargoValue(ship.cargo);
      const goods = (Object.keys(ship.cargo) as Good[]).filter((g) => (ship.cargo[g] ?? 0) > 0.5).map((g) => GOOD_LABEL[g]);
      if (value > 0.5) {
        revenue += value;
        sales.push({ value, harbour: ship.harbour, ship: ship.name });
        event = `${type.label} „${ship.name}“ hat ${goods.join(", ") || "Waren"} für ${Math.round(value).toLocaleString("de-DE")} € verkauft`;
      }
      // Return freight: the biggest open order of this harbour, as much as fits.
      const order = (orders[ship.harbour] ?? [])
        .map((o) => ({ o, open: openOf(o) }))
        .sort((a, b) => b.open.reduce((x, [, v]) => x + v, 0) - a.open.reduce((x, [, v]) => x + v, 0))[0];
      let freight: Ship["freight"];
      if (order) {
        const want = order.open.reduce((x, [, v]) => x + v, 0);
        const share = want > 0 ? Math.min(1, type.capacity / want) : 0;
        const load: Partial<Record<Good, number>> = {};
        for (const [g, v] of order.open) if (v * share >= 1) load[g] = Math.floor(v * share);
        if (Object.keys(load).length > 0) {
          freight = { trader: order.o.trader, goods: load };
          for (const [g, v] of Object.entries(load) as [Good, number][]) carried.set(key(order.o.trader, g), (carried.get(key(order.o.trader, g)) ?? 0) + v);
        }
      }
      return { ...ship, state: "back" as const, t: 0, cargo: {}, freight };
    }
    if (t < type.trip / 2) return { ...ship, t };
    if (ship.freight) {
      // Unload the return freight into the company's store.
      const trader = buildings.find((b) => b.id === ship.freight!.trader);
      if (trader) {
        store = { ...store };
        const cur = { ...store[trader.id] };
        let room = Math.max(0, traderCapacity(trader) - storedTotal(cur));
        let units = 0;
        for (const [g, v] of Object.entries(ship.freight.goods) as [Good, number][]) {
          const put = Math.min(room, v);
          cur[g] = (cur[g] ?? 0) + put;
          room -= put;
          units += put;
        }
        store[trader.id] = cur;
        const fee = units * FREIGHT_PER_UNIT;
        if (fee > 0.5) {
          revenue += fee;
          sales.push({ value: fee, harbour: ship.harbour, ship: ship.name });
          const goods = (Object.keys(ship.freight.goods) as Good[]).map((g) => `${Math.round(ship.freight!.goods[g] ?? 0)} ${GOOD_LABEL[g]}`);
          event = `„${ship.name}“ hat ${goods.join(" und ")} für das Import-Export-Kontor gebracht – Fracht +${Math.round(fee).toLocaleString("de-DE")} €`;
        }
      }
    }
    return { ...ship, state: "docked" as const, t: 0, freight: undefined };
  });
  return { ships: next, storage: store, revenue, sales, event };
}

/** One record of a sale, for the tax office (average income over the last game day). */
export interface ShipSale {
  t: number;
  value: number;
  /** Harbour and ship name (older saves have neither). */
  harbour?: string;
  ship?: string;
}
/** Keep sales of the last game day. */
export const SALE_WINDOW = 1440;
/** Sales of the last game day as a per-minute rate in HUD units (money moves by rate / 60 per game minute). */
export const salesRate = (sales: ShipSale[], now: number) =>
  sales.filter((s) => s.t > now - SALE_WINDOW).reduce((a, s) => a + s.value, 0) / (SALE_WINDOW / 60);

/** Sales of the last game day of one harbour (total money). */
export const harbourSales = (sales: ShipSale[], harbour: string, now: number) =>
  sales.filter((s) => s.harbour === harbour && s.t > now - SALE_WINDOW).reduce((a, s) => a + s.value, 0);
