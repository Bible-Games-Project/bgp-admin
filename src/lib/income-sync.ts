// Decides which store reports the income job still has to download, and which stored
// ones the Revenue page counts. Pure (no fetch, no database), so it can be tested;
// income.server.ts downloads the reports and income-sync.server.ts stores them.

import { type IncomeRow, type IncomeSource, addMonths, mergeRows, monthKey } from "./income";
import { pickEarningsFiles, reportMonth } from "./income-reports";

/** How often the job runs. The cron in vite.config.ts has to match. */
export const SYNC_EVERY_MINUTES = 60;

// Apple's yearly reports for 2023 and 2024 were checked on 2026-09-29: both empty.
export const FIRST_SALES_YEAR = 2025;

/**
 * The most report files one run downloads from each store. On Cloudflare's free plan a
 * Worker may make 50 requests per run, database calls included, and an empty table
 * needs about 60 reports, so filling it takes a few runs. After that, a run reads one
 * or two new ones.
 */
export const REPORTS_PER_RUN: Record<IncomeSource, number> = { app_store: 16, google_play: 8 };

/** One report as the database keeps it (table income_reports). */
export type StoredReport = {
  source: IncomeSource;
  /** "month:2026-08", "year:2025", "day:2026-09-14", "earnings:2026-08", "sales:2026-09". */
  report: string;
  /** The month or year its rows count towards. */
  period: string;
  /** Google Play: its files and their generations. Null for App Store reports. */
  version: string | null;
  /** Currencies left out for want of an exchange rate. */
  unconverted: string[];
  rows: IncomeRow[];
};

/** What the job needs to know about the stored reports, without their rows. */
export type ReportState = Omit<StoredReport, "rows">;

/** True when the report is stored, from the same files, with every sale converted. */
function storedChecker(stored: ReportState[]) {
  const key = (source: IncomeSource, report: string, version: string | null) =>
    `${source}|${report}|${version ?? ""}`;
  const done = new Set(
    stored.filter((r) => !r.unconverted.length).map((r) => key(r.source, r.report, r.version)),
  );
  return (source: IncomeSource, report: string, version: string | null = null) =>
    done.has(key(source, report, version));
}

/* ------------------------------------------------------------------------------------ */
/* App Store                                                                             */
/* ------------------------------------------------------------------------------------ */

export type AppStoreRequest = {
  report: string;
  period: string;
  frequency: "DAILY" | "MONTHLY" | "YEARLY";
  /** The reportDate Apple expects: "2026-09-14", "2026-08" or "2025". */
  date: string;
};

/**
 * The closed months Apple still offers (the last twelve) and the past years, newest
 * first, that aren't stored yet. Once stored, a month stays after Apple drops it.
 */
export function appStoreClosedRequests(stored: ReportState[], now: Date): AppStoreRequest[] {
  const has = storedChecker(stored);
  const current = monthKey(now);
  const requests: AppStoreRequest[] = [];
  for (let i = 1; i <= 12; i++) {
    const month = addMonths(current, -i);
    const report = `month:${month}`;
    if (!has("app_store", report)) {
      requests.push({ report, period: month, frequency: "MONTHLY", date: month });
    }
  }
  for (let year = now.getUTCFullYear() - 1; year >= FIRST_SALES_YEAR; year--) {
    const report = `year:${year}`;
    if (!has("app_store", report)) {
      requests.push({ report, period: String(year), frequency: "YEARLY", date: String(year) });
    }
  }
  return requests;
}

/**
 * The days of the given months, newest first, that aren't stored yet. Apple publishes a
 * day's report the next morning, so the days run up to yesterday.
 */
