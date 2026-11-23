// Reading the published reels' metrics from Upload-Post (reel-metrics.ts) and keeping them in
// video_reel_metrics. Run every few hours by the Cron Trigger in src/tasks/reel-metrics.ts, for
// a few reels at a time, and by the Published tab's "Refresh" for one game.
//
// A Worker run has 50 requests in all on Cloudflare's free plan, so one run counts its calls
// (GitHub and Upload-Post) and stops early; the database takes up to six.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isWebGame } from "@/lib/app-kind";
import { isSelfRepo } from "@/lib/self-repo";
import { repoJson } from "@/lib/repo-json.server";
import { CHANNEL_PATH, PUBLISHED_PATH, scheduledReels } from "@/lib/scheduled-reels";
import {
  MAX_CALLS_A_RUN,
  UPLOAD_POST_API,
  reelMetrics,
  reelsToRefresh,
  requestIdOf,
  type GameReelMetrics,
  type NetworkMetrics,
  type ReelNumbers,
} from "@/lib/reel-metrics";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabaseAdmin as any;
const nowIso = () => new Date().toISOString();
/** GitHub reads a run makes at most besides the Upload-Post calls. */
const MAX_GITHUB_CALLS = 16;

export class KeyRejected extends Error {
  constructor() {
    super(
      "Upload-Post turned the key down. Copy it again from Upload-Post's website and paste it here.",
    );
  }
}

/** The team's Upload-Post key, if one was pasted. Server only: never sent to the page. */
export async function readUploadPostKey() {
  const { data, error } = await db()
    .from("upload_post_account")
    .select("api_key, last4, rejected_at")
    .eq("id", "main")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as { api_key: string; last4: string; rejected_at: string | null } | null;
}

