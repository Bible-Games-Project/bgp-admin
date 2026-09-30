// Reads ratings and reviews from the stores for the Reviews page, and sends replies.
// Turning the answers into StoreReviews lives in reviews.ts; this file only fetches.
//
// On Cloudflare's free plan a Worker may make 50 outgoing requests per call, so every
// read here stays under that: long lists are capped, and the App Store ratings lookup
// is split into several calls by the page.

import { AscError, createAscApi, findAscApp } from "./asc.server";
import { playStoreUrl, steamStoreUrl } from "./app-kind";
import { PlayError, createPlayApi, type PlayApi } from "./google-play.server";
import { PlayReportsError, createPlayReports } from "./income.server";
import { STEAM_LANGUAGES } from "./steam.server";
import {
  type CountryRating,
  type ReviewReply,
  type StoreReview,
  type StoreReviews,
  appStoreReviews,
  mergePlayReviews,
  playApiReviews,
  playPageRatingCount,
  playReportReviews,
  steamReviews,
  steamVerdict,
} from "./reviews";

const messageOf = (err: unknown) => (err as Error)?.message ?? "unknown error";

/* ------------------------------------------------------------------------------------ */
/* App Store                                                                             */
/* ------------------------------------------------------------------------------------ */

const APP_STORE_NOT_CONNECTED =
  "App Store Connect is not connected to this console, so its reviews can't be read.";

// 200 reviews a page; no game is near 1,000 yet.
const MAX_APP_STORE_PAGES = 5;

export async function readAppStoreReviews(bundleId: string): Promise<StoreReviews> {
  const base = { store: "app_store" as const, found: true, reviews: [] as StoreReview[] };
  try {
    const api = await createAscApi();
    if (!api) return { ...base, problem: APP_STORE_NOT_CONNECTED };
    const app = await findAscApp(api, bundleId);
    if (!app) return { ...base, found: false };

    let path: string | null =
      `/v1/apps/${app.id}/customerReviews?limit=200&sort=-createdDate&include=response`;
    for (let page = 0; path && page < MAX_APP_STORE_PAGES; page++) {
      const res = await api.get(path);
      base.reviews.push(...appStoreReviews(res));
      const next: string | undefined = res.links?.next;
      path = next ? next.replace(/^https:\/\/[^/]+/, "") : null;
    }
    // The App Store ID is the app's ID in App Store Connect.
    return { ...base, storeUrl: `https://apps.apple.com/app/id${app.id}` };
  } catch (err) {
    return { ...base, problem: `Could not read the App Store reviews: ${messageOf(err)}` };
  }
}

/**
 * Each storefront's rating from the public lookup, which answers for several apps at
 * once, so one request per storefront covers every game.
 */
export async function lookupAppStoreRatings(
  bundleIds: string[],
  countries: string[],
): Promise<{ ratings: Record<string, CountryRating[]>; failed: string[] }> {
  const ratings: Record<string, CountryRating[]> = {};
  const failed: string[] = [];
  const queue = [...countries];
  const next = async () => {
    for (let country = queue.shift(); country; country = queue.shift()) {
      try {
        const res = await fetch(
          `https://itunes.apple.com/lookup?bundleId=${bundleIds.map(encodeURIComponent).join(",")}&country=${country}`,
        );
        if (!res.ok) throw new Error(String(res.status));
        const json: any = await res.json();
        for (const app of json.results ?? []) {
          if (!app.userRatingCount) continue;
          (ratings[app.bundleId] ??= []).push({
            country,
            average: app.averageUserRating ?? 0,
            count: app.userRatingCount,
          });
        }
      } catch {
        failed.push(country);
      }
    }
  };
  // A few at a time: Apple limits how fast one address may ask.
  await Promise.all(Array.from({ length: 6 }, next));
  return { ratings, failed };
}

async function requireAscApi() {
  const api = await createAscApi();
  if (!api) throw new Error(APP_STORE_NOT_CONNECTED);
  return api;
}

function describeAppStoreReplyError(err: unknown): string {
  if (err instanceof AscError && (err.status === 401 || err.status === 403)) {
    return "App Store Connect didn't let the console answer reviews. Its API key needs the Admin, App Manager or Customer Support role: in App Store Connect → Users and Access → Integrations, make a key with one of them and store it in the APP_STORE_CONNECT_API_KEY_* secrets.";
  }
  return `App Store Connect refused the reply: ${messageOf(err)}`;
}

