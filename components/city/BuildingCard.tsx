import { Html } from "@react-three/drei";
import { useMemo, type ReactNode } from "react";
import {
  MAYOR_PRIVATE,
  BUILDINGS,
  GOOD_ICON,
  GOOD_LABEL,
  HOSPITAL_CAPACITY,
  FARM_LEVEL_NAME,
  JEWELLER_CAPACITY,
  UPGRADE_NEEDS,
  LEVELS,
  JOBCENTRE_RADIUS,
  SCHOOL_CAPACITY,
  RECREATION_RADIUS,
  ROADLESS_KINDS,
  SERVICE_RADIUS,
  vehiclesOf,
  AMBULANCE_RADIUS,
  FIRE_LEVY,
  MISSION_FEE,
  POLICE_FINES,
  TRADER_CAPACITY,
  AIRPORT_PASSENGERS,
  AIR_CARGO,
  WAREHOUSE_CAPACITY,
  MILL_FACTOR,
  MILL_LEVEL_NAME,
  STORE_LEVEL_FACTOR,
  STORE_LEVEL_NAME,
  jobsOf,
  levelName,
  PUBLIC,
  upkeepOf,
  WAGE,
  MAX_HOUSE_LEVEL,
  houseCap,
  HOUSE_LEVEL_NAME,
  MAX_WATER_LEVEL,
  RECIPES,
  householdsOf,
  residentsOf,
  WATER_CAPACITY,
  WATER_LEVEL_NAME,
  waterOf,
  type Building,
  type BuildingStatus,
  type Finance,
  type Flow,
  type Good,
} from "@/lib/city/economy";
import { buildingGround, planGrowth } from "@/lib/city/placement";
import {
  fuelPerMinute,
  POWER_CAPACITY,
  POWER_LEVEL_NAME,
  powerOf,
  TRANSFORMER_LEVEL_NAME,
  TRANSFORMER_RADIUS,
} from "@/lib/city/power";
import { useCity, type CityPanel } from "@/lib/city/store";
import { busyAmbulances, busyVehicles, INCIDENT_LABEL } from "@/lib/city/incidents";
import { GameIcon } from "./GameIcon";
import { AirportSection, DepotSection, HarbourSection, StationSection, TraderSection, WarehouseSection } from "./LogisticsCard";
import { euro, Icon, panel, Pill } from "./Hud";
import { useDepthGrid } from "./useWater";
import { LaunderingSection, ProtectionSection } from "./MayorPanel";

/** Height of the card's anchor above the building's ground. */
const PANEL_BUTTON: Record<CityPanel, string> = {
  bank: "Finanzen & Kredite öffnen",
  townhall: "Analysen, Bürger & Baugenehmigungen",
  taxoffice: "Steuern & Haushalt öffnen",
  exchange: "Kurse öffnen",
  mayor: "Privatkonto öffnen",
  casino: "Roulette spielen",
  newspaper: "Zeitung lesen",
};

/** Card height above a house per level (blocks and towers are tall). */
const HOUSE_ANCHOR = [16, 16, 16, 16, 27, 44, 76, 132];
const ANCHOR: Record<string, number> = {
  pool: 12,
  fair: 30,
  bank: 16,
  exchange: 20,
  townhall: 32,
  taxoffice: 22,
  jobcenter: 18,
  recycling: 12,
  park: 10,
  playground: 8,
  warehouse: 16,
  harbour: 24,
  house: 16,
  church: 36,
  farm: 18,
  mill: 20,
  bakery: 13,
  waterworks: 16,
  hospital: 19,
  ruin: 8,
  trainstation: 16,
  prison: 18,
  villa: 20,
  casino: 22,
  pizzeria: 12,
  boathouse: 12,
  newspaper: 16,
  traindepot: 14,
  police: 16,
  firestation: 22,
  school: 20,
  steelworks: 40,
  sawmill: 18,
  furniture: 16,
  furniturestore: 14,
  slaughterhouse: 16,
  butcher: 13,
  restaurant: 12,
  cinema: 15,
  powerplant: 34,
  transformer: 22,
  coalmine: 26,
  ironmine: 26,
  uraniummine: 26,
  sheepfarm: 16,
  spinning: 20,
  clothing: 18,
  fashion: 13,
  chickenfarm: 8,
  trader: 14,
  foodfactory: 18,
  discounter: 10,
  goldmine: 26,
  goldsmelter: 20,
  jeweller: 10,
  airport: 24,
};

const fmt = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1));

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-black/10 py-1">
      <div className="px-3 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a8794]">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-4 px-3 py-[3px] text-[11px]">
      <span className="text-[#1d5f86]">{label}</span>
      <span className={`font-mono ${warn ? "font-semibold text-[#c0392b]" : "text-[#1d2a35]"}`}>{value}</span>
    </div>
  );
}

