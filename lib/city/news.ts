import { BUILDINGS, levelName, PUBLIC, type Building, type BuildingKind, type EconomyStats } from "./economy";
import { goldPrice } from "./gold";
import type { Incident } from "./incidents";
import { fairSalary, type MayorState } from "./mayor";
import { mulberry32 } from "./random";
import { moodFactors, moodOf } from "./wellbeing";

/**
 * The town's newspaper, the "Citypower Rundschau" (Nutzerwunsch): the store notes what happens
 * (`collectNews` compares the state with the last tick: buildings, incidents, the mayor, the
 * population) and, while a connected newspaper building stands, prints one edition per game
 * day from the previous day's events (`makeEdition`) – a headline, articles, fixed sections on
 * the economy and the mood, investigative pieces when the mayor is under suspicion, and ads
 * of the town's businesses. Pure text from templates, varied deterministically per day.
 */

export const PAPER_NAME = "Citypower Rundschau";
const DAY = 1440;

export type NewsKind =
  | "built"
  | "upgraded"
  | "demolished"
  | "accident"
  | "fire"
  | "ruin"
  | "rescued"
  | "scandal"
  | "jail"
  | "released"
  | "repay"
  | "milestone"
  | "salary";

export interface NewsEvent {
  t: number;
  kind: NewsKind;
  /** Building kind and its name at the time, an amount (€, residents, salary). */
  building?: BuildingKind;
  name?: string;
  amount?: number;
  /** Incident with injured people. */
  injured?: boolean;
}

export interface Article {
  section: string;
  title: string;
  text: string;
}

export interface Edition {
  /** Game day of the edition as the HUD shows it (1-based). */
  day: number;
  /** Game minute it was printed; the next edition reports on what happened after it. */
  printedAt: number;
  headline: Article;
  articles: Article[];
  ads: { title: string; text: string }[];
}

/** What the last tick looked like (not saved: after loading the first tick only takes a picture). */
export interface NewsSnapshot {
  buildings: Map<string, { kind: BuildingKind; level: number; name: string }>;
  incidents: Map<string, Incident>;
  scandal: boolean;
  jail: boolean;
  goodwill: number;
  account: number;
  salary: number;
  residents: number;
}

export function newsSnapshot(buildings: Building[], incidents: Incident[], mayor: MayorState, residents: number, now: number): NewsSnapshot {
  return {
    buildings: new Map(buildings.filter((b) => b.kind !== "house").map((b) => [b.id, { kind: b.kind, level: b.level, name: levelName(b) }])),
    incidents: new Map(incidents.map((i) => [i.id, i])),
    scandal: mayor.scandalUntil > now,
    jail: mayor.jailUntil > now,
    goodwill: mayor.goodwill ?? 0,
    account: mayor.account,
    salary: mayor.salary,
    residents,
  };
}

const MILESTONES = [250, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];

/** Events between two snapshots. */
export function collectNews(prev: NewsSnapshot, next: NewsSnapshot, now: number): NewsEvent[] {
  const out: NewsEvent[] = [];
  for (const [id, b] of next.buildings) {
    const old = prev.buildings.get(id);
    if (!old) {
      // A house that burnt down is a ruin now: reported with the fire, not as a new building.
      if (b.kind === "ruin") out.push({ t: now, kind: "ruin", building: b.kind, name: b.name });
      else out.push({ t: now, kind: "built", building: b.kind, name: b.name });
    } else if (b.level > old.level) out.push({ t: now, kind: "upgraded", building: b.kind, name: b.name });
  }
  for (const [id, b] of prev.buildings) {
    if (!next.buildings.has(id) && b.kind !== "ruin") out.push({ t: now, kind: "demolished", building: b.kind, name: b.name });
  }
  for (const [id, i] of next.incidents) if (!prev.incidents.has(id)) out.push({ t: now, kind: i.kind === "fire" ? "fire" : "accident", injured: i.injured });
  for (const [id, i] of prev.incidents) {
    if (next.incidents.has(id)) continue;
    // Gone with help on site: rescued. (A fire nobody fought shows up as a ruin.)
    if (i.station) out.push({ t: now, kind: "rescued", building: i.kind === "fire" ? "firestation" : "police", injured: i.injured });
  }
  if (next.jail && !prev.jail) out.push({ t: now, kind: "jail", amount: prev.account });
  else if (next.scandal && !prev.scandal) out.push({ t: now, kind: "scandal" });
  if (!next.jail && prev.jail) out.push({ t: now, kind: "released" });
  if (next.goodwill > prev.goodwill + 0.001 && next.account < prev.account) out.push({ t: now, kind: "repay", amount: prev.account - next.account });
  if (next.salary > prev.salary && next.salary > fairSalary(next.residents)) out.push({ t: now, kind: "salary", amount: next.salary });
  for (const m of MILESTONES) if (prev.residents < m && next.residents >= m && prev.residents > 0) out.push({ t: now, kind: "milestone", amount: m });
  return out;
}

