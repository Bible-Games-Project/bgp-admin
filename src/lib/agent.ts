// The Build chat (/apps/<id>/build) and the Claude account behind it (/settings/claude):
// shapes and rules shared by the page, the server functions (agent.functions.ts) and the
// routes the build server calls (agent.server.ts). The build server itself lives in
// agent-runner/ (see its README).

/** The models the chat can run on (Settings → Claude). Claude Code takes these IDs. */
export const AGENT_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Recommended" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Faster, for small changes" },
  {
    id: "claude-fable-5-1",
    label: "Claude Fable 5.1",
    note: "The most capable; uses the limit fastest",
  },
] as const;
export type AgentModel = (typeof AGENT_MODELS)[number]["id"];

/** How hard Claude thinks before acting. Higher is slower and uses more of the limit. */
export const AGENT_EFFORTS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra high" },
] as const;
export type AgentEffort = (typeof AGENT_EFFORTS)[number]["id"];

export const DEFAULT_AGENT_SETTINGS: { model: AgentModel; effort: AgentEffort } = {
  model: "claude-opus-5-5",
  effort: "medium",
};

/** app_settings keys. */
export const AGENT_MODEL_SETTING = "agent_model";
export const AGENT_EFFORT_SETTING = "agent_effort";

export function agentSettingsFrom(rows: { key: string; value: unknown }[]) {
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  const model = AGENT_MODELS.find((m) => m.id === get(AGENT_MODEL_SETTING))?.id;
  const effort = AGENT_EFFORTS.find((e) => e.id === get(AGENT_EFFORT_SETTING))?.id;
  return {
    model: model ?? DEFAULT_AGENT_SETTINGS.model,
    effort: effort ?? DEFAULT_AGENT_SETTINGS.effort,
  };
}

/** A message, and the conversation it can grow to, has to fit a request comfortably. */
export const MAX_PROMPT_CHARS = 10_000;

/**
 * The build server asks for work every POLL_FAST_SECONDS while someone has the chat or
 * the Claude settings open (and each page view keeps that going for WATCH_SECONDS), and
 * every POLL_IDLE_SECONDS otherwise. Each ask is a Worker request: the free plan has
 * 100,000 a day.
 */
export const POLL_FAST_SECONDS = 2;
export const POLL_IDLE_SECONDS = 10;
export const WATCH_SECONDS = 120;

/**
 * The server counts as offline when it hasn't been heard from for this long. It reports
 * at least every POLL_IDLE_SECONDS, and every few seconds during a turn; checking a newly
 * linked account takes up to two minutes without a word.
 */
export const RUNNER_OFFLINE_AFTER_SECONDS = 150;

/** A login the person started and didn't finish is dropped after this long. */
export const LOGIN_EXPIRES_MINUTES = 12;

export type AgentUsageWindow = { percent: number; resetsAt: string | null };
export type AgentUsage = { fiveHour?: AgentUsageWindow; weekly?: AgentUsageWindow; at?: string };

export type AgentAccount = {
  last4: string;
  linkedAt: string | null;
  linkedBy: string | null;
  /** When Claude stopped accepting it: it has to be linked again. */
  rejectedAt: string | null;
};

export type RunnerView = {
  online: boolean;
  lastSeenAt: string | null;
  host: string | null;
  version: string | null;
  busy: boolean;
};

export function runnerView(
  row: {
    last_seen_at: string | null;
    host: string | null;
    version: string | null;
    busy: boolean;
  } | null,
  now = new Date(),
): RunnerView {
  const lastSeen = row?.last_seen_at ? Date.parse(row.last_seen_at) : NaN;
  return {
    online:
      Number.isFinite(lastSeen) && now.getTime() - lastSeen < RUNNER_OFFLINE_AFTER_SECONDS * 1000,
    lastSeenAt: row?.last_seen_at ?? null,
    host: row?.host ?? null,
    version: row?.version ?? null,
    busy: row?.busy ?? false,
  };
}

/** The account as the server reported it, or null when none is linked. */
export function accountFrom(value: unknown): AgentAccount | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.last4 !== "string") return null;
  const str = (x: unknown) => (typeof x === "string" ? x : null);
  return {
    last4: v.last4,
    linkedAt: str(v.linkedAt),
    linkedBy: str(v.linkedBy),
    rejectedAt: str(v.rejectedAt),
  };
}

