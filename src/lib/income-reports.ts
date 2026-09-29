// Turns the stores' sales reports into IncomeRows. Pure (no fetch, no env), so it can be
// tested with real report excerpts; income.server.ts downloads and unpacks the files.

import type { IncomeRow, ProductKind } from "./income";

/* ------------------------------------------------------------------------------------ */
/* Report files                                                                          */
/* ------------------------------------------------------------------------------------ */

/** Header-keyed rows of a CSV (quoted fields allowed) or a TSV (Apple: never quoted). */
export function parseTable(text: string, delimiter: "," | "\t"): Record<string, string>[] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    if (record.some((f) => f !== "")) records.push(record);
    record = [];
  };
  const body = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (body[i + 1] === '"') field += body[i++];
      else quoted = false;
    } else if (c === '"' && delimiter === "," && field === "") quoted = true;
    else if (c === delimiter) endField();
    else if (c === "\n") endRecord();
    else if (c !== "\r") field += c;
  }
  if (field !== "" || record.length) endRecord();
  const [header = [], ...rows] = records;
  return rows.map((r) => Object.fromEntries(header.map((key, i) => [key.trim(), r[i] ?? ""])));
}

/** Google's reports are UTF-8, but some of its downloads are UTF-16; read both. */
export function decodeReportText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  return new TextDecoder().decode(bytes);
}

/**
 * Locates the CSV inside one of Google's report zips by reading the zip's central
 * directory, which carries the real sizes even when the local headers leave them out.
 * `method` is 0 (stored) or 8 (deflate); the caller inflates.
 */
