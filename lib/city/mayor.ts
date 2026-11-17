import { BUILDINGS, PUBLIC, levelFactor, levelName, type Building, type BuildingKind, type EconomyStats } from "./economy";

/**
 * The mayor's private side (Nutzerwunsch): a salary from the town onto a private account,
 * bribes for building permits and favours from firms, protection money squeezed out of single
 * firms, and the town's till within reach. The private account pays for the mayor's villa and
 * the stakes in the casino. A mayor can get rich fast – but every deal raises suspicion. It
 * fades slowly; the higher it is, the likelier a scandal: most of the private money is seized,
 * the citizens turn against the mayor and fewer people move in. A second scandal within
 * `PROBATION_MINUTES` puts the mayor in prison: everything is seized, the villa confiscated,
 * no salary and no deals until he is out.
 *
 * Money laundering: bribes, protection money and the till are dirty money (`dirty`, part of the
 * account); pizzerias and recycling yards used as fronts wash it bit by bit for a fee, and every
 * washed euro lowers the suspicion. A scandal mostly seizes dirty money; prison takes all.
 *
 * Rates are "per minute" in HUD units like all money (rate / 60 per game minute).
 */

export type OfferKind = "permit" | "taxbreak" | "contract";

export interface BribeOffer {
  id: string;
  kind: OfferKind;
  /** Who offers it (a developer, or the firm's name). */
  from: string;
  /** The firm (tax break). */
  building?: string;
  /** Onto the private account when accepted. */
  amount: number;
  /** What the town pays extra (overpriced contract), once. */
  cost?: number;
  /** Game minute the offer lapses. */
  expires: number;
}

/** A firm that pays no business tax until `until` (game minute). */
export interface Favour {
  building: string;
  until: number;
}

/** A firm paying protection money: this share of its profit goes to the mayor. */
export interface Racket {
  building: string;
  share: number;
}

export interface MayorState {
  account: number;
  /** Part of the account that is dirty (bribes, protection money, the till) – what a scandal seizes first. */
  dirty: number;
  /** Pizzerias and recycling yards laundering the dirty money. */
  fronts: string[];
  /** 0..GOODWILL_MAX: standing won by giving money back to the town (raises the citizens' opinion, fades). */
  goodwill: number;
  /** Salary per minute from the town. */
  salary: number;
  /** 0..100: how much the press and the prosecutors suspect. */
  suspicion: number;
  /** Game minute a running scandal ends (0 = none). */
  scandalUntil: number;
  /** Game minute of the last scandal, null = none yet (a second one within the probation means prison). */
  lastScandalAt: number | null;
  /** Game minute the mayor is released (0 = free). */
  jailUntil: number;
  offers: BribeOffer[];
  favours: Favour[];
  rackets: Racket[];
  /** Game minute of the last offer (pause between offers). */
  lastOfferAt: number;
  /** Everything ever taken (bribes, protection money, the till), for the panel. */
  taken: number;
}

export const SALARY_DEFAULT = 25;
export const SALARY_MAX = 5000;

export const newMayor = (): MayorState => ({
  account: 0,
  dirty: 0,
  fronts: [],
  goodwill: 0,
  salary: SALARY_DEFAULT,
  suspicion: 0,
  scandalUntil: 0,
  lastScandalAt: null,
  jailUntil: 0,
  offers: [],
  favours: [],
  rackets: [],
  lastOfferAt: 0,
  taken: 0,
});

/** What the citizens think a mayor of this town may earn (per minute). */
export const fairSalary = (residents: number) => Math.max(SALARY_DEFAULT, Math.round(residents * 0.015));

