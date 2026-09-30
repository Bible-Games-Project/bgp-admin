// Downloads the stores' sales reports for the Revenue page. Parsing lives in
// income-reports.ts; this file only fetches and unpacks.

import { AscError, describeAppleError, mintToken } from "./asc.server";
import { fetchAccessToken, readServiceAccount } from "./google-play.server";
import { type IncomeRow, type SourceIncome, addMonths, mergeRows, monthKey } from "./income";
import {
  type AscCatalog,
  type EurRates,
  appStoreRows,
  decodeReportText,
  eurConverter,
  findZipCsv,
  googlePlayEarningsRows,
  googlePlaySalesRows,
  pickEarningsFiles,
  reportMonth,
} from "./income-reports";
import { decodeBase64Text } from "./jwt.server";

async function inflate(
  bytes: Uint8Array<ArrayBuffer>,
  format: "gzip" | "deflate-raw",
): Promise<Uint8Array> {
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ------------------------------------------------------------------------------------ */
/* App Store                                                                             */
/* ------------------------------------------------------------------------------------ */

export type SalesReport =
  | { status: "ok"; text: string }
  /** Apple has the report and it is empty: nothing sold in that period. */
  | { status: "none" }
  /** Apple has not published it yet, or no longer keeps it. */
  | { status: "unavailable" };

export type AppStoreReports = {
  keyId: string;
  salesReport: (frequency: "DAILY" | "MONTHLY" | "YEARLY", date: string) => Promise<SalesReport>;
  catalog: () => Promise<AscCatalog>;
};

/**
 * Null when the Worker has no finance key. Sales reports need a key with the Finance (or
 * Sales) role, which the deploy key (APP_STORE_CONNECT_API_KEY_*) does not have, so the
 * Revenue page uses its own key under the same issuer.
 */
export async function createAppStoreReports(): Promise<AppStoreReports | null> {
  const keyId = process.env.APP_STORE_CONNECT_FINANCE_KEY_ID;
  const keyBase64 = process.env.APP_STORE_CONNECT_FINANCE_KEY_BASE64;
  const issuerId = process.env.APP_STORE_CONNECT_ISSUER_ID;
  const vendor = process.env.APP_STORE_VENDOR_NUMBER;
  if (!keyId || !keyBase64 || !issuerId || !vendor) return null;

  const token = await mintToken(keyId, issuerId, decodeBase64Text(keyBase64));
  // Apple answers 406 to a sales report request with no Accept header. Node's fetch adds
  // one on its own, the Worker's does not, so each call names the type it expects.
  const get = (path: string, accept: string) =>
    fetch(`https://api.appstoreconnect.apple.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: accept },
    });

  const salesReport = async (
    frequency: "DAILY" | "MONTHLY" | "YEARLY",
    date: string,
    version = frequency === "DAILY" ? "1_1" : "1_0",
  ): Promise<SalesReport> => {
    const res = await get(
      `/v1/salesReports?filter[frequency]=${frequency}&filter[reportType]=SALES` +
        `&filter[reportSubType]=SUMMARY&filter[vendorNumber]=${vendor}` +
        `&filter[reportDate]=${date}&filter[version]=${version}`,
      "application/a-gzip",
    );
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
      return {
        status: "ok",
        text: decodeReportText(gzipped ? await inflate(bytes, "gzip") : bytes),
      };
    }
    const text = await res.text();
    if (res.status === 404 && /no sales/i.test(text)) return { status: "none" };
    if (res.status === 404 || res.status === 410) return { status: "unavailable" };
    // Apple moves reports to new format versions and names the one it wants.
    const latest = text.match(/latest version for this report is (\d+_\d+)/)?.[1];
    if (res.status === 400 && latest && latest !== version) {
      return salesReport(frequency, date, latest);
    }
    throw new AscError(
      `App Store Connect returned ${res.status}: ${describeAppleError(text)}`,
      res.status,
    );
  };

  const catalog = async (): Promise<AscCatalog> => {
    const res = await get("/v1/apps?fields[apps]=name,bundleId,sku&limit=200", "application/json");
    const text = await res.text();
    if (!res.ok) {
      throw new AscError(
        `App Store Connect returned ${res.status}: ${describeAppleError(text)}`,
        res.status,
      );
    }
    const apps: AscCatalog = new Map();
    for (const app of JSON.parse(text).data ?? []) {
      const info = { name: app.attributes.name, bundleId: app.attributes.bundleId };
      apps.set(app.id, info);
      if (app.attributes.sku) apps.set(app.attributes.sku, info);
    }
    return apps;
  };

  return { keyId, salesReport, catalog };
}

/* ------------------------------------------------------------------------------------ */
/* Exchange rates                                                                        */
/* ------------------------------------------------------------------------------------ */

/**
 * ECB reference rates (Frankfurter) for each day in the range, plus today's rates from
 * the fawazahmed0 currency API for the few currencies Apple pays in that the ECB does
 * not publish. Either can fail; the converter then falls back to the other.
 */
export async function fetchEurRates(from: string, to: string): Promise<EurRates> {
  const json = (url: string) =>
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
  const [ecb, latest] = await Promise.all([
    json(`https://api.frankfurter.dev/v1/${from}..${to}?base=EUR`),
    json(
      "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.min.json",
    ),
  ]);
  return { daily: ecb?.rates ?? {}, latest: latest?.eur ?? {} };
}

