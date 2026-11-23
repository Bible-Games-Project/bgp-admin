// How each published reel is doing on each network, for the Published tab of the Videos page.
// Upload-Post (which the team pays for already) gives them per post at no extra cost, with the
// team's Upload-Post API key, kept by the console's server only (upload_post_account). Every
// few hours the console reads the metrics of a few reels and keeps them (video_reel_metrics):
// each reel about once a day while it's new, once a week after a month.
//
// Upload-Post's answer (checked on 2026-11-23 with a real reel): GET
// /api/uploadposts/history?job_id=<job> gives the post's request_id, and GET
// /api/uploadposts/post-analytics/<request_id> gives `platforms.<network>.post_metrics`. Not
// every network says everything: views and likes almost all; shares TikTok and Instagram;
// new followers only TikTok; how much people watch TikTok (retention curve, average seconds),
// Instagram and Pinterest (average seconds); how many get to the end TikTok and Pinterest.
//
// Pure rules here; the server side is reel-metrics.server.ts.

export const UPLOAD_POST_API = "https://api.upload-post.com/api/uploadposts";
/** Upload-Post calls one run makes at most (the Worker has 50 requests a run in all). */
export const MAX_CALLS_A_RUN = 20;
/** A reel's metrics are read again after this long… */
const FRESH_MS = 20 * 60 * 60 * 1000;
/** …or after a week once the reel is older than a month. */
const OLD_REEL_MS = 30 * 24 * 60 * 60 * 1000;
const OLD_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
/** Upload-Post needs a while after a post goes out to have it. */
const SETTLE_MS = 60 * 60 * 1000;
/** Every this many hours the Cron Trigger reads some (vite.config.ts), as the page says it. */
export const METRICS_EVERY_HOURS = 3;

/** One network's numbers for one reel. Null: the network doesn't say. */
export type NetworkMetrics = {
  url: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  newFollowers: number | null;
  /** How long people watch, on average, in seconds. */
  avgWatchSeconds: number | null;
  /** How much of the video people watch, on average, 0–100. */
  watchedPercent: number | null;
  /** How many of those who start it get to the end, 0–100. */
  completionPercent: number | null;
  /** Why the network gave nothing, when it says. */
  error: string | null;
};

const num = (value: unknown) => {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
};
const first = (...values: unknown[]) => {
  for (const value of values) {
    const n = num(value);
    if (n !== null) return n;
  }
  return null;
};
const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number | null) => (n === null ? null : round1(Math.min(100, n)));

/**
 * The average of a TikTok retention curve ([{ second, percentage }], one point a second): how
 * much of the video is watched, 0–100. TikTok gives each point as a fraction (1 at second 0,
 * 0.52 at second 1…), so a curve that never goes above 1 is read as fractions.
 */
export function curveAverage(curve: unknown) {
  if (!Array.isArray(curve)) return null;
  const points = curve
    .map((p) => num((p as { percentage?: unknown } | null)?.percentage))
    .filter((p): p is number => p !== null);
  if (points.length < 2) return null;
  const average = points.reduce((a, b) => a + b, 0) / points.length;
  return Math.max(...points) <= 1 ? average * 100 : average;
}

/** One network's part of Upload-Post's post-analytics answer, in the page's terms. */
export function networkMetrics(entry: unknown): NetworkMetrics {
  const e = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
  const m =
    e.post_metrics && typeof e.post_metrics === "object"
      ? (e.post_metrics as Record<string, unknown>)
      : {};
  const views = first(m.views, m.video_views, m.plays);
  const fullViews = num(m.video_95_percent_views);
  const fullRate = num(m.full_video_watched_rate);
  const completion = first(
    m.completion_rate,
    fullRate === null ? null : fullRate * 100,
    fullViews !== null && views ? (fullViews / views) * 100 : null,
  );
  const error =
    typeof e.post_metrics_error === "string"
      ? e.post_metrics_error
      : e.success === false && typeof e.error_message === "string"
        ? e.error_message
        : null;
  const url = typeof e.post_url === "string" && /^https:\/\//.test(e.post_url) ? e.post_url : null;
  return {
    url,
    views,
    likes: first(m.likes, m.reactions),
    comments: num(m.comments),
    shares: num(m.shares),
    saves: first(m.saves, m.favorites),
    newFollowers: num(m.new_followers),
    avgWatchSeconds: (() => {
      const s = first(m.avg_watch_seconds, m.average_time_watched, m.video_avg_watch_time_seconds);
      return s ? round1(s) : null;
    })(),
    watchedPercent: pct(first(m.average_view_percentage, curveAverage(m.retention))),
    completionPercent: pct(completion),
    error: error ? error.slice(0, 300) : null,
  };
}

/**
 * Every network of a post-analytics answer. A network that knows how much of the video is
 * watched and for how long tells the video's length; the others that only know the seconds
 * get their percentage from it (it's the same video everywhere).
 */
