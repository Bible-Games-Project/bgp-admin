// The Home page: what needs someone now, what is coming up, and how things stand, worked
// out from the monitor job's stored results (monitor.ts), the income job's problems, the
// income itself and the expenses. Pure, so every rule can be tested; home.functions.ts
// reads the database and the page renders what this returns.

import { IN_FLIGHT_STATES } from "./asc-states";
import {
  type Expense,
  type ExpensePayment,
  formatDay,
  isRunning,
  nextPaymentDate,
  periodProfit,
  priceLabel,
} from "./expenses";
import {
  type IncomeRow,
  type IncomeSource,
  type Preset,
  SOURCE_LABELS,
  monthKey,
  presetMonths,
} from "./income";
import {
  type AndroidTargetState,
  type AppStoreState,
  type CheckKey,
  type CheckRow,
  type ConsoleState,
  type DeploysState,
  type MonitorApp,
  type ReviewDigest,
  type ReviewsState,
  type SigningState,
  type VitalsState,
  CHECKS,
  CHECK_KEYS,
  IN_REVIEW_STATES,
  MONITOR_EVERY_MINUTES,
  REJECTED_STATES,
  failedRecently,
  isCrashing,
  isLowRating,
  latestVersion,
  nextPlayTarget,
} from "./monitor";
import { REVIEW_STORE_LABELS, type ReviewStore } from "./reviews";

export type Severity = "error" | "warning" | "info";

/** What a button on Home does. Plain data, so the server can send it to the page. */
export type HomeAction =
  | {
      kind: "link";
      label: string;
      to: string;
      params?: Record<string, string>;
      search?: Record<string, string>;
    }
  | { kind: "external"; label: string; href: string }
  /** Publishes an App Store version Apple approved and left waiting for the developer. */
  | { kind: "release"; label: string; appId: string; versionId: string };

export type AttentionItem = {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  appId?: string;
  actions: HomeAction[];
  /** A failed deploy run: the page reads its log and shows the error and who fixes it. */
  failedRun?: { appId: string; runId: number; runUrl: string; game: string };
};

export type UpcomingItem = {
  id: string;
  title: string;
  detail: string;
  /** YYYY-MM-DD */
  date: string;
  /** Negative once the day has passed. */
  daysLeft: number;
  actions: HomeAction[];
};

export type HomeInput = {
  now: Date;
  apps: MonitorApp[];
  checks: CheckRow[];
  incomeProblems: { source: IncomeSource; problem: string }[];
  expenses: Expense[];
};

const DAY = 86_400_000;

/** How many days from now until `date`, counting a day that has started as today. */
export function daysUntil(date: string | Date, now: Date): number {
  const target = typeof date === "string" ? new Date(date) : date;
  const startOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startOf(target) - startOf(now)) / DAY);
}

function stateOf<T>(checks: CheckRow[], key: CheckKey): T | null {
  const row = checks.find((c) => c.key === key);
  return row ? (row.state as T) : null;
}

const REVIEW_CHECKS: Record<ReviewStore, CheckKey> = {
  app_store: "reviews_app_store",
  google_play: "reviews_google_play",
  steam: "reviews_steam",
};

/** Each store's stored reviews, flattened, with the game and store they belong to. */
export function storedReviews(
  checks: CheckRow[],
): (ReviewDigest & { appId: string; store: ReviewStore })[] {
  return (Object.keys(REVIEW_CHECKS) as ReviewStore[]).flatMap((store) =>
    Object.entries(stateOf<ReviewsState>(checks, REVIEW_CHECKS[store])?.apps ?? {}).flatMap(
      ([appId, app]) => app.recent.map((r) => ({ ...r, appId, store })),
    ),
  );
}

const deployTab = (appId: string, label = "Open Deploy"): HomeAction => ({
  kind: "link",
  label,
  to: "/apps/$id",
  params: { id: appId },
  search: { tab: "deploy" },
});

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const average = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

const AI_CHAT_HINT = "If it's unclear, paste it into an AI chat and ask what to do.";

/**
 * What to do about a rejection, and whose job it is. The three states mean different
 * things: INVALID_BINARY is Apple's automatic check of the build file (only a new build
 * fixes it, and Apple explains it by email, not in the Resolution Center),
 * METADATA_REJECTED is the store listing (fixed in App Store Connect, no build), and
 * REJECTED is a reviewer whose message says which of the two it is.
 */