/* ------------------------------------------------------------------------------------ */
/* Google Play                                                                           */
/* ------------------------------------------------------------------------------------ */

export class PlayReportsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type PlayReports = {
  serviceAccountEmail: string;
  /** Object names under a prefix of the reports bucket, e.g. "earnings/". */
  list: (prefix: string) => Promise<string[]>;
  /** The CSV inside one of the bucket's report zips. */
  csv: (name: string) => Promise<string>;
  /** A report that isn't zipped, such as the monthly review exports. */
  text: (name: string) => Promise<string>;
};

/**
 * Null when the Worker lacks the service account or the bucket. Google keeps each
 * developer account's reports in its own Cloud Storage bucket (Play Console → Download
 * reports → Financial → Copy Cloud Storage URI); reading it needs the service account's
 * "View app information and download bulk reports" and "View financial data" permissions.
 */
export async function createPlayReports(): Promise<PlayReports | null> {
  const account = readServiceAccount();
  const bucket = process.env.GOOGLE_PLAY_REPORTS_BUCKET?.replace(/^gs:\/\//, "").split("/")[0];
  if (!account || !bucket) return null;

  const token = await fetchAccessToken(
    account,
    "https://www.googleapis.com/auth/devstorage.read_only",
  );
  const base = `https://storage.googleapis.com/storage/v1/b/${bucket}/o`;
  const get = async (url: string) => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const text = await res.text();
      let message = text.slice(0, 300);
      try {
        message = JSON.parse(text).error?.message ?? message;
      } catch {
        // Not JSON; keep the raw text.
      }
      throw new PlayReportsError(message, res.status);
    }
    return res;
  };

  return {
    serviceAccountEmail: account.client_email,
    list: async (prefix) => {
      const names: string[] = [];
      let page = "";
      do {
        const url = `${base}?prefix=${encodeURIComponent(prefix)}&fields=items(name),nextPageToken${page ? `&pageToken=${page}` : ""}`;
        const json = (await (await get(url)).json()) as {
          items?: { name: string }[];
          nextPageToken?: string;
        };
        names.push(...(json.items ?? []).map((item) => item.name));
        page = json.nextPageToken ?? "";
      } while (page);
      return names;
    },
    csv: async (name) => {
      const zip = new Uint8Array(
        await (await get(`${base}/${encodeURIComponent(name)}?alt=media`)).arrayBuffer(),
      );
      const entry = findZipCsv(zip);
      if (!entry) throw new PlayReportsError(`${name} has no CSV inside.`, 500);
      return decodeReportText(
        entry.method === 8 ? await inflate(entry.data, "deflate-raw") : entry.data,
      );
    },
    text: async (name) =>
      decodeReportText(
        new Uint8Array(
          await (await get(`${base}/${encodeURIComponent(name)}?alt=media`)).arrayBuffer(),
        ),
      ),
  };
}

