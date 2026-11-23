// The Videos page's conversations with Claude, one open per game (src/lib/videos.ts). Kept in
// the Build chat's tables as chats of kind 'video'; the build server runs the messages like
// Ruben's (agent.server.ts, claimTurn).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  TURN_COLUMNS,
  aheadOf,
  assertAdmin,
  readRunner,
  readSettings,
  requestUsageRefresh,
  turnView,
} from "@/lib/agent.functions";
import { keepRunnerWatching, previewUrlFor, weeklyBudgetNow } from "@/lib/agent.server";
import { repoJson } from "@/lib/repo-json.server";
import {
  CHANNEL_PATH,
  PUBLISHED_PATH,
  REELS_SCHEDULE_PATH,
  SHORTS_PATH,
  scheduledReels,
} from "@/lib/scheduled-reels";
import { MAX_PROMPT_CHARS, budgetExhaustedMessage, isActiveTurn } from "@/lib/agent";
import { cleanContext } from "@/lib/assistant";
import type { AssistantTurn } from "@/lib/assistant.functions";
import { videoContext } from "@/lib/videos";
import { MAX_FORMAT_CHARS, mondayOf, nextWeekOf } from "@/lib/video-reels";
import { sendWeeklyBrief } from "@/lib/video-brief.server";
import { lastCommentsBrief, sendCommentsBrief } from "@/lib/video-comments.server";
import {
  KeyRejected,
  metricsOfApp,
  refreshReelMetrics,
  uploadPost,
} from "@/lib/reel-metrics.server";
import { uploadPostKeyFrom } from "@/lib/reel-metrics";
import { isWebGame } from "@/lib/app-kind";
import { isSelfRepo } from "@/lib/self-repo";

const admin = () => supabaseAdmin as any;
const nowIso = () => new Date().toISOString();
const TURNS_SHOWN = 30;
const appInput = z.object({ appId: z.string().uuid() });

async function openChat(supabase: any, appId: string) {
  const { data, error } = await supabase
    .from("agent_chats")
    .select("id, created_at")
    .eq("kind", "video")
    .eq("app_id", appId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; created_at: string } | null;
}

async function busyIn(chatId: string) {
  const { data } = await admin()
    .from("agent_turns")
    .select("id")
    .eq("chat_id", chatId)
    .in("status", ["queued", "running"])
    .limit(1);
  return Boolean(data?.length);
}

/** A game's Videos conversation, polled while the page is open. */
export const getVideoChat = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => appInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    await keepRunnerWatching();
    const [chat, runner, settings, { data: pending }] = await Promise.all([
      openChat(supabase, data.appId),
      readRunner(supabase),
      readSettings(supabase),
      supabase
        .from("agent_turns")
        .select("id, app_id, status, created_at, context, apps(name)")
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: true })
        .limit(20),
    ]);
    let turns: AssistantTurn[] = [];
    if (chat) {
      const { data: rows, error } = await supabase
        .from("agent_turns")
        .select(`${TURN_COLUMNS}, context`)
        .eq("chat_id", chat.id)
        .order("created_at", { ascending: false })
        .order("id", { referencedTable: "agent_events", ascending: true })
        .limit(TURNS_SHOWN);
      if (error) throw new Error(error.message);
      turns = (rows ?? [])
        .reverse()
        .map((t: any) => ({ ...turnView(t), context: t.context ? cleanContext(t.context) : null }));
    }
    const active = turns.find((t) => isActiveTurn(t.status));
    const [budget] = await Promise.all([
      weeklyBudgetNow(settings.weeklyBudgetPercent, runner.usage),
      requestUsageRefresh(runner),
    ]);
    return {
      chatId: chat?.id ?? null,
      turns,
      waitingFor: active?.status === "queued" ? aheadOf(active, pending ?? [], null) : null,
      settings,
      budget,
      ...runner,
    };
  });

