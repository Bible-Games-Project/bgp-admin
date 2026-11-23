// The reels a game has scheduled at Upload-Post, for the Videos page. A web game's Build chat
// makes its shorts with the game's own tools (tools/shorts/ in its repo, as Eden to Heaven's
// does) and schedules them with `publish.mjs schedule`, which keeps a log of every post in
// tools/shorts/published.json; tools/shorts/channel.json says which Upload-Post account and
// profile the game uses. The console reads both from GitHub, so it needs no Upload-Post key:
// it shows what the Build chat scheduled. A post changed by hand on Upload-Post's website
// doesn't show here. Games that schedule with their own script and keep another log (Exodus's
// scripts/reels/schedule.json, REELS_SCHEDULE_PATH below) show from that log too.
//
// The page shows them in a side bar, all of them: the shorts the game has made
// (tools/shorts/shorts.json) that aren't scheduled yet ("Testing", for the team to pick), the
// ones still to come out, and the ones whose time has passed (published). Each short has a
// number, its place in shorts.json, so the team can say "I like 3 and 4" and it keeps that
// number once it's scheduled and published.
//
// Pure rules here; the server side is getScheduledReels in videos.functions.ts.

import { cleanJob } from "@/lib/reel-metrics";

export const PUBLISHED_PATH = "tools/shorts/published.json";
export const CHANNEL_PATH = "tools/shorts/channel.json";
export const SHORTS_PATH = "tools/shorts/shorts.json";
const MAX_PAST = 200;
const MAX_UPCOMING = 200;
const MAX_UNSCHEDULED = 200;
const DEFAULT_TIME_ZONE = "Europe/Madrid";

export type ScheduledPost = {
  /** The short's id in the repo (its video is public/shorts/<id>.mp4). */
  id: string;
  /** Its number: its place in shorts.json, from 1. Null if shorts.json doesn't list it. */
  number: number | null;
  title: string;
  /** When it comes out, ISO. */
  at: string;
  /** The networks, in the order they were scheduled. */
  platforms: string[];
  /** The Upload-Post profile it goes out from, when the log or the channel says. */
  profile: string | null;
  /** Its video and first frame on the game's preview, when it has one. */
  videoUrl: string | null;
  thumbnailUrl: string | null;
  /** Its Upload-Post jobs (one per scheduling), for its metrics (reel-metrics.ts). */
  jobs: string[];
};

/** A short the game has made (shorts.json) that no post schedules. */
export type UnscheduledShort = {
  id: string;
  number: number;
  title: string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
};

export type ScheduledReels = {
  /** Posts still to come out, soonest first. */
  upcoming: ScheduledPost[];
  /** Posts whose time has passed (published), newest first. */
  past: ScheduledPost[];
  /** Shorts made but not scheduled, the newest (last in shorts.json) first. */
  unscheduled: UnscheduledShort[];
  /** The channel's time zone, to show the times as the team set them. */
  timeZone: string;
  /** The Upload-Post profile the game uses (channel.json), if it says. */
  profile: string | null;
};

type Channel = { account: string | null; profile: string | null; timeZone: string };

const str = (value: unknown, max = 300) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** The parts of channel.json the page needs. Anything unreadable counts as no channel. */
export function readChannel(raw: unknown): Channel {
  const c = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const timeZone = str(c.timezone, 60);
  let validZone = DEFAULT_TIME_ZONE;
  if (timeZone) {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone });
      validZone = timeZone;
    } catch {
      // keep Madrid
    }
  }
  return {
    account: str(c.account) || null,
    profile: str(c.profile, 100) || null,
    timeZone: validZone,
  };
}