/* ------------------------------------------------------------------------------------ */
/* Income per store                                                                      */
/* ------------------------------------------------------------------------------------ */

// Apple's yearly reports for 2023 and 2024 were checked on 2026-09-29: both empty.
const FIRST_SALES_YEAR = 2025;

const today = () => new Date().toISOString().slice(0, 10);

type Parsed = { rows: IncomeRow[]; unconverted: string[] };

/** Joins parsed reports and names any currency whose sales had to be left out. */
function combine(parsed: Parsed[]): SourceIncome {
  const unconverted = [...new Set(parsed.flatMap((p) => p.unconverted))];
  return {
    rows: mergeRows(parsed.flatMap((p) => p.rows)),
    problem: unconverted.length
      ? `Some sales in ${unconverted.join(", ")} are left out: no exchange rate to euros was found for that currency.`
      : undefined,
  };
}

/* ------------------------------------------------------------------------------------ */
/* App Store                                                                             */
/* ------------------------------------------------------------------------------------ */

const APP_STORE_NOT_SET_UP =
  "The console has no App Store finance key, so App Store sales can't be read. In GitHub → bgp-admin → Settings → Secrets and variables → Actions, add APP_STORE_CONNECT_FINANCE_KEY_ID, APP_STORE_CONNECT_FINANCE_KEY_BASE64 and APP_STORE_VENDOR_NUMBER, then push to main.";

function describeAppStoreProblem(err: unknown, keyId?: string): string {
  if (err instanceof AscError && (err.status === 401 || err.status === 403)) {
    return `Apple refused the finance key ${keyId ?? ""}. In App Store Connect → Users and Access → Integrations → App Store Connect API, check that the key is still active and has Finance access. If it isn't, generate a new key with Finance access and put it in the bgp-admin secrets APP_STORE_CONNECT_FINANCE_KEY_ID and APP_STORE_CONNECT_FINANCE_KEY_BASE64.`;
  }
  return `Could not read the App Store sales reports: ${(err as Error)?.message ?? "unknown error"}`;
}

async function withAppStore<T extends SourceIncome>(
  empty: T,
  fn: (api: AppStoreReports) => Promise<T>,
): Promise<T> {
  let api: AppStoreReports | null = null;
  try {
    api = await createAppStoreReports();
    if (!api) return { ...empty, problem: APP_STORE_NOT_SET_UP };
    return await fn(api);
  } catch (err) {
    return { ...empty, problem: describeAppStoreProblem(err, api?.keyId) };
  }
}

/**
 * Every closed month Apple still keeps (the last twelve) plus one row set per earlier
 * year. The current month, and a last month Apple has not published yet (the first days
 * of a month), come day by day from readAppStoreMonthByDay: `pendingMonths` lists them.
 */
export async function readAppStoreIncome(): Promise<SourceIncome & { pendingMonths: string[] }> {
  return withAppStore({ rows: [], pendingMonths: [] as string[] }, async (api) => {
    const now = new Date();
    const current = monthKey(now);
    const months = Array.from({ length: 12 }, (_, i) => addMonths(current, i - 12));
    const years: string[] = [];
    for (let y = FIRST_SALES_YEAR; y < now.getUTCFullYear(); y++) years.push(String(y));

    const [catalog, rates, monthly, yearly] = await Promise.all([
      api.catalog(),
      fetchEurRates(`${FIRST_SALES_YEAR}-01-01`, today()),
      Promise.all(months.map((m) => api.salesReport("MONTHLY", m))),
      Promise.all(years.map((y) => api.salesReport("YEARLY", y))),
    ]);
    const toEur = eurConverter(rates);
    const parsed: Parsed[] = [];
    const pendingMonths: string[] = [];
    months.forEach((month, i) => {
      const report = monthly[i];
      if (report.status === "ok") parsed.push(appStoreRows(report.text, month, catalog, toEur));
      // Only a just-closed month can be missing for want of publishing.
      else if (report.status === "unavailable" && month === addMonths(current, -1)) {
        pendingMonths.push(month);
      }
    });
    years.forEach((year, i) => {
      const report = yearly[i];
      if (report.status === "ok") parsed.push(appStoreRows(report.text, year, catalog, toEur));
    });
    return { ...combine(parsed), pendingMonths };
  });
}