/* ---------- writing an edition ---------- */

const euro = (v: number) => `${Math.round(v).toLocaleString("de-DE")} €`;
const pick = <T,>(rnd: () => number, list: T[]) => list[Math.floor(rnd() * list.length)];

/** Big new buildings make the front page; small ones end up in the local news. */
const BIG: BuildingKind[] = ["airport", "casino", "villa", "boathouse", "townhall", "bank", "exchange", "hospital", "powerplant", "prison", "trainstation", "newspaper", "harbour", "fair", "pool"];

function score(e: NewsEvent): number {
  switch (e.kind) {
    case "jail":
      return 100;
    case "scandal":
      return 90;
    case "ruin":
      return 70;
    case "released":
      return 65;
    case "repay":
      return 60;
    case "milestone":
      return 58;
    case "built":
      return e.building === "villa" || e.building === "boathouse" ? 62 : BIG.includes(e.building!) ? 50 : 20;
    case "fire":
      return 45;
    case "salary":
      return 44;
    case "accident":
      return e.injured ? 40 : 30;
    case "rescued":
      return 35;
    case "upgraded":
      return e.building === "villa" || e.building === "boathouse" ? 48 : 15;
    case "demolished":
      return 10;
  }
}

interface Context {
  economy: EconomyStats | null;
  mayor: MayorState;
  buildings: Building[];
  money: number;
  now: number;
}