/** A message in a game's Videos conversation. It waits in the build server's queue. */
export const sendVideoMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    appInput
      .extend({
        prompt: z
          .string()
          .trim()
          .min(1, "Write something first.")
          .max(
            MAX_PROMPT_CHARS,
            `Keep it under ${MAX_PROMPT_CHARS.toLocaleString("en")} characters.`,
          ),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const [{ account, usage }, settings, { data: app }] = await Promise.all([
      readRunner(supabase),
      readSettings(supabase),
      supabase.from("apps").select("id, name").eq("id", data.appId).maybeSingle(),
    ]);
    if (!app) throw new Error("This game isn't in the console any more.");
    if (!account)
      throw new Error("No Claude account is linked yet. Link one in Settings → Claude.");
    if (account.rejectedAt)
      throw new Error(
        "Claude no longer accepts the linked account. Link it again in Settings → Claude.",
      );
    const budget = await weeklyBudgetNow(settings.weeklyBudgetPercent, usage);
    if (budget.exhausted) throw new Error(budgetExhaustedMessage(budget));

    let chat = await openChat(supabase, app.id);
    if (!chat) {
      const created = await admin()
        .from("agent_chats")
        .insert({ kind: "video", app_id: app.id, created_by: userId })
        .select("id, created_at")
        .single();
      // Two tabs starting the chat at once: the other one won.
      chat = created.data ?? (await openChat(admin(), app.id));
      if (!chat) throw new Error(created.error?.message ?? "Couldn't start the chat.");
    }
    if (await busyIn(chat.id))
      throw new Error("Claude is still on the last message. Wait for it, or press Stop.");

    const { data: turn, error } = await admin()
      .from("agent_turns")
      .insert({
        chat_id: chat.id,
        app_id: null,
        prompt: data.prompt,
        context: videoContext(app.id, app.name),
        created_by: userId,
        created_by_email: (context.claims.email as string | undefined) ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await keepRunnerWatching();
    return { turnId: turn.id as string, chatId: chat.id };
  });

/** Closes a game's Videos conversation: the next message starts a new one. */
export const newVideoChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => appInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const chat = await openChat(supabase, data.appId);
    if (!chat) return { ok: true };
    if (await busyIn(chat.id))
      throw new Error("Claude is still working. Wait for it, or press Stop first.");
    await admin().from("agent_chats").update({ archived_at: nowIso() }).eq("id", chat.id);
    return { ok: true };
  });

// --- Weekly reels (video-reels.ts) ------------------------------------------------------------

/** A game's reel settings and the reels planned from this week on. */
export const getVideoReels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => appInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const [{ data: settings, error: settingsError }, { data: reels, error }, { data: app }] =
      await Promise.all([
        admin()
          .from("video_settings")
          .select("weekly_reels, format, updated_at")
          .eq("app_id", data.appId)
          .maybeSingle(),
        admin()
          .from("video_reels")
          .select(
            "id, week_of, publish_on, title, hook, script, voiceover, caption, hashtags, video_url, status, created_at",
          )
          .eq("app_id", data.appId)
          .gte("week_of", mondayOf(new Date()))
          .order("publish_on", { ascending: true })
          .order("created_at", { ascending: true })
          .limit(40),
        admin().from("apps").select("github_owner, github_repo").eq("id", data.appId).maybeSingle(),
      ]);
    if (settingsError) throw new Error(settingsError.message);
    if (error) throw new Error(error.message);
    return {
      settings: {
        weeklyReels: Boolean(settings?.weekly_reels),
        format: (settings?.format as string | undefined) ?? "",
      },
      nextWeekOf: nextWeekOf(new Date()),
      // A web game's brief goes to its Build chat, which makes the videos (video-brief.server.ts).
      inBuildChat: Boolean(app && isWebGame(app) && !isSelfRepo(app.github_owner, app.github_repo)),
      reels: (reels ?? []) as VideoReel[],
    };
  });

export type VideoReel = {
  id: string;
  week_of: string;
  publish_on: string;
  title: string;
  hook: string;
  script: string;
  voiceover: string;
  caption: string;
  hashtags: string[];
  video_url: string | null;
  status: "planned" | "discarded";
  created_at: string;
};

