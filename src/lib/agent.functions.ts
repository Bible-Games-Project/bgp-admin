// The Build chat (/apps/<id>/build) and Settings → Claude. Reads go through the signed-in
// user's client (RLS: admins only); writes use the service role after checking the user is
// an admin, like app_settings. The build server's side is agent.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  commitPreviewWorkflow,
  githubHeaders,
  PREVIEW_WORKFLOW_PATH,
} from "@/lib/github.functions";
import { PREVIEW_DISABLED_STEP } from "@/lib/capacitor.functions";
import { failureExcerpt } from "@/lib/deploy-failure";
import { isWebGame, NOT_A_WEB_GAME_MESSAGE } from "@/lib/app-kind";
import { isSelfRepo } from "@/lib/self-repo";
import { keepRunnerWatching, weeklyBudgetNow } from "@/lib/agent.server";
import { ASSISTANT_NAME } from "@/lib/assistant";
import {
  AGENT_EFFORTS,
  AGENT_EFFORT_SETTING,
  AGENT_MODELS,
  AGENT_MODEL_SETTING,
  AGENT_SERVICES,
  ACTIVE_TURN_STATUSES,
  AGENT_SETTING_KEYS,
  AGENT_WEEKLY_BUDGET_SETTING,
  ATTACHMENTS_BUCKET,
  ATTACHMENTS_PER_MESSAGE,
  ENVIRONMENT_RUNNER_VERSION,
  MAX_PROMPT_CHARS,
  accountFrom,
  agentSettingsFrom,
  attachmentProblem,
  attachmentType,
  budgetExhaustedMessage,
  bringBranchResult,
  environmentFrom,
  isActiveTurn,
  isClaudeToken,
  isStrayBranchName,
  parseDomains,
  parseVariables,
  previewDeployState,
  runnerView,
  safeFileName,
  serviceKeyFrom,
  serviceKeyVerdict,
  sortStrayBranches,
  STRAY_BRANCHES_CHECKED,
  strayBranchFrom,
  type AgentEvent,
  type AgentUsage,
  type BringBranchResult,
  type BuildAttachment,
  type EnvironmentChangeView,
  type PreviewDeployState,
  type StrayBranch,
  type TurnStatus,
  usageIsStale,
} from "@/lib/agent";

export async function assertAdmin(supabase: any, userId: string) {
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

export async function readRunner(supabase: any) {
  const { data, error } = await supabase
    .from("agent_runner")
    .select(
      "last_seen_at, host, version, busy, account, usage, unlink_requested_at, usage_requested_at, environment",
    )
    .eq("id", "main")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    runner: runnerView(data),
    account: accountFrom(data?.account),
    /** Internet and keys as the build server holds them (names and last four only). */
    environment: environmentFrom(data?.environment),
    usage: (data?.usage ?? null) as AgentUsage | null,
    unlinkPending: Boolean(data?.unlink_requested_at),
    /** The build server has been asked for a fresh reading of the usage. */
    usageRefreshPending: Boolean(data?.usage_requested_at),
  };
}

/**
 * Asks the build server for a fresh reading of the account's usage: with a page open,
 * whenever the one it has is older than USAGE_STALE_MINUTES; from the Refresh button, now.
 * The server answers with a tiny Claude call (agent-runner/, doUsageRefresh).
 */
export async function requestUsageRefresh(
  state: Awaited<ReturnType<typeof readRunner>>,
  { force = false } = {},
) {
  if (!state.account || state.account.rejectedAt || state.usageRefreshPending) return false;
  if (!force && !usageIsStale(state.usage)) return false;
  await admin()
    .from("agent_runner")
    .update({ usage_requested_at: nowIso() })
    .eq("id", "main")
    .is("usage_requested_at", null);
  return true;
}

