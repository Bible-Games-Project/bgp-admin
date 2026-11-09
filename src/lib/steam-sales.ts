// Steam income from the sales file an admin downloads from Steamworks and uploads on the
// Revenue page. Steam's Financial API (IPartnerFinancialsService) answered with no data
// for this partner, so the console can't read Steam sales by itself; this is the way in.
//
// The file is the Sales & Activations Reports CSV: on partner.steampowered.com, the
// "view as .csv" link next to the date selection. Valve listed its columns when it last
// changed them (Steamworks Development announcement "Changes to Sales & Activations CSV",
// 2017-10-03): Date, Bundle(ID#), Bundle Name, Product(ID#), Product Name, Type, Game,
// Platform, Country Code, Country, Region, Gross Units Sold, Chargeback/Returns, Net Units
// Sold, Base Price, Sale Price, Currency, Gross Steam Sales (USD), Chargeback/Returns
// (USD), VAT/Tax (USD), Net Steam Sales (USD), Tag. Columns are found by name, so their
// order, title lines above them and small spelling changes don't matter.
//
// Pure (no fetch, no database), so it can be tested; steam-sales.server.ts stores it.

import { addDays } from "./expenses";
import type { IncomeRow, ProductKind } from "./income";
import { type EurConverter, parseTable } from "./income-reports";
import type { StoredReport } from "./income-sync";

/**
 * What Valve pays out of each net sale: 70%, its standard share for a game's first
 * $10 million. "Net Steam Sales" in the file is before that share (after refunds,
 * chargebacks and VAT), so the console takes it off, like the App Store and Google Play
 * amounts, which are after their fees.
 */
export const STEAM_DEVELOPER_SHARE = 0.7;

/** One line of the file: one product sold on one day (in one country, on one platform). */
export type SteamSaleLine = {
  /** YYYY-MM-DD, in Pacific time like every Steam report. */
  day: string;
  game: string;
  productId: string;
  productName: string;
  type: string;
  /** Units sold minus units returned or charged back. */
  netUnits: number;
  returnedUnits: number;
  /** After returns, chargebacks and VAT, before Valve's share. */
  netUsd: number;
};

export type SteamSalesFile = {
  lines: SteamSaleLine[];
  /**
   * The days the file covers: the range in its name or title when it has one (a day with
   * no sales has no line), else its first and last sale.
   */
  firstDay: string;
  lastDay: string;
};

/** A file that can't be read, with what to do about it. */
export class SteamFileError extends Error {}

const HOW_TO_GET_IT =
  'On partner.steampowered.com, pick the dates and press "view as .csv" next to them, then upload that file here as it is.';

const COLUMNS = {
  date: ["date"],
  game: ["game"],
  productId: ["productid", "product"],
  productName: ["productname"],
  type: ["type"],
  grossUnits: ["grossunitssold"],
  returnedUnits: ["chargebackreturns", "chargebacksreturns", "returns", "returnedunits"],
  netUnits: ["netunitssold"],
  grossUsd: ["grosssteamsalesusd", "grosssalesusd"],
  returnsUsd: ["chargebackreturnsusd", "chargebacksreturnsusd", "returnsusd"],
  taxUsd: ["vattaxusd", "vatusd", "taxusd"],
  netUsd: ["netsteamsalesusd", "netsalesusd"],
} as const;

type Column = keyof typeof COLUMNS;

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Reads the file. A spreadsheet app may have saved it again with semicolons and decimal
 * commas (Excel in Spanish does), which is fine; dates it rewrote as day/month are not,
 * since they can't be told apart from Steam's month/day ones.
 */
