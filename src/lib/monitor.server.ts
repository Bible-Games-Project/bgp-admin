// Runs the monitor job: the checks of monitor.ts against App Store Connect, Google Play,
// Steam and GitHub. Each result is stored in monitor_checks for the Home page, and what
// changed since the last run goes to Telegram (alerts.ts). Runs every 15 minutes on the
// Worker (src/tasks/monitor.ts) and when someone presses Check now on Home. It writes
// with the service role: the scheduled run has no user.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import * as A from "./alerts";
import { type AscApi, createAscApi } from "./asc.server";
import { type Expense, expensePayments } from "./expenses";
import { githubHeaders } from "./github.functions";
import { fetchAccessToken, readServiceAccount } from "./google-play.server";
import { storedReviews, upcomingItems } from "./home";
import { eurConverter } from "./income-reports";
import { type StoredReport, storedIncome } from "./income-sync";
import { fetchEurRates } from "./income.server";
import * as M from "./monitor";
import {
  type ReviewStore,
  type StoreReview,
  appStoreReviews,
  mergePlayReviews,
  playApiReviews,
  steamReviews,
} from "./reviews";
import { STEAM_LANGUAGES } from "./steam.server";
import { sendTelegram, telegramChatId, telegramToken } from "./telegram.server";

/**
 * Cloudflare's free plan lets one run make 50 outgoing requests, database calls included.
 * RESERVED covers what every run needs besides the checks: reading the checks and the
 * games, saving the results, the Telegram chat and messages, and the Monday summary.
 */
const REQUEST_BUDGET = 50;
const RESERVED = 12;

const GITHUB_API = "https://api.github.com";
const CONSOLE_REPO = "Bible-Games-Project/bgp-admin";

const messageOf = (err: unknown) => (err as Error)?.message ?? "unknown error";

/* ------------------------------------------------------------------------------------ */
/* Clients, created once per run                                                         */
/* ------------------------------------------------------------------------------------ */

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function getJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    let message = text.slice(0, 300);
    try {
      const json = JSON.parse(text);
      message = json.error?.message ?? json.message ?? message;
    } catch {
      // Not JSON; keep the raw text.
    }
    throw new HttpError(`${res.status}: ${message}`, res.status);
  }
  return text ? JSON.parse(text) : {};
}

type Context = {
  now: Date;
  apps: M.MonitorApp[];
  /** The latest row of each check, updated as the run goes, so later checks see earlier results. */
  rows: Map<string, M.CheckRow>;
  asc: () => Promise<AscApi>;
  /** One Google token for both the Play Developer API and the Reporting API. */
  google: () => Promise<{ token: string; email: string }>;
};

function once<T>(make: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () => (promise ??= make());
}

const ascClient = () =>
  once(async () => {
    const api = await createAscApi();
    if (!api) {
      throw new Error(
        "App Store Connect is not connected: the APP_STORE_CONNECT_API_KEY_* secrets are missing.",
      );
    }
    return api;
  });

const googleClient = () =>
  once(async () => {
    const account = readServiceAccount();
    if (!account) {
      throw new Error(
        "Google Play is not connected: the GOOGLE_PLAY_SERVICE_ACCOUNT_JSON secret is missing.",
      );
    }
    const token = await fetchAccessToken(
      account,
      "https://www.googleapis.com/auth/androidpublisher https://www.googleapis.com/auth/playdeveloperreporting",
    );
    return { token, email: account.client_email };
  });

const github = (path: string, accept = "application/vnd.github+json") =>
  fetch(`${GITHUB_API}${path}`, { headers: { ...githubHeaders(), Accept: accept } });

async function githubJson(path: string): Promise<any | null> {
  const res = await github(path);
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(`GitHub answered ${res.status} for ${path}`, res.status);
  return res.json();
}

/* ------------------------------------------------------------------------------------ */
/* The checks                                                                            */
/* ------------------------------------------------------------------------------------ */

type Alert =
  | { type: "app_store"; event: M.AppStoreEvent }
  | { type: "review"; event: M.ReviewEvent }
  | { type: "crash"; event: M.CrashEvent }
  | { type: "backup"; event: M.BackupEvent };

