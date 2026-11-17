import type { RailStats } from "./railway";
import { closestOnPath } from "./adjacency";
import {
  fuelPerMinute,
  cableGrids,
  gridOf,
  HYDRO_CANAL_DISTANCE,
  polylineDistance,
  POWER_CAPACITY,
  POWER_FEE,
  POWER_JOBS,
  POWER_LEVEL_NAME,
  POWER_UPKEEP,
  powerOf,
  TRANSFORMER_LEVEL_NAME,
  TRANSFORMER_UPKEEP,
  transformerReaches,
  UNPOWERED_WORK,
  type PowerPlantStatus,
} from "./power";
import type { Cable, Path, Road, Vec2 } from "./types";

/**
 * Buildings and the first production chain.
 *
 *   Bauernhof (farm)  ── Weizen, Milch ─┐
 *                                       ├─► Bäckerei (bakery) ── Brot ─► Einwohner (houses)
 *   Wasserwerk (water) ── Wasser ───────┘   (water also for farms and houses)
 *
 *   Holzfabrik ── Bretter ─┐
 *                          ├─► Möbelfabrik ── Möbel ─► Möbelhaus ─► Haushalte
 *   Stahlwerk ─── Stahl ───┘   (what nobody buys is exported)
 *
 *   Bauernhof Stufe 2 (Schweinezucht) ── Rinder, Schweine ─► Schlachthof ── Fleisch ─► Metzgerei
 *
 * Everything travels over the road network: a building takes part when it has road
 * access, and only buildings on the same connected network share goods and water (water
 * runs through the pipes laid with every road). Rates are per minute of game time; the
 * simulation runs one step per real second.
 */

export type BuildingKind =
  | "house"
  | "church"
  | "farm"
  | "mill"
  | "bakery"
  | "waterworks"
  | "hospital"
  | "school"
  | "steelworks"
  | "sawmill"
  | "furniture"
  | "furniturestore"
  | "slaughterhouse"
  | "butcher"
  | "restaurant"
  | "cinema"
  | "powerplant"
  | "transformer"
  | "coalmine"
  | "ironmine"
  | "uraniummine"
  | "bank"
  | "townhall"
  | "taxoffice"
  | "jobcenter"
  | "recycling"
  | "park"
  | "playground"
  | "warehouse"
  | "harbour"
  | "pool"
  | "fair"
  | "tannery"
  | "rubberfactory"
  | "shoefactory"
  | "shoeshop"
  | "sheepfarm"
  | "spinning"
  | "clothing"
  | "fashion"
  | "chickenfarm"
  | "trader"
  | "foodfactory"
  | "discounter"
  | "goldmine"
  | "goldsmelter"
  | "jeweller"
  | "exchange"
  | "airport"
  | "police"
  | "firestation"
  | "ruin"
  | "trainstation"
  | "traindepot"
  | "prison"
  | "villa"
  | "casino"
  | "pizzeria"
  | "boathouse"
  | "newspaper";

export interface Building {
  id: string;
  kind: BuildingKind;
  /** Centre of the footprint and rotation (radians); the front (−z local) faces the road. */
  x: number;
  z: number;
  rot: number;
  level: number;
  /** Look variation (colours) for houses. */
  variant: number;
}

export interface BuildingSpec {
  label: string;
  /** Icon name, see components/city/GameIcon.tsx. */
  icon: string;
  /** Footprint width (along the road) and depth in metres. */
  size: [number, number];
  /** Build cost in euros (0 = not buildable from the menu). */
  cost: number;
  /** Upgrade cost to reach level index (index 2 = cost of level 2, …). */
  upgrade?: number[];
  /** Running costs per minute. */
  upkeep: number;
  /** Water demand per minute. */
  water: number;
  /** Residents. */
  residents: number;
  /** Jobs offered (at full staffing). */
  jobs: number;
  description: string;
}

export const BUILDINGS: Record<BuildingKind, BuildingSpec> = {
  house: {
    label: "Wohnhaus",
    icon: "house",
    size: [11, 10],
    cost: 0,
    upkeep: 0,
    water: 2,
    residents: 4,
    jobs: 0,
    description: "Einwohner kaufen Brot und zahlen Steuern, wenn sie Wasser haben.",
  },
  church: {
    label: "Kirche",
    icon: "church",
    size: [12, 24],
    cost: 0,
    upkeep: 0,
    water: 1,
    residents: 0,
    jobs: 2,
    description: "Das Herz des Dorfes.",
  },
  farm: {
    label: "Bauernhof",
    icon: "farm",
    size: [56, 62],
    cost: 8000,
    upgrade: [0, 0, 14000, 30000],
    upkeep: 15,
    water: 6,
    residents: 0,
    jobs: 8,
    description: "Baut Weizen an und hält Milchkühe. Ausbau zur Schweinezucht liefert Rinder und Schweine an den Schlachthof.",
  },
  bakery: {
    label: "Bäckerei",
    icon: "bakery",
    size: [13, 12],
    cost: 12000,
    upgrade: [0, 0, 30000],
    upkeep: 20,
    water: 10,
    residents: 0,
    jobs: 10,
    description: "Backt Brot aus Mehl, Milch und Wasser und verkauft es im Dorf.",
  },
  hospital: {
    label: "Krankenhaus",
    icon: "hospital",
    size: [30, 22],
    cost: 25000,
    upkeep: 45,
    water: 12,
    residents: 0,
    jobs: 30,
    description: "Ohne Krankenhaus keine Geburten: die Stadt wächst nur noch durch Zuzug.",
  },
  waterworks: {
    label: "Wasserwerk",
    icon: "waterworks",
    size: [18, 18],
    cost: 10000,
    upgrade: [0, 0, 15000, 32000],
    upkeep: 10,
    water: 0,
    residents: 0,
    jobs: 4,
    description: "Fördert Wasser und verteilt es über die Leitungen in den Straßen. Ausbaubar.",
  },
  mill: {
    label: "Mühle",
    icon: "mill",
    size: [16, 16],
    cost: 9000,
    upgrade: [0, 0, 8000, 16000, 45000],
    upkeep: 12,
    water: 2,
    residents: 0,
    jobs: 4,
    description: "Mahlt Weizen vom Bauernhof zu Mehl für die Bäckerei.",
  },
  townhall: {
    label: "Rathaus",
    icon: "townhall",
    size: [28, 22],
    cost: 30000,
    upkeep: 30,
    water: 3,
    residents: 0,
    jobs: 14,
    description: "Machtzentrum der Stadt: Analysen, Statistiken und wie es den Bürgern geht. Nur eins pro Stadt.",
  },
  warehouse: {
    label: "Lagerhalle",
    icon: "warehouse",
    size: [30, 22],
    cost: 18000,
    upgrade: [0, 0, 25000, 60000],
    upkeep: 10,
    water: 1,
    residents: 0,
    jobs: 4,
    description:
      "Städtisches Lager: kauft den Überschuss der Fabriken im Straßennetz (Möbel, Schuhe, Gummi, Stahl …) zum Exportpreis und lagert ihn, bis Schiffe ihn teurer verkaufen. Ausbaubar.",
  },
  harbour: {
    label: "Binnenhafen",
    icon: "harbour",
    size: [40, 24],
    cost: 45000,
    upkeep: 30,
    water: 2,
    residents: 0,
    jobs: 12,
    description:
      "Kai mit Kran am schiffbaren Wasser. Hier kaufst du Schiffe; sie gehören zu diesem Hafen, holen Waren aus den Lagerhallen im Straßennetz und verkaufen sie flussabwärts.",
  },
  prison: {
    label: "Gefängnis",
    icon: "prison",
    size: [56, 48],
    cost: 60000,
    upgrade: [0, 0, 90000, 200000],
    upkeep: 45,
    water: 8,
    residents: 0,
    jobs: 24,
    description:
      "Justizvollzug im Straßennetz einer Polizeiwache: das Land zahlt der Stadt je Häftling eine Kostenerstattung, die Polizei arbeitet wirksamer (mehr Bußgelder, mehr Sicherheit). Ausbau: mehr Haftplätze.",
  },
  villa: {
    label: "Bürgermeistervilla",
    icon: "villa",
    // One plot for all levels (like the airport): the upgrades change what stands on it.
    size: [56, 48],
    cost: 150000,
    upgrade: [0, 0, 400000, 1000000],
    upkeep: 20,
    water: 0,
    residents: 0,
    jobs: 0,
    description:
      "Die Belohnung für den Bürgermeister: moderne Villa mit Pool, Garten und Garage hinter Zaun und Tor. Steht auch am Berg (wird in den Hang gebaut), braucht keine Straße. Ausbau zur Luxusvilla und zur Traumvilla mit Whirlpool, Poolhaus, Rosengarten und Luxusautos. Nur eine pro Stadt, rein zur Zierde.",
  },
  boathouse: {
    label: "Bootshaus",
    icon: "boathouse",
    // Front 12 m on land (the house), back 14 m out on the water (the jetty).
    size: [16, 26],
    cost: 250000,
    // One plot for all levels: the lounge and the yacht (moored off the jetty) change the look.
    upgrade: [0, 0, 400000, 2500000],
    upkeep: 10,
    water: 0,
    residents: 0,
    jobs: 0,
    description:
      "Das Bootshaus des Bürgermeisters am See oder Fluss: Haus am Ufer, Steg ins Wasser und ein Sportboot, das ab und zu eine Runde dreht. Ausbau zur Lounge und zum Luxus-Bootshaus mit Yacht. Bezahlt vom Privatkonto, braucht keine Straße. Nur eins pro Stadt.",
  },
  trainstation: {
    label: "Bahnhof",
    icon: "trainstation",
    size: [64, 20],
    cost: 35000,
    upgrade: [0, 0, 60000, 150000],
    upkeep: 20,
    water: 2,
    residents: 0,
    jobs: 6,
    description:
      "Mit dem Bahnsteig direkt an ein Gleis bauen. Züge aus dem Stellwerk halten hier: Fahrgäste aus dem Umkreis bringen Fahrgeld, Betriebe im Umkreis Fracht. Ausbau: Bahnhof, Hauptbahnhof.",
  },
  traindepot: {
    label: "Stellwerk",
    icon: "traindepot",
    size: [52, 24],
    cost: 45000,
    upgrade: [0, 0, 70000, 160000],
    upkeep: 25,
    water: 2,
    residents: 0,
    jobs: 10,
    description:
      "Stellwerk mit Betriebshof am Gleis: hier kaufst du Züge. Sie pendeln zwischen allen Bahnhöfen im selben Gleisnetz (mindestens zwei). Ausbau: mehr Abstellgleise.",
  },
  ruin: {
    label: "Brandruine",
    icon: "ruin",
    size: [11, 10],
    cost: 0,
    upkeep: 0,
    water: 0,
    residents: 0,
    jobs: 0,
    description: "Abgebranntes Wohnhaus: niemand wohnt hier, niemand zahlt Steuern. Abreißen, damit das Grundstück wieder bebaut wird.",
  },
  police: {
    label: "Polizeiwache",
    icon: "police",
    size: [24, 18],
    cost: 22000,
    upgrade: [0, 0, 28000, 60000],
    upkeep: 25,
    water: 2,
    residents: 0,
    jobs: 12,
    description:
      "Streifenwagen fahren mit Blaulicht zu Unfällen im Straßennetz und sperren die Stelle ab, bis sie geräumt ist. Einwohner im Umkreis (450 m) fühlen sich sicher. Ausbau: mehr Wagen, größerer Umkreis.",
  },
  firestation: {
    label: "Feuerwache",
    icon: "firestation",
    size: [28, 20],
    cost: 26000,
    upgrade: [0, 0, 32000, 70000],
    upkeep: 30,
    water: 6,
    residents: 0,
    jobs: 14,
    description:
      "Löschfahrzeuge rücken mit Blaulicht zu Hausbränden aus. Ohne Feuerwache im Straßennetz brennt ein Haus ab. Umkreis 400 m, Ausbau: mehr Fahrzeuge, größerer Umkreis.",
  },
  jobcenter: {
    label: "Arbeitsamt",
    icon: "jobcenter",
    size: [22, 16],
    cost: 20000,
    upgrade: [0, 0, 25000, 60000],
    upkeep: 20,
    water: 2,
    residents: 0,
    jobs: 10,
    description:
      "Einwohner arbeiten sonst nur in Betrieben bis 800 m von zu Hause. Das Arbeitsamt vermittelt Arbeitslose aus seinem Umkreis (300 m) an Betriebe im ganzen Straßennetz, denen Arbeitskräfte fehlen. Ausbaubar für einen größeren Umkreis.",
  },
  park: {
    label: "Stadtpark",
    icon: "park",
    size: [40, 32],
    cost: 15000,
    upgrade: [0, 0, 20000, 40000],
    upkeep: 10,
    water: 0,
    residents: 0,
    jobs: 0,
    description:
      "Wiese, Bäume und ein kleiner Teich. Braucht keine Straße – die Bürger im Umkreis (250 m) gehen hier spazieren und erholen sich. Ausbaubar mit Pavillon und Brunnen, der Umkreis wächst.",
  },
  playground: {
    label: "Spielplatz",
    icon: "playground",
    size: [22, 16],
    cost: 6000,
    upgrade: [0, 0, 8000, 16000],
    upkeep: 4,
    water: 0,
    residents: 0,
    jobs: 0,
    description:
      "Schaukel, Rutsche und Sandkasten. Braucht keine Straße – Familien im Umkreis (180 m) kommen zu Fuß. Ausbaubar zum Abenteuer- und Erlebnisspielplatz.",
  },
  taxoffice: {
    label: "Finanzamt",
    icon: "taxoffice",
    size: [24, 18],
    cost: 22000,
    upkeep: 25,
    water: 2,
    residents: 0,
    jobs: 12,
    description: "Kümmert sich um die Finanzen der Stadt: Steuersätze festlegen, Einnahmen und Ausgaben auswerten, Steuerzahler und Branchen. Nur eins pro Stadt.",
  },
  bank: {
    label: "Bank",
    icon: "bank",
    size: [20, 16],
    cost: 25000,
    upkeep: 20,
    water: 2,
    residents: 0,
    jobs: 10,
    description: "Städtische Sparkasse: Finanzen der Stadt im Überblick, Kredite aufnehmen und ablösen. Nur eine pro Stadt.",
  },
  school: {
    label: "Schule",
    icon: "school",
    size: [34, 26],
    cost: 18000,
    upgrade: [0, 0, 22000, 50000],
    upkeep: 35,
    water: 8,
    residents: 0,
    jobs: 18,
    description:
      "Bildung für 300 Einwohner. Ohne Schule keine Mehrfamilienhäuser und weniger Zuzug. Ausbaubar zur Gesamtschule (600) und zum Schulzentrum (1.050) – sie wächst in die Höhe, das Grundstück bleibt.",
  },
  steelworks: {
    label: "Stahlwerk",
    icon: "steelworks",
    size: [64, 46],
    cost: 60000,
    upkeep: 90,
    water: 40,
    residents: 0,
    jobs: 120,
    description: "Großer Arbeitgeber. Schmilzt Eisenerz aus dem Erzbergwerk zu Stahl. Braucht viel Wasser.",
  },
  powerplant: {
    label: "Kraftwerk",
    icon: "powerplant",
    size: [44, 32],
    cost: 45000,
    upgrade: [0, 0, 40000, 150000, 120000, 160000],
    upkeep: 25,
    water: 0,
    residents: 0,
    jobs: 8,
    description: "Muss am Wasser liegen. Stufe 1 Wasserkraft (Kanal am Werk), 2 Kohle, 3–5 Atom (1–3 Reaktorblöcke). Strom per Kabel zu Trafostationen.",
  },
  transformer: {
    label: "Trafostation",
    icon: "transformer",
    size: [12, 10],
    cost: 4000,
    upgrade: [0, 0, 5000, 12000],
    upkeep: 2,
    water: 0,
    residents: 0,
    jobs: 0,
    description: "Versorgt alle Gebäude im Umkreis mit Strom. Braucht keine Straße – nur ein Kabel zum Kraftwerk. Ausbau vergrößert den Radius.",
  },
  coalmine: {
    label: "Kohlebergwerk",
    icon: "coalmine",
    size: [30, 24],
    cost: 22000,
    upkeep: 20,
    water: 3,
    residents: 0,
    jobs: 15,
    description: "Nur am Berg. Fördert Kohle für das Kohlekraftwerk (Lieferung über die Straße).",
  },
  ironmine: {
    label: "Erzbergwerk",
    icon: "ironmine",
    size: [30, 24],
    cost: 22000,
    upkeep: 20,
    water: 3,
    residents: 0,
    jobs: 15,
    description: "Nur am Berg. Fördert Eisenerz für das Stahlwerk (Lieferung über die Straße).",
  },
  uraniummine: {
    label: "Uranbergwerk",
    icon: "uraniummine",
    size: [30, 24],
    cost: 45000,
    upkeep: 40,
    water: 2,
    residents: 0,
    jobs: 12,
    description: "Nur am Berg. Fördert Uran für das Kernkraftwerk (Lieferung über die Straße).",
  },
  sawmill: {
    label: "Holzfabrik",
    icon: "sawmill",
    size: [44, 34],
    cost: 28000,
    upgrade: [0, 0, 35000, 70000],
    upkeep: 40,
    water: 10,
    residents: 0,
    jobs: 50,
    description: "Sägt Holz aus den Wäldern. Bretter gehen an die Möbelfabrik, der Rest in den Export.",
  },
  recycling: {
    label: "Recyclinghof",
    icon: "recycling",
    size: [30, 24],
    cost: 18000,
    upgrade: [0, 0, 22000, 50000],
    upkeep: 15,
    water: 3,
    residents: 0,
    jobs: 6,
    description:
      "Sammelt Altholz, Metall und Wertstoffe der Haushalte im Straßennetz und bereitet sie zu Recyclingstoffen auf. Möbelfabriken ersetzen damit bis zu 40 % ihrer Bretter und ihres Stahls – günstiger als neu. Ausbaubar zum Wertstoffhof und Recyclingwerk.",
  },
  furniture: {
    label: "Möbelfabrik",
    icon: "furniture",
    size: [40, 30],
    cost: 35000,
    upgrade: [0, 0, 40000, 80000],
    upkeep: 35,
    water: 6,
    residents: 0,
    jobs: 40,
    description: "Baut Möbel aus Brettern (Holzfabrik) und Stahl (Stahlwerk). Überschuss wird exportiert.",
  },
  furniturestore: {
    label: "Möbelhaus",
    icon: "furniturestore",
    size: [26, 20],
    cost: 20000,
    upgrade: [0, 0, 18000, 40000, 90000],
    upkeep: 25,
    water: 3,
    residents: 0,
    jobs: 12,
    description: "Hier kaufen alle Haushalte ihre Einrichtung. Eingerichtete Häuser locken Zuzügler an.",
  },
  slaughterhouse: {
    label: "Schlachthof",
    icon: "slaughterhouse",
    size: [32, 24],
    cost: 22000,
    upgrade: [0, 0, 30000, 70000],
    upkeep: 25,
    water: 12,
    residents: 0,
    jobs: 8,
    description: "Verarbeitet Rinder und Schweine aus der Schweinezucht zu Fleisch für die Metzgereien. Ausbaubar zum Großschlachthof und Fleischwerk.",
  },
  butcher: {
    label: "Metzgerei",
    icon: "butcher",
    size: [13, 12],
    cost: 10000,
    upgrade: [0, 0, 12000, 28000],
    upkeep: 15,
    water: 4,
    residents: 0,
    jobs: 6,
    description: "Verkauft Fleisch und Wurst an die Einwohner. Gut versorgte Städte ziehen mehr Menschen an. Ausbaubar zur Metzgerei mit Wurstküche und zum Fleischermarkt.",
  },
  restaurant: {
    label: "Restaurant",
    icon: "restaurant",
    size: [16, 14],
    cost: 14000,
    upkeep: 18,
    water: 6,
    residents: 0,
    jobs: 5,
    description: "Essen gehen: kocht mit Fleisch und Milch. Freizeit macht Lust auf Familie – mehr Geburten.",
  },
  newspaper: {
    label: "Zeitungsverlag",
    icon: "newspaper",
    size: [30, 24],
    cost: 60000,
    upkeep: 25,
    water: 3,
    residents: 0,
    jobs: 16,
    description:
      "Redaktion und Druckerei der „Citypower Rundschau“: verkauft jeden Tag Zeitungen an die Einwohner und berichtet über alles, was in der Stadt passiert – Neubauten, Unglücke, Rekorde und auch Skandale des Bürgermeisters. Jede Ausgabe lässt sich lesen. Nur einer pro Stadt.",
  },
  pizzeria: {
    label: "Pizzeria",
    icon: "pizzeria",
    size: [14, 14],
    cost: 16000,
    upkeep: 15,
    water: 5,
    residents: 0,
    jobs: 4,
    description:
      "Pizza aus dem Holzofen: backt mit Mehl (Mühle) und Milch (Käse vom Hof) und teilt sich die Gäste mit den Restaurants – mehr Freizeit. Der Bürgermeister kann hier unauffällig Geld waschen.",
  },
  cinema: {
    label: "Kino",
    icon: "cinema",
    size: [24, 20],
    cost: 30000,
    upkeep: 30,
    water: 3,
    residents: 0,
    jobs: 5,
    description: "Filmabende für die ganze Stadt. Freizeit macht Lust auf Familie – mehr Geburten.",
  },
  tannery: {
    label: "Gerberei",
    icon: "tannery",
    size: [30, 24],
    cost: 26000,
    upkeep: 25,
    water: 14,
    residents: 0,
    jobs: 8,
    description: "Gerbt Häute vom Schlachthof zu Leder. Braucht viel Wasser und riecht – Häuser halten Abstand.",
  },
  rubberfactory: {
    label: "Gummifabrik",
    icon: "rubberfactory",
    size: [36, 28],
    cost: 32000,
    upkeep: 30,
    water: 8,
    residents: 0,
    jobs: 12,
    description: "Verarbeitet Kautschuk (Import aus Übersee) zu Gummi. Liefert an die Schuhfabrik, Rest Export.",
  },
  shoefactory: {
    label: "Schuhfabrik",
    icon: "shoefactory",
    size: [34, 24],
    cost: 30000,
    // Grows upwards on the same plot (more floors), no bigger plot.
    upgrade: [0, 0, 35000, 70000],
    upkeep: 30,
    water: 5,
    residents: 0,
    jobs: 14,
    description: "Näht Schuhe aus Leder (Gerberei) und Gummisohlen (Gummifabrik). Liefert an Schuhgeschäfte, Rest Export.",
  },
  shoeshop: {
    label: "Schuhgeschäft",
    icon: "shoeshop",
    size: [13, 12],
    cost: 10000,
    upkeep: 15,
    water: 2,
    residents: 0,
    jobs: 4,
    description: "Verkauft Schuhe an die Einwohner. Gut beschuhte Bürger sind zufriedener und locken Zuzügler an.",
  },
  sheepfarm: {
    label: "Schaffarm",
    icon: "sheepfarm",
    size: [44, 50],
    cost: 9000,
    upgrade: [0, 0, 12000, 24000, 45000],
    upkeep: 12,
    water: 5,
    residents: 0,
    jobs: 5,
    description: "Hält Schafe auf eingezäunten Weiden und schert sie. Liefert Wolle an die Spinnerei, Rest geht an den Großhandel.",
  },
  spinning: {
    label: "Spinnerei",
    icon: "spinning",
    size: [30, 24],
    cost: 24000,
    upgrade: [0, 0, 30000, 60000],
    upkeep: 25,
    water: 6,
    residents: 0,
    jobs: 10,
    description: "Wäscht, kämmt und spinnt Wolle (Schaffarm) zu Garn. Liefert an die Kleidungsfabrik, Rest Export.",
  },
  clothing: {
    label: "Kleidungsfabrik",
    icon: "clothing",
    size: [34, 24],
    cost: 30000,
    upgrade: [0, 0, 35000, 70000],
    upkeep: 30,
    water: 5,
    residents: 0,
    jobs: 16,
    description: "Webt Garn (Spinnerei) zu Stoff und näht Kleidung daraus. Liefert an Modegeschäfte, Rest Export.",
  },
  fashion: {
    label: "Modegeschäft",
    icon: "fashion",
    size: [14, 12],
    cost: 11000,
    upkeep: 15,
    water: 2,
    residents: 0,
    jobs: 4,
    description: "Verkauft Kleidung an die Einwohner. Gut gekleidete Bürger sind zufriedener und locken Zuzügler an.",
  },
  chickenfarm: {
    label: "Hühnerhof",
    icon: "chickenfarm",
    size: [30, 34],
    cost: 7000,
    upkeep: 10,
    water: 3,
    residents: 0,
    jobs: 3,
    description: "Hält Legehennen in Ställen mit Auslauf. Liefert Eier an die Lebensmittelfabrik, Rest an den Großhandel.",
  },
  trader: {
    label: "Import-Export-Kontor",
    icon: "trader",
    size: [28, 24],
    cost: 22000,
    upgrade: [0, 0, 30000, 70000],
    upkeep: 20,
    water: 1,
    residents: 0,
    jobs: 3,
    description:
      "Bestellt Waren aus dem Ausland (Kakao, Kaffee) für die Betriebe im Straßennetz. Die Schiffe des nahen Hafens bringen sie als Rückfracht mit. Muss nahe an einem Binnenhafen stehen; Ausbau vergrößert das Lager.",
  },
  foodfactory: {
    label: "Lebensmittelfabrik",
    icon: "foodfactory",
    size: [36, 26],
    cost: 32000,
    upgrade: [0, 0, 40000, 80000],
    upkeep: 30,
    water: 8,
    residents: 0,
    jobs: 18,
    description:
      "Verarbeitet Weizen und Milch (Bauernhof), Eier (Hühnerhof) sowie Kakao und Kaffee (Import-Export-Kontor) zu Lebensmitteln. Liefert an Discounter, Rest Export.",
  },
  discounter: {
    label: "Discounter",
    icon: "discounter",
    size: [30, 28],
    cost: 14000,
    upkeep: 18,
    water: 2,
    residents: 0,
    jobs: 8,
    description: "Verkauft Lebensmittel günstig an die Einwohner. Gut versorgte Bürger sind zufriedener und locken Zuzügler an.",
  },
  goldmine: {
    label: "Goldbergwerk",
    icon: "goldmine",
    size: [30, 24],
    cost: 60000,
    upkeep: 35,
    water: 6,
    residents: 0,
    jobs: 14,
    description: "Nur am Berg. Fördert Golderz für die Goldschmelze (Lieferung über die Straße), Rest Export.",
  },
  goldsmelter: {
    label: "Goldschmelze",
    icon: "goldsmelter",
    size: [26, 22],
    cost: 45000,
    upgrade: [0, 0, 60000, 140000],
    upkeep: 30,
    water: 6,
    residents: 0,
    jobs: 10,
    description:
      "Schmilzt Golderz (Goldbergwerk) zu Goldbarren. Beliefert Juweliere; übrige Barren kauft die Bank für den Tresor der Stadt an (sonst Export).",
  },
  jeweller: {
    label: "Juwelier",
    icon: "jeweller",
    size: [12, 12],
    cost: 18000,
    upgrade: [0, 0, 25000, 60000],
    upkeep: 15,
    water: 1,
    residents: 0,
    jobs: 3,
    description: "Fertigt Schmuck aus Gold (Goldschmelze) und verkauft ihn an die Einwohner. Schmuck macht die Bürger zufriedener.",
  },
  exchange: {
    label: "Börse",
    icon: "exchange",
    size: [30, 24],
    cost: 120000,
    upkeep: 40,
    water: 2,
    residents: 0,
    jobs: 12,
    description:
      "Handelsplatz der Stadt mit Kurstafel. Bestimmt den Goldkurs, zu dem die Bank Goldbarren kauft und verkauft (ohne Börse gilt ein fester Preis). Weitere Werte folgen. Nur eine pro Stadt.",
  },
  airport: {
    label: "Flugplatz",
    icon: "airport",
    // One plot for all levels: the upgrades change the look, not the size.
    size: [380, 130],
    cost: 150000,
    upgrade: [0, 0, 400000, 1200000],
    upkeep: 60,
    water: 4,
    residents: 0,
    jobs: 12,
    description:
      "Start- und Landebahn parallel zur Straße, mit Hangar. Fliegt Einwohner in den Urlaub – sie kommen gut gelaunt zurück. Ausbau (gleiches Grundstück) zum Regionalflughafen und Flughafen: Asphaltbahn, Terminal, größere Flugzeuge, mehr Passagiere und Luftfracht aus den Lagerhallen.",
  },
  pool: {
    label: "Schwimmbad",
    icon: "pool",
    size: [36, 28],
    cost: 35000,
    upkeep: 30,
    water: 20,
    residents: 0,
    jobs: 5,
    description: "Freibad mit Sportbecken, Rutsche und Sprungturm. Mehr Freizeit, mehr Zuzug und Geburten. Braucht viel Wasser.",
  },
  fair: {
    label: "Jahrmarkt",
    icon: "fair",
    size: [44, 34],
    cost: 40000,
    upkeep: 30,
    water: 4,
    residents: 0,
    jobs: 8,
    description: "Riesenrad, Karussell und Buden. Ein Magnet für die ganze Stadt – mehr Freizeit, Zuzug und Geburten.",
  },
  casino: {
    label: "Spielbank",
    icon: "casino",
    size: [34, 28],
    cost: 90000,
    upkeep: 35,
    water: 2,
    residents: 0,
    jobs: 14,
    description:
      "Roulette, Spieltische und Automaten: die Bürger verspielen ihr Geld (Gewerbesteuer für die Stadt, etwas mehr Freizeit). Der Bürgermeister kann hier selbst Roulette spielen – mit dem Privatkonto.",
  },
};

