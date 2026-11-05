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

export type AgentSettings = {
  model: AgentModel;
  effort: AgentEffort;
  /**
   * How much of the Claude account's weekly limit the Build chat may use, in percent
   * (0: no limit). The account is shared with Claude Code elsewhere, so this keeps the
   * chat from using it all up. See weeklyBudgetFrom.
   */
  weeklyBudgetPercent: number;
};

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  model: "claude-opus-5-5",
  effort: "medium",
  weeklyBudgetPercent: 10,
};

/** app_settings keys. */
export const AGENT_MODEL_SETTING = "agent_model";
export const AGENT_EFFORT_SETTING = "agent_effort";
export const AGENT_WEEKLY_BUDGET_SETTING = "agent_weekly_budget_percent";
export const AGENT_SETTING_KEYS = [
  AGENT_MODEL_SETTING,
  AGENT_EFFORT_SETTING,
  AGENT_WEEKLY_BUDGET_SETTING,
];

export function agentSettingsFrom(rows: { key: string; value: unknown }[]): AgentSettings {
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  const model = AGENT_MODELS.find((m) => m.id === get(AGENT_MODEL_SETTING))?.id;
  const effort = AGENT_EFFORTS.find((e) => e.id === get(AGENT_EFFORT_SETTING))?.id;
  const budget = Number(get(AGENT_WEEKLY_BUDGET_SETTING));
  return {
    model: model ?? DEFAULT_AGENT_SETTINGS.model,
    effort: effort ?? DEFAULT_AGENT_SETTINGS.effort,
    weeklyBudgetPercent:
      get(AGENT_WEEKLY_BUDGET_SETTING) !== undefined &&
      Number.isFinite(budget) &&
      budget >= 0 &&
      budget <= 100
        ? budget
        : DEFAULT_AGENT_SETTINGS.weeklyBudgetPercent,
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
/** `at`: when Claude reported it. */
export type AgentUsage = { fiveHour?: AgentUsageWindow; weekly?: AgentUsageWindow; at?: string };

/**
 * The account's usage only comes from Claude: at every call of a Build chat message,
 * and, since it can be hours between messages, from a tiny call the build server makes
 * when a page asks for a fresh reading older than this.
 */
export const USAGE_STALE_MINUTES = 15;

export function usageIsStale(usage: AgentUsage | null | undefined, now = new Date()) {
  const at = usage?.at ? Date.parse(usage.at) : NaN;
  return !Number.isFinite(at) || now.getTime() - at > USAGE_STALE_MINUTES * 60_000;
}

// --- The weekly share ---------------------------------------------------------------------
//
// Claude reports the account's usage (percent of each limit, and when it resets) at every
// call it makes. The build server keeps the first and the last report of each message, and
// the difference is what that message used of the weekly limit. Added up over the current
// window, that is what the Build chat has used this week, and Settings → Claude says how
// much it may. It is an approximation: the reports come in whole percents, and anything
// else using the account during a message counts towards it.

export type WeeklyBudget = {
  /** Of the account's weekly limit; 0 for no limit. */
  percent: number;
  /** What the Build chat used in the current window, in percent of the weekly limit. */
  spent: number;
  /** When the current window resets; null until Claude has reported it (or it has passed). */
  resetsAt: string | null;
  exhausted: boolean;
};

const tenth = (n: number) => Math.round(n * 10) / 10;

/** What a message used of the weekly limit, and which window it counts in. */
export function turnWeeklySpend(
  before: AgentUsage | null | undefined,
  after: AgentUsage | null | undefined,
): { spent: number; resetsAt: string } | null {
  const a = after?.weekly;
  const b = before?.weekly;
  if (!a?.resetsAt) return null;
  const spent = b && b.resetsAt === a.resetsAt ? Math.max(0, a.percent - b.percent) : 0;
  return { spent: tenth(spent), resetsAt: a.resetsAt };
}

/** The window Claude last reported, as long as it hasn't reset since. */
export function currentWeeklyWindow(usage: AgentUsage | null | undefined, now = new Date()) {
  const resetsAt = usage?.weekly?.resetsAt;
  return resetsAt && Date.parse(resetsAt) > now.getTime() ? resetsAt : null;
}

/** `spends` are the messages' weekly spends in the current window (turnWeeklySpend). */
export function weeklyBudgetFrom(
  percent: number,
  usage: AgentUsage | null | undefined,
  spends: (number | null)[],
  now = new Date(),
): WeeklyBudget {
  const resetsAt = currentWeeklyWindow(usage, now);
  const spent = resetsAt ? tenth(spends.reduce<number>((sum, x) => sum + (Number(x) || 0), 0)) : 0;
  return {
    percent,
    spent,
    resetsAt,
    exhausted: percent > 0 && resetsAt !== null && spent >= percent,
  };
}

/** "Friday at 07:00", in the console's time zone. */
export function resetLabel(resetsAt: string | null) {
  if (!resetsAt) return "when the limit resets";
  const date = new Date(resetsAt);
  const weekday = date.toLocaleDateString("en-GB", { weekday: "long", timeZone: "Europe/Madrid" });
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  });
  return `${weekday} at ${time}`;
}