/** A YouTube title as a plain name: without "#Shorts" and a "| Bible Story" kind of tail. */
const postTitle = (title: string) =>
  title
    .replace(/\s*#Shorts\s*$/i, "")
    .replace(/\s+\|\s+[^|]*$/, "")
    .trim();

/** A short's id as a safe file name, or "" (it becomes part of a web address). */
const shortId = (value: unknown) => {
  const id = str(value, 120);
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && !id.includes("..") ? id : "";
};

/**
 * The game's scheduled posts from its published.json log. Cancelled posts and those of
 * another Upload-Post account than the channel's (an old one) are left out; the networks of
 * one short at one time are shown as one post. The shorts in shorts.json that no post left
 * schedules are listed apart.
 */
export function scheduledReels(
  published: unknown,
  channelRaw: unknown,
  previewUrl: string | null,
  now: Date,
  shortsRaw?: unknown,
  reelsSchedule?: unknown,
): ScheduledReels {
  const channel = readChannel(channelRaw);
  const other = otherLog(reelsSchedule);
  const preview = previewUrl ? previewUrl.replace(/\/+$/, "") : null;
  // Each short's number, its place in shorts.json (counting each id once), and its title.
  const made = new Map<string, { number: number; title: string }>();
  let place = 0;
  for (const item of Array.isArray(shortsRaw) ? shortsRaw : []) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const id = shortId(e.id);
    if (!id || made.has(id)) continue;
    place += 1;
    made.set(id, { number: place, title: postTitle(str(e.title, 300)) });
  }
  const byKey = new Map<string, ScheduledPost>();
  for (const item of Array.isArray(published) ? published : []) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (e.cancelled) continue;
    const account = str(e.account);
    if (channel.account && account && account !== channel.account) continue;
    const id = shortId(e.id);
    const at = Date.parse(str(e.at, 40));
    if (!id || Number.isNaN(at)) continue;
    const platforms = (Array.isArray(e.platforms) ? e.platforms : [e.platforms])
      .map((p) => str(p, 30).toLowerCase())
      .filter(Boolean);
    const profile = str(e.profile, 100) || channel.profile;
    const job = cleanJob(e.job);
    const key = `${id}|${at}|${profile ?? ""}`;
    const post = byKey.get(key);
    if (post) {
      for (const p of platforms) if (!post.platforms.includes(p)) post.platforms.push(p);
      if (job && !post.jobs.includes(job)) post.jobs.push(job);
      continue;
    }
    byKey.set(key, {
      id,
      number: made.get(id)?.number ?? null,
      title: postTitle(str(e.title, 300)) || id,
      at: new Date(at).toISOString(),
      platforms,
      profile,
      videoUrl: preview ? `${preview}/shorts/${encodeURIComponent(id)}.mp4` : null,
      thumbnailUrl: preview ? `${preview}/shorts/${encodeURIComponent(id)}.jpg` : null,
      jobs: job ? [job] : [],
    });
  }
  // The other log (Exodus's): one entry per short and time, for the networks of its target.
  for (const item of other.posts) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (e.cancelled) continue;
    const id = shortId(e.id);
    const at = Date.parse(str(e.date ?? e.at, 40));
    if (!id || Number.isNaN(at)) continue;
    const profile = other.profile || channel.profile;
    const key = `${id}|${at}|${profile ?? ""}`;
    const job = cleanJob(e.job);
    const post = byKey.get(key);
    if (post) {
      if (job && !post.jobs.includes(job)) post.jobs.push(job);
      continue;
    }
    byKey.set(key, {
      id,
      number: made.get(id)?.number ?? episodeNumber(id),
      title: made.get(id)?.title || episodeTitle(id),
      at: new Date(at).toISOString(),
      platforms: [...other.platforms],
      profile,
      videoUrl: preview ? `${preview}/reels/${encodeURIComponent(id)}.mp4` : null,
      thumbnailUrl: null,
      jobs: job ? [job] : [],
    });
  }
  const posts = [...byKey.values()];
  const nowMs = now.getTime();
  const scheduledIds = new Set(posts.map((p) => p.id));
  const unscheduled: UnscheduledShort[] = [];
  for (const [id, short] of made) {
    if (scheduledIds.has(id)) continue;
    unscheduled.push({
      id,
      number: short.number,
      title: short.title || id,
      videoUrl: preview ? `${preview}/shorts/${encodeURIComponent(id)}.mp4` : null,
      thumbnailUrl: preview ? `${preview}/shorts/${encodeURIComponent(id)}.jpg` : null,
    });
  }
  unscheduled.reverse();
  return {
    upcoming: posts
      .filter((p) => Date.parse(p.at) > nowMs)
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(0, MAX_UPCOMING),
    past: posts
      .filter((p) => Date.parse(p.at) <= nowMs)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, MAX_PAST),
    unscheduled: unscheduled.slice(0, MAX_UNSCHEDULED),
    timeZone: channel.timeZone,
    profile: channel.profile ?? other.profile,
  };
}

