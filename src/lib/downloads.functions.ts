import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { appStoreIds } from "./app-kind";
import { type DownloadsGame, type StoredDownloads, storedDownloadRows } from "./downloads";
import { type StoredReport, storedIncome } from "./income-sync";

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
 * The downloads the hourly income job has stored, the income it has (for conversion),
 * the games, and whether Google Play's statistics can be read yet.
 */
export const getDownloads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    await assertAdmin(supabase, context.userId);
    const [downloads, income, apps, sync] = await Promise.all([
      supabase.from("download_reports").select("source, report, period, version, rows"),
      supabase.from("income_reports").select("source, report, period, version, unconverted, rows"),
      supabase
        .from("apps")
        .select(
          "id, name, bundle_id, android_package_name, steam_app_id, github_owner, github_repo, is_active, full_game_id",
        ),
      supabase.from("income_sync").select("source, checked_at, problem"),
    ]);
    for (const res of [downloads, income, apps, sync]) {
      if (res.error) throw new Error(res.error.message);
    }
    const games: DownloadsGame[] = apps
      .data!.filter((a) => a.is_active)
      .map((a) => {
        const ids = appStoreIds(a);
        return {
          id: a.id,
          name: a.name.trim(),
          keys: { ios: ids.ios, android: ids.android },
          fullGameId: a.full_game_id,
        };
      })
      .filter((g) => g.keys.ios || g.keys.android)
      .sort((a, b) => a.name.localeCompare(b.name));
    const checks = sync.data!.map((s) => s.checked_at).sort();
    return {
      rows: storedDownloadRows(downloads.data as unknown as StoredDownloads[]),
      income: storedIncome(income.data as unknown as StoredReport[]).rows,
      games,
      // Google Play's statistics live in the same bucket as its financial reports.
      playProblem: sync.data!.find((s) => s.source === "google_play")?.problem ?? null,
      checkedAt: checks.length === 2 ? checks[0] : null,
    };
  });

/** Marks a game as the free demo of another (or of none). */
export const setFullGame = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ appId: z.string().uuid(), fullGameId: z.string().uuid().nullable() })
      .refine((v) => v.appId !== v.fullGameId, "A game can't be its own demo")
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("apps")
      .update({ full_game_id: data.fullGameId })
      .eq("id", data.appId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
