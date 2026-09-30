// The monitor job's checks: what each one keeps from the stores, GitHub and Apple, and how
// two results compare (what is new, what changed). Pure (no fetch, no env, no database),
// so every rule can be tested with real API answers. monitor.server.ts fetches and stores;
// home.ts turns the stored results into the Home page, alerts.ts into Telegram messages.

import { appStoreIds, isWebGame } from "./app-kind";
import { LIVE_STATES, versionStateOf } from "./asc-states";
import { type ReviewStore, type StoreReview, awaitsReply } from "./reviews";

/** How often the job runs. The cron in vite.config.ts has to match. */
export const MONITOR_EVERY_MINUTES = 15;

export type CheckKey =
  | "app_store"
  | "reviews_app_store"
  | "reviews_google_play"
  | "reviews_steam"
  | "deploys"
  | "play_vitals"
  | "signing"
  | "console"
  | "android_target";

/** `label` reads mid-sentence: "The console couldn't check {label}". */
export const CHECKS: Record<CheckKey, { everyMinutes: number; label: string }> = {
  app_store: { everyMinutes: 15, label: "App Store review states" },
  reviews_app_store: { everyMinutes: 60, label: "App Store reviews" },
  reviews_google_play: { everyMinutes: 60, label: "Google Play reviews" },
  reviews_steam: { everyMinutes: 60, label: "Steam reviews" },
  deploys: { everyMinutes: 30, label: "deploys" },
  play_vitals: { everyMinutes: 360, label: "Android crashes" },
  signing: { everyMinutes: 1440, label: "Apple certificates and profiles" },
  console: { everyMinutes: 1440, label: "the console's own jobs" },
  android_target: { everyMinutes: 1440, label: "the Android target API" },
};

export const CHECK_KEYS = Object.keys(CHECKS) as CheckKey[];

/** One row of the table monitor_checks. */
export type CheckRow = {
  key: string;
  ran_at: string;
  state: unknown;
  problem: string | null;
};

/**
 * The checks to run now, most overdue first. `since`: run every check that hasn't run
 * since then (the Check now button), whatever its interval.
 */
export function dueChecks(
  rows: Pick<CheckRow, "key" | "ran_at">[],
  now: Date,
  since?: Date,
): CheckKey[] {
  const ranAt = new Map(rows.map((r) => [r.key, Date.parse(r.ran_at)]));
  return CHECK_KEYS.map((key) => {
    const last = ranAt.get(key) ?? 0;
    return { key, last, overdue: now.getTime() - last - CHECKS[key].everyMinutes * 60_000 };
  })
    .filter((c) =>
      since
        ? c.last < since.getTime()
        : // A minute of slack, so a 15-minute check runs on every 15-minute run.
          c.overdue >= -60_000,
    )
    .sort((a, b) => b.overdue - a.overdue)
    .map((c) => c.key);
}

/** A game as the checks see it. */
export type MonitorApp = {
  id: string;
  name: string;
  ios: string | null;
  android: string | null;
  steam: number | null;
  /** Web games only: the console builds and deploys them from this repo. */
  repo: { owner: string; name: string } | null;
};

/** A row of the apps table as the checks see it. */
export function toMonitorApp(app: {
  id: string;
  name: string;
  bundle_id: string | null;
  android_package_name: string | null;
  steam_app_id: number | null;
  github_owner: string | null;
  github_repo: string | null;
}): MonitorApp {
  const ids = appStoreIds(app);
  return {
    id: app.id,
    name: app.name.trim(),
    ios: ids.ios,
    android: ids.android,
    steam: ids.steam,
    repo: isWebGame(app) ? { owner: app.github_owner, name: app.github_repo } : null,
  };
}

const daysAgo = (now: Date, days: number) => now.getTime() - days * 86_400_000;

/* ------------------------------------------------------------------------------------ */
/* App Store review states                                                               */
/* ------------------------------------------------------------------------------------ */

export type AppStoreVersion = {
  id: string;
  version: string;
  state: string;
  platform: string;
  created: string | null;
};

export type AppStoreApp = {
  /** The app's ID in App Store Connect, which is also its App Store ID. */
  ascId: string;
  /** Newest first. */
  versions: AppStoreVersion[];
  /** Apple left a submission with unresolved issues: a rejection. */
  unresolved: boolean;
};