/** Sends a reply, or replaces the one already there. Apple checks it before it shows. */
export async function replyOnAppStore(reviewId: string, text: string): Promise<ReviewReply> {
  const api = await requireAscApi();
  try {
    const res = await api.post("/v1/customerReviewResponses", {
      data: {
        type: "customerReviewResponses",
        attributes: { responseBody: text },
        relationships: { review: { data: { type: "customerReviews", id: reviewId } } },
      },
    });
    const a = res.data?.attributes ?? {};
    return {
      id: res.data?.id,
      text: a.responseBody ?? text,
      date: a.lastModifiedDate
        ? new Date(a.lastModifiedDate).toISOString()
        : new Date().toISOString(),
      pending: a.state !== "PUBLISHED",
    };
  } catch (err) {
    throw new Error(describeAppStoreReplyError(err));
  }
}

export async function deleteAppStoreReply(replyId: string): Promise<void> {
  const api = await requireAscApi();
  try {
    await api.delete(`/v1/customerReviewResponses/${encodeURIComponent(replyId)}`);
  } catch (err) {
    throw new Error(describeAppStoreReplyError(err));
  }
}

/* ------------------------------------------------------------------------------------ */
/* Google Play                                                                           */
/* ------------------------------------------------------------------------------------ */

const PLAY_NOT_CONNECTED =
  "Google Play is not connected to this console, so its reviews can't be read.";

// Google exports one file a month, and each is one request. Three years of them keeps
// the call well under the Worker's 50.
const MAX_PLAY_REPORT_MONTHS = 36;

type PlayCopy = ReturnType<typeof playReportReviews>[number];

/**
 * Two sources, because neither has everything: the Play Developer API returns only the
 * last week (with the authors' names), and the monthly exports in the reports bucket
 * hold every review since the game came out.
 */
export async function readGooglePlayReviews(packageName: string): Promise<StoreReviews> {
  const base = {
    store: "google_play" as const,
    found: true,
    reviews: [] as StoreReview[],
    storeUrl: playStoreUrl(packageName),
  };
  let api: PlayApi | null;
  try {
    api = await createPlayApi(packageName);
  } catch (err) {
    return { ...base, problem: messageOf(err) };
  }
  if (!api) return { ...base, problem: PLAY_NOT_CONNECTED };
  const email = api.serviceAccountEmail;

  const [recent, exported, storeRatings] = await Promise.all([
    readRecentPlayReviews(api),
    readExportedPlayReviews(packageName, email),
    readPlayRatingCount(packageName),
  ]);
  if (recent.notFound) return { ...base, found: false, storeUrl: null };
  if (recent.noAccess) {
    return {
      ...base,
      storeUrl: null,
      problem: `The console can't see ${packageName} on Google Play. If the game is there, open Play Console → Users and permissions → ${email} → App permissions → Add app, pick it and tick the same permissions as the other games, including "Reply to reviews".`,
    };
  }
  return {
    ...base,
    reviews: mergePlayReviews([...exported.copies, ...recent.copies]),
    storeRatings,
    problem: recent.problem ?? exported.problem,
  };
}

async function readRecentPlayReviews(
  api: PlayApi,
): Promise<{ copies: PlayCopy[]; notFound?: boolean; noAccess?: boolean; problem?: string }> {
  try {
    const copies: PlayCopy[] = [];
    let token = "";
    // A handful of pages at most: a week of reviews is rarely more than one.
    for (let page = 0; page < 5; page++) {
      const res = await api.call(
        "GET",
        `/reviews?maxResults=100${token ? `&token=${encodeURIComponent(token)}` : ""}`,
      );
      copies.push(...playApiReviews(res));
      token = res.tokenPagination?.nextPageToken ?? "";
      if (!token) break;
    }
    return { copies };
  } catch (err) {
    if (err instanceof PlayError && err.status === 404) return { copies: [], notFound: true };
    if (err instanceof PlayError && (err.status === 401 || err.status === 403)) {
      return { copies: [], noAccess: true };
    }
    return {
      copies: [],
      problem: `Could not read this week's Google Play reviews: ${messageOf(err)}`,
    };
  }
}