export function findZipCsv<T extends ArrayBufferLike>(
  zip: Uint8Array<T>,
): { method: number; data: Uint8Array<T> } | null {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const entries = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  for (let n = 0; n < entries && view.getUint32(at, true) === 0x02014b50; n++) {
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localHeader = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    if (name.toLowerCase().endsWith(".csv")) {
      const start =
        localHeader +
        30 +
        view.getUint16(localHeader + 26, true) +
        view.getUint16(localHeader + 28, true);
      return { method, data: zip.subarray(start, start + size) };
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/* ------------------------------------------------------------------------------------ */
/* Currency                                                                              */
/* ------------------------------------------------------------------------------------ */

export type EurRates = {
  /** ECB reference rates by day, as units of each currency per euro. */
  daily: Record<string, Record<string, number>>;
  /** Today's rates for currencies the ECB does not publish (COP, CLP…), lower-case keys. */
  latest: Record<string, number>;
};

/** Converts an amount earned in `period` to euros; null when no rate is known. */
export type EurConverter = (amount: number, currency: string, period: string) => number | null;

/**
 * Uses the average ECB rate over the period (a month, or a whole year), which is close to
 * what the stores themselves apply across a month's sales. Falls back to the last rate
 * before the period ends, then to today's rate.
 */
export function eurConverter(rates: EurRates): EurConverter {
  const days = Object.keys(rates.daily).sort();
  const cache = new Map<string, number | null>();
  const rateFor = (currency: string, period: string): number | null => {
    const from = period.length === 4 ? `${period}-01-01` : `${period}-01`;
    const to = period.length === 4 ? `${period}-12-31` : `${period}-31`;
    const inPeriod = days
      .filter((d) => d >= from && d <= to)
      .map((d) => rates.daily[d][currency])
      .filter((r): r is number => r > 0);
    if (inPeriod.length) return inPeriod.reduce((a, b) => a + b, 0) / inPeriod.length;
    for (let i = days.length - 1; i >= 0; i--) {
      const r = rates.daily[days[i]][currency];
      if (days[i] <= to && r > 0) return r;
    }
    return rates.latest[currency.toLowerCase()] || null;
  };
  return (amount, currency, period) => {
    const code = currency.trim().toUpperCase();
    if (code === "EUR" || amount === 0) return amount;
    const key = `${code}|${period}`;
    if (!cache.has(key)) cache.set(key, rateFor(code, period));
    const rate = cache.get(key);
    return rate ? amount / rate : null;
  };
}

/* ------------------------------------------------------------------------------------ */
/* Collecting rows                                                                       */
/* ------------------------------------------------------------------------------------ */

type Line = Omit<IncomeRow, "units" | "refunds" | "netEur"> & {
  units: number;
  amount: number;
  currency: string;
};

/** Sums lines per product and converts them; currencies without a rate are reported. */
function collect(lines: Line[], toEur: EurConverter) {
  const rows = new Map<string, IncomeRow>();
  const unconverted = new Set<string>();
  for (const { amount, currency, units, ...line } of lines) {
    const eur = toEur(amount, currency, line.period);
    if (eur == null) unconverted.add(currency);
    const key = [line.source, line.period, line.appKey, line.productId, line.estimated].join("|");
    const row = rows.get(key) ?? { ...line, units: 0, refunds: 0, netEur: 0 };
    row.units += units;
    if (units < 0) row.refunds -= units;
    row.netEur += eur ?? 0;
    rows.set(key, row);
  }
  return { rows: [...rows.values()], unconverted: [...unconverted] };
}

/* ------------------------------------------------------------------------------------ */
/* App Store                                                                             */
/* ------------------------------------------------------------------------------------ */

/** App Store Connect apps by SKU and by Apple ID. */
export type AscCatalog = Map<string, { name: string; bundleId: string }>;

/**
 * Reads a SALES / SUMMARY report (daily, monthly or yearly). Only lines that earned
 * money count: free downloads, updates and redownloads carry no proceeds. Refunds come
 * as negative units.
 */
export function appStoreRows(
  report: string,
  period: string,
  catalog: AscCatalog,
  toEur: EurConverter,
) {
  const lines: Line[] = [];
  for (const r of parseTable(report, "\t")) {
    const perUnit = Number(r["Developer Proceeds"]);
    const units = Number(r.Units);
    if (!perUnit || !units) continue;
    const type = r["Product Type Identifier"] ?? "";
    const inApp = /^(IA|FI)/.test(type);
    const kind: ProductKind = /^(IAY|IA9)/.test(type)
      ? "subscription"
      : inApp
        ? "in_app"
        : "paid_app";
    const app =
      (inApp ? catalog.get(r["Parent Identifier"]) : catalog.get(r.SKU)) ??
      (inApp ? undefined : catalog.get(r["Apple Identifier"]));
    const appKey = app?.bundleId || (inApp ? r["Parent Identifier"] : r.SKU) || r.Title;
    lines.push({
      source: "app_store",
      period,
      appKey,
      appName: app?.name ?? (inApp ? appKey : r.Title),
      productId: inApp ? r.SKU : "app",
      productName: inApp ? r.Title : "Paid download",
      kind,
      estimated: false,
      units,
      amount: perUnit * units,
      currency: r["Currency of Proceeds"],
    });
  }
  return collect(lines, toEur);
}

/* ------------------------------------------------------------------------------------ */
/* Google Play                                                                           */
/* ------------------------------------------------------------------------------------ */

/** "sales/salesreport_202609.zip" or "earnings/earnings_202511_18821660-1.zip" → "2026-09". */
export function reportMonth(name: string): string | null {
  const m = name.match(/_(\d{4})(\d{2})(?:[_.]|$)/);
  return m ? `${m[1]}-${m[2]}` : null;
}

/**
 * Groups the earnings files by month. Google issues one file per payments profile, and
 * when the account moved to a new profile (November 2025) it listed the same orders in
 * both files, so a month the current profile covers uses only that profile's files.
 */
export function pickEarningsFiles(names: string[]): Map<string, string[]> {
  const files = names
    .map((name) => {
      const m = name.match(/earnings_(\d{4})(\d{2})_(\d+)-(\d+)\.zip$/);
      return m ? { name, month: `${m[1]}-${m[2]}`, profile: m[3], seq: Number(m[4]) } : null;
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);
  const newest = [...files].sort((a, b) => b.month.localeCompare(a.month) || b.seq - a.seq)[0];
  const byMonth = new Map<string, string[]>();
  for (const month of new Set(files.map((f) => f.month))) {
    const inMonth = files.filter((f) => f.month === month);
    const current = inMonth.filter((f) => f.profile === newest.profile);
    byMonth.set(
      month,
      (current.length ? current : inMonth).map((f) => f.name),
    );
  }
  return byMonth;
}

function playKind(productType: string): ProductKind {
  const t = productType.toLowerCase();
  if (!t) return "other";
  if (t.includes("paid app")) return "paid_app";
  if (t.includes("subscription")) return "subscription";
  return "in_app";
}

/**
 * Google names an in-app product "Unlock Full Game (Bible Unlocked: Sacred Stories)":
 * the product, then its app in parentheses.
 */
export function splitPlayTitle(title: string): { product: string; app: string } {
  const open = title.indexOf(" (");
  if (open < 0 || !title.endsWith(")")) return { product: title, app: title };
  return { product: title.slice(0, open), app: title.slice(open + 2, -1) };
}

function playLine(
  r: Record<string, string>,
  period: string,
  estimated: boolean,
): Omit<Line, "units" | "amount" | "currency"> {
  const kind = playKind(r["Product Type"] ?? "");
  const title = r["Product Title"] ?? "";
  const appKey = r["Package ID"] ?? "";
  if (!appKey) {
    // Account-level lines, such as the tax Google withholds at the end of some months.
    const what = r["Transaction Type"] || "Adjustment";
    return {
      source: "google_play",
      period,
      appKey: "",
      appName: "Google Play account",
      productId: what,
      productName: what,
      kind: "other",
      estimated,
    };
  }
  const split =
    kind === "paid_app" ? { product: "Paid download", app: title } : splitPlayTitle(title);
  const productId = r["Sku Id"] || r["SKU ID"] || (kind === "paid_app" ? "app" : title);
  return {
    source: "google_play",
    period,
    appKey,
    appName: split.app,
    productId,
    productName: split.product,
    kind,
    estimated,
  };
}

/**
 * Reads a monthly earnings report: every line is money in euros that Google actually
 * pays (charges, its fee, taxes, refunds). A charge counts one unit, a refund minus one.
 */
export function googlePlayEarningsRows(csv: string, period: string, toEur: EurConverter) {
  const lines: Line[] = [];
  for (const r of parseTable(csv, ",")) {
    const type = r["Transaction Type"];
    lines.push({
      ...playLine(r, period, false),
      units: type === "Charge" ? 1 : type === "Charge refund" ? -1 : 0,
      amount: Number(r["Amount (Merchant Currency)"] || 0),
      currency: r["Merchant Currency"] || "EUR",
    });
  }
  return collect(lines, toEur);
}

/**
 * Reads a monthly estimated sales report, for months Google has not closed yet. It lists
 * prices before tax, so the net is the price minus Google's fee: 15% on the first million
 * dollars a year, 30% after.
 */
export function googlePlaySalesRows(csv: string, period: string, toEur: EurConverter) {
  const lines: Line[] = [];
  for (const r of parseTable(csv, ",")) {
    const status = r["Financial Status"];
    const sign = status === "Charged" ? 1 : status === "Refund" ? -1 : 0;
    if (!sign) continue;
    const fee = r["First USD 1M Eligible"] === "No" ? 0.3 : 0.15;
    lines.push({
      ...playLine(r, period, true),
      units: sign,
      amount: sign * Number(r["Item Price"] || 0) * (1 - fee),
      currency: r["Currency of Sale"],
    });
  }
  return collect(lines, toEur);
}
