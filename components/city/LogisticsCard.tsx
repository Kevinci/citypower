"use client";

import {
  AIR_PRICE_FACTOR,
  BUILDINGS,
  FARE,
  HOLIDAY_PER_RESIDENT,
  GOOD_ICON,
  GOOD_LABEL,
  IMPORT_COST,
  IMPORT_GOODS,
  levelFactor,
  PRICE,
  SHIP_PRICE_FACTOR,
  storedTotal,
  TRADER_HARBOUR_DISTANCE,
  traderCapacity,
  warehouseCapacity,
  type Building,
  type Good,
} from "@/lib/city/economy";
import { cargoValue, FREIGHT_PER_UNIT, HARBOUR_BERTHS, harbourSales, LOAD_MINUTES, SHIP_RESALE, SHIP_STATE_LABEL, SHIP_TYPES, shipType } from "@/lib/city/shipping";
import { useCity } from "@/lib/city/store";
import { depotSlots, FARE as RAIL_FARE, FREIGHT_RATE, STATION_CAPACITY, STATION_RADIUS, TRAIN_RESALE, TRAIN_TYPES, trainType } from "@/lib/city/railway";
import { GameIcon } from "./GameIcon";
import { euro, Pill } from "./Hud";

/*
 * Building card sections for logistics: the warehouse's stock and the harbour's fleet
 * (buy and sell ships). Same look as the sections in BuildingCard.
 */

function Title({ children }: { children: string }) {
  return <div className="px-3 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a8794]">{children}</div>;
}

function FillBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className="relative block h-2 w-full overflow-hidden rounded-full bg-[#2c3640]/10">
      <span className={`absolute inset-y-0 left-0 rounded-full ${v > 0.95 ? "bg-[#c0392b]" : v > 0.75 ? "bg-[#e0a030]" : "bg-[#1a8fc8]"}`} style={{ width: `${v * 100}%` }} />
    </span>
  );
}

export function WarehouseSection({ building }: { building: Building }) {
  const stock = useCity((s) => s.storage[building.id]);
  const economy = useCity((s) => s.economy);
  const buildings = useCity((s) => s.buildings);
  const hasHarbour = useCity((s) => s.buildings.some((b) => b.kind === "harbour"));
  const cap = warehouseCapacity(building);
  const total = storedTotal(stock);
  const goods = (Object.keys(stock ?? {}) as Good[]).filter((g) => (stock?.[g] ?? 0) >= 0.5);
  const value = goods.reduce((s, g) => s + (stock?.[g] ?? 0) * PRICE[g] * SHIP_PRICE_FACTOR, 0);
  const incoming = economy?.storageIn[building.id];
  const suppliers = [...new Set((economy?.flows ?? []).filter((f) => f.to === building.id).map((f) => f.from))]
    .map((id) => buildings.find((b) => b.id === id))
    .filter((b): b is Building => !!b);
  return (
    <div className="border-t border-black/10 py-1">
      <Title>Lagerbestand</Title>
      <div className="px-3 py-[3px] text-[11px]">
        <div className="flex justify-between">
          <span className="text-[#1d5f86]">Belegt</span>
          <span className="font-mono text-[#1d2a35]">
            {Math.round(total)} / {Math.round(cap)}
          </span>
        </div>
        <div className="mt-1">
          <FillBar value={total / cap} />
        </div>
      </div>
      {goods.length === 0 && <div className="px-3 py-[2px] text-[11px] text-[#7a8794]">Noch leer – wartet auf Überschuss der Fabriken im Straßennetz.</div>}
      {goods.map((g) => (
        <div key={g} className="flex items-center gap-1.5 px-3 py-[2px] text-[11px]">
          <GameIcon name={GOOD_ICON[g]} size={14} />
          <span className="flex-1 text-[#1d5f86]">{GOOD_LABEL[g]}</span>
          <span className="font-mono text-[#1d2a35]">{Math.round(stock?.[g] ?? 0)}</span>
          {(incoming?.[g] ?? 0) > 0.01 && <span className="font-mono text-[10px] text-[#2c8f4e]">+{(incoming![g]! as number).toFixed(1)}/min</span>}
        </div>
      ))}
      {goods.length > 0 && (
        <div className="flex justify-between px-3 py-[2px] text-[11px]">
          <span className="text-[#1d5f86]">Wert beim Schiffsverkauf</span>
          <span className="font-mono text-[#2c8f4e]">{euro(value)}</span>
        </div>
      )}
      {suppliers.length > 0 && (
        <div className="px-3 py-[2px] text-[10px] leading-snug text-[#2c3640]">Überschuss von: {suppliers.map((b) => BUILDINGS[b.kind].label).join(", ")}</div>
      )}
      <div className="px-3 py-[2px] text-[10px] leading-snug text-[#7a8794]">
        {hasHarbour
          ? "Schiffe der Häfen im selben Straßennetz holen die Waren ab."
          : "Ohne Hafen bleibt die Ware liegen – baue einen Binnenhafen am Fluss und kaufe Schiffe."}
      </div>
    </div>
  );
}

