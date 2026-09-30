// Ratings and reviews from the App Store, Google Play and Steam, in the one shape the
// Reviews page shows. Pure (no fetch, no env), so every mapper can be tested with real
// API answers and report excerpts; reviews.server.ts fetches.

import { parseTable } from "./income-reports";

export type ReviewStore = "app_store" | "google_play" | "steam";

export const REVIEW_STORES: ReviewStore[] = ["app_store", "google_play", "steam"];

export const REVIEW_STORE_LABELS: Record<ReviewStore, string> = {
  app_store: "App Store",
  google_play: "Google Play",
  steam: "Steam",
};

/** The longest reply each store accepts. Steam replies are written on Steam itself. */
export const REPLY_LIMITS = { app_store: 5970, google_play: 350 } as const;
export type ReplyStore = keyof typeof REPLY_LIMITS;

export type ReviewReply = {
  text: string;
  /** ISO date of the last change. */
  date: string | null;
  /** App Store only: Apple checks a reply before it shows it, usually within a day. */
  pending?: boolean;
  /** App Store only: the response's own ID, which deleting it needs. */
  id?: string;
};

export type StoreReview = {
  store: ReviewStore;
  /** The store's ID for the review; replies are sent to it. */
  id: string;
  /** 1 to 5. Null on Steam, which asks players yes or no. */
  stars: number | null;
  /** Steam only: whether the player recommends the game. */
  recommended: boolean | null;
  title: string;
  text: string;
  author: string | null;
  /** Country name in English, e.g. "Spain". */
  country: string | null;
  /** Language name in English, e.g. "Portuguese". */
  language: string | null;
  /** ISO date the review was written, or last edited when `edited`. */
  date: string;
  edited: boolean;
  version: string | null;
  device: string | null;
  /** Steam only. */
  hoursPlayed: number | null;
  reply: ReviewReply | null;
  /** The review on the store or its console. Steam replies are written there. */
  url: string | null;
  /**
   * The console can send a reply. Not on Steam, and not to a Google Play rating with no
   * text, which the exports list without the ID a reply needs.
   */
  canReply: boolean;
};

export type SteamVerdict = {
  /** Steam's own words for the score, e.g. "Very Positive" or "5 user reviews". */
  label: string;
  positive: number;
  negative: number;
};

/** One store's reviews for one game, or why they're missing. */
export type StoreReviews = {
  store: ReviewStore;
  /** False when the store has no app with this game's ID. */
  found: boolean;
  reviews: StoreReview[];
  /** Something could not be read: what is missing and how to fix it. */
  problem?: string;
  /** The game's public store page. */
  storeUrl?: string | null;
  /** Google Play: every rating the store page counts, with or without text. */
  storeRatings?: number | null;
  /** Steam: the score on the store page. */
  steam?: SteamVerdict;
};

export type Sentiment = "positive" | "neutral" | "negative";

export function sentimentOf(review: Pick<StoreReview, "stars" | "recommended">): Sentiment {
  if (review.stars == null) return review.recommended ? "positive" : "negative";
  if (review.stars >= 4) return "positive";
  return review.stars === 3 ? "neutral" : "negative";
}

export function canReplyFromConsole(store: ReviewStore): store is ReplyStore {
  return store in REPLY_LIMITS;
}

/** A player wrote something and nobody has answered. A bare rating waits for nothing. */
export function awaitsReply(review: Pick<StoreReview, "reply" | "title" | "text">): boolean {
  return !review.reply && !!(review.title.trim() || review.text.trim());
}

/** Average stars of the reviews that have stars; null when none do. */
export function averageStars(reviews: Pick<StoreReview, "stars">[]): number | null {
  const stars = reviews.map((r) => r.stars).filter((s): s is number => s != null);
  return stars.length ? stars.reduce((sum, s) => sum + s, 0) / stars.length : null;
}

/* ------------------------------------------------------------------------------------ */
/* Countries and languages                                                               */
/* ------------------------------------------------------------------------------------ */

/**
 * Every App Store storefront (App Store Connect's territories, checked 2026-09-30),
 * alpha-3 as App Store Connect names them to alpha-2 as the public lookup takes them.
 */
