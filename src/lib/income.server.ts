// Downloads the stores' sales reports that the income job (income-sync.server.ts) still
// lacks. Parsing lives in income-reports.ts, and choosing the reports in income-sync.ts;
// this file only fetches and unpacks.

import { AscError, describeAppleError, mintToken } from "./asc.server";
import {
  type StoredDownloads,
  appStoreDownloadRows,
  installsFile,
  playInstallRows,
} from "./downloads";
import { fetchAccessToken, readServiceAccount } from "./google-play.server";
import { addMonths, mergeRows, monthKey } from "./income";
import {
  type AscCatalog,
  type EurRates,
  appStoreRows,
  decodeReportText,
  eurConverter,
  findZipCsv,
  googlePlayEarningsRows,
  googlePlaySalesRows,
} from "./income-reports";
import {
  type AppStoreRequest,
  type BucketFile,
  type ReportState,
  type StoredReport,
  REPORTS_PER_RUN,
  appStoreClosedRequests,
  appStoreDayRequests,
  playRequests,
  takeFiles,
} from "./income-sync";
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
  /** The same, with the generation Cloud Storage gives each new version of a file. */
  files: (prefix: string) => Promise<BucketFile[]>;
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

  const files = async (prefix: string) => {
    const found: BucketFile[] = [];
    let page = "";
    do {
      const url = `${base}?prefix=${encodeURIComponent(prefix)}&fields=items(name,generation),nextPageToken${page ? `&pageToken=${page}` : ""}`;
      const json = (await (await get(url)).json()) as {
        items?: BucketFile[];
        nextPageToken?: string;
      };
      found.push(...(json.items ?? []).map(({ name, generation }) => ({ name, generation })));
      page = json.nextPageToken ?? "";
    } while (page);
    return found;
  };

  return {
    serviceAccountEmail: account.client_email,
    list: async (prefix) => (await files(prefix)).map((f) => f.name),
    files,
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
/* Reading what the database lacks                                                       */
/* ------------------------------------------------------------------------------------ */

export type SourceSync = {
  /** The reports read in this run, to store. */
  reports: StoredReport[];
  /** App Store: the same reports' first-time downloads, for download_reports. */
  downloads?: StoredDownloads[];
  /** Why the store could not be read, and what to do about it. */
  problem?: string;
  /** Reports left for the next run, once this one read REPORTS_PER_RUN. */
  remaining: number;
};

const today = () => new Date().toISOString().slice(0, 10);

/** The first day of a month ("2026-08") or a year ("2025"). */
const firstDay = (period: string) => (period.length === 4 ? `${period}-01-01` : `${period}-01`);

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

/**
 * Closed months and past years first, then day by day the current month and a last
 * month Apple has not published yet (the first days of a month). A report Apple does not
 * have yet is simply tried again on the next run.
 */
export async function syncAppStore(stored: ReportState[], now = new Date()): Promise<SourceSync> {
  let api: AppStoreReports | null = null;
  try {
    api = await createAppStoreReports();
    if (!api) return { reports: [], problem: APP_STORE_NOT_SET_UP, remaining: 0 };
    const reports = api;
    const limit = REPORTS_PER_RUN.app_store;
    const read = (requests: AppStoreRequest[]) =>
      Promise.all(requests.map((r) => reports.salesReport(r.frequency, r.date)));

    const closed = appStoreClosedRequests(stored, now);
    const closedNow = closed.slice(0, limit);
    const closedReports = await read(closedNow);

    const current = monthKey(now);
    const lastMonth = addMonths(current, -1);
    const lastMonthAt = closedNow.findIndex((r) => r.report === `month:${lastMonth}`);
    const lastMonthPending =
      lastMonthAt >= 0 && closedReports[lastMonthAt].status === "unavailable";
    const days = appStoreDayRequests(
      stored,
      [current, ...(lastMonthPending ? [lastMonth] : [])],
      now,
    );
    const daysNow = days.slice(0, limit - closedNow.length);
    const dayReports = await read(daysNow);

    const found = [...closedNow, ...daysNow]
      .map((request, i) => ({ request, report: [...closedReports, ...dayReports][i] }))
      .filter(({ report }) => report.status !== "unavailable");
    const remaining = closed.length - closedNow.length + days.length - daysNow.length;
    if (!found.length) return { reports: [], remaining };

    const earliest = found.map((f) => f.request.period).sort()[0];
    const [catalog, rates] = await Promise.all([
      reports.catalog(),
      fetchEurRates(firstDay(earliest), today()),
    ]);
    const toEur = eurConverter(rates);
    return {
      reports: found.map(({ request, report }) => {
        const parsed =
          report.status === "ok"
            ? appStoreRows(report.text, request.period, catalog, toEur)
            : { rows: [], unconverted: [] };
        return {
          source: "app_store",
          report: request.report,
          period: request.period,
          version: null,
          unconverted: parsed.unconverted,
          rows: mergeRows(parsed.rows),
        };
      }),
      downloads: found.map(({ request, report }) => ({
        source: "app_store",
        report: request.report,
        period: request.period,
        version: null,
        rows:
          report.status === "ok" ? appStoreDownloadRows(report.text, request.period, catalog) : [],
      })),
      remaining,
    };
  } catch (err) {
    return { reports: [], problem: describeAppStoreProblem(err, api?.keyId), remaining: 0 };
  }
}

/* ------------------------------------------------------------------------------------ */
/* Google Play                                                                           */
/* ------------------------------------------------------------------------------------ */

const PLAY_NOT_SET_UP =
  "The console doesn't know where Google Play keeps its reports. In GitHub → bgp-admin → Settings → Secrets and variables → Actions, add GOOGLE_PLAY_REPORTS_BUCKET with the Cloud Storage URI from Play Console → Download reports → Financial (it starts with gs://pubsite_prod_), then push to main.";

/**
 * Closed months from the earnings reports (what Google pays), and months Google has not
 * closed yet (it does so around the 5th) estimated from the sales reports. Only the
 * files Google added or rewrote since the last run are read.
 */
export async function syncGooglePlay(stored: ReportState[]): Promise<SourceSync> {
  let email = "the service account";
  try {
    const api = await createPlayReports();
    if (!api) return { reports: [], problem: PLAY_NOT_SET_UP, remaining: 0 };
    email = api.serviceAccountEmail;

    const [earnings, sales] = await Promise.all([api.files("earnings/"), api.files("sales/")]);
    const requests = playRequests(stored, earnings, sales);
    const batch = takeFiles(requests, REPORTS_PER_RUN.google_play);
    const remaining = requests.length - batch.length;
    if (!batch.length) return { reports: [], remaining };

    // Earnings are already in euros; only the estimated months need exchange rates.
    const firstEstimated = batch
      .filter((r) => r.kind === "sales")
      .map((r) => r.period)
      .sort()[0];
    const [rates, texts] = await Promise.all([
      firstEstimated
        ? fetchEurRates(firstDay(firstEstimated), today())
        : Promise.resolve({ daily: {}, latest: {} }),
      Promise.all(batch.map((r) => Promise.all(r.files.map((name) => api.csv(name))))),
    ]);
    const toEur = eurConverter(rates);
    return {
      reports: batch.map((request, i) => {
        const parsed = texts[i].map((text) =>
          request.kind === "earnings"
            ? googlePlayEarningsRows(text, request.period, toEur)
            : googlePlaySalesRows(text, request.period, toEur),
        );
        return {
          source: "google_play",
          report: request.report,
          period: request.period,
          version: request.version,
          unconverted: [...new Set(parsed.flatMap((p) => p.unconverted))],
          rows: mergeRows(parsed.flatMap((p) => p.rows)),
        };
      }),
      remaining,
    };
  } catch (err) {
    if (err instanceof PlayReportsError && (err.status === 401 || err.status === 403)) {
      return {
        reports: [],
        problem: `The service account (${email}) can't read Google Play's financial reports. In Play Console → Users and permissions → ${email} → Account permissions, tick both "View app information and download bulk reports (read-only)" and "View financial data, orders and cancellation survey responses", then apply. Google needs both to open the reports, and can take up to a day to let it in.`,
        remaining: 0,
      };
    }
    return {
      reports: [],
      problem: `Could not read the Google Play reports: ${(err as Error)?.message ?? "unknown error"}`,
      remaining: 0,
    };
  }
}

/* ------------------------------------------------------------------------------------ */
/* Google Play installs                                                                  */
/* ------------------------------------------------------------------------------------ */

/**
 * The most install files one run reads, on top of the income reports (the run shares the
 * Worker's 50 requests). Each game has one a month, and Google rewrites the current
 * month's every day, so after the first few hours a run reads a handful at most.
 */
export const INSTALL_FILES_PER_RUN = 4;

/**
 * The monthly install statistics (stats/installs/…_overview.csv) that changed since they
 * were stored. Reading them needs the same permission as the financial reports, whose
 * missing permission the income job already reports, so a refusal here stays quiet.
 */
export async function syncGooglePlayInstalls(
  stored: Pick<StoredDownloads, "source" | "report" | "version">[],
): Promise<{ downloads: StoredDownloads[]; remaining: number }> {
  try {
    const api = await createPlayReports();
    if (!api) return { downloads: [], remaining: 0 };
    const have = new Set(stored.map((r) => `${r.source}|${r.report}|${r.version ?? ""}`));
    const wanted = (await api.files("stats/installs/installs_"))
      .map((f) => ({ ...f, file: installsFile(f.name) }))
      .filter((f) => f.file)
      .map((f) => ({
        name: f.name,
        packageName: f.file!.packageName,
        month: f.file!.month,
        report: `installs:${f.file!.packageName}:${f.file!.month}`,
        version: `${f.name}#${f.generation}`,
      }))
      .filter((f) => !have.has(`google_play|${f.report}|${f.version}`))
      .sort((a, b) => b.month.localeCompare(a.month));
    const batch = wanted.slice(0, INSTALL_FILES_PER_RUN);
    const texts = await Promise.all(batch.map((f) => api.text(f.name)));
    return {
      downloads: batch.map((f, i) => ({
        source: "google_play",
        report: f.report,
        period: f.month,
        version: f.version,
        rows: playInstallRows(texts[i], f.packageName, f.month),
      })),
      remaining: wanted.length - batch.length,
    };
  } catch (err) {
    if (!(err instanceof PlayReportsError && (err.status === 401 || err.status === 403))) {
      console.error(
        `[income] Could not read Google Play's install statistics: ${(err as Error).message}`,
      );
    }
    return { downloads: [], remaining: 0 };
  }
}