export function parseSteamSales(text: string, fileName = ""): SteamSalesFile {
  const body = text.replace(/^\uFEFF/, "");
  const lines = body.split(/\r?\n/);
  const headerAt = lines.findIndex((l) => {
    const n = normalize(l);
    return n.includes("date") && (n.includes("netsteamsales") || n.includes("grosssteamsales"));
  });
  if (headerAt < 0) {
    throw new SteamFileError(
      `This isn't Steam's sales file: it has no "Net Steam Sales (USD)" column. ${HOW_TO_GET_IT}`,
    );
  }
  const header = lines[headerAt];
  const counts = { ",": 0, ";": 0, "\t": 0 };
  for (const c of header) if (c in counts) counts[c as keyof typeof counts]++;
  const delimiter = (Object.keys(counts) as (keyof typeof counts)[]).sort(
    (a, b) => counts[b] - counts[a],
  )[0];
  const decimalComma = delimiter === ";";

  const table = parseTable(lines.slice(headerAt).join("\n"), delimiter);
  const keys = Object.keys(table[0] ?? headerKeys(header, delimiter));
  const find = (column: Column) =>
    keys.find((k) => (COLUMNS[column] as readonly string[]).includes(normalize(k)));
  const col = Object.fromEntries(
    (Object.keys(COLUMNS) as Column[]).map((c) => [c, find(c)]),
  ) as Record<Column, string | undefined>;
  if (!col.date || !(col.netUsd || col.grossUsd)) {
    throw new SteamFileError(
      `This isn't Steam's sales file: it has no "Date" or "Net Steam Sales (USD)" column. ${HOW_TO_GET_IT}`,
    );
  }

  const num = (row: Record<string, string>, column: Column, line: number): number => {
    const key = col[column];
    if (!key) return 0;
    const n = parseAmount(row[key] ?? "", decimalComma);
    if (Number.isNaN(n)) {
      throw new SteamFileError(
        `Line ${line} of the file has "${row[key]}" as ${key}, which isn't a number. ${HOW_TO_GET_IT}`,
      );
    }
    return n;
  };

  const sales: SteamSaleLine[] = [];
  table.forEach((row, i) => {
    const line = headerAt + i + 2;
    const date = (row[col.date!] ?? "").trim();
    // Totals or notes under the table.
    if (!date || /total/i.test(date)) return;
    const day = parseDay(date, delimiter);
    if (!day) {
      throw new SteamFileError(
        `Line ${line} of the file has "${date}" as its date, and dates have to look like 2026-03-15. ` +
          "If the file was opened and saved in a spreadsheet app, download it from Steam again and upload it without opening it.",
      );
    }
    const returnedUnits = Math.abs(num(row, "returnedUnits", line));
    const netUnits = col.netUnits
      ? num(row, "netUnits", line)
      : num(row, "grossUnits", line) - returnedUnits;
    const netUsd = col.netUsd
      ? num(row, "netUsd", line)
      : num(row, "grossUsd", line) -
        Math.abs(num(row, "returnsUsd", line)) -
        Math.abs(num(row, "taxUsd", line));
    // Key activations and other lines that moved no money and sold nothing.
    if (!netUsd && !netUnits && !returnedUnits) return;
    sales.push({
      day,
      game: (col.game && row[col.game]?.trim()) || "",
      productId: (col.productId && row[col.productId]?.trim()) || "",
      productName: (col.productName && row[col.productName]?.trim()) || "",
      type: (col.type && row[col.type]?.trim()) || "",
      netUnits,
      returnedUnits,
      netUsd,
    });
  });

  const days = sales.map((s) => s.day).sort();
  const declared = declaredRange(fileName) ?? declaredRange(lines.slice(0, headerAt).join(" "));
  const firstDay = [declared?.[0], days[0]].filter(Boolean).sort()[0];
  const lastDay = [declared?.[1], days[days.length - 1]].filter(Boolean).sort().reverse()[0];
  if (!firstDay || !lastDay) {
    throw new SteamFileError(
      "This file has no sales in it and doesn't say which days it covers, so there's nothing to add.",
    );
  }
  return { lines: sales, firstDay, lastDay };
}

