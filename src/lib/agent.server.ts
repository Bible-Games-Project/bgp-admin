// The console's side of the build server (agent-runner/): what /api/agent/* answers it. The
// server authenticates with AGENT_RUNNER_TOKEN, a Worker secret, and everything here runs
// with the service role. See agent.ts for the rules shared with the page.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { githubHeaders, PREVIEW_WORKFLOW_PATH } from "@/lib/github.functions";
import { PREVIEW_DISABLED_STEP } from "@/lib/capacitor.functions";
import { isSelfRepo } from "@/lib/self-repo";
import {
  ATTACHMENTS_BUCKET,
  LOGIN_EXPIRES_MINUTES,
  POLL_FAST_SECONDS,
  POLL_IDLE_SECONDS,
  WATCH_SECONDS,
  accountFrom,
  agentSettingsFrom,
  AGENT_SETTING_KEYS,
  budgetExhaustedMessage,
  cleanEvent,
  currentWeeklyWindow,
  isDeployKey,
  sameSecret,
  turnWeeklySpend,
  weeklyBudgetFrom,
  type AgentUsage,
  type WeeklyBudget,
} from "@/lib/agent";

// The tables are typed, but the nested selects below read more easily untyped.
const db = () => supabaseAdmin as any;

/** Thrown for a request the server shouldn't have made; answered with this status. */
export class AgentApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function checkRunnerToken(request: Request) {
  const expected = process.env.AGENT_RUNNER_TOKEN ?? "";
  if (!expected) throw new AgentApiError("AGENT_RUNNER_TOKEN isn't set on the console", 503);
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!sameSecret(given, expected)) throw new AgentApiError("Unauthorized", 401);
}

const iso = (date: Date) => date.toISOString();
const str = (value: unknown, max = 500) => (typeof value === "string" ? value.slice(0, max) : null);

/**
 * What the Build chat has used of the account's weekly limit in the current window, against
 * the share Settings → Claude allows it. `usage` is the account's usage as the build server
 * last reported it (agent_runner.usage): it says which window we are in.
 */
export async function weeklyBudgetNow(
  percent: number,
  usage: AgentUsage | null,
  now = new Date(),
): Promise<WeeklyBudget> {
  const resetsAt = currentWeeklyWindow(usage, now);
  let spends: (number | null)[] = [];
  if (resetsAt) {
    const { data, error } = await db()
      .from("agent_turns")
      .select("weekly_spent")
      .eq("weekly_resets_at", resetsAt);
    if (error) throw new Error(error.message);
    spends = ((data ?? []) as { weekly_spent: number | null }[]).map((t) => t.weekly_spent);
  }
  return weeklyBudgetFrom(percent, usage, spends, now);
}

/** Someone is looking: the server asks for work every couple of seconds for a while. */
export async function keepRunnerWatching() {
  await db()
    .from("agent_runner")
    .update({ watched_until: iso(new Date(Date.now() + WATCH_SECONDS * 1000)) })
    .eq("id", "main");
}

/** The game's Cloudflare preview, when it has one (same rule as the app page's link). */
export async function previewUrlFor(app: {
  id: string;
  github_owner: string;
  github_repo: string;
  default_ref?: string | null;
}) {
  if (isSelfRepo(app.github_owner, app.github_repo)) return null;
  const { data: disabled } = await db()
    .from("app_setup_steps")
    .select("step_key")
    .eq("app_id", app.id)
    .eq("step_key", PREVIEW_DISABLED_STEP)
    .maybeSingle();
  if (disabled) return null;
  const branch = encodeURIComponent(app.default_ref || "main");
  const res = await fetch(
    `https://api.github.com/repos/${app.github_owner}/${app.github_repo}/contents/${PREVIEW_WORKFLOW_PATH}?ref=${branch}`,
    { headers: githubHeaders() },
  );
  return res.ok ? `https://bgp-${app.github_repo}.pages.dev` : null;
}