function rejectionItem(
  appId: string,
  app: { ascId: string },
  v: { version: string; state: string },
  game: MonitorApp | undefined,
): AttentionItem {
  const name = game?.name ?? "A game";
  const web = !!game?.repo;
  const message: HomeAction = {
    kind: "external",
    label: "Read Apple's message",
    href: `https://appstoreconnect.apple.com/apps/${app.ascId}/resolutioncenter`,
  };
  const base = { id: `rejected:${appId}`, severity: "error" as const, appId };

  if (v.state === "INVALID_BINARY") {
    return {
      ...base,
      title: `Apple refused the build of ${name} ${v.version}`,
      detail: `For the developer: Apple's automatic checks found a problem inside the build file, so nothing changed in App Store Connect fixes it. Apple emailed the reason to the Apple account's owner (an email from App Store Connect with codes like ITMS-91053). Forward that email to the developer. ${
        web
          ? "Once the fix is in, the new build goes out from the Deploy tab, on the same submission."
          : "This game is built outside the console, so the developer makes and uploads the new build."
      } To understand the email, paste it into an AI chat.`,
      actions: [
        ...(web ? [deployTab(appId)] : []),
        {
          kind: "external",
          label: "Open App Store Connect",
          href: `https://appstoreconnect.apple.com/apps/${app.ascId}/distribution`,
        },
      ],
    };
  }
  if (v.state === "METADATA_REJECTED") {
    return {
      ...base,
      title: `Apple rejected the store listing of ${name} ${v.version}`,
      detail: `Yours to fix, in App Store Connect: the build is fine, Apple objects to something in the listing (texts, screenshots, privacy details…). Read Apple's message, fix what it asks in App Store Connect or the game's Store tab, then reply to Apple on that same message. No new build needed. ${AI_CHAT_HINT}`,
      actions: [
        message,
        {
          kind: "link",
          label: "Open the Store tab",
          to: "/apps/$id",
          params: { id: appId },
          search: { tab: "store" },
        },
      ],
    };
  }
  return {
    ...base,
    title: `Apple rejected ${name} ${v.version}`,
    detail: `Read Apple's message. ${AI_CHAT_HINT} If Apple asks for something in App Store Connect (the review contact, a demo account, screenshots, texts, privacy details), it's yours: fix it there and reply on the same message. If Apple asks for a change inside the game, forward the message to the developer${
      web
        ? "; the new build then goes out from the Deploy tab, which shows how to answer on the same submission."
        : ", who makes the new build: this game is built outside the console."
    }`,
    actions: [message, ...(web ? [deployTab(appId)] : [])],
  };
}

/* ------------------------------------------------------------------------------------ */
/* Needs attention                                                                       */
/* ------------------------------------------------------------------------------------ */

