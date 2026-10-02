// The Telegram messages the monitor job sends: what changed since its last run, dates
// coming up, and the Monday summary. Pure, so the wording can be tested; telegram.server.ts
// sends them. Telegram's HTML mode is used, so every value from outside is escaped.

import type { ExpensePayment } from "./expenses";
import { type UpcomingItem, daysUntil } from "./home";
import { type IncomeRow, SOURCE_LABELS, addMonths, monthKey } from "./income";
import type { AppStoreEvent, BackupEvent, CrashEvent, ReviewDigest, ReviewEvent } from "./monitor";
import { isLowRating } from "./monitor";
import { REVIEW_STORE_LABELS } from "./reviews";

/** Telegram refuses messages over 4,096 characters. */
export const TELEGRAM_LIMIT = 4096;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const link = (href: string, text: string) =>
  `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
const b = (text: string) => `<b>${escapeHtml(text)}</b>`;

export type AlertContext = {
  /** The console's address, for links back to it. */
  consoleUrl: string;
  appName: (appId: string) => string;
};

export function starsLine(stars: number): string {
  return "★".repeat(stars) + "☆".repeat(Math.max(0, 5 - stars));
}

export function reviewMessage(e: ReviewEvent, ctx: AlertContext): string {
  const r = e.review;
  const verdict =
    r.stars != null ? starsLine(r.stars) : r.recommended ? "👍 Recommended" : "👎 Not recommended";
  const where = [REVIEW_STORE_LABELS[e.store], r.country ?? r.language].filter(Boolean).join(" · ");
  const lines = [
    `${isLowRating(r) ? "⚠️ " : ""}${verdict}  ${b(ctx.appName(e.appId))}`,
    escapeHtml(where),
  ];
  if (r.title) lines.push(b(r.title));
  if (r.text) lines.push(escapeHtml(r.text));
  if (r.author) lines.push(`— ${escapeHtml(r.author)}`);
  const reply =
    e.store === "steam"
      ? r.url && link(r.url, "Reply on Steam")
      : link(`${ctx.consoleUrl}/reviews?app=${e.appId}`, "Reply in the console");
  if (reply) lines.push(reply);
  return lines.join("\n");
}

export function appStoreMessage(e: AppStoreEvent, ctx: AlertContext): string {
  const game = `${b(ctx.appName(e.appId))} ${escapeHtml(e.version)}`;
  const home = link(`${ctx.consoleUrl}/`, "Open Home");
  switch (e.kind) {
    case "in_review":
      return `🔎 Apple started reviewing ${game}.`;
    case "approved":
      return e.live
        ? `✅ Apple approved ${game}. It's live on the App Store.`
        : `✅ Apple approved ${game}. It reaches the App Store shortly.`;
    case "live":
      return `🚀 ${game} is live on the App Store.`;
    case "waiting_release":
      return `✅ Apple approved ${game}. It's waiting for you to release it: ${home}`;
    case "rejected":
      if (e.state === "INVALID_BINARY") {
        return `❌ Apple refused the build of ${game}. Only a new build fixes it: a job for the developer, with the email Apple sent. Home has the details: ${home}`;
      }
      if (e.state === "METADATA_REJECTED") {
        return `❌ Apple rejected the store listing of ${game}. Yours to fix in App Store Connect, no new build needed. Home says what to do: ${home}`;
      }
      return `❌ Apple rejected ${game}. Home says what to do next and whose job it is: ${home}`;
  }
}

export function crashMessage(e: CrashEvent, ctx: AlertContext): string {
  const v = e.vitals;
  const lines = [
    `🔥 ${b(ctx.appName(e.appId))} is crashing on Android: ${v.crashes} crash${v.crashes === 1 ? "" : "es"} and ${v.anrs} freeze${v.anrs === 1 ? "" : "s"} in the last 7 days, from about ${v.users} player${v.users === 1 ? "" : "s"}.`,
  ];
  if (v.top) {
    lines.push(`Most common: <code>${escapeHtml(v.top.cause || v.top.location)}</code>`);
    if (v.top.url) lines.push(link(v.top.url, "Open in Play Console"));
  }
  return lines.join("\n");
}

export function backupMessage(e: BackupEvent): string {
  return `⚠️ Last night's database backup failed, so there is no fresh copy of the console's data. ${link(e.run.url, "Open the run")}`;
}

export function upcomingMessage(item: UpcomingItem, ctx: AlertContext, now: Date): string {
  const days = daysUntil(item.date, now);
  const when = days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  return `⏰ ${b(item.title)} ${when} (${escapeHtml(item.date)}).\n${escapeHtml(item.detail)}\n${link(`${ctx.consoleUrl}/`, "Open Home")}`;
}

/**
 * Days before a date when Telegram reminds about it. An item is announced once per
 * threshold it crosses, the next one down from the days it has left.
 */