// --- poll --------------------------------------------------------------------------------

/**
 * The build server's regular call. It says it's alive and which account it holds, and
 * gets one thing to do: forget the account, link one, or answer a chat message. With
 * nothing to do it learns how long to wait.
 */
async function poll(body: Record<string, unknown>) {
  const now = new Date();
  const account = accountFrom(body.account);
  const { data: runner, error } = await db()
    .from("agent_runner")
    .update({
      last_seen_at: iso(now),
      host: str(body.host, 100),
      version: str(body.version, 20),
      busy: false,
      account,
    })
    .eq("id", "main")
    .select("watched_until, unlink_requested_at")
    .single();
  if (error) throw new Error(error.message);

  if (runner.unlink_requested_at) {
    await db()
      .from("agent_runner")
      .update({ unlink_requested_at: null, account: null })
      .eq("id", "main");
    return { unlink: true };
  }

  const { data: logins } = await db()
    .from("agent_logins")
    .select("id, mode, status, token, created_by_email, created_at")
    .in("status", ["starting", "waiting_code", "checking"])
    .order("created_at", { ascending: false })
    .limit(5);
  const expiredBefore = now.getTime() - LOGIN_EXPIRES_MINUTES * 60_000;
  const expired = (logins ?? []).filter((l: any) => Date.parse(l.created_at) < expiredBefore);
  if (expired.length) {
    await db()
      .from("agent_logins")
      .update({
        status: "failed",
        error: "It took too long. Start again.",
        code: null,
        token: null,
        updated_at: iso(now),
      })
      .in(
        "id",
        expired.map((l: any) => l.id),
      );
  }
  const starting = (logins ?? []).find(
    (l: any) => l.status === "starting" && Date.parse(l.created_at) >= expiredBefore,
  );
  if (starting) {
    // The server takes the pasted token now; it's not kept here any longer than that.
    await db()
      .from("agent_logins")
      .update({
        status: starting.mode === "token" ? "checking" : "starting",
        token: null,
        updated_at: iso(now),
      })
      .eq("id", starting.id);
    return {
      login: {
        id: starting.id,
        mode: starting.mode,
        token: starting.mode === "token" ? starting.token : undefined,
        createdByEmail: starting.created_by_email,
      },
    };
  }

  const { data: pending } = await db()
    .from("agent_turns")
    .select("id, status, chat_id, app_id, prompt, created_by_email")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: true })
    .limit(10);
  // The server does one turn at a time and only asks for work between them, so a turn still
  // "running" now was lost (the server was reinstalled, or crashed before saving it).
  const lost = (pending ?? []).filter((t: any) => t.status === "running");
  if (lost.length) {
    await db()
      .from("agent_turns")
      .update({
        status: "failed",
        error: "The build server lost this message. Send it again.",
        finished_at: iso(now),
      })
      .in(
        "id",
        lost.map((t: any) => t.id),
      );
  }
  for (const turn of (pending ?? []).filter((t: any) => t.status === "queued")) {
    const job = await claimTurn(turn, now);
    if (job) return { turn: job };
  }

  const watched = runner.watched_until && Date.parse(runner.watched_until) > now.getTime();
  const waiting = (logins ?? []).some((l: any) => !expired.includes(l));
  return { pollSeconds: watched || waiting ? POLL_FAST_SECONDS : POLL_IDLE_SECONDS };
}

