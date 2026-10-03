// Keeps the stores' sales reports in the database (income_reports) for the Revenue page
// and Home, and the downloads they and Google's install statistics hold (download_reports)
// for the Downloads page. Runs every hour on the Worker (src/tasks/income-sync.ts) and whenever
// someone presses Refresh on the page. It writes with the service role: the hourly run
// has no user.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database, Json } from "@/integrations/supabase/types";
import type { StoredDownloads } from "./downloads";
import type { IncomeSource } from "./income";
import {
  type ReportState,
  type StoredReport,
  storedIncome,
  supersededReports,
} from "./income-sync";
import { syncAppStore, syncGooglePlay, syncGooglePlayInstalls } from "./income.server";

/**
 * The income the job has stored, as the Revenue page and Home count it: every report
 * once, what each store is missing (`syncProblems`: the reports the job can't read; on
 * top of those, `problems` has the sales left out for want of an exchange rate), and
 * when the job last read both stores (null: never).
 */
export async function readIncome(supabase: SupabaseClient<Database>) {
  const [reports, sync] = await Promise.all([
    supabase.from("income_reports").select("source, report, period, version, unconverted, rows"),
    supabase.from("income_sync").select("source, checked_at, problem"),
  ]);
  if (reports.error) throw new Error(reports.error.message);
  if (sync.error) throw new Error(sync.error.message);

  const { rows, unconverted } = storedIncome(reports.data as unknown as StoredReport[]);
  const syncProblems: { source: IncomeSource; message: string }[] = [];
  for (const s of sync.data) {
    if (s.problem) syncProblems.push({ source: s.source as IncomeSource, message: s.problem });
  }
  const problems = [...syncProblems];
  for (const source of ["app_store", "google_play"] as IncomeSource[]) {
    if (unconverted[source].length) {
      problems.push({
        source,
        message: `Some sales in ${unconverted[source].join(", ")} are left out: no exchange rate to euros was found for that currency.`,
      });
    }
  }
  // The older of the two stores, so "updated" never claims more than both.
  const checks = sync.data.map((s) => s.checked_at).sort();
  return {
    rows,
    problems,
    syncProblems,
    checkedAt: checks.length === 2 ? checks[0] : null,
  };
}

/**
 * Downloads the reports the database lacks. `remaining` is how many are still missing
 * because this run stopped at its limits; the next run goes on from there.
 */
export async function syncIncome(): Promise<{ remaining: number }> {
  const db = supabaseAdmin;
  const [incomeRes, downloadsRes] = await Promise.all([
    db.from("income_reports").select("source, report, period, version, unconverted"),
    db.from("download_reports").select("source, report, period, version"),
  ]);
  if (incomeRes.error) {
    throw new Error(`Could not read the stored income reports: ${incomeRes.error.message}`);
  }
  if (downloadsRes.error) {
    throw new Error(`Could not read the stored downloads: ${downloadsRes.error.message}`);
  }
  const stored = incomeRes.data as ReportState[];
  const storedDownloads = downloadsRes.data as Omit<StoredDownloads, "rows">[];

  // An App Store report counts as stored once both its income and its downloads are:
  // the ones read before downloads were kept are read once more.
  const withDownloads = new Set(
    storedDownloads.filter((r) => r.source === "app_store").map((r) => r.report),
  );
  const appStoreStored = stored.filter(
    (r) => r.source !== "app_store" || withDownloads.has(r.report),
  );

  const [appStore, googlePlay, installs] = await Promise.all([
    syncAppStore(appStoreStored),
    syncGooglePlay(stored),
    syncGooglePlayInstalls(storedDownloads),
  ]);
  const checkedAt = new Date().toISOString();
  const fetched = [...appStore.reports, ...googlePlay.reports];
  if (fetched.length) {
    const { error } = await db
      .from("income_reports")
      .upsert(
        fetched.map((r) => ({ ...r, rows: r.rows as unknown as Json, fetched_at: checkedAt })),
      );
    if (error) throw new Error(`Could not store the income reports: ${error.message}`);
  }
  const fetchedDownloads = [...(appStore.downloads ?? []), ...installs.downloads];
  if (fetchedDownloads.length) {
    const { error } = await db.from("download_reports").upsert(
      fetchedDownloads.map((r) => ({
        ...r,
        rows: r.rows as unknown as Json,
        fetched_at: checkedAt,
      })),
    );
    if (error) throw new Error(`Could not store the downloads: ${error.message}`);
  }

  // A month the store has closed since replaces the days or the estimate it was read from.
  const superseded = supersededReports([...stored, ...fetched]);
  const supersededDownloads = supersededReports(
    [...storedDownloads, ...fetchedDownloads].map((r) => ({ ...r, unconverted: [] })),
  );
  for (const source of ["app_store", "google_play"] as IncomeSource[]) {
    const reports = superseded.filter((r) => r.source === source).map((r) => r.report);
    if (reports.length) {
      const { error } = await db
        .from("income_reports")
        .delete()
        .eq("source", source)
        .in("report", reports);
      // Not fatal: the page skips superseded reports, and the next run tries again.
      if (error) console.error(`Could not drop the superseded ${source} reports: ${error.message}`);
    }
  }
  const oldDays = supersededDownloads.filter((r) => r.source === "app_store").map((r) => r.report);
  if (oldDays.length) {
    const { error } = await db
      .from("download_reports")
      .delete()
      .eq("source", "app_store")
      .in("report", oldDays);
    if (error) console.error(`Could not drop the superseded download reports: ${error.message}`);
  }

  const { error: statusError } = await db.from("income_sync").upsert([
    { source: "app_store", checked_at: checkedAt, problem: appStore.problem ?? null },
    { source: "google_play", checked_at: checkedAt, problem: googlePlay.problem ?? null },
  ]);
  if (statusError) throw new Error(`Could not record the income run: ${statusError.message}`);

  return { remaining: appStore.remaining + googlePlay.remaining + installs.remaining };
}