/** Suspicion points per accepted offer, and the fade per game hour. */
const SUSPICION: Record<OfferKind, number> = { permit: 6, taxbreak: 10, contract: 15 };
const FADE_PER_HOUR = 1;
/** Scandal chance per game minute at full suspicion (cubic below), certain at 100. */
const SCANDAL_RATE = 0.0012;
/** A scandal: share of the dirty money seized (and of the clean money), how long it lasts, suspicion left after it. */
export const SEIZED = 0.6;
export const SEIZED_CLEAN = 0.15;
export const SCANDAL_MINUTES = 3 * 1440;
const AFTER_SCANDAL = 30;
/** A second scandal within this time (game minutes) after the first means prison – for this long. */
export const PROBATION_MINUTES = 10 * 1440;
export const JAIL_MINUTES = 5 * 1440;
/** Offers: pause between two (game minutes), how long one stays open, at most this many open. */
const OFFER_GAP = 150;
const OFFER_LIFE = 360;
const MAX_OFFERS = 4;
/** Game days a tax break lasts; the firm hands over this share of the tax it saves (plus a lump sum). */
const TAXBREAK_DAYS = 5;
const TAXBREAK_SHARE = 0.6;
/** An overpriced contract costs the town this many times the bribe. */
const CONTRACT_MARKUP = 2.5;
/** Growth points a fast-tracked permit is worth (GROWTH_STEP is 4 per house). */
export const PERMIT_POINTS = 8;
/** Protection money: shares on offer, suspicion when starting, and per firm and game day (grows with the share). */
export const RACKET_SHARES = [0.1, 0.25, 0.5];
const RACKET_START = 5;
const racketPerDay = (share: number) => 2 + 10 * share;
/** Laundering: euros per minute a front washes (× its level), the fee it keeps, and how much washed money lowers suspicion by one point. */
export const WASH_RATE: Partial<Record<BuildingKind, number>> = { pizzeria: 5000, recycling: 8000 };
export const WASH_FEE: Partial<Record<BuildingKind, number>> = { pizzeria: 0.15, recycling: 0.1 };
const washPerPoint = (residents: number) => 8000 + residents * 0.8;
/** Every front draws a little attention per game day. */
const FRONT_PER_DAY = 0.5;
export const washRate = (b: Building) => (WASH_RATE[b.kind] ?? 0) * levelFactor(b);

const DEVELOPERS = ["Bauträger Hagemann", "Wohnbau Kessler & Söhne", "Immobilien Rautenberg", "Baulöwe Kröger", "Projektbau Weidner", "Terra Wohnkonzept"];
const BUILDERS = ["Tiefbau Brenner", "Bauunternehmen Falk", "Hoch- und Tiefbau Lindner", "Straßenbau Petersen"];

export const OFFER_LABEL: Record<OfferKind, string> = { permit: "Baugenehmigung", taxbreak: "Steuerrabatt", contract: "Auftrag" };

export const jailed = (m: MayorState, now: number) => m.jailUntil > now;

/** One-line description of an offer for the panel and the ticker. */
export function offerText(o: BribeOffer, buildings: Building[]): string {
  if (o.kind === "permit") return `${o.from} will schneller bauen dürfen – zwei neue Wohnhäuser sofort genehmigt`;
  if (o.kind === "taxbreak") {
    const b = buildings.find((x) => x.id === o.building);
    return `${o.from}${b ? ` (${levelName(b)})` : ""} möchte ${TAXBREAK_DAYS} Tage keine Gewerbesteuer zahlen`;
  }
  return `${o.from} bekommt einen überteuerten Bauauftrag – die Stadt zahlt ${Math.round(o.cost ?? 0).toLocaleString("de-DE")} €`;
}

/** Private businesses that make money (candidates for tax breaks and protection money). */
export const isFirm = (b: Building) => b.kind !== "house" && b.kind !== "ruin" && !PUBLIC.includes(b.kind);

function taxpayers(buildings: Building[], economy: EconomyStats) {
  return buildings.filter((b) => isFirm(b) && (economy.status[b.id]?.finance?.tax ?? 0) > 1);
}

/** Protection money a firm pays per minute (a share of its profit, nothing while it loses money). */
export function racketIncome(r: Racket, economy: EconomyStats | null) {
  const profit = economy?.status[r.building]?.finance?.profit ?? 0;
  return Math.max(0, profit) * r.share;
}

export interface MayorStep {
  mayor: MayorState;
  /** Seized money flows back to the town. */
  seized: number;
  /** The villa is confiscated when the mayor goes to prison. */
  confiscateVilla: boolean;
  notice: string | null;
}

/**
 * One tick (`minutes` game minutes): salary and protection money, fading and growing
 * suspicion, the scandal check (and prison), lapsed offers, and – now and then – a new offer.
 */