type Result = { state: unknown; problem: string | null; alerts?: Alert[] };

type Check = {
  /** Outgoing requests it makes, at most. */
  cost: (ctx: Context) => number;
  run: (ctx: Context, prev: unknown) => Promise<Result>;
};

/** The stored state, or null when the check never got a result. */
function previous<T>(row: M.CheckRow | undefined): T | null {
  const state = row?.state as Record<string, unknown> | undefined;
  return state && Object.keys(state).length ? (state as T) : null;
}

const iosGames = (ctx: Context) => {
  const state = previous<M.AppStoreState>(ctx.rows.get("app_store"));
  return Object.entries(state?.apps ?? {}).map(([appId, app]) => ({ appId, ascId: app.ascId }));
};
const androidGames = (ctx: Context) => ctx.apps.filter((a) => a.android);
const steamGames = (ctx: Context) => ctx.apps.filter((a) => a.steam);
const webGames = (ctx: Context) => ctx.apps.filter((a) => a.repo);

/** Reads each game, skipping the ones the store doesn't have. */
async function reviewsCheck(
  store: ReviewStore,
  ctx: Context,
  prev: unknown,
  read: () => Promise<{ fetched: Record<string, StoreReview[]>; problem: string | null }>,
): Promise<Result> {
  const { fetched, problem } = await read();
  const row = ctx.rows.get(`reviews_${store}`);
  const { state, events } = M.reviewsUpdate(
    store,
    prev as M.ReviewsState | null,
    row?.ran_at ?? null,
    fetched,
    ctx.now,
  );
  return { state, problem, alerts: events.map((event) => ({ type: "review", event })) };
}

const steamLanguageLabels = new Map(Object.values(STEAM_LANGUAGES).map((l) => [l.api, l.label]));

/** A date in Pacific time, which Google's daily metrics are counted in. */
function pacificDate(date: Date) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .split("-")
    .map(Number);
  return { year: y, month: m, day: d };
}

const REPORTING_API = "https://playdeveloperreporting.googleapis.com/v1beta1";