/** Buildable from the economy menu, in menu order. */
export const MENU_BUILDINGS: BuildingKind[] = [
  "farm",
  "mill",
  "bakery",
  "waterworks",
  "hospital",
  "school",
  "sawmill",
  "steelworks",
  "furniture",
  "furniturestore",
  "slaughterhouse",
  "butcher",
  "restaurant",
  "pizzeria",
  "cinema",
  "ironmine",
  "powerplant",
  "transformer",
  "coalmine",
  "uraniummine",
];

/** Goods that travel between buildings (or are sold). */
export type Good =
  | "wheat"
  | "milk"
  | "flour"
  | "bread"
  | "steel"
  | "boards"
  | "furniture"
  | "cattle"
  | "pigs"
  | "meat"
  | "meal"
  | "ticket"
  | "swim"
  | "ride"
  | "game"
  | "news"
  | "hides"
  | "leather"
  | "caoutchouc"
  | "rubber"
  | "shoes"
  | "wool"
  | "yarn"
  | "clothes"
  | "eggs"
  | "cocoa"
  | "coffee"
  | "food"
  | "pasta"
  | "sweets"
  | "rice"
  | "spices"
  | "goldore"
  | "gold"
  | "jewellery"
  | "coal"
  | "ore"
  | "uranium"
  | "recycled";
export const GOOD_LABEL: Record<Good, string> = {
  wheat: "Weizen",
  milk: "Milch",
  flour: "Mehl",
  bread: "Brot",
  steel: "Stahl",
  boards: "Bretter",
  furniture: "Möbel",
  cattle: "Rinder",
  pigs: "Schweine",
  meat: "Fleisch",
  meal: "Mahlzeiten",
  ticket: "Kinokarten",
  swim: "Badegäste",
  ride: "Fahrten",
  game: "Spiele",
  news: "Zeitungen",
  hides: "Häute",
  leather: "Leder",
  caoutchouc: "Kautschuk",
  rubber: "Gummi",
  shoes: "Schuhe",
  wool: "Wolle",
  yarn: "Garn",
  clothes: "Kleidung",
  eggs: "Eier",
  cocoa: "Kakao",
  coffee: "Kaffee",
  food: "Lebensmittel",
  pasta: "Nudeln",
  sweets: "Süßigkeiten",
  rice: "Reis",
  spices: "Gewürze",
  goldore: "Golderz",
  gold: "Goldbarren",
  jewellery: "Schmuck",
  coal: "Kohle",
  ore: "Eisenerz",
  uranium: "Uran",
  recycled: "Recyclingstoffe",
};
/** Icon name (components/city/GameIcon.tsx) per good. */
export const GOOD_ICON: Record<Good, string> = {
  wheat: "wheat",
  milk: "milk",
  flour: "flour",
  bread: "bread",
  steel: "steel",
  boards: "boards",
  furniture: "sofa",
  cattle: "cattle",
  pigs: "pig",
  meat: "meat",
  meal: "meal",
  ticket: "ticket",
  swim: "swim",
  ride: "ride",
  game: "casino",
  news: "newspaper",
  hides: "hides",
  leather: "leather",
  caoutchouc: "caoutchouc",
  rubber: "rubber",
  shoes: "shoes",
  wool: "wool",
  yarn: "yarn",
  clothes: "clothes",
  eggs: "eggs",
  cocoa: "cocoa",
  coffee: "coffee",
  food: "food",
  pasta: "pasta",
  sweets: "sweets",
  rice: "rice",
  spices: "spices",
  goldore: "goldore",
  gold: "gold",
  jewellery: "jewellery",
  coal: "coal",
  ore: "ore",
  uranium: "uranium",
  recycled: "recycled",
};
/** Colours of supply links in the world. */
export const GOOD_COLOUR: Record<Good, string> = {
  wheat: "#e3b23c",
  milk: "#8fd3ff",
  flour: "#f4f1ea",
  bread: "#c9873a",
  steel: "#9aa3aa",
  boards: "#c79a62",
  furniture: "#d9774a",
  cattle: "#8a5a3c",
  pigs: "#f2a7b5",
  meat: "#c0392b",
  meal: "#e67e22",
  ticket: "#8e44ad",
  swim: "#2fa8d8",
  ride: "#e84a8a",
  game: "#c9a227",
  news: "#5b6670",
  hides: "#b08060",
  leather: "#7a4a2a",
  caoutchouc: "#e8e0c0",
  rubber: "#3a3a3a",
  shoes: "#a0522d",
  wool: "#f3efe2",
  yarn: "#d98fb0",
  clothes: "#3f6fb5",
  eggs: "#f1e3c2",
  cocoa: "#6b3f22",
  coffee: "#3b2416",
  food: "#e5543a",
  pasta: "#f2c94c",
  sweets: "#e84a8a",
  rice: "#f3efe0",
  spices: "#d2691e",
  goldore: "#b59a52",
  gold: "#f2c230",
  jewellery: "#e0b0ff",
  coal: "#2b2b2b",
  ore: "#9c5a3c",
  uranium: "#b8e04a",
  recycled: "#3fa45b",
};

/**
 * Production per minute at full staffing and water: what a building needs and makes.
 * (Water and workers are listed separately in BUILDINGS.)
 */
export const RECIPES: Partial<Record<BuildingKind, { inputs: Partial<Record<Good, number>>; outputs: Partial<Record<Good, number>> }>> = {
  farm: { inputs: {}, outputs: { wheat: 12, milk: 7 } },
  slaughterhouse: { inputs: { cattle: 2, pigs: 6 }, outputs: { meat: 12 } },
  butcher: { inputs: { meat: 10 }, outputs: {} },
  restaurant: { inputs: { meat: 3, milk: 2 }, outputs: { meal: 12 } },
  pizzeria: { inputs: { flour: 3, milk: 1.8 }, outputs: { meal: 12 } },
  cinema: { inputs: {}, outputs: { ticket: 15 } },
  pool: { inputs: {}, outputs: { swim: 16 } },
  tannery: { inputs: { hides: 6 }, outputs: { leather: 6 } },
  rubberfactory: { inputs: { caoutchouc: 8 }, outputs: { rubber: 8 } },
  shoefactory: { inputs: { leather: 4, rubber: 2 }, outputs: { shoes: 10 } },
  shoeshop: { inputs: { shoes: 10 }, outputs: {} },
  sheepfarm: { inputs: {}, outputs: { wool: 10 } },
  spinning: { inputs: { wool: 10 }, outputs: { yarn: 10 } },
  clothing: { inputs: { yarn: 6 }, outputs: { clothes: 8 } },
  fashion: { inputs: { clothes: 10 }, outputs: {} },
  chickenfarm: { inputs: {}, outputs: { eggs: 8 } },
  trader: { inputs: {}, outputs: { cocoa: 0, coffee: 0 } },
  foodfactory: { inputs: { flour: 5.4, milk: 5.8, eggs: 4.8, cocoa: 2, coffee: 2 }, outputs: { pasta: 6, sweets: 4, food: 10 } },
  discounter: { inputs: { food: 10, pasta: 6, sweets: 4, rice: 4, spices: 2 }, outputs: {} },
  fair: { inputs: {}, outputs: { ride: 24 } },
  casino: { inputs: {}, outputs: { game: 20 } },
  newspaper: { inputs: {}, outputs: { news: 40 } },
  mill: { inputs: { wheat: 16 }, outputs: { flour: 16 } },
  bakery: { inputs: { flour: 14, milk: 7 }, outputs: { bread: 14 } },
  steelworks: { inputs: { ore: 10 }, outputs: { steel: 10 } },
  coalmine: { inputs: {}, outputs: { coal: 14 } },
  ironmine: { inputs: {}, outputs: { ore: 12 } },
  goldmine: { inputs: {}, outputs: { goldore: 3 } },
  goldsmelter: { inputs: { goldore: 2 }, outputs: { gold: 1 } },
  jeweller: { inputs: { gold: 0.8 }, outputs: { jewellery: 4 } },
  uraniummine: { inputs: {}, outputs: { uranium: 2.5 } },
  sawmill: { inputs: {}, outputs: { boards: 12 } },
  furniture: { inputs: { boards: 9, steel: 3, recycled: 4.8 }, outputs: { furniture: 6 } },
  recycling: { inputs: {}, outputs: { recycled: 8 } },
  furniturestore: { inputs: { furniture: 10 }, outputs: {} },
};

/** One delivery relation of the current minute. */
export interface Flow {
  from: string;
  to: string;
  good: Good;
  amount: number;
}

/** Industry: houses keep this distance (noise, smoke). */
export const INDUSTRY: BuildingKind[] = [
  "steelworks",
  "sawmill",
  "furniture",
  "slaughterhouse",
  "powerplant",
  "coalmine",
  "ironmine",
  "uraniummine",
  "tannery",
  "rubberfactory",
  "shoefactory",
  "spinning",
  "clothing",
  "foodfactory",
  "recycling",
  "goldmine",
  "goldsmelter",
  "harbour",
  "airport",
];
/** Mines: only on a mountain. */
export const MINES: BuildingKind[] = ["coalmine", "ironmine", "uraniummine", "goldmine"];
/** Iron ore per tonne of steel. */
const ORE_PER_STEEL = 1;
export const INDUSTRY_BUFFER = 55;

/** Tax rate range and default. */
export const TAX_MIN = 0.05;
export const TAX_MAX = 0.2;
export const TAX_DEFAULT = 0.1;

/**
 * What houses need to grow, in one place (growth.ts, the town's growth limit and the house
 * card read it). Lowered on request: bread and meat 10 points lower, the rest less strict.
 *  - level 2: bread, employment above `employmentSmall`
 *  - level 3+: also a hospital, `residents`, school places, employment, furniture, power at the house
 *  - level 4+: also `furnishedTall`
 * Meat is not a condition, only a hint in the house card (`meat`).
 */
export const UPGRADE_NEEDS = {
  bread: 0.7,
  meat: 0.4,
  employmentSmall: 0.5,
  employment: 0.65,
  education: 0.65,
  furnished: 0.45,
  furnishedTall: 0.6,
  power: 0.75,
  residents: 150,
};

/** Residential levels: 1 Einfamilienhaus, 2 Doppelhaus, 3 Mehrfamilienhaus. */
export const HOUSE_LEVEL_NAME = ["", "Einfamilienhaus", "Doppelhaus", "Mehrfamilienhaus", "Wohnblock", "Hochhaus", "Turmhochhaus", "Wolkenkratzer"];
export const HOUSE_RESIDENTS = [0, 4, 10, 28, 60, 110, 200, 360];
/** Households per house level (a family / flat each). */
export const HOUSE_HOUSEHOLDS = [0, 1, 2, 6, 14, 26, 48, 86];
export const householdsOf = (b: Building) => (b.kind === "house" ? HOUSE_HOUSEHOLDS[b.level] : 0);
export const MAX_HOUSE_LEVEL = 7;
/**
 * How far a house can grow, fixed per house (from its id, so it never changes): some stay
 * small, some become apartment blocks, some high-rises and a few skyscrapers. Shares: 15 % up to
 * Doppelhaus, 30 % Mehrfamilienhaus, 30 % Wohnblock, 12 % Hochhaus, 8 % Turmhochhaus, 5 % Wolkenkratzer
 * (the last three split the former 25 % Hochhaus, so no house can grow less than before).
 */