export function stepMayor(m: MayorState, economy: EconomyStats, buildings: Building[], now: number, minutes: number, rnd: () => number, newId: () => string): MayorStep {
  let notice: string | null = null;
  const live = new Set(buildings.map((b) => b.id));
  const inJail = jailed(m, now);
  const rackets = m.rackets.filter((r) => live.has(r.building));
  let racket = 0;
  let racketSuspicion = 0;
  for (const r of rackets) {
    racket += racketIncome(r, economy);
    racketSuspicion += racketPerDay(r.share);
  }
  const income = inJail ? 0 : ((m.salary + racket) / 60) * minutes;
  const dirtyIn = inJail ? 0 : (racket / 60) * minutes;
  // Laundering through the fronts (connected ones only): dirty becomes clean, minus the fee.
  const fronts = m.fronts.filter((id) => live.has(id));
  let washed = 0;
  let fee = 0;
  let dirtyLeft = m.dirty + dirtyIn;
  if (!inJail) {
    for (const id of fronts) {
      const b = buildings.find((x) => x.id === id);
      if (!b || !economy.status[id]?.connected || dirtyLeft <= 0) continue;
      const w = Math.min(dirtyLeft, (washRate(b) / 60) * minutes);
      dirtyLeft -= w;
      washed += w;
      fee += w * (WASH_FEE[b.kind] ?? 0.15);
    }
  }
  const washRelief = washed / washPerPoint(economy.residents);
  let next: MayorState = {
    ...m,
    goodwill: Math.max(0, (m.goodwill ?? 0) - (GOODWILL_FADE_PER_DAY / 1440) * minutes),
    account: m.account + income - fee,
    dirty: dirtyLeft,
    fronts,
    taken: m.taken + (racket / 60) * minutes,
    suspicion: Math.max(
      0,
      Math.min(100, m.suspicion - (FADE_PER_HOUR / 60) * minutes - washRelief + ((racketSuspicion + FRONT_PER_DAY * fronts.length) / 1440) * minutes),
    ),
    offers: m.offers.filter((o) => o.expires > now && (!o.building || live.has(o.building))),
    favours: mergeFavours(m.favours.filter((f) => f.until > now && live.has(f.building))),
    rackets,
  };
  if (m.jailUntil && m.jailUntil <= now) {
    next.jailUntil = 0;
    notice = "Der Bürgermeister ist aus der Haft entlassen – ein Neuanfang mit leerem Konto";
  }
  if (next.scandalUntil && next.scandalUntil <= now) {
    next.scandalUntil = 0;
    if (!notice) notice = "Der Korruptionsskandal ist vergessen – die Bürger vertrauen dem Bürgermeister langsam wieder";
  }
  if (inJail) return { mayor: next, seized: 0, confiscateVilla: false, notice };
  // Scandal: certain at full suspicion, otherwise a chance that grows with the cube of it
  // (judged on the suspicion before this tick's fade, so 100 % is really certain).
  const s = Math.max(m.suspicion, next.suspicion) / 100;
  if (!next.scandalUntil && (s >= 1 || rnd() < SCANDAL_RATE * s * s * s * minutes)) {
    const repeat = m.lastScandalAt !== null && now - m.lastScandalAt < PROBATION_MINUTES;
    const base = { ...next, offers: [], favours: [], rackets: [], lastScandalAt: now, scandalUntil: now + SCANDAL_MINUTES };
    if (repeat) {
      // Second scandal on probation: arrested. Everything is seized, the villa confiscated.
      const seized = next.account;
      return {
        mayor: { ...base, account: 0, dirty: 0, fronts: [], suspicion: 0, jailUntil: now + JAIL_MINUTES, salary: SALARY_DEFAULT },
        seized,
        confiscateVilla: true,
        notice: `Verhaftet! Der Bürgermeister muss ${JAIL_MINUTES / 1440} Tage ins Gefängnis – ${Math.round(seized).toLocaleString("de-DE")} € beschlagnahmt, die Villa enteignet`,
      };
    }
    // Mostly the dirty money; of the laundered (clean) money only a little.
    const clean = Math.max(0, next.account - next.dirty);
    const seized = next.dirty * SEIZED + clean * SEIZED_CLEAN;
    return {
      mayor: { ...base, account: next.account - seized, dirty: next.dirty * (1 - SEIZED), suspicion: AFTER_SCANDAL },
      seized,
      confiscateVilla: false,
      notice: `Korruptionsskandal! ${Math.round(seized).toLocaleString("de-DE")} € vom Privatkonto beschlagnahmt – die Bürger sind empört. Noch ein Skandal in ${PROBATION_MINUTES / 1440} Tagen, und es geht ins Gefängnis`,
    };
  }
  // New offers – not during a scandal (nobody dares), with a pause in between.
  if (!next.scandalUntil && next.offers.length < MAX_OFFERS && now - next.lastOfferAt >= OFFER_GAP && rnd() < 0.03 * minutes) {
    const offer = makeOffer(economy, buildings, m, now, rnd, newId);
    if (offer) {
      next = { ...next, offers: [...next.offers, offer], lastOfferAt: now };
      notice = `Vertrauliches Angebot: ${offer.from} bietet ${Math.round(offer.amount).toLocaleString("de-DE")} € (${OFFER_LABEL[offer.kind]}) – Knopf „Bürgermeister“`;
    }
  }
  return { mayor: next, seized: 0, confiscateVilla: false, notice };
}

