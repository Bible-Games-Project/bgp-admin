import { describe, expect, test } from "bun:test";
import type { IncomeRow } from "./income";
import {
  type ReportState,
  type StoredReport,
  appStoreClosedRequests,
  appStoreDayRequests,
  playRequests,
  storedIncome,
  supersededReports,
  takeFiles,
} from "./income-sync";

const now = new Date("2026-09-04T10:00:00Z");

const state = (report: string, period: string, extra: Partial<ReportState> = {}): ReportState => ({
  source: report.startsWith("earnings") || report.startsWith("sales") ? "google_play" : "app_store",
  report,
  period,
  version: null,
  unconverted: [],
  ...extra,
});

const row = (period: string, netEur: number, extra: Partial<IncomeRow> = {}): IncomeRow => ({
  source: "app_store",
  period,
  appKey: "com.JoanSabe.TheLostSheep",
  appName: "The Lost Sheep",
  productId: "app",
  productName: "Paid download",
  kind: "paid_app",
  units: 1,
  refunds: 0,
  netEur,
  estimated: false,
  ...extra,
});

describe("App Store requests", () => {
  test("asks for the last twelve closed months and the past years, newest first", () => {
    const requests = appStoreClosedRequests([], now);
    expect(requests.map((r) => r.report)).toEqual([
      "month:2026-08",
      "month:2026-07",
      "month:2026-06",
      "month:2026-05",
      "month:2026-04",
      "month:2026-03",
      "month:2026-02",
      "month:2026-01",
      "month:2025-12",
      "month:2025-11",
      "month:2025-10",
      "month:2025-09",
      "year:2025",
    ]);
    expect(requests[0]).toEqual({
      report: "month:2026-08",
      period: "2026-08",
      frequency: "MONTHLY",
      date: "2026-08",
    });
  });

  test("skips what is stored, but asks again for a report with sales left out", () => {
    const stored = [
      state("month:2026-08", "2026-08"),
      state("year:2025", "2025"),
      state("month:2026-07", "2026-07", { unconverted: ["COP"] }),
    ];
    const reports = appStoreClosedRequests(stored, now).map((r) => r.report);
    expect(reports).not.toContain("month:2026-08");
    expect(reports).not.toContain("year:2025");
    expect(reports).toContain("month:2026-07");
  });

  test("reads the days up to yesterday, newest first, skipping stored ones", () => {
    const stored = [state("day:2026-09-01", "2026-09")];
    expect(appStoreDayRequests(stored, ["2026-09"], now)).toEqual([
      { report: "day:2026-09-03", period: "2026-09", frequency: "DAILY", date: "2026-09-03" },
      { report: "day:2026-09-02", period: "2026-09", frequency: "DAILY", date: "2026-09-02" },
    ]);
  });

  test("reads every day of a month Apple has not closed yet", () => {
    const days = appStoreDayRequests([], ["2026-09", "2026-08"], now);
    expect(days).toHaveLength(3 + 31);
    expect(days.at(-1)?.report).toBe("day:2026-08-01");
    expect(days.every((d) => d.period === d.date.slice(0, 7))).toBe(true);
  });
});

describe("Google Play requests", () => {
  const earnings = [
    { name: "earnings/earnings_202607_18821660-1.zip", generation: "11" },
    { name: "earnings/earnings_202608_18821660-1.zip", generation: "12" },
  ];
  const sales = [
    { name: "sales/salesreport_202607.zip", generation: "21" },
    { name: "sales/salesreport_202608.zip", generation: "22" },
    { name: "sales/salesreport_202609.zip", generation: "23" },
  ];

  test("uses earnings for closed months and sales for the rest, newest first", () => {
    expect(playRequests([], earnings, sales)).toEqual([
      {
        report: "sales:2026-09",
        period: "2026-09",
        kind: "sales",
        files: ["sales/salesreport_202609.zip"],
        version: "sales/salesreport_202609.zip#23",
      },
      {
        report: "earnings:2026-08",
        period: "2026-08",
        kind: "earnings",
        files: ["earnings/earnings_202608_18821660-1.zip"],
        version: "earnings/earnings_202608_18821660-1.zip#12",
      },
      {
        report: "earnings:2026-07",
        period: "2026-07",
        kind: "earnings",
        files: ["earnings/earnings_202607_18821660-1.zip"],
        version: "earnings/earnings_202607_18821660-1.zip#11",
      },
    ]);
  });

  test("reads a month again only when Google rewrote its files", () => {
    const stored = [
      state("earnings:2026-08", "2026-08", {
        version: "earnings/earnings_202608_18821660-1.zip#12",
      }),
      state("earnings:2026-07", "2026-07", {
        version: "earnings/earnings_202607_18821660-1.zip#11",
      }),
      state("sales:2026-09", "2026-09", { version: "sales/salesreport_202609.zip#20" }),
    ];
    expect(playRequests(stored, earnings, sales).map((r) => r.report)).toEqual(["sales:2026-09"]);
  });

  test("takes whole months while their files fit", () => {
    const requests = playRequests([], earnings, sales);
    expect(takeFiles(requests, 2).map((r) => r.report)).toEqual([
      "sales:2026-09",
      "earnings:2026-08",
    ]);
    expect(takeFiles(requests, 0)).toEqual([]);
  });
});

describe("stored income", () => {
  const report = (
    key: string,
    period: string,
    rows: IncomeRow[],
    extra: Partial<StoredReport> = {},
  ): StoredReport => ({ ...state(key, period), rows, ...extra });

  test("a closed month replaces the days and the estimate it was read from", () => {
    const reports = [
      report("month:2026-08", "2026-08", []),
      report("day:2026-08-30", "2026-08", []),
      report("day:2026-09-01", "2026-09", []),
      report("sales:2026-08", "2026-08", []),
      report("earnings:2026-08", "2026-08", []),
      report("sales:2026-09", "2026-09", []),
    ];
    expect(supersededReports(reports).map((r) => r.report)).toEqual([
      "day:2026-08-30",
      "sales:2026-08",
    ]);
  });

  test("adds the days of a month up and leaves out superseded reports", () => {
    const { rows } = storedIncome([
      report("day:2026-09-01", "2026-09", [row("2026-09", 2)]),
      report("day:2026-09-02", "2026-09", [row("2026-09", 3)]),
      report("month:2026-08", "2026-08", [row("2026-08", 10)]),
      report("day:2026-08-31", "2026-08", [row("2026-08", 99)]),
    ]);
    expect(rows.map((r) => [r.period, r.netEur, r.units])).toEqual([
      ["2026-09", 5, 2],
      ["2026-08", 10, 1],
    ]);
  });

  test("names each store's currencies left out", () => {
    const { unconverted } = storedIncome([
      report("month:2026-08", "2026-08", [], { unconverted: ["COP", "CLP"] }),
      report("day:2026-09-01", "2026-09", [], { unconverted: ["COP"] }),
    ]);
    expect(unconverted).toEqual({ app_store: ["COP", "CLP"], google_play: [] });
  });
});