export function HarbourSection({ building }: { building: Building }) {
  const ships = useCity((s) => s.ships);
  const money = useCity((s) => s.money);
  const buyShip = useCity((s) => s.buyShip);
  const sellShip = useCity((s) => s.sellShip);
  const storage = useCity((s) => s.storage);
  const economy = useCity((s) => s.economy);
  const buildings = useCity((s) => s.buildings);
  const fleet = ships.filter((s) => s.harbour === building.id);
  const net = economy?.networkOf[building.id];
  const stores = buildings.filter((b) => b.kind === "warehouse" && net !== undefined && net !== null && economy?.networkOf[b.id] === net);
  const waiting = stores.reduce((s, w) => s + storedTotal(storage[w.id]), 0);
  const shipSales = useCity((s) => s.shipSales);
  const now = useCity((s) => s.gameMinutes);
  const earned = harbourSales(shipSales, building.id, now);
  const lastSale = [...shipSales].reverse().find((x) => x.harbour === building.id);
  return (
    <div className="border-t border-black/10 py-1">
      <Title>{`Flotte · ${fleet.length} / ${HARBOUR_BERTHS} Liegeplätze`}</Title>
      <div className="px-3 py-[2px] text-[11px] text-[#2c3640]">
        {stores.length === 0 ? (
          <span className="font-semibold text-[#c0392b]">Keine Lagerhalle im Straßennetz – Schiffe haben nichts zu laden.</span>
        ) : (
          <>
            {stores.length} Lagerhalle{stores.length > 1 ? "n" : ""} angebunden · {Math.round(waiting)} Einheiten bereit
          </>
        )}
      </div>
      <div className="flex justify-between px-3 py-[2px] text-[11px]">
        <span className="text-[#1d5f86]">Erlös letzter Spieltag</span>
        <span className={`font-mono ${earned > 0 ? "font-semibold text-[#2c8f4e]" : "text-[#7a8794]"}`}>{earned > 0 ? `+${euro(earned)}` : "noch nichts verkauft"}</span>
      </div>
      {lastSale && (
        <div className="px-3 py-[2px] text-[10px] text-[#7a8794]">
          Letzter Verkauf: {lastSale.ship ? `„${lastSale.ship}“ ` : ""}+{euro(lastSale.value)} vor {Math.max(0, Math.round((now - lastSale.t) / 60))} h
        </div>
      )}
      {fleet.map((ship) => {
        const type = shipType(ship.type);
        const cargo = Object.values(ship.cargo).reduce((a, v) => a + (v ?? 0), 0);
        const length = ship.state === "loading" ? LOAD_MINUTES : ship.state === "docked" ? 0 : type.trip / 2;
        return (
          <div key={ship.id} className="mx-3 my-1 rounded-lg border border-black/10 bg-white/70 px-2.5 py-1.5 text-[11px]">
            <div className="flex items-center gap-1.5">
              <GameIcon name="ship" size={16} />
              <span className="flex-1 font-semibold text-[#1d2a35]">
                „{ship.name}“ <span className="font-normal text-[#7a8794]">{type.label}</span>
              </span>
              <Pill onClick={() => sellShip(ship.id)} title={`Verkaufen für ${euro(type.cost * SHIP_RESALE)}`}>
                Verkaufen
              </Pill>
            </div>
            <div className="mt-0.5 text-[#2c3640]">
              {SHIP_STATE_LABEL[ship.state]}
              {length > 0 && <span className="text-[#7a8794]"> · {Math.max(0, Math.round(length - ship.t))} min</span>}
            </div>
            {ship.freight && (
              <div className="text-[#1d5f86]">
                Rückfracht fürs Kontor:{" "}
                {(Object.keys(ship.freight.goods) as Good[]).map((g) => `${Math.round(ship.freight!.goods[g] ?? 0)} ${GOOD_LABEL[g]}`).join(", ")}
              </div>
            )}
            {cargo > 0 && (
              <div className="text-[#2c8f4e]">
                Ladung {Math.round(cargo)} / {type.capacity} · bringt +{euro(cargoValue(ship.cargo))} beim Verkauf
              </div>
            )}
          </div>
        );
      })}
      <Title>Schiff kaufen</Title>
      {SHIP_TYPES.map((t) => {
        const full = fleet.length >= HARBOUR_BERTHS;
        return (
          <div key={t.id} className="flex items-center gap-2 px-3 py-[3px] text-[11px]">
            <div className="flex-1">
              <div className="font-semibold text-[#1d2a35]">{t.label}</div>
              <div className="text-[10px] text-[#7a8794]">
                {t.capacity} Einheiten · Fahrt {Math.round(t.trip / 60)} h · {euro(t.upkeep)}/min
              </div>
            </div>
            <Pill
              tone="go"
              disabled={full || money < t.cost}
              onClick={() => buyShip(building.id, t.id)}
              title={full ? "Alle Liegeplätze belegt" : money < t.cost ? "Nicht genug Geld" : "Kaufen"}
            >
              {euro(t.cost)}
            </Pill>
          </div>
        );
      })}
    </div>
  );
}

