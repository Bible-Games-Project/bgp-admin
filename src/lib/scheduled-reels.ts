// The reels a game has scheduled at Upload-Post, for the Videos page. A web game's Build chat
// makes its shorts with the game's own tools (tools/shorts/ in its repo, as Eden to Heaven's
// does) and schedules them with `publish.mjs schedule`, which keeps a log of every post in
// tools/shorts/published.json; tools/shorts/channel.json says which Upload-Post account and
// profile the game uses. The console reads both from GitHub, so it needs no Upload-Post key:
// it shows what the Build chat scheduled. A post changed by hand on Upload-Post's website
// doesn't show here.
//
// Pure rules here; the server side is getScheduledReels in videos.functions.ts.

export const PUBLISHED_PATH = "tools/shorts/published.json";
export const CHANNEL_PATH = "tools/shorts/channel.json";
/** How far back the page lists posts whose time has passed. */
const PAST_DAYS = 14;
const MAX_PAST = 10;
const MAX_UPCOMING = 60;
const DEFAULT_TIME_ZONE = "Europe/Madrid";

export type ScheduledPost = {
  /** The short's id in the repo (its video is public/shorts/<id>.mp4). */
  id: string;
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
};

export type ScheduledReels = {
  upcoming: ScheduledPost[];
  /** Posts whose time has passed in the last two weeks, newest first. */
  past: ScheduledPost[];
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
 * one short at one time are shown as one post.
 */
export function scheduledReels(
  published: unknown,
  channelRaw: unknown,
  previewUrl: string | null,
  now: Date,
): ScheduledReels {
  const channel = readChannel(channelRaw);
  const preview = previewUrl ? previewUrl.replace(/\/+$/, "") : null;
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
    const key = `${id}|${at}|${profile ?? ""}`;
    const post = byKey.get(key);
    if (post) {
      for (const p of platforms) if (!post.platforms.includes(p)) post.platforms.push(p);
      continue;
    }
    byKey.set(key, {
      id,
      title: postTitle(str(e.title, 300)) || id,
      at: new Date(at).toISOString(),
      platforms,
      profile,
      videoUrl: preview ? `${preview}/shorts/${encodeURIComponent(id)}.mp4` : null,
      thumbnailUrl: preview ? `${preview}/shorts/${encodeURIComponent(id)}.jpg` : null,
    });
  }
  const posts = [...byKey.values()];
  const nowMs = now.getTime();
  const since = nowMs - PAST_DAYS * 24 * 60 * 60 * 1000;
  return {
    upcoming: posts
      .filter((p) => Date.parse(p.at) > nowMs)
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(0, MAX_UPCOMING),
    past: posts
      .filter((p) => Date.parse(p.at) <= nowMs && Date.parse(p.at) >= since)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, MAX_PAST),
    timeZone: channel.timeZone,
    profile: channel.profile,
  };
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