function write(e: NewsEvent, rnd: () => number, ctx: Context): Article {
  const name = e.name ?? (e.building ? BUILDINGS[e.building].label : "");
  const suspicious = ctx.mayor.suspicion > 35;
  switch (e.kind) {
    case "jail":
      return {
        section: "Titel",
        title: pick(rnd, ["Bürgermeister in Handschellen abgeführt!", "Verhaftet: Das Ende einer Amtszeit?", "Staatsanwalt schlägt zu – Bürgermeister in U-Haft"]),
        text: `Am Morgen klickten die Handschellen: Nach einem zweiten Korruptionsskandal hat die Staatsanwaltschaft den Bürgermeister festgenommen. Beschlagnahmt wurden ${euro(e.amount ?? 0)} vom Privatkonto, die Anwesen des Bürgermeisters gehen an den Staat. Im Rathaus herrscht Fassungslosigkeit – die Bürger fragen sich, wem sie noch trauen können.`,
      };
    case "scandal":
      return {
        section: "Titel",
        title: pick(rnd, ["Korruptionsskandal erschüttert das Rathaus", "Schmiergeld-Affäre: Ermittler im Rathaus", "Bürgermeister unter Verdacht – Konten eingefroren"]),
        text: "Ermittler durchsuchten das Rathaus und beschlagnahmten Teile des Privatvermögens des Bürgermeisters. Es geht um Bestechung, verschobene Aufträge und Geld aus der Stadtkasse. Die Bürger sind empört, Zuzügler bleiben weg. Ein weiterer Fehltritt, so heißt es aus Justizkreisen, würde das Gefängnis bedeuten.",
      };
    case "released":
      return { section: "Titel", title: "Ex-Häftling zurück im Rathaus", text: "Der Bürgermeister ist aus der Haft entlassen. Er gibt sich geläutert – das Privatkonto ist leer, die Villa weg. Ob die Bürger ihm eine zweite Chance geben?" };
    case "repay":
      return {
        section: "Rathaus",
        title: pick(rnd, ["Großzügige Geste: Bürgermeister spendet der Stadt", "Bürgermeister überweist Millionen – Reue oder Taktik?", "Geld zurück in die Stadtkasse"]),
        text: `${euro(e.amount ?? 0)} hat der Bürgermeister aus eigener Tasche an die Stadt überwiesen. ${ctx.mayor.scandalUntil > ctx.now ? "Mitten im Skandal – Kritiker sprechen von Schadensbegrenzung." : "Die Bürger zeigen sich beeindruckt, das Ansehen steigt."}`,
      };
    case "milestone":
      return {
        section: "Titel",
        title: `${(e.amount ?? 0).toLocaleString("de-DE")} Einwohner – die Stadt wächst und wächst`,
        text: `Rekord: Erstmals leben ${(e.amount ?? 0).toLocaleString("de-DE")} Menschen in der Stadt. Neue Häuser, neue Arbeitsplätze, neue Nachbarn – der Bürgermeister spricht von einer Erfolgsgeschichte.`,
      };
    case "salary":
      return {
        section: "Rathaus",
        title: "Bürgermeister erhöht sich das Gehalt",
        text: `Still und leise hat sich der Bürgermeister sein Gehalt auf ${euro(e.amount ?? 0)} pro Minute angehoben – deutlich mehr, als für eine Stadt dieser Größe üblich. Die Opposition spricht von Selbstbedienung.`,
      };
    case "built":
      if (e.building === "villa")
        return {
          section: "Gesellschaft",
          title: suspicious ? "Luxusvilla für den Bürgermeister – woher kommt das Geld?" : "Der Bürgermeister baut sich eine Villa",
          text: `Pool, Rosengarten, Garage mit Sportwagen: Der Bürgermeister hat sich eine prächtige Villa gegönnt.${suspicious ? " Bei einem Bürgermeistergehalt eine erstaunliche Summe – die Redaktion bleibt dran." : " Bezahlt, so versichert das Rathaus, aus eigener Tasche."}`,
        };
      if (e.building === "boathouse")
        return {
          section: "Gesellschaft",
          title: "Mit dem Sportboot über den See: Bürgermeister hat jetzt ein Bootshaus",
          text: `Am Ufer steht das neue Bootshaus des Bürgermeisters, samt Steg und schnittigem Sportboot.${suspicious ? " Spaziergänger wundern sich über den Aufwand." : ""}`,
        };
      return {
        section: BIG.includes(e.building!) ? "Stadt" : "Lokales",
        title: pick(rnd, [`Neu in der Stadt: ${name}`, `${name} eröffnet`, `Spatenstich vorbei: ${name} in Betrieb`]),
        text: pick(rnd, [
          `Ein neuer ${name} bereichert die Stadt. ${PUBLIC.includes(e.building!) ? "Die Stadt hat ihn bezahlt, die Bürger profitieren." : "Neue Arbeitsplätze inklusive."}`,
          `Mit ${name} wächst die Stadt weiter. Anwohner zeigen sich gespannt.`,
          `Die Bauarbeiter sind abgezogen: ${name} hat geöffnet.`,
        ]),
      };
    case "upgraded":
      if (e.building === "villa" || e.building === "boathouse")
        return {
          section: "Gesellschaft",
          title: e.building === "villa" ? `Noch mehr Luxus: ${name}` : `Jetzt mit Yacht? ${name} ausgebaut`,
          text: `Der Bürgermeister hat erneut gebaut – sein Anwesen heißt jetzt ${name}.${suspicious ? " Mancher fragt sich, wie das zum Gehalt passt." : ""}`,
        };
      return { section: "Lokales", title: `Ausgebaut: ${name}`, text: `Mehr Platz, mehr Leistung – ${name} ist fertig ausgebaut.` };
    case "demolished":
      return { section: "Lokales", title: `Abgerissen: ${name}`, text: `Die Bagger haben ${name} dem Erdboden gleichgemacht.` };
    case "fire":
      return {
        section: "Blaulicht",
        title: pick(rnd, ["Feuer in Wohnhaus", "Flammen schlagen aus dem Dach", "Hausbrand hält Feuerwehr in Atem"]),
        text: `Ein Wohnhaus stand in Flammen.${e.injured ? " Es gab Verletzte." : ""} Nachbarn schildern dramatische Minuten.`,
      };
    case "ruin":
      return {
        section: "Blaulicht",
        title: "Haus abgebrannt – nur eine Ruine bleibt",
        text: "Für ein Wohnhaus kam jede Hilfe zu spät: Es brannte bis auf die Grundmauern nieder. Die Anwohner fragen, warum die Feuerwehr nicht kam – die Ruine muss nun abgerissen werden.",
      };
    case "accident":
      return {
        section: "Blaulicht",
        title: pick(rnd, ["Unfall auf der Hauptstraße", "Crash im Feierabendverkehr", "Blechschaden und Stau"]),
        text: `Zwei Autos sind zusammengestoßen.${e.injured ? " Ein Krankenwagen brachte Verletzte in die Klinik." : " Verletzt wurde niemand."} Die Polizei sperrte die Straße und leitete den Verkehr um.`,
      };
    case "rescued":
      return {
        section: "Blaulicht",
        title: e.building === "firestation" ? "Feuerwehr verhindert Schlimmeres" : "Polizei räumt Unfallstelle",
        text: e.building === "firestation" ? "Dank des schnellen Einsatzes der Feuerwehr konnte das Haus gerettet werden." : "Die Unfallstelle ist geräumt, der Verkehr rollt wieder.",
      };
  }
}

