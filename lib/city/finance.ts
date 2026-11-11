import type { EconomyStats } from "./economy";

/**
 * Bank loans (Kredite). The town borrows a sum and pays it back with interest in equal
 * instalments. Rates are "per minute" like the HUD balance: money moves by rate / 60 per
 * game minute, so a loan running `days` game days has days × 24 instalment "minutes".
 */

export interface Loan {
  id: string;
  /** Offer it came from (label). */
  label: string;
  principal: number;
  /** Interest on the whole sum, e.g. 0.06. */
  interest: number;
  /** Principal plus interest. */
  total: number;
  /** Still to pay. */
  remaining: number;
  /** Instalment per minute (HUD unit). */
  payment: number;
  /** Game minute the loan was taken. */
  takenAt: number;
}

export interface LoanOffer {
  id: string;
  label: string;
  amount: number;
  interest: number;
  days: number;
}

export const LOAN_OFFERS: LoanOffer[] = [
  { id: "small", label: "Kleinkredit", amount: 25_000, interest: 0.04, days: 2 },
  { id: "build", label: "Baukredit", amount: 100_000, interest: 0.07, days: 5 },
  { id: "large", label: "Investitionskredit", amount: 400_000, interest: 0.1, days: 10 },
];

/** Instalment per minute for an offer. */
export const paymentOf = (o: LoanOffer) => (o.amount * (1 + o.interest)) / (o.days * 24);

export function newLoan(o: LoanOffer, id: string, gameMinutes: number): Loan {
  const total = o.amount * (1 + o.interest);
  return { id, label: o.label, principal: o.amount, interest: o.interest, total, remaining: total, payment: paymentOf(o), takenAt: gameMinutes };
}

/** Paying off early costs only the principal still owed (no interest for the time left). */
export const payoffOf = (l: Loan) => (l.remaining / l.total) * l.principal;

/** Outstanding debt (principal still owed) of all loans. */
export const debtOf = (loans: Loan[]) => loans.reduce((s, l) => s + payoffOf(l), 0);

/** Instalments of all loans per minute. */
export const loanPayments = (loans: Loan[]) => loans.reduce((s, l) => s + l.payment, 0);

/** How much the bank lends in total: a base, per resident and per € of positive balance. */
export function creditLimit(economy: EconomyStats | null) {
  if (!economy) return 50_000;
  return Math.round((50_000 + economy.residents * 150 + Math.max(0, economy.balance) * 60) / 1000) * 1000;
}

/** Advances all loans by `minutes` game minutes; returns the loans left and what was paid. */
export function payLoans(loans: Loan[], minutes: number): { loans: Loan[]; paid: number } {
  let paid = 0;
  const left: Loan[] = [];
  for (const l of loans) {
    const due = Math.min(l.remaining, (l.payment / 60) * minutes);
    paid += due;
    if (l.remaining - due > 0.5) left.push({ ...l, remaining: l.remaining - due });
  }
  return { loans: left, paid };
}