const CHECK_RUNNERS: Record<M.CheckKey, Check> = {
  app_store: {
    cost: () => 2,
    run: async (ctx, prev) => {
      const api = await ctx.asc();
      const appsPage = await api.get(
        "/v1/apps?limit=200&fields[apps]=bundleId,appStoreVersions&include=appStoreVersions" +
          "&limit[appStoreVersions]=3" +
          "&fields[appStoreVersions]=versionString,appVersionState,appStoreState,platform,createdDate",
      );
      const draft = M.appStoreStateFrom(appsPage, null, ctx.apps);
      const ascIds = Object.values(draft.apps).map((a) => a.ascId);
      const submissions = ascIds.length
        ? await api.get(
            `/v1/reviewSubmissions?filter[app]=${ascIds.join(",")}&filter[state]=UNRESOLVED_ISSUES` +
              "&include=app&fields[reviewSubmissions]=state,app&limit=200",
          )
        : null;
      const state = M.appStoreStateFrom(appsPage, submissions, ctx.apps);
      const events = M.appStoreEvents(prev as M.AppStoreState | null, state);
      return {
        state,
        problem: null,
        alerts: events.map((event) => ({ type: "app_store", event })),
      };
    },
  },

  reviews_app_store: {
    cost: (ctx) => Math.max(iosGames(ctx).length, 1),
    run: (ctx, prev) =>
      reviewsCheck("app_store", ctx, prev, async () => {
        const api = await ctx.asc();
        const fetched: Record<string, StoreReview[]> = {};
        for (const { appId, ascId } of iosGames(ctx)) {
          const page = await api.get(
            `/v1/apps/${ascId}/customerReviews?limit=50&sort=-createdDate&include=response`,
          );
          fetched[appId] = appStoreReviews(page);
        }
        return { fetched, problem: null };
      }),
  },

  reviews_google_play: {
    cost: (ctx) => androidGames(ctx).length + 1,
    run: (ctx, prev) =>
      reviewsCheck("google_play", ctx, prev, async () => {
        const { token, email } = await ctx.google();
        const fetched: Record<string, StoreReview[]> = {};
        let refused = 0;
        for (const app of androidGames(ctx)) {
          try {
            const page = await getJson(
              `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(app.android!)}/reviews?maxResults=50`,
              { headers: { Authorization: `Bearer ${token}` } },
            );
            fetched[app.id] = mergePlayReviews(playApiReviews(page));
          } catch (err) {
            // Not on Google Play (404), or not shared with the console (403): the Reviews
            // page explains those per game. Anything else stops the check.
            if (err instanceof HttpError && err.status === 404) continue;
            if (err instanceof HttpError && err.status === 403) {
              refused++;
              continue;
            }
            throw err;
          }
        }
        const problem =
          refused && !Object.keys(fetched).length
            ? `Google Play didn't let the service account (${email}) read any game's reviews. In Play Console → Users and permissions → ${email}, check that it can see the games.`
            : null;
        return { fetched, problem };
      }),
  },

  reviews_steam: {
    cost: (ctx) => Math.max(steamGames(ctx).length, 1),
    run: (ctx, prev) =>
      reviewsCheck("steam", ctx, prev, async () => {
        const fetched: Record<string, StoreReview[]> = {};
        for (const app of steamGames(ctx)) {
          const json = await getJson(
            `https://store.steampowered.com/appreviews/${app.steam}?json=1&filter=recent&language=all&purchase_type=all&review_type=all&num_per_page=50`,
            { headers: { "User-Agent": "bgp-admin" } },
          );
          if (json.success !== 1) continue;
          fetched[app.id] = steamReviews(json, app.steam!, (name) => steamLanguageLabels.get(name));
        }
        return { fetched, problem: null };
      }),
  },

  deploys: {
    cost: (ctx) => Math.max(webGames(ctx).length, 1),
    run: async (ctx) => {
      const state: M.DeploysState = { apps: {} };
      for (const app of webGames(ctx)) {
        const page = await githubJson(
          `/repos/${app.repo!.owner}/${app.repo!.name}/actions/workflows/deploy.yml/runs?per_page=1&exclude_pull_requests=true`,
        );
        state.apps[app.id] = M.latestRun(page);
      }
      return { state, problem: null };
    },
  },

  play_vitals: {
    cost: (ctx) => 3 + 2 * androidGames(ctx).length,
    run: async (ctx, prev) => {
      const { token } = await ctx.google();
      const auth = { Authorization: `Bearer ${token}` };
      const search = await getJson(`${REPORTING_API}/apps:search?pageSize=100`, { headers: auth });
      const visible = new Set((search.apps ?? []).map((a: any) => a.packageName));

      const games = androidGames(ctx).filter((a) => visible.has(a.android));
      if (!games.length) return { state: { apps: {} }, problem: null };

      // Google refuses a range past the last day it has counted, usually yesterday or the
      // day before, and says which day that is.
      const set = await getJson(
        `${REPORTING_API}/apps/${encodeURIComponent(games[0].android!)}/errorCountMetricSet`,
        { headers: auth },
      );
      const fresh = (set.freshnessInfo?.freshnesses ?? []).find(
        (f: any) => f.aggregationPeriod === "DAILY",
      )?.latestEndTime;
      const end = fresh
        ? { year: fresh.year, month: fresh.month, day: fresh.day }
        : pacificDate(new Date(ctx.now.getTime() - 2 * 86_400_000));
      const endDate = new Date(Date.UTC(end.year, end.month - 1, end.day));
      const start = (() => {
        const d = new Date(endDate.getTime() - 14 * 86_400_000);
        return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
      })();
      const weekAgo = new Date(endDate.getTime() - 7 * 86_400_000);
      const la = { id: "America/Los_Angeles" };

      const state: M.VitalsState = { apps: {} };
      let failed = 0;
      let lastError = "";
      for (const app of games) {
        const name = `apps/${encodeURIComponent(app.android!)}`;
        try {
          const counts = await getJson(`${REPORTING_API}/${name}/errorCountMetricSet:query`, {
            method: "POST",
            headers: { ...auth, "Content-Type": "application/json" },
            body: JSON.stringify({
              timelineSpec: {
                aggregationPeriod: "DAILY",
                startTime: { ...start, timeZone: la },
                endTime: { ...end, timeZone: la },
              },
              metrics: ["errorReportCount", "distinctUsers"],
              dimensions: ["reportType"],
            }),
          });
          let vitals = M.vitalsFrom(counts, null);
          if (vitals.crashes + vitals.anrs > 0) {
            // The issues endpoint wants UTC; the week is close enough to the counts'.
            const issues = await getJson(
              `${REPORTING_API}/${name}/errorIssues:search?pageSize=5` +
                `&interval.startTime.year=${weekAgo.getUTCFullYear()}` +
                `&interval.startTime.month=${weekAgo.getUTCMonth() + 1}` +
                `&interval.startTime.day=${weekAgo.getUTCDate()}&interval.startTime.timeZone.id=UTC`,
              { headers: auth },
            );
            vitals = M.vitalsFrom(counts, issues);
          }
          state.apps[app.id] = vitals;
        } catch (err) {
          // One game Google can't answer for shouldn't hide the others.
          failed++;
          lastError = messageOf(err);
          const before = (prev as M.VitalsState | null)?.apps[app.id];
          if (before) state.apps[app.id] = before;
        }
      }
      const problem =
        failed && failed === games.length
          ? `Google Play's crash reports couldn't be read: ${lastError}`
          : null;
      const events = M.crashEvents(prev as M.VitalsState | null, state);
      return { state, problem, alerts: events.map((event) => ({ type: "crash", event })) };
    },
  },

  signing: {
    cost: () => 2,
    run: async (ctx) => {
      const api = await ctx.asc();
      const [certificates, profiles] = await Promise.all([
        api.get(
          "/v1/certificates?limit=200&fields[certificates]=certificateType,displayName,name,expirationDate",
        ),
        api.get(
          "/v1/profiles?limit=200&filter[profileType]=IOS_APP_STORE&include=bundleId" +
            "&fields[profiles]=name,profileType,expirationDate,bundleId&fields[bundleIds]=identifier",
        ),
      ]);
      return { state: M.signingStateFrom(certificates, profiles), problem: null };
    },
  },

  console: {
    cost: () => 4,
    run: async (_ctx, prev) => {
      const [limits, backups, workflows, repo] = await Promise.all([
        github("/rate_limit"),
        githubJson(`/repos/${CONSOLE_REPO}/actions/workflows/supabase-backup.yml/runs?per_page=1`),
        githubJson(`/repos/${CONSOLE_REPO}/actions/workflows?per_page=100`),
        githubJson(`/repos/${CONSOLE_REPO}`),
      ]);
      if (limits.status === 401) {
        throw new Error(
          "GitHub refused the console's token (GH_PAT): it has expired or was revoked. Make a new one with the same access and store it as the GH_PAT secret of bgp-admin.",
        );
      }
      const state: M.ConsoleState = {
        tokenExpires: M.parseTokenExpiry(
          limits.headers.get("github-authentication-token-expiration"),
        ),
        backup: M.latestRun(backups),
        disabled: (workflows?.workflows ?? [])
          .filter((w: any) => w.state === "disabled_inactivity")
          .map((w: any) => w.name),
        pushedAt: repo?.pushed_at ?? null,
      };
      const events = M.backupEvents(prev as M.ConsoleState | null, state);
      return { state, problem: null, alerts: events.map((event) => ({ type: "backup", event })) };
    },
  },

  android_target: {
    cost: (ctx) => Math.max(webGames(ctx).filter((a) => a.android).length, 1),
    run: async (ctx) => {
      const state: M.AndroidTargetState = { apps: {} };
      for (const app of webGames(ctx).filter((a) => a.android)) {
        const res = await github(
          `/repos/${app.repo!.owner}/${app.repo!.name}/contents/android/variables.gradle`,
          "application/vnd.github.raw+json",
        );
        // No Android project yet: Capacitor hasn't been set up for the game.
        if (res.status === 404) continue;
        if (!res.ok) throw new HttpError(`GitHub answered ${res.status}`, res.status);
        state.apps[app.id] = M.targetSdkOf(await res.text());
      }
      return { state, problem: null };
    },
  },
};