/** Fixed sections: the economy, the mood, investigative pieces on the mayor, gold. */
function regularArticles(rnd: () => number, ctx: Context): Article[] {
  const out: Article[] = [];
  const e = ctx.economy;
  if (e) {
    const balance = e.balance;
    out.push({
      section: "Wirtschaft",
      title: balance >= 0 ? "Stadtkasse im Plus" : "Haushalt rutscht ins Minus",
      text: `Die Stadt nimmt pro Minute ${euro(Math.abs(balance))} ${balance >= 0 ? "mehr ein, als sie ausgibt" : "weniger ein, als sie ausgibt"}; auf dem Konto liegen ${euro(ctx.money)}. ${Math.round(e.residents).toLocaleString("de-DE")} Einwohner, ${Math.round(e.employment * 100)} % der Arbeitskräfte haben eine Stelle.`,
    });
    const mood = moodOf(moodFactors(e));
    const worst = moodFactors(e)
      .filter((f) => f.score < 0.6)
      .sort((a, b) => a.score * a.weight - b.score * b.weight)[0];
    out.push({
      section: "Umfrage",
      title: mood > 0.75 ? "Die Bürger sind zufrieden" : mood > 0.5 ? "Gemischte Stimmung in der Stadt" : "Die Bürger sind unzufrieden",
      text: `Unsere Umfrage ergibt eine Zufriedenheit von ${Math.round(mood * 100)} %.${worst ? ` Am meisten ärgert die Leute: ${worst.complaint}.` : " Große Klagen gibt es derzeit keine."}`,
    });
  }
  const m = ctx.mayor;
  if (m.jailUntil <= ctx.now && m.scandalUntil <= ctx.now) {
    if (m.rackets.length > 0 && rnd() < 0.7)
      out.push({
        section: "Recherche",
        title: "Geschäftsleute klagen über „Schutzgebühren“",
        text: `Mehrere Unternehmer berichten hinter vorgehaltener Hand von Zahlungen, die sie leisten müssten – an wen, will niemand sagen. ${m.rackets.length} Betrieb${m.rackets.length === 1 ? "" : "e"} sollen betroffen sein.`,
      });
    if (m.fronts.length > 0 && m.dirty > 0 && rnd() < 0.6) {
      const front = ctx.buildings.find((b) => b.id === m.fronts[0]);
      out.push({
        section: "Recherche",
        title: front?.kind === "pizzeria" ? "Die erstaunlich erfolgreiche Pizzeria" : "Recyclinghof mit Rekordumsatz",
        text: "Kaum Gäste, aber Umsätze wie ein Großbetrieb: Unsere Reporter wundern sich über die Bücher eines Betriebs in der Stadt. Ein Insider spricht von „Geld, das sauberer rauskommt, als es reinging“.",
      });
    }
    if (m.suspicion > 35)
      out.push({
        section: "Recherche",
        title: pick(rnd, ["Gerüchte um den Bürgermeister", "Was weiß das Rathaus?", "Ermittler werden hellhörig"]),
        text: `Im Rathaus wird getuschelt: Von Umschlägen, Gefälligkeiten für Bauträger und Aufträgen ohne Ausschreibung ist die Rede. Die Staatsanwaltschaft äußert sich nicht – noch nicht.${m.suspicion > 70 ? " Insider rechnen mit Durchsuchungen in den nächsten Tagen." : ""}`,
      });
  }
  if (ctx.buildings.some((b) => b.kind === "exchange")) {
    const p = goldPrice(ctx.now);
    const y = goldPrice(ctx.now - DAY);
    out.push({ section: "Börse", title: `Gold ${p > y ? "steigt" : "fällt"}`, text: `Der Goldkurs ${p > y ? "kletterte" : "gab nach"} auf ${euro(p)} je Barren (Vortag ${euro(y)}).` });
  }
  return out;
}

