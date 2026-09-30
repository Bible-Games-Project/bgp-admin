// Shared by the Expenses and Revenue pages and the server functions behind them.
// Pure: no server-only imports, so the pages can work out payments on the client.

import { type ChartBucket, type Preset, presetMonths } from "./income";
import type { EurConverter } from "./income-reports";

export type ExpenseFrequency = "once" | "monthly" | "yearly";
export type ExpenseCurrency = "EUR" | "USD";

export const CURRENCIES: ExpenseCurrency[] = ["EUR", "USD"];

/** What the project pays for, entered by hand on the Expenses page. */
export type Expense = {
  id: string;
  name: string;
  amount: number;
  currency: ExpenseCurrency;
  frequency: ExpenseFrequency;
  /** YYYY-MM-DD: the payment of a one-off expense, or the first of a recurring one. */
  starts_on: string;
  /** A cancelled recurring expense: payments after this day don't count. */
  ends_on: string | null;
  /** The game that alone needs it; null when the whole project shares it. */
  app_id: string | null;
  notes: string | null;
};

/** One payment of an expense, in euros. */
export type ExpensePayment = {
  expenseId: string;
  appId: string | null;
  date: string;
  /** Null when no exchange rate to euros was found. */
  eur: number | null;
};

const STEP_MONTHS: Record<Exclude<ExpenseFrequency, "once">, number> = { monthly: 1, yearly: 12 };

export function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

/** "Mar 12, 2027" */
export function formatDay(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "€99.00 a year", "$20.00 a month", "$25.00 once" */
export function priceLabel(e: Pick<Expense, "amount" | "currency" | "frequency">) {
  const per = { once: "once", monthly: "a month", yearly: "a year" }[e.frequency];
  return `${formatMoney(e.amount, e.currency)} ${per}`;
}

export function isRecurring(e: Pick<Expense, "frequency">) {
  return e.frequency !== "once";
}

/** Recurring and not cancelled as of `today`. */
export function isRunning(e: Pick<Expense, "frequency" | "ends_on">, today: string) {
  return isRecurring(e) && (!e.ends_on || e.ends_on >= today);
}

/** The same day `months` months later, or that month's last day when it is shorter. */
export function addMonthsToDate(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Every payment date up to `until` (inclusive), oldest first. Each one is counted from
 * the first payment, so a subscription started on the 31st keeps the 31st after February.
 */
export function paymentDates(
  e: Pick<Expense, "frequency" | "starts_on" | "ends_on">,
  until: string,
): string[] {
  const last = e.ends_on && e.ends_on < until ? e.ends_on : until;
  if (e.frequency === "once") return e.starts_on <= last ? [e.starts_on] : [];
  const dates: string[] = [];
  for (let i = 0; ; i++) {
    const date = addMonthsToDate(e.starts_on, i * STEP_MONTHS[e.frequency]);
    if (date > last) return dates;
    dates.push(date);
  }
}

/** The first payment after `today`; null when none is coming (paid once, or cancelled). */
export function nextPaymentDate(
  e: Pick<Expense, "frequency" | "starts_on" | "ends_on">,
  today: string,
): string | null {
  if (e.frequency === "once") return e.starts_on > today ? e.starts_on : null;
  for (let i = 0; ; i++) {
    const date = addMonthsToDate(e.starts_on, i * STEP_MONTHS[e.frequency]);
    if (date > today) return e.ends_on && date > e.ends_on ? null : date;
  }
}

/** A recurring expense's cost per month (a yearly one spread over 12); 0 for a one-off. */
export function monthlyShare(frequency: ExpenseFrequency, amount: number) {
  return frequency === "once" ? 0 : amount / STEP_MONTHS[frequency];
}

/** Every payment up to `until`, converted at the exchange rate of its month. */
export function expensePayments(
  expenses: Expense[],
  until: string,
  toEur: EurConverter,
): ExpensePayment[] {
  return expenses.flatMap((e) =>
    paymentDates(e, until).map((date) => ({
      expenseId: e.id,
      appId: e.app_id,
      date,
      eur: toEur(e.amount, e.currency, date.slice(0, 7)),
    })),
  );
}

/** The payments a Revenue preset covers. */
export function paymentsIn(payments: ExpensePayment[], preset: Preset, now: Date) {
  const months = presetMonths(preset, now);
  if (!months) return payments;
  const wanted = new Set(months);
  return payments.filter((p) => wanted.has(p.date.slice(0, 7)));
}

export function totalEur(payments: ExpensePayment[]) {
  return payments.reduce((total, p) => total + (p.eur ?? 0), 0);
}

export type CostBucket = ChartBucket & { expenses: number; profit: number };

/**
 * Adds what was paid in each bucket of the Revenue chart, and income minus that. Per
 * year (all time), years with costs but no income get a bucket too, so the first
 * developer-account fees show even before the first sale.
 */
export function addCosts(
  buckets: ChartBucket[],
  payments: ExpensePayment[],
  yearly: boolean,
): CostBucket[] {
  const bucketOf = (date: string) => (yearly ? date.slice(0, 4) : date.slice(0, 7));
  const byBucket = new Map<string, CostBucket>(
    buckets.map((b) => [b.bucket, { ...b, expenses: 0, profit: 0 }]),
  );
  if (yearly && payments.length) {
    const years = [...byBucket.keys(), ...payments.map((p) => bucketOf(p.date))].map(Number);
    for (let y = Math.min(...years); y <= Math.max(...years); y++) {
      const year = String(y);
      if (!byBucket.has(year)) {
        byBucket.set(year, {
          bucket: year,
          app_store: 0,
          google_play: 0,
          estimated: false,
          expenses: 0,
          profit: 0,
        });
      }
    }
  }
  for (const p of payments) {
    const b = byBucket.get(bucketOf(p.date));
    if (b) b.expenses += p.eur ?? 0;
  }
  return [...byBucket.values()]
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
    .map((b) => ({ ...b, profit: b.app_store + b.google_play - b.expenses }));
}