/* ------------------------------------------------------------------------------------ */
/* Reminders and the Monday summary                                                      */
/* ------------------------------------------------------------------------------------ */

/** The job's own memory, kept as the row "alerts" in monitor_checks. */
type AlertMemory = {
  /** The reminder threshold each upcoming item was last announced at. */
  reminded: Record<string, number>;
  /** The day reminders were last worked out, so it happens once a day. */
  remindersOn: string | null;
  /** The Monday (Madrid) the last weekly summary was sent for. */
  weekly: string | null;
};

const ALERTS_KEY = "alerts";

function madridNow(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Madrid",
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    weekday: parts.weekday as string,
    hour: Number(parts.hour),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

async function readExpenses(): Promise<Expense[]> {
  const { data, error } = await supabaseAdmin
    .from("expenses")
    .select("id, name, amount, currency, frequency, starts_on, ends_on, app_id, notes");
  if (error) throw new Error(`Could not read the expenses: ${error.message}`);
  return data as Expense[];
}

async function weeklySummary(ctx: Context, expenses: Expense[]): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("income_reports")
    .select("source, report, period, version, unconverted, rows");
  if (error) throw new Error(`Could not read the income: ${error.message}`);
  const { rows } = storedIncome(data as unknown as StoredReport[]);
  const today = ctx.now.toISOString().slice(0, 10);
  const year = today.slice(0, 4);
  const toEur = expenses.some((e) => e.currency !== "EUR")
    ? eurConverter(await fetchEurRates(`${year}-01-01`, today))
    : eurConverter({ daily: {}, latest: {} });
  const payments = expensePayments(expenses, today, toEur).filter((p) => p.date.startsWith(year));
  return A.weeklyMessage(
    A.weeklySummary({
      now: ctx.now,
      incomeRows: rows,
      payments,
      reviews: storedReviews([...ctx.rows.values()]),
    }),
    alertContext(ctx),
  );
}

