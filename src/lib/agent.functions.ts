// The Build chat (/apps/<id>/build) and Settings → Claude. Reads go through the signed-in
// user's client (RLS: admins only); writes use the service role after checking the user is
// an admin, like app_settings. The build server's side is agent.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { githubHeaders } from "@/lib/github.functions";
import { failureExcerpt } from "@/lib/deploy-failure";
import { isWebGame, NOT_A_WEB_GAME_MESSAGE } from "@/lib/app-kind";
import { isSelfRepo } from "@/lib/self-repo";
import { keepRunnerWatching } from "@/lib/agent.server";
import {
  AGENT_EFFORTS,
  AGENT_EFFORT_SETTING,
  AGENT_MODELS,
  AGENT_MODEL_SETTING,
  MAX_PROMPT_CHARS,
  accountFrom,
  agentSettingsFrom,
  isActiveTurn,
  isClaudeToken,
  previewDeployState,
  runnerView,
  type AgentEvent,
  type AgentUsage,
  type PreviewDeployState,
  type TurnStatus,
} from "@/lib/agent";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: not an admin");
}

const admin = () => supabaseAdmin as any;
const nowIso = () => new Date().toISOString();

async function readRunner(supabase: any) {
  const { data, error } = await supabase
    .from("agent_runner")
    .select("last_seen_at, host, version, busy, account, usage, unlink_requested_at")
    .eq("id", "main")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    runner: runnerView(data),
    account: accountFrom(data?.account),
    usage: (data?.usage ?? null) as AgentUsage | null,
    unlinkPending: Boolean(data?.unlink_requested_at),
  };
}

async function readSettings(supabase: any) {
  const { data } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", [AGENT_MODEL_SETTING, AGENT_EFFORT_SETTING]);
  return agentSettingsFrom(data ?? []);
}

// --- Settings → Claude ---------------------------------------------------------------------

export type ClaudeLoginView = {
  id: string;
  mode: "link" | "token";
  status: "starting" | "waiting_code" | "checking" | "linked" | "failed" | "cancelled";
  url: string | null;
  error: string | null;
  createdAt: string;
};

/** The build server, the account it holds, the chat's model, and the sign-in under way. */
export const getClaudeSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    await keepRunnerWatching();
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const [runner, settings, { data: logins }] = await Promise.all([
      readRunner(context.supabase),
      readSettings(context.supabase),
      context.supabase
        .from("agent_logins")
        .select("id, mode, status, url, error, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    const login = logins?.[0];
    return {
      ...runner,
      settings,
      login: login
        ? ({
            id: login.id,
            mode: login.mode,
            status: login.status,
            url: login.url,
            error: login.error,
            createdAt: login.created_at,
          } as ClaudeLoginView)
        : null,
    };
  });

async function cancelOpenLogins() {
  await admin()
    .from("agent_logins")
    .update({ status: "cancelled", code: null, token: null, updated_at: nowIso() })
    .in("status", ["starting", "waiting_code", "checking"]);
}

/** Asks the build server for a claude.ai link to sign in with. */
export const startClaudeLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    await cancelOpenLogins();
    const { data, error } = await admin()
      .from("agent_logins")
      .insert({
        mode: "link",
        status: "starting",
        created_by: context.userId,
        created_by_email: (context.claims.email as string | undefined) ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await keepRunnerWatching();
    return { id: data.id as string };
  });

/** The code claude.ai showed after signing in. */
export const submitClaudeLoginCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        code: z
          .string()
          .trim()
          .min(10, "That code looks too short. Copy the whole code.")
          .max(1000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: updated, error } = await admin()
      .from("agent_logins")
      .update({ status: "checking", code: data.code.replace(/\s+/g, ""), updated_at: nowIso() })
      .eq("id", data.id)
      .eq("status", "waiting_code")
      .select("id");
    if (error) throw new Error(error.message);
    if (!updated?.length)
      throw new Error("This sign-in isn't waiting for a code any more. Start again.");
    await keepRunnerWatching();
    return { ok: true };
  });

/** A token made with `claude setup-token` in a terminal, instead of signing in here. */
export const pasteClaudeToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ token: z.string().trim().max(500) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (!isClaudeToken(data.token)) {
      throw new Error(
        "That doesn't look like a token from `claude setup-token`. They start with sk-ant-oat.",
      );
    }
    await cancelOpenLogins();
    const { data: row, error } = await admin()
      .from("agent_logins")
      .insert({
        mode: "token",
        status: "starting",
        token: data.token,
        created_by: context.userId,
        created_by_email: (context.claims.email as string | undefined) ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await keepRunnerWatching();
    return { id: row.id as string };
  });