export async function readSettings(supabase: any) {
  const { data } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", AGENT_SETTING_KEYS);
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
    const [budget, refreshing, environmentChange] = await Promise.all([
      weeklyBudgetNow(settings.weeklyBudgetPercent, runner.usage),
      requestUsageRefresh(runner),
      latestEnvironmentChange(since),
    ]);
    return {
      ...runner,
      usageRefreshPending: runner.usageRefreshPending || refreshing,
      settings,
      budget,
      environmentChange,
      /** Older build servers don't take internet and keys: they wait for its update. */
      runnerTakesEnvironment: Number(runner.runner.version) >= ENVIRONMENT_RUNNER_VERSION,
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

/**
 * The change of internet and keys the page shows the fate of: one still on its way, or the
 * last one from the past few minutes. Read with the service role (the table holds values
 * until the server takes them), and never a value.
 */
async function latestEnvironmentChange(since: string): Promise<EnvironmentChangeView | null> {
  const { data } = await admin()
    .from("agent_environment_changes")
    .select("id, status, error, skipped, created_at, updated_at")
    .or(`status.in.(pending,sending),updated_at.gte."${since}"`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    status: data.status,
    error: data.error,
    skipped: data.skipped ?? [],
    createdAt: data.created_at,
  };
}

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

/** The Refresh button: a fresh reading of the account's usage, whatever its age. */
export const refreshClaudeUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const state = await readRunner(context.supabase);
    if (!state.account) throw new Error("No Claude account is linked, so there's nothing to read.");
    if (state.account.rejectedAt)
      throw new Error("Claude no longer accepts the linked account. Link it again first.");
    if (!state.runner.online)
      throw new Error("The build server is offline; it reads the usage when it's back.");
    await requestUsageRefresh(state, { force: true });
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
        weeklyBudgetPercent: z
          .number({ invalid_type_error: "Write a number from 0 to 100." })
          .min(0, "The share can't be negative.")
          .max(100, "The share can't be over 100%."),
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
        {
          key: AGENT_WEEKLY_BUDGET_SETTING,
          value: Math.round(data.weeklyBudgetPercent * 10) / 10,
          updated_at: nowIso(),
        },
      ]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// --- Internet and keys ---------------------------------------------------------------------------

/**
 * Settings → Claude → Internet and keys: the websites (the whole list, replacing the one the
 * build server has) and keys to add or replace, pasted as in Claude Code's environment, or
 * keys to remove. It goes to the build server on its next poll; the values only stay here
 * until then.
 */
export const saveAgentEnvironment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        domains: z.string().max(20_000).nullable(),
        variables: z.string().max(200_000).default(""),
        remove: z.array(z.string().max(100)).max(100).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sites = data.domains === null ? null : parseDomains(data.domains);
    const keys = parseVariables(data.variables);
    const problems = [...(sites?.problems ?? []), ...keys.problems];
    if (problems.length) throw new Error(problems.join(" "));
    // The box only lists the other sites: a connected service keeps its own, and a service's
    // key pasted here (all of Claude Code's variables at once) brings its site along.
    const { environment } = await readRunner(admin());
    const services = AGENT_SERVICES.filter(
      (service) =>
        service.variable in keys.variables ||
        (environment.variables.some((v) => v.name === service.variable) &&
          !data.remove.includes(service.variable)),
    );
    await queueEnvironmentChange(context, {
      domains: sites?.domains ?? null,
      add_domains: services.flatMap((service) => [...service.domains]),
      set_variables: keys.variables,
      remove_variables: data.remove,
    });
    return { ok: true, keys: Object.keys(keys.variables).length };
  });

async function queueEnvironmentChange(
  context: { userId: string; claims: Record<string, unknown> },
  change: {
    domains?: string[] | null;
    add_domains?: string[];
    remove_domains?: string[];
    set_variables?: Record<string, string>;
    remove_variables?: string[];
  },
) {
  const { error } = await admin()
    .from("agent_environment_changes")
    .insert({
      ...change,
      created_by: context.userId,
      created_by_email: (context.claims.email as string | undefined) ?? null,
    });
  if (error) throw new Error(error.message);
  await keepRunnerWatching();
}

/**
 * Whether the service takes the key, asked with a call that only reads (the models list).
 * Only a plain "invalid key" stops it: anything else (no answer, a key limited to some
 * things) lets it through.
 */
