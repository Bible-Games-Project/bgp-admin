// Weekly reels on the Videos page. Each game can have a weekly brief: on Sunday night the
// console sends the game's Videos conversation a message asking for next week's reels (one
// every other day) in the format the team set, and Claude answers with a ```reels block that
// the console keeps as the week's plan (video_reels). The team reviews it on the page.
// Recording, voice and scheduling in Metricool come next.
//
// Pure rules here; the server side is video-reels.server.ts.

/** Reels a week: one every other day, Monday, Wednesday, Friday and Sunday. */
export const REEL_WEEKDAYS = [0, 2, 4, 6] as const;
export const MAX_FORMAT_CHARS = 4000;
/** When the Cron Trigger in vite.config.ts sends the brief, as the page says it. */
export const WEEKLY_BRIEF_LABEL = "every Sunday night";
const MAX_REELS = 7;

export type PlannedReel = {
  publishOn: string;
  title: string;
  hook: string;
  script: string;
  voiceover: string;
  caption: string;
  hashtags: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ymd = (date: Date) => date.toISOString().slice(0, 10);

/** The Monday (UTC) of the week a day belongs to, as YYYY-MM-DD. */
export function mondayOf(day: string | Date) {
  const date = typeof day === "string" ? new Date(`${day}T00:00:00Z`) : day;
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const back = (new Date(midnight).getUTCDay() + 6) % 7;
  return ymd(new Date(midnight - back * DAY_MS));
}

/** The week a brief sent now plans: the one starting next Monday. */
export function nextWeekOf(now: Date) {
  return ymd(new Date(new Date(`${mondayOf(now)}T00:00:00Z`).getTime() + 7 * DAY_MS));
}

/** The days a week's reels come out. */
export function reelDays(weekOf: string) {
  const monday = new Date(`${weekOf}T00:00:00Z`).getTime();
  return REEL_WEEKDAYS.map((offset) => ymd(new Date(monday + offset * DAY_MS)));
}

const WEEKDAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
export const dayLabel = (day: string) => WEEKDAY.format(new Date(`${day}T00:00:00Z`));

/** The message the weekly brief sends to a game's Videos conversation. */
export function weeklyBriefPrompt(weekOf: string, format: string) {
  const days = reelDays(weekOf);
  return [
    `Weekly brief: plan this game's reels for the week of ${dayLabel(weekOf)}, one for each of these days: ${days.map(dayLabel).join(", ")}.`,
    "",
    format.trim()
      ? `Our reel format:\n${format.trim()}`
      : "We haven't set a reel format here yet: use the one we agreed in this conversation, or a short one of your own (20–30 seconds, a hook in the first two seconds, gameplay, a call to download).",
    "",
    "Make them different from the reels you planned in earlier weeks. Answer with a short line for us and then the plan as a reels block.",
  ].join("\n");
}

/** How Claude hands over a plan, for the Videos system prompt. */
export const REELS_BLOCK_DOCS = [
  "When you plan reels for given days (the weekly brief, or when asked to plan a week), put the plan in one fenced block with the language `reels`: a JSON array with one object per reel, with these fields, all strings except hashtags:",
  '- "day": the day it comes out, YYYY-MM-DD',
  '- "title": a short name for it',
  '- "hook": the first two seconds (what is on screen and said)',
  '- "script": what is on screen, shot by shot, with the text on screen and the length of each shot',
  '- "voiceover": the words of the voice-over, exactly as they will be read, in the language of the reel',
  '- "caption": the post text',
  '- "hashtags": an array of hashtags, each starting with #',
  "The console keeps that block as the week's plan and shows it on the Videos page, so keep it valid JSON. Outside it, write only a short line for the person.",
].join("\n");

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/**
 * The reels in a reply's ```reels block, or null if it has none (or it isn't valid).
 * A reel without a valid day (YYYY-MM-DD) or a title is dropped; at most a week of them.
 */
export function parseReelPlan(reply: string | null | undefined): PlannedReel[] | null {
  if (!reply) return null;
  const match = /```reels[^\n]*\n([\s\S]*?)```/.exec(reply);
  if (!match) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(match[1]);
  } catch {
    return null;
  }
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { reels?: unknown }).reels)
      ? (raw as { reels: unknown[] }).reels
      : null;
  if (!list) return null;
  const reels: PlannedReel[] = [];
  for (const item of list.slice(0, MAX_REELS * 2)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const day = text(r.day ?? r.date, 10);
    const title = text(r.title, 200);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) continue;
    if (!title) continue;
    const hashtags = (
      Array.isArray(r.hashtags) ? r.hashtags : String(r.hashtags ?? "").split(/\s+/)
    )
      .map((h) => text(h, 60).replace(/^#?/, "#"))
      .filter((h) => h.length > 1)
      .slice(0, 30);
    reels.push({
      publishOn: day,
      title,
      hook: text(r.hook, 1000),
      script: text(r.script, 6000),
      voiceover: text(r.voiceover, 3000),
      caption: text(r.caption, 2200),
      hashtags,
    });
    if (reels.length >= MAX_REELS) break;
  }
  return reels.length ? reels : null;
}

/** Whether a weekly brief is due for a game: on, and no plan for that week yet. */
export function briefIsDue(settings: { weekly_reels: boolean } | null, plannedThatWeek: number) {
  return Boolean(settings?.weekly_reels) && plannedThatWeek === 0;
}