export function attentionItems(input: HomeInput): AttentionItem[] {
  const { now, apps, checks } = input;
  const name = (id: string) => apps.find((a) => a.id === id)?.name ?? "A game";
  const items: AttentionItem[] = [];

  // Apple's answers.
  const appStore = stateOf<AppStoreState>(checks, "app_store");
  for (const [appId, app] of Object.entries(appStore?.apps ?? {})) {
    const v = latestVersion(app);
    if (!v) continue;
    if (REJECTED_STATES.includes(v.state) || app.unresolved) {
      items.push(
        rejectionItem(
          appId,
          app,
          v,
          apps.find((a) => a.id === appId),
        ),
      );
    } else if (v.state === "PENDING_DEVELOPER_RELEASE") {
      items.push({
        id: `release:${appId}`,
        severity: "warning",
        appId,
        title: `${name(appId)} ${v.version} is approved and waiting for you`,
        detail: "Apple approved it. Players get it once you release it.",
        actions: [{ kind: "release", label: "Release it now", appId, versionId: v.id }],
      });
    }
  }

  // Deploys that failed.
  const deploys = stateOf<DeploysState>(checks, "deploys");
  for (const [appId, run] of Object.entries(deploys?.apps ?? {})) {
    if (!run || !failedRecently(run, now)) continue;
    items.push({
      id: `deploy:${appId}`,
      severity: "error",
      appId,
      title: `The last deploy of ${name(appId)} failed`,
      detail: `"${run.title}", ${formatDay(run.created.slice(0, 10))}.`,
      actions: [deployTab(appId)],
      failedRun: { appId, runId: run.id, runUrl: run.url, game: name(appId) },
    });
  }

  // Android crashes.
  const vitals = stateOf<VitalsState>(checks, "play_vitals");
  for (const [appId, v] of Object.entries(vitals?.apps ?? {})) {
    if (!isCrashing(v)) continue;
    const top = v.top
      ? ` Most common: ${v.top.type === "anr" ? "a freeze in" : "a crash in"} ${v.top.cause || v.top.location}.`
      : "";
    items.push({
      id: `crashing:${appId}`,
      severity: "error",
      appId,
      title: `${name(appId)} is crashing on Android`,
      detail: `${plural(v.crashes, "crash", "crashes")} and ${plural(v.anrs, "freeze")} in the 7 days up to ${formatDay(v.until ?? now.toISOString().slice(0, 10))}, from about ${plural(v.users, "player")}.${top}`,
      actions: v.top?.url
        ? [{ kind: "external", label: "Open in Play Console", href: v.top.url }]
        : [],
    });
  }

  // Low-rated reviews nobody answered, one item per game.
  const waiting = storedReviews(checks).filter((r) => r.waiting && isLowRating(r));
  for (const appId of [...new Set(waiting.map((r) => r.appId))]) {
    const reviews = waiting.filter((r) => r.appId === appId);
    const latest = reviews.sort((a, b) => b.date.localeCompare(a.date))[0];
    const quote = (latest.title || latest.text).slice(0, 140);
    items.push({
      id: `reviews:${appId}`,
      severity: "warning",
      appId,
      title: `${plural(reviews.length, "low-rated review")} of ${name(appId)} waiting for a reply`,
      detail: `Latest, on ${REVIEW_STORE_LABELS[latest.store]}: "${quote}${quote.length === 140 ? "…" : ""}"`,
      actions: [
        {
          kind: "link",
          label: "Reply",
          to: "/reviews",
          search: { app: appId, waiting: "1", sentiment: "negative" },
        },
      ],
    });
  }

  // Store reports the income job can't read.
  for (const p of input.incomeProblems) {
    items.push({
      id: `income:${p.source}`,
      severity: "warning",
      title: `${SOURCE_LABELS[p.source]} sales reports can't be read`,
      detail: p.problem,
      actions: [{ kind: "link", label: "Open Revenue", to: "/revenue" }],
    });
  }

  // The console's own jobs.
  const jobs = stateOf<ConsoleState>(checks, "console");
  if (jobs?.backup && failedRecently(jobs.backup, now, 3)) {
    items.push({
      id: "backup",
      severity: "error",
      title: "The nightly database backup failed",
      detail: `The run of ${formatDay(jobs.backup.created.slice(0, 10))} failed, so there is no fresh copy of the console's data. The next one runs tonight; if that fails too, its log says why.`,
      actions: [{ kind: "external", label: "Open the run", href: jobs.backup.url }],
    });
  }
  if (jobs?.disabled.length) {
    items.push({
      id: "disabled-workflows",
      severity: "error",
      title: `GitHub switched off ${jobs.disabled.join(", ")}`,
      detail:
        "GitHub stops scheduled jobs in a public repo that gets no pushes for 60 days. In GitHub → bgp-admin → Actions, open each one and press Enable workflow.",
      actions: [
        {
          kind: "external",
          label: "Open GitHub Actions",
          href: "https://github.com/Bible-Games-Project/bgp-admin/actions",
        },
      ],
    });
  }

  // Google Play refusing updates.
  const targets = stateOf<AndroidTargetState>(checks, "android_target");
  for (const [appId, sdk] of Object.entries(targets?.apps ?? {})) {
    const next = sdk == null ? null : nextPlayTarget(sdk);
    if (!next || daysUntil(next.deadline, now) >= 0) continue;
    items.push({
      id: `target:${appId}`,
      severity: "error",
      appId,
      title: `Google Play refuses new versions of ${name(appId)}`,
      detail: `It targets Android API ${sdk}, and Google requires API ${next.api} since ${formatDay(next.deadline)}. Its Android project needs a newer Capacitor: a developer task.`,
      actions: [],
    });
  }

  // Anything already expired.
  for (const u of upcomingItems(input).filter((u) => u.daysLeft < 0)) {
    items.push({
      id: `expired:${u.id}`,
      severity: "error",
      title: u.title.replace(/ expires$/, " has expired"),
      detail: u.detail,
      actions: u.actions,
    });
  }

  // Checks that couldn't look.
  for (const c of checks) {
    if (!c.problem || !(c.key in CHECKS)) continue;
    items.push({
      id: `check:${c.key}`,
      severity: "warning",
      title: `The console couldn't check ${CHECKS[c.key as CheckKey].label}`,
      detail: c.problem,
      actions: [],
    });
  }

  // The job itself.
  const lastRun = checks
    .filter((c) => c.key in CHECKS)
    .map((c) => Date.parse(c.ran_at))
    .sort()
    .at(-1);
  if (lastRun && now.getTime() - lastRun > 8 * MONITOR_EVERY_MINUTES * 60_000) {
    items.push({
      id: "monitor-stalled",
      severity: "warning",
      title: "The console stopped checking",
      detail: `Its last check ran on ${new Date(lastRun).toLocaleString("en-GB", { timeZone: "Europe/Madrid" })}, so this page may be out of date. Press Check now to run them.`,
      actions: [],
    });
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

/* ------------------------------------------------------------------------------------ */
/* Coming up                                                                             */
/* ------------------------------------------------------------------------------------ */

/** How far ahead each kind of date shows on Home, in days. */
export const UPCOMING_WINDOW = {
  certificate: 60,
  profile: 60,
  token: 30,
  androidTarget: 120,
  expense: 30,
  inactivity: 14,
};

/** Dates that break something (or cost money) when they pass, soonest first. */
export function upcomingItems(input: HomeInput): UpcomingItem[] {
  const { now, apps, checks } = input;
  const items: UpcomingItem[] = [];
  const add = (
    window: number,
    item: Omit<UpcomingItem, "daysLeft" | "actions"> & { actions?: HomeAction[] },
  ) => {
    const daysLeft = daysUntil(item.date, now);
    if (daysLeft <= window) items.push({ ...item, daysLeft, actions: item.actions ?? [] });
  };
  const day = (iso: string) => iso.slice(0, 10);

  const signing = stateOf<SigningState>(checks, "signing");
  for (const c of signing?.certificates ?? []) {
    add(UPCOMING_WINDOW.certificate, {
      id: `certificate:${c.id}`,
      title: "The Apple distribution certificate expires",
      detail: `"${c.name}". After that day no iOS build can be signed. Renewing it (a new certificate, then new profiles and the games' signing secrets) is a developer task.`,
      date: day(c.expires),
    });
  }
  // Each game's newest App Store profile is the one its builds use.
  for (const app of apps.filter((a) => a.ios)) {
    const newest = (signing?.profiles ?? [])
      .filter((p) => p.bundleId === app.ios)
      .sort((a, b) => b.expires.localeCompare(a.expires))[0];
    if (!newest) continue;
    add(UPCOMING_WINDOW.profile, {
      id: `profile:${app.ios}`,
      title: `The App Store profile of ${app.name} expires`,
      detail: `"${newest.name}". The game's iOS builds fail after that day until the profile is renewed and its signing secret updated: a developer task.`,
      date: day(newest.expires),
    });
  }

  const jobs = stateOf<ConsoleState>(checks, "console");
  if (jobs?.tokenExpires) {
    add(UPCOMING_WINDOW.token, {
      id: "github-token",
      title: "The console's GitHub token expires",
      detail:
        "After that the console can't deploy, set up games or check GitHub. Make a new token in GitHub (Settings → Developer settings) with the same access and store it as the GH_PAT secret of bgp-admin.",
      date: day(jobs.tokenExpires),
    });
  }
  if (jobs?.pushedAt) {
    add(UPCOMING_WINDOW.inactivity, {
      id: "inactivity",
      title: "GitHub pauses the console's nightly jobs",
      detail:
        "GitHub stops scheduled jobs, such as the database backup, in a public repo that gets no pushes for 60 days. Any push to bgp-admin before then keeps them running.",
      date: day(new Date(Date.parse(jobs.pushedAt) + 60 * DAY).toISOString()),
    });
  }

  const targets = stateOf<AndroidTargetState>(checks, "android_target");
  for (const [appId, sdk] of Object.entries(targets?.apps ?? {})) {
    const next = sdk == null ? null : nextPlayTarget(sdk);
    if (!next || daysUntil(next.deadline, now) < 0) continue;
    const name = apps.find((a) => a.id === appId)?.name ?? "A game";
    add(UPCOMING_WINDOW.androidTarget, {
      id: `target:${appId}:${next.api}`,
      title: `${name} must target Android API ${next.api}`,
      detail: `From that day Google Play refuses new versions below API ${next.api}, and ${name} targets ${sdk}. Its Android project needs a newer Capacitor: a developer task.`,
      date: next.deadline,
    });
  }

  const today = now.toISOString().slice(0, 10);
  for (const e of input.expenses) {
    if (e.frequency !== "yearly" || !isRunning(e, today)) continue;
    const next = nextPaymentDate(e, today);
    if (!next) continue;
    add(UPCOMING_WINDOW.expense, {
      id: `expense:${e.id}:${next}`,
      title: `${e.name} renews`,
      detail: `${priceLabel(e)}. Cancel it before then if the project no longer needs it.`,
      date: next,
      actions: [{ kind: "link", label: "Open Expenses", to: "/expenses" }],
    });
  }

  return items.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Apple has no API for the Developer Program's renewal date, and letting it lapse takes
 * every game off the App Store. When no yearly expense looks like it, Home asks for one.
 */
export function needsAppleMembershipExpense(expenses: Expense[], now: Date): boolean {
  const today = now.toISOString().slice(0, 10);
  return !expenses.some(
    (e) =>
      e.frequency === "yearly" && isRunning(e, today) && /apple|developer program/i.test(e.name),
  );
}

/* ------------------------------------------------------------------------------------ */
/* Profit                                                                                */
/* ------------------------------------------------------------------------------------ */

/**
 * The period Home's profit covers: Revenue's default, where its link lands. Twelve months
 * hold every yearly fee once and smooth out the months a big payment falls in.
 */
export const PROFIT_PRESET: Preset = "12m";

export type ProfitGlance = {
  preset: Preset;
  /** The first month counted, YYYY-MM; the period runs to today. */
  since: string;
  income: number;
  spent: number;
  profit: number;
  /** Counts Google Play months it hasn't closed yet, worked out from its sales. */
  estimated: boolean;
  /** Stores whose income may be short: reports the job can't read, or unconverted sales. */
  incomplete: IncomeSource[];
  /** No expense entered at all, so the profit is just the income. */
  noExpenses: boolean;
  /** Dollar payments counted as 0 € for want of an exchange rate. */
  unconvertedCosts: boolean;
  /** The income job hasn't read both stores yet. */
  unread: boolean;
};

/** Revenue's numbers for PROFIT_PRESET with every app and store, and what may skew them. */
export function profitGlance(input: {
  now: Date;
  incomeRows: IncomeRow[];
  incomeProblems: { source: IncomeSource }[];
  incomeCheckedAt: string | null;
  expenses: Expense[];
  payments: ExpensePayment[];
}): ProfitGlance {
  const p = periodProfit(input.incomeRows, input.payments, PROFIT_PRESET, input.now);
  return {
    preset: PROFIT_PRESET,
    since: presetMonths(PROFIT_PRESET, input.now)?.[0] ?? monthKey(input.now),
    income: p.income.netEur,
    spent: p.spent,
    profit: p.profit,
    estimated: p.income.estimated,
    incomplete: [...new Set(input.incomeProblems.map((x) => x.source))],
    noExpenses: input.expenses.length === 0,
    unconvertedCosts: p.payments.some((x) => x.eur == null),
    unread: !input.incomeCheckedAt,
  };
}

/* ------------------------------------------------------------------------------------ */
/* Players this week                                                                     */
/* ------------------------------------------------------------------------------------ */

export type Glance = {
  /** What players wrote in the stores: the last 7 days, and every recent one unanswered. */
  reviews: { week: number; average: number | null; waiting: number };
  /**
   * Google Play's crash and freeze reports of the last 7 days; null until checked. Only
   * Android: Apple's crash counts aren't read (see the Crashes card on Home).
   */
  androidCrashes: { crashes: number; anrs: number; games: string[] } | null;
};

export function glance(input: HomeInput): Glance {
  const { now, apps, checks } = input;
  const reviews = storedReviews(checks);
  const week = reviews.filter((r) => Date.parse(r.date) >= now.getTime() - 7 * DAY);
  const stars = week.map((r) => r.stars).filter((s): s is number => s != null);

  const vitals = stateOf<VitalsState>(checks, "play_vitals");
  const v = Object.entries(vitals?.apps ?? {});
  return {
    reviews: {
      week: week.length,
      average: average(stars),
      waiting: reviews.filter((r) => r.waiting).length,
    },
    androidCrashes: vitals
      ? {
          crashes: v.reduce((s, [, x]) => s + x.crashes, 0),
          anrs: v.reduce((s, [, x]) => s + x.anrs, 0),
          games: v
            .filter(([, x]) => x.crashes + x.anrs > 0)
            .map(([appId]) => apps.find((a) => a.id === appId)?.name ?? "A game")
            .sort((a, b) => a.localeCompare(b)),
        }
      : null,
  };
}

/* ------------------------------------------------------------------------------------ */
/* Games                                                                                 */
/* ------------------------------------------------------------------------------------ */

/**
 * What happened to a game in the last 7 days, or is under way. Problems aren't here:
 * a rejection, a version waiting to be released, a failed deploy and a crashing game are
 * Needs attention items already.
 */
export type GameEvent =
  /** A version Apple is checking before it can go on the App Store. */
  | { kind: "apple_approval"; version: string; state: string }
  /** Approved; Apple is putting it on the App Store. */
  | { kind: "approved"; version: string }
  | { kind: "deploying"; since: string }
  | { kind: "deployed"; at: string }
  /** Reviews players wrote in the stores. */
  | { kind: "player_reviews"; count: number; average: number | null };

export type GameHighlight = { id: string; name: string; events: GameEvent[] };

// Approved, and neither live yet nor waiting for the developer (an attention item).
const ON_THE_WAY_STATES = IN_FLIGHT_STATES.filter(
  (s) => !IN_REVIEW_STATES.includes(s) && s !== "PENDING_DEVELOPER_RELEASE",
);

/** The games something happened to this week, those with something under way first. */
export function gameHighlights(input: HomeInput): GameHighlight[] {
  const { now, apps, checks } = input;
  const appStore = stateOf<AppStoreState>(checks, "app_store");
  const deploys = stateOf<DeploysState>(checks, "deploys");
  const weekAgo = now.getTime() - 7 * DAY;
  const reviews = storedReviews(checks).filter((r) => Date.parse(r.date) >= weekAgo);

  const highlights = apps.map((a): GameHighlight => {
    const events: GameEvent[] = [];
    const store = appStore?.apps[a.id];
    const v = latestVersion(store);
    // A submission with unresolved issues is a rejection, whatever the version says.
    if (v && !store!.unresolved) {
      if (IN_REVIEW_STATES.includes(v.state)) {
        events.push({ kind: "apple_approval", version: v.version, state: v.state });
      } else if (ON_THE_WAY_STATES.includes(v.state)) {
        events.push({ kind: "approved", version: v.version });
      }
    }
    const run = deploys?.apps[a.id];
    // GitHub cancels a run still queued after a day, so an older one isn't really running.
    if (run && run.status !== "completed" && Date.parse(run.created) >= now.getTime() - DAY) {
      events.push({ kind: "deploying", since: run.created });
    } else if (run?.conclusion === "success" && Date.parse(run.created) >= weekAgo) {
      events.push({ kind: "deployed", at: run.created });
    }
    const own = reviews.filter((r) => r.appId === a.id);
    if (own.length) {
      events.push({
        kind: "player_reviews",
        count: own.length,
        average: average(own.map((r) => r.stars).filter((s): s is number => s != null)),
      });
    }
    return { id: a.id, name: a.name, events };
  });

  const underWay = (g: GameHighlight) =>
    g.events.some((e) => e.kind !== "player_reviews" && e.kind !== "deployed");
  return highlights
    .filter((g) => g.events.length)
    .sort((a, b) => Number(underWay(b)) - Number(underWay(a)) || a.name.localeCompare(b.name));
}

/** When the checks last ran, for the page header; null when they never have. */
export function lastChecked(checks: CheckRow[]): string | null {
  const times = checks.filter((c) => CHECK_KEYS.includes(c.key as CheckKey)).map((c) => c.ran_at);
  return times.sort().at(-1) ?? null;
}