export type TurnStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export const ACTIVE_TURN_STATUSES: TurnStatus[] = ["queued", "running"];
export const isActiveTurn = (status: string) => (ACTIVE_TURN_STATUSES as string[]).includes(status);

export type AgentEventBody =
  | { text: string }
  | { tool: string; label: string; todos?: { content: string; status: string }[] };

export type AgentEvent = {
  id: number;
  kind: "text" | "step";
  body: AgentEventBody;
  created_at: string;
};

/** What the build server may send as an event; anything else is dropped. */
export function cleanEvent(raw: unknown): { kind: "text" | "step"; body: AgentEventBody } | null {
  if (!raw || typeof raw !== "object") return null;
  const { kind, body } = raw as { kind?: unknown; body?: Record<string, unknown> };
  if (!body || typeof body !== "object") return null;
  if (kind === "text" && typeof body.text === "string" && body.text.trim()) {
    return { kind, body: { text: body.text.slice(0, 20_000) } };
  }
  if (kind === "step" && typeof body.label === "string") {
    const step: AgentEventBody = {
      tool: typeof body.tool === "string" ? body.tool.slice(0, 60) : "tool",
      label: body.label.slice(0, 300),
    };
    if (Array.isArray(body.todos)) {
      step.todos = body.todos
        .slice(0, 30)
        .filter(
          (t): t is { content: string; status: string } => !!t && typeof t.content === "string",
        )
        .map((t) => ({
          content: t.content.slice(0, 200),
          status: String(t.status ?? "pending").slice(0, 20),
        }));
    }
    return { kind, body: step };
  }
  return null;
}

/**
 * Compares the build server's token without leaking, through timing, how much of it a
 * guess got right.
 */
export function sameSecret(a: string, b: string) {
  if (!a || !b) return false;
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++)
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

export const isClaudeToken = (token: string) =>
  /^sk-ant-oat\d+-[A-Za-z0-9_-]{20,}$/.test(token.trim());

export const isDeployKey = (key: string) =>
  /^ssh-ed25519 [A-Za-z0-9+/]+={0,2}( [^\n]{0,200})?$/.test(key.trim());

// --- The preview deploy -------------------------------------------------------------------

/**
 * Where a pushed commit's preview stands, from the game's preview-deploy.yml run for it.
 * That workflow carries on when the build fails (continue-on-error) and skips the deploy,
 * so the run ends green with the old preview still up: a skipped deploy step is a failure
 * here.
 */
export type PreviewDeployState =
  | { state: "waiting" }
  | { state: "building"; runUrl: string }
  | { state: "live"; runUrl: string }
  | { state: "failed"; runUrl: string; step: string | null };

export const PREVIEW_DEPLOY_STEP = "Deploy to Cloudflare Pages";

type RunStep = { name: string; status: string; conclusion: string | null };

export function previewDeployState(
  run: { status: string; conclusion: string | null; html_url: string } | null,
  steps: RunStep[],
): PreviewDeployState {
  if (!run) return { state: "waiting" };
  if (run.status !== "completed") return { state: "building", runUrl: run.html_url };
  const deploy = steps.find((s) => s.name === PREVIEW_DEPLOY_STEP);
  if (run.conclusion === "success" && deploy?.conclusion === "success") {
    return { state: "live", runUrl: run.html_url };
  }
  // With continue-on-error the failed step can still read "success": the first step that
  // says failure, or else the build, which is what skipping the deploy means.
  const failed = steps.find((s) => s.conclusion === "failure")?.name ?? null;
  return { state: "failed", runUrl: run.html_url, step: failed ?? (deploy ? "Build" : null) };
}

/** The message "Ask Claude to fix it" sends when a preview build fails. */
export function fixPreviewPrompt(error: string) {
  const excerpt = error.trim()
    ? `\n\nThis is what the build printed:\n\n\`\`\`\n${error.trim().slice(-4000)}\n\`\`\``
    : "";
  return `The preview build on GitHub failed after your last change, so the preview didn't update. Find out why, fix it, and check that \`bun run build\` passes.${excerpt}`;
}

/** The page reloads the preview with this so the browser doesn't show a cached copy. */
export function previewSrc(url: string, version: string | number) {
  const u = new URL(url);
  u.searchParams.set("bgp_preview", String(version));
  return u.toString();
}