/** Import-export company: its store, open orders (brought by the harbour's ships) and prices. */
export function TraderSection({ building }: { building: Building }) {
  const stock = useCity((s) => s.storage[building.id]);
  const economy = useCity((s) => s.economy);
  const buildings = useCity((s) => s.buildings);
  const ships = useCity((s) => s.ships);
  const cap = traderCapacity(building);
  const total = storedTotal(stock);
  const harbour =
    buildings
      .filter((h) => h.kind === "harbour" && Math.hypot(h.x - building.x, h.z - building.z) <= TRADER_HARBOUR_DISTANCE + 1)
      .filter((h) => economy?.networkOf[h.id] !== undefined && economy?.networkOf[h.id] === economy?.networkOf[building.id])
      .sort((a, b) => Math.hypot(a.x - building.x, a.z - building.z) - Math.hypot(b.x - building.x, b.z - building.z))[0] ?? null;
  const fleet = harbour ? ships.filter((s) => s.harbour === harbour.id) : [];
  const order = harbour ? economy?.importOrders[harbour.id]?.find((o) => o.trader === building.id) : undefined;
  const sold = economy?.importOut[building.id] ?? {};
  const coming = ships.filter((s) => s.freight?.trader === building.id);
  return (
    <div className="border-t border-black/10 py-1">
      <Title>Lager · Bestellungen aus dem Ausland</Title>
      <div className="px-3 py-[3px] text-[11px]">
        <div className="flex justify-between">
          <span className="text-[#1d5f86]">Belegt</span>
          <span className="font-mono text-[#1d2a35]">
            {Math.round(total)} / {Math.round(cap)}
          </span>
        </div>
        <div className="mt-1">
          <FillBar value={total / cap} />
        </div>
      </div>
      {IMPORT_GOODS.map(({ good, origin }) => (
        <div key={good} className="px-3 py-[3px] text-[11px]">
          <div className="flex items-center gap-1.5">
            <GameIcon name={GOOD_ICON[good]} size={14} />
            <span className="flex-1 text-[#1d5f86]">
              {GOOD_LABEL[good]} <span className="text-[#7a8794]">aus {origin}</span>
            </span>
            <span className="font-mono text-[#1d2a35]">{Math.round(stock?.[good] ?? 0)}</span>
            {(sold[good] ?? 0) > 0.01 && <span className="font-mono text-[10px] text-[#c0392b]">−{sold[good]!.toFixed(1)}/min</span>}
          </div>
          <div className="pl-5 text-[10px] text-[#7a8794]">
            Einkauf {euro(PRICE[good] * IMPORT_COST)} · Verkauf {euro(PRICE[good])} je Einheit
            {(order?.goods[good] ?? 0) >= 1 && <span className="text-[#1d5f86]"> · bestellt {Math.round(order!.goods[good]!)}</span>}
          </div>
        </div>
      ))}
      {coming.length > 0 && (
        <div className="px-3 py-[2px] text-[11px] text-[#2c8f4e]">
          Unterwegs:{" "}
          {coming
            .map((s) => `„${s.name}“ mit ${(Object.keys(s.freight!.goods) as Good[]).map((g) => `${Math.round(s.freight!.goods[g] ?? 0)} ${GOOD_LABEL[g]}`).join(", ")}`)
            .join(" · ")}
        </div>
      )}
      <div className="px-3 py-[2px] text-[10px] leading-snug text-[#7a8794]">
        {!harbour
          ? `Kein Binnenhafen im Umkreis von ${TRADER_HARBOUR_DISTANCE} m im selben Straßennetz – die Ware kann nicht ankommen.`
          : fleet.length === 0
            ? "Der Hafen hat noch keine Schiffe – kaufe im Hafen ein Schiff, es bringt die Bestellungen als Rückfracht mit."
            : `Bestellt automatisch, was die Betriebe im Straßennetz brauchen. ${fleet.length} Schiff${fleet.length > 1 ? "e" : ""} des Hafens bringen die Ware mit, die Stadt verdient ${euro(FREIGHT_PER_UNIT)} Fracht je Einheit.`}
      </div>
    </div>
  );
}