/** By console app ID. A game missing here isn't on App Store Connect. */
export type AppStoreState = { apps: Record<string, AppStoreApp> };

export const REJECTED_STATES = ["REJECTED", "METADATA_REJECTED", "INVALID_BINARY"];
export const IN_REVIEW_STATES = ["WAITING_FOR_REVIEW", "IN_REVIEW"];
// Apple said yes; the version is on its way to the store or already there.
const APPROVED_STATES = [
  "PENDING_DEVELOPER_RELEASE",
  "PENDING_APPLE_RELEASE",
  "ACCEPTED",
  "PROCESSING_FOR_DISTRIBUTION",
  ...LIVE_STATES,
];

/**
 * `appsPage`: /v1/apps?include=appStoreVersions. `submissionsPage`: the review
 * submissions with unresolved issues, /v1/reviewSubmissions?filter[state]=UNRESOLVED_ISSUES.
 */
export function appStoreStateFrom(
  appsPage: any,
  submissionsPage: any,
  apps: MonitorApp[],
): AppStoreState {
  const included = new Map<string, any>(
    (appsPage.included ?? [])
      .filter((i: any) => i.type === "appStoreVersions")
      .map((i: any) => [i.id, i]),
  );
  const unresolved = new Set<string>(
    (submissionsPage?.data ?? [])
      .filter((s: any) => s.attributes?.state === "UNRESOLVED_ISSUES")
      .map((s: any) => s.relationships?.app?.data?.id)
      .filter(Boolean),
  );
  const state: AppStoreState = { apps: {} };
  for (const asc of appsPage.data ?? []) {
    // Apple's own filter matches partial bundle IDs; only an exact one is the game.
    const game = apps.find((a) => a.ios && a.ios === asc.attributes?.bundleId);
    if (!game) continue;
    const versions: AppStoreVersion[] = (asc.relationships?.appStoreVersions?.data ?? [])
      .map((ref: any) => included.get(ref.id))
      .filter(Boolean)
      .map((v: any) => ({
        id: v.id,
        version: v.attributes?.versionString ?? "",
        state: versionStateOf(v),
        platform: v.attributes?.platform ?? "IOS",
        created: v.attributes?.createdDate ?? null,
      }))
      .sort((a: AppStoreVersion, b: AppStoreVersion) =>
        (b.created ?? "").localeCompare(a.created ?? ""),
      );
    state.apps[game.id] = { ascId: asc.id, versions, unresolved: unresolved.has(asc.id) };
  }
  return state;
}

/** The version that matters: the newest iOS one (the games ship on iOS only). */
export function latestVersion(app: AppStoreApp | undefined): AppStoreVersion | null {
  if (!app) return null;
  return app.versions.find((v) => v.platform === "IOS") ?? app.versions[0] ?? null;
}

export type AppStoreEventKind = "in_review" | "approved" | "live" | "waiting_release" | "rejected";

export type AppStoreEvent = {
  kind: AppStoreEventKind;
  appId: string;
  version: string;
  /** Approved and published in one step. */
  live?: boolean;
};

/** What changed between two results. A game seen for the first time announces nothing. */
export function appStoreEvents(prev: AppStoreState | null, next: AppStoreState): AppStoreEvent[] {
  if (!prev) return [];
  const events: AppStoreEvent[] = [];
  for (const [appId, app] of Object.entries(next.apps)) {
    const before = prev.apps[appId];
    if (!before) continue;
    let rejected = false;
    for (const v of app.versions) {
      const was = before.versions.find((b) => b.id === v.id)?.state;
      if (!was || was === v.state) continue;
      const base = { appId, version: v.version };
      if (v.state === "IN_REVIEW") events.push({ kind: "in_review", ...base });
      else if (REJECTED_STATES.includes(v.state)) {
        rejected = true;
        events.push({ kind: "rejected", ...base });
      } else if (v.state === "PENDING_DEVELOPER_RELEASE") {
        events.push({ kind: "waiting_release", ...base });
      } else if (APPROVED_STATES.includes(v.state) && IN_REVIEW_STATES.includes(was)) {
        events.push({ kind: "approved", ...base, live: LIVE_STATES.includes(v.state) });
      } else if (LIVE_STATES.includes(v.state) && !LIVE_STATES.includes(was)) {
        events.push({ kind: "live", ...base });
      }
    }
    // Attaching a new build clears a rejection from the version, not from the submission.
    if (app.unresolved && !before.unresolved && !rejected) {
      events.push({ kind: "rejected", appId, version: latestVersion(app)?.version ?? "" });
    }
  }
  return events;
}