/** What the chat and the build server say when the share is used up. */
export function budgetExhaustedMessage(budget: WeeklyBudget) {
  return `The Build chat has used its share of the Claude account's weekly limit (${budget.percent}% of it), so it waits until ${resetLabel(budget.resetsAt)}. The share is set in Settings → Claude.`;
}

// --- Attachments ----------------------------------------------------------------------------
//
// A message can carry files for Claude to look at: images and PDFs (which Claude Code's Read
// tool shows Claude) and plain text. They go to Storage (bucket agent-attachments) and the
// build server fetches them before Claude starts, into /attachments in Claude's container.

export const ATTACHMENTS_BUCKET = "agent-attachments";
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const ATTACHMENTS_PER_MESSAGE = 8;

const ATTACHMENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};

/** For the file picker. */
export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

/**
 * The type a file is kept as, from its name (browsers often leave the type blank, and
 * the name is what Claude sees), or null when it can't be attached.
 */
export function attachmentType(name: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return (ext && ATTACHMENT_TYPES[ext]) || null;
}

export function attachmentKind(contentType: string): "image" | "pdf" | "text" {
  if (contentType.startsWith("image/")) return "image";
  if (contentType === "application/pdf") return "pdf";
  return "text";
}

/** Why a file can't be attached, in words for the person, or null when it can. */
export function attachmentProblem(file: { name: string; size: number }): string | null {
  if (!attachmentType(file.name)) {
    return `${file.name}: only images (PNG, JPEG, GIF, WebP), PDFs and text files (TXT, MD, CSV, JSON) can be attached.`;
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return `${file.name} is ${formatBytes(file.size)}; the most is ${formatBytes(ATTACHMENT_MAX_BYTES)}.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${tenth(bytes / 1024 / 1024)} MB`;
}

/** A file name safe for Storage and for Claude's container, keeping the extension. */
export function safeFileName(name: string) {
  const clean = name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+/, "")
    .slice(0, 80);
  return clean || "file";
}

export type BuildAttachment = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  /** A small data: URL of an image, for the chat. */
  thumbnail: string | null;
};

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

// --- Internet and keys (Settings → Claude) ------------------------------------------------
//
// Like the cloud environment of Claude Code on the web: sites the Build chat's sessions may
// reach besides the Claude API and npm, and variables (API keys) they get. Both live on the
// build server, like the Claude token; the console sees the sites and each variable's name
// with its last four characters. Same rules as agent-runner/lib.mjs, which checks again.

/** What the Build chat can always reach. */
export const BUILT_IN_SITES = ["api.anthropic.com", "registry.npmjs.org"];

export const MAX_ENVIRONMENT_DOMAINS = 50;
export const MAX_ENVIRONMENT_VARIABLES = 50;
const MAX_VARIABLE_CHARS = 4000;