async function readExportedPlayReviews(
  packageName: string,
  email: string,
): Promise<{ copies: PlayCopy[]; problem?: string }> {
  try {
    const reports = await createPlayReports();
    if (!reports) {
      return {
        copies: [],
        problem:
          "Only this week's reviews show: the console doesn't know where Google Play keeps its reports. In GitHub → bgp-admin → Settings → Secrets and variables → Actions, add GOOGLE_PLAY_REPORTS_BUCKET with the Cloud Storage URI from Play Console → Download reports → Reviews (it starts with gs://pubsite_prod_), then push to main.",
      };
    }
    const month = new RegExp(`^reviews/reviews_${escapeRegExp(packageName)}_\\d{6}\\.csv$`);
    const names = (await reports.list(`reviews/reviews_${packageName}_`))
      .filter((name) => month.test(name))
      .sort()
      .slice(-MAX_PLAY_REPORT_MONTHS);
    const texts = await Promise.all(names.map((name) => reports.text(name)));
    return { copies: texts.flatMap((text) => playReportReviews(text)) };
  } catch (err) {
    if (err instanceof PlayReportsError && (err.status === 401 || err.status === 403)) {
      return {
        copies: [],
        problem: `Only this week's reviews show: the service account (${email}) can't open Google Play's reports yet. In Play Console → Users and permissions → ${email} → Account permissions, tick "View app information and download bulk reports (read-only)" and apply. Google can take up to a day to let it in.`,
      };
    }
    return {
      copies: [],
      problem: `Only this week's reviews show: the older ones could not be read (${messageOf(err)}).`,
    };
  }
}

async function readPlayRatingCount(packageName: string): Promise<number | null> {
  try {
    const res = await fetch(`${playStoreUrl(packageName)}&hl=en`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en" },
    });
    return res.ok ? playPageRatingCount(await res.text()) : null;
  } catch {
    return null;
  }
}

/** Sends a reply, or replaces the one already there. Google shows it straight away. */
export async function replyOnGooglePlay(
  packageName: string,
  reviewId: string,
  text: string,
): Promise<ReviewReply> {
  const api = await createPlayApi(packageName);
  if (!api) throw new Error(PLAY_NOT_CONNECTED);
  try {
    const res = await api.call("POST", `/reviews/${encodeURIComponent(reviewId)}:reply`, {
      replyText: text,
    });
    const seconds = Number(res.result?.lastEdited?.seconds ?? 0);
    return {
      text: res.result?.replyText ?? text,
      date: new Date(seconds ? seconds * 1000 : Date.now()).toISOString(),
    };
  } catch (err) {
    if (err instanceof PlayError && (err.status === 401 || err.status === 403)) {
      throw new Error(
        `Google Play didn't let the console reply. In Play Console → Users and permissions → ${api.serviceAccountEmail} → App permissions → this game, tick "Reply to reviews" and apply.`,
      );
    }
    throw new Error(
      `Google Play refused the reply: ${messageOf(err)} You can still reply in Play Console: the review's "Play Console" link opens it there.`,
    );
  }
}

/* ------------------------------------------------------------------------------------ */
/* Steam                                                                                 */
/* ------------------------------------------------------------------------------------ */

// 100 reviews a page; no game is near 1,000 yet.
const MAX_STEAM_PAGES = 10;

const steamLanguageLabels = new Map(Object.values(STEAM_LANGUAGES).map((l) => [l.api, l.label]));

/** Steam's reviews are public; replies are written on Steam, signed in as the developer. */
export async function readSteamReviews(appId: number): Promise<StoreReviews> {
  const base = {
    store: "steam" as const,
    found: true,
    reviews: [] as StoreReview[],
    storeUrl: steamStoreUrl(appId),
  };
  try {
    const seen = new Set<string>();
    let cursor = "*";
    let verdict: StoreReviews["steam"];
    for (let page = 0; page < MAX_STEAM_PAGES; page++) {
      const res = await fetch(
        `https://store.steampowered.com/appreviews/${appId}?json=1&filter=recent&language=all&purchase_type=all&review_type=all&num_per_page=100&cursor=${encodeURIComponent(cursor)}`,
        { headers: { "User-Agent": "bgp-admin" } },
      );
      if (!res.ok) throw new Error(`Steam answered ${res.status}. Try again in a minute.`);
      const json: any = await res.json();
      if (json.success !== 1) return { ...base, found: false, storeUrl: null };
      verdict ??= steamVerdict(json);
      const batch = steamReviews(json, appId, (name) => steamLanguageLabels.get(name));
      // Steam's cursor sometimes hands back reviews it already sent.
      const fresh = batch.filter((r) => !seen.has(r.id));
      fresh.forEach((r) => seen.add(r.id));
      base.reviews.push(...fresh);
      if (batch.length < 100 || !fresh.length || !json.cursor || json.cursor === cursor) break;
      cursor = json.cursor;
    }
    return { ...base, steam: verdict };
  } catch (err) {
    return { ...base, problem: `Could not read the Steam reviews: ${messageOf(err)}` };
  }
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