export function reelMetrics(answer: unknown): Record<string, NetworkMetrics> {
  const platforms =
    answer && typeof answer === "object"
      ? (answer as { platforms?: unknown }).platforms
      : undefined;
  const out: Record<string, NetworkMetrics> = {};
  if (!platforms || typeof platforms !== "object") return out;
  for (const [platform, entry] of Object.entries(platforms as Record<string, unknown>)) {
    if (!/^[a-z0-9_]{1,30}$/.test(platform)) continue;
    out[platform] = networkMetrics(entry);
  }
  const lengths = Object.values(out)
    .filter((m) => m.avgWatchSeconds && m.watchedPercent)
    .map((m) => m.avgWatchSeconds! / (m.watchedPercent! / 100));
  const length = lengths.length ? lengths[0] : null;
  if (length && length > 1)
    for (const m of Object.values(out))
      if (m.watchedPercent === null && m.avgWatchSeconds)
        m.watchedPercent = pct((m.avgWatchSeconds / length) * 100);
  return out;
}

/** The request id of a scheduled post, from Upload-Post's history for its job. */
export function requestIdOf(history: unknown, job: string) {
  const items =
    history && typeof history === "object" ? (history as { history?: unknown }).history : null;
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    const i = item as { job_id?: unknown; request_id?: unknown } | null;
    if (i && i.job_id === job && typeof i.request_id === "string" && i.request_id)
      return i.request_id;
  }
  return null;
}

/** A job id as it can go in Upload-Post's web address, or "". */
export const cleanJob = (job: unknown) =>
  typeof job === "string" && /^[A-Za-z0-9_-]{6,80}$/.test(job) ? job : "";

export type KnownMetrics = { job: string; fetchedAt: string | null };

/**
 * Which published reels to read now, the most needed first: never read, then the longest
 * ago. A reel is read about once a day, once a week after its first month, and not in its
 * first hour. `posts` are the past posts with their jobs.
 */
export function reelsToRefresh(
  posts: { jobs: string[]; at: string }[],
  known: KnownMetrics[],
  now: Date,
  max: number,
) {
  const fetched = new Map(known.map((k) => [k.job, k.fetchedAt ? Date.parse(k.fetchedAt) : 0]));
  const nowMs = now.getTime();
  const due: { job: string; last: number }[] = [];
  for (const post of posts) {
    const at = Date.parse(post.at);
    if (Number.isNaN(at) || nowMs - at < SETTLE_MS) continue;
    const wait = nowMs - at > OLD_REEL_MS ? OLD_FRESH_MS : FRESH_MS;
    for (const job of post.jobs) {
      const last = fetched.get(job) ?? 0;
      if (nowMs - last >= wait) due.push({ job, last });
    }
  }
  return due
    .sort((a, b) => a.last - b.last)
    .slice(0, Math.max(0, max))
    .map((d) => d.job);
}

/** The pasted Upload-Post key, or why it can't be one. */
export function uploadPostKeyFrom(text: string) {
  let key = String(text ?? "").trim();
  const assignment = /^(?:export\s+)?[A-Z_][A-Z0-9_]*\s*=\s*(.*)$/.exec(key);
  if (assignment) key = assignment[1].trim();
  key = key.replace(/^(["'])(.*)\1$/, "$2").replace(/^Apikey\s+/i, "");
  if (!key) return { problem: "Paste the key first." };
  if (/\s/.test(key)) return { problem: "A key has no spaces. Copy it again, on its own." };
  if (key.length < 20) return { problem: "That's too short to be a key. Copy it again, whole." };
  if (key.length > 4000) return { problem: "That's too long to be a key." };
  return { key };
}

/** "1.2k", "12k", "1.3M": a big number, short. */
export function shortNumber(n: number) {
  if (n < 1000) return `${Math.round(n)}`;
  if (n < 10_000) return `${round1(n / 1000)}k`.replace(".0k", "k");
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${round1(n / 1_000_000)}M`.replace(".0M", "M");
}

/** One network's numbers in a short line: "1.1k views · 59 likes · 2 shares · 45% watched". */
export function metricsLine(m: NetworkMetrics) {
  const parts: string[] = [];
  const add = (n: number | null, one: string, many: string) => {
    if (n !== null) parts.push(`${shortNumber(n)} ${n === 1 ? one : many}`);
  };
  add(m.views, "view", "views");
  add(m.likes, "like", "likes");
  add(m.comments, "comment", "comments");
  add(m.shares, "share", "shares");
  if (m.watchedPercent !== null) parts.push(`${Math.round(m.watchedPercent)}% watched`);
  else if (m.avgWatchSeconds !== null) parts.push(`${m.avgWatchSeconds} s watched on average`);
  if (m.completionPercent !== null) parts.push(`${Math.round(m.completionPercent)}% to the end`);
  if (m.newFollowers !== null)
    parts.push(`${m.newFollowers === 0 ? "no" : `+${m.newFollowers}`} new followers`);
  return parts.join(" · ");
}

/** One reel's kept numbers (one Upload-Post job), as the page gets them. */
export type ReelNumbers = {
  platforms: Record<string, NetworkMetrics>;
  error: string | null;
  fetchedAt: string;
};

/** What the page knows about the metrics of a game's reels. */
export type GameReelMetrics = {
  /** Whether there's an Upload-Post key. */
  connected: boolean;
  last4: string | null;
  /** Whether Upload-Post turned the key down the last time. */
  rejected: boolean;
  byJob: Record<string, ReelNumbers>;
};

/** A reel's views on every network together. */
export const totalViews = (metrics: Record<string, NetworkMetrics>) =>
  Object.values(metrics).reduce((sum, m) => sum + (m.views ?? 0), 0);