/** Airport: holiday flights and air freight. */
export function AirportSection({ building }: { building: Building }) {
  const economy = useCity((s) => s.economy);
  const air = economy?.status[building.id]?.airport;
  const demand = (economy?.residents ?? 0) * HOLIDAY_PER_RESIDENT;
  const cargo = (Object.keys(air?.cargo ?? {}) as Good[]).filter((g) => (air?.cargo[g] ?? 0) > 0.01);
  const cargoTotal = cargo.reduce((s, g) => s + (air?.cargo[g] ?? 0), 0);
  // One game day = 1440 minutes; rates are per HUD minute.
  const perDay = (v: number) => Math.round(v * 24);
  return (
    <>
      <div className="border-t border-black/10 py-1">
        <Title>Urlaubsflüge</Title>
        <div className="px-3 py-[3px] text-[11px]">
          <div className="flex justify-between">
            <span className="text-[#1d5f86]">Urlauber pro Tag</span>
            <span className="font-mono text-[#1d2a35]">
              {perDay(air?.passengers ?? 0)} / {perDay(demand)} gewünscht
            </span>
          </div>
          <div className="mt-1">
            <FillBar value={demand > 0 ? (air?.passengers ?? 0) / demand : 0} />
          </div>
          <div className="mt-0.5 flex justify-between text-[10px] text-[#7a8794]">
            <span>Plätze für {perDay(air?.capacity ?? 0)} pro Tag</span>
            <span className="text-[#2c8f4e]">{economy ? `${Math.round(economy.holiday * 100)} % kommen gut gelaunt zurück` : ""}</span>
          </div>
        </div>
        <div className="px-3 py-[2px] text-[11px]">
          <div className="flex justify-between">
            <span className="text-[#1d5f86]">Flughafengebühren</span>
            <span className="font-mono text-[#2c8f4e]">+{euro(air?.fares ?? 0)}/min</span>
          </div>
          <div className="text-[10px] text-[#7a8794]">{euro(FARE)} je Passagier · Urlaub hebt die Stimmung (Rathaus) und lockt Zuzügler an</div>
        </div>
      </div>
      <div className="border-t border-black/10 py-1">
        <Title>Luftfracht</Title>
        {building.level < 2 ? (
          <div className="px-3 py-[2px] text-[10px] leading-snug text-[#7a8794]">
            Ab dem Regionalflughafen fliegen Frachtflugzeuge Waren aus den Lagerhallen im Straßennetz aus (zum {AIR_PRICE_FACTOR}-fachen Großhandelspreis).
          </div>
        ) : (
          <>
            <div className="px-3 py-[3px] text-[11px]">
              <div className="flex justify-between">
                <span className="text-[#1d5f86]">Ausgeflogen</span>
                <span className="font-mono text-[#1d2a35]">
                  {cargoTotal.toFixed(1)} / {(air?.cargoCapacity ?? 0).toFixed(0)} pro min
                </span>
              </div>
              <div className="mt-1">
                <FillBar value={(air?.cargoCapacity ?? 0) > 0 ? cargoTotal / air!.cargoCapacity : 0} />
              </div>
            </div>
            {cargo.map((g) => (
              <div key={g} className="flex items-center gap-1.5 px-3 py-[2px] text-[11px]">
                <GameIcon name={GOOD_ICON[g]} size={14} />
                <span className="flex-1 text-[#1d5f86]">{GOOD_LABEL[g]}</span>
                <span className="font-mono text-[#1d2a35]">{air!.cargo[g]!.toFixed(1)}/min</span>
              </div>
            ))}
            <div className="px-3 py-[2px] text-[11px]">
              <div className="flex justify-between">
                <span className="text-[#1d5f86]">Frachterlös</span>
                <span className="font-mono text-[#2c8f4e]">+{euro(air?.freight ?? 0)}/min</span>
              </div>
              {cargo.length === 0 && <div className="text-[10px] text-[#7a8794]">Die Lagerhallen im Straßennetz sind leer – nichts zum Ausfliegen.</div>}
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** Station: reach, passengers and freight, and what keeps trains from stopping here. */
export function StationSection({ building }: { building: Building }) {
  const st = useCity((s) => s.economy?.rail?.stations[building.id]);
  if (!st) return null;
  return (
    <div className="border-t border-black/10 py-1">
      <Title>Bahnhof</Title>
      {st.problem && <div className="px-3 py-[2px] text-[11px] font-semibold text-[#c0392b]">{st.problem}</div>}
      <Line label="Umkreis" value={`${STATION_RADIUS[building.level]} m`} />
      <Line label="Einwohner im Umkreis" value={String(Math.round(st.residents))} />
      <Line label="Fahrgäste" value={`${st.passengers.toFixed(1)} /min · ${euro(st.passengers * RAIL_FARE)}/min`} />
      <Line label="Industrie-Arbeitsplätze im Umkreis" value={String(Math.round(st.jobs))} />
      <Line label="Fracht" value={`${st.freight.toFixed(1)} /min · ${euro(st.freight * FREIGHT_RATE)}/min`} />
      <div className="px-3 py-[3px] text-[10px] text-[#7a8794]">
        Höchstens {Math.round(STATION_CAPACITY * levelFactor(building))} Fahrgäste/min. Bahnanschluss bringt etwas mehr Zuzug.
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between px-3 py-[2px] text-[11px]">
      <span className="text-[#1d5f86]">{label}</span>
      <span className="font-mono text-[#2c3640]">{value}</span>
    </div>
  );
}

/** Signal box: its trains (sell) and the train shop. */
export function DepotSection({ building }: { building: Building }) {
  const trains = useCity((s) => s.trains);
  const money = useCity((s) => s.money);
  const buyTrain = useCity((s) => s.buyTrain);
  const sellTrain = useCity((s) => s.sellTrain);
  const st = useCity((s) => s.economy?.rail?.depots[building.id]);
  const fleet = trains.filter((t) => t.depot === building.id);
  const slots = depotSlots(building);
  return (
    <div className="border-t border-black/10 py-1">
      <Title>{`Züge · ${fleet.length} / ${slots} Abstellgleise`}</Title>
      {st?.problem && <div className="px-3 py-[2px] text-[11px] font-semibold text-[#c0392b]">{st.problem}</div>}
      {st && (
        <>
          <Line label="Bahnhöfe im Gleisnetz" value={String(st.stations)} />
          <Line label="Einnahmen der Züge" value={`${euro(st.revenue)}/min`} />
        </>
      )}
      {fleet.map((train) => {
        const type = trainType(train.type);
        return (
          <div key={train.id} className="mx-3 my-1 flex items-center gap-1.5 rounded-lg border border-black/10 bg-white/70 px-2.5 py-1.5 text-[11px]">
            <GameIcon name="train" size={16} />
            <span className="flex-1 font-semibold text-[#1d2a35]">
              „{train.name}“ <span className="font-normal text-[#7a8794]">{type.label} · {euro(type.upkeep)}/min</span>
            </span>
            <Pill onClick={() => sellTrain(train.id)} title={`Verkaufen für ${euro(type.cost * TRAIN_RESALE)}`}>
              Verkaufen
            </Pill>
          </div>
        );
      })}
      <Title>Zug kaufen</Title>
      {TRAIN_TYPES.map((t) => {
        const full = fleet.length >= slots;
        return (
          <div key={t.id} className="flex items-center gap-2 px-3 py-[3px] text-[11px]">
            <div className="flex-1">
              <div className="font-semibold text-[#1d2a35]">{t.label}</div>
              <div className="text-[10px] text-[#7a8794]">
                {t.freight ? `${t.capacity} Einheiten Fracht/min` : `${t.capacity} Fahrgäste/min`} · {Math.round(t.speed * 3.6)} km/h · {euro(t.upkeep)}/min
              </div>
            </div>
            <Pill
              tone="go"
              disabled={full || money < t.cost}
              onClick={() => buyTrain(building.id, t.id)}
              title={full ? "Alle Abstellgleise belegt – Stellwerk ausbauen" : money < t.cost ? "Nicht genug Geld" : "Kaufen"}
            >
              {euro(t.cost)}
            </Pill>
          </div>
        );
      })}
    </div>
  );
}