const APP_STORE_TERRITORIES: Record<string, string> = {
  AFG: "af",
  AGO: "ao",
  AIA: "ai",
  ALB: "al",
  ARE: "ae",
  ARG: "ar",
  ARM: "am",
  ATG: "ag",
  AUS: "au",
  AUT: "at",
  AZE: "az",
  BEL: "be",
  BEN: "bj",
  BFA: "bf",
  BGR: "bg",
  BHR: "bh",
  BHS: "bs",
  BIH: "ba",
  BLR: "by",
  BLZ: "bz",
  BMU: "bm",
  BOL: "bo",
  BRA: "br",
  BRB: "bb",
  BRN: "bn",
  BTN: "bt",
  BWA: "bw",
  CAN: "ca",
  CHE: "ch",
  CHL: "cl",
  CHN: "cn",
  CIV: "ci",
  CMR: "cm",
  COD: "cd",
  COG: "cg",
  COL: "co",
  CPV: "cv",
  CRI: "cr",
  CYM: "ky",
  CYP: "cy",
  CZE: "cz",
  DEU: "de",
  DMA: "dm",
  DNK: "dk",
  DOM: "do",
  DZA: "dz",
  ECU: "ec",
  EGY: "eg",
  ESP: "es",
  EST: "ee",
  FIN: "fi",
  FJI: "fj",
  FRA: "fr",
  FSM: "fm",
  GAB: "ga",
  GBR: "gb",
  GEO: "ge",
  GHA: "gh",
  GMB: "gm",
  GNB: "gw",
  GRC: "gr",
  GRD: "gd",
  GTM: "gt",
  GUY: "gy",
  HKG: "hk",
  HND: "hn",
  HRV: "hr",
  HUN: "hu",
  IDN: "id",
  IND: "in",
  IRL: "ie",
  IRQ: "iq",
  ISL: "is",
  ISR: "il",
  ITA: "it",
  JAM: "jm",
  JOR: "jo",
  JPN: "jp",
  KAZ: "kz",
  KEN: "ke",
  KGZ: "kg",
  KHM: "kh",
  KNA: "kn",
  KOR: "kr",
  KWT: "kw",
  LAO: "la",
  LBN: "lb",
  LBR: "lr",
  LBY: "ly",
  LCA: "lc",
  LKA: "lk",
  LTU: "lt",
  LUX: "lu",
  LVA: "lv",
  MAC: "mo",
  MAR: "ma",
  MDA: "md",
  MDG: "mg",
  MDV: "mv",
  MEX: "mx",
  MKD: "mk",
  MLI: "ml",
  MLT: "mt",
  MMR: "mm",
  MNE: "me",
  MNG: "mn",
  MOZ: "mz",
  MRT: "mr",
  MSR: "ms",
  MUS: "mu",
  MWI: "mw",
  MYS: "my",
  NAM: "na",
  NER: "ne",
  NGA: "ng",
  NIC: "ni",
  NLD: "nl",
  NOR: "no",
  NPL: "np",
  NRU: "nr",
  NZL: "nz",
  OMN: "om",
  PAK: "pk",
  PAN: "pa",
  PER: "pe",
  PHL: "ph",
  PLW: "pw",
  PNG: "pg",
  POL: "pl",
  PRT: "pt",
  PRY: "py",
  QAT: "qa",
  ROU: "ro",
  RUS: "ru",
  RWA: "rw",
  SAU: "sa",
  SEN: "sn",
  SGP: "sg",
  SLB: "sb",
  SLE: "sl",
  SLV: "sv",
  SRB: "rs",
  STP: "st",
  SUR: "sr",
  SVK: "sk",
  SVN: "si",
  SWE: "se",
  SWZ: "sz",
  SYC: "sc",
  TCA: "tc",
  TCD: "td",
  THA: "th",
  TJK: "tj",
  TKM: "tm",
  TON: "to",
  TTO: "tt",
  TUN: "tn",
  TUR: "tr",
  TWN: "tw",
  TZA: "tz",
  UGA: "ug",
  UKR: "ua",
  URY: "uy",
  USA: "us",
  UZB: "uz",
  VCT: "vc",
  VEN: "ve",
  VGB: "vg",
  VNM: "vn",
  VUT: "vu",
  XKS: "xk",
  YEM: "ye",
  ZAF: "za",
  ZMB: "zm",
  ZWE: "zw",
};

/** Alpha-2 codes of every App Store storefront, for the public ratings lookup. */
export const APP_STORE_STOREFRONTS = Object.values(APP_STORE_TERRITORIES);

/**
 * Storefronts one call looks up. Each is one request, and a Worker on Cloudflare's free
 * plan may make 50 per call, so the page splits the list into calls of this size.
 */
export const STOREFRONTS_PER_CALL = 35;

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