/** Turns a game's weekly reels on or off, and sets the format Claude follows. */
export const saveVideoSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    appInput
      .extend({
        weeklyReels: z.boolean(),
        format: z
          .string()
          .trim()
          .max(
            MAX_FORMAT_CHARS,
            `Keep it under ${MAX_FORMAT_CHARS.toLocaleString("en")} characters.`,
          ),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await admin().from("video_settings").upsert(
      {
        app_id: data.appId,
        weekly_reels: data.weeklyReels,
        format: data.format,
        updated_by: context.userId,
        updated_at: nowIso(),
      },
      { onConflict: "app_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Discards a planned reel, or brings it back. */
export const setReelStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), status: z.enum(["planned", "discarded"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await admin()
      .from("video_reels")
      .update({ status: data.status, updated_at: nowIso() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Sends one game's weekly brief now, without waiting for Sunday. */
export const planNextWeekNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => appInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return sendWeeklyBrief(data.appId, {
      force: true,
      userId: context.userId,
      email: (context.claims.email as string | undefined) ?? null,
    });
  });

// --- Answering the reels' comments (video-comments.ts) ----------------------------------------

/** Whether a web game's Build chat answers its reels' comments every night, and the last run. */
export const getReelComments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => appInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const [{ data: app }, { data: settings, error }, last] = await Promise.all([
      admin().from("apps").select("github_owner, github_repo").eq("id", data.appId).maybeSingle(),
      admin()
        .from("video_settings")
        .select("answer_comments")
        .eq("app_id", data.appId)
        .maybeSingle(),
      lastCommentsBrief(data.appId),
    ]);
    if (error) throw new Error(error.message);
    return {
      available: Boolean(app && isWebGame(app) && !isSelfRepo(app.github_owner, app.github_repo)),
      answerComments: Boolean(settings?.answer_comments),
      last: last
        ? { status: last.status, sentAt: last.created_at, finishedAt: last.finished_at }
        : null,
    };
  });

/** Turns a game's nightly comment answering on or off. */
export const setAnswerComments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => appInput.extend({ on: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await admin().from("video_settings").upsert(
      {
        app_id: data.appId,
        answer_comments: data.on,
        updated_by: context.userId,
        updated_at: nowIso(),
      },
      { onConflict: "app_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Sends one game's comments brief now, without waiting for the night. */
export const answerCommentsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => appInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return sendCommentsBrief(data.appId, {
      force: true,
      userId: context.userId,
      email: (context.claims.email as string | undefined) ?? null,
    });
  });

// --- Scheduled at Upload-Post (scheduled-reels.ts) ---------------------------------------------

/** The reels a web game's Build chat has scheduled at Upload-Post, from its repo's log. */
export const getScheduledReels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => appInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: app, error } = await admin()
      .from("apps")
      .select("id, github_owner, github_repo, default_ref")
      .eq("id", data.appId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!app || !isWebGame(app) || isSelfRepo(app.github_owner, app.github_repo))
      return { hasRepo: false as const };
    const [published, channel, shorts, reelsSchedule, previewUrl, metrics] = await Promise.all([
      repoJson(app, PUBLISHED_PATH),
      repoJson(app, CHANNEL_PATH),
      repoJson(app, SHORTS_PATH),
      repoJson(app, REELS_SCHEDULE_PATH).catch(() => undefined),
      previewUrlFor(app).catch(() => null),
      // The reels show even when their numbers can't be read.
      metricsOfApp(app.id).catch(() => ({
        connected: false,
        last4: null,
        rejected: false,
        byJob: {},
      })),
    ]);
    return {
      hasRepo: true as const,
      hasLog: published !== undefined || reelsSchedule !== undefined,
      metrics,
      ...scheduledReels(published, channel, previewUrl, new Date(), shorts, reelsSchedule),
    };
  });

// --- The published reels' metrics (reel-metrics.ts) -------------------------------------------

/**
 * Keeps the team's Upload-Post API key for the reels' metrics, after asking Upload-Post
 * whether it takes it. Only the server ever reads it back; then reads the game's metrics.
 */
export const connectUploadPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => appInput.extend({ key: z.string().max(10_000) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const parsed = uploadPostKeyFrom(data.key);
    if (!("key" in parsed) || !parsed.key) throw new Error(parsed.problem);
    try {
      await uploadPost(parsed.key, "/history?limit=10");
    } catch (e) {
      if (e instanceof KeyRejected)
        throw new Error(
          "Upload-Post says this key isn't valid. Copy it again, whole, and paste it here.",
        );
      // Upload-Post didn't answer: keep the key, the next read tells.
    }
    const { error } = await admin()
      .from("upload_post_account")
      .upsert(
        {
          id: "main",
          api_key: parsed.key,
          last4: parsed.key.slice(-4),
          connected_by: context.userId,
          connected_at: nowIso(),
          rejected_at: null,
        },
        { onConflict: "id" },
      );
    if (error) throw new Error(error.message);
    const read = await refreshReelMetrics({ appIds: [data.appId] }).catch(() => null);
    return { ok: true, read: read?.read ?? 0 };
  });

/** Forgets the Upload-Post key: the metrics stop being read (the ones kept stay). */
export const disconnectUploadPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await admin().from("upload_post_account").delete().eq("id", "main");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Reads a game's published reels' metrics now, the ones not read today. */
export const refreshReelMetricsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => appInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return refreshReelMetrics({ appIds: [data.appId] });
  });