export const cancelClaudeLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    await admin()
      .from("agent_logins")
      .update({ status: "cancelled", code: null, token: null, updated_at: nowIso() })
      .eq("id", data.id)
      .in("status", ["starting", "waiting_code", "checking"]);
    return { ok: true };
  });

/** The build server forgets the token the next time it checks in. */
export const unlinkClaudeAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await admin()
      .from("agent_runner")
      .update({ unlink_requested_at: nowIso() })
      .eq("id", "main");
    if (error) throw new Error(error.message);
    await keepRunnerWatching();
    return { ok: true };
  });

export const saveAgentSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        model: z.enum(AGENT_MODELS.map((m) => m.id) as [string, ...string[]]),
        effort: z.enum(AGENT_EFFORTS.map((e) => e.id) as [string, ...string[]]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await admin()
      .from("app_settings")
      .upsert([
        { key: AGENT_MODEL_SETTING, value: data.model, updated_at: nowIso() },
        { key: AGENT_EFFORT_SETTING, value: data.effort, updated_at: nowIso() },
      ]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// --- The Build chat ---------------------------------------------------------------------------

export type BuildTurn = {
  id: string;
  prompt: string;
  status: TurnStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdByEmail: string | null;
  cancelRequested: boolean;
  reply: string | null;
  error: string | null;
  commits: number;
  pushedSha: string | null;
  events: AgentEvent[];
};

async function loadBuildApp(supabase: any, appId: string) {
  const { data: app, error } = await supabase
    .from("apps")
    .select("id, name, icon_data_url, github_owner, github_repo, default_ref")
    .eq("id", appId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!app) throw new Error("App not found");
  const blocked = !isWebGame(app)
    ? NOT_A_WEB_GAME_MESSAGE
    : isSelfRepo(app.github_owner, app.github_repo)
      ? "This is the console itself. It's built with Claude Code, not from its own chat."
      : null;
  return { app, blocked };
}

const TURNS_SHOWN = 40;

/** Everything the chat page shows. Polled while it's open; it also keeps the server alert. */
export const getBuildChat = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ appId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await assertAdmin(supabase, context.userId);
    const { app, blocked } = await loadBuildApp(supabase, data.appId);
    if (!blocked) await keepRunnerWatching();

    const [{ data: chat }, runner, settings, { data: pending }] = await Promise.all([
      supabase
        .from("agent_chats")
        .select("id, created_at")
        .eq("app_id", app.id)
        .is("archived_at", null)
        .maybeSingle(),
      readRunner(supabase),
      readSettings(supabase),
      supabase
        .from("agent_turns")
        .select("id, app_id, status, created_at, apps(name)")
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: true })
        .limit(20),
    ]);

    let turns: BuildTurn[] = [];
    if (chat) {
      const { data: rows, error } = await supabase
        .from("agent_turns")
        .select(
          "id, prompt, status, created_at, started_at, finished_at, created_by_email, cancel_requested_at, reply, error, commits, pushed_sha, agent_events(id, kind, body, created_at)",
        )
        .eq("chat_id", chat.id)
        .order("created_at", { ascending: false })
        .order("id", { referencedTable: "agent_events", ascending: true })
        .limit(TURNS_SHOWN);
      if (error) throw new Error(error.message);
      turns = (rows ?? []).reverse().map((t: any) => ({
        id: t.id,
        prompt: t.prompt,
        status: t.status,
        createdAt: t.created_at,
        startedAt: t.started_at,
        finishedAt: t.finished_at,
        createdByEmail: t.created_by_email,
        cancelRequested: Boolean(t.cancel_requested_at),
        reply: t.reply,
        error: t.error,
        commits: t.commits,
        pushedSha: t.pushed_sha,
        events: t.agent_events ?? [],
      }));
    }

    // Another game's message ahead of this chat's in the build server's queue.
    const active = turns.find((t) => isActiveTurn(t.status));
    let waitingFor: string | null = null;
    if (active?.status === "queued") {
      const ahead = (pending ?? []).find((t: any) => t.id !== active.id && t.app_id !== app.id);
      if (ahead && Date.parse(ahead.created_at) <= Date.parse(active.createdAt))
        waitingFor = ahead.apps?.name ?? "another game";
    }

    return {
      app: {
        id: app.id as string,
        name: app.name as string,
        icon: app.icon_data_url as string | null,
        repo: app.github_repo ? `${app.github_owner}/${app.github_repo}` : null,
        branch: (app.default_ref as string) || "main",
      },
      blocked,
      chatId: (chat?.id as string | undefined) ?? null,
      turns,
      waitingFor,
      settings,
      ...runner,
    };
  });

