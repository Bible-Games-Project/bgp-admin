// Downloads for the Downloads page: first-time downloads from the App Store's sales
// reports (the ones the income job already reads; free downloads carry no money, so
// Revenue skips them) and installs from Google Play's monthly statistics. Pure, so the
// parsers can be tested with real report lines and the page can aggregate on the client.

import { type IncomeRow, type IncomeSource, type Preset, presetMonths } from "./income";
import { type AscCatalog, parseTable } from "./income-reports";
import { supersededReports } from "./income-sync";

export type DownloadRow = {
  source: IncomeSource;
  /** "2026-08" for a month, or "2025" for a whole year of App Store history. */
  period: string;
  /** Bundle ID or package name. */
  appKey: string;
  appName: string;
  downloads: number;
  /** Google Play: devices with the game installed on the period's last day. */
  activeDevices: number | null;
};

/** One report as the table download_reports keeps it. */
export type StoredDownloads = {
  source: IncomeSource;
  /** The App Store report it came from ("month:2026-08"…), or "installs:<package>:2026-08". */
  report: string;
  period: string;
  version: string | null;
  rows: DownloadRow[];
};

/**
 * First-time downloads in a SALES / SUMMARY report: product types 1 (iPhone), 1F
 * (universal), 1T (iPad), F1 (Mac) and the 1E… custom ones. 3F is a redownload by someone
 * who already had the game, and 7F an update; neither is a new player.
 */
export const FIRST_DOWNLOAD_TYPES = ["1", "1F", "1T", "F1", "1E", "1EP", "1EU"];

export function appStoreDownloadRows(
  report: string,
  period: string,
  catalog: AscCatalog,
): DownloadRow[] {
  const byApp = new Map<string, DownloadRow>();
  for (const r of parseTable(report, "\t")) {
    if (!FIRST_DOWNLOAD_TYPES.includes(r["Product Type Identifier"] ?? "")) continue;
    const units = Number(r.Units);
    if (!(units > 0)) continue;
    const app = catalog.get(r.SKU) ?? catalog.get(r["Apple Identifier"]);
    const appKey = app?.bundleId || r.SKU || r.Title;
    const row = byApp.get(appKey) ?? {
      source: "app_store" as const,
      period,
      appKey,
      appName: app?.name ?? r.Title,
      downloads: 0,
      activeDevices: null,
    };
    row.downloads += units;
    byApp.set(appKey, row);
  }
  return [...byApp.values()];
}

/** "stats/installs/installs_com.x_202609_overview.csv" → its package and month. */
export function installsFile(name: string): { packageName: string; month: string } | null {
  const m = name.match(/^stats\/installs\/installs_(.+)_(\d{4})(\d{2})_overview\.csv$/);
  return m ? { packageName: m[1], month: `${m[2]}-${m[3]}` } : null;
}

/**
 * A month of Google Play's install statistics for one game: "Daily User Installs" (people
 * who installed it that day) added up, and the devices it was on at the month's end.
 */
export function playInstallRows(csv: string, packageName: string, month: string): DownloadRow[] {
  const days = parseTable(csv, ",").filter((r) => r.Date);
  if (!days.length) return [];
  const last = days.reduce((a, b) => (a.Date > b.Date ? a : b));
  return [
    {
      source: "google_play",
      period: month,
      appKey: packageName,
      appName: packageName,
      downloads: days.reduce((sum, r) => sum + (Number(r["Daily User Installs"]) || 0), 0),
      activeDevices: Number(last["Active Device Installs"]) || 0,
    },
  ];
}

/** Every stored report counted once: an App Store month replaces the days read before it. */
export function storedDownloadRows(reports: StoredDownloads[]): DownloadRow[] {
  const superseded = new Set(
    supersededReports(reports.map((r) => ({ ...r, unconverted: [] }))).map(
      (r) => `${r.source}|${r.report}`,
    ),
  );
  const merged = new Map<string, DownloadRow>();
  for (const report of reports) {
    if (superseded.has(`${report.source}|${report.report}`)) continue;
    for (const r of report.rows) {
      const key = `${r.source}|${r.period}|${r.appKey}`;
      const m = merged.get(key);
      if (!m) merged.set(key, { ...r });
      else {
        m.downloads += r.downloads;
        m.activeDevices = r.activeDevices ?? m.activeDevices;
      }
    }
  }
  return [...merged.values()];
}

/**
 * The rows a preset covers, each counted once: all time uses the App Store's whole-year
 * rows where it has them, the other presets its months (same rule as Revenue).
 */