const ADS: Partial<Record<BuildingKind, { title: string; text: string }[]>> = {
  pizzeria: [{ title: "Pizzeria – Holzofen-Pizza!", text: "Heute: Margherita zum halben Preis. Auch zum Mitnehmen." }],
  casino: [{ title: "Spielbank", text: "Rien ne va plus! Roulette, Black Jack und Automaten – täglich ab 18 Uhr." }],
  furniturestore: [{ title: "Möbelhaus", text: "Sofas, Betten, Küchen – alles muss raus! Nur diese Woche." }],
  discounter: [{ title: "Discounter", text: "Nudeln, Kaffee, Schokolade – Tiefpreise jeden Tag." }],
  jeweller: [{ title: "Juwelier", text: "Gold und Diamanten – für besondere Momente." }],
  airport: [{ title: "Flughafen", text: "Ab in den Urlaub: Sonnenziele jetzt buchen!" }],
  bakery: [{ title: "Bäckerei", text: "Frische Brötchen ab 6 Uhr – die Brezel des Tages." }],
  shoeshop: [{ title: "Schuhgeschäft", text: "Neue Kollektion eingetroffen – Turnschuhe, Stiefel, Sandalen." }],
  fashion: [{ title: "Modegeschäft", text: "Sommerschlussverkauf: bis zu 50 % auf alles." }],
  cinema: [{ title: "Kino", text: "Heute Abend: der große Blockbuster. Popcorn gratis!" }],
  fair: [{ title: "Jahrmarkt", text: "Riesenrad und Karussell – Spaß für die ganze Familie." }],
  pool: [{ title: "Schwimmbad", text: "Abkühlung gefällig? Das Freibad hat geöffnet." }],
  restaurant: [{ title: "Restaurant", text: "Schnitzel, Braten, Hausmannskost – reservieren Sie jetzt." }],
};

/** An edition printed now, from the events since the last one (`since`, game minutes). */
export function makeEdition(since: number, events: NewsEvent[], ctx: Context): Edition {
  const day = Math.floor(ctx.now / DAY) + 1;
  const rnd = mulberry32(day * 2654435761);
  const today = events.filter((e) => e.t > since && e.t <= ctx.now);
  // Many small buildings of one kind become one note.
  const sorted = [...today].sort((a, b) => score(b) - score(a));
  const seen = new Set<string>();
  const unique = sorted.filter((e) => {
    const key = `${e.kind}:${e.building ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const written = unique.slice(0, 6).map((e) => write(e, rnd, ctx));
  const regular = regularArticles(rnd, ctx);
  const headline =
    written[0] ??
    (regular.find((a) => a.section === "Recherche") ?? {
      section: "Titel",
      title: pick(rnd, ["Ein ruhiger Tag in der Stadt", "Keine besonderen Vorkommnisse", "Die Stadt atmet durch"]),
      text: "Gestern blieb es ruhig: keine Unglücke, keine Skandale. Die Redaktion nutzt die Gelegenheit für einen Blick auf Wirtschaft und Stimmung.",
    });
  const articles = [...written.slice(1), ...regular.filter((a) => a !== headline)];
  const kinds = new Set(ctx.buildings.map((b) => b.kind));
  const ads = (Object.entries(ADS) as [BuildingKind, { title: string; text: string }[]][])
    .filter(([k]) => kinds.has(k))
    .map(([, list]) => list[0])
    .sort(() => rnd() - 0.5)
    .slice(0, 3);
  return { day, printedAt: ctx.now, headline, articles, ads };
}