/* ------------------------------------------------------------------------------------ */
/* Reviews                                                                               */
/* ------------------------------------------------------------------------------------ */

/** A review as the job keeps it: enough for Home and for the alert. */
export type ReviewDigest = {
  id: string;
  stars: number | null;
  recommended: boolean | null;
  title: string;
  text: string;
  author: string | null;
  country: string | null;
  language: string | null;
  date: string;
  /** Someone wrote something and nobody has answered yet. */
  waiting: boolean;
  canReply: boolean;
  url: string | null;
};

export type ReviewsAppState = {
  /** Every review ID seen, so a new one stands out. */
  known: string[];
  /** The last REVIEW_MEMORY_DAYS days, newest first. */
  recent: ReviewDigest[];
};

/** One store's reviews, by console app ID. */
export type ReviewsState = { apps: Record<string, ReviewsAppState> };

export const REVIEW_MEMORY_DAYS = 60;
const MAX_KNOWN_IDS = 500;
const MAX_TEXT = 600;

export function digestReview(r: StoreReview): ReviewDigest {
  return {
    id: r.id,
    stars: r.stars,
    recommended: r.recommended,
    title: r.title.slice(0, 200),
    text: r.text.length > MAX_TEXT ? `${r.text.slice(0, MAX_TEXT)}…` : r.text,
    author: r.author,
    country: r.country,
    language: r.language,
    date: r.date,
    waiting: awaitsReply(r),
    canReply: r.canReply,
    url: r.url,
  };
}

/** Low rating: three stars or less, or not recommended on Steam. */
export function isLowRating(r: Pick<ReviewDigest, "stars" | "recommended">): boolean {
  return r.stars != null ? r.stars <= 3 : r.recommended === false;
}

export type ReviewEvent = { appId: string; store: ReviewStore; review: ReviewDigest };

/**
 * The new state of one store's reviews, and the reviews that are new since the last run.
 * `fetched` holds only the games that could be read; the others keep their last state.
 * A game read for the first time only records what's there.
 */
export function reviewsUpdate(
  store: ReviewStore,
  prev: ReviewsState | null,
  prevRanAt: string | null,
  fetched: Record<string, StoreReview[]>,
  now: Date,
): { state: ReviewsState; events: ReviewEvent[] } {
  const state: ReviewsState = { apps: { ...(prev?.apps ?? {}) } };
  const events: ReviewEvent[] = [];
  // A review older than the last run (with a margin for stores that publish late) was
  // just out of the window before, not written since.
  const newAfter = prevRanAt ? Date.parse(prevRanAt) - 3 * 86_400_000 : Infinity;
  for (const [appId, reviews] of Object.entries(fetched)) {
    const before = prev?.apps[appId];
    const known = new Set(before?.known ?? []);
    const digests = reviews.map(digestReview).sort((a, b) => b.date.localeCompare(a.date));
    if (before) {
      for (const r of digests) {
        if (!known.has(r.id) && Date.parse(r.date) >= newAfter) {
          events.push({ appId, store, review: r });
        }
      }
    }
    state.apps[appId] = {
      known: [...new Set([...digests.map((r) => r.id), ...known])].slice(0, MAX_KNOWN_IDS),
      recent: digests.filter((r) => Date.parse(r.date) >= daysAgo(now, REVIEW_MEMORY_DAYS)),
    };
  }
  return { state, events };
}

/* ------------------------------------------------------------------------------------ */
/* Deploys                                                                               */
/* ------------------------------------------------------------------------------------ */

export type WorkflowRun = {
  id: number;
  /** queued, in_progress, completed… */
  status: string;
  /** success, failure, cancelled… once completed. */
  conclusion: string | null;
  created: string;
  url: string;
  title: string;
};

/** The last deploy.yml run of each web game, by console app ID; null: never deployed. */
export type DeploysState = { apps: Record<string, WorkflowRun | null> };