export const REMINDER_DAYS = [60, 30, 7, 1];

/** The threshold an item is at now, or null when it's further away than all of them. */
export function reminderThreshold(daysLeft: number): number | null {
  const candidates = REMINDER_DAYS.filter((d) => daysLeft <= d);
  return candidates.length ? Math.min(...candidates) : null;
}

export type WeeklySummary = {
  thisMonth: { label: string; eur: number; byStore: { label: string; eur: number }[] };
  lastMonth: { label: string; eur: number };
  year: { label: string; income: number; expenses: number | null };
  reviews: { count: number; average: number | null; waiting: number };
  estimated: boolean;
};

const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });

/** The numbers of the Monday summary. `payments`: this year's expense payments so far. */
export function weeklySummary(input: {
  now: Date;
  incomeRows: IncomeRow[];
  payments: ExpensePayment[];
  reviews: Pick<ReviewDigest, "date" | "stars" | "waiting">[];
}): WeeklySummary {
  const { now, incomeRows } = input;
  const current = monthKey(now);
  const previous = addMonths(current, -1);
  const year = current.slice(0, 4);
  const sum = (rows: IncomeRow[]) => rows.reduce((s, r) => s + r.netEur, 0);
  const inMonth = incomeRows.filter((r) => r.period === current);
  const week = input.reviews.filter((r) => Date.parse(r.date) >= now.getTime() - 7 * 86_400_000);
  const stars = week.map((r) => r.stars).filter((s): s is number => s != null);
  return {
    thisMonth: {
      label: monthName(current),
      eur: sum(inMonth),
      byStore: (["app_store", "google_play"] as const).map((source) => ({
        label: SOURCE_LABELS[source],
        eur: sum(inMonth.filter((r) => r.source === source)),
      })),
    },
    lastMonth: {
      label: monthName(previous),
      eur: sum(incomeRows.filter((r) => r.period === previous)),
    },
    year: {
      label: year,
      // Months only: the App Store's whole-year rows are for past years.
      income: sum(incomeRows.filter((r) => r.period.startsWith(`${year}-`))),
      expenses: input.payments.length ? input.payments.reduce((s, p) => s + (p.eur ?? 0), 0) : null,
    },
    reviews: {
      count: week.length,
      average: stars.length ? stars.reduce((a, b) => a + b, 0) / stars.length : null,
      waiting: input.reviews.filter((r) => r.waiting).length,
    },
    estimated: incomeRows.some(
      (r) => (r.period === current || r.period === previous) && r.estimated,
    ),
  };
}

const euros = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(n);

export function weeklyMessage(s: WeeklySummary, ctx: AlertContext): string {
  const stores = s.thisMonth.byStore
    .filter((x) => x.eur)
    .map((x) => `${escapeHtml(x.label)} ${euros(x.eur)}`)
    .join(", ");
  const lines = [
    "📊 <b>Weekly summary</b>",
    `${escapeHtml(s.thisMonth.label)} so far: ${b(euros(s.thisMonth.eur))}${stores ? ` (${stores})` : ""}`,
    `${escapeHtml(s.lastMonth.label)}: ${euros(s.lastMonth.eur)}`,
  ];
  if (s.year.expenses != null) {
    lines.push(
      `${escapeHtml(s.year.label)} so far: income ${euros(s.year.income)}, expenses ${euros(s.year.expenses)}, profit ${b(euros(s.year.income - s.year.expenses))}`,
    );
  } else {
    lines.push(`${escapeHtml(s.year.label)} so far: income ${euros(s.year.income)}`);
  }
  if (s.estimated)
    lines.push("<i>Google Play's current months are estimates until it closes them.</i>");
  const avg = s.reviews.average != null ? `, ${s.reviews.average.toFixed(1)}★ on average` : "";
  lines.push(
    s.reviews.count
      ? `Reviews this week: ${s.reviews.count}${avg}. Waiting for a reply: ${s.reviews.waiting}.`
      : `No new reviews this week. Waiting for a reply: ${s.reviews.waiting}.`,
  );
  lines.push(link(`${ctx.consoleUrl}/`, "Open the console"));
  return lines.join("\n");
}

/**
 * Joins messages into as few as Telegram allows, a blank line apart. One message that is
 * too long on its own is cut.
 */
export function packMessages(parts: string[], limit = TELEGRAM_LIMIT): string[] {
  const out: string[] = [];
  let current = "";
  for (const raw of parts) {
    const part = raw.length > limit ? `${raw.slice(0, limit - 1)}…` : raw;
    if (!current) current = part;
    else if (current.length + 2 + part.length <= limit) current += `\n\n${part}`;
    else {
      out.push(current);
      current = part;
    }
  }
  if (current) out.push(current);
  return out;
}