/** Marks a queued turn as running and describes it for the server. Null if it can't run. */
async function claimTurn(turn: any, now: Date) {
  const { data: claimed } = await db()
    .from("agent_turns")
    .update({ status: "running", started_at: iso(now) })
    .eq("id", turn.id)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();
  if (!claimed) return null;

  const fail = async (error: string) => {
    await db()
      .from("agent_turns")
      .update({ status: "failed", error, finished_at: iso(now) })
      .eq("id", turn.id);
    return null;
  };
  const [{ data: app }, { data: chat }, { data: settingRows }, { data: runner }] =
    await Promise.all([
      db()
        .from("apps")
        .select("id, github_owner, github_repo, default_ref")
        .eq("id", turn.app_id)
        .maybeSingle(),
      db().from("agent_chats").select("session_id").eq("id", turn.chat_id).maybeSingle(),
      db().from("app_settings").select("key, value").in("key", AGENT_SETTING_KEYS),
      db().from("agent_runner").select("usage").eq("id", "main").maybeSingle(),
    ]);
  if (!app?.github_owner || !app?.github_repo)
    return fail("This game has no GitHub repo any more.");
  if (isSelfRepo(app.github_owner, app.github_repo))
    return fail("The console isn't built from its own chat.");

  const settings = agentSettingsFrom(settingRows ?? []);
  // Queued before the share ran out (another game's message used the rest): not started.
  const budget = await weeklyBudgetNow(settings.weeklyBudgetPercent, runner?.usage ?? null, now);
  if (budget.exhausted) return fail(budgetExhaustedMessage(budget));

  const repo = `${app.github_owner}/${app.github_repo}`.toLowerCase();
  const [{ data: key }, previewUrl, attachments] = await Promise.all([
    db().from("agent_repo_keys").select("public_key").eq("repo", repo).maybeSingle(),
    previewUrlFor(app).catch(() => null),
    attachmentsOf(turn.id),
  ]);
  return {
    id: turn.id,
    chatId: turn.chat_id,
    prompt: turn.prompt,
    sessionId: chat?.session_id ?? null,
    repo: { owner: app.github_owner, name: app.github_repo },
    branch: app.default_ref || "main",
    previewUrl,
    deployKey: key?.public_key ?? null,
    author: { email: turn.created_by_email },
    model: settings.model,
    effort: settings.effort,
    attachments,
    budget,
  };
}

/**
 * The files sent with a message, each with a link the build server can fetch it from for
 * the next hour (the server fetches them right away, before Claude starts).
 */
type AttachmentRow = {
  id: string;
  name: string;
  content_type: string;
  size: number;
  storage_path: string;
};

async function attachmentsOf(turnId: string) {
  const { data } = await db()
    .from("agent_attachments")
    .select("id, name, content_type, size, storage_path")
    .eq("turn_id", turnId)
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as AttachmentRow[];
  if (!rows.length) return [];
  const { data: signed, error } = await db()
    .storage.from(ATTACHMENTS_BUCKET)
    .createSignedUrls(
      rows.map((r) => r.storage_path),
      3600,
    );
  if (error) console.error("[agent] signing attachments:", error.message);
  return rows.map((r, i: number) => ({
    id: r.id,
    name: r.name,
    contentType: r.content_type,
    size: r.size,
    url: signed?.[i]?.signedUrl ?? null,
  }));
}

// --- During and after a turn ------------------------------------------------------------------

/** What Claude did since the last call. Answers whether the person pressed Stop. */
async function turnProgress(body: Record<string, unknown>) {
  const id = str(body.id, 64);
  const { data: turn } = await db()
    .from("agent_turns")
    .select("id, app_id, chat_id, status, cancel_requested_at, agent_chats(session_id)")
    .eq("id", id)
    .maybeSingle();
  if (!turn) throw new AgentApiError("No such turn", 404);

  const events = (Array.isArray(body.events) ? body.events : [])
    .slice(0, 200)
    .map(cleanEvent)
    .filter(Boolean)
    .map((e) => ({ turn_id: turn.id, app_id: turn.app_id, ...e }));
  const sessionId = str(body.sessionId, 100);
  await Promise.all([
    events.length ? db().from("agent_events").insert(events) : null,
    sessionId && sessionId !== turn.agent_chats?.session_id
      ? db().from("agent_chats").update({ session_id: sessionId }).eq("id", turn.chat_id)
      : null,
    db()
      .from("agent_runner")
      .update({ last_seen_at: iso(new Date()), busy: true })
      .eq("id", "main"),
  ]);
  return { cancel: Boolean(turn.cancel_requested_at) || turn.status !== "running" };
}

