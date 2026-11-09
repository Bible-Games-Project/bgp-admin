// Stores an uploaded Steam sales file as income (income_reports, source "steam") and
// logs it (steam_uploads). Reading the file is in steam-sales.ts; this file looks up the
// games, converts dollars to euros, and writes with the service role, like the hourly
// income job, after the server function has checked the uploader is an admin.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database, Json } from "@/integrations/supabase/types";
import { addDays } from "./expenses";
import { eurConverter } from "./income-reports";
import { fetchEurRates } from "./income.server";
import {
  type SteamApp,
  type SteamGame,
  type SteamSaleLine,
  type SteamUpload,
  matchSteamApp,
  parseSteamReportKey,
  parseSteamSales,
  steamAppKey,
  steamCoverage,
  steamProductKey,
  steamReports,
  unknownSteamGame,
} from "./steam-sales";

/** Steam package IDs looked up per upload at most; a partner has a handful. */
const PACKAGE_LOOKUPS = 10;

/**
 * The game a Steam package belongs to, from Steam's public store API (one package per
 * request: it answers nothing useful for several). Null when Steam doesn't say.
 */
async function packageApp(packageId: string): Promise<{ appId: number; name: string } | null> {
  try {
    const res = await fetch(
      `https://store.steampowered.com/api/packagedetails?packageids=${encodeURIComponent(packageId)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const app = (await res.json())?.[packageId]?.data?.apps?.[0];
    return typeof app?.id === "number" ? { appId: app.id, name: String(app.name ?? "") } : null;
  } catch {
    return null;
  }
}

/**
 * Where each line's income goes: the console game with its Steam App ID (by the App ID or
 * name in the file, else by asking Steam which game the package is), else a row of its
 * own under the game's name.
 */
async function steamGames(lines: SteamSaleLine[], apps: SteamApp[]) {
  const unmatched = [
    ...new Set(
      lines
        .filter((l) => !matchSteamApp(l, apps) && /^\d+$/.test(l.productId))
        .map((l) => l.productId),
    ),
  ].slice(0, PACKAGE_LOOKUPS);
  const packages = new Map(
    await Promise.all(unmatched.map(async (id) => [id, await packageApp(id)] as const)),
  );
  return (line: SteamSaleLine): SteamGame => {
    const app = matchSteamApp(line, apps);
    if (app) return { appKey: steamAppKey(app.steamAppId), appName: app.name };
    const found = packages.get(line.productId);
    if (found) {
      const known = apps.find((a) => a.steamAppId === found.appId);
      return {
        appKey: steamAppKey(found.appId),
        appName: known?.name ?? (found.name || unknownSteamGame(line).appName),
      };
    }
    return unknownSteamGame(line);
  };
}

export type SteamUploadResult = {
  firstDay: string;
  lastDay: string;
  salesDays: number;
  units: number;
  refunds: number;
  netEur: number;
  /** Each game's income in the file, highest first. */
  games: { name: string; netEur: number }[];
};

/**
 * Adds a Steam sales file to Revenue. For every product in it, each day the file covers
 * is replaced, including days it sold nothing on, so the newest file wins wherever two
 * overlap.
 */
export async function storeSteamSales(input: {
  supabase: SupabaseClient<Database>;
  userId: string;
  fileName: string;
  text: string;
}): Promise<SteamUploadResult> {
  const file = parseSteamSales(input.text, input.fileName);

  const { data: appRows, error: appsError } = await input.supabase
    .from("apps")
    .select("name, steam_app_id")
    .not("steam_app_id", "is", null);
  if (appsError) throw new Error(`Could not read the games: ${appsError.message}`);
  const apps: SteamApp[] = (appRows ?? []).map((a) => ({
    steamAppId: Number(a.steam_app_id),
    name: a.name,
  }));

  const toEur = eurConverter(
    file.lines.length
      ? await fetchEurRates(`${file.firstDay.slice(0, 7)}-01`, file.lastDay, ["USD"])
      : { daily: {}, latest: {} },
  );
  const { reports, unconverted } = steamReports(file, await steamGames(file.lines, apps), toEur);
  if (unconverted.length) {
    throw new Error(
      "No exchange rate from dollars to euros could be found right now, so nothing was added. Try again in a few minutes.",
    );
  }

  const db = supabaseAdmin;
  const uploadedAt = new Date().toISOString();
  if (reports.length) {
    const { error } = await db
      .from("income_reports")
      .upsert(
        reports.map((r) => ({ ...r, rows: r.rows as unknown as Json, fetched_at: uploadedAt })),
      );
    if (error) throw new Error(`Could not store the Steam sales: ${error.message}`);
  }
  // Days inside the file's dates on which it sold nothing of a product it has: an older
  // file can't keep sales there. Products the file doesn't have (a file for one game)
  // keep their days.
  const { data: inRange, error: rangeError } = await db
    .from("income_reports")
    .select("report")
    .eq("source", "steam")
    .gte("report", `day:${file.firstDay}`)
    .lt("report", `day:${addDays(file.lastDay, 1)}`);
  if (rangeError) throw new Error(`Could not check the stored Steam days: ${rangeError.message}`);
  const kept = new Set(reports.map((r) => r.report));
  const products = new Set(file.lines.map(steamProductKey));
  const stale = (inRange ?? [])
    .map((r) => r.report)
    .filter((r) => !kept.has(r) && products.has(parseSteamReportKey(r)?.product ?? ""));
  if (stale.length) {
    const { error } = await db
      .from("income_reports")
      .delete()
      .eq("source", "steam")
      .in("report", stale);
    if (error) throw new Error(`Could not replace the older Steam days: ${error.message}`);
  }

  const rows = reports.flatMap((r) => r.rows);
  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const netEur = Math.round(sum((r) => r.netEur) * 100) / 100;
  const units = sum((r) => r.units);
  const salesDays = new Set(file.lines.map((l) => l.day)).size;
  const { error: logError } = await db.from("steam_uploads").insert({
    file_name: input.fileName.slice(0, 200) || "steam-sales.csv",
    first_day: file.firstDay,
    last_day: file.lastDay,
    sales_days: salesDays,
    units,
    net_eur: netEur,
    uploaded_by: input.userId,
    uploaded_at: uploadedAt,
  });
  if (logError)
    throw new Error(
      `The sales were added, but the upload could not be logged: ${logError.message}`,
    );

  const games = new Map<string, number>();
  for (const r of rows) games.set(r.appName, (games.get(r.appName) ?? 0) + r.netEur);
  return {
    firstDay: file.firstDay,
    lastDay: file.lastDay,
    salesDays,
    units,
    refunds: sum((r) => r.refunds),
    netEur,
    games: [...games]
      .map(([name, eur]) => ({ name, netEur: Math.round(eur * 100) / 100 }))
      .sort((a, b) => b.netEur - a.netEur),
  };
}

/** Which days the uploaded Steam files cover; null before the first upload. */
export async function readSteamCoverage(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase
    .from("steam_uploads")
    .select("file_name, first_day, last_day, uploaded_at");
  if (error) throw new Error(error.message);
  return steamCoverage((data ?? []) as SteamUpload[]);
}