export function selectDownloadRows(rows: DownloadRow[], preset: Preset, now: Date): DownloadRow[] {
  const months = presetMonths(preset, now);
  if (months) {
    const wanted = new Set(months);
    return rows.filter((r) => wanted.has(r.period));
  }
  const wholeYears = new Set(
    rows.filter((r) => r.source === "app_store" && r.period.length === 4).map((r) => r.period),
  );
  return rows.filter(
    (r) =>
      !(r.source === "app_store" && r.period.length === 7 && wholeYears.has(r.period.slice(0, 4))),
  );
}

export type DownloadBucket = { bucket: string; app_store: number; google_play: number };

/** Downloads per month for the month-based presets, per year for all time. */
export function downloadBuckets(rows: DownloadRow[], preset: Preset, now: Date): DownloadBucket[] {
  const months = presetMonths(preset, now);
  const bucketOf = (period: string) => (months ? period : period.slice(0, 4));
  const keys = months ?? [...new Set(rows.map((r) => r.period.slice(0, 4)))].sort();
  const buckets = new Map(keys.map((k) => [k, { bucket: k, app_store: 0, google_play: 0 }]));
  for (const r of rows) {
    const b = buckets.get(bucketOf(r.period));
    if (b) b[r.source] += r.downloads;
  }
  return [...buckets.values()];
}

/* ------------------------------------------------------------------------------------ */
/* Per game, with conversion                                                             */
/* ------------------------------------------------------------------------------------ */

export type DownloadsGame = {
  id: string;
  name: string;
  /** Bundle ID and package name, the keys its rows carry. */
  keys: { ios: string | null; android: string | null };
  /** The full game this one is the free demo of. */
  fullGameId: string | null;
};

export type Conversion =
  /** Every download is a sale. */
  | { kind: "paid" }
  /** In-app purchases per download of a free game. */
  | { kind: "in_app"; purchases: number; rate: number | null }
  /** Full-game sales per demo download, in the stores the demo is on. */
  | { kind: "demo"; fullGame: string; sales: number; rate: number | null }
  | { kind: "none" };

export type GameDownloads = {
  id: string;
  name: string;
  app_store: number;
  google_play: number;
  total: number;
  activeDevices: number | null;
  conversion: Conversion;
};

const PURCHASE_KINDS = ["in_app", "subscription"];

/**
 * Each game's downloads in the rows given (already cut to a period and a store), and what
 * share of them turned into money. `income` must be cut the same way.
 */
export function gameDownloads(
  games: DownloadsGame[],
  rows: DownloadRow[],
  income: IncomeRow[],
): GameDownloads[] {
  const keysOf = (g: DownloadsGame) => [g.keys.ios, g.keys.android].filter(Boolean) as string[];
  const rowsOf = (g: DownloadsGame) => rows.filter((r) => keysOf(g).includes(r.appKey));
  const incomeOf = (g: DownloadsGame, sources?: Set<IncomeSource>) =>
    income.filter((r) => keysOf(g).includes(r.appKey) && (!sources || sources.has(r.source)));
  const units = (list: IncomeRow[], kinds: string[]) =>
    list.filter((r) => kinds.includes(r.kind)).reduce((s, r) => s + r.units, 0);

  return games
    .map((g) => {
      const own = rowsOf(g);
      const sum = (source: IncomeSource) =>
        own.filter((r) => r.source === source).reduce((s, r) => s + r.downloads, 0);
      const app_store = sum("app_store");
      const google_play = sum("google_play");
      const total = app_store + google_play;
      // The latest month's count of devices, per store, added up.
      const latest = (source: IncomeSource) =>
        own
          .filter((r) => r.source === source && r.activeDevices != null)
          .sort((a, b) => b.period.localeCompare(a.period))[0]?.activeDevices ?? null;
      const devices = latest("google_play");

      const ownIncome = incomeOf(g);
      const rate = (n: number) => (total ? n / total : null);
      let conversion: Conversion = { kind: "none" };
      const full = g.fullGameId ? games.find((x) => x.id === g.fullGameId) : undefined;
      if (full) {
        const stores = new Set(own.filter((r) => r.downloads).map((r) => r.source));
        const sales = units(incomeOf(full, stores), ["paid_app"]);
        conversion = { kind: "demo", fullGame: full.name, sales, rate: rate(sales) };
      } else if (units(ownIncome, ["paid_app"]) > 0) {
        conversion = { kind: "paid" };
      } else if (units(ownIncome, PURCHASE_KINDS) > 0) {
        const purchases = units(ownIncome, PURCHASE_KINDS);
        conversion = { kind: "in_app", purchases, rate: rate(purchases) };
      }
      return {
        id: g.id,
        name: g.name,
        app_store,
        google_play,
        total,
        activeDevices: devices,
        conversion,
      };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