/** A GET to Upload-Post's API. A 404 is null; a 401 means the key is no good. */
export async function uploadPost(key: string, path: string) {
  const res = await fetch(`${UPLOAD_POST_API}${path}`, {
    headers: { Authorization: `Apikey ${key}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) throw new KeyRejected();
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Upload-Post didn't answer (${res.status}). It tries again later.`);
  return (await res.json()) as unknown;
}

type MetricsRow = {
  app_id: string;
  job_id: string;
  request_id: string | null;
  error: string | null;
  fetched_at: string;
  /** Left out when the read brought no numbers, so the ones it had stay. */
  platforms?: Record<string, NetworkMetrics>;
};

/** Reads one reel's numbers, counting the calls it makes. */
async function readReel(
  key: string,
  row: MetricsRow,
  budget: { calls: number },
): Promise<MetricsRow> {
  if (!row.request_id) {
    budget.calls += 1;
    const history = await uploadPost(key, `/history?job_id=${encodeURIComponent(row.job_id)}`);
    row.request_id = requestIdOf(history, row.job_id);
    if (!row.request_id) return { ...row, error: "Upload-Post has no post for it yet." };
  }
  if (budget.calls >= MAX_CALLS_A_RUN)
    // Out of calls this run: keep the request id, and read it first next time.
    return { ...row, fetched_at: new Date(0).toISOString() };
  budget.calls += 1;
  const answer = await uploadPost(key, `/post-analytics/${encodeURIComponent(row.request_id)}`);
  if (answer === null) return { ...row, error: "Upload-Post has no metrics for it yet." };
  return { ...row, platforms: reelMetrics(answer) };
}

/**
 * Reads the metrics of the published reels that are due (reelsToRefresh), of every web game
 * or only `appIds`, and keeps them. Says how many reels it read.
 */
export async function refreshReelMetrics({
  appIds = null as string[] | null,
  now = new Date(),
} = {}) {
  const account = await readUploadPostKey();
  if (!account) return { read: 0, outcome: "no Upload-Post key" };
  let query = db()
    .from("apps")
    .select("id, name, github_owner, github_repo, default_ref")
    .eq("is_active", true);
  if (appIds) query = query.in("id", appIds);
  const { data: apps, error } = await query;
  if (error) throw new Error(error.message);
  const games = (apps ?? []).filter(
    (app: { github_owner: string; github_repo: string }) =>
      isWebGame(app) && !isSelfRepo(app.github_owner, app.github_repo),
  );
  if (!games.length) return { read: 0, outcome: "no web games" };

  const { data: knownRows, error: knownError } = await db()
    .from("video_reel_metrics")
    .select("app_id, job_id, request_id, fetched_at")
    .in(
      "app_id",
      games.map((g: { id: string }) => g.id),
    );
  if (knownError) throw new Error(knownError.message);
  const known = (knownRows ?? []) as {
    app_id: string;
    job_id: string;
    request_id: string | null;
    fetched_at: string;
  }[];

  let githubCalls = 0;
  const budget = { calls: 0 };
  const rows: MetricsRow[] = [];
  let rejected: KeyRejected | null = null;
  for (const app of games) {
    if (rejected || githubCalls + 2 > MAX_GITHUB_CALLS || budget.calls >= MAX_CALLS_A_RUN) break;
    githubCalls += 1;
    const published = await repoJson(app, PUBLISHED_PATH).catch(() => undefined);
    if (published === undefined) continue;
    githubCalls += 1;
    const channel = await repoJson(app, CHANNEL_PATH).catch(() => undefined);
    const { past } = scheduledReels(published, channel, null, now);
    const mine = known.filter((k) => k.app_id === app.id);
    const due = reelsToRefresh(
      past,
      mine.map((k) => ({ job: k.job_id, fetchedAt: k.fetched_at })),
      now,
      MAX_CALLS_A_RUN - budget.calls,
    );
    for (const job of due) {
      if (budget.calls >= MAX_CALLS_A_RUN) break;
      const row: MetricsRow = {
        app_id: app.id,
        job_id: job,
        request_id: mine.find((k) => k.job_id === job)?.request_id ?? null,
        error: null,
        fetched_at: nowIso(),
      };
      try {
        rows.push(await readReel(account.api_key, row, budget));
      } catch (e) {
        if (e instanceof KeyRejected) {
          rejected = e;
          break;
        }
        rows.push({ ...row, error: (e as Error).message.slice(0, 300) });
      }
    }
  }

  // Rows with numbers and rows without go apart: an upsert's rows all set the same columns.
  const withNumbers = rows.filter((r) => r.platforms);
  const without = rows.filter((r) => !r.platforms);
  for (const batch of [withNumbers, without]) {
    if (!batch.length) continue;
    const { error: saveError } = await db()
      .from("video_reel_metrics")
      .upsert(batch, { onConflict: "app_id,job_id" });
    if (saveError) throw new Error(saveError.message);
  }
  if (rejected) {
    await db().from("upload_post_account").update({ rejected_at: nowIso() }).eq("id", "main");
    throw rejected;
  }
  if (account.rejected_at && budget.calls > 0)
    await db().from("upload_post_account").update({ rejected_at: null }).eq("id", "main");
  return { read: rows.length, outcome: `${rows.length} reels read with ${budget.calls} calls` };
}

/** The kept metrics of a game's reels, by job, for the page. */
export async function metricsOfApp(appId: string): Promise<GameReelMetrics> {
  const [{ data, error }, account] = await Promise.all([
    db()
      .from("video_reel_metrics")
      .select("job_id, platforms, error, fetched_at")
      .eq("app_id", appId),
    readUploadPostKey(),
  ]);
  if (error) throw new Error(error.message);
  const byJob: Record<string, ReelNumbers> = {};
  for (const row of data ?? [])
    byJob[row.job_id] = {
      platforms: row.platforms ?? {},
      error: row.error,
      fetchedAt: row.fetched_at,
    };
  return {
    connected: Boolean(account),
    last4: account?.last4 ?? null,
    rejected: Boolean(account?.rejected_at),
    byJob,
  };
}