/** Sends a message to Claude. It waits in the build server's queue until its turn. */
export const sendBuildMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
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
    const { supabase } = context;
    await assertAdmin(supabase, context.userId);
    const { app, blocked } = await loadBuildApp(supabase, data.appId);
    if (blocked) throw new Error(blocked);
    const { account } = await readRunner(supabase);
    if (!account)
      throw new Error("No Claude account is linked yet. Link one in Settings → Claude.");
    if (account.rejectedAt)
      throw new Error(
        "Claude no longer accepts the linked account. Link it again in Settings → Claude.",
      );

    let { data: chat } = await admin()
      .from("agent_chats")
      .select("id")
      .eq("app_id", app.id)
      .is("archived_at", null)
      .maybeSingle();
    if (!chat) {
      const created = await admin()
        .from("agent_chats")
        .insert({ app_id: app.id, created_by: context.userId })
        .select("id")
        .single();
      // Two tabs starting the first chat at once: the other one won.
      chat =
        created.data ??
        (
          await admin()
            .from("agent_chats")
            .select("id")
            .eq("app_id", app.id)
            .is("archived_at", null)
            .single()
        ).data;
      if (!chat) throw new Error(created.error?.message ?? "Couldn't start the chat.");
    }

    const { data: busy } = await admin()
      .from("agent_turns")
      .select("id")
      .eq("chat_id", chat.id)
      .in("status", ["queued", "running"])
      .limit(1);
    if (busy?.length)
      throw new Error("Claude is still on your last message. Wait for it, or press Stop.");

    const { data: turn, error } = await admin()
      .from("agent_turns")
      .insert({
        chat_id: chat.id,
        app_id: app.id,
        prompt: data.prompt,
        created_by: context.userId,
        created_by_email: (context.claims.email as string | undefined) ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await keepRunnerWatching();
    return { turnId: turn.id as string };
  });

/** Stop: a queued message never starts; a running one is stopped by the build server. */
export const stopBuildTurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ turnId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    await admin()
      .from("agent_turns")
      .update({ status: "cancelled", error: "Stopped.", finished_at: nowIso() })
      .eq("id", data.turnId)
      .eq("status", "queued");
    await admin()
      .from("agent_turns")
      .update({ cancel_requested_at: nowIso() })
      .eq("id", data.turnId)
      .eq("status", "running");
    return { ok: true };
  });

/** Closes this game's chat: the next message starts a new conversation with Claude. */
export const newBuildChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ appId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: busy } = await admin()
      .from("agent_turns")
      .select("id")
      .eq("app_id", data.appId)
      .in("status", ["queued", "running"])
      .limit(1);
    if (busy?.length) throw new Error("Claude is still working. Wait for it, or press Stop first.");
    await admin()
      .from("agent_chats")
      .update({ archived_at: nowIso() })
      .eq("app_id", data.appId)
      .is("archived_at", null);
    return { ok: true };
  });

/**
 * Where the preview deploy of a pushed commit stands. When it failed, also the error lines
 * from the build's log, for "Ask Claude to fix it".
 */
export const getPreviewDeploy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ appId: z.string().uuid(), sha: z.string().regex(/^[0-9a-f]{40}$/) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<PreviewDeployState & { error?: string }> => {
    await assertAdmin(context.supabase, context.userId);
    const { app, blocked } = await loadBuildApp(context.supabase, data.appId);
    if (blocked) throw new Error(blocked);
    const base = `https://api.github.com/repos/${app.github_owner}/${app.github_repo}`;
    const headers = githubHeaders();
    const runsRes = await fetch(
      `${base}/actions/workflows/preview-deploy.yml/runs?head_sha=${data.sha}&per_page=1`,
      { headers },
    );
    if (!runsRes.ok)
      throw new Error(`GitHub didn't answer about the preview deploy (${runsRes.status}).`);
    const run = ((await runsRes.json()).workflow_runs ?? [])[0] ?? null;
    if (!run || run.status !== "completed") return previewDeployState(run, []);

    const jobsRes = await fetch(`${base}/actions/runs/${run.id}/jobs?per_page=10`, { headers });
    const job = jobsRes.ok ? ((await jobsRes.json()).jobs ?? [])[0] : null;
    const state = previewDeployState(run, job?.steps ?? []);
    if (state.state !== "failed" || !job) return state;
    // The log answers with a redirect to a signed link on another host, fetched without
    // the token (as in deploy.functions.ts).
    const logRes = await fetch(`${base}/actions/jobs/${job.id}/logs`, {
      headers,
      redirect: "manual",
    });
    const location = logRes.headers.get("location");
    const log = location ? await fetch(location) : logRes;
    return { ...state, error: log.ok ? failureExcerpt(await log.text()) : "" };
  });