/** One tax break per firm: duplicates (older saves) collapse into the one that runs longest. */
function mergeFavours(favours: Favour[]): Favour[] {
  const byBuilding = new Map<string, Favour>();
  for (const f of favours) {
    const prev = byBuilding.get(f.building);
    if (!prev || f.until > prev.until) byBuilding.set(f.building, f);
  }
  return byBuilding.size === favours.length ? favours : [...byBuilding.values()];
}

function makeOffer(economy: EconomyStats, buildings: Building[], m: MayorState, now: number, rnd: () => number, newId: () => string): BribeOffer | null {
  const residents = economy.residents;
  const vary = () => 0.75 + rnd() * 0.5;
  // Firms that already enjoy (or have been offered) a tax break do not ask again.
  const favoured = new Set([...m.favours.map((f) => f.building), ...m.offers.flatMap((o) => (o.kind === "taxbreak" && o.building ? [o.building] : []))]);
  const firms = taxpayers(buildings, economy).filter((b) => !favoured.has(b.id));
  const roll = rnd();
  if (roll < 0.4 && residents > 0) {
    return { id: newId(), kind: "permit", from: DEVELOPERS[Math.floor(rnd() * DEVELOPERS.length)], amount: Math.round((20000 + residents * 25) * vary()), expires: now + OFFER_LIFE };
  }
  if (roll < 0.75 && firms.length > 0) {
    // One of the bigger taxpayers.
    const sorted = firms.sort((a, b) => (economy.status[b.id].finance!.tax ?? 0) - (economy.status[a.id].finance!.tax ?? 0));
    const firm = sorted[Math.floor(rnd() * Math.min(8, sorted.length))];
    const tax = economy.status[firm.id].finance!.tax;
    const saved = tax * 24 * TAXBREAK_DAYS;
    return {
      id: newId(),
      kind: "taxbreak",
      from: `${BUILDINGS[firm.kind].label}-Betreiber`,
      building: firm.id,
      amount: Math.round((saved * TAXBREAK_SHARE + 20000 + residents * 5) * vary()),
      expires: now + OFFER_LIFE,
    };
  }
  const amount = Math.round((50000 + residents * 40) * vary());
  return { id: newId(), kind: "contract", from: BUILDERS[Math.floor(rnd() * BUILDERS.length)], amount, cost: Math.round(amount * CONTRACT_MARKUP), expires: now + OFFER_LIFE };
}

/** Accepting an offer: money onto the account, suspicion up, and what it does to the town. */
export function acceptOffer(m: MayorState, offerId: string, now: number): { mayor: MayorState; townCost: number; growthPoints: number; offer: BribeOffer } | null {
  const offer = m.offers.find((o) => o.id === offerId);
  if (!offer || jailed(m, now)) return null;
  const favours =
    offer.kind === "taxbreak" && offer.building
      ? mergeFavours([...m.favours, { building: offer.building, until: now + TAXBREAK_DAYS * 1440 }])
      : m.favours;
  return {
    mayor: {
      ...m,
      account: m.account + offer.amount,
      dirty: m.dirty + offer.amount,
      suspicion: Math.min(100, m.suspicion + SUSPICION[offer.kind]),
      offers: m.offers.filter((o) => o.id !== offerId),
      favours,
      taken: m.taken + offer.amount,
    },
    townCost: offer.cost ?? 0,
    growthPoints: offer.kind === "permit" ? PERMIT_POINTS : 0,
    offer,
  };
}

/** Starts (or changes) protection money for a firm; share 0 ends it. */
export function setRacket(m: MayorState, building: string, share: number): MayorState {
  const had = m.rackets.some((r) => r.building === building);
  const rackets = m.rackets.filter((r) => r.building !== building);
  if (share > 0) rackets.push({ building, share });
  return { ...m, rackets, suspicion: share > 0 && !had ? Math.min(100, m.suspicion + RACKET_START) : m.suspicion };
}