export function appStoreDayRequests(
  stored: ReportState[],
  months: string[],
  now: Date,
): AppStoreRequest[] {
  const has = storedChecker(stored);
  const today = now.toISOString().slice(0, 10);
  const requests: AppStoreRequest[] = [];
  for (const month of months) {
    const [y, m] = month.split("-").map(Number);
    for (let d = new Date(Date.UTC(y, m - 1, 1)); monthKey(d) === month; ) {
      const day = d.toISOString().slice(0, 10);
      if (day >= today) break;
      const report = `day:${day}`;
      if (!has("app_store", report)) {
        requests.push({ report, period: month, frequency: "DAILY", date: day });
      }
      d = new Date(d.getTime() + 86_400_000);
    }
  }
  return requests.sort((a, b) => b.date.localeCompare(a.date));
}

/* ------------------------------------------------------------------------------------ */
/* Google Play                                                                           */
/* ------------------------------------------------------------------------------------ */

/** A file in Google's reports bucket. The generation changes when Google rewrites it. */
export type BucketFile = { name: string; generation: string };

export type PlayRequest = {
  report: string;
  period: string;
  kind: "earnings" | "sales";
  files: string[];
  version: string;
};

/**
 * One request per month, newest first: its earnings files once Google has closed the
 * month, its estimated sales report until then. Only months whose files changed since
 * they were stored (the current month's sales report changes every day).
 */
export function playRequests(
  stored: ReportState[],
  earnings: BucketFile[],
  sales: BucketFile[],
): PlayRequest[] {
  const has = storedChecker(stored);
  const generation = new Map([...earnings, ...sales].map((f) => [f.name, f.generation]));
  const versionOf = (names: string[]) =>
    names.map((name) => `${name}#${generation.get(name)}`).join(" ");
  const closed = pickEarningsFiles(earnings.map((f) => f.name));
  const requests: PlayRequest[] = [...closed].map(([month, files]) => ({
    report: `earnings:${month}`,
    period: month,
    kind: "earnings",
    files,
    version: versionOf(files),
  }));
  for (const { name } of sales) {
    const month = reportMonth(name);
    if (!month || closed.has(month)) continue;
    requests.push({
      report: `sales:${month}`,
      period: month,
      kind: "sales",
      files: [name],
      version: versionOf([name]),
    });
  }
  return requests
    .filter((r) => !has("google_play", r.report, r.version))
    .sort((a, b) => b.period.localeCompare(a.period));
}

/** Takes requests in order while their files fit in `limit`. */
export function takeFiles(requests: PlayRequest[], limit: number): PlayRequest[] {
  const taken: PlayRequest[] = [];
  let files = 0;
  for (const r of requests) {
    if (files + r.files.length > limit) break;
    taken.push(r);
    files += r.files.length;
  }
  return taken;
}

/* ------------------------------------------------------------------------------------ */
/* Reading the stored reports                                                            */
/* ------------------------------------------------------------------------------------ */

// A month read in pieces (Apple's days, Google's estimate) until the store closes it.
const STAND_IN: Record<IncomeSource, { partial: string; closed: string }> = {
  app_store: { partial: "day:", closed: "month:" },
  google_play: { partial: "sales:", closed: "earnings:" },
};

/** Stand-in reports for a month the store has closed since: the closed report replaces them. */
export function supersededReports<T extends ReportState>(reports: T[]): T[] {
  const closed = new Set(
    reports
      .filter((r) => r.report.startsWith(STAND_IN[r.source].closed))
      .map((r) => `${r.source}|${r.period}`),
  );
  return reports.filter(
    (r) => r.report.startsWith(STAND_IN[r.source].partial) && closed.has(`${r.source}|${r.period}`),
  );
}

/** What the Revenue page gets: every stored report counted once, and what's missing. */
export function storedIncome(reports: StoredReport[]): {
  rows: IncomeRow[];
  unconverted: Record<IncomeSource, string[]>;
} {
  const superseded = new Set(supersededReports(reports));
  const counted = reports.filter((r) => !superseded.has(r));
  const unconverted = (source: IncomeSource) => [
    ...new Set(counted.filter((r) => r.source === source).flatMap((r) => r.unconverted)),
  ];
  return {
    rows: mergeRows(counted.flatMap((r) => r.rows)),
    unconverted: { app_store: unconverted("app_store"), google_play: unconverted("google_play") },
  };
}
