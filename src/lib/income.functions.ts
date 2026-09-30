import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { IncomeSource } from "./income";
import { type StoredReport, storedIncome } from "./income-sync";
import { syncIncome } from "./income-sync.server";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: not an admin");
}

/**
 * The income the hourly job has stored, when it last ran (null: never), and what each
 * store is missing.
 */
export const getIncome = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    await assertAdmin(supabase, context.userId);
    const [reports, sync] = await Promise.all([
      supabase.from("income_reports").select("source, report, period, version, unconverted, rows"),
      supabase.from("income_sync").select("source, checked_at, problem"),
    ]);
    if (reports.error) throw new Error(reports.error.message);
    if (sync.error) throw new Error(sync.error.message);

    const { rows, unconverted } = storedIncome(reports.data as unknown as StoredReport[]);
    const problems: { source: IncomeSource; message: string }[] = [];
    for (const s of sync.data) {
      if (s.problem) problems.push({ source: s.source as IncomeSource, message: s.problem });
    }
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
      checkedAt: checks.length === 2 ? checks[0] : null,
    };
  });

/** Runs the hourly job now. `remaining` > 0: it stopped at its limit, run it again. */
export const refreshIncome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    return syncIncome();
  });