/** One need with a clear verdict (genug / zu wenig), the amounts and the source. */
function Need({
  icon,
  label,
  got,
  need,
  unit = "/ min",
  from,
}: {
  icon: string;
  label: string;
  got: number;
  need: number;
  unit?: string;
  from?: string;
}) {
  const enough = need <= 1e-6 || got >= need * 0.99;
  return (
    <div className="px-3 py-[3px] text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[#1d5f86]">
          <GameIcon name={icon} size={14} /> {label}
        </span>
        <span className={`font-mono ${enough ? "text-[#1d2a35]" : "font-semibold text-[#c0392b]"}`}>
          {unit ? `${fmt(got)} / ${fmt(need)} ${unit}` : `${Math.round(got)} / ${Math.round(need)}`}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="truncate text-[#7a8794]">{from ?? " "}</span>
        <span className={`flex shrink-0 items-center gap-0.5 font-semibold ${enough ? "text-[#2c8f4e]" : "text-[#c0392b]"}`}>
          <GameIcon name={enough ? "check" : "cross"} size={11} />
          {enough ? "genug" : "zu wenig"}
        </span>
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  tone,
}: {
  icon: "upgrade" | "demolish" | "close";
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-9 w-9 place-items-center rounded-full border-2 bg-gradient-to-b from-white to-[#d6dce2] transition hover:from-white hover:to-white disabled:opacity-35 ${
        tone === "danger" ? "border-[#c0392b] text-[#c0392b]" : "border-[#3d4650] text-[#2c3640]"
      }`}
    >
      <Icon name={icon} className="h-4 w-4" />
    </button>
  );
}

/** A business's own accounts: it earns, buys, pays wages – and business tax to the town. */
function FinanceSection({ f, workers }: { f: Finance; workers: number }) {
  const line = (label: string, v: number, sub?: string) =>
    Math.abs(v) < 0.05 ? null : (
      <div className="flex items-baseline justify-between gap-2 px-3 py-[2px] text-[11px]">
        <span className="text-[#1d5f86]">
          {label}
          {sub && <span className="ml-1 text-[10px] text-[#7a8794]">{sub}</span>}
        </span>
        <span className={`font-mono ${v < 0 ? "text-[#c0392b]" : "text-[#1d2a35]"}`}>
          {v < 0 ? "−" : "+"}
          {euro(Math.abs(v))}
        </span>
      </div>
    );
  return (
    <Section title="Bilanz des Betriebs / min">
      {line("Verkauf an Betriebe", f.sales)}
      {line("Verkauf an Kunden", f.retail)}
      {line("Großhandel / Export", f.export, "Überschuss")}
      {line("Einkauf", -f.purchases)}
      {line("Löhne", -f.wages, `${Math.round(workers)} × ${euro(WAGE)}`)}
      {line("Betriebskosten", -f.upkeep)}
      {line("Wasser", -f.water)}
      {line("Strom", -f.power)}
      {line("Gewerbesteuer an die Stadt", -f.tax)}
      <div className="mx-3 mt-0.5 flex justify-between border-t border-black/10 pt-0.5 text-[11px] font-semibold">
        <span className="text-[#1d5f86]">Gewinn</span>
        <span className={`font-mono ${f.profit < 0 ? "text-[#c0392b]" : "text-[#2c8f4e]"}`}>
          {f.profit < 0 ? "−" : "+"}
          {euro(Math.abs(f.profit))}
        </span>
      </div>
    </Section>
  );
}

/** Names of partner buildings with distances, e.g. "Mühle 120 m". */
function partners(ids: string[], buildings: Building[], self: Building) {
  const names = [...new Set(ids)]
    .map((id) => buildings.find((b) => b.id === id))
    .filter((b): b is Building => !!b)
    .map((b) => `${BUILDINGS[b.kind].label} ${Math.round(Math.hypot(b.x - self.x, b.z - self.z))} m`);
  return names.length > 0 ? names.join(", ") : undefined;
}

/**
 * Info card of the selected building, floating above it like SimCity's in-world
 * rollovers. Every need states whether there is enough of it and where it comes from;
 * production shows actual vs maximum and who receives it.
 */
export function BuildingCard() {
  const building = useCity((s) => s.buildings.find((b) => b.id === s.selected));
  const buildings = useCity((s) => s.buildings);
  const economy = useCity((s) => s.economy);
  const incidents = useCity((s) => s.incidents);
  // The villa is paid from the mayor's private account.
  const money = useCity((s) => {
    const kind = s.buildings.find((b) => b.id === s.selected)?.kind;
    return kind && MAYOR_PRIVATE.includes(kind) ? s.mayor.account : s.money;
  });
  const upgrade = useCity((s) => s.upgrade);
  const autoCable = useCity((s) => s.autoCable);
  const demolish = useCity((s) => s.demolish);
  const select = useCity((s) => s.select);
  const setPanel = useCity((s) => s.setPanel);
  const grid = useDepthGrid();
  const y = useMemo(() => (building ? buildingGround(building, grid) : 0), [building, grid]);
  const roads = useCity((s) => s.roads);
  const rails = useCity((s) => s.rails);
  const canals = useCity((s) => s.canals);
  const cables = useCity((s) => s.cables);
  // What the next level means for the plot: houses to clear or what blocks it.
  const growth = useMemo(() => {
    const costs = building ? BUILDINGS[building.kind].upgrade : undefined;
    if (!building || !costs || building.level >= costs.length - 1) return null;
    return planGrowth(building, building.level + 1, [...roads, ...rails, ...canals], buildings, grid, cables);
  }, [building, roads, rails, canals, buildings, grid, cables]);
  if (!building) return null;

  const status = economy?.status[building.id];
  const spec = BUILDINGS[building.kind];
  const recipe = RECIPES[building.kind];
  const title = levelName(building);
  // The villa opens the mayor's private side (paid from there).
  const panelKind = MAYOR_PRIVATE.includes(building.kind) ? "mayor" : building.kind in PANEL_BUTTON ? (building.kind as CityPanel) : null;
  const nextCost = spec.upgrade?.[building.level + 1];
  const canUpgrade = !!spec.upgrade && building.level < spec.upgrade.length - 1 && nextCost !== undefined;
  const upgradeText =
    building.kind === "waterworks"
      ? `Ausbau zu „${WATER_LEVEL_NAME[building.level + 1]}“: ${WATER_CAPACITY[building.level + 1]} / min für `
      : building.kind === "mill"
        ? `Ausbau zur „${MILL_LEVEL_NAME[building.level + 1]}“ (${["", "", "1 Silo", "2 Silos", "Fabrik mit 4 Silos"][building.level + 1]}): ${Math.round(16 * MILL_FACTOR[building.level + 1])} Mehl/min, größeres Grundstück, für `
      : building.kind === "farm"
        ? building.level + 1 === 2
          ? `Ausbau zu „${FARM_LEVEL_NAME[2]}“: liefert zusätzlich Rinder und Schweine an den Schlachthof, für `
          : `Ausbau zum „${FARM_LEVEL_NAME[3]}“: Maschinenhalle und zweites Silo, +60 % Weizen, Milch und Tiere, für `
        : building.kind === "furniturestore"
          ? `Ausbau zum „${STORE_LEVEL_NAME[building.level + 1]}“: Platz für ${10 * STORE_LEVEL_FACTOR[building.level + 1]} Möbel/min (mehr Kunden)${building.level + 1 === 4 ? ", riesiges Grundstück" : ""}, für `
          : building.kind === "warehouse"
            ? `Ausbau zum „${LEVELS.warehouse!.name[building.level + 1]}“: Platz für ${Math.round(WAREHOUSE_CAPACITY * LEVELS.warehouse!.factor[building.level + 1])} Einheiten, größeres Grundstück, für `
          : building.kind === "airport"
            ? `Ausbau zum „${LEVELS.airport!.name[building.level + 1]}“: ${Math.round(AIRPORT_PASSENGERS * LEVELS.airport!.factor[building.level + 1])} Passagiere/min, Luftfracht ${Math.round(AIR_CARGO * LEVELS.airport!.factor[building.level + 1])} Einheiten/min, längere Bahn und Terminal, für `
          : RECREATION_RADIUS[building.kind]
            ? `Ausbau zum „${LEVELS[building.kind]!.name[building.level + 1]}“: Umkreis ${RECREATION_RADIUS[building.kind]![building.level + 1]} m, schöner, für `
          : building.kind === "school"
            ? `Ausbau zur „${LEVELS.school!.name[building.level + 1]}“: Plätze für ${SCHOOL_CAPACITY * LEVELS.school!.factor[building.level + 1]} Einwohner, ein Stockwerk höher, für `
          : building.kind === "jobcenter"
            ? `Ausbau zum „${LEVELS.jobcenter!.name[building.level + 1]}“: Umkreis ${JOBCENTRE_RADIUS[building.level + 1]} m, für `
          : building.kind === "shoefactory"
            ? `Ausbau zum „${LEVELS.shoefactory!.name[building.level + 1]}“: ${LEVELS.shoefactory!.factor[building.level + 1]}× Produktion, ${building.level + 1 === 2 ? "zwei" : "vier"} Stockwerke mehr – gleiches Grundstück, für `
          : building.kind === "goldsmelter"
            ? `Ausbau zur „${LEVELS.goldsmelter!.name[building.level + 1]}“: ${LEVELS.goldsmelter!.factor[building.level + 1]} Goldbarren/min (braucht doppelt so viel Golderz), ${building.level + 1 === 2 ? "Scheidehalle mit zweitem Schornstein" : "Elektrolysehalle und Tresorraum"}, Grundstück wächst nach hinten, für `
          : building.kind === "jeweller"
            ? `Ausbau zum „${LEVELS.jeweller!.name[building.level + 1]}“: ${JEWELLER_CAPACITY * LEVELS.jeweller!.factor[building.level + 1]} Schmuck/min, mehr Kundschaft, ${building.level + 1 === 2 ? "Goldschmiede-Werkstatt dahinter" : "dreistöckiges Schmuckhaus"}, Grundstück wächst nach hinten, für `
          : building.kind === "trader"
            ? `Ausbau zum „${LEVELS.trader!.name[building.level + 1]}“: Lager für ${Math.round(TRADER_CAPACITY * LEVELS.trader!.factor[building.level + 1])} Einheiten, größeres Grundstück, für `
          : LEVELS[building.kind]
            ? `Ausbau zu „${LEVELS[building.kind]!.name[building.level + 1]}“: ${LEVELS[building.kind]!.factor[building.level + 1]}× Produktion, größeres Grundstück, für `
          : building.kind === "powerplant"
          ? `${building.level >= 3 ? "Ausbau" : "Umbau"} zum „${POWER_LEVEL_NAME[building.level + 1]}“: ${POWER_CAPACITY[building.level + 1]} kW, braucht ${
              building.level + 1 === 2
                ? `${fuelPerMinute(2)} Kohle/min (Kohlebergwerk)`
                : `${fuelPerMinute(building.level + 1)} Uran/min (Uranbergwerk)`
            }, für `
          : building.kind === "transformer"
            ? `Ausbau zur „${TRANSFORMER_LEVEL_NAME[building.level + 1]}“: Radius ${TRANSFORMER_RADIUS[building.level + 1]} m für `
            : `Ausbau auf Stufe ${building.level + 1} für `;
  // Houses: the status line names the most pressing shortage of the household.
  const houseProblem =
    building.kind === "house" && economy
      ? economy.breadSold < economy.breadDemand * UPGRADE_NEEDS.bread
        ? "Zu wenig Brot in der Stadt"
        : economy.employment < UPGRADE_NEEDS.employment
          ? "Zu wenige Arbeitsplätze"
          : economy.furnished < UPGRADE_NEEDS.furnished
            ? "Keine Möbel zu kaufen – Möbelhaus fehlt"
            : economy.meatSold < economy.meatDemand * UPGRADE_NEEDS.meat
              ? "Kein Fleisch zu kaufen – Metzgerei fehlt"
              : null
      : null;
  const problem = status?.problem ?? houseProblem;
  const working = status && !problem;
  const flowsIn = economy?.flows.filter((f) => f.to === building.id) ?? [];
  const flowsOut = economy?.flows.filter((f) => f.from === building.id) ?? [];
  const water = waterOf(building);
  const power = powerOf(building);
  // The transformer that supplies this building (nearest one on a grid, within reach).
  const supplier =
    power > 0 && (status?.power ?? 0) > 0
      ? buildings
          .filter((t) => t.kind === "transformer" && Math.hypot(t.x - building.x, t.z - building.z) <= TRANSFORMER_RADIUS[t.level])
          .sort((a, b) => Math.hypot(a.x - building.x, a.z - building.z) - Math.hypot(b.x - building.x, b.z - building.z))[0]
      : undefined;

  return (
    <Html position={[building.x, y + (building.kind === "house" ? HOUSE_ANCHOR[building.level] : (ANCHOR[building.kind] ?? 14)), building.z]} center zIndexRange={[20, 0]}>
      <div className="pointer-events-auto relative -translate-y-1/2 select-none" style={{ width: 272 }}>
        <div className={`overflow-hidden ${panel}`}>
          <div className="flex items-center justify-between px-3 pt-2">
            <GameIcon name={spec.icon} size={22} />
            <span className="text-sm font-semibold text-[#1d5f86]">{title}</span>
            <button type="button" onClick={() => select(null)} aria-label="Schließen" className="text-[#2c3640] hover:text-black">
              <Icon name="close" className="h-4 w-4" />
            </button>
          </div>
          {status && (
            <div
              className={`mx-3 my-1.5 flex items-center justify-center gap-1 rounded-full border bg-white px-2 py-0.5 text-center text-[11px] font-semibold ${
                working ? "border-[#9fc9df] text-[#2c8f4e]" : "border-[#e5b2ab] text-[#c0392b]"
              }`}
            >
              {!working && <Icon name="warn" className="h-3.5 w-3.5" />}
              {working ? (building.kind === "house" ? "Gut versorgt" : "In Betrieb – alles da") : problem}
            </div>
          )}

          {status && (
            <Section title="Bedarf">
              {!ROADLESS_KINDS.includes(building.kind) && (
                <Need
                  icon="road"
                  label="Straßenanschluss"
                  got={status.connected ? 1 : 0}
                  need={1}
                  unit=""
                  from={status.connected ? "angeschlossen" : "Straße in die Nähe bauen"}
                />
              )}
              {water > 0 && <Need icon="water" label="Wasser" got={water * status.water} need={water} from="Wasserleitung im Straßennetz" />}
              {power > 0 && (
                <Need
                  icon="power"
                  label="Strom"
                  got={power * (status.power ?? 0)}
                  need={power}
                  unit="kW"
                  from={
                    supplier
                      ? `${levelName(supplier)} ${Math.round(Math.hypot(supplier.x - building.x, supplier.z - building.z))} m`
                      : "keine Trafostation mit Strom in Reichweite"
                  }
                />
              )}
              {building.kind === "powerplant" && status.plant && (
                <>
                  {building.level === 1 && (
                    <Need
                      icon="canal"
                      label="Kanal am Werk"
                      got={status.problem?.includes("Kanal") ? 0 : 1}
                      need={1}
                      unit=""
                      from={status.problem?.includes("Kanal") ? "Kanal direkt an das Werk bauen" : "Turbinen laufen mit Kanalwasser"}
                    />
                  )}
                  <Need
                    icon="cable"
                    label="Stromleitung"
                    got={status.plant.grid !== null ? 1 : 0}
                    need={1}
                    unit=""
                    from={status.plant.grid !== null ? "Kabel angeschlossen" : "mit dem Kabel-Werkzeug zu Trafostationen legen"}
                  />
                  {status.inputs &&
                    (Object.keys(status.inputs) as Good[]).map((g) => (
                      <Need
                        key={g}
                        icon={GOOD_ICON[g]}
                        label={GOOD_LABEL[g]}
                        got={status.inputs![g]!.got}
                        need={status.inputs![g]!.need}
                        from={
                          partners(
                            flowsIn.filter((f) => f.good === g).map((f) => f.from),
                            buildings,
                            building,
                          ) ?? "kein Bergwerk im Straßennetz"
                        }
                      />
                    ))}
                </>
              )}
              {building.kind === "transformer" && status.transformer && (
                <Need
                  icon="cable"
                  label="Stromleitung"
                  got={status.transformer.grid !== null ? 1 : 0}
                  need={1}
                  unit=""
                  from={status.transformer.grid !== null ? "am Netz" : "Kabel zum Kraftwerk legen"}
                />
              )}
              {jobsOf(building) > 0 && status.staffing !== undefined && (
                <Need
                  icon="worker"
                  label="Arbeiter"
                  got={jobsOf(building) * status.staffing}
                  need={jobsOf(building)}
                  unit=""
                  from="Einwohner der Stadt"
                />
              )}
              {recipe &&
                (Object.keys(recipe.inputs) as Good[]).map((g) => {
                  const io = status.inputs?.[g];
                  // Recycled material is optional: only shown once there is a recycling yard.
                  if (g === "recycled" && !io) return null;
                  return (
                    <Need
                      key={g}
                      icon={GOOD_ICON[g]}
                      label={GOOD_LABEL[g]}
                      got={io?.got ?? 0}
                      need={io?.need ?? recipe.inputs[g] ?? 0}
                      from={g === "caoutchouc" ? "Import aus Übersee (Plantagen)" : inputSource(g, status, flowsIn, buildings, building)}
                    />
                  );
                })}
              {building.kind === "house" && economy && (
                <>
                  <Need
                    icon="bread"
                    label="Brot (ganze Stadt)"
                    got={economy.breadSold}
                    need={economy.breadDemand * UPGRADE_NEEDS.bread}
                    from="Bäckereien im Straßennetz"
                  />
                  <Need
                    icon="meat"
                    label="Fleisch (ganze Stadt)"
                    got={economy.meatSold}
                    need={economy.meatDemand * UPGRADE_NEEDS.meat}
                    from="Metzgereien im Straßennetz"
                  />
                  <Need
                    icon="sofa"
                    label="Möbel (ganze Stadt)"
                    got={economy.furnitureSold}
                    need={economy.furnitureDemand * 0.6}
                    from={`Möbelhäuser · ${Math.round(economy.furnished * 100)} % der Haushalte eingerichtet`}
                  />
                </>
              )}
            </Section>
          )}

          {status?.outputs && (
            <Section title="Produktion">
              {(Object.keys(status.outputs) as Good[]).map((g) => {
                const o = status.outputs![g]!;
                const out = flowsOut.filter((f) => f.good === g);
                const to = partners(
                  out.map((f) => f.to),
                  buildings,
                  building,
                );
                const delivered = out.reduce((s, f) => s + f.amount, 0);
                const exporter = ["steelworks", "sawmill", "furniture", "coalmine", "ironmine", "uraniummine", "tannery", "rubberfactory", "shoefactory", "slaughterhouse", "sheepfarm", "spinning", "clothing", "chickenfarm", "foodfactory", "recycling", "goldmine", "goldsmelter"].includes(building.kind);
                const sold =
                  building.kind === "bakery" || building.kind === "butcher" || building.kind === "shoeshop" || building.kind === "fashion" || building.kind === "discounter" || building.kind === "jeweller"
                    ? "an die Einwohner verkauft"
                    : building.kind === "trader"
                      ? to
                        ? `aus dem Lager an ${to}`
                        : "kein Abnehmer im Straßennetz"
                    : building.kind === "restaurant"
                      ? "Gäste bewirtet"
                      : building.kind === "cinema"
                        ? "Kinobesucher"
                        : building.kind === "pool"
                          ? "Badegäste"
                          : building.kind === "fair"
                            ? "Fahrten verkauft"
                        : building.kind === "furniturestore"
                          ? "an die Haushalte verkauft"
                          : building.kind === "goldsmelter" && (status.vault ?? 0) > 0
                            ? `${to ? `${fmt(delivered)} an ${to}, ` : ""}Rest in den Goldtresor der Bank`
                          : exporter
                            ? to
                              ? `${fmt(delivered)} an ${to}, Rest Export`
                              : "alles in den Export"
                            : undefined;
                return (
                  <div key={g} className="px-3 py-[3px] text-[11px]">
                    <div className="flex justify-between gap-2">
                      <span className="flex items-center gap-1 text-[#1d5f86]">
                        <GameIcon name={GOOD_ICON[g]} size={14} /> {GOOD_LABEL[g]}
                      </span>
                      <span className="font-mono text-[#1d2a35]">
                        {fmt(o.made)} / {fmt(o.max)} pro min
                      </span>
                    </div>
                    <div className="truncate text-[10px] text-[#7a8794]">
                      {sold ?? (to ? `${fmt(delivered)} geliefert an ${to}` : "noch kein Abnehmer im Straßennetz")}
                    </div>
                  </div>
                );
              })}
            </Section>
          )}

          {status && economy && building.kind === "waterworks" && (
            <Section title="Versorgung">
              <Need
                icon="water"
                label="Leistung / Bedarf Stadt"
                got={economy.waterCapacity}
                need={economy.waterDemand}
                from={`diese Anlage ${WATER_CAPACITY[building.level]} / min · Stufe ${building.level}/${MAX_WATER_LEVEL}`}
              />
              <div className="flex items-center gap-1.5 px-3 py-[3px] text-[10px] text-[#2c3640]">
                <span className="inline-block h-2.5 w-2.5 rounded-sm border border-[#1e8e4f] bg-[#2ecc71]/50" />
                Versorgungsbereich grün: Straßen mit Leitungen und angeschlossene Gebäude
              </div>
            </Section>
          )}
          {status && economy && building.kind === "powerplant" && status.plant && (
            <Section title="Stromerzeugung">
              <Row label="Leistung möglich" value={`${Math.round(status.plant.capacity)} / ${POWER_CAPACITY[building.level]} kW`} />
              <Row label="ins Netz geliefert" value={`${Math.round(status.plant.delivered)} kW`} />
              <Need
                icon="power"
                label="Strom ganze Stadt"
                got={economy.powerSupplied}
                need={economy.powerDemand}
                unit="kW"
                from={`${Math.round(economy.powered * 100)} % des Bedarfs gedeckt`}
              />
              <div className="flex items-center gap-1.5 px-3 py-[3px] text-[10px] text-[#2c3640]">
                <span className="inline-block h-2.5 w-2.5 rounded-sm border border-[#b7950b] bg-[#f1c40f]/50" />
                Gelb: Umkreis der Trafostationen an diesem Netz
              </div>
            </Section>
          )}
          {economy && RECREATION_RADIUS[building.kind] && (
            <Section title="Erholung">
              <Row label="Umkreis (zu Fuß)" value={`${RECREATION_RADIUS[building.kind]![building.level]} m`} />
              <Row label="Einwohner im Umkreis" value={fmt(economy.recreation[building.id] ?? 0)} />
              <Row
                label={building.kind === "park" ? "Stadt mit Park in der Nähe" : "Stadt mit Spielplatz in der Nähe"}
                value={`${Math.round((building.kind === "park" ? economy.green : economy.play) * 100)} %`}
              />
              <div className="px-3 py-[3px] text-[10px] text-[#7a8794]">
                Braucht keine Straße. Mehr Freizeit, bessere Stimmung, etwas mehr Zuzug.
              </div>
            </Section>
          )}
          {economy && (building.kind === "police" || building.kind === "firestation") && (
            <Section title="Einsätze">
              <Row label="Umkreis" value={`${SERVICE_RADIUS[building.kind]![building.level]} m`} />
              <Row
                label={building.kind === "police" ? "Streifenwagen im Einsatz" : "Löschfahrzeuge im Einsatz"}
                value={`${busyVehicles(incidents, building.id)} von ${vehiclesOf(building)}`}
              />
              <Row label="Einwohner im Umkreis" value={fmt(economy.recreation[building.id] ?? 0)} />
              <Row
                label={building.kind === "police" ? "Stadt mit Polizei in der Nähe" : "Stadt mit Feuerwehr in der Nähe"}
                value={`${Math.round((building.kind === "police" ? economy.safety : economy.fireCover) * 100)} %`}
              />
              {incidents
                .filter((i) => i.station === building.id && !i.cleared)
                .map((i) => (
                  <Row key={i.id} label={INCIDENT_LABEL[i.kind]} value={i.onSite ? "abgesperrt, wird geräumt" : "Fahrzeug unterwegs"} />
                ))}
              <Row
                label={building.kind === "police" ? "Bußgelder (Stadt)" : "Feuerschutzabgabe (Stadt)"}
                value={`${fmt(economy.residents * (building.kind === "police" ? economy.safety * POLICE_FINES : economy.fireCover * FIRE_LEVY))} €/min`}
              />
              <Row label="Gebühr je Einsatz" value={`${(building.kind === "police" ? MISSION_FEE.accident : MISSION_FEE.fire).toLocaleString("de-DE")} €`} />
              <div className="px-3 py-[3px] text-[10px] text-[#7a8794]">
                {building.kind === "police"
                  ? "Fährt mit Blaulicht zu Unfällen im Straßennetz und sperrt die Stelle ab. Ohne Polizei bleibt ein Unfall lange liegen."
                  : "Rückt mit Blaulicht zu Hausbränden im Straßennetz aus. Ohne Feuerwache in Reichweite brennt das Haus ab."}
              </div>
            </Section>
          )}
          {status && economy && building.kind === "jobcenter" && (
            <Section title="Arbeitsvermittlung">
              <Row label="Umkreis" value={`${JOBCENTRE_RADIUS[building.level]} m`} />
              <Row label="Arbeitskräfte im Umkreis" value={fmt(economy.jobcentres[building.id]?.workers ?? 0)} />
              <Row label="davon mit Arbeit" value={fmt(economy.jobcentres[building.id]?.employed ?? 0)} />
              <Row label="vermittelt (weiter als 800 m)" value={fmt(economy.jobcentres[building.id]?.placed ?? 0)} />
              <Row label="Arbeitslose in der Stadt" value={fmt(economy.unemployed)} />
              <div className="px-3 py-[3px] text-[10px] text-[#7a8794]">
                Ohne Arbeitsamt arbeiten Einwohner nur bis 800 m von zu Hause. Orange: Umkreis des Amts.
              </div>
            </Section>
          )}
          {status && building.kind === "transformer" && status.transformer && (
            <Section title="Versorgung">
              <Row label="Radius" value={`${TRANSFORMER_RADIUS[building.level]} m`} />
              <Row label="Gebäude versorgt" value={String(status.transformer.buildings)} />
              <Row label="Last" value={`${Math.round(status.transformer.load)} kW`} />
              <div className="flex items-center gap-1.5 px-3 py-[3px] text-[10px] text-[#2c3640]">
                <span className="inline-block h-2.5 w-2.5 rounded-sm border border-[#b7950b] bg-[#f1c40f]/50" />
                Gelb: Umkreis mit Strom
              </div>
              {status.problem?.startsWith("Kein") && (
                <div className="px-3 py-1">
                  <Pill tone="go" onClick={() => autoCable(building.id)} title="Gerade Leitung zum nächsten Stromkabel mit Kraftwerk, über keine Gebäude">
                    Automatisch ans Stromnetz anschließen
                  </Pill>
                </div>
              )}
            </Section>
          )}
          {status && economy && building.kind === "hospital" && (
            <Section title="Versorgung">
              <Need
                icon="hospital"
                label="Betten für Einwohner"
                got={economy.hospitalCapacity}
                need={economy.residents}
                unit=""
                from={`je Krankenhaus ${HOSPITAL_CAPACITY} Einwohner`}
              />
              <Row label="Krankenwagen im Einsatz" value={`${busyAmbulances(incidents, building.id)} von ${vehiclesOf(building)}`} />
              <Row label="Rettungsdienst-Umkreis" value={`${AMBULANCE_RADIUS} m`} />
              <Row label="Krankenkasse je Transport" value={`${MISSION_FEE.ambulance.toLocaleString("de-DE")} €`} />
            </Section>
          )}
          {status && economy && building.kind === "school" && (
            <Section title="Versorgung">
              <Need
                icon="education"
                label="Schulplätze für Einwohner"
                got={economy.schoolSeats}
                need={economy.residents}
                unit=""
                from={`diese Schule: ${SCHOOL_CAPACITY * (LEVELS.school!.factor[building.level] ?? 1)} Einwohner`}
              />
            </Section>
          )}
          {building.kind === "warehouse" && <WarehouseSection building={building} />}
          {building.kind === "harbour" && <HarbourSection building={building} />}
          {building.kind === "trader" && <TraderSection building={building} />}
          {building.kind === "airport" && <AirportSection building={building} />}
          {economy && building.kind === "prison" && (
            <Section title="Justizvollzug">
              <Row label="Haftplätze (Stadt)" value={fmt(economy.prison.places)} />
              <Row label="Häftlinge" value={fmt(economy.prison.inmates)} />
              <Row label="Kostenerstattung vom Land" value={`${fmt(economy.budget.justice ?? 0)} €/min`} />
              <div className="px-3 py-[3px] text-[10px] text-[#7a8794]">
                Braucht eine Polizeiwache im Straßennetz. Mit Gefängnis bringt die Polizei 40 % mehr Bußgelder und Sicherheit.
              </div>
            </Section>
          )}
          {building.kind === "trainstation" && <StationSection building={building} />}
          {building.kind === "traindepot" && <DepotSection building={building} />}
          {building.kind === "house" && (
            <Section title="Haushalt">
              <Row label="Haushalte" value={String(householdsOf(building))} />
              <Row label="Bewohner" value={String(residentsOf(building))} />
              <Row
                label="davon berufstätig"
                value={`${Math.round(residentsOf(building) * 0.5 * (economy?.employment ?? 1))} von ${Math.round(residentsOf(building) * 0.5)}`}
                warn={(economy?.employment ?? 1) < 0.7}
              />
              <Row label="Stufe" value={`${building.level} / ${Math.min(MAX_HOUSE_LEVEL, houseCap(building))}`} />
              <Row label="Kann wachsen bis" value={HOUSE_LEVEL_NAME[Math.min(MAX_HOUSE_LEVEL, houseCap(building))]} />
            </Section>
          )}

          {status?.finance && <FinanceSection f={status.finance} workers={jobsOf(building) * (status.staffing ?? 1)} />}
          {status?.finance && <ProtectionSection building={building.id} />}
          <LaunderingSection building={building.id} />
          {status?.pays !== undefined && (
            <Section title="Abgaben an die Stadt">
              <Row label="Steuern und Gebühren" value={`${euro(status.pays)} / min`} />
            </Section>
          )}
          {(PUBLIC.includes(building.kind) || canUpgrade) && (
            <Section title="Betrieb">
              {PUBLIC.includes(building.kind) && <Row label="Unterhalt (zahlt die Stadt)" value={`${euro(upkeepOf(building))} / min`} />}
              {canUpgrade && (
                <div className="px-3 py-[3px] text-[11px] text-[#1d2a35]">
                  {upgradeText}
                  <span className={`font-mono font-semibold ${money < nextCost! ? "text-[#c0392b]" : "text-[#2c8f4e]"}`}>{euro(nextCost!)}</span>
                  {growth?.problem && <div className="mt-0.5 font-semibold text-[#c0392b]">{growth.problem}</div>}
                  {!growth?.problem && (growth?.demolish.length ?? 0) > 0 && (
                    <div className="mt-0.5 text-[#c0392b]">
                      Dafür {growth!.demolish.length === 1 ? "wird 1 Haus" : `werden ${growth!.demolish.length} Häuser`} abgerissen.
                    </div>
                  )}
                </div>
              )}
            </Section>
          )}

          {panelKind && (
            <div className="flex justify-center border-t border-black/10 px-3 py-2">
              <Pill tone="go" onClick={() => setPanel(panelKind)}>
                {PANEL_BUTTON[panelKind]}
              </Pill>
            </div>
          )}
          <div className="flex justify-center gap-3 border-t border-black/10 bg-gradient-to-b from-[#e9edf0] to-[#d3d9df] py-2">
            {canUpgrade && (
              <ActionButton icon="upgrade" label="Ausbauen" onClick={() => upgrade(building.id)} disabled={money < (nextCost ?? Infinity) || !!growth?.problem} />
            )}
            {(spec.cost > 0 || building.kind === "house" || building.kind === "ruin") && (
              <ActionButton icon="demolish" label="Abreißen" tone="danger" onClick={() => demolish(building.id)} />
            )}
            <ActionButton icon="close" label="Schließen" onClick={() => select(null)} />
          </div>
        </div>
        <div className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-[10px] border-t-[12px] border-x-transparent border-t-[#d3d9df]" />
      </div>
    </Html>
  );
}

/**
 * Where an input comes from: the suppliers that delivered, or why nothing arrived – nobody in
 * the road network, everything sold to other customers, or offered but not used because
 * another input is missing (then nothing is made and nothing is delivered).
 */
function inputSource(g: Good, status: BuildingStatus, flowsIn: Flow[], buildings: Building[], building: Building) {
  // Food factories make up for missing flour with wheat from the farms.
  const goods: Good[] = building.kind === "foodfactory" && g === "flour" ? ["flour", "wheat"] : [g];
  const delivered = partners(
    flowsIn.filter((f) => goods.includes(f.good)).map((f) => f.from),
    buildings,
    building,
  );
  if (delivered) return delivered;
  const offered = goods.flatMap((x) => status.sources?.[x]?.offered ?? []);
  if (offered.length > 0) {
    const missing = (Object.entries(status.inputs ?? {}) as [Good, { need: number; got: number }][])
      .filter(([x, io]) => x !== g && !goods.includes(x) && io.need > 0 && io.got < io.need * 0.5)
      .map(([x]) => GOOD_LABEL[x]);
    const who = partners(offered, buildings, building);
    return missing.length > 0 ? `${who} liefert – steht, es fehlt ${missing.join(", ")}` : `${who} liefert`;
  }
  const inNet = goods.flatMap((x) => status.sources?.[x]?.inNet ?? []);
  if (inNet.length > 0) return `${partners(inNet, buildings, building)} ausverkauft – alles an andere Abnehmer`;
  return "kein Lieferant im Straßennetz";
}