export function houseCap(b: { id: string }): number {
  let h = 2166136261;
  for (let i = 0; i < b.id.length; i++) h = Math.imul(h ^ b.id.charCodeAt(i), 16777619);
  const r = ((h >>> 0) % 1000) / 1000;
  return r < 0.15 ? 2 : r < 0.45 ? 3 : r < 0.75 ? 4 : r < 0.87 ? 5 : r < 0.95 ? 6 : 7;
}

/** Display name of a building at its level (waterworks, farms and houses change name). */
export function levelName(b: Building): string {
  if (b.kind === "waterworks") return WATER_LEVEL_NAME[b.level];
  if (b.kind === "house") return HOUSE_LEVEL_NAME[b.level];
  if (b.kind === "farm") return FARM_LEVEL_NAME[b.level] ?? BUILDINGS.farm.label;
  if (b.kind === "mill") return MILL_LEVEL_NAME[b.level] ?? BUILDINGS.mill.label;
  if (LEVELS[b.kind]) return LEVELS[b.kind]!.name[b.level] ?? BUILDINGS[b.kind].label;
  if (b.kind === "furniturestore") return STORE_LEVEL_NAME[b.level] ?? BUILDINGS.furniturestore.label;
  if (b.kind === "powerplant") return POWER_LEVEL_NAME[b.level] ?? BUILDINGS.powerplant.label;
  if (b.kind === "transformer") return TRANSFORMER_LEVEL_NAME[b.level] ?? BUILDINGS.transformer.label;
  return BUILDINGS[b.kind].label;
}

/** Residents of a building (houses depend on their level). */
export const residentsOf = (b: Building) => (b.kind === "house" ? HOUSE_RESIDENTS[b.level] : BUILDINGS[b.kind].residents);
/** Water demand per minute of a building. */
export const waterOf = (b: Building) => (b.kind === "house" ? 0.5 * HOUSE_RESIDENTS[b.level] : BUILDINGS[b.kind].water);

/** Water capacity per minute by waterworks level (1: Brunnen, 2: Wasserwerk, 3: Wasserturm). */
export const WATER_CAPACITY = [0, 110, 260, 600];
export const WATER_LEVEL_NAME = ["", "Brunnen", "Wasserwerk", "Wasserwerk mit Wasserturm"];
export const MAX_WATER_LEVEL = 3;
/** Upkeep grows with the waterworks level. */
const WATER_UPKEEP = [0, 10, 25, 55];

/** Farm output per minute at full water supply. */
const FARM_WHEAT = 12;
const FARM_MILK = 7;
/** Pig farming (farm level 2): animals per minute for the slaughterhouse. */
const FARM_CATTLE = 2.5;
const FARM_PIGS = 3;
export const FARM_LEVEL_NAME = ["", "Bauernhof", "Bauernhof mit Schweinezucht", "Gutshof"];
/** Output factor per farm level: the estate (level 3) farms more land with machines. */
export const FARM_OUTPUT = [0, 1, 1, 1.6];
/** Slaughterhouse: meat per minute at most; meat per animal. */
const SLAUGHTER_CAPACITY = 12;
const MEAT_PER_CATTLE = 3;
const MEAT_PER_PIG = 1;
/** Hides per slaughtered animal (by-product of the slaughterhouse, for the tannery). */
const HIDES_PER_CATTLE = 1;
const HIDES_PER_PIG = 0.5;
/** Leather chain: capacities per minute and what one unit takes. */
const TANNERY_CAPACITY = 6;
const RUBBER_CAPACITY = 8;
const SHOE_CAPACITY = 10;
const SHOE_LEATHER = 0.4;
const SHOE_RUBBER = 0.2;
const SHOESHOP_CAPACITY = 10;
/** Pairs of shoes every resident buys per minute. */
const SHOES_PER_RESIDENT = 0.02;
/** Textile chain: capacities per minute (× level factor) and what one unit takes. */
const WOOL_CAPACITY = 10;
const SPINNING_CAPACITY = 10;
const YARN_WOOL = 1;
const CLOTHES_CAPACITY = 8;
const CLOTHES_YARN = 0.75;
const FASHION_CAPACITY = 10;
/** Pieces of clothing every resident buys per minute. */
const CLOTHES_PER_RESIDENT = 0.02;
/** Food chain: eggs per hen house, food per factory (× level) and what one unit takes, shop and demand. */
const EGGS_CAPACITY = 8;
/** Food factory lines (per minute at level 1) and what one unit needs; each runs on its own. */
const FOOD_LINES: { good: Good; capacity: number; inputs: Partial<Record<Good, number>> }[] = [
  { good: "pasta", capacity: 6, inputs: { flour: 0.7, eggs: 0.3 } },
  { good: "sweets", capacity: 4, inputs: { flour: 0.3, cocoa: 0.5, milk: 0.2 } },
  { good: "food", capacity: 10, inputs: { milk: 0.5, eggs: 0.3, coffee: 0.2 } },
];
/** Gold: ore per bar at the smelter, bars per minute (× level), jewellery per shop and gold per piece. */
const GOLD_ORE_PER_BAR = 2;
const SMELTER_CAPACITY = 1;
export const JEWELLER_CAPACITY = 4;
const JEWELLERY_GOLD = 0.2;
/** Pieces of jewellery every resident buys per minute. */
const JEWELLERY_PER_RESIDENT = 0.0015;
/** What the residents buy at the discounter, per resident and minute. */
const GROCERY_DEMAND: Partial<Record<Good, number>> = { food: 0.015, pasta: 0.009, sweets: 0.006 };
const GROCERIES = Object.keys(GROCERY_DEMAND) as Good[];
const DISCOUNTER_CAPACITY = 20;
const FOOD_PER_RESIDENT = 0.03;
/**
 * Imported goods the discounter sells on top (straight from the import-export company, no
 * factory): rice and spices, per resident and minute. They count for "Reis & Gewürze", not for "fed".
 */
const IMPORTED_GROCERY_DEMAND: Partial<Record<Good, number>> = { rice: 0.006, spices: 0.003 };
const IMPORTED_GROCERIES = Object.keys(IMPORTED_GROCERY_DEMAND) as Good[];
/** Everything on the discounter's shelves. */
const SHELF = [...GROCERIES, ...IMPORTED_GROCERIES];
const SHELF_DEMAND: Partial<Record<Good, number>> = { ...GROCERY_DEMAND, ...IMPORTED_GROCERY_DEMAND };

/* ---------- imports: the import-export company orders, the harbour's ships bring it ---------- */

/** Goods the import-export company can order abroad (add more here), with their origin. */
export const IMPORT_GOODS: { good: Good; origin: string }[] = [
  { good: "cocoa", origin: "Westafrika" },
  { good: "coffee", origin: "Brasilien" },
  { good: "rice", origin: "Thailand" },
  { good: "spices", origin: "Indien" },
];
/** The company buys abroad at this share of the wholesale price (its margin is the rest). */
export const IMPORT_COST = 0.5;
/** Units its store holds at level 1 (× level factor). */
export const TRADER_CAPACITY = 300;
export const traderCapacity = (b: Building) => TRADER_CAPACITY * levelFactor(b);
/** It must stand at most this far from a harbour (centre to centre, metres). */
export const TRADER_HARBOUR_DISTANCE = 160;
/** Open orders of one company: units per good that still fit into its store. */
export interface ImportOrder {
  trader: string;
  goods: Partial<Record<Good, number>>;
}
/** Butcher: meat sold per minute at most; every resident eats this much. */
const BUTCHER_CAPACITY = 10;
const MEAT_PER_RESIDENT = 0.03;
/** Leisure: restaurant meals and cinema tickets per resident and minute, capacities, inputs. */
const MEALS_PER_RESIDENT = 0.03;
const RESTAURANT_CAPACITY = 12;
const MEAL_MEAT = 0.25;
const MEAL_MILK = 0.15;
/** A pizza: flour for the dough, milk for the cheese. */
const PIZZA_FLOUR = 0.25;
/** Attractions: cinema, pool and fair each sell visits to the residents of their network. */
const ATTRACTIONS: Partial<Record<BuildingKind, { good: Good; perResident: number; capacity: number }>> = {
  cinema: { good: "ticket", perResident: 0.025, capacity: 15 },
  pool: { good: "swim", perResident: 0.03, capacity: 16 },
  fair: { good: "ride", perResident: 0.03, capacity: 24 },
  casino: { good: "game", perResident: 0.015, capacity: 20 },
  newspaper: { good: "news", perResident: 0.02, capacity: 40 },
};
/** Births are multiplied by up to this much with a full leisure offer. */
const LEISURE_BIRTH_BONUS = 1.5;
/** Mill: flour per minute at most (one wheat gives one flour). */
const MILL_CAPACITY = 16;
export const MILL_LEVEL_NAME = ["", "Mühle", "Mühle mit Silo", "Großmühle", "Mühlenfabrik"];
/** Flour output factor per mill level (silos store more wheat, the factory grinds on rollers). */
export const MILL_FACTOR = [0, 1, 1.6, 2.4, 4];
/** Footprints per level for buildings that grow (the plot extends away from the road). */
const LEVEL_SIZE: Partial<Record<BuildingKind, [number, number][]>> = {
  bakery: [
    [13, 12],
    [13, 12],
    [30, 22],
  ],
  sawmill: [
    [44, 34],
    [44, 34],
    [50, 40],
    [60, 46],
  ],
  furniture: [
    [40, 30],
    [40, 30],
    [46, 36],
    [56, 42],
  ],
  furniturestore: [
    [26, 20],
    [26, 20],
    [26, 20],
    [26, 20],
    [64, 46],
  ],
  mill: [
    [16, 16],
    [16, 16],
    [24, 18],
    [30, 20],
    [42, 30],
  ],
  warehouse: [
    [30, 22],
    [30, 22],
    [40, 28],
    [56, 36],
  ],
  sheepfarm: [
    [44, 50],
    [44, 50],
    [44, 58],
    [54, 66],
    [64, 76],
  ],
  // Grows only to the back (neighbours along the street stay where they are).
  recycling: [
    [30, 24],
    [30, 24],
    [30, 32],
    [30, 40],
  ],
  // Grows only to the back (neighbours along the street stay where they are).
  spinning: [
    [30, 24],
    [30, 24],
    [30, 34],
    [30, 40],
  ],
  // Grows only to the back (neighbours along the street stay where they are).
  clothing: [
    [34, 24],
    [34, 24],
    [34, 34],
    [34, 42],
  ],
  foodfactory: [
    [36, 26],
    [36, 26],
    [44, 32],
    [54, 40],
  ],
  // Grows only to the back (neighbours along the street stay where they are).
  slaughterhouse: [
    [32, 24],
    [32, 24],
    [32, 32],
    [32, 40],
  ],
  // Grows only to the back, like the slaughterhouse.
  butcher: [
    [13, 12],
    [13, 12],
    [13, 20],
    [13, 28],
  ],
  // Grows only to the back, like the butcher.
  jeweller: [
    [12, 12],
    [12, 12],
    [12, 18],
    [12, 26],
  ],
  // Grows only to the back.
  goldsmelter: [
    [26, 22],
    [26, 22],
    [26, 30],
    [26, 38],
  ],
  trader: [
    [28, 24],
    [28, 24],
    [36, 30],
    [46, 36],
  ],
};
/** Footprint (width along the road, depth) of a building at its level. */
export const sizeOf = (b: { kind: BuildingKind; level?: number }): [number, number] =>
  LEVEL_SIZE[b.kind]?.[b.level ?? 1] ?? BUILDINGS[b.kind].size;
/** Bakery: bread per minute at most, and what one bread needs. */
const BAKERY_CAPACITY = 14;
const BREAD_FLOUR = 1;
const BREAD_MILK = 0.5;
/** Furniture factory: pieces per minute at most, and what one piece needs. */
const FURNITURE_CAPACITY = 6;
const FURNITURE_BOARDS = 1.5;
const FURNITURE_STEEL = 0.5;
/** Recycling yard: collected per resident of its road network and minute, capacity at level 1. */
const RECYCLE_PER_RESIDENT = 0.004;
const RECYCLE_CAPACITY = 8;
/** Share of a furniture factory's boards and steel that recycled material may replace. */
const RECYCLED_SHARE = 0.4;
/** Furniture store: pieces sold per minute at most; every household buys this many. */
const STORE_CAPACITY = 10;
export const STORE_LEVEL_NAME = ["", "Möbelhaus", "Einrichtungshaus", "Wohnwelt", "Möbelzentrum"];
/** Sales capacity factor per furniture store level (more floor space, more customers). */
export const STORE_LEVEL_FACTOR = [0, 1, 2, 3.5, 7];
/**
 * Generic production levels: name, output factor and extra jobs / upkeep per level.
 * (Farm, mill, store and power keep their own tables above.)
 */
export const LEVELS: Partial<Record<BuildingKind, { name: string[]; factor: number[]; jobs: number[]; upkeep: number[] }>> = {
  bakery: { name: ["", "Bäckerei", "Backfabrik"], factor: [0, 1, 4], jobs: [0, 0, 18], upkeep: [0, 0, 40] },
  sawmill: { name: ["", "Holzfabrik", "Großsägewerk", "Holzwerk"], factor: [0, 1, 1.8, 3], jobs: [0, 0, 20, 45], upkeep: [0, 0, 30, 70] },
  furniture: { name: ["", "Möbelfabrik", "Große Möbelfabrik", "Möbelwerk"], factor: [0, 1, 1.8, 3], jobs: [0, 0, 18, 40], upkeep: [0, 0, 25, 60] },
  sheepfarm: { name: ["", "Schaffarm", "Schaffarm mit Scherhalle", "Große Schaffarm", "Wollgut"], factor: [0, 1, 1.6, 2.4, 3.5], jobs: [0, 0, 3, 8, 16], upkeep: [0, 0, 8, 18, 35] },
  spinning: { name: ["", "Spinnerei", "Große Spinnerei", "Spinnereiwerk"], factor: [0, 1, 1.8, 3], jobs: [0, 0, 10, 24], upkeep: [0, 0, 20, 45] },
  shoefactory: { name: ["", "Schuhfabrik", "Große Schuhfabrik", "Schuhwerk"], factor: [0, 1, 1.8, 3], jobs: [0, 0, 12, 28], upkeep: [0, 0, 25, 55] },
  clothing: { name: ["", "Kleidungsfabrik", "Große Kleidungsfabrik", "Textilwerk"], factor: [0, 1, 1.8, 3], jobs: [0, 0, 14, 32], upkeep: [0, 0, 25, 55] },
  foodfactory: { name: ["", "Lebensmittelfabrik", "Große Lebensmittelfabrik", "Lebensmittelwerk"], factor: [0, 1, 1.8, 3], jobs: [0, 0, 16, 36], upkeep: [0, 0, 25, 55] },
  slaughterhouse: { name: ["", "Schlachthof", "Großschlachthof", "Fleischwerk"], factor: [0, 1, 2, 3.5], jobs: [0, 0, 8, 20], upkeep: [0, 0, 20, 45] },
  butcher: { name: ["", "Metzgerei", "Metzgerei mit Wurstküche", "Fleischermarkt"], factor: [0, 1, 2, 3.5], jobs: [0, 0, 5, 12], upkeep: [0, 0, 10, 24] },
  trader: { name: ["", "Import-Export-Kontor", "Handelshaus", "Handelszentrum"], factor: [0, 1, 2.5, 6], jobs: [0, 0, 3, 8], upkeep: [0, 0, 10, 25] },
  airport: { name: ["", "Flugplatz", "Regionalflughafen", "Flughafen"], factor: [0, 1, 3, 8], jobs: [0, 0, 30, 90], upkeep: [0, 0, 150, 420] },
  park: { name: ["", "Stadtpark", "Stadtpark mit Pavillon", "Großer Stadtpark"], factor: [0, 1, 1, 1], jobs: [0, 0, 0, 0], upkeep: [0, 0, 8, 18] },
  playground: { name: ["", "Spielplatz", "Abenteuerspielplatz", "Erlebnisspielplatz"], factor: [0, 1, 1, 1], jobs: [0, 0, 0, 0], upkeep: [0, 0, 4, 9] },
  school: { name: ["", "Schule", "Gesamtschule", "Schulzentrum"], factor: [0, 1, 2, 3.5], jobs: [0, 0, 14, 30], upkeep: [0, 0, 25, 55] },
  jobcenter: { name: ["", "Arbeitsamt", "Jobcenter", "Agentur für Arbeit"], factor: [0, 1, 1, 1], jobs: [0, 0, 6, 14], upkeep: [0, 0, 15, 35] },
  police: { name: ["", "Polizeiwache", "Polizeirevier", "Polizeipräsidium"], factor: [0, 1, 2, 3], jobs: [0, 0, 10, 24], upkeep: [0, 0, 20, 45] },
  firestation: { name: ["", "Feuerwache", "Hauptfeuerwache", "Berufsfeuerwehr"], factor: [0, 1, 2, 3], jobs: [0, 0, 12, 28], upkeep: [0, 0, 25, 55] },
  prison: { name: ["", "Gefängnis", "Justizvollzugsanstalt", "Hochsicherheitsgefängnis"], factor: [0, 1, 2.5, 6], jobs: [0, 0, 20, 50], upkeep: [0, 0, 40, 100] },
  villa: { name: ["", "Bürgermeistervilla", "Luxusvilla", "Traumvilla"], factor: [0, 1, 1, 1], jobs: [0, 0, 0, 0], upkeep: [0, 0, 45, 90] },
  boathouse: { name: ["", "Bootshaus", "Bootshaus mit Lounge", "Luxus-Bootshaus"], factor: [0, 1, 1, 1], jobs: [0, 0, 0, 0], upkeep: [0, 0, 20, 60] },
  trainstation: { name: ["", "Haltepunkt", "Bahnhof", "Hauptbahnhof"], factor: [0, 1, 2.5, 6], jobs: [0, 0, 8, 24], upkeep: [0, 0, 25, 70] },
  traindepot: { name: ["", "Stellwerk", "Betriebshof", "Bahnbetriebswerk"], factor: [0, 2, 4, 8], jobs: [0, 0, 8, 20], upkeep: [0, 0, 20, 50] },
  recycling: { name: ["", "Recyclinghof", "Wertstoffhof", "Recyclingwerk"], factor: [0, 1, 2, 3.5], jobs: [0, 0, 6, 14], upkeep: [0, 0, 15, 35] },
  jeweller: { name: ["", "Juwelier", "Juwelier mit Goldschmiede", "Schmuckhaus"], factor: [0, 1, 2, 3.5], jobs: [0, 0, 3, 8], upkeep: [0, 0, 10, 25] },
  goldsmelter: { name: ["", "Goldschmelze", "Scheideanstalt", "Goldraffinerie"], factor: [0, 1, 2, 3.5], jobs: [0, 0, 8, 20], upkeep: [0, 0, 25, 60] },
  warehouse: { name: ["", "Lagerhalle", "Großlager", "Logistikzentrum"], factor: [0, 1, 3, 7.5], jobs: [0, 0, 6, 16], upkeep: [0, 0, 15, 40] },
};
/** Units a warehouse holds at level 1 (× level factor). */
export const WAREHOUSE_CAPACITY = 400;
export const warehouseCapacity = (b: Building) => WAREHOUSE_CAPACITY * levelFactor(b);
/** Staffed first when workers are short: the basic supply of the town. */
/** Reach of parks and playgrounds per level (m): residents within walk there, no street needed. */
export const RECREATION_RADIUS: Partial<Record<BuildingKind, number[]>> = {
  park: [0, 250, 350, 450],
  playground: [0, 180, 250, 320],
};
/** Buildings that work without a street (fed by cable, or reached on foot). */
export const ROADLESS_KINDS: BuildingKind[] = ["transformer", "park", "playground", "trainstation", "traindepot", "villa", "boathouse"];

/* ---------- emergency services: police and fire stations ---------- */

/** Reach of a police / fire station per level (m): incidents there are served, residents feel safe. */
export const SERVICE_RADIUS: Partial<Record<BuildingKind, number[]>> = {
  police: [0, 450, 650, 900],
  firestation: [0, 400, 600, 800],
};
/** Vehicles a station sends out at once, per level (= LEVELS factor); hospitals keep two ambulances. */
export const vehiclesOf = (b: { kind: BuildingKind; level: number }) => (b.kind === "hospital" ? AMBULANCES : (LEVELS[b.kind]?.factor[b.level] ?? 1));
/** Ambulances per hospital and how far they go out (m, same road network). */
export const AMBULANCES = 2;
export const AMBULANCE_RADIUS = 1200;
/**
 * Money for the town: running income per covered resident and minute (police: fines,
 * fire brigade: fire-protection levy of the insurers), and a fee per finished mission
 * (towing and police report, fire brigade call-out, ambulance transport billed to the health insurance).
 */