/**
 * The other log's posts and its target (Exodus's schedule.json:
 * `{ target: { profile, platforms }, posts: [{ date, id, job }] }`). Its videos are
 * public/reels/<id>.mp4.
 */
function otherLog(raw: unknown) {
  const log = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const target =
    log.target && typeof log.target === "object" ? (log.target as Record<string, unknown>) : {};
  return {
    posts: Array.isArray(log.posts) ? (log.posts as unknown[]) : [],
    profile: str(target.profile, 100) || null,
    platforms: (Array.isArray(target.platforms) ? target.platforms : [])
      .map((p) => str(p, 30).toLowerCase())
      .filter(Boolean),
  };
}

/** An episode's number from its id ("07-bronze-serpent" is 7), or null. */
const episodeNumber = (id: string) => {
  const m = /^(\d{1,4})-/.exec(id);
  return m ? Number(m[1]) : null;
};

/** An episode's name from its id: "07-bronze-serpent" is "Bronze serpent". */
const episodeTitle = (id: string) => {
  const words = id
    .replace(/^\d+-/, "")
    .replace(/[-_.]+/g, " ")
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : id;
};

/** Numbers in words for the team: "3", "3 and 4", "3, 4 and 7". */
export function numbersLabel(numbers: number[]) {
  const n = numbers.map((x) => `${x}`);
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`;
}

/**
 * The message the Testing tab sends to the game's Build chat when the team picks reels: what
 * they wrote (or "I like these" if nothing), then each picked reel with its number, id and
 * title, so Claude knows exactly which ones, whatever the numbers mean to it.
 */
export function pickedReelsMessage(
  picked: { number: number; id: string; title: string }[],
  note: string,
) {
  const sorted = [...picked].sort((a, b) => a.number - b.number);
  const said = note.trim() || `I like ${sorted.length === 1 ? "this one" : "these"}.`;
  return [
    said,
    "",
    `Reels I picked in the Testing tab of the Videos page (${numbersLabel(sorted.map((r) => r.number))}; the number is the reel's place in tools/shorts/shorts.json):`,
    ...sorted.map((r) => `- #${r.number} ${r.id}: ${r.title}`),
  ].join("\n");
}

const NETWORK_NAMES: Record<string, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  x: "X",
  threads: "Threads",
  linkedin: "LinkedIn",
  bluesky: "Bluesky",
};
export const networkName = (platform: string) =>
  NETWORK_NAMES[platform] ?? platform.replace(/^./, (c) => c.toUpperCase());

/** When a post comes out, in the channel's time zone: "Sunday 22 November, 18:00". */
export function postTimeLabel(at: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  })
    .format(new Date(at))
    .replace(" at ", ", ");
}

// --- Days the team already has a reel on (for the weekly brief) ------------------------------

/**
 * Another log some games keep of what they scheduled at Upload-Post (Exodus's
 * scripts/reels/publish.ts): `{ posts: [{ date, id, job }] }`.
 */
export const REELS_SCHEDULE_PATH = "scripts/reels/schedule.json";

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The days (YYYY-MM-DD, UTC) that already have a reel coming out, from the game's logs:
 * published.json (cancelled posts and another account's left out, as on the page) and
 * scripts/reels/schedule.json. Sorted, each day once.
 */
export function scheduledPostDays(
  published: unknown,
  channelRaw: unknown,
  reelsSchedule: unknown,
): string[] {
  const days = new Set<string>();
  const channel = readChannel(channelRaw);
  for (const item of Array.isArray(published) ? published : []) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (e.cancelled) continue;
    const account = str(e.account);
    if (channel.account && account && account !== channel.account) continue;
    const at = Date.parse(str(e.at, 40));
    if (!Number.isNaN(at)) days.add(utcDay(at));
  }
  const posts =
    reelsSchedule && typeof reelsSchedule === "object"
      ? (reelsSchedule as { posts?: unknown }).posts
      : undefined;
  for (const item of Array.isArray(posts) ? posts : []) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (e.cancelled) continue;
    const at = Date.parse(str(e.date ?? e.at, 40));
    if (!Number.isNaN(at)) days.add(utcDay(at));
  }
  return [...days].sort();
}
