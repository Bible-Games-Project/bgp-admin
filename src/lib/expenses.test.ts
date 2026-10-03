import { describe, expect, test } from "bun:test";
import {
  type Expense,
  addCosts,
  addDays,
  addMonthsToDate,
  expensePayments,
  isRunning,
  monthlyShare,
  nextPaymentDate,
  paymentDates,
  paymentsIn,
  periodProfit,
  priceLabel,
  totalEur,
} from "./expenses";
import { chartBuckets } from "./income";
import { eurConverter } from "./income-reports";

const expense = (patch: Partial<Expense> = {}): Expense => ({
  id: "e1",
  name: "Claude",
  amount: 20,
  currency: "USD",
  frequency: "monthly",
  starts_on: "2026-01-31",
  ends_on: null,
  app_id: null,
  notes: null,
  ...patch,
});

describe("dates", () => {
  test("addMonthsToDate keeps the day, or the month's last day when it is shorter", () => {
    expect(addMonthsToDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDate("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonthsToDate("2024-02-29", 12)).toBe("2025-02-28");
    expect(addMonthsToDate("2026-11-15", 3)).toBe("2027-02-15");
  });

  test("addDays crosses months and years", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("paymentDates", () => {
  test("a monthly subscription started on the 31st keeps the 31st after February", () => {
    expect(paymentDates(expense(), "2026-04-29")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
  });

  test("counts a payment due today, and none after a cancellation", () => {
    const yearly = expense({ frequency: "yearly", starts_on: "2024-03-12" });
    expect(paymentDates(yearly, "2026-03-12")).toEqual(["2024-03-12", "2025-03-12", "2026-03-12"]);
    expect(paymentDates({ ...yearly, ends_on: "2026-03-11" }, "2026-09-30")).toEqual([
      "2024-03-12",
      "2025-03-12",
    ]);
  });

  test("a one-off payment counts once it is paid", () => {
    const once = expense({ frequency: "once", starts_on: "2026-10-05" });
    expect(paymentDates(once, "2026-09-30")).toEqual([]);
    expect(paymentDates(once, "2026-10-05")).toEqual(["2026-10-05"]);
  });

  test("a subscription starting later has no payments yet", () => {
    expect(paymentDates(expense({ starts_on: "2026-10-01" }), "2026-09-30")).toEqual([]);
  });
});

describe("nextPaymentDate", () => {
  test("is the first payment after today", () => {
    expect(nextPaymentDate(expense(), "2026-02-28")).toBe("2026-03-31");
    expect(nextPaymentDate(expense({ starts_on: "2026-10-01" }), "2026-09-30")).toBe("2026-10-01");
  });

  test("is null once cancelled, or for a one-off already paid", () => {
    expect(nextPaymentDate(expense({ ends_on: "2026-03-30" }), "2026-03-01")).toBeNull();
    expect(nextPaymentDate(expense({ frequency: "once" }), "2026-02-01")).toBeNull();
  });
});

test("isRunning: recurring and not cancelled yet", () => {
  expect(isRunning(expense(), "2026-09-30")).toBe(true);
  expect(isRunning(expense({ ends_on: "2026-09-30" }), "2026-09-30")).toBe(true);
  expect(isRunning(expense({ ends_on: "2026-09-29" }), "2026-09-30")).toBe(false);
  expect(isRunning(expense({ frequency: "once" }), "2026-09-30")).toBe(false);
});

test("monthlyShare spreads a yearly fee over 12 months", () => {
  expect(monthlyShare("yearly", 99)).toBe(8.25);
  expect(monthlyShare("monthly", 20)).toBe(20);
  expect(monthlyShare("once", 25)).toBe(0);
});

test("priceLabel", () => {
  expect(priceLabel(expense())).toBe("$20.00 a month");
  expect(priceLabel(expense({ amount: 99, currency: "EUR", frequency: "yearly" }))).toBe(
    "€99.00 a year",
  );
});

describe("expensePayments", () => {
  test("converts dollars at the rate of each payment's month", () => {
    const toEur = eurConverter({
      daily: { "2026-01-15": { USD: 1.25 }, "2026-02-16": { USD: 1 } },
      latest: {},
    });
    const payments = expensePayments(
      [
        expense(),
        expense({ id: "e2", currency: "EUR", amount: 99, frequency: "once", app_id: "a1" }),
      ],
      "2026-02-28",
      toEur,
    );
    expect(payments).toEqual([
      { expenseId: "e1", appId: null, date: "2026-01-31", eur: 16 },
      { expenseId: "e1", appId: null, date: "2026-02-28", eur: 20 },
      { expenseId: "e2", appId: "a1", date: "2026-01-31", eur: 99 },
    ]);
    expect(totalEur(payments)).toBe(135);
  });

  test("leaves a payment without a rate as null", () => {
    const toEur = eurConverter({ daily: {}, latest: {} });
    expect(expensePayments([expense()], "2026-01-31", toEur)[0].eur).toBeNull();
  });
});

describe("Revenue chart", () => {
  const now = new Date("2026-09-30T10:00:00Z");
  const payment = (date: string, eur: number) => ({ expenseId: "e", appId: null, date, eur });

  test("paymentsIn keeps the preset's months", () => {
    const payments = [payment("2025-09-01", 1), payment("2025-10-01", 2), payment("2026-09-30", 3)];
    expect(paymentsIn(payments, "12m", now).map((p) => p.eur)).toEqual([2, 3]);
    expect(paymentsIn(payments, "all", now)).toHaveLength(3);
  });

  test("addCosts takes each month's costs off its income", () => {
    const buckets = addCosts(
      chartBuckets([], "month", now),
      [payment("2026-09-12", 99), payment("2026-09-30", 17)],
      false,
    );
    expect(buckets).toEqual([
      {
        bucket: "2026-09",
        app_store: 0,
        google_play: 0,
        estimated: false,
        expenses: 116,
        profit: -116,
      },
    ]);
  });

  test("per year, years with costs before the first sale get a bucket", () => {
    const buckets = addCosts(
      [{ bucket: "2026", app_store: 50, google_play: 10, estimated: false }],
      [payment("2024-03-12", 99), payment("2026-03-12", 99)],
      true,
    );
    expect(buckets.map((b) => [b.bucket, b.expenses, b.profit])).toEqual([
      ["2024", 99, -99],
      ["2025", 0, 0],
      ["2026", 99, -39],
    ]);
  });
});

describe("periodProfit", () => {
  const now = new Date("2026-09-30T10:00:00Z");
  const row = (period: string, netEur: number) => ({
    source: "app_store" as const,
    period,
    appKey: "a",
    appName: "A",
    productId: "p",
    productName: "P",
    kind: "paid_app" as const,
    units: 1,
    refunds: 0,
    netEur,
    estimated: false,
  });
  const paid = (date: string, eur: number | null) => ({ expenseId: "e", appId: null, date, eur });

  test("picks the preset's months for income and payments alike", () => {
    const p = periodProfit(
      [row("2026-09", 30), row("2026-08", 20), row("2025", 100)],
      [paid("2026-09-01", 12), paid("2026-08-01", null), paid("2025-06-01", 99)],
      "month",
      now,
    );
    expect(p.rows.map((r) => r.period)).toEqual(["2026-09"]);
    expect(p.payments.map((x) => x.date)).toEqual(["2026-09-01"]);
    expect(p.income.netEur).toBe(30);
    expect(p.spent).toBe(12);
    expect(p.profit).toBe(18);
  });

  test("all time counts Apple's whole years instead of their months", () => {
    const p = periodProfit(
      [row("2025", 100), row("2025-12", 40), row("2026-01", 5)],
      [paid("2025-06-01", 99), paid("2026-01-01", null)],
      "all",
      now,
    );
    expect(p.income.netEur).toBe(105);
    // A payment without an exchange rate counts as 0 €, as on the Revenue page.
    expect(p.spent).toBe(99);
    expect(p.profit).toBe(6);
  });
});