async function finishTurn(body: Record<string, unknown>) {
  const id = str(body.id, 64);
  const status = ["done", "failed", "cancelled"].includes(String(body.status))
    ? String(body.status)
    : "failed";
  const { data: turn } = await db()
    .from("agent_turns")
    .select("id, chat_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!turn) throw new AgentApiError("No such turn", 404);
  const usage = body.usage && typeof body.usage === "object" ? (body.usage as AgentUsage) : null;
  const usageBefore =
    body.usageBefore && typeof body.usageBefore === "object"
      ? (body.usageBefore as AgentUsage)
      : null;
  // What this message used of the weekly limit, for the chat's share (weeklyBudgetNow).
  const spend = turnWeeklySpend(usageBefore, usage);
  const sessionId = str(body.sessionId, 100);
  const now = iso(new Date());
  await Promise.all([
    // A turn the console already gave up on (the server was offline too long) stays as it is.
    db()
      .from("agent_turns")
      .update({
        status,
        reply: str(body.reply, 40_000),
        error: status === "done" ? null : (str(body.error, 2000) ?? "Something went wrong."),
        commits: Number.isInteger(body.commits) ? body.commits : 0,
        pushed_sha: /^[0-9a-f]{40}$/.test(String(body.pushedSha)) ? body.pushedSha : null,
        usage,
        weekly_spent: spend?.spent ?? null,
        weekly_resets_at: spend?.resetsAt ?? null,
        finished_at: now,
      })
      .eq("id", turn.id)
      .in("status", ["queued", "running"]),
    sessionId
      ? db().from("agent_chats").update({ session_id: sessionId }).eq("id", turn.chat_id)
      : null,
    db()
      .from("agent_runner")
      .update({ last_seen_at: now, busy: false, ...(usage ? { usage } : {}) })
      .eq("id", "main"),
  ]);
  return { ok: true };
}

// --- Linking an account ------------------------------------------------------------------------

/**
 * The server's side of a login: it reports the claude.ai link, then asks for the code until
 * the person has pasted it, then says how it went.
 */
async function loginProgress(body: Record<string, unknown>) {
  const id = str(body.id, 64);
  const { data: login } = await db()
    .from("agent_logins")
    .select("id, status, code")
    .eq("id", id)
    .maybeSingle();
  if (!login) throw new AgentApiError("No such login", 404);
  const now = iso(new Date());
  const done = ["linked", "failed", "cancelled"].includes(login.status);

  if (typeof body.error === "string") {
    if (!done) {
      await db()
        .from("agent_logins")
        .update({
          status: "failed",
          error: body.error.slice(0, 500),
          code: null,
          token: null,
          updated_at: now,
        })
        .eq("id", id);
    }
    return { status: "failed" };
  }
  if (body.linked) {
    const account = accountFrom(body.linked);
    if (!account) throw new AgentApiError("linked needs last4");
    const usage = body.usage && typeof body.usage === "object" ? body.usage : null;
    await Promise.all([
      db()
        .from("agent_logins")
        .update({
          status: "linked",
          error: null,
          code: null,
          token: null,
          url: null,
          updated_at: now,
        })
        .eq("id", id),
      db()
        .from("agent_runner")
        .update({ account, ...(usage ? { usage } : {}), last_seen_at: now })
        .eq("id", "main"),
    ]);
    return { status: "linked" };
  }
  if (typeof body.url === "string") {
    if (!/^https:\/\/claude\.(ai|com)\//.test(body.url))
      throw new AgentApiError("Not a claude.ai link");
    if (login.status !== "starting") return { status: login.status };
    await db()
      .from("agent_logins")
      .update({ status: "waiting_code", url: body.url.slice(0, 2000), updated_at: now })
      .eq("id", id);
    return { status: "waiting_code" };
  }
  await db().from("agent_runner").update({ last_seen_at: now }).eq("id", "main");
  return { status: login.status, code: login.status === "checking" ? login.code : undefined };
}

// --- Deploy keys -------------------------------------------------------------------------------

const KEY_TITLE = "bgp-agent (Build chat)";

/**
 * Adds the server's key for one game repo, with write access, and drops the key it had
 * there before (a new key: the server was reinstalled or moved). Only for repos of web
 * games in the console, never the console's own.
 */
async function registerRepoKey(body: Record<string, unknown>) {
  const repo = str(body.repo, 200) ?? "";
  const publicKey = (str(body.publicKey, 1000) ?? "").trim();
  if (!isDeployKey(publicKey)) throw new AgentApiError("Not an ed25519 public key");
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new AgentApiError("repo must be owner/name");
  if (isSelfRepo(owner, name)) throw new AgentApiError("Not for the console's own repo", 403);
  const { data: apps } = await db()
    .from("apps")
    .select("github_owner, github_repo")
    .ilike("github_repo", name);
  const known = (apps ?? []).some(
    (a: any) =>
      a.github_owner?.toLowerCase() === owner.toLowerCase() &&
      a.github_repo?.toLowerCase() === name.toLowerCase(),
  );
  if (!known) throw new AgentApiError("That repo isn't a game in the console", 403);

  const base = `https://api.github.com/repos/${owner}/${name}/keys`;
  const headers = { ...githubHeaders(), "Content-Type": "application/json" };
  const listed = await fetch(`${base}?per_page=100`, { headers });
  if (!listed.ok) throw new Error(`GitHub didn't list the repo's deploy keys (${listed.status})`);
  for (const key of (await listed.json()) as { id: number; title: string; key: string }[]) {
    if (key.title === KEY_TITLE) await fetch(`${base}/${key.id}`, { method: "DELETE", headers });
  }
  const added = await fetch(base, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: KEY_TITLE, key: publicKey, read_only: false }),
  });
  if (!added.ok) {
    const said = (await added.text()).slice(0, 500);
    // An organization setting, off by default on new organizations: the build server can't
    // push until an owner turns it on (or gives it a token instead; agent-runner/README.md).
    if (/deploy keys are disabled/i.test(said)) {
      throw new AgentApiError(
        `GitHub doesn't allow deploy keys in ${owner}, so the build server can't save Claude's changes. An owner of the organization has to turn them on: GitHub → ${owner} → Settings → Member privileges → Deploy keys → Enabled.`,
        409,
      );
    }
    throw new Error(`GitHub didn't add the deploy key (${added.status}): ${said.slice(0, 200)}`);
  }
  const { id } = (await added.json()) as { id: number };
  await db()
    .from("agent_repo_keys")
    .upsert({
      repo: repo.toLowerCase(),
      public_key: publicKey,
      github_key_id: id,
      registered_at: iso(new Date()),
    });
  return { ok: true };
}

const ROUTES: Record<string, (body: Record<string, unknown>) => Promise<unknown>> = {
  poll,
  turn: turnProgress,
  finish: finishTurn,
  login: loginProgress,
  "repo-key": registerRepoKey,
};

export async function handleRunnerRequest(path: string, request: Request) {
  try {
    checkRunnerToken(request);
    const handler = ROUTES[path];
    if (!handler) throw new AgentApiError("Not found", 404);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AgentApiError("The body must be JSON");
    }
    if (!body || typeof body !== "object")
      throw new AgentApiError("The body must be a JSON object");
    return Response.json(await handler(body as Record<string, unknown>));
  } catch (error) {
    const status = error instanceof AgentApiError ? error.status : 500;
    if (status === 500) console.error(`[agent] ${path}:`, error);
    return Response.json({ error: (error as Error).message }, { status });
  }
}