function headerKeys(header: string, delimiter: string) {
  return Object.fromEntries(header.split(delimiter).map((k) => [k.replace(/"/g, "").trim(), ""]));
}

/** "$1,234.50", "-3.2", "(3.20)", or "1.234,50" from a spreadsheet that uses decimal commas. */
export function parseAmount(cell: string, decimalComma = false): number {
  let s = cell.trim();
  if (!s) return 0;
  const negative = /^\(.*\)$/.test(s) || s.includes("-");
  s = decimalComma ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  s = s.replace(/[^0-9.]/g, "");
  if (!s || s === ".") return Number.NaN;
  const n = Number(s);
  return negative ? -n : n;
}

/**
 * "2026-03-15", or "3/15/2026" as Steam's US formatting would have it. Day-first dates
 * only come from a spreadsheet app saving the file again, and "03/04/2026" can't be told
 * apart, so a semicolon file must keep the year first.
 */
export function parseDay(cell: string, delimiter: string): string | null {
  const iso = cell.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const us = delimiter === "," ? cell.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/) : null;
  const [y, m, d] = iso
    ? [iso[1], iso[2], iso[3]]
    : us
      ? [us[3], us[1].padStart(2, "0"), us[2].padStart(2, "0")]
      : [];
  if (!y) return null;
  const day = `${y}-${m}-${d}`;
  const date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(day) ? day : null;
}

/**
 * "SalesData_…_2023-01-01_to_2026-11-08.csv", or a title line "… 2023-01-01 to
 * 2026-11-08". Only two dates joined as a range count: another date in a title (when the
 * file was made, say) would stretch the range over days the file doesn't have.
 */
function declaredRange(text: string): [string, string] | null {
  const m = text.match(
    /(\d{4}-\d{2}-\d{2})(?:_to_|\s+(?:to|through|thru|until)\s+|\s*(?:\.\.|–|—)\s*|\s+-\s+)(\d{4}-\d{2}-\d{2})/i,
  );
  const [a, b] = m ? [parseDay(m[1], ","), parseDay(m[2], ",")] : [];
  if (!a || !b) return null;
  return a <= b ? [a, b] : [b, a];
}

/* ------------------------------------------------------------------------------------ */
/* Games                                                                                 */
/* ------------------------------------------------------------------------------------ */

/** A console game with a Steam App ID. */
export type SteamApp = { steamAppId: number; name: string };

/** Where a line's income goes: the key the Revenue page groups it by, and a name. */
export type SteamGame = { appKey: string; appName: string };

/** Steam rows are keyed by App ID, so Revenue can add them to the console game with that ID. */
export const steamAppKey = (appId: number) => `steam:${appId}`;

/** "Didactic Jesus Game (Steam)" and "Didactic Jesus Game" are the same game. */
const gameName = (s: string) => normalize(s.replace(/\([^)]*\)/g, ""));

/**
 * The console game a line is for: by an App ID in its Game column ("The Lost Sheep
 * (2298350)"), else by name. Product IDs are Steam package IDs, which aren't App IDs.
 */
export function matchSteamApp(line: SteamSaleLine, apps: SteamApp[]): SteamApp | null {
  for (const m of line.game.matchAll(/\((?:#|ID#?\s*)?(\d+)\)/gi)) {
    const app = apps.find((a) => a.steamAppId === Number(m[1]));
    if (app) return app;
  }
  for (const name of [line.game, line.productName].map(gameName).filter(Boolean)) {
    const app = apps.find((a) => gameName(a.name) === name);
    if (app) return app;
  }
  return null;
}

/** For a game not in the console: its own row under the name Steam gives it. */
export function unknownSteamGame(line: SteamSaleLine): SteamGame {
  const name = line.game.replace(/\s*\((?:#|ID#?\s*)?\d+\)\s*$/i, "") || line.productName;
  return { appKey: `steam:${name || "unknown"}`, appName: name || "Steam game" };
}

/* ------------------------------------------------------------------------------------ */
/* Income                                                                                */
/* ------------------------------------------------------------------------------------ */

function steamKind(line: SteamSaleLine): ProductKind {
  return /microtransaction|in-?game/i.test(line.type) ? "in_app" : "paid_app";
}

/**
 * What a line sold, as the file names it: its Steam package ("package:824731"), else its
 * game. It comes from the file alone, never from looking the game up, so the same sale
 * gets the same key in every upload.
 */
export function steamProductKey(line: SteamSaleLine): string {
  if (line.productId) return `package:${normalize(line.productId)}`;
  const game = normalize(line.game || line.productName);
  return game ? `game:${game}` : "all";
}

/** The report a line is stored in: "day:2026-08-11 package:824731". */
export const steamReportKey = (line: SteamSaleLine) => `day:${line.day} ${steamProductKey(line)}`;

/** The day and product a Steam report holds. */
export function parseSteamReportKey(report: string): { day: string; product: string } | null {
  const m = report.match(/^day:(\d{4}-\d{2}-\d{2}) (\S+)$/);
  return m ? { day: m[1], product: m[2] } : null;
}

/**
 * One report per day and product sold, which the Revenue page adds up into months like
 * the App Store's days. An upload replaces the reports it has, so a file uploaded twice,
 * or two files whose dates overlap, count each sale once; and a file for one game (Steam
 * has per-game pages too) leaves the other games' days alone. `unconverted`: currencies
 * with no rate to euros (dollars, for want of a rate).
 */
export function steamReports(
  file: SteamSalesFile,
  gameOf: (line: SteamSaleLine) => SteamGame,
  toEur: EurConverter,
): { reports: StoredReport[]; unconverted: string[] } {
  const rows = new Map<string, IncomeRow & { report: string }>();
  const unconverted = new Set<string>();
  for (const line of file.lines) {
    const period = line.day.slice(0, 7);
    const game = gameOf(line);
    const kind = steamKind(line);
    // A game's packages (the game alone, in a bundle, a deluxe edition) are all the game.
    const productId = kind === "paid_app" ? "app" : line.productId || line.productName;
    const report = steamReportKey(line);
    const key = [report, game.appKey, productId].join("|");
    const row = rows.get(key) ?? {
      report,
      source: "steam",
      period,
      appKey: game.appKey,
      appName: game.appName,
      productId,
      productName: kind === "paid_app" ? "Paid download" : line.productName || "In-game item",
      kind,
      units: 0,
      refunds: 0,
      netEur: 0,
      estimated: false,
    };
    const eur = toEur(line.netUsd * STEAM_DEVELOPER_SHARE, "USD", period);
    if (eur == null) unconverted.add("USD");
    row.units += line.netUnits;
    row.refunds += line.returnedUnits;
    row.netEur += eur ?? 0;
    rows.set(key, row);
  }
  const byReport = new Map<string, IncomeRow[]>();
  for (const { report, ...row } of rows.values()) {
    byReport.set(report, [...(byReport.get(report) ?? []), row]);
  }
  const reports = [...byReport]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([report, reportRows]): StoredReport => ({
        source: "steam",
        report,
        period: reportRows[0].period,
        version: null,
        unconverted: [],
        rows: reportRows,
      }),
    );
  return { reports, unconverted: [...unconverted] };
}

/* ------------------------------------------------------------------------------------ */
/* Uploads                                                                               */
/* ------------------------------------------------------------------------------------ */

export type SteamUpload = {
  file_name: string;
  first_day: string;
  last_day: string;
  uploaded_at: string;
};

export type SteamCoverage = {
  /** The newest upload. */
  latest: SteamUpload;
  /** The first and last day any upload covered. */
  from: string;
  to: string;
  /** Days between uploads that no file covered, oldest first. */
  gaps: { from: string; to: string }[];
};

/** Which days the uploaded files cover, so the page can say what to download next. */
export function steamCoverage(uploads: SteamUpload[]): SteamCoverage | null {
  if (!uploads.length) return null;
  const latest = [...uploads].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))[0];
  const ranges = [...uploads].sort((a, b) => a.first_day.localeCompare(b.first_day));
  const gaps: SteamCoverage["gaps"] = [];
  let to = ranges[0].last_day;
  for (const r of ranges.slice(1)) {
    if (r.first_day > addDays(to, 1)) {
      gaps.push({ from: addDays(to, 1), to: addDays(r.first_day, -1) });
    }
    if (r.last_day > to) to = r.last_day;
  }
  return { latest, from: ranges[0].first_day, to, gaps };
}
