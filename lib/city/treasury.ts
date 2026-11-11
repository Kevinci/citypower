import { BUILDINGS, PUBLIC, taxAttraction, type Building, type BuildingKind, type EconomyStats } from "./economy";
import { debtOf, loanPayments, type Loan } from "./finance";

/**
 * The tax office (Finanzamt): gathers every money figure of the town in one place and
 * works it up for the panel – income and spending lines, the tax base, what one
 * percentage point of tax brings, taxes per industry, the biggest taxpayers and the
 * businesses making a loss, and when the town is free of debt. Pure analysis.
 */

/** Labels for the town's spending on municipal buildings. */
export const SERVICE_LABEL: Partial<Record<BuildingKind, string>> = {
  waterworks: "Wasserwerke",
  hospital: "Krankenhäuser",
  school: "Schulen",
  church: "Kirche",
  powerplant: "Kraftwerke inkl. Brennstoff",
  transformer: "Trafostationen",
  bank: "Bank",
  townhall: "Rathaus",
  taxoffice: "Finanzamt",
  exchange: "Börse",
  warehouse: "Lagerhallen",
  harbour: "Häfen inkl. Schiffe",
};

export interface MoneyLine {
  id: string;
  label: string;
  /** Per minute, always ≥ 0 (direction comes from the list it is in). */
  value: number;
  sub?: string;
}

/** Taxes and profit of all businesses of one kind. */
export interface SectorLine {
  kind: BuildingKind;
  label: string;
  count: number;
  /** Profit after tax per minute. */
  profit: number;
  tax: number;
  losing: number;
}

export interface Taxpayer {
  building: Building;
  tax: number;
  profit: number;
}

export interface TreasuryReport {
  income: MoneyLine[];
  spending: MoneyLine[];
  totalIncome: number;
  totalSpending: number;
  /** Per minute after loan payments. */
  balance: number;
  /** Balance over one game day. */
  perDay: number;
  /** Wages of all employed residents per minute (base of the income tax). */
  wageBase: number;
  /** Profits before tax of the businesses in profit (base of the business tax). */
  profitBase: number;
  /** Extra income per minute from one more percentage point of each tax. */
  incomeTaxPoint: number;
  businessTaxPoint: number;
  /** Immigration factor of the current rates (1 = neutral). */
  attraction: number;
  /** Town income per resident and minute. */
  perResident: number;
  sectors: SectorLine[];
  topPayers: Taxpayer[];
  losers: Taxpayer[];
  debt: number;
  /** Game days until all loans are paid, or null without loans. */
  debtFreeDays: number | null;
}

/** Rates are "per minute" in HUD units: money moves by rate / 60 per game minute, so one game day is 1440 / 60 = 24 of them. */
const PER_DAY = 24;

/** `shipIncome`: cargo sales as a per-minute rate (`salesRate` in shipping.ts). */
export function treasuryReport(e: EconomyStats, buildings: Building[], loans: Loan[], businessTaxRate: number, shipIncome = 0): TreasuryReport {
  const b = e.budget;
  const income: MoneyLine[] = [
    { id: "income", label: "Einkommensteuer", value: b.incomeTax, sub: `${Math.round(e.taxRate * 100)} % der Löhne` },
    { id: "business", label: "Gewerbesteuer", value: b.businessTax, sub: `${Math.round(businessTaxRate * 100)} % der Gewinne` },
    { id: "property", label: "Grundsteuer", value: b.propertyTax, sub: "je Haushalt" },
    { id: "water", label: "Wassergebühren", value: b.waterFees },
    { id: "power", label: "Stromgebühren", value: b.powerFees },
  ];
  if ((b.airport ?? 0) > 0 || buildings.some((x) => x.kind === "airport"))
    income.push({ id: "airport", label: "Flughafen", value: b.airport ?? 0, sub: "Gebühren und Luftfracht" });
  if (shipIncome > 0 || buildings.some((x) => x.kind === "harbour"))
    income.push({ id: "ships", label: "Schiffsexporte", value: shipIncome, sub: "Ø letzter Spieltag" });
  const payments = loanPayments(loans);
  const spending: MoneyLine[] = (Object.entries(b.services) as [BuildingKind, number | undefined][])
    .filter(([, v]) => (v ?? 0) > 0)
    .map(([k, v]) => ({ id: k, label: SERVICE_LABEL[k] ?? BUILDINGS[k].label, value: v ?? 0 }))
    .sort((x, y) => y.value - x.value);
  if (b.storage > 0) spending.push({ id: "storage", label: "Lagerankauf", value: b.storage, sub: "Überschuss der Fabriken" });
  if ((b.gold ?? 0) > 0) spending.push({ id: "gold", label: "Goldankauf", value: b.gold!, sub: "Barren der Goldschmelzen in den Tresor" });
  if (payments > 0) spending.push({ id: "loans", label: "Kreditraten", value: payments });
  const totalIncome = income.reduce((s, l) => s + l.value, 0);
  const totalSpending = spending.reduce((s, l) => s + l.value, 0);
  const balance = totalIncome - totalSpending;

  // Tax bases from what was collected (rates are never 0, see TAX_MIN / BUSINESS_TAX_MIN).
  const wageBase = e.taxRate > 0 ? b.incomeTax / e.taxRate : 0;
  const profitBase = businessTaxRate > 0 ? b.businessTax / businessTaxRate : 0;

  const sectorMap = new Map<BuildingKind, SectorLine>();
  const payers: Taxpayer[] = [];
  for (const bd of buildings) {
    if (bd.kind === "house" || PUBLIC.includes(bd.kind)) continue;
    const f = e.status[bd.id]?.finance;
    if (!f) continue;
    payers.push({ building: bd, tax: f.tax, profit: f.profit });
    const line = sectorMap.get(bd.kind) ?? { kind: bd.kind, label: BUILDINGS[bd.kind].label, count: 0, profit: 0, tax: 0, losing: 0 };
    line.count++;
    line.profit += f.profit;
    line.tax += f.tax;
    if (f.profit < 0) line.losing++;
    sectorMap.set(bd.kind, line);
  }
  const sectors = [...sectorMap.values()].sort((x, y) => y.tax - x.tax || y.profit - x.profit);
  const topPayers = payers.filter((p) => p.tax > 0).sort((x, y) => y.tax - x.tax).slice(0, 5);
  const losers = payers.filter((p) => p.profit < 0).sort((x, y) => x.profit - y.profit).slice(0, 5);

  const debt = debtOf(loans);
  const debtFreeDays = loans.length > 0 && payments > 0 ? Math.max(...loans.map((l) => l.remaining / l.payment)) / PER_DAY : null;

  return {
    income,
    spending,
    totalIncome,
    totalSpending,
    balance,
    perDay: balance * PER_DAY,
    wageBase,
    profitBase,
    incomeTaxPoint: wageBase * 0.01,
    businessTaxPoint: profitBase * 0.01,
    attraction: taxAttraction(e.taxRate, businessTaxRate),
    perResident: e.residents > 0 ? totalIncome / e.residents : 0,
    sectors,
    topPayers,
    losers,
    debt,
    debtFreeDays,
  };
}
