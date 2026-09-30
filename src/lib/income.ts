// Shared by the Revenue page and the server functions that read the stores' reports.
// Pure: no server-only imports, so the page can aggregate on the client.

export type IncomeSource = "app_store" | "google_play";
export type ProductKind = "paid_app" | "in_app" | "subscription" | "other";

export const SOURCE_LABELS: Record<IncomeSource, string> = {
  app_store: "App Store",
  google_play: "Google Play",
};

export const KIND_LABELS: Record<ProductKind, string> = {
  paid_app: "Paid download",
  in_app: "In-app purchase",
  subscription: "Subscription",
  other: "Fees and adjustments",
};

/** One product's net income in one store over one period. */
export type IncomeRow = {
  source: IncomeSource;
  /** "2026-08" for a month, or "2025" for a whole year of App Store history. */
  period: string;
  /** Bundle ID or package name; empty for account-level items such as Google's taxes. */
  appKey: string;
  appName: string;
  productId: string;
  productName: string;
  kind: ProductKind;
  /** Units sold minus units refunded. */
  units: number;
  refunds: number;
  /** After the store's fee (and the taxes it collects), in euros. */
  netEur: number;
  /** Google Play's months before it closes them: worked out from sales, not its payout. */
  estimated: boolean;
};

/** Adds up rows for the same product and period (e.g. a month read day by day). */
export function mergeRows(rows: IncomeRow[]): IncomeRow[] {
  const merged = new Map<string, IncomeRow>();
  for (const r of rows) {
    const key = [r.source, r.period, r.appKey, r.productId, r.estimated].join("|");
    const m = merged.get(key);
    if (!m) merged.set(key, { ...r });
    else {
      m.units += r.units;
      m.refunds += r.refunds;
      m.netEur += r.netEur;
    }
  }
  return [...merged.values()];
}

export type Preset = "month" | "12m" | "year" | "all";

export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return monthKey(new Date(Date.UTC(y, m - 1 + delta, 1)));
}

/** The months a preset covers, oldest first; null for all time. */
export function presetMonths(preset: Preset, now: Date): string[] | null {
  const current = monthKey(now);
  if (preset === "all") return null;
  if (preset === "month") return [current];
  const count = preset === "12m" ? 12 : now.getUTCMonth() + 1;
  return Array.from({ length: count }, (_, i) => addMonths(current, i - count + 1));
}

/**
 * Picks the rows a preset covers without counting anything twice. Apple keeps monthly
 * reports for only a year, so older App Store income arrives as whole-year rows, while
 * the months of that year still inside Apple's window arrive as monthly rows too: all
 * time uses the year, the month-based presets use the months.
 */
export function selectRows(rows: IncomeRow[], preset: Preset, now: Date): IncomeRow[] {
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

export function totals(rows: IncomeRow[]) {
  return {
    netEur: sum(rows, (r) => r.netEur),
    units: sum(rows, (r) => r.units),
    refunds: sum(rows, (r) => r.refunds),
    estimated: rows.some((r) => r.estimated),
  };
}

export type ChartBucket = {
  bucket: string;
  app_store: number;
  google_play: number;
  estimated: boolean;
};

/**
 * Income per month for the month-based presets, per year for all time. Every bucket in
 * the range is present, so a month without sales shows as a gap instead of vanishing.
 */
export function chartBuckets(rows: IncomeRow[], preset: Preset, now: Date): ChartBucket[] {
  const months = presetMonths(preset, now);
  let buckets: string[];
  let bucketOf: (period: string) => string;
  if (months) {
    buckets = months;
    bucketOf = (p) => p;
  } else {
    const years = rows.map((r) => Number(r.period.slice(0, 4)));
    const first = years.length ? Math.min(...years) : now.getUTCFullYear();
    buckets = [];
    for (let y = first; y <= now.getUTCFullYear(); y++) buckets.push(String(y));
    bucketOf = (p) => p.slice(0, 4);
  }
  const byBucket = new Map<string, ChartBucket>(
    buckets.map((b) => [b, { bucket: b, app_store: 0, google_play: 0, estimated: false }]),
  );
  for (const r of rows) {
    const b = byBucket.get(bucketOf(r.period));
    if (!b) continue;
    b[r.source] += r.netEur;
    b.estimated ||= r.estimated;
  }
  return [...byBucket.values()];
}

export type AppTotal = {
  appKey: string;
  appName: string;
  app_store: number;
  google_play: number;
  netEur: number;
  units: number;
  estimated: boolean;
};

/** Highest income first; account-level items (no app) go last. */
export function byApp(rows: IncomeRow[]): AppTotal[] {
  const apps = new Map<string, AppTotal>();
  for (const r of rows) {
    const a = apps.get(r.appKey) ?? {
      appKey: r.appKey,
      appName: r.appName,
      app_store: 0,
      google_play: 0,
      netEur: 0,
      units: 0,
      estimated: false,
    };
    a[r.source] += r.netEur;
    a.netEur += r.netEur;
    a.units += r.units;
    a.estimated ||= r.estimated;
    apps.set(r.appKey, a);
  }
  return [...apps.values()].sort(
    (a, b) => Number(!a.appKey) - Number(!b.appKey) || b.netEur - a.netEur,
  );
}

export type ProductTotal = {
  key: string;
  source: IncomeSource;
  appKey: string;
  appName: string;
  productName: string;
  kind: ProductKind;
  units: number;
  refunds: number;
  netEur: number;
  estimated: boolean;
};

export function byProduct(rows: IncomeRow[]): ProductTotal[] {
  const products = new Map<string, ProductTotal>();
  for (const r of rows) {
    const key = `${r.source}|${r.appKey}|${r.productId}`;
    const p = products.get(key) ?? {
      key,
      source: r.source,
      appKey: r.appKey,
      appName: r.appName,
      productName: r.productName,
      kind: r.kind,
      units: 0,
      refunds: 0,
      netEur: 0,
      estimated: false,
    };
    p.units += r.units;
    p.refunds += r.refunds;
    p.netEur += r.netEur;
    p.estimated ||= r.estimated;
    products.set(key, p);
  }
  return [...products.values()].sort(
    (a, b) => Number(a.kind === "other") - Number(b.kind === "other") || b.netEur - a.netEur,
  );
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}