async function checkServiceKey(service: (typeof AGENT_SERVICES)[number], key: string) {
  try {
    const response = await fetch(service.check.url, {
      headers: { [service.check.header]: service.check.bearer ? `Bearer ${key}` : key },
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json().catch(() => null);
    return serviceKeyVerdict(service.id, response.status, body);
  } catch {
    return "unknown" as const;
  }
}

/**
 * Settings → Claude: one service (OpenAI, ElevenLabs), connected with just its key. The key
 * is checked with the service first, so a key copied wrong is said here, not in the chat.
 */
export const connectAgentService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        service: z.enum(AGENT_SERVICES.map((s) => s.id) as [string, ...string[]]),
        key: z.string().max(20_000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const service = AGENT_SERVICES.find((s) => s.id === data.service)!;
    const parsed = serviceKeyFrom(data.key, service);
    if (!("key" in parsed) || !parsed.key) throw new Error(parsed.problem);
    const verdict = await checkServiceKey(service, parsed.key);
    if (verdict === "invalid")
      throw new Error(
        `${service.label} says this key isn't valid. Copy it again, whole, and paste it here.`,
      );
    await queueEnvironmentChange(context, {
      add_domains: [...service.domains],
      set_variables: { [service.variable]: parsed.key },
    });
    return { ok: true, checked: verdict === "ok", last4: parsed.key.slice(-4) };
  });

/** Takes a service's key and site away from the Build chat. */
export const disconnectAgentService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ service: z.enum(AGENT_SERVICES.map((s) => s.id) as [string, ...string[]]) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const service = AGENT_SERVICES.find((s) => s.id === data.service)!;
    await queueEnvironmentChange(context, {
      remove_domains: [...service.domains],
      remove_variables: [service.variable],
    });
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
  attachments: BuildAttachment[];
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

/** The columns a chat page reads for each turn, with its events and files. */
export const TURN_COLUMNS =
  "id, prompt, status, created_at, started_at, finished_at, created_by_email, cancel_requested_at, reply, error, commits, pushed_sha, agent_events(id, kind, body, created_at), agent_attachments(id, name, content_type, size, thumbnail, created_at)";

export function turnView(t: any): BuildTurn {
  return {
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
    attachments: (t.agent_attachments ?? []).map(attachmentView),
  };
}

/**
 * What the build server is on, or will do first, ahead of this chat's queued message:
 * another game's name, or the assistant. `pending` is every queued or running turn.
 */
export function aheadOf(
  active: { id: string; createdAt: string },
  pending: {
    id: string;
    app_id: string | null;
    created_at: string;
    apps?: { name: string } | null;
  }[],
  ownAppId: string | null,
): string | null {
  const ahead = pending.find(
    (t) => t.id !== active.id && (ownAppId === null || t.app_id !== ownAppId),
  );
  if (!ahead || Date.parse(ahead.created_at) > Date.parse(active.createdAt)) return null;
  return ahead.apps?.name ?? (ahead.app_id ? "another game" : ASSISTANT_NAME);
}

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
        .eq("kind", "build")
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
        .select(TURN_COLUMNS)
        .eq("chat_id", chat.id)
        .order("created_at", { ascending: false })
        .order("id", { referencedTable: "agent_events", ascending: true })
        .order("created_at", { referencedTable: "agent_attachments", ascending: true })
        .limit(TURNS_SHOWN);
      if (error) throw new Error(error.message);
      turns = (rows ?? []).reverse().map(turnView);
    }

    const active = turns.find((t) => isActiveTurn(t.status));
    const waitingFor = active?.status === "queued" ? aheadOf(active, pending ?? [], app.id) : null;

    const budget = await weeklyBudgetNow(settings.weeklyBudgetPercent, runner.usage);
    if (!blocked) await requestUsageRefresh(runner);
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
      budget,
      ...runner,
    };
  });

// --- Attachments ---------------------------------------------------------------------------

type AttachmentRow = {
  id: string;
  name: string;
  content_type: string;
  size: number;
  thumbnail?: string | null;
};

const attachmentView = (row: AttachmentRow): BuildAttachment => ({
  id: row.id,
  name: row.name,
  contentType: row.content_type,
  size: row.size,
  thumbnail: row.thumbnail ?? null,
});

/**
 * A file to send with the next message: kept in Storage from now, tied to the message when
 * it's sent (sendBuildMessage). The form carries appId, file and, for an image, a small
 * thumbnail made in the browser for the chat to show.
 */