/** The newest run in a /actions/workflows/{file}/runs answer. */
export function latestRun(page: any): WorkflowRun | null {
  const run = page?.workflow_runs?.[0];
  if (!run) return null;
  return {
    id: run.id,
    status: run.status,
    conclusion: run.conclusion ?? null,
    created: run.created_at,
    url: run.html_url,
    title: run.display_title ?? run.name ?? "",
  };
}

const FAILED = ["failure", "timed_out", "startup_failure"];

/** A failed run worth showing: recent enough that someone still means to ship it. */
export function failedRecently(run: WorkflowRun | null, now: Date, days = 14): boolean {
  return (
    !!run &&
    run.status === "completed" &&
    FAILED.includes(run.conclusion ?? "") &&
    Date.parse(run.created) >= daysAgo(now, days)
  );
}

/* ------------------------------------------------------------------------------------ */
/* Google Play crashes and ANRs                                                          */
/* ------------------------------------------------------------------------------------ */

export type CrashIssue = {
  type: "crash" | "anr";
  cause: string;
  location: string;
  reports: number;
  /** The issue in Play Console. */
  url: string | null;
};

export type Vitals = {
  /** The last 7 days Google has data for. */
  crashes: number;
  anrs: number;
  /** Players who hit one, added up day by day, so a player on two days counts twice. */
  users: number;
  /** The 7 days before, to tell a new problem from an old one. */
  crashesBefore: number;
  anrsBefore: number;
  /** The last day Google has data for (Pacific time). */
  until: string | null;
  top: CrashIssue | null;
};

/** By console app ID. A game missing here isn't on Google Play or couldn't be read. */
export type VitalsState = { apps: Record<string, Vitals> };

/**
 * `countsPage`: errorCountMetricSet:query, DAILY, with the reportType dimension.
 * `issuesPage`: errorIssues:search for the same week, or null when there was nothing.
 *
 * Google's crash-rate metric sets return no rows for games this small (it hides rates
 * under a number of users), so the job counts reports instead.
 */
