// Keeps the stores' sales reports in the database (income_reports) for the Revenue page.
// Runs every hour on the Worker (src/tasks/income-sync.ts) and whenever someone presses
// Refresh on the page. It writes with the service role: the hourly run has no user.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import type { IncomeSource } from "./income";
import { type ReportState, supersededReports } from "./income-sync";
import { syncAppStore, syncGooglePlay } from "./income.server";

/**
 * Downloads the reports the database lacks. `remaining` is how many are still missing
 * because this run stopped at REPORTS_PER_RUN; the next run goes on from there.
 */
export async function syncIncome(): Promise<{ remaining: number }> {
  const db = supabaseAdmin;
  const { data, error } = await db
    .from("income_reports")
    .select("source, report, period, version, unconverted");
  if (error) throw new Error(`Could not read the stored income reports: ${error.message}`);
  const stored = data as ReportState[];

  const [appStore, googlePlay] = await Promise.all([syncAppStore(stored), syncGooglePlay(stored)]);
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

  // A month the store has closed since replaces the days or the estimate it was read from.
  const superseded = supersededReports([...stored, ...fetched]);
  for (const source of ["app_store", "google_play"] as IncomeSource[]) {
    const reports = superseded.filter((r) => r.source === source).map((r) => r.report);
    if (!reports.length) continue;
    const { error } = await db
      .from("income_reports")
      .delete()
      .eq("source", source)
      .in("report", reports);
    // Not fatal: the page skips superseded reports, and the next run tries again.
    if (error) console.error(`Could not drop the superseded ${source} reports: ${error.message}`);
  }

  const { error: statusError } = await db.from("income_sync").upsert([
    { source: "app_store", checked_at: checkedAt, problem: appStore.problem ?? null },
    { source: "google_play", checked_at: checkedAt, problem: googlePlay.problem ?? null },
  ]);
  if (statusError) throw new Error(`Could not record the income run: ${statusError.message}`);

  return { remaining: appStore.remaining + googlePlay.remaining };
}