export const POLICE_FINES = 0.006;
export const FIRE_LEVY = 0.004;
export const MISSION_FEE = { accident: 900, fire: 2500, ambulance: 1200 } as const;
/** Prison places at level factor 1, inmates per resident (with police), and what the state pays per inmate and minute. */
export const PRISON_PLACES = 100;
export const INMATES_PER_RESIDENT = 0.004;
export const PRISON_REFUND = 1.4;
/** With a prison, police fines and the safety mood factor rise by this share. */
export const PRISON_POLICE_BONUS = 0.4;

/** How far residents commute to work without a job centre (m). */
export const COMMUTE_DISTANCE = 800;
/** Area of a job centre per level (m): unemployed living there are placed anywhere in the network. */
export const JOBCENTRE_RADIUS = [0, 300, 450, 600];

export interface JobCentreStatus {
  /** Workers living in the area, those with a job, and those placed beyond commuting distance. */
  workers: number;
  employed: number;
  placed: number;
}

/**
 * Who works where. Every home offers its workers to the workplaces it can reach (same road
 * network, within COMMUTE_DISTANCE, or the whole network if a job centre covers the home).
 * In a few rounds each home splits its free workers by the open jobs it reaches (the basic
 * supply weighted ESSENTIAL_WEIGHT); a workplace asked for more than it has open accepts its
 * share. Returns workers per workplace, employed and unemployed totals and job centre figures.
 */