export function vitalsFrom(countsPage: any, issuesPage: any): Vitals {
  const days = new Map<string, { crash: number; anr: number; users: number }>();
  for (const row of countsPage?.rows ?? []) {
    const t = row.startTime ?? {};
    const date = `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
    const type = row.dimensions?.find((d: any) => d.dimension === "reportType")?.stringValue;
    const metric = (name: string) =>
      Number(row.metrics?.find((m: any) => m.metric === name)?.decimalValue?.value ?? 0);
    const day = days.get(date) ?? { crash: 0, anr: 0, users: 0 };
    if (type === "ANR") day.anr += metric("errorReportCount");
    else day.crash += metric("errorReportCount");
    day.users += metric("distinctUsers");
    days.set(date, day);
  }
  const dates = [...days.keys()].sort().reverse();
  const week = dates.slice(0, 7).map((d) => days.get(d)!);
  const before = dates.slice(7, 14).map((d) => days.get(d)!);
  const total = (list: typeof week, key: "crash" | "anr" | "users") =>
    list.reduce((sum, d) => sum + d[key], 0);

  const issues: CrashIssue[] = (issuesPage?.errorIssues ?? []).map((i: any) => ({
    type: i.type === "APPLICATION_NOT_RESPONDING" ? "anr" : "crash",
    cause: String(i.cause ?? "").slice(0, 300),
    location: String(i.location ?? "").slice(0, 200),
    reports: Number(i.errorReportCount ?? 0),
    url: i.issueUri ?? null,
  }));
  return {
    crashes: total(week, "crash"),
    anrs: total(week, "anr"),
    users: total(week, "users"),
    crashesBefore: total(before, "crash"),
    anrsBefore: total(before, "anr"),
    until: dates[0] ?? null,
    top: issues.sort((a, b) => b.reports - a.reports)[0] ?? null,
  };
}

/**
 * A game "is crashing" when several players hit crashes or freezes this week. One report
 * from one phone happens to every game and isn't worth a message.
 */
export function isCrashing(v: Vitals | undefined): boolean {
  return !!v && v.crashes + v.anrs >= 3 && v.users >= 2;
}

export type CrashEvent = { appId: string; vitals: Vitals };

/** Games that started crashing since the last result. */
export function crashEvents(prev: VitalsState | null, next: VitalsState): CrashEvent[] {
  if (!prev) return [];
  return Object.entries(next.apps)
    .filter(([appId, v]) => isCrashing(v) && appId in prev.apps && !isCrashing(prev.apps[appId]))
    .map(([appId, vitals]) => ({ appId, vitals }));
}

/* ------------------------------------------------------------------------------------ */
/* Apple signing                                                                         */
/* ------------------------------------------------------------------------------------ */

export type SigningState = {
  certificates: { id: string; type: string; name: string; expires: string }[];
  /** App Store provisioning profiles. */
  profiles: { name: string; bundleId: string; expires: string }[];
};

/** `certificatesPage`: /v1/certificates. `profilesPage`: /v1/profiles?include=bundleId. */
export function signingStateFrom(certificatesPage: any, profilesPage: any): SigningState {
  const bundleIds = new Map<string, string>(
    (profilesPage?.included ?? [])
      .filter((i: any) => i.type === "bundleIds")
      .map((i: any) => [i.id, i.attributes?.identifier]),
  );
  return {
    certificates: (certificatesPage?.data ?? [])
      .filter((c: any) => /DISTRIBUTION/.test(c.attributes?.certificateType ?? ""))
      .map((c: any) => ({
        id: c.id,
        type: c.attributes.certificateType,
        name: c.attributes.displayName ?? c.attributes.name ?? "",
        expires: c.attributes.expirationDate,
      })),
    profiles: (profilesPage?.data ?? [])
      .filter((p: any) => p.attributes?.profileType === "IOS_APP_STORE")
      .map((p: any) => ({
        name: p.attributes.name ?? "",
        bundleId: bundleIds.get(p.relationships?.bundleId?.data?.id) ?? "",
        expires: p.attributes.expirationDate,
      })),
  };
}

/* ------------------------------------------------------------------------------------ */
/* The console's own jobs                                                                */
/* ------------------------------------------------------------------------------------ */

export type ConsoleState = {
  /** When the console's GitHub token stops working; null when it never expires. */
  tokenExpires: string | null;
  /** The last run of the nightly database backup. */
  backup: WorkflowRun | null;
  /** Scheduled workflows GitHub switched off, by name. */
  disabled: string[];
  /** The last push to bgp-admin. */
  pushedAt: string | null;
};

/** GitHub's header reads "2026-12-01 00:00:00 UTC" (or "+0100"). */
export function parseTokenExpiry(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ?(UTC|[+-]\d{4})?$/);
  if (!m) return null;
  const zone = !m[3] || m[3] === "UTC" ? "Z" : `${m[3].slice(0, 3)}:${m[3].slice(3)}`;
  const date = new Date(`${m[1]}T${m[2]}${zone}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export type BackupEvent = { run: WorkflowRun };

/** A backup run that failed and wasn't announced yet. */
export function backupEvents(prev: ConsoleState | null, next: ConsoleState): BackupEvent[] {
  const run = next.backup;
  if (!prev || !run || run.id === prev.backup?.id) return [];
  return run.status === "completed" && FAILED.includes(run.conclusion ?? "") ? [{ run }] : [];
}

/* ------------------------------------------------------------------------------------ */
/* Google Play's target API requirement                                                  */
/* ------------------------------------------------------------------------------------ */

/** The Android API level each web game's project targets, by console app ID. */
export type AndroidTargetState = { apps: Record<string, number | null> };

/**
 * From which day Google Play refuses new versions below each API level. The dates up to
 * 2026 are Google's; the 2027 one follows its yearly pattern (Android's version of the
 * year before) and should be checked when Google announces it.
 */
export const PLAY_TARGET_DEADLINES = [
  { api: 35, deadline: "2025-08-31" },
  { api: 36, deadline: "2026-08-31" },
  { api: 37, deadline: "2027-08-31" },
];

/** targetSdkVersion from a Capacitor project's android/variables.gradle. */
export function targetSdkOf(gradle: string): number | null {
  const m = gradle.match(/targetSdkVersion\s*=\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

/** The first requirement a game doesn't meet, whether its deadline has passed or not. */
export function nextPlayTarget(targetSdk: number): { api: number; deadline: string } | null {
  return PLAY_TARGET_DEADLINES.find((d) => d.api > targetSdk) ?? null;
}