/** One month from Apple's daily reports, for the current month or a just-closed one. */
export async function readAppStoreMonthByDay(month: string): Promise<SourceIncome> {
  const current = monthKey(new Date());
  if (month !== current && month !== addMonths(current, -1)) {
    throw new Error("Only the current and the previous month are read day by day.");
  }
  return withAppStore({ rows: [] }, async (api) => {
    // Apple publishes a day's report the next morning, so the days run up to yesterday.
    const days: string[] = [];
    const [y, m] = month.split("-").map(Number);
    for (let d = new Date(Date.UTC(y, m - 1, 1)); monthKey(d) === month; ) {
      const day = d.toISOString().slice(0, 10);
      if (day >= today()) break;
      days.push(day);
      d = new Date(d.getTime() + 86_400_000);
    }
    if (!days.length) return { rows: [] };
    const [catalog, rates, reports] = await Promise.all([
      api.catalog(),
      fetchEurRates(`${month}-01`, today()),
      Promise.all(days.map((day) => api.salesReport("DAILY", day))),
    ]);
    const toEur = eurConverter(rates);
    return combine(
      reports.flatMap((r) =>
        r.status === "ok" ? [appStoreRows(r.text, month, catalog, toEur)] : [],
      ),
    );
  });
}

/* ------------------------------------------------------------------------------------ */
/* Google Play                                                                           */
/* ------------------------------------------------------------------------------------ */

const PLAY_NOT_SET_UP =
  "The console doesn't know where Google Play keeps its reports. In GitHub → bgp-admin → Settings → Secrets and variables → Actions, add GOOGLE_PLAY_REPORTS_BUCKET with the Cloud Storage URI from Play Console → Download reports → Financial (it starts with gs://pubsite_prod_), then push to main.";

/**
 * Closed months from the earnings reports (what Google pays), and months Google has not
 * closed yet (it does so around the 5th) estimated from the sales reports.
 */
export async function readGooglePlayIncome(): Promise<SourceIncome> {
  let email = "the service account";
  try {
    const api = await createPlayReports();
    if (!api) return { rows: [], problem: PLAY_NOT_SET_UP };
    email = api.serviceAccountEmail;

    const [earningsNames, salesNames] = await Promise.all([
      api.list("earnings/"),
      api.list("sales/"),
    ]);
    const earnings = pickEarningsFiles(earningsNames);
    const estimated = salesNames
      .map((name) => ({ name, month: reportMonth(name) }))
      .filter((f): f is { name: string; month: string } => !!f.month && !earnings.has(f.month));
    const files = [
      ...[...earnings].flatMap(([month, names]) =>
        names.map((name) => ({ name, month, kind: "earnings" as const })),
      ),
      ...estimated.map((f) => ({ ...f, kind: "sales" as const })),
    ];
    if (!files.length) return { rows: [] };

    // Earnings are already in euros; only the estimated months need exchange rates.
    const firstEstimated = estimated.map((f) => f.month).sort()[0];
    const [rates, texts] = await Promise.all([
      firstEstimated
        ? fetchEurRates(`${firstEstimated}-01`, today())
        : Promise.resolve({ daily: {}, latest: {} }),
      Promise.all(files.map((f) => api.csv(f.name))),
    ]);
    const toEur = eurConverter(rates);
    return combine(
      files.map((f, i) =>
        f.kind === "earnings"
          ? googlePlayEarningsRows(texts[i], f.month, toEur)
          : googlePlaySalesRows(texts[i], f.month, toEur),
      ),
    );
  } catch (err) {
    if (err instanceof PlayReportsError && (err.status === 401 || err.status === 403)) {
      return {
        rows: [],
        problem: `The service account (${email}) can't read Google Play's financial reports. In Play Console → Users and permissions → ${email} → Account permissions, tick both "View app information and download bulk reports (read-only)" and "View financial data, orders and cancellation survey responses", then apply. Google needs both to open the reports, and can take up to a day to let it in.`,
      };
    }
    return {
      rows: [],
      problem: `Could not read the Google Play reports: ${(err as Error)?.message ?? "unknown error"}`,
    };
  }
}