/**
 * The services Settings → Claude connects with just a key: the key goes in `variable` and
 * Claude may reach `domains`. `check` is a call that only says whether the key is valid.
 */
export const AGENT_SERVICES = [
  {
    id: "openai",
    label: "OpenAI",
    purpose: "images",
    domains: ["api.openai.com"],
    variable: "OPENAI_API_KEY",
    keysUrl: "https://platform.openai.com/api-keys",
    check: { url: "https://api.openai.com/v1/models", header: "authorization", bearer: true },
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    purpose: "voices and sounds",
    domains: ["api.elevenlabs.io"],
    variable: "ELEVENLABS_API_KEY",
    keysUrl: "https://elevenlabs.io/app/settings/api-keys",
    check: { url: "https://api.elevenlabs.io/v1/models", header: "xi-api-key", bearer: false },
  },
] as const;
export type AgentService = (typeof AGENT_SERVICES)[number];
export type AgentServiceId = AgentService["id"];

/**
 * The key out of whatever was pasted in a service's box: the key alone, the line
 * NAME=value from Claude Code's environment, or all of its lines (this service's is used).
 */
export function serviceKeyFrom(text: string, service: AgentService) {
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (!lines.length) return { problem: "Paste the key first." };
  const named = new RegExp(`^(?:export\\s+)?${service.variable}\\s*=`);
  const line = lines.length === 1 ? lines[0] : lines.find((l) => named.test(l));
  if (!line)
    return {
      problem: `Paste only the key, or the line that starts with ${service.variable}=.`,
    };
  const assignment = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  const other = assignment ? serviceOfVariable(assignment[1]) : null;
  if (other && other.id !== service.id)
    return { problem: `That's the ${other.label} key: paste it in the ${other.label} box.` };
  let key = (assignment ? assignment[2] : line).trim();
  const quoted = /^(["'])(.*)\1$/.exec(key);
  if (quoted) key = quoted[2];
  if (/\s/.test(key)) return { problem: "A key has no spaces. Copy it again, on its own." };
  if (key.length < 20) return { problem: "That's too short to be a key. Copy it again, whole." };
  if (key.length > MAX_VARIABLE_CHARS) return { problem: "That's too long to be a key." };
  return { key };
}

/**
 * What the service said to its check call: "invalid" only when it says so plainly (a key
 * mistyped or cut short); a key that can't list models, or a service that didn't answer,
 * is "unknown" and kept.
 */
export function serviceKeyVerdict(
  service: AgentServiceId,
  status: number,
  body: unknown,
): "ok" | "invalid" | "unknown" {
  if (status >= 200 && status < 300) return "ok";
  const b = (body ?? {}) as {
    error?: { code?: string; message?: string };
    detail?: { status?: string };
  };
  if (service === "openai" && status === 401) {
    if (b.error?.code === "invalid_api_key" || /incorrect api key/i.test(b.error?.message ?? ""))
      return "invalid";
  }
  if (service === "elevenlabs" && status === 401 && b.detail?.status === "invalid_api_key")
    return "invalid";
  return "unknown";
}

/** The service a variable belongs to, if any. */
export const serviceOfVariable = (name: string) =>
  AGENT_SERVICES.find((service) => service.variable === name) ?? null;

/** The first runner version (agent-runner/runner.mjs VERSION) that takes these changes. */
export const ENVIRONMENT_RUNNER_VERSION = 5;
/** A change the server took but never confirmed is given up after this. */
export const ENVIRONMENT_SENDING_MINUTES = 5;

export type AgentEnvironment = {
  domains: string[];
  variables: { name: string; last4: string }[];
  updatedAt: string | null;
  updatedBy: string | null;
};

export type EnvironmentChangeView = {
  id: string;
  status: "pending" | "sending" | "applied" | "failed";
  error: string | null;
  skipped: string[];
  createdAt: string;
};

/** The environment as the build server reported it. */
export function environmentFrom(value: unknown): AgentEnvironment {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" ? x : null);
  return {
    domains: Array.isArray(v.domains) ? v.domains.filter((d) => typeof d === "string") : [],
    variables: Array.isArray(v.variables)
      ? (v.variables as { name?: unknown; last4?: unknown }[])
          .filter((x) => x && typeof x.name === "string")
          .map((x) => ({ name: x.name as string, last4: String(x.last4 ?? "") }))
      : [],
    updatedAt: str(v.updatedAt),
    updatedBy: str(v.updatedBy),
  };
}

/**
 * A site as written in the settings ("api.openai.com", "*.openai.com" for its subdomains
 * and itself), from what someone pasted: a URL, a host with a port, a trailing dot. Null
 * for what isn't a public host name: IP addresses, localhost, the home network's names.
 */
export function domainRule(text: string): string | null {
  let value = String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .split(/[/?#\s]/)[0]
    .replace(/:\d*$/, "")
    .replace(/\.$/, "");
  let wildcard = false;
  if (value.startsWith("*.")) [wildcard, value] = [true, value.slice(2)];
  else if (value.startsWith(".")) [wildcard, value] = [true, value.slice(1)];
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/.test(value))
    return null;
  if (/\.(local|localhost|lan|home|internal|arpa|test|invalid)$/.test(value)) return null;
  return wildcard ? `*.${value}` : value;
}

/** The sites box: one per line (commas and spaces work too), # for comments. */
export function parseDomains(text: string) {
  const domains: string[] = [];
  const problems: string[] = [];
  for (const raw of text
    .split("\n")
    .map((line) => line.replace(/#.*/, ""))
    .join(" ")
    .split(/[\s,;]+/)
    .filter(Boolean)) {
    const rule = domainRule(raw);
    if (!rule) problems.push(`“${raw.slice(0, 60)}” isn't a website's name (like api.openai.com).`);
    else if (!BUILT_IN_SITES.includes(rule) && !domains.includes(rule)) domains.push(rule);
  }
  if (domains.length > MAX_ENVIRONMENT_DOMAINS)
    problems.push(`At most ${MAX_ENVIRONMENT_DOMAINS} websites.`);
  return { domains, problems };
}

/**
 * Names the build server sets itself, or that change how Claude Code, git, Node or the
 * proxy behave.
 */
const RESERVED_VARIABLE =
  /^(HOME|PATH|SHELL|USER|TZ|LANG|LC_\w+|NODE_OPTIONS|NODE_PATH|BUN_\w+|NPM_CONFIG_\w+|LD_\w+|DYLD_\w+|\w*_PROXY|CLAUDE\w*|ANTHROPIC\w*|GIT_\w+|SSH_\w+|DISABLE_\w+)$/i;

export function variableProblem(name: string, value = ""): string | null {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(name)) return "isn't a valid name";
  if (RESERVED_VARIABLE.test(name)) return "is set by the build server itself";
  if (/[\r\n\0]/.test(value)) return "has a line break in its value";
  if (value.length > MAX_VARIABLE_CHARS) return "is too long";
  return null;
}

/**
 * The keys box, in .env format as Claude Code's environment shows it: NAME=value per line,
 * # comments, an optional `export`, quotes around the value.
 */
export function parseVariables(text: string) {
  const variables: Record<string, string> = {};
  const problems: string[] = [];
  text.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const match = /^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      problems.push(`Line ${index + 1} has no “=”: write it as NAME=value.`);
      return;
    }
    const name = match[1];
    let value = match[2].trim();
    const quoted = /^(["'])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, "");
    const problem = variableProblem(name, value);
    if (problem) problems.push(`${name} ${problem}.`);
    else if (!value) problems.push(`${name} has no value.`);
    else variables[name] = value;
  });
  if (Object.keys(variables).length > MAX_ENVIRONMENT_VARIABLES)
    problems.push(`At most ${MAX_ENVIRONMENT_VARIABLES} keys.`);
  return { variables, problems };
}

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