export const uploadBuildAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    if (!(input instanceof FormData)) throw new Error("Expected a form with the file.");
    const appId = z.string().uuid().parse(input.get("appId"));
    const file = input.get("file");
    if (!(file instanceof File)) throw new Error("No file was sent.");
    const thumbnail = input.get("thumbnail");
    return {
      appId,
      file,
      thumbnail:
        typeof thumbnail === "string" &&
        thumbnail.length <= 60_000 &&
        /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(thumbnail)
          ? thumbnail
          : null,
    };
  })
  .handler(async ({ data, context }): Promise<BuildAttachment> => {
    const { supabase } = context;
    await assertAdmin(supabase, context.userId);
    const { app, blocked } = await loadBuildApp(supabase, data.appId);
    if (blocked) throw new Error(blocked);
    const problem = attachmentProblem(data.file);
    if (problem) throw new Error(problem);
    const contentType = attachmentType(data.file.name)!;
    const name = safeFileName(data.file.name);
    const id = crypto.randomUUID();
    const storagePath = `${app.id}/${id}/${name}`;
    const { error: uploadError } = await admin()
      .storage.from(ATTACHMENTS_BUCKET)
      .upload(storagePath, await data.file.arrayBuffer(), { contentType, upsert: false });
    if (uploadError) throw new Error(`The file couldn't be kept: ${uploadError.message}`);
    const row = {
      id,
      app_id: app.id,
      name,
      content_type: contentType,
      size: data.file.size,
      storage_path: storagePath,
      thumbnail: data.thumbnail,
      created_by: context.userId,
    };
    const { error } = await admin().from("agent_attachments").insert(row);
    if (error) {
      await admin().storage.from(ATTACHMENTS_BUCKET).remove([storagePath]);
      throw new Error(error.message);
    }
    return attachmentView(row);
  });

/** A link to open an attached file, good for ten minutes. */
export const getBuildAttachmentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("agent_attachments")
      .select("storage_path")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("That file is gone.");
    const { data: signed, error: signError } = await admin()
      .storage.from(ATTACHMENTS_BUCKET)
      .createSignedUrl(row.storage_path, 600);
    if (signError) throw new Error(signError.message);
    return { url: signed.signedUrl as string };
  });

/** Files uploaded for a message that was never sent are dropped after a day. */
async function dropStaleAttachments(appId: string) {
  const { data } = await admin()
    .from("agent_attachments")
    .select("id, storage_path")
    .eq("app_id", appId)
    .is("turn_id", null)
    .lt("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
    .limit(50);
  const stale = (data ?? []) as { id: string; storage_path: string }[];
  if (!stale.length) return;
  await admin()
    .storage.from(ATTACHMENTS_BUCKET)
    .remove(stale.map((a) => a.storage_path));
  await admin()
    .from("agent_attachments")
    .delete()
    .in(
      "id",
      stale.map((a) => a.id),
    );
}

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
        attachmentIds: z
          .array(z.string().uuid())
          .max(ATTACHMENTS_PER_MESSAGE, `At most ${ATTACHMENTS_PER_MESSAGE} files per message.`)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await assertAdmin(supabase, context.userId);
    const { app, blocked } = await loadBuildApp(supabase, data.appId);
    if (blocked) throw new Error(blocked);
    const [{ account, usage }, settings] = await Promise.all([
      readRunner(supabase),
      readSettings(supabase),
    ]);
    if (!account)
      throw new Error("No Claude account is linked yet. Link one in Settings → Claude.");
    if (account.rejectedAt)
      throw new Error(
        "Claude no longer accepts the linked account. Link it again in Settings → Claude.",
      );
    const budget = await weeklyBudgetNow(settings.weeklyBudgetPercent, usage);
    if (budget.exhausted) throw new Error(budgetExhaustedMessage(budget));

    const attachmentIds = [...new Set(data.attachmentIds ?? [])];
    if (attachmentIds.length) {
      const { data: found } = await admin()
        .from("agent_attachments")
        .select("id")
        .in("id", attachmentIds)
        .eq("app_id", app.id)
        .is("turn_id", null);
      if ((found ?? []).length !== attachmentIds.length)
        throw new Error("One of the attached files is gone. Remove it and attach it again.");
    }

    let { data: chat } = await admin()
      .from("agent_chats")
      .select("id")
      .eq("app_id", app.id)
      .is("archived_at", null)
      .maybeSingle();
    if (!chat) {
      const created = await admin()
        .from("agent_chats")
        .insert({ app_id: app.id, kind: "build", created_by: context.userId })
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
    if (attachmentIds.length) {
      const { error: linkError } = await admin()
        .from("agent_attachments")
        .update({ turn_id: turn.id })
        .in("id", attachmentIds)
        .is("turn_id", null);
      if (linkError) throw new Error(linkError.message);
    }
    await Promise.all([keepRunnerWatching(), dropStaleAttachments(app.id).catch(() => {})]);
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

// --- Turning the preview on, and work left on other branches -----------------------------

/**
 * "Turn on the preview" in the Build chat: the same as Setup → Preview Deploy (untick
 * "previews somewhere else", then create the workflow), from where the preview is missing.
 * Returns the commit that adds the workflow, so the page can follow its first build.
 */
export const turnOnBuildPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ appId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ sha: string | null }> => {
    await assertAdmin(context.supabase, context.userId);
    const { app, blocked } = await loadBuildApp(context.supabase, data.appId);
    if (blocked) throw new Error(blocked);
    const { error } = await admin()
      .from("app_setup_steps")
      .delete()
      .eq("app_id", app.id)
      .eq("step_key", PREVIEW_DISABLED_STEP);
    if (error) throw new Error(error.message);
    const branch = app.default_ref || "main";
    const existing = await fetch(
      `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/contents/${PREVIEW_WORKFLOW_PATH}?ref=${encodeURIComponent(branch)}`,
      { headers: githubHeaders() },
    );
    if (existing.ok) return { sha: null };
    const { sha } = await commitPreviewWorkflow({
      owner: app.github_owner,
      repo: app.github_repo,
      branch,
    });
    return { sha: sha ?? null };
  });