function alertContext(ctx: Context): A.AlertContext {
  const consoleUrl = (
    import.meta.env.VITE_APP_SERVER_ORIGIN ||
    "https://bgp-admin-preview.biblegamesproject.workers.dev"
  ).replace(/\/$/, "");
  return {
    consoleUrl,
    appName: (id) => ctx.apps.find((a) => a.id === id)?.name ?? "A game",
  };
}

function alertMessage(alert: Alert, ctx: Context): string {
  const context = alertContext(ctx);
  switch (alert.type) {
    case "app_store":
      return A.appStoreMessage(alert.event, context);
    case "review":
      return A.reviewMessage(alert.event, context);
    case "crash":
      return A.crashMessage(alert.event, context);
    case "backup":
      return A.backupMessage(alert.event);
  }
}

/* ------------------------------------------------------------------------------------ */
/* The run                                                                               */
/* ------------------------------------------------------------------------------------ */

export type MonitorRun = {
  ran: M.CheckKey[];
  /** Checks still due that didn't fit in this run's requests; the next run goes on. */
  remaining: number;
  /** Telegram messages sent. */
  sent: number;
};

/** `since`: run every check that hasn't run since then (Check now), not only the due ones. */
export async function runMonitor(options: { since?: Date } = {}): Promise<MonitorRun> {
  const now = new Date();
  const db = supabaseAdmin;
  const [checksRes, appsRes] = await Promise.all([
    db.from("monitor_checks").select("key, ran_at, state, problem"),
    db
      .from("apps")
      .select(
        "id, name, bundle_id, android_package_name, steam_app_id, github_owner, github_repo, is_active",
      ),
  ]);
  if (checksRes.error) throw new Error(`Could not read the checks: ${checksRes.error.message}`);
  if (appsRes.error) throw new Error(`Could not read the games: ${appsRes.error.message}`);

  const rows = new Map<string, M.CheckRow>(checksRes.data.map((r) => [r.key, r as M.CheckRow]));
  const ctx: Context = {
    now,
    apps: appsRes.data.filter((a) => a.is_active).map(M.toMonitorApp),
    rows,
    asc: ascClient(),
    google: googleClient(),
  };

  const due = M.dueChecks(checksRes.data, now, options.since);
  const updates: M.CheckRow[] = [];
  const alerts: Alert[] = [];
  const ran: M.CheckKey[] = [];
  let spent = 0;
  let remaining = 0;
  for (const key of due) {
    const check = CHECK_RUNNERS[key];
    const cost = check.cost(ctx);
    if (spent + cost > REQUEST_BUDGET - RESERVED) {
      remaining++;
      continue;
    }
    spent += cost;
    const before = rows.get(key);
    let result: Result;
    try {
      result = await check.run(ctx, previous(before));
    } catch (err) {
      // Keep what the check knew: one failed look shouldn't wipe Home.
      result = { state: before?.state ?? {}, problem: messageOf(err) };
    }
    const row = { key, ran_at: now.toISOString(), state: result.state, problem: result.problem };
    rows.set(key, row);
    updates.push(row);
    alerts.push(...(result.alerts ?? []));
    ran.push(key);
  }

  const messages = alerts.map((a) => alertMessage(a, ctx));

  // Reminders (once a day) and the Monday summary.
  const memoryRow = rows.get(ALERTS_KEY);
  const memory: AlertMemory = {
    reminded: {},
    remindersOn: null,
    weekly: null,
    ...((memoryRow?.state as Partial<AlertMemory>) ?? {}),
  };
  const nextMemory: AlertMemory = { ...memory, reminded: { ...memory.reminded } };
  const madrid = madridNow(now);
  const reminders: string[] = [];
  let weekly: string | null = null;
  let expenses: Expense[] | null = null;
  try {
    if (memory.remindersOn !== madrid.date) {
      expenses = await readExpenses();
      const upcoming = upcomingItems({
        now,
        apps: ctx.apps,
        checks: [...rows.values()],
        incomeProblems: [],
        incomeRows: [],
        expenses,
      });
      for (const item of upcoming) {
        const threshold = A.reminderThreshold(item.daysLeft);
        if (threshold == null || item.daysLeft < 0) continue;
        const last = memory.reminded[item.id];
        if (last != null && last <= threshold) continue;
        reminders.push(A.upcomingMessage(item, alertContext(ctx), now));
        nextMemory.reminded[item.id] = threshold;
      }
      nextMemory.remindersOn = madrid.date;
    }
    if (madrid.weekday === "Mon" && madrid.hour >= 9 && memory.weekly !== madrid.date) {
      weekly = await weeklySummary(ctx, expenses ?? (await readExpenses()));
      nextMemory.weekly = madrid.date;
    }
  } catch (err) {
    console.error(`[monitor] Reminders or the weekly summary failed: ${messageOf(err)}`);
  }

  // Telegram. Without a bot or chat the checks still feed Home.
  let sent = 0;
  const all = [...messages, ...reminders, ...(weekly ? [weekly] : [])];
  if (all.length && telegramToken()) {
    try {
      const chat = await telegramChatId();
      if (chat) {
        for (const text of A.packMessages(all)) {
          await sendTelegram(text, chat);
          sent++;
        }
      }
    } catch (err) {
      console.error(`[monitor] Telegram failed: ${messageOf(err)}`);
      // Try the reminders and the summary again on the next run.
      if (reminders.length || weekly) {
        nextMemory.reminded = memory.reminded;
        nextMemory.remindersOn = memory.remindersOn;
        nextMemory.weekly = memory.weekly;
      }
    }
  }

  const toSave = [
    ...updates,
    ...(JSON.stringify(nextMemory) !== JSON.stringify(memory)
      ? [{ key: ALERTS_KEY, ran_at: now.toISOString(), state: nextMemory, problem: null }]
      : []),
  ];
  if (toSave.length) {
    const { error } = await db
      .from("monitor_checks")
      .upsert(toSave.map((r) => ({ ...r, state: r.state as Json })));
    if (error) throw new Error(`Could not store the checks: ${error.message}`);
  }
  return { ran, remaining, sent };
}