/** "ESP" or "es" → "Spain". Unknown codes come back as they are. */
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  const alpha2 = code.length === 3 ? APP_STORE_TERRITORIES[code.toUpperCase()] : code;
  if (!alpha2) return code;
  try {
    return regionNames.of(alpha2.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** "pt", "es_419" or "es-419" → an English name. Unknown codes come back as they are. */
export function languageName(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    return languageNames.of(code.replace("_", "-")) ?? code;
  } catch {
    return code;
  }
}

/* ------------------------------------------------------------------------------------ */
/* App Store                                                                             */
/* ------------------------------------------------------------------------------------ */

/** One page of App Store Connect's customerReviews, asked for with include=response. */
export function appStoreReviews(page: any): StoreReview[] {
  const responses = new Map<string, any>(
    (page.included ?? [])
      .filter((i: any) => i.type === "customerReviewResponses")
      .map((i: any) => [i.id, i]),
  );
  return (page.data ?? []).map((r: any): StoreReview => {
    const a = r.attributes ?? {};
    const response = responses.get(r.relationships?.response?.data?.id);
    return {
      store: "app_store",
      id: r.id,
      stars: a.rating ?? null,
      recommended: null,
      title: a.title ?? "",
      text: a.body ?? "",
      author: a.reviewerNickname ?? null,
      country: countryName(a.territory),
      language: null,
      date: toIso(a.createdDate),
      edited: false,
      version: null,
      device: null,
      hoursPlayed: null,
      reply: response
        ? {
            id: response.id,
            text: response.attributes?.responseBody ?? "",
            date: response.attributes?.lastModifiedDate
              ? toIso(response.attributes.lastModifiedDate)
              : null,
            pending: response.attributes?.state === "PENDING_PUBLISH",
          }
        : null,
      url: null,
      canReply: true,
    };
  });
}

export type CountryRating = { country: string; average: number; count: number };

export type AppStoreRatings = {
  /** Weighted over every storefront; null with no ratings. */
  average: number | null;
  count: number;
  /** Storefronts with ratings, most rated first, with English names. */
  countries: CountryRating[];
};

/**
 * The App Store keeps a separate rating in every storefront. Adding them up gives the
 * game's total, the same total App Store Connect shows.
 */
export function sumAppStoreRatings(perCountry: CountryRating[]): AppStoreRatings {
  const rated = perCountry.filter((c) => c.count > 0);
  const count = rated.reduce((sum, c) => sum + c.count, 0);
  return {
    average: count ? rated.reduce((sum, c) => sum + c.average * c.count, 0) / count : null,
    count,
    countries: rated
      .map((c) => ({ ...c, country: countryName(c.country) ?? c.country }))
      .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country)),
  };
}

/* ------------------------------------------------------------------------------------ */
/* Google Play                                                                           */
/* ------------------------------------------------------------------------------------ */

/**
 * The monthly review exports in the reports bucket (reviews/reviews_<package>_<YYYYMM>.csv).
 * A review sits in the file of every month it or its reply changed, so the same one
 * turns up in several; mergePlayReviews keeps the newest.
 */
export function playReportReviews(csv: string): (StoreReview & { changed: number })[] {
  return parseTable(csv, ",")
    .filter((row) => row["Star Rating"])
    .map((row) => {
      const link = row["Review Link"] || null;
      const linkId = link ? reviewIdOf(link) : null;
      const submitted = Number(row["Review Submit Millis Since Epoch"]) || 0;
      const updated = Number(row["Review Last Update Millis Since Epoch"]) || submitted;
      const replied = Number(row["Developer Reply Millis Since Epoch"]) || 0;
      const replyText = row["Developer Reply Text"]?.trim();
      return {
        store: "google_play" as const,
        id: linkId ?? `${row["Device"]}-${submitted}`,
        stars: Number(row["Star Rating"]) || null,
        recommended: null,
        title: row["Review Title"] ?? "",
        text: row["Review Text"] ?? "",
        author: null,
        country: null,
        language: languageName(row["Reviewer Language"]),
        date: new Date(updated || submitted).toISOString(),
        edited: updated > submitted + 60_000,
        version: row["App Version Name"] || null,
        device: row["Device"] || null,
        hoursPlayed: null,
        reply: replyText
          ? { text: replyText, date: replied ? new Date(replied).toISOString() : null }
          : null,
        url: link?.replace(/^http:/, "https:") ?? null,
        canReply: !!linkId,
        changed: Math.max(updated, replied),
      };
    });
}

/**
 * The Play Developer API's reviews.list, which only returns the last week, but with the
 * author's name. A review with a title comes as "title\ttext".
 */
