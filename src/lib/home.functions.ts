import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AscError, createAscApi } from "./asc.server";
import { readExpenses } from "./expenses.server";
import {
  attentionItems,
  gameHighlights,
  glance,
  lastChecked,
  needsAppleMembershipExpense,
  profitGlance,
  upcomingItems,
} from "./home";
import { readIncome } from "./income-sync.server";
import { type AppStoreState, type CheckRow, latestVersion, toMonitorApp } from "./monitor";
import { runMonitor } from "./monitor.server";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: not an admin");
}

/** Everything the Home page shows, from what the monitor and income jobs stored. */
export const getHome = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    await assertAdmin(supabase, context.userId);
    const now = new Date();
    // Income and expenses are read as the Revenue page reads them, so the profit here is
    // the one it shows for the same period.
    const [checks, apps, income, expenses] = await Promise.all([
      supabase.from("monitor_checks").select("key, ran_at, state, problem"),
      supabase
        .from("apps")
        .select(
          "id, name, bundle_id, android_package_name, steam_app_id, github_owner, github_repo, is_active, icon_data_url",
        ),
      readIncome(supabase),
      readExpenses(supabase),
    ]);
    for (const res of [checks, apps]) {
      if (res.error) throw new Error(res.error.message);
    }

    const active = apps.data!.filter((a) => a.is_active);
    const input = {
      now,
      apps: active.map(toMonitorApp),
      checks: checks.data as CheckRow[],
      incomeProblems: income.syncProblems.map((p) => ({ source: p.source, problem: p.message })),
      expenses: expenses.expenses,
    };
    return {
      lastChecked: lastChecked(input.checks),
      attention: attentionItems(input),
      upcoming: upcomingItems(input).filter((u) => u.daysLeft >= 0),
      askForAppleMembership: needsAppleMembershipExpense(input.expenses, now),
      profit: profitGlance({
        now,
        incomeRows: income.rows,
        incomeProblems: income.problems,
        incomeCheckedAt: income.checkedAt,
        expenses: expenses.expenses,
        payments: expenses.payments,
      }),
      glance: glance(input),
      games: gameHighlights(input),
      gameCount: active.length,
      icons: Object.fromEntries(active.map((a) => [a.id, a.icon_data_url])) as Record<
        string,
        string | null
      >,
    };
  });

/**
 * Runs every check that hasn't run since `since` (the moment Check now was pressed).
 * `remaining` > 0: the run stopped at its request limit, call it again.
 */
export const runChecks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ since: z.string().datetime() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return runMonitor({ since: new Date(data.since) });
  });

/** Publishes an App Store version that Apple approved and left for the developer to release. */
export const releaseAppStoreVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ appId: z.string().uuid(), versionId: z.string().min(1).max(100) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await assertAdmin(supabase, context.userId);
    // Only a version the checks saw waiting for release, so the button can't publish
    // anything else.
    const { data: row, error } = await supabase
      .from("monitor_checks")
      .select("state")
      .eq("key", "app_store")
      .maybeSingle();
    if (error) throw new Error(error.message);
    const version = latestVersion((row?.state as AppStoreState | undefined)?.apps?.[data.appId]);
    if (
      !version ||
      version.id !== data.versionId ||
      version.state !== "PENDING_DEVELOPER_RELEASE"
    ) {
      throw new Error(
        "That version isn't waiting for release any more. Press Check now to see where it is.",
      );
    }
    const api = await createAscApi();
    if (!api) throw new Error("App Store Connect is not connected to this console.");
    try {
      await api.post("/v1/appStoreVersionReleaseRequests", {
        data: {
          type: "appStoreVersionReleaseRequests",
          relationships: {
            appStoreVersion: { data: { type: "appStoreVersions", id: data.versionId } },
          },
        },
      });
    } catch (err) {
      if (err instanceof AscError && (err.status === 401 || err.status === 403)) {
        throw new Error(
          "App Store Connect didn't let the console release it: its API key needs the Admin or App Manager role. You can release it in App Store Connect meanwhile.",
        );
      }
      throw new Error(`App Store Connect refused the release: ${(err as Error).message}`);
    }
    return { version: version.version };
  });