/** Uses (or stops using) a pizzeria / recycling yard to launder the dirty money. */
export function setFront(m: MayorState, building: string, on: boolean): MayorState {
  const fronts = m.fronts.filter((id) => id !== building);
  if (on) fronts.push(building);
  return { ...m, fronts };
}

/**
 * Pays from the private account: dirty money first (casino stakes – winnings come back
 * clean) or clean money first (the villa); the dirty part never exceeds the account.
 */
export function spend(m: MayorState, amount: number, dirtyFirst: boolean): MayorState {
  const account = m.account - amount;
  const dirty = dirtyFirst ? Math.max(0, m.dirty - amount) : Math.min(m.dirty, Math.max(0, account));
  return { ...m, account, dirty: Math.min(dirty, Math.max(0, account)) };
}

/** Giving back: standing per euro, its ceiling and fade per game day; how much it lowers suspicion. */
export const GOODWILL_MAX = 0.5;
const GOODWILL_FADE_PER_DAY = 0.03;
const goodwillPer = (residents: number) => 100000 + residents * 20;
const repayPerPoint = (residents: number) => 16000 + residents * 1.6;
/** A running scandal is cut by up to this share (in full from `scandalRepay` euros, below that pro rata). */
export const SCANDAL_CUT = 0.94;
export const scandalRepay = (residents: number) => 50000 + residents * 25;

/**
 * The mayor gives money back to the town (dirty money first): standing up, suspicion down,
 * and a running scandal shortened by up to 94 %. Returns the new state and what the town gets.
 */
export function repayTown(m: MayorState, amount: number, residents: number, now: number): { mayor: MayorState; paid: number; cut: number } {
  const paid = Math.max(0, Math.min(amount, m.account));
  if (paid <= 0 || jailed(m, now)) return { mayor: m, paid: 0, cut: 0 };
  const after = spend(m, paid, true);
  let scandalUntil = m.scandalUntil;
  let cut = 0;
  if (scandalUntil > now) {
    cut = SCANDAL_CUT * Math.min(1, paid / scandalRepay(residents));
    scandalUntil = now + (scandalUntil - now) * (1 - cut);
    if (scandalUntil - now < 1) scandalUntil = now + 1;
  }
  return {
    mayor: {
      ...after,
      goodwill: Math.min(GOODWILL_MAX, m.goodwill + paid / goodwillPer(residents)),
      suspicion: Math.max(0, m.suspicion - paid / repayPerPoint(residents)),
      scandalUntil,
    },
    paid,
    cut,
  };
}

/** Suspicion from moving `amount` out of the town's till (relative to the town's size). */
export function embezzleSuspicion(amount: number, residents: number) {
  return 8 + (25 * amount) / (50000 + residents * 20);
}

/**
 * The mayor's effect on the town for this tick's readings: salary and forgone business tax
 * (tax breaks, and the tax on profit lost to protection money) leave the balance, a scandal
 * halves immigration, and the citizens' opinion becomes a mood factor.
 */
export function applyMayor(e: EconomyStats, m: MayorState, now: number): EconomyStats {
  let favourTax = 0;
  for (const f of m.favours) favourTax += Math.max(0, e.status[f.building]?.finance?.tax ?? 0);
  for (const r of m.rackets) favourTax += Math.max(0, e.status[r.building]?.finance?.tax ?? 0) * r.share;
  const inJail = jailed(m, now);
  const salary = inJail ? 0 : m.salary;
  const scandal = m.scandalUntil > now || inJail;
  const fair = fairSalary(e.residents);
  const greed = salary <= fair ? 1 : Math.max(0.1, 1 - 0.35 * (salary / fair - 1));
  const goodwill = m.goodwill ?? 0;
  const score = Math.max(0, Math.min(1, (scandal ? 0.1 : greed - m.suspicion / 250) + goodwill));
  return {
    ...e,
    balance: e.balance - salary - favourTax,
    income: e.income - favourTax,
    upkeep: e.upkeep + salary,
    immigration: e.immigration * (scandal ? 0.5 : 1) * (0.9 + 0.1 * greed),
    budget: { ...e.budget, businessTax: e.budget.businessTax - favourTax, mayor: salary, favours: favourTax },
    mayor: { score, scandal },
  };
}