function labourMarket(buildings: Building[], netOf: Map<string, number | null>) {
  const places = buildings.filter((b) => jobsOf(b) > 0 && netOf.get(b.id) !== null && netOf.get(b.id) !== undefined);
  const centres = buildings.filter((b) => b.kind === "jobcenter" && netOf.get(b.id) !== null && netOf.get(b.id) !== undefined);
  const filled = new Map<string, number>();
  const centreStatus: Record<string, JobCentreStatus> = {};
  for (const c of centres) centreStatus[c.id] = { workers: 0, employed: 0, placed: 0 };
  // Workplaces in a coarse grid for the commuting search; per network for placed workers.
  const cell = (v: number) => Math.floor(v / COMMUTE_DISTANCE);
  const grid = new Map<string, number[]>();
  const byNet = new Map<number, number[]>();
  places.forEach((p, i) => {
    const k = `${cell(p.x)},${cell(p.z)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
    const n = netOf.get(p.id)!;
    (byNet.get(n) ?? byNet.set(n, []).get(n)!).push(i);
  });
  const open = places.map((p) => jobsOf(p));
  const weight = places.map((p) => (ESSENTIAL.has(p.kind) ? ESSENTIAL_WEIGHT : 1));
  // Reachable workplaces per home stay valid while the workplaces (and their networks) do.
  const signature = places.map((p) => `${p.id}@${p.x},${p.z}@${netOf.get(p.id)}`).join("|");
  if (reachCache.signature !== signature) reachCache = { signature, byHome: new Map() };
  /**
   * A group of workers with the same reachable workplaces: a single home commuting nearby,
   * or all homes in a job centre's area pooled (they all reach the whole network, so they
   * split identically – one entry instead of hundreds).
   */
  interface Pool {
    left: number;
    start: number;
    reach: number[];
    /** Job centre pools: workplaces beyond commuting distance of the centre count as placed. */
    centre: Building | null;
    placed: number;
  }
  const pools: Pool[] = [];
  const centrePool = new Map<string, Pool>();
  for (const b of buildings) {
    const w = residentsOf(b) * WORKER_SHARE;
    const net = netOf.get(b.id);
    if (w <= 0 || net === null || net === undefined) continue;
    const centre = centres.find((c) => netOf.get(c.id) === net && Math.hypot(c.x - b.x, c.z - b.z) <= JOBCENTRE_RADIUS[c.level]);
    if (centre) {
      let pool = centrePool.get(centre.id);
      if (!pool) {
        pool = { left: 0, start: 0, reach: byNet.get(net) ?? [], centre, placed: 0 };
        centrePool.set(centre.id, pool);
        pools.push(pool);
      }
      pool.left += w;
      pool.start += w;
      continue;
    }
    const key = `${b.x},${b.z},${net}`;
    let reach = reachCache.byHome.get(key);
    if (!reach) {
      reach = [];
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          for (const k of grid.get(`${cell(b.x) + i},${cell(b.z) + j}`) ?? []) {
            const p = places[k];
            if (netOf.get(p.id) === net && Math.hypot(p.x - b.x, p.z - b.z) <= COMMUTE_DISTANCE) reach.push(k);
          }
      reachCache.byHome.set(key, reach);
    }
    pools.push({ left: w, start: w, reach, centre: null, placed: 0 });
  }
  const far = (pool: Pool, k: number) => !!pool.centre && Math.hypot(places[k].x - pool.centre.x, places[k].z - pool.centre.z) > COMMUTE_DISTANCE;
  const asked = new Float64Array(places.length);
  const got = new Float64Array(places.length);
  const share = new Float64Array(pools.length);
  for (let round = 0; round < LABOUR_ROUNDS; round++) {
    asked.fill(0);
    got.fill(0);
    for (let pi = 0; pi < pools.length; pi++) {
      const pool = pools[pi];
      let sum = 0;
      if (pool.left > 1e-6) for (const k of pool.reach) sum += open[k] * weight[k];
      share[pi] = sum;
      if (sum > 0) for (const k of pool.reach) asked[k] += (pool.left * open[k] * weight[k]) / sum;
    }
    for (let pi = 0; pi < pools.length; pi++) {
      const pool = pools[pi];
      if (share[pi] <= 0) continue;
      let used = 0;
      for (const k of pool.reach) {
        if (asked[k] <= 0) continue;
        const n = ((pool.left * open[k] * weight[k]) / share[pi]) * Math.min(1, open[k] / asked[k]);
        got[k] += n;
        used += n;
        if (pool.centre && far(pool, k)) pool.placed += n;
      }
      pool.left -= used;
    }
    for (let k = 0; k < places.length; k++) open[k] = Math.max(0, open[k] - got[k]);
  }
  let employed = 0;
  places.forEach((p, k) => {
    const n = jobsOf(p) - open[k];
    filled.set(p.id, n);
    employed += n;
  });
  let total = 0;
  for (const pool of pools) {
    total += pool.start;
    if (!pool.centre) continue;
    centreStatus[pool.centre.id] = { workers: pool.start, employed: pool.start - pool.left, placed: pool.placed };
  }
  return { filled, employed, unemployed: Math.max(0, total - employed), centres: centreStatus };
}
const LABOUR_ROUNDS = 4;
/** Commuting reach per home position (workplace indices), see `labourMarket`. */
let reachCache: { signature: string; byHome: Map<string, number[]> } = { signature: "", byHome: new Map() };

/** How much more of the scarce workers the basic supply gets per job than other businesses. */
const ESSENTIAL_WEIGHT = 2;
const ESSENTIAL = new Set<BuildingKind>(["waterworks", "powerplant", "coalmine", "uraniummine", "hospital", "school", "farm", "mill", "bakery"]);
/** Goods that keep and go to the warehouses (no fresh food, no animals). */
export const STORABLE: Good[] = ["boards", "steel", "furniture", "leather", "rubber", "shoes", "wool", "yarn", "clothes", "food", "pasta", "sweets", "coal", "ore", "recycled"];
/** Ships sell at this share of the wholesale price (the warehouse bought at the export price). */
export const SHIP_PRICE_FACTOR = 1.25;
/** Goods per warehouse id. */
export type Storage = Record<string, Partial<Record<Good, number>>>;
export const storedTotal = (s: Partial<Record<Good, number>> | undefined) => Object.values(s ?? {}).reduce((a, v) => a + (v ?? 0), 0);
/** Output factor of a building at its level (1 if it has no levels). */
export const levelFactor = (b: Building) => LEVELS[b.kind]?.factor[b.level] ?? 1;
export const FURNITURE_PER_HOUSEHOLD = 0.08;
/** Share of residents that work. */
const WORKER_SHARE = 0.5;
/** Residents one hospital looks after. */
export const HOSPITAL_CAPACITY = 800;
/** Pupils a school can take (residents covered). */
export const SCHOOL_CAPACITY = 300;
/** Births per resident and minute (with a hospital). */
const BIRTH_RATE = 0.0007;
/** Newcomers per minute when water (and bread) are sufficient. */
const IMMIGRATION = 0.08;

const waterCapacityTotal = (cap: Map<number, number>) => [...cap.values()].reduce((a, b) => a + b, 0);
const waterDemandTotal = (demand: Map<number, number>) => [...demand.values()].reduce((a, b) => a + b, 0);

/** Each resident eats this much bread per minute. */
const BREAD_PER_RESIDENT = 0.06;

/* ---------- money: businesses are private, the town lives on taxes and fees ---------- */

/** Wage per worker and minute (paid by the employer, income tax goes to the town). */
export const WAGE = 20;
/** Wholesale prices per unit: what one business pays another (or the export market). */
export const PRICE: Record<Good, number> = {
  wheat: 10,
  milk: 14,
  flour: 22,
  bread: 0,
  cattle: 90,
  pigs: 35,
  meat: 80,
  boards: 105,
  steel: 360,
  furniture: 520,
  meal: 0,
  ticket: 0,
  swim: 0,
  ride: 0,
  game: 0,
  news: 0,
  hides: 20,
  leather: 120,
  caoutchouc: 45,
  rubber: 110,
  shoes: 160,
  wool: 28,
  yarn: 70,
  clothes: 180,
  eggs: 26,
  cocoa: 60,
  coffee: 70,
  food: 120,
  pasta: 80,
  sweets: 110,
  rice: 50,
  spices: 120,
  goldore: 180,
  gold: 1000,
  jewellery: 300,
  coal: 40,
  ore: 50,
  uranium: 420,
  recycled: 70,
};
/** Shop prices paid by residents. */
export const RETAIL_PRICE: Partial<Record<Good, number>> = { bread: 60, meat: 110, furniture: 700, meal: 60, ticket: 35, swim: 25, ride: 30, game: 90, news: 9, shoes: 230, clothes: 260, food: 160, pasta: 110, sweets: 150, rice: 90, spices: 190, jewellery: 380 };
/** Leftover stock is sold off at this share of the price (food to wholesalers, industry exports). */
export const EXPORT_FACTOR: Record<Good, number> = {
  wheat: 0.6,
  milk: 0.6,
  flour: 0.6,
  bread: 0,
  cattle: 0.6,
  pigs: 0.6,
  meat: 0.6,
  boards: 1,
  steel: 1,
  furniture: 0.95,
  meal: 0,
  ticket: 0,
  swim: 0,
  ride: 0,
  game: 0,
  news: 0,
  hides: 0.6,
  leather: 0.9,
  caoutchouc: 0,
  rubber: 0.9,
  shoes: 0.9,
  wool: 0.6,
  yarn: 0.9,
  clothes: 0.9,
  eggs: 0.6,
  cocoa: 0,
  coffee: 0,
  food: 0.9,
  pasta: 0.9,
  sweets: 0.9,
  rice: 0,
  spices: 0,
  goldore: 0.8,
  gold: 1,
  jewellery: 0,
  coal: 0.8,
  ore: 0.8,
  uranium: 0.8,
  recycled: 0.5,
};
/** Water fee per unit for every consumer (the waterworks are municipal). */
export const WATER_FEE = 0.5;
/** Property tax per household and minute (only with water). */
export const PROPERTY_TAX = 1.5;
/** Business tax on profits (Gewerbesteuer). */
export const BUSINESS_TAX_MIN = 0.05;
export const BUSINESS_TAX_MAX = 0.35;
export const BUSINESS_TAX_DEFAULT = 0.15;
/** Municipal buildings: the town pays their upkeep (staff included). */
export const PUBLIC: BuildingKind[] = ["waterworks", "hospital", "school", "church", "powerplant", "transformer", "bank", "townhall", "taxoffice", "jobcenter", "park", "playground", "warehouse", "harbour", "airport", "exchange", "police", "firestation", "trainstation", "traindepot", "prison", "villa", "boathouse"];
/** Buildings a town can have only once. */
export const UNIQUE: BuildingKind[] = ["bank", "townhall", "taxoffice", "exchange", "villa", "boathouse", "newspaper"];
/** The mayor's own buildings: paid from his private account, confiscated when he goes to prison. */
export const MAYOR_PRIVATE: BuildingKind[] = ["villa", "boathouse"];

/**
 * How taxes affect immigration: 10 % income tax → 1.0, 20 % → 0.4, 5 % → 1.3; business tax
 * above 15 % costs a little too (fewer firms want to settle, fewer jobs advertised).
 */
export const taxAttraction = (taxRate: number, businessTaxRate: number) =>
  Math.max(0.15, 1.6 - 6 * taxRate - 1.5 * (businessTaxRate - BUSINESS_TAX_DEFAULT));

/** Jobs of a building (pig farming needs more hands). */
export const jobsOf = (b: Building) =>
  b.kind === "powerplant" ? POWER_JOBS[b.level] : BUILDINGS[b.kind].jobs +
      (b.kind === "farm" ? ([0, 0, 6, 12][b.level] ?? 0) : b.kind === "furniturestore" ? ([0, 0, 8, 20, 45][b.level] ?? 0) : b.kind === "mill" ? ([0, 0, 3, 8, 20][b.level] ?? 0) : (LEVELS[b.kind]?.jobs[b.level] ?? 0));
/** Running costs per minute. */
export const upkeepOf = (b: Building) =>
  b.kind === "waterworks"
    ? WATER_UPKEEP[b.level]
    : b.kind === "powerplant"
      ? POWER_UPKEEP[b.level]
      : b.kind === "transformer"
        ? TRANSFORMER_UPKEEP[b.level]
        : BUILDINGS[b.kind].upkeep +
          (b.kind === "farm" ? ([0, 0, 10, 25][b.level] ?? 0) : b.kind === "furniturestore" ? ([0, 0, 15, 40, 80][b.level] ?? 0) : b.kind === "mill" ? ([0, 0, 8, 18, 45][b.level] ?? 0) : (LEVELS[b.kind]?.upkeep[b.level] ?? 0));

/* ---------- airport: holidays for the residents, air freight from the warehouses ---------- */

/** Holiday trips per resident and minute (everyone flies now and then). */
export const HOLIDAY_PER_RESIDENT = 0.004;
/** Passengers per minute an airport handles at level factor 1. */
export const AIRPORT_PASSENGERS = 4;
/** Airport charges the town earns per passenger. */
export const FARE = 50;
/** Air freight (units per minute at level factor 1), from the regional airport on. */
export const AIR_CARGO = 6;
/** Air freight sells at this share of the wholesale price (fast, so dearer than ships). */
export const AIR_PRICE_FACTOR = 1.35;
export const airportPassengers = (b: Building) => AIRPORT_PASSENGERS * levelFactor(b);
export const airCargoCapacity = (b: Building) => (b.level >= 2 ? AIR_CARGO * levelFactor(b) : 0);

/** What an airport did this minute. */
export interface AirportStatus {
  /** Holidaymakers flown out (and as many coming back) per minute. */
  passengers: number;
  capacity: number;
  /** Goods flown out per minute, and the most it could take. */
  cargo: Partial<Record<Good, number>>;
  cargoCapacity: number;
  /** Town income per minute: charges and freight sales. */
  fares: number;
  freight: number;
}

/** A business's accounts for one minute. */
export interface Finance {
  /** Sales to other businesses, to residents and leftovers sold off. */
  sales: number;
  retail: number;
  export: number;
  purchases: number;
  wages: number;
  upkeep: number;
  water: number;
  /** Electricity bill. */
  power: number;
  profit: number;
  /** Business tax paid to the town. */
  tax: number;
}

/** The town's budget for one minute. */
export interface Budget {
  incomeTax: number;
  businessTax: number;
  propertyTax: number;
  waterFees: number;
  powerFees: number;
  /** Upkeep of municipal buildings by kind (harbour incl. its ships). */
  services: Partial<Record<BuildingKind, number>>;
  /** Surplus bought into the warehouses (at the export price). */
  storage: number;
  /** Gold bars of the smelters bought into the bank's vault. */
  gold?: number;
  /** Airport charges and air freight sales. */
  airport: number;
  /** Police fines and fire-protection levy (residents within reach of a station). */
  emergency?: number;
  /** Railway fares and freight. */
  rail?: number;
  /** State refund for the prison's inmates. */
  justice?: number;
  /** The mayor's salary (from the town to his private account, see mayor.ts). */
  mayor?: number;
  /** Business tax the town forgoes for firms the mayor took money from (already left out of businessTax). */
  favours?: number;
}
/** Buildings farther than this from a road have no access. */
export const ACCESS_DISTANCE = 14;

export const START_MONEY = 350000;

/** Road kinds that carry goods and water pipes. */
const NETWORK_ROADS = new Set(["street", "highway", "ramp"]);

export interface BuildingStatus {
  connected: boolean;
  /** 0..1 share of the water demand that is covered. */
  water: number;
  /** For bakeries: share of flour / milk available; mills: wheat. */
  wheat?: number;
  flour?: number;
  milk?: number;
  /** Share of jobs filled (0..1), for workplaces. */
  staffing?: number;
  /** Per input good: needed at the current working rate, and received. */
  inputs?: Partial<Record<Good, { need: number; got: number }>>;
  /**
   * Per input good: suppliers in the road network (any stock) and those that had some to
   * offer – so the card can tell "no supplier" from "sold out" and "offered, not used".
   */
  sources?: Partial<Record<Good, { inNet: string[]; offered: string[] }>>;
  /** 0..1 share of the power demand that is covered (buildings that use power). */
  power?: number;
  /** Power stations: capacity, delivery and fuel. */
  plant?: PowerPlantStatus;
  /** Airports: passengers and freight. */
  airport?: AirportStatus;
  /** Transformers: wired to a powered grid, and load (kW) of the buildings they supply. */
  transformer?: { grid: number | null; load: number; buildings: number };
  /** Accounts of a business (private buildings with jobs). */
  finance?: Finance;
  /** What a house pays the town per minute. */
  pays?: number;
  /** Per output good: made this minute and the maximum at full capacity. */
  outputs?: Partial<Record<Good, { made: number; max: number }>>;
  /** Gold smelter: bars per minute sold into the bank's vault. */
  vault?: number;
  /** Output per minute (wheat+milk for farms, bread for bakeries, water for waterworks). */
  output: number;
  /** Short problem description, or null. */
  problem: string | null;
}

export interface EconomyStats {
  residents: number;
  breadDemand: number;
  breadSold: number;
  /** Meat the residents want and what the butchers sold (per minute). */
  meatDemand: number;
  meatSold: number;
  /** Furniture the households want and what the stores sold (per minute). */
  /** Share of the leisure demand (restaurant meals, cinema tickets) that is met (0..1). */
  leisure: number;
  /** Share of residents with a park / a playground within reach (0..1), and residents per spot. */
  green: number;
  play: number;
  recreation: Record<string, number>;
  /** Share of residents within reach of a police / fire station (0..1); residents per station are in `recreation`. */
  safety: number;
  fireCover: number;
  /** Prison places and inmates (all prisons on a road network with a police station). */
  prison: { places: number; inmates: number };
  mealsServed: number;
  ticketsSold: number;
  furnitureDemand: number;
  furnitureSold: number;
  /** Share of households that can furnish their homes (0..1). */
  furnished: number;
  /** Share of the residents' shoe demand that is met (0..1). */
  shod: number;
  shoesSold: number;
  /** Share of the residents' clothing demand that is met (0..1). */
  dressed: number;
  clothesSold: number;
  /** Share of the residents' food demand (discounters) that is met (0..1). */
  fed: number;
  /** Share of the residents' wish for imported rice and spices (discounters) that is met (0..1). */
  spiced: number;
  /** Share of the residents' wish for jewellery that is met (0..1). */
  adorned: number;
  /** Gold bars per minute going from the smelters into the town's vault (needs a bank). */
  goldIn: number;
  /** True if the town has a working airport; share of the holiday wishes it meets (0..1). */
  airport: boolean;
  holiday: number;
  /** Goods flown out of each warehouse this minute. */
  airOut: Storage;
  foodSold: number;
  wheat: number;
  flour: number;
  milk: number;
  /** Households in the town. */
  households: number;
  /** Labour market. */
  workers: number;
  jobs: number;
  employment: number;
  /** Workers without a job (none within commuting distance and no job centre near home). */
  unemployed: number;
  /** Per job centre: workers living in its area, how many have work, and how many it placed far away. */
  jobcentres: Record<string, JobCentreStatus>;
  /** Residents covered by schools (0..1). */
  education: number;
  taxRate: number;
  waterCapacity: number;
  waterDemand: number;
  /** Euros per minute: income minus upkeep. */
  balance: number;
  /** New residents per minute: births (only with a hospital) and immigration. */
  births: number;
  immigration: number;
  /** True if a hospital serves the network with the most residents. */
  hospital: boolean;
  /** What keeps the town from growing, or null. */
  growthLimit: string | null;
  income: number;
  upkeep: number;
  businessTaxRate: number;
  budget: Budget;
  /** Sum of all business profits (after tax). */
  businessProfit: number;
  status: Record<string, BuildingStatus>;
  /** Who delivers what to whom this minute. */
  flows: Flow[];
  /** Hospital beds / school seats needed vs offered. */
  hospitalCapacity: number;
  schoolSeats: number;
  /** Electricity (kW): possible output of all stations, demand of all buildings, delivered. */
  powerCapacity: number;
  powerDemand: number;
  powerSupplied: number;
  /** Share of the town's power demand that is met (0..1). */
  powered: number;
  /** Goods taken into each warehouse this minute. */
  storageIn: Storage;
  /** Imported goods sold from each import-export company's store this minute. */
  importOut: Storage;
  /** Open import orders per harbour id (what its ships should bring back). */
  importOrders: Record<string, ImportOrder[]>;
  /** Road network of every building (null = no access). */
  networkOf: Record<string, number | null>;
  /** Road network of every street, motorway and ramp. */
  roadNetworkOf: Record<string, number>;
  /** Railway: stations, signal boxes, fares and freight (added by the store after `simulate`). */
  rail?: RailStats;
  /** What the citizens think of their mayor (0..1) and whether a scandal is running (added by the store, mayor.ts). */
  mayor?: { score: number; scandal: boolean };
}

/**
 * Connected road networks: road id → network id. Ramps join the motorways they touch.
 * Cached per road list (roads are replaced, never mutated): the pairwise test of all roads
 * ran every tick although the roads rarely change.
 */
let networkCache: { roads: Road[]; out: Map<string, number> } | null = null;
export function roadNetworks(roads: Road[]): Map<string, number> {
  if (networkCache?.roads === roads) return networkCache.out;
  const out = computeRoadNetworks(roads);
  networkCache = { roads, out };
  return out;
}

function computeRoadNetworks(roads: Road[]): Map<string, number> {
  const usable = roads.filter((r) => NETWORK_ROADS.has(r.kind));
  const parent = usable.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  for (let a = 0; a < usable.length; a++) {
    for (let b = a + 1; b < usable.length; b++) {
      const ra = usable[a];
      const rb = usable[b];
      const shared = ra.points.some((p) => rb.points.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < 0.6));
      const ramp =
        (ra.kind === "ramp" || rb.kind === "ramp") &&
        [ra, rb].some((r) => r.kind === "ramp" &&
          [r.points[0], r.points[r.points.length - 1]].some((e) => closestOnPath(e, r === ra ? rb : ra).distance < 14));
      if (shared || ramp) join(a, b);
    }
  }
  const out = new Map<string, number>();
  usable.forEach((r, i) => out.set(r.id, find(i)));
  return out;
}

/**
 * Access roads per road list (roads are replaced, never mutated, so the list identity is a
 * safe key) and per plot position. The economy asks for every building every tick, which
 * was the most expensive part of a tick in big towns.
 */
let accessCache: { roads: Road[]; byPlot: Map<string, Road | null>; byObject: WeakMap<object, Road | null> } | null = null;

/** The road a building is served from (street-like roads only), or null. */
export function accessRoad(b: { x: number; z: number; rot?: number; kind?: BuildingKind; level?: number }, roads: Road[]): Road | null {
  if (accessCache?.roads !== roads) accessCache = { roads, byPlot: new Map(), byObject: new WeakMap() };
  // Buildings are replaced, never mutated: the object itself is the fastest key.
  const known = accessCache.byObject.get(b);
  if (known !== undefined) return known;
  const key = `${b.x},${b.z},${b.rot ?? 0},${b.kind ?? ""},${b.level ?? 1}`;
  const hit = accessCache.byPlot.get(key);
  if (hit !== undefined) {
    accessCache.byObject.set(b, hit);
    return hit;
  }
  const road = findAccessRoad(b, roads);
  accessCache.byPlot.set(key, road);
  accessCache.byObject.set(b, road);
  return road;
}

function findAccessRoad(b: { x: number; z: number; rot?: number; kind?: BuildingKind; level?: number }, roads: Road[]): Road | null {
  let best: Road | null = null;
  let bestD = ACCESS_DISTANCE;
  // Measured from the middle of the plot's front edge (the side facing the road).
  const half = b.kind ? sizeOf({ kind: b.kind, level: b.level })[1] / 2 : 0;
  const rot = b.rot ?? 0;
  const front = { x: b.x - Math.sin(rot) * half, z: b.z - Math.cos(rot) * half };
  for (const r of roads) {
    if (r.kind !== "street") continue;
    const d = closestOnPath(front, r).distance;
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

/** Output of farms and mills = what they actually delivered (one pass over the flows). */
function deliveredOutput(producers: Building[], flows: Flow[], status: Record<string, BuildingStatus>) {
  const sent = new Map<string, number>();
  for (const f of flows) sent.set(f.from, (sent.get(f.from) ?? 0) + f.amount);
  for (const b of producers) status[b.id].output = sent.get(b.id) ?? 0;
}

/** Nearest wired transformer per plot (see simulate). */
let supplyCache: { key: string; cables: Cable[]; best: WeakMap<Building, Building | null> } | null = null;

/** One minute of the economy for the current world. */
export function simulate(
  buildings: Building[],
  roads: Road[],
  taxRate = TAX_DEFAULT,
  businessTaxRate = BUSINESS_TAX_DEFAULT,
  cables: Cable[] = [],
  canals: Path[] = [],
  storage: Storage = {},
  /** Running costs of all ships per harbour id. */
  shipUpkeep: Record<string, number> = {},
  /** Harbours that cannot send ships yet: id → reason (no navigable water at the quay). */
  harbourWater: Record<string, string | null> = {},
): EconomyStats {
  const networks = roadNetworks(roads);
  const netOf = new Map<string, number | null>();
  for (const b of buildings) {
    const road = accessRoad(b, roads);
    netOf.set(b.id, road ? (networks.get(road.id) ?? null) : null);
  }
  const connected = (b: Building) => netOf.get(b.id) !== null && netOf.get(b.id) !== undefined;

  // Water per network.
  const cap = new Map<number, number>();
  const demand = new Map<number, number>();
  for (const b of buildings) {
    const net = netOf.get(b.id);
    if (net === null || net === undefined) continue;
    if (b.kind === "waterworks") cap.set(net, (cap.get(net) ?? 0) + WATER_CAPACITY[b.level]);
    demand.set(net, (demand.get(net) ?? 0) + waterOf(b));
  }
  const waterRatio = (net: number | null | undefined) =>
    net === null || net === undefined ? 0 : Math.min(1, (cap.get(net) ?? 0) / Math.max(1e-6, demand.get(net) ?? 0));

  // Labour market: half the residents work, but only within COMMUTE_DISTANCE of home (same
  // road network) – unless a job centre near home places them anywhere in the network.
  let residents = 0;
  for (const b of buildings) residents += residentsOf(b);
  const workers = residents * WORKER_SHARE;
  const jobs = buildings.reduce((sum, b) => sum + (connected(b) ? jobsOf(b) : 0), 0);
  const labour = labourMarket(buildings, netOf);
  const staffingOf = (b: Building) => {
    const j = jobsOf(b);
    return j > 0 ? Math.min(1, (labour.filled.get(b.id) ?? 0) / j) : 1;
  };
  const employment = workers > 0 ? Math.min(1, labour.employed / workers) : 1;

  const status: Record<string, BuildingStatus> = {};
  for (const b of buildings) {
    const net = netOf.get(b.id) ?? null;
    const water = waterOf(b) > 0 ? waterRatio(net) : 1;
    status[b.id] = {
      connected: net !== null,
      water,
      output: 0,
      staffing: jobsOf(b) > 0 ? staffingOf(b) : undefined,
      problem:
        b.kind === "ruin"
          ? "Abgebrannt – Ruine abreißen, dann wird das Grundstück wieder bebaut"
          : net === null && !ROADLESS_KINDS.includes(b.kind)
          ? "Stillgelegt – kein Straßenanschluss (Straße vor dem Gebäude bauen)"
          : b.kind === "prison" && !buildings.some((p) => p.kind === "police" && netOf.get(p.id) === net)
          ? "Keine Polizeiwache im Straßennetz – das Gefängnis bleibt leer"
          : b.kind === "harbour" && harbourWater[b.id]
            ? `Stillgelegt – ${harbourWater[b.id]}`
            : water < 0.99
              ? "Zu wenig Wasser"
              : null,
    };
    if (net !== null && jobsOf(b) > 0 && staffingOf(b) < 0.6 && !status[b.id].problem) {
      status[b.id].problem =
        labour.unemployed > 1 ? "Zu wenige Arbeitskräfte in Pendelnähe (800 m) – Arbeitsamt vermittelt Arbeitslose" : "Zu wenige Arbeitskräfte";
    }
  }
  // Businesses without power work slower (filled in by the power step below; mines and
  // stations themselves need none).
  const powerFactor = new Map<string, number>();
  const work = (b: Building) => status[b.id].water * (status[b.id].staffing ?? 1) * (powerFactor.get(b.id) ?? 1);

  // Goods: farms → wheat + milk, mills → flour, bakeries → bread. Every consumer is
  // supplied by the nearest suppliers on its road network (explicit flows).
  const flows: Flow[] = [];
  const stock = new Map<string, Partial<Record<Good, number>>>(); // what a supplier has left
  const distance = (a: Building, b: Building) => Math.hypot(a.x - b.x, a.z - b.z);
  const take = (consumer: Building, good: Good, wanted: number, suppliers: Building[]) => {
    const net = netOf.get(consumer.id);
    let got = 0;
    const taken: Flow[] = [];
    const inNet = suppliers.filter((s) => netOf.get(s.id) === net && s.id !== consumer.id);
    const sorted = inNet
      .filter((s) => (stock.get(s.id)?.[good] ?? 0) > 1e-6)
      .sort((a, b) => distance(a, consumer) - distance(b, consumer));
    const st = status[consumer.id];
    if (st) {
      st.sources ??= {};
      const src = (st.sources[good] ??= { inNet: [], offered: [] });
      for (const s of inNet) if (!src.inNet.includes(s.id)) src.inNet.push(s.id);
    }
    for (const s of sorted) {
      if (got >= wanted - 1e-6) break;
      const left = stock.get(s.id)![good]!;
      const amount = Math.min(left, wanted - got);
      stock.get(s.id)![good] = left - amount;
      got += amount;
      taken.push({ from: s.id, to: consumer.id, good, amount });
      const src = st?.sources?.[good];
      if (src && !src.offered.includes(s.id)) src.offered.push(s.id);
    }
    return { got, taken };
  };
  /** Gives back part of what was taken (when the consumer could use less). */
  const keep = (taken: Flow[], share: number) => {
    for (const f of taken) {
      const back = f.amount * (1 - share);
      stock.get(f.from)![f.good] = (stock.get(f.from)![f.good] ?? 0) + back;
      f.amount -= back;
      if (f.amount > 1e-3) flows.push(f);
    }
  };
  /**
   * Fair share for shops: when the suppliers of a network have less than all its shops want,
   * every shop gets the same share of its want (before, the first shop in the list emptied
   * the factories and the others got nothing – it looked like a broken connection).
   */
  const fairShare = (good: Good, suppliers: Building[], wants: [Building, number][]) => {
    const supply = new Map<number, number>();
    const want = new Map<number, number>();
    for (const s of suppliers) {
      const n = netOf.get(s.id)!;
      supply.set(n, (supply.get(n) ?? 0) + (stock.get(s.id)?.[good] ?? 0));
    }
    for (const [b, w] of wants) {
      const n = netOf.get(b.id)!;
      want.set(n, (want.get(n) ?? 0) + w);
    }
    return (b: Building) => {
      const w = want.get(netOf.get(b.id)!) ?? 0;
      return w > 0 ? Math.min(1, (supply.get(netOf.get(b.id)!) ?? 0) / w) : 1;
    };
  };
  // Mines produce first: their coal and uranium fuel the power stations.
  const mines = buildings.filter((b) => MINES.includes(b.kind) && connected(b));
  for (const b of mines) {
    const recipe = RECIPES[b.kind]!;
    const made: Partial<Record<Good, number>> = {};
    const outputs: Partial<Record<Good, { made: number; max: number }>> = {};
    for (const [g, max] of Object.entries(recipe.outputs) as [Good, number][]) {
      made[g] = max * work(b);
      outputs[g] = { made: made[g]!, max };
    }
    stock.set(b.id, made);
    status[b.id].outputs = outputs;
  }

  // Electricity: cables form grids; stations feed their grid, transformers on a grid supply
  // every building within their radius.
  const grids = cableGrids(cables);
  const transformers = buildings.filter((b) => b.kind === "transformer");
  const plants = buildings.filter((b) => b.kind === "powerplant");
  const transformerGrid = new Map<string, number | null>();
  for (const t of transformers) transformerGrid.set(t.id, gridOf(t, cables, grids));
  const supplyGrid = new Map<string, { grid: number; transformer: string }>();
  const gridDemand = new Map<number, number>();
  let powerDemand = 0;
  // Nearest wired transformer per building: cached while transformers and cables stay the same
  // (it was every building × every transformer per tick).
  const trafoKey = transformers.map((t) => `${t.id},${t.x},${t.z},${t.level},${transformerGrid.get(t.id)}`).join("|");
  if (supplyCache?.key !== trafoKey || supplyCache.cables !== cables) supplyCache = { key: trafoKey, cables, best: new WeakMap() };
  const cache = supplyCache;
  for (const b of buildings) {
    const need = powerOf(b);
    if (need <= 0) continue;
    powerDemand += need;
    let best: Building | null | undefined = cache.best.get(b);
    if (best === undefined) {
      best = null;
      for (const t of transformers) {
        if (transformerGrid.get(t.id) === null || !transformerReaches(t, b)) continue;
        if (!best || Math.hypot(t.x - b.x, t.z - b.z) < Math.hypot(best.x - b.x, best.z - b.z)) best = t;
      }
      cache.best.set(b, best);
    }
    if (!best) continue;
    const grid = transformerGrid.get(best.id)!;
    supplyGrid.set(b.id, { grid, transformer: best.id });
    gridDemand.set(grid, (gridDemand.get(grid) ?? 0) + need);
  }
  const plantGrid = new Map<string, number | null>();
  const gridCapacity = new Map<number, number>();
  let powerCapacity = 0;
  for (const p of plants) {
    const grid = gridOf(p, cables, grids);
    plantGrid.set(p.id, grid);
    const hydroOk = p.level !== 1 || canals.some((c) => c.points.length > 1 && polylineDistanceToFootprint(p, c.points) <= HYDRO_CANAL_DISTANCE);
    const capacity = connected(p) && hydroOk ? POWER_CAPACITY[p.level] * work(p) : 0;
    powerCapacity += capacity;
    status[p.id].plant = { grid, capacity, delivered: 0 };
    if (grid !== null) gridCapacity.set(grid, (gridCapacity.get(grid) ?? 0) + capacity);
    if (!hydroOk) status[p.id].problem = status[p.id].problem ?? "Wasserkraft braucht einen Kanal direkt am Werk";
    else if (grid === null) status[p.id].problem = status[p.id].problem ?? "Kein Kabel angeschlossen – Kabel zu einer Trafostation legen";
  }
  // Stations run at the load of their grid and burn fuel for it.
  const coalMines = mines.filter((b) => b.kind === "coalmine");
  const uraniumMines = mines.filter((b) => b.kind === "uraniummine");
  const gridSupply = new Map<number, number>();
  for (const p of plants) {
    const st = status[p.id];
    const plant = st.plant!;
    if (plant.grid === null || plant.capacity <= 0) continue;
    const load = Math.min(1, (gridDemand.get(plant.grid) ?? 0) / Math.max(1e-6, gridCapacity.get(plant.grid) ?? 0));
    let fuelShare = 1;
    if (p.level >= 2) {
      const good: Good = p.level === 2 ? "coal" : "uranium";
      const perMinute = fuelPerMinute(p.level);
      const need = perMinute * (plant.capacity / POWER_CAPACITY[p.level]) * load;
      const fuel = take(p, good, need, p.level === 2 ? coalMines : uraniumMines);
      keep(fuel.taken, 1);
      plant.fuel = { need, got: fuel.got };
      st.inputs = { [good]: { need, got: fuel.got } };
      fuelShare = need > 1e-6 ? fuel.got / need : 1;
      if (fuelShare < 0.5)
        st.problem = st.problem ?? (p.level === 2 ? "Zu wenig Kohle – Kohlebergwerk anschließen" : "Zu wenig Uran – Uranbergwerk anschließen");
    }
    plant.delivered = plant.capacity * load * fuelShare;
    st.output = plant.delivered;
    gridSupply.set(plant.grid, (gridSupply.get(plant.grid) ?? 0) + plant.delivered);
  }
  let powerSupplied = 0;
  for (const b of buildings) {
    const need = powerOf(b);
    if (need <= 0) continue;
    const s = supplyGrid.get(b.id);
    const demandOnGrid = s ? (gridDemand.get(s.grid) ?? 0) : 0;
    const share = s ? Math.min(1, (gridSupply.get(s.grid) ?? 0) / Math.max(1e-6, demandOnGrid)) : 0;
    status[b.id].power = share;
    powerSupplied += need * share;
    if (b.kind !== "house" && !PUBLIC.includes(b.kind)) powerFactor.set(b.id, UNPOWERED_WORK + (1 - UNPOWERED_WORK) * share);
  }
  // Buildings per transformer in one pass.
  const servedBy = new Map<string, { n: number; load: number }>();
  for (const b of buildings) {
    const sg = supplyGrid.get(b.id);
    if (!sg) continue;
    const e = servedBy.get(sg.transformer) ?? { n: 0, load: 0 };
    e.n++;
    e.load += powerOf(b) * (status[b.id].power ?? 0);
    servedBy.set(sg.transformer, e);
  }
  for (const t of transformers) {
    const grid = transformerGrid.get(t.id) ?? null;
    const sv = servedBy.get(t.id) ?? { n: 0, load: 0 };
    const load = sv.load;
    status[t.id].transformer = { grid, load, buildings: sv.n };
    status[t.id].output = load;
    if (grid === null) status[t.id].problem = "Kein Kabel – mit dem Kabel-Werkzeug ans Kraftwerk anschließen";
    else if ((gridSupply.get(grid) ?? 0) <= 0) status[t.id].problem = "Kein Strom im Netz – Kraftwerk anschließen";
  }

  const farms = buildings.filter((b) => b.kind === "farm" && connected(b));
  const mills = buildings.filter((b) => b.kind === "mill" && connected(b));
  const bakeries = buildings.filter((b) => b.kind === "bakery" && connected(b));
  for (const b of farms) {
    const f = FARM_OUTPUT[b.level] ?? 1;
    const w = work(b) * f;
    stock.set(b.id, { wheat: FARM_WHEAT * w, milk: FARM_MILK * w });
    status[b.id].outputs = { wheat: { made: FARM_WHEAT * w, max: FARM_WHEAT * f }, milk: { made: FARM_MILK * w, max: FARM_MILK * f } };
    if (b.level >= 2) {
      stock.get(b.id)!.cattle = FARM_CATTLE * w;
      stock.get(b.id)!.pigs = FARM_PIGS * w;
      status[b.id].outputs!.cattle = { made: FARM_CATTLE * w, max: FARM_CATTLE * f };
      status[b.id].outputs!.pigs = { made: FARM_PIGS * w, max: FARM_PIGS * f };
    }
  }
  // Mills grind what they get.
  for (const b of mills) {
    const capacity = MILL_CAPACITY * (MILL_FACTOR[b.level] ?? 1) * work(b);
    const { got, taken } = take(b, "wheat", capacity, farms);
    keep(taken, 1);
    stock.set(b.id, { flour: got });
    status[b.id].inputs = { wheat: { need: capacity, got } };
    status[b.id].outputs = { flour: { made: got, max: MILL_CAPACITY * (MILL_FACTOR[b.level] ?? 1) } };
    status[b.id].wheat = capacity > 0 ? got / capacity : 0;
    if (!status[b.id].problem && got < capacity * 0.5) status[b.id].problem = "Zu wenig Weizen – Bauernhof anschließen";
  }
  // Bread demand per network from residents.
  const residentsOn = new Map<number, number>();
  for (const b of buildings) {
    const net = netOf.get(b.id);
    if (net !== null && net !== undefined && residentsOf(b) > 0) residentsOn.set(net, (residentsOn.get(net) ?? 0) + residentsOf(b));
  }
  const bakeriesOn = new Map<number, number>();
  // Customers split between the bakeries of a network by size (a bread factory serves many).
  for (const b of bakeries) bakeriesOn.set(netOf.get(b.id)!, (bakeriesOn.get(netOf.get(b.id)!) ?? 0) + levelFactor(b));
  let breadSold = 0;
  const bakeryCustomers = (b: Building) =>
    ((residentsOn.get(netOf.get(b.id)!) ?? 0) * BREAD_PER_RESIDENT * levelFactor(b)) / (bakeriesOn.get(netOf.get(b.id)!) ?? 1);
  const bakeryCapacity = (b: Building) => Math.min(BAKERY_CAPACITY * levelFactor(b) * work(b), bakeryCustomers(b));
  // Bread comes first (basic supply, and houses only grow with enough of it): the bakeries
  // take the flour they need, the food factories (which buy later) get the rest and make up
  // what is missing with wheat from the farms. Scarce flour is shared between the bakeries of
  // a network by need, so the first one does not empty the mills. (Sharing it with the food
  // factories as well left 28 bakeries at 79.99 % bread – just under the growth limit.)
  const flourShare = new Map<number, number>();
  {
    const supply = new Map<number, number>();
    const demand = new Map<number, number>();
    const addTo = (m: Map<number, number>, b: Building, v: number) => m.set(netOf.get(b.id)!, (m.get(netOf.get(b.id)!) ?? 0) + v);
    for (const m of mills) addTo(supply, m, stock.get(m.id)?.flour ?? 0);
    for (const b of bakeries) addTo(demand, b, bakeryCapacity(b) * BREAD_FLOUR);
    for (const [net, need] of demand) flourShare.set(net, need > 0 ? Math.min(1, (supply.get(net) ?? 0) / need) : 1);
  }
  for (const b of bakeries) {
    const net = netOf.get(b.id)!;
    const customers = bakeryCustomers(b);
    const capacity = bakeryCapacity(b);
    const flour = take(b, "flour", capacity * BREAD_FLOUR * (flourShare.get(net) ?? 1), mills);
    const milkIn = take(b, "milk", capacity * BREAD_MILK, farms);
    const bread = Math.min(capacity, flour.got / BREAD_FLOUR, milkIn.got / BREAD_MILK);
    keep(flour.taken, flour.got > 0 ? (bread * BREAD_FLOUR) / flour.got : 0);
    keep(milkIn.taken, milkIn.got > 0 ? (bread * BREAD_MILK) / milkIn.got : 0);
    breadSold += bread;
    const st = status[b.id];
    st.output = bread;
    st.inputs = {
      flour: { need: capacity * BREAD_FLOUR, got: flour.got },
      milk: { need: capacity * BREAD_MILK, got: milkIn.got },
    };
    st.outputs = { bread: { made: bread, max: BAKERY_CAPACITY * levelFactor(b) } };
    st.flour = capacity > 0 ? Math.min(1, flour.got / (capacity * BREAD_FLOUR)) : 0;
    st.milk = capacity > 0 ? Math.min(1, milkIn.got / (capacity * BREAD_MILK)) : 0;
    st.problem =
      st.problem ??
      (customers < 0.5
        ? "Keine Kundschaft im Straßennetz"
        : flour.got < capacity * 0.5
          ? "Zu wenig Mehl – Mühle anschließen"
          : milkIn.got < capacity * 0.25
            ? "Zu wenig Milch – Bauernhof anschließen"
            : null);
  }
  // Meat: slaughterhouses take cattle and pigs from pig farms, butchers sell the meat.
  const slaughterhouses = buildings.filter((b) => b.kind === "slaughterhouse" && connected(b));
  const butchers = buildings.filter((b) => b.kind === "butcher" && connected(b));
  const pigFarms = farms.filter((b) => b.level >= 2);
  for (const b of slaughterhouses) {
    const size = levelFactor(b);
    const capacity = SLAUGHTER_CAPACITY * size * work(b);
    // Cattle first (more meat each), pigs fill up the rest.
    const cattle = take(b, "cattle", capacity / MEAT_PER_CATTLE, pigFarms);
    keep(cattle.taken, 1);
    const pigs = take(b, "pigs", (capacity - cattle.got * MEAT_PER_CATTLE) / MEAT_PER_PIG, pigFarms);
    keep(pigs.taken, 1);
    const meat = cattle.got * MEAT_PER_CATTLE + pigs.got * MEAT_PER_PIG;
    const hides = cattle.got * HIDES_PER_CATTLE + pigs.got * HIDES_PER_PIG;
    stock.set(b.id, { meat, hides });
    const st = status[b.id];
    st.inputs = {
      cattle: { need: (capacity / MEAT_PER_CATTLE) * 0.6, got: cattle.got },
      pigs: { need: (capacity / MEAT_PER_PIG) * 0.4, got: pigs.got },
    };
    st.outputs = {
      meat: { made: meat, max: SLAUGHTER_CAPACITY * size },
      hides: { made: hides, max: ((SLAUGHTER_CAPACITY * size) / MEAT_PER_CATTLE) * HIDES_PER_CATTLE },
    };
    st.problem =
      st.problem ?? (meat < capacity * 0.4 ? "Zu wenig Tiere – Bauernhof zur Schweinezucht ausbauen" : null);
  }
  const butchersOn = new Map<number, number>();
  // Customers split by shop size (a bigger butcher draws more of them).
  for (const b of butchers) butchersOn.set(netOf.get(b.id)!, (butchersOn.get(netOf.get(b.id)!) ?? 0) + levelFactor(b));
  let meatSold = 0;
  const butcherWant = (b: Building) => {
    const customers = ((residentsOn.get(netOf.get(b.id)!) ?? 0) * MEAT_PER_RESIDENT * levelFactor(b)) / (butchersOn.get(netOf.get(b.id)!) ?? 1);
    return { customers, capacity: Math.min(BUTCHER_CAPACITY * levelFactor(b) * work(b), customers) };
  };
  const meatFair = fairShare("meat", slaughterhouses, butchers.map((b) => [b, butcherWant(b).capacity]));
  for (const b of butchers) {
    const { customers, capacity } = butcherWant(b);
    const got = take(b, "meat", capacity * meatFair(b), slaughterhouses);
    keep(got.taken, 1);
    meatSold += got.got;
    const st = status[b.id];
    st.output = got.got;
    st.inputs = { meat: { need: capacity, got: got.got } };
    st.outputs = { meat: { made: got.got, max: BUTCHER_CAPACITY * levelFactor(b) } };
    st.problem =
      st.problem ??
      (customers < 0.05
        ? "Keine Kundschaft im Straßennetz"
        : got.got < capacity * 0.5
          ? meatFair(b) < 0.9
            ? "Zu wenig Fleisch in der Stadt – die Schlachthöfe liefern zu wenig (fair auf alle Metzgereien verteilt)"
            : "Zu wenig Fleisch – Schlachthof anschließen"
          : null);
  }
  for (const b of slaughterhouses) status[b.id].output = flows.filter((f) => f.from === b.id).reduce((s, f) => s + f.amount, 0);
  const meatDemand = residents * MEAT_PER_RESIDENT;

  // Farm and mill output is what was actually delivered.
  deliveredOutput([...farms, ...mills], flows, status);
  const totalOf = (good: Good) =>
    [...farms, ...mills].reduce((s, b) => s + (status[b.id].outputs?.[good]?.made ?? 0), 0);

  // Leather chain: tanneries take hides from the slaughterhouses, rubber factories import
  // caoutchouc, shoe factories sew leather and rubber soles into shoes, shoe shops sell them.
  const tanneries = buildings.filter((b) => b.kind === "tannery" && connected(b));
  const rubberFactories = buildings.filter((b) => b.kind === "rubberfactory" && connected(b));
  const shoeFactories = buildings.filter((b) => b.kind === "shoefactory" && connected(b));
  const shoeShops = buildings.filter((b) => b.kind === "shoeshop" && connected(b));
  /** Bought from outside the town (no supplier building): cost per building. */
  const imports = new Map<string, number>();
  for (const b of tanneries) {
    const capacity = TANNERY_CAPACITY * work(b);
    const hides = take(b, "hides", capacity, slaughterhouses);
    keep(hides.taken, 1);
    stock.set(b.id, { leather: hides.got });
    const st = status[b.id];
    st.inputs = { hides: { need: capacity, got: hides.got } };
    st.outputs = { leather: { made: hides.got, max: TANNERY_CAPACITY } };
    st.problem = st.problem ?? (hides.got < capacity * 0.5 ? "Zu wenig Häute – Schlachthof anschließen" : null);
  }
  for (const b of rubberFactories) {
    // Natural rubber does not grow here: it is imported at the caoutchouc price.
    const made = RUBBER_CAPACITY * work(b);
    imports.set(b.id, made * PRICE.caoutchouc);
    stock.set(b.id, { rubber: made });
    status[b.id].inputs = { caoutchouc: { need: made, got: made } };
    status[b.id].outputs = { rubber: { made, max: RUBBER_CAPACITY } };
  }
  // Scarce leather and rubber are shared by need: otherwise the factories that buy first empty
  // the tanneries and a new factory gets nothing – even right next to a tannery (user bug).
  const shoeCapacity = (b: Building) => SHOE_CAPACITY * levelFactor(b) * work(b);
  const leatherShare = fairShare("leather", tanneries, shoeFactories.map((b) => [b, shoeCapacity(b) * SHOE_LEATHER]));
  const rubberShare = fairShare("rubber", rubberFactories, shoeFactories.map((b) => [b, shoeCapacity(b) * SHOE_RUBBER]));
  for (const b of shoeFactories) {
    const capacity = shoeCapacity(b);
    const share = Math.min(leatherShare(b), rubberShare(b));
    const leather = take(b, "leather", capacity * SHOE_LEATHER * share, tanneries);
    const rubber = take(b, "rubber", capacity * SHOE_RUBBER * share, rubberFactories);
    const made = Math.min(capacity, leather.got / SHOE_LEATHER, rubber.got / SHOE_RUBBER);
    keep(leather.taken, leather.got > 0 ? (made * SHOE_LEATHER) / leather.got : 0);
    keep(rubber.taken, rubber.got > 0 ? (made * SHOE_RUBBER) / rubber.got : 0);
    stock.set(b.id, { shoes: made });
    const st = status[b.id];
    st.inputs = {
      leather: { need: capacity * SHOE_LEATHER, got: leather.got },
      rubber: { need: capacity * SHOE_RUBBER, got: rubber.got },
    };
    st.outputs = { shoes: { made, max: SHOE_CAPACITY * levelFactor(b) } };
    st.problem =
      st.problem ??
      (leather.got < capacity * SHOE_LEATHER * 0.5
        ? leatherShare(b) < 0.9
          ? "Zu wenig Leder in der Stadt – die Gerbereien liefern zu wenig (fair verteilt): Gerberei bauen oder mehr Arbeitskräfte"
          : "Zu wenig Leder – Gerberei anschließen"
        : rubber.got < capacity * SHOE_RUBBER * 0.5
          ? rubberShare(b) < 0.9
            ? "Zu wenig Gummi in der Stadt – die Gummifabriken liefern zu wenig (fair verteilt)"
            : "Zu wenig Gummi – Gummifabrik anschließen"
          : null);
  }
  const shopsOn = new Map<number, number>();
  for (const b of shoeShops) shopsOn.set(netOf.get(b.id)!, (shopsOn.get(netOf.get(b.id)!) ?? 0) + 1);
  let shoesSold = 0;
  const shoeWant = (b: Building) => {
    const customers = ((residentsOn.get(netOf.get(b.id)!) ?? 0) * SHOES_PER_RESIDENT) / (shopsOn.get(netOf.get(b.id)!) ?? 1);
    return { customers, capacity: Math.min(SHOESHOP_CAPACITY * work(b), customers) };
  };
  const shoeShare = fairShare("shoes", shoeFactories, shoeShops.map((b) => [b, shoeWant(b).capacity]));
  for (const b of shoeShops) {
    const { customers, capacity } = shoeWant(b);
    const got = take(b, "shoes", capacity * shoeShare(b), shoeFactories);
    keep(got.taken, 1);
    shoesSold += got.got;
    const st = status[b.id];
    st.output = got.got;
    st.inputs = { shoes: { need: capacity, got: got.got } };
    st.outputs = { shoes: { made: got.got, max: SHOESHOP_CAPACITY } };
    st.problem =
      st.problem ??
      (customers < 0.05
        ? "Keine Kundschaft im Straßennetz"
        : got.got < capacity * 0.5
          ? shoeShare(b) < 0.9
            ? "Zu wenig Schuhe in der Stadt – die Schuhfabriken liefern zu wenig (fair auf alle Geschäfte verteilt)"
            : "Zu wenig Schuhe – Schuhfabrik anschließen"
          : null);
  }
  const shoeDemand = residentsOn.size > 0 ? buildings.reduce((sum, b) => sum + residentsOf(b), 0) * SHOES_PER_RESIDENT : 0;
  const shod = shoeDemand > 0 ? Math.min(1, shoesSold / shoeDemand) : 0;

  // Textile chain: sheep farms shear wool, spinning mills spin it into yarn, clothing
  // factories weave and sew clothes, fashion shops sell them to the residents.
  const sheepFarms = buildings.filter((b) => b.kind === "sheepfarm" && connected(b));
  const spinningMills = buildings.filter((b) => b.kind === "spinning" && connected(b));
  const clothingFactories = buildings.filter((b) => b.kind === "clothing" && connected(b));
  const fashionShops = buildings.filter((b) => b.kind === "fashion" && connected(b));
  for (const b of sheepFarms) {
    const max = WOOL_CAPACITY * levelFactor(b);
    const made = max * work(b);
    stock.set(b.id, { wool: made });
    status[b.id].outputs = { wool: { made, max } };
  }
  for (const b of spinningMills) {
    const max = SPINNING_CAPACITY * levelFactor(b);
    const capacity = max * work(b);
    const wool = take(b, "wool", capacity * YARN_WOOL, sheepFarms);
    keep(wool.taken, 1);
    const made = wool.got / YARN_WOOL;
    stock.set(b.id, { yarn: made });
    const st = status[b.id];
    st.inputs = { wool: { need: capacity * YARN_WOOL, got: wool.got } };
    st.outputs = { yarn: { made, max } };
    st.problem = st.problem ?? (wool.got < capacity * YARN_WOOL * 0.5 ? "Zu wenig Wolle – Schaffarm anschließen oder ausbauen" : null);
  }
  for (const b of clothingFactories) {
    const max = CLOTHES_CAPACITY * levelFactor(b);
    const capacity = max * work(b);
    const yarn = take(b, "yarn", capacity * CLOTHES_YARN, spinningMills);
    keep(yarn.taken, 1);
    const made = yarn.got / CLOTHES_YARN;
    stock.set(b.id, { clothes: made });
    const st = status[b.id];
    st.inputs = { yarn: { need: capacity * CLOTHES_YARN, got: yarn.got } };
    st.outputs = { clothes: { made, max } };
    st.problem = st.problem ?? (yarn.got < capacity * CLOTHES_YARN * 0.5 ? "Zu wenig Garn – Spinnerei anschließen oder ausbauen" : null);
  }
  const fashionOn = new Map<number, number>();
  for (const b of fashionShops) fashionOn.set(netOf.get(b.id)!, (fashionOn.get(netOf.get(b.id)!) ?? 0) + 1);
  let clothesSold = 0;
  const fashionWant = (b: Building) => {
    const customers = ((residentsOn.get(netOf.get(b.id)!) ?? 0) * CLOTHES_PER_RESIDENT) / (fashionOn.get(netOf.get(b.id)!) ?? 1);
    return { customers, capacity: Math.min(FASHION_CAPACITY * work(b), customers) };
  };
  const clothesShare = fairShare("clothes", clothingFactories, fashionShops.map((b) => [b, fashionWant(b).capacity]));
  for (const b of fashionShops) {
    const { customers, capacity } = fashionWant(b);
    const got = take(b, "clothes", capacity * clothesShare(b), clothingFactories);
    keep(got.taken, 1);
    clothesSold += got.got;
    const st = status[b.id];
    st.output = got.got;
    st.inputs = { clothes: { need: capacity, got: got.got } };
    st.outputs = { clothes: { made: got.got, max: FASHION_CAPACITY } };
    st.problem =
      st.problem ??
      (customers < 0.05
        ? "Keine Kundschaft im Straßennetz"
        : got.got < capacity * 0.5
          ? clothesShare(b) < 0.9
            ? "Zu wenig Kleidung in der Stadt – die Kleidungsfabriken liefern zu wenig (fair verteilt)"
            : "Zu wenig Kleidung – Kleidungsfabrik anschließen"
          : null);
  }
  const clothesDemand = residentsOn.size > 0 ? buildings.reduce((sum, b) => sum + residentsOf(b), 0) * CLOTHES_PER_RESIDENT : 0;
  const dressed = clothesDemand > 0 ? Math.min(1, clothesSold / clothesDemand) : 0;

  // Gold: the gold mine's ore is smelted into bars; jewellers make jewellery from them for the
  // residents. Bars nobody uses go into the bank's vault (see below) or are exported.
  const goldMines = mines.filter((b) => b.kind === "goldmine");
  const smelters = buildings.filter((b) => b.kind === "goldsmelter" && connected(b));
  const jewellers = buildings.filter((b) => b.kind === "jeweller" && connected(b));
  for (const b of smelters) {
    const max = SMELTER_CAPACITY * levelFactor(b);
    const capacity = max * work(b);
    const ore = take(b, "goldore", capacity * GOLD_ORE_PER_BAR, goldMines);
    keep(ore.taken, 1);
    const made = ore.got / GOLD_ORE_PER_BAR;
    stock.set(b.id, { gold: made });
    const st = status[b.id];
    st.inputs = { goldore: { need: capacity * GOLD_ORE_PER_BAR, got: ore.got } };
    st.outputs = { gold: { made, max } };
    st.problem =
      st.problem ??
      (ore.got < capacity * GOLD_ORE_PER_BAR * 0.5
        ? goldMines.some((m) => netOf.get(m.id) === netOf.get(b.id))
          ? "Zu wenig Golderz – weiteres Goldbergwerk bauen"
          : "Kein Golderz – Goldbergwerk am Berg bauen und anschließen"
        : null);
  }
  const jewellersOn = new Map<number, number>();
  // Customers split by shop size (a bigger jeweller draws more of them).
  for (const b of jewellers) jewellersOn.set(netOf.get(b.id)!, (jewellersOn.get(netOf.get(b.id)!) ?? 0) + levelFactor(b));
  let jewellerySold = 0;
  const jewellerWant = (b: Building) => {
    const customers = ((residentsOn.get(netOf.get(b.id)!) ?? 0) * JEWELLERY_PER_RESIDENT * levelFactor(b)) / (jewellersOn.get(netOf.get(b.id)!) ?? 1);
    return { customers, capacity: Math.min(JEWELLER_CAPACITY * levelFactor(b) * work(b), customers) };
  };
  const goldShare = fairShare("gold", smelters, jewellers.map((b) => [b, jewellerWant(b).capacity * JEWELLERY_GOLD]));
  for (const b of jewellers) {
    const { customers, capacity } = jewellerWant(b);
    const got = take(b, "gold", capacity * JEWELLERY_GOLD * goldShare(b), smelters);
    keep(got.taken, 1);
    const made = got.got / JEWELLERY_GOLD;
    jewellerySold += made;
    const st = status[b.id];
    st.output = made;
    st.inputs = { gold: { need: capacity * JEWELLERY_GOLD, got: got.got } };
    st.outputs = { jewellery: { made, max: JEWELLER_CAPACITY * levelFactor(b) } };
    st.problem =
      st.problem ??
      (customers < 0.05
        ? "Keine Kundschaft im Straßennetz"
        : made < capacity * 0.5
          ? goldShare(b) < 0.9
            ? "Zu wenig Gold in der Stadt – die Goldschmelzen liefern zu wenig (fair verteilt)"
            : "Kein Gold – Goldschmelze anschließen"
          : null);
  }
  const jewelleryDemand = residentsOn.size > 0 ? buildings.reduce((sum, b) => sum + residentsOf(b), 0) * JEWELLERY_PER_RESIDENT : 0;
  const adorned = jewelleryDemand > 0 ? Math.min(1, jewellerySold / jewelleryDemand) : 0;

  // Food chain: hen houses lay eggs; the import-export company sells cocoa and coffee from
  // its store (filled by the harbour's ships); food factories make food; discounters sell it.
  const chickenFarms = buildings.filter((b) => b.kind === "chickenfarm" && connected(b));
  const traders = buildings.filter((b) => b.kind === "trader" && connected(b));
  const foodFactories = buildings.filter((b) => b.kind === "foodfactory" && connected(b));
  const discounters = buildings.filter((b) => b.kind === "discounter" && connected(b));
  for (const b of chickenFarms) {
    const made = EGGS_CAPACITY * work(b);
    stock.set(b.id, { eggs: made });
    status[b.id].outputs = { eggs: { made, max: EGGS_CAPACITY } };
  }
  // Demand for imported goods per network: every consumer at full capacity.
  const importDemand = new Map<number, Partial<Record<Good, number>>>();
  for (const b of buildings) {
    const net = netOf.get(b.id);
    const inputs = RECIPES[b.kind]?.inputs;
    if (net === null || net === undefined || !inputs || b.kind === "rubberfactory") continue;
    for (const { good } of IMPORT_GOODS) {
      const need = (inputs[good] ?? 0) * levelFactor(b);
      if (need <= 0) continue;
      const d = importDemand.get(net) ?? {};
      d[good] = (d[good] ?? 0) + need;
      importDemand.set(net, d);
    }
  }
  const harbours = buildings.filter((b) => b.kind === "harbour" && connected(b));
  const traderHarbour = new Map<string, Building | null>();
  const importStart = new Map<string, Partial<Record<Good, number>>>();
  for (const t of traders) {
    const h =
      harbours
        .filter((h) => netOf.get(h.id) === netOf.get(t.id) && distance(h, t) <= TRADER_HARBOUR_DISTANCE + 1)
        .sort((a, b) => distance(a, t) - distance(b, t))[0] ?? null;
    traderHarbour.set(t.id, h);
    const have: Partial<Record<Good, number>> = {};
    for (const { good } of IMPORT_GOODS) have[good] = storage[t.id]?.[good] ?? 0;
    importStart.set(t.id, have);
    stock.set(t.id, { ...have });
  }
  for (const b of foodFactories) {
    const st = status[b.id];
    const sources: Partial<Record<Good, Building[]>> = { flour: mills, milk: farms, eggs: chickenFarms, cocoa: traders, coffee: traders };
    const inputs: Partial<Record<Good, { need: number; got: number }>> = {};
    const add = (g: Good, need: number, got: number) => {
      const io = (inputs[g] ??= { need: 0, got: 0 });
      io.need += need;
      io.got += got;
    };
    const made: Partial<Record<Good, number>> = {};
    const outputs: Partial<Record<Good, { made: number; max: number }>> = {};
    const shortOf = new Set<Good>();
    // Every line works on its own: no cocoa stops the sweets, not the pasta.
    for (const line of FOOD_LINES) {
      const max = line.capacity * levelFactor(b);
      const capacity = max * work(b);
      const got = (Object.entries(line.inputs) as [Good, number][]).map(([g, ratio]) => {
        const want = capacity * ratio;
        const r = take(b, g, want, sources[g] ?? []);
        // Grain: flour from the mills first, raw wheat from the farms makes up the rest.
        if (g !== "flour" || r.got >= want - 1e-6) return { g, ratio, want, ...r, flour: r.got };
        const wheat = take(b, "wheat", want - r.got, farms);
        return { g, ratio, want, got: r.got + wheat.got, taken: [...r.taken, ...wheat.taken], flour: r.got };
      });
      const amount = Math.min(capacity, ...got.map((x) => x.got / x.ratio));
      for (const x of got) {
        keep(x.taken, x.got > 0 ? (amount * x.ratio) / x.got : 0);
        add(x.g, x.want, x.got);
        // Wheat makes up for missing flour: shown with its farms, counted in the flour row.
        if (x.got > x.flour + 1e-6) add("wheat", x.got - x.flour, x.got - x.flour);
        if (x.got < x.want * 0.5) shortOf.add(x.g);
      }
      made[line.good] = amount;
      outputs[line.good] = { made: amount, max };
    }
    stock.set(b.id, made);
    st.inputs = inputs;
    st.outputs = outputs;
    const short = (["flour", "eggs", "milk", "cocoa", "coffee"] as Good[]).find((g) => shortOf.has(g));
    const hint: Partial<Record<Good, string>> = {
      flour: "Zu wenig Mehl – keine Nudeln/Süßigkeiten, Mühle anschließen",
      milk: "Zu wenig Milch – Bauernhof anschließen",
      eggs: "Zu wenig Eier – Hühnerhof anschließen",
      cocoa: "Kein Kakao – keine Süßigkeiten, Import-Export-Kontor am Hafen bauen",
      coffee: "Kein Kaffee – Import-Export-Kontor am Hafen bauen",
    };
    // With a company in the network the goods are on their way, not missing.
    const traderHere = traders.some((t) => netOf.get(t.id) === netOf.get(b.id));
    if (traderHere) {
      hint.cocoa = "Zu wenig Kakao – Kontor wartet auf die Schiffslieferung";
      hint.coffee = "Zu wenig Kaffee – Kontor wartet auf die Schiffslieferung";
    }
    st.problem = st.problem ?? (short ? hint[short]! : null);
  }
  // Farms and mills also deliver to the food factories: count that in their output.
  deliveredOutput([...farms, ...mills], flows, status);
  const discountersOn = new Map<number, number>();
  for (const b of discounters) discountersOn.set(netOf.get(b.id)!, (discountersOn.get(netOf.get(b.id)!) ?? 0) + 1);
  let foodSold = 0;
  let importedSold = 0;
  for (const b of discounters) {
    const net = netOf.get(b.id)!;
    const st = status[b.id];
    st.inputs = {};
    st.outputs = {};
    let customers = 0;
    let sold = 0;
    let local = 0;
    let localWanted = 0;
    // Shelf space split by what the residents buy: groceries, pasta, sweets from the food
    // factories, rice and spices straight from the import-export company.
    for (const g of SHELF) {
      const imported = IMPORTED_GROCERIES.includes(g);
      const share = SHELF_DEMAND[g]! / FOOD_PER_RESIDENT;
      const want = ((residentsOn.get(net) ?? 0) * SHELF_DEMAND[g]!) / (discountersOn.get(net) ?? 1);
      const capacity = Math.min(DISCOUNTER_CAPACITY * share * work(b), want);
      const got = take(b, g, capacity, imported ? traders : foodFactories);
      keep(got.taken, 1);
      st.inputs[g] = { need: capacity, got: got.got };
      st.outputs[g] = { made: got.got, max: DISCOUNTER_CAPACITY * share };
      sold += got.got;
      if (imported) {
        importedSold += got.got;
        continue;
      }
      customers += want;
      local += got.got;
      localWanted += capacity;
    }
    foodSold += local;
    st.output = sold;
    st.problem =
      st.problem ??
      (customers < 0.05
        ? "Keine Kundschaft im Straßennetz"
        : local < localWanted * 0.5
          ? "Zu wenig Ware – Lebensmittelfabrik anschließen"
          : null);
  }
  const foodDemand = residentsOn.size > 0 ? buildings.reduce((sum, b) => sum + residentsOf(b), 0) * FOOD_PER_RESIDENT : 0;
  const fed = foodDemand > 0 ? Math.min(1, foodSold / foodDemand) : 0;
  const importedDemand =
    residentsOn.size > 0 ? buildings.reduce((sum, b) => sum + residentsOf(b), 0) * IMPORTED_GROCERIES.reduce((a, g) => a + IMPORTED_GROCERY_DEMAND[g]!, 0) : 0;
  const spiced = importedDemand > 0 ? Math.min(1, importedSold / importedDemand) : 0;
  // What the companies sold leaves their store; nothing is left over to export.
  const importOut: Storage = {};
  const importOrders: Record<string, ImportOrder[]> = {};
  for (const t of traders) {
    const start = importStart.get(t.id)!;
    const left = stock.get(t.id) ?? {};
    const sold: Partial<Record<Good, number>> = {};
    let cost = 0;
    for (const { good } of IMPORT_GOODS) {
      const v = Math.max(0, (start[good] ?? 0) - (left[good] ?? 0));
      if (v > 1e-6) sold[good] = v;
      cost += v * PRICE[good] * IMPORT_COST;
    }
    stock.set(t.id, {});
    importOut[t.id] = sold;
    imports.set(t.id, cost);
    // Order what the network needs, shared out over the store by demand.
    const demandHere = importDemand.get(netOf.get(t.id)!) ?? {};
    const total = IMPORT_GOODS.reduce((a, { good }) => a + (demandHere[good] ?? 0), 0);
    const cap = traderCapacity(t);
    const open: Partial<Record<Good, number>> = {};
    for (const { good } of IMPORT_GOODS) {
      if (!demandHere[good]) continue;
      const room = (cap * demandHere[good]!) / total - (start[good] ?? 0);
      if (room > 1) open[good] = room;
    }
    const h = traderHarbour.get(t.id);
    if (h && Object.keys(open).length > 0) (importOrders[h.id] ??= []).push({ trader: t.id, goods: open });
    const st = status[t.id];
    st.outputs = Object.fromEntries(
      IMPORT_GOODS.filter(({ good }) => demandHere[good]).map(({ good }) => [good, { made: sold[good] ?? 0, max: demandHere[good]! }]),
    );
    st.problem =
      st.problem ??
      (!h
        ? "Kein Binnenhafen in der Nähe im Straßennetz – Ware kann nicht ankommen"
        : harbourWater[h.id]
          ? "Hafen stillgelegt – kein Schiff kann liefern"
          : !(h.id in shipUpkeep)
            ? "Der Hafen hat keine Schiffe – im Hafen ein Schiff kaufen"
            : total <= 0
              ? "Keine Abnehmer – Lebensmittelfabrik oder Discounter im Straßennetz fehlt"
              : IMPORT_GOODS.every(({ good }) => (start[good] ?? 0) < 1)
                ? "Wartet auf das erste Schiff mit der Bestellung"
                : null);
  }

  // Furniture chain: sawmills and steelworks produce, the furniture factory takes boards
  // and steel from the nearest ones, stores sell to the households of their network.
  // Whatever is left over at the end of the minute is exported.
  const industry = buildings.filter((b) => (b.kind === "steelworks" || b.kind === "sawmill") && connected(b));
  const ironMines = mines.filter((b) => b.kind === "ironmine");
  for (const b of industry) {
    const recipe = RECIPES[b.kind]!;
    const made = Object.fromEntries(Object.entries(recipe.outputs).map(([g, max]) => [g, (max ?? 0) * levelFactor(b) * work(b)]));
    if (b.kind === "steelworks") {
      // Steel is smelted from iron ore delivered by the mines.
      const capacity = made.steel;
      const ore = take(b, "ore", capacity * ORE_PER_STEEL, ironMines);
      keep(ore.taken, 1);
      made.steel = ore.got / ORE_PER_STEEL;
      status[b.id].inputs = { ore: { need: capacity * ORE_PER_STEEL, got: ore.got } };
      if (ore.got < capacity * ORE_PER_STEEL * 0.5)
        status[b.id].problem = status[b.id].problem ?? "Zu wenig Eisenerz – Erzbergwerk am Berg bauen";
    }
    stock.set(b.id, { ...made });
    status[b.id].outputs = Object.fromEntries(
      Object.entries(recipe.outputs).map(([g, max]) => [g, { made: made[g], max: (max ?? 0) * levelFactor(b) }]),
    );
  }
  // Recycling yards collect from the households of their network (shared by yard size).
  const recyclers = buildings.filter((b) => b.kind === "recycling" && connected(b));
  const recyclersOn = new Map<number, number>();
  for (const b of recyclers) recyclersOn.set(netOf.get(b.id)!, (recyclersOn.get(netOf.get(b.id)!) ?? 0) + levelFactor(b));
  for (const b of recyclers) {
    const net = netOf.get(b.id)!;
    const max = RECYCLE_CAPACITY * levelFactor(b);
    const supply = ((residentsOn.get(net) ?? 0) * RECYCLE_PER_RESIDENT * levelFactor(b)) / (recyclersOn.get(net) ?? 1);
    const made = Math.min(max * work(b), supply);
    stock.set(b.id, { recycled: made });
    status[b.id].outputs = { recycled: { made, max } };
    if (!status[b.id].problem && supply < max * 0.3) status[b.id].problem = "Wenig Wertstoffe – zu wenige Einwohner im Straßennetz";
  }
  const factories = buildings.filter((b) => b.kind === "furniture" && connected(b));
  const stores = buildings.filter((b) => b.kind === "furniturestore" && connected(b));
  const sawmills = industry.filter((b) => b.kind === "sawmill");
  const steelworks = industry.filter((b) => b.kind === "steelworks");
  for (const b of factories) {
    const capacity = FURNITURE_CAPACITY * levelFactor(b) * work(b);
    const material = FURNITURE_BOARDS + FURNITURE_STEEL;
    // Recycled material first (cheaper), for up to RECYCLED_SHARE of boards and steel alike.
    const recNeed = capacity * material * RECYCLED_SHARE;
    const rec = recyclers.length > 0 ? take(b, "recycled", recNeed, recyclers) : { got: 0, taken: [] as Flow[] };
    const recBoards = (rec.got * FURNITURE_BOARDS) / material;
    const recSteel = (rec.got * FURNITURE_STEEL) / material;
    const boards = take(b, "boards", capacity * FURNITURE_BOARDS - recBoards, sawmills);
    const steel = take(b, "steel", capacity * FURNITURE_STEEL - recSteel, steelworks);
    const made = Math.min(capacity, (boards.got + recBoards) / FURNITURE_BOARDS, (steel.got + recSteel) / FURNITURE_STEEL);
    const recUse = Math.min(rec.got, made * material * RECYCLED_SHARE);
    const boardsUse = Math.max(0, made * FURNITURE_BOARDS - (recUse * FURNITURE_BOARDS) / material);
    const steelUse = Math.max(0, made * FURNITURE_STEEL - (recUse * FURNITURE_STEEL) / material);
    keep(rec.taken, rec.got > 0 ? recUse / rec.got : 0);
    keep(boards.taken, boards.got > 0 ? Math.min(1, boardsUse / boards.got) : 0);
    keep(steel.taken, steel.got > 0 ? Math.min(1, steelUse / steel.got) : 0);
    stock.set(b.id, { furniture: made });
    const st = status[b.id];
    st.inputs = {
      boards: { need: capacity * FURNITURE_BOARDS - recBoards, got: boards.got },
      steel: { need: capacity * FURNITURE_STEEL - recSteel, got: steel.got },
      // Only with a recycling yard in town: otherwise boards and steel cover everything.
      ...(recyclers.length > 0 ? { recycled: { need: recNeed, got: rec.got } } : {}),
    };
    st.outputs = { furniture: { made, max: FURNITURE_CAPACITY * levelFactor(b) } };
    st.problem =
      st.problem ??
      (boards.got + recBoards < capacity * FURNITURE_BOARDS * 0.5
        ? "Zu wenig Bretter – Holzfabrik anschließen"
        : steel.got + recSteel < capacity * FURNITURE_STEEL * 0.5
          ? "Zu wenig Stahl – Stahlwerk anschließen"
          : null);
  }
  const householdsOn = new Map<number, number>();
  for (const b of buildings) {
    const net = netOf.get(b.id);
    if (net !== null && net !== undefined && householdsOf(b) > 0) householdsOn.set(net, (householdsOn.get(net) ?? 0) + householdsOf(b));
  }
  // Customers split between the stores of a network by size (level).
  const storeFactor = (b: Building) => STORE_LEVEL_FACTOR[b.level] ?? 1;
  const storesOn = new Map<number, number>();
  for (const b of stores) storesOn.set(netOf.get(b.id)!, (storesOn.get(netOf.get(b.id)!) ?? 0) + storeFactor(b));
  let furnitureSold = 0;
  const storeWant = (b: Building) => {
    const customers = ((householdsOn.get(netOf.get(b.id)!) ?? 0) * FURNITURE_PER_HOUSEHOLD * storeFactor(b)) / (storesOn.get(netOf.get(b.id)!) ?? 1);
    return { customers, capacity: Math.min(STORE_CAPACITY * storeFactor(b) * work(b), customers) };
  };
  const furnitureShare = fairShare("furniture", factories, stores.map((b) => [b, storeWant(b).capacity]));
  for (const b of stores) {
    const { customers, capacity } = storeWant(b);
    const got = take(b, "furniture", capacity * furnitureShare(b), factories);
    keep(got.taken, 1);
    furnitureSold += got.got;
    const st = status[b.id];
    st.output = got.got;
    st.inputs = { furniture: { need: capacity, got: got.got } };
    st.outputs = { furniture: { made: got.got, max: STORE_CAPACITY * storeFactor(b) } };
    st.problem =
      st.problem ??
      (customers < 0.05
        ? "Keine Haushalte im Straßennetz"
        : got.got < capacity * 0.5
          ? furnitureShare(b) < 0.9
            ? "Zu wenig Möbel in der Stadt – die Möbelfabriken liefern zu wenig (fair verteilt)"
            : "Zu wenig Möbel – Möbelfabrik anschließen"
          : null);
  }
  const households = buildings.reduce((s, b) => s + householdsOf(b), 0);
  const furnitureDemand = households * FURNITURE_PER_HOUSEHOLD;
  const furnished = furnitureDemand > 0 ? Math.min(1, furnitureSold / furnitureDemand) : 1;

  // Schools: coverage of residents.
  const schoolSeats = buildings.filter((b) => b.kind === "school" && status[b.id].connected).reduce((sum, b) => sum + SCHOOL_CAPACITY * levelFactor(b), 0);
  const education = residents > 0 ? Math.min(1, schoolSeats / residents) : 1;
  for (const b of buildings) if (b.kind === "school") status[b.id].output = Math.min(SCHOOL_CAPACITY * levelFactor(b), residents);

  // Leisure: restaurants (cook with meat and milk) and cinemas serve the residents of their
  // network. Going out makes families: it raises the birth rate.
  // Pizzerias share the guests with the restaurants but bake with flour instead of meat.
  const restaurants = buildings.filter((b) => (b.kind === "restaurant" || b.kind === "pizzeria") && connected(b));
  const countOn = (list: Building[]) => {
    const m = new Map<number, number>();
    for (const b of list) m.set(netOf.get(b.id)!, (m.get(netOf.get(b.id)!) ?? 0) + 1);
    return m;
  };
  const restaurantsOn = countOn(restaurants);
  let mealsServed = 0;
  for (const b of restaurants) {
    const net = netOf.get(b.id)!;
    const guests = ((residentsOn.get(net) ?? 0) * MEALS_PER_RESIDENT) / (restaurantsOn.get(net) ?? 1);
    const capacity = Math.min(RESTAURANT_CAPACITY * work(b), guests);
    const pizza = b.kind === "pizzeria";
    const [main, perMeal] = pizza ? (["flour", PIZZA_FLOUR] as const) : (["meat", MEAL_MEAT] as const);
    const mainIn = take(b, main, capacity * perMeal, pizza ? mills : slaughterhouses);
    const milkIn = take(b, "milk", capacity * MEAL_MILK, farms);
    const meals = Math.min(capacity, mainIn.got / perMeal, milkIn.got / MEAL_MILK);
    keep(mainIn.taken, mainIn.got > 0 ? (meals * perMeal) / mainIn.got : 0);
    keep(milkIn.taken, milkIn.got > 0 ? (meals * MEAL_MILK) / milkIn.got : 0);
    mealsServed += meals;
    const st = status[b.id];
    st.output = meals;
    st.inputs = { [main]: { need: capacity * perMeal, got: mainIn.got }, milk: { need: capacity * MEAL_MILK, got: milkIn.got } };
    st.outputs = { meal: { made: meals, max: RESTAURANT_CAPACITY } };
    st.problem =
      st.problem ??
      (guests < 0.05
        ? "Keine Gäste im Straßennetz"
        : mainIn.got < capacity * perMeal * 0.5
          ? pizza
            ? "Zu wenig Mehl – Mühle anschließen"
            : "Zu wenig Fleisch – Schlachthof anschließen"
          : milkIn.got < capacity * MEAL_MILK * 0.5
            ? "Zu wenig Milch – Bauernhof anschließen"
            : null);
  }
  const visits: Partial<Record<Good, number>> = {};
  for (const [kind, spec] of Object.entries(ATTRACTIONS) as [BuildingKind, NonNullable<(typeof ATTRACTIONS)[BuildingKind]>][]) {
    const list = buildings.filter((b) => b.kind === kind && connected(b));
    const on = countOn(list);
    for (const b of list) {
      const net = netOf.get(b.id)!;
      const visitors = ((residentsOn.get(net) ?? 0) * spec.perResident) / (on.get(net) ?? 1);
      const sold = Math.min(spec.capacity * work(b), visitors);
      visits[spec.good] = (visits[spec.good] ?? 0) + sold;
      const st = status[b.id];
      st.output = sold;
      st.outputs = { [spec.good]: { made: sold, max: spec.capacity } };
      st.problem = st.problem ?? (visitors < 0.05 ? "Keine Besucher im Straßennetz" : null);
    }
  }
  const share = (good: Good, kind: BuildingKind) =>
    residents > 0 ? Math.min(1, (visits[good] ?? 0) / (residents * ATTRACTIONS[kind]!.perResident)) : 0;
  const ticketsSold = visits.ticket ?? 0;
  const mealShare = residents > 0 ? Math.min(1, mealsServed / (residents * MEALS_PER_RESIDENT)) : 0;
  const ticketShare = share("ticket", "cinema");
  // Pool and fair come on top of going out to eat and to the cinema.
  // Parks and playgrounds: share of residents living within reach of one (on foot, no street).
  const recreation: Record<string, number> = {};
  const reachShare = (kind: BuildingKind, radius = RECREATION_RADIUS[kind]!, onlyConnected = false) => {
    const spots = buildings.filter((b) => b.kind === kind && (!onlyConnected || status[b.id].connected));
    for (const b of buildings) if (b.kind === kind) recreation[b.id] = 0;
    if (spots.length === 0 || residents <= 0) return 0;
    let covered = 0;
    for (const h of buildings) {
      const r = residentsOf(h);
      if (r <= 0) continue;
      let first = true;
      for (const s of spots) {
        if (Math.hypot(s.x - h.x, s.z - h.z) > radius[s.level]) continue;
        recreation[s.id] += r;
        if (first) covered += r;
        first = false;
      }
    }
    return covered / residents;
  };
  const green = reachShare("park");
  const play = reachShare("playground");
  // Police and fire stations only count with a street (their vehicles need one).
  const safety = reachShare("police", SERVICE_RADIUS.police, true);
  const fireCover = reachShare("firestation", SERVICE_RADIUS.firestation, true);
  const leisure = Math.min(
    1,
    (mealShare + ticketShare) / 2 + 0.25 * share("swim", "pool") + 0.25 * share("ride", "fair") + 0.1 * share("game", "casino") + 0.15 * green + 0.1 * play,
  );

  // Business accounts: every private building with jobs buys its inputs, sells to other
  // businesses (wholesale), to residents (shops) or sells off what is left, pays wages,
  // running costs and water, and pays business tax on its profit.
  const RETAIL_OF: Partial<Record<BuildingKind, Good>> = {
    bakery: "bread",
    butcher: "meat",
    furniturestore: "furniture",
    restaurant: "meal",
    pizzeria: "meal",
    cinema: "ticket",
    pool: "swim",
    fair: "ride",
    casino: "game",
    newspaper: "news",
    shoeshop: "shoes",
    fashion: "clothes",
    discounter: "food",
    jeweller: "jewellery",
  };
  const finances: Record<string, Finance> = {};
  // Sales and purchases per business in one pass over the flows (was a scan of all flows per business).
  const soldBy = new Map<string, number>();
  const boughtBy = new Map<string, number>();
  for (const f of flows) {
    const v = f.amount * PRICE[f.good];
    soldBy.set(f.from, (soldBy.get(f.from) ?? 0) + v);
    boughtBy.set(f.to, (boughtBy.get(f.to) ?? 0) + v);
  }
  for (const b of buildings) {
    if (PUBLIC.includes(b.kind) || b.kind === "house" || b.kind === "ruin" || !status[b.id].connected) continue;
    const st = status[b.id];
    const sales = soldBy.get(b.id) ?? 0;
    const purchases = (boughtBy.get(b.id) ?? 0) + (imports.get(b.id) ?? 0);
    const good = RETAIL_OF[b.kind];
    const retail = good
      ? (b.kind === "discounter" ? SHELF : [good]).reduce((sum, g) => sum + (st.outputs?.[g]?.made ?? 0) * (RETAIL_PRICE[g] ?? 0), 0)
      : 0;
    const left = stock.get(b.id) ?? {};
    const exported = good ? 0 : (Object.keys(left) as Good[]).reduce((sum, g) => sum + (left[g] ?? 0) * PRICE[g] * EXPORT_FACTOR[g], 0);
    const wages = jobsOf(b) * (st.staffing ?? 1) * WAGE;
    const water = waterOf(b) * st.water * WATER_FEE;
    const power = powerOf(b) * (st.power ?? 0) * POWER_FEE;
    const upkeepB = upkeepOf(b);
    const profit = sales + retail + exported - purchases - wages - upkeepB - water - power;
    const tax = Math.max(0, profit) * businessTaxRate;
    finances[b.id] = { sales, retail, export: exported, purchases, wages, upkeep: upkeepB, water, power, profit: profit - tax, tax };
    st.finance = finances[b.id];
    if (!st.problem && profit < 0) st.problem = "Macht Verlust – zu wenig Absatz oder Waren";
  }
  // Industry output shown as what it earns in total.
  for (const b of [...industry, ...factories, ...recyclers, ...mines, ...tanneries, ...rubberFactories, ...shoeFactories, ...sheepFarms, ...spinningMills, ...clothingFactories, ...chickenFarms, ...foodFactories, ...traders, ...smelters]) {
    if (b.kind !== "powerplant") status[b.id].output = finances[b.id]?.sales + finances[b.id]?.export || 0;
  }
  // Warehouses buy what the businesses have left over (paid at the export price the
  // businesses would get anyway, so their accounts stay the same) until they are full.
  const warehouses = buildings.filter((b) => b.kind === "warehouse" && status[b.id].connected);
  const storageIn: Storage = {};
  let storageCost = 0;
  if (warehouses.length > 0) {
    const free = new Map(warehouses.map((w) => [w.id, Math.max(0, warehouseCapacity(w) - storedTotal(storage[w.id]))]));
    const byId = new Map(buildings.map((b) => [b.id, b]));
    for (const [id, left] of stock) {
      const producer = byId.get(id);
      if (!producer || RETAIL_OF[producer.kind] || PUBLIC.includes(producer.kind)) continue;
      const near = warehouses.filter((w) => netOf.get(w.id) === netOf.get(id)).sort((a, b) => distance(a, producer) - distance(b, producer));
      for (const g of STORABLE) {
        let amount = left[g] ?? 0;
        for (const w of near) {
          if (amount < 1e-6) break;
          const put = Math.min(amount, free.get(w.id)!);
          if (put < 1e-6) continue;
          free.set(w.id, free.get(w.id)! - put);
          amount -= put;
          const into = (storageIn[w.id] ??= {});
          into[g] = (into[g] ?? 0) + put;
          storageCost += put * PRICE[g] * EXPORT_FACTOR[g];
          flows.push({ from: id, to: w.id, good: g, amount: put });
        }
      }
    }
    for (const w of warehouses) {
      const st = status[w.id];
      st.output = storedTotal(storageIn[w.id]);
      if (!st.problem && free.get(w.id)! < 1) st.problem = "Lager voll – Hafen mit Schiffen baut den Bestand ab, oder ausbauen";
    }
  }

  // Airports: residents fly on holiday (the town earns the charges); from the regional
  // airport on, cargo planes take the most valuable goods from the warehouses on their network.
  const airports = buildings.filter((b) => b.kind === "airport" && status[b.id].connected);
  const airOut: Storage = {};
  let airportIncome = 0;
  const holidayDemand = residents * HOLIDAY_PER_RESIDENT;
  const seats = airports.reduce((sum, a) => sum + airportPassengers(a) * work(a), 0);
  const travellers = Math.min(holidayDemand, seats);
  const holiday = airports.length > 0 && holidayDemand > 0.01 ? travellers / holidayDemand : 0;
  const airStock: Storage = {};
  for (const a of airports) {
    const st = status[a.id];
    const capacity = airportPassengers(a) * work(a);
    const passengers = seats > 0 ? (travellers * capacity) / seats : 0;
    const cargo: Partial<Record<Good, number>> = {};
    let room = airCargoCapacity(a) * work(a);
    let freight = 0;
    const sources = buildings.filter((w) => w.kind === "warehouse" && netOf.get(w.id) === netOf.get(a.id));
    for (const g of [...STORABLE].sort((x, y) => PRICE[y] - PRICE[x])) {
      for (const w of sources) {
        if (room < 1e-6) break;
        const left = (airStock[w.id] ??= { ...storage[w.id] });
        const v = Math.min(left[g] ?? 0, room);
        if (v < 1e-6) continue;
        left[g] = (left[g] ?? 0) - v;
        room -= v;
        cargo[g] = (cargo[g] ?? 0) + v;
        const out = (airOut[w.id] ??= {});
        out[g] = (out[g] ?? 0) + v;
        freight += v * PRICE[g] * AIR_PRICE_FACTOR;
      }
    }
    const fares = passengers * FARE;
    airportIncome += fares + freight;
    st.airport = { passengers, capacity, cargo, cargoCapacity: airCargoCapacity(a) * work(a), fares, freight };
    st.output = passengers;
    if (!st.problem && a.level >= 2 && sources.length === 0) st.problem = "Keine Lagerhalle im Straßennetz – Frachtflieger bleiben leer";
  }

  const businessTax = Object.values(finances).reduce((sum, f) => sum + f.tax, 0);
  const businessProfit = Object.values(finances).reduce((sum, f) => sum + f.profit, 0);

  // The town: income tax on wages, property tax per household, water fees, business tax.
  const employed = Math.min(workers, jobs);
  const incomeTax = employed * WAGE * taxRate;
  let propertyTax = 0;
  let waterFees = 0;
  let powerFees = 0;
  for (const b of buildings) {
    powerFees += powerOf(b) * (status[b.id].power ?? 0) * POWER_FEE;
    if (!status[b.id].connected) continue;
    waterFees += waterOf(b) * status[b.id].water * WATER_FEE;
    if (b.kind !== "house") continue;
    const property = householdsOf(b) * PROPERTY_TAX * status[b.id].water;
    propertyTax += property;
    status[b.id].pays =
      property +
      waterOf(b) * status[b.id].water * WATER_FEE +
      powerOf(b) * (status[b.id].power ?? 0) * POWER_FEE +
      residentsOf(b) * WORKER_SHARE * employment * WAGE * taxRate;
  }
  const services: Partial<Record<BuildingKind, number>> = {};
  // Shut-down municipal buildings (no street yet) cost nothing; stations and transformers run on cables.
  for (const b of buildings)
    if (PUBLIC.includes(b.kind) && (status[b.id].connected || ROADLESS_KINDS.includes(b.kind) || b.kind === "powerplant"))
      services[b.kind] = (services[b.kind] ?? 0) + upkeepOf(b);
  for (const b of buildings) if (b.kind === "harbour") services.harbour = (services.harbour ?? 0) + (shipUpkeep[b.id] ?? 0);
  // The municipal power stations buy their fuel from the mines.
  for (const p of plants) {
    const fuel = flows.filter((f) => f.to === p.id).reduce((sum, f) => sum + f.amount * PRICE[f.good], 0);
    if (fuel > 0) services.powerplant = (services.powerplant ?? 0) + fuel;
  }
  // The bank buys the smelters' leftover bars into the town's vault (at the wholesale price
  // they would get for export anyway). Needs a bank in the same road network.
  const banks = buildings.filter((b) => b.kind === "bank" && status[b.id].connected);
  let goldIn = 0;
  for (const b of smelters) {
    const left = stock.get(b.id)?.gold ?? 0;
    if (left < 1e-6 || !banks.some((k) => netOf.get(k.id) === netOf.get(b.id))) continue;
    goldIn += left;
    status[b.id].vault = left;
  }
  const goldCost = goldIn * PRICE.gold * EXPORT_FACTOR.gold;
  const upkeep = Object.values(services).reduce((sum, v) => sum + (v ?? 0), 0) + storageCost + goldCost;
  // Prisons work with the police of their road network: inmates come from the residents there.
  const policeNets = new Set(buildings.filter((b) => b.kind === "police" && status[b.id].connected).map((b) => netOf.get(b.id)));
  let places = 0;
  for (const b of buildings) if (b.kind === "prison" && status[b.id].connected && policeNets.has(netOf.get(b.id))) places += PRISON_PLACES * levelFactor(b);
  const inmates = Math.min(places, residents * INMATES_PER_RESIDENT);
  const prisonBonus = places > 0 ? PRISON_POLICE_BONUS : 0;
  const justiceIncome = inmates * PRISON_REFUND;
  const emergencyIncome = residents * (safety * POLICE_FINES * (1 + prisonBonus) + fireCover * FIRE_LEVY);
  const income = incomeTax + businessTax + propertyTax + waterFees + powerFees + airportIncome + emergencyIncome + justiceIncome;
  const budget: Budget = { incomeTax, businessTax, propertyTax, waterFees, powerFees, services, storage: storageCost, gold: goldCost, airport: airportIncome, emergency: emergencyIncome, justice: justiceIncome };
  const powered = powerDemand > 0 ? Math.min(1, powerSupplied / powerDemand) : 1;

  // Growth: births need a hospital on the residents' network; immigration needs water,
  // bread, jobs and schools, and is put off by high taxes.
  const hospitalNets = new Set(
    buildings.filter((b) => b.kind === "hospital" && status[b.id].connected && status[b.id].water > 0.9).map((b) => netOf.get(b.id)),
  );
  let mainNet: number | null = null;
  let mainResidents = -1;
  for (const [net, n] of residentsOn) {
    if (n > mainResidents) {
      mainResidents = n;
      mainNet = net;
    }
  }
  const hospital = mainNet !== null && hospitalNets.has(mainNet);
  const breadDemand = residents * BREAD_PER_RESIDENT;
  const waterOk = waterCapacityTotal(cap) >= waterDemandTotal(demand);
  const breadOk = breadDemand === 0 || breadSold >= breadDemand * UPGRADE_NEEDS.bread;
  const taxFactor = taxAttraction(taxRate, businessTaxRate);
  const jobFactor = 0.25 + 0.75 * employment;
  const schoolFactor = 0.6 + 0.4 * education;
  // Homes that can be furnished make the town more attractive.
  const homeFactor = 0.85 + 0.3 * furnished;
  // So does a butcher's shop: meat on the table.
  const meatShare = meatDemand > 0 ? Math.min(1, meatSold / meatDemand) : 1;
  const foodFactor = 0.9 + 0.2 * meatShare;
  const births = hospital ? Math.max(0, mainResidents) * BIRTH_RATE * (1 + LEISURE_BIRTH_BONUS * leisure) : 0;
  // Electric light and appliances: towns with power attract more people.
  const powerFactorTown = 0.85 + 0.25 * powered;
  const immigration = waterOk
    ? IMMIGRATION * (breadOk ? 1 : 0.35) * taxFactor * jobFactor * schoolFactor * homeFactor * foodFactor * (0.9 + 0.2 * leisure) * (0.95 + 0.1 * shod) * (0.95 + 0.1 * dressed) * (0.95 + 0.1 * fed) * (0.97 + 0.06 * spiced) * (0.98 + 0.04 * adorned) * (0.97 + 0.06 * green) * (0.98 + 0.04 * play) * (1 + 0.1 * holiday) * (0.96 + 0.08 * safety) * (0.97 + 0.06 * fireCover) * powerFactorTown * 2
    : 0;
  // What keeps houses from growing past level 2, with the numbers (all of it, not just the first).
  const pctOf = (v: number) => `${Math.floor(v * 1000) / 10} %`.replace(".", ",");
  const breadShare = breadDemand > 0 ? breadSold / breadDemand : 1;
  const houseBlockers = [
    !breadOk && `Brot ${pctOf(breadShare)} von ${UPGRADE_NEEDS.bread * 100} %`,
    education < UPGRADE_NEEDS.education && `Schulplätze ${pctOf(education)} von ${UPGRADE_NEEDS.education * 100} %`,
    furnished < UPGRADE_NEEDS.furnished && `Möbel ${pctOf(furnished)} von ${UPGRADE_NEEDS.furnished * 100} %`,
    employment <= UPGRADE_NEEDS.employment && `Beschäftigung ${pctOf(employment)} von ${UPGRADE_NEEDS.employment * 100} %`,
  ].filter((x): x is string => !!x);
  const growthLimit = !waterOk
    ? "Zu wenig Wasser – die Stadt wächst nicht"
    : !hospital
      ? "Kein Krankenhaus – keine Geburten"
      : employment < 0.7
        ? "Zu wenige Arbeitsplätze – Betriebe oder Industrie bauen"
        : houseBlockers.length > 0
          ? `Nur kleine Häuser wachsen – es fehlen: ${houseBlockers.join(", ")}`
          : taxRate > 0.15 || businessTaxRate > 0.25
            ? "Hohe Steuern schrecken Zuzügler ab"
            : powered < 0.6
                  ? "Zu wenig Strom – keine Mehrfamilienhäuser (Kraftwerk, Kabel, Trafostationen)"
                  : leisure < 0.4
                  ? "Wenig Freizeit – Kino und Restaurant bringen mehr Geburten"
                  : null;

  const sum = (m: Map<number, number>) => [...m.values()].reduce((a, v) => a + v, 0);
  return {
    births,
    immigration,
    hospital,
    growthLimit,
    residents,
    breadDemand,
    breadSold,
    shod,
    shoesSold,
    dressed,
    clothesSold,
    fed,
    spiced,
    adorned,
    goldIn,
    foodSold,
    airport: airports.length > 0,
    holiday,
    airOut,
    meatDemand,
    meatSold,
    leisure,
    green,
    play,
    recreation,
    safety: Math.min(1, safety * (1 + prisonBonus)),
    fireCover,
    prison: { places, inmates },
    mealsServed,
    ticketsSold,
    furnitureDemand,
    furnitureSold,
    furnished,
    wheat: totalOf("wheat"),
    flour: totalOf("flour"),
    milk: totalOf("milk"),
    flows,
    hospitalCapacity: buildings.filter((b) => b.kind === "hospital" && status[b.id].connected).length * HOSPITAL_CAPACITY,
    schoolSeats,
    powerCapacity,
    powerDemand,
    powerSupplied,
    powered,
    households,
    workers,
    jobs,
    employment,
    unemployed: labour.unemployed,
    jobcentres: labour.centres,
    education,
    taxRate,
    waterCapacity: sum(cap),
    waterDemand: sum(demand),
    income,
    upkeep,
    balance: income - upkeep,
    businessTaxRate,
    budget,
    businessProfit,
    status,
    storageIn,
    importOut,
    importOrders,
    networkOf: Object.fromEntries(netOf),
    roadNetworkOf: Object.fromEntries(networks),
  };
}

/** Corners of a building footprint in world space. */
export function footprintCorners(b: { x: number; z: number; rot: number; kind: BuildingKind; level?: number }, margin = 0): Vec2[] {
  const [w, d] = sizeOf(b);
  const hw = w / 2 + margin;
  const hd = d / 2 + margin;
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([lx, lz]) => ({ x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c }));
}

/** True if (x, z) lies inside the building footprint (plus margin). */
export function insideFootprint(b: { x: number; z: number; rot: number; kind: BuildingKind; level?: number }, x: number, z: number, margin = 0) {
  const [w, d] = sizeOf(b);
  const dx = x - b.x;
  const dz = z - b.z;
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= w / 2 + margin && Math.abs(lz) <= d / 2 + margin;
}

/** Distance from a polyline to a building footprint (0 if it passes through). */
export function polylineDistanceToFootprint(b: Building, points: Vec2[]) {
  if (points.some((p) => insideFootprint(b, p.x, p.z))) return 0;
  const corners = footprintCorners(b);
  let best = Math.min(...corners.map((c) => polylineDistance(c, points)));
  // Polyline vertices to the footprint edges.
  const ring = [...corners, corners[0]];
  for (const p of points) best = Math.min(best, polylineDistance(p, ring));
  return best;
}