export function playApiReviews(page: any): (StoreReview & { changed: number })[] {
  return (page.reviews ?? []).map((r: any) => {
    const user = r.comments?.find((c: any) => c.userComment)?.userComment ?? {};
    const developer = r.comments?.find((c: any) => c.developerComment)?.developerComment;
    const [title, text] = String(user.text ?? "").includes("\t")
      ? String(user.text).split("\t", 2)
      : ["", String(user.text ?? "")];
    const updated = secondsOf(user.lastModified);
    const replied = secondsOf(developer?.lastModified);
    return {
      store: "google_play" as const,
      id: r.reviewId,
      stars: user.starRating ?? null,
      recommended: null,
      title: title.trim(),
      text: text.trim(),
      author: r.authorName || null,
      country: null,
      language: languageName(user.reviewerLanguage),
      date: new Date(updated).toISOString(),
      edited: false,
      version: user.appVersionName ?? null,
      device: user.deviceMetadata?.productName ?? user.device ?? null,
      hoursPlayed: null,
      reply: developer?.text
        ? { text: developer.text, date: replied ? new Date(replied).toISOString() : null }
        : null,
      url: null,
      canReply: true,
      changed: Math.max(updated, replied),
    };
  });
}

/**
 * One list, newest first, with each review once: its newest copy, plus the author's
 * name and a Play Console link from whichever copy has them.
 */
export function mergePlayReviews(copies: (StoreReview & { changed: number })[]): StoreReview[] {
  const byId = new Map<string, StoreReview & { changed: number }>();
  for (const copy of copies) {
    const seen = byId.get(copy.id);
    if (!seen) {
      byId.set(copy.id, copy);
      continue;
    }
    const [newer, older] = copy.changed >= seen.changed ? [copy, seen] : [seen, copy];
    byId.set(copy.id, {
      ...newer,
      author: newer.author ?? older.author,
      url: newer.url ?? older.url,
      reply: newer.reply ?? older.reply,
      canReply: newer.canReply || older.canReply,
    });
  }
  return [...byId.values()]
    .map(({ changed: _changed, ...review }) => review)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Every rating the public Google Play page counts, from its structured data. The average
 * next to it is left out: Google shows each country its own, so it isn't the game's.
 */
export function playPageRatingCount(html: string): number | null {
  const match = html.match(/"aggregateRating"\s*:\s*\{[^}]*"ratingCount"\s*:\s*"?(\d+)/);
  return match ? Number(match[1]) : null;
}

/* ------------------------------------------------------------------------------------ */
/* Steam                                                                                 */
/* ------------------------------------------------------------------------------------ */

/**
 * One page of store.steampowered.com/appreviews/<appid>?json=1. `languageLabel` turns
 * Steam's language names ("spanish", "latam"…) into readable ones.
 */
export function steamReviews(
  page: any,
  appId: number,
  languageLabel: (steamName: string) => string | undefined,
): StoreReview[] {
  return (page.reviews ?? []).map((r: any): StoreReview => {
    const created = Number(r.timestamp_created) || 0;
    const updated = Number(r.timestamp_updated) || created;
    const minutes = r.author?.playtime_at_review ?? r.author?.playtime_forever;
    const steamId = r.author?.steamid;
    return {
      store: "steam",
      id: String(r.recommendationid),
      stars: null,
      recommended: Boolean(r.voted_up),
      title: "",
      text: String(r.review ?? "").trim(),
      author: r.author?.personaname ?? null,
      country: null,
      language: r.language ? (languageLabel(r.language) ?? r.language) : null,
      date: new Date(updated * 1000).toISOString(),
      edited: updated > created + 60,
      version: null,
      device: r.primarily_steam_deck ? "Steam Deck" : null,
      hoursPlayed: typeof minutes === "number" ? Math.round((minutes / 60) * 10) / 10 : null,
      reply: r.developer_response
        ? {
            text: String(r.developer_response),
            date: r.timestamp_dev_responded
              ? new Date(Number(r.timestamp_dev_responded) * 1000).toISOString()
              : null,
          }
        : null,
      url: steamId ? `https://steamcommunity.com/profiles/${steamId}/recommended/${appId}/` : null,
      canReply: false,
    };
  });
}

/** The score from the first page's query_summary; later pages don't carry it. */
export function steamVerdict(page: any): SteamVerdict | undefined {
  const summary = page.query_summary;
  if (!summary || summary.total_reviews == null) return undefined;
  return {
    label: summary.review_score_desc ?? "",
    positive: summary.total_positive ?? 0,
    negative: summary.total_negative ?? 0,
  };
}

/* ------------------------------------------------------------------------------------ */

function toIso(date: string | null | undefined): string {
  const parsed = date ? new Date(date) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : "";
}

function reviewIdOf(link: string): string | null {
  try {
    return new URL(link).searchParams.get("reviewId");
  } catch {
    return null;
  }
}

function secondsOf(timestamp: { seconds?: string | number } | undefined): number {
  return Number(timestamp?.seconds ?? 0) * 1000;
}