/**
 * The game's claude/ branches with work its main branch doesn't have (left there by
 * Claude Code on the web), newest first. Empty when GitHub doesn't answer: it's a notice,
 * and the page works without it.
 */
export const getStrayBranches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ appId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<StrayBranch[]> => {
    await assertAdmin(context.supabase, context.userId);
    const { app, blocked } = await loadBuildApp(context.supabase, data.appId);
    if (blocked) return [];
    const base = app.default_ref || "main";
    const repoApi = `https://api.github.com/repos/${app.github_owner}/${app.github_repo}`;
    const headers = githubHeaders();
    const res = await fetch(`${repoApi}/branches?per_page=100`, { headers });
    if (!res.ok) return [];
    const names = ((await res.json()) as { name: string }[])
      .map((b) => b.name)
      .filter((name) => isStrayBranchName(name, base))
      .slice(0, STRAY_BRANCHES_CHECKED);
    const branches = await Promise.all(
      names.map(async (name) => {
        const compare = await fetch(`${repoApi}/compare/${base}...${name}`, { headers });
        return compare.ok ? strayBranchFrom(name, await compare.json()) : null;
      }),
    );
    return sortStrayBranches(branches.filter((b): b is StrayBranch => b !== null));
  });

/**
 * Merges a claude/ branch into the game's main branch on GitHub, which starts the preview
 * build like any push. Not while Claude is working here: its push would then be refused.
 */
export const bringBranchToMain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ appId: z.string().uuid(), branch: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<BringBranchResult> => {
    await assertAdmin(context.supabase, context.userId);
    const { app, blocked } = await loadBuildApp(context.supabase, data.appId);
    if (blocked) throw new Error(blocked);
    const base = app.default_ref || "main";
    if (!isStrayBranchName(data.branch, base))
      throw new Error("Only a claude/ branch can be brought over from here.");
    const { data: active, error } = await admin()
      .from("agent_turns")
      .select("id")
      .eq("app_id", app.id)
      .in("status", ACTIVE_TURN_STATUSES)
      .limit(1);
    if (error) throw new Error(error.message);
    if (active?.length)
      throw new Error("Claude is working on this game. Bring the branch over once it finishes.");

    const res = await fetch(
      `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/merges`,
      {
        method: "POST",
        headers: { ...githubHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          base,
          head: data.branch,
          commit_message: `Merge ${data.branch} into ${base} from the Build chat`,
        }),
      },
    );
    const text = await res.text();
    const body = res.status === 201 && text ? (JSON.parse(text) as { sha?: string }) : null;
    const result = bringBranchResult(res.status, body);
    if (result) return result;
    throw new Error(`GitHub didn't merge ${data.branch} (${res.status}): ${text.slice(0, 200)}`);
  });
