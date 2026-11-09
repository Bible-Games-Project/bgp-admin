// What the build server works out without talking to anyone: the arguments and the
// instructions the Claude CLI gets, how its stream-json output becomes the chat's events,
// what a finished session means, and what a turn may not change. Kept apart from
// runner.mjs so it can be tested (lib.test.mjs).

import { lstatSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const oneLine = (text, max) => {
  const line = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

// --- What Claude is told --------------------------------------------------------------

/**
 * Appended to Claude Code's own system prompt. The game repo's AGENTS.md and
 * docs/agents/working-style.md still apply; this only says how this environment differs
 * from the ones they describe (it can't push, poll deploys or publish Artifacts).
 */
export function systemPrompt(job) {
  const preview = job.previewUrl
    ? `GitHub deploys the preview at ${job.previewUrl} about a minute later, and the page reloads it by itself.`
    : "This game has no Cloudflare preview yet, so there is nothing to look at after a change; say so if they ask where to see it.";
  const domains = job.environment?.domains ?? [];
  const names = job.environment?.variables ?? [];
  const reach = domains.length
    ? `You can reach the Claude API, the npm registry and these sites, which the person allowed in Settings → Claude → Internet and keys: ${domains.join(", ")}. Nothing else: no GitHub, no other websites.`
    : "You can reach the Claude API and the npm registry, nothing else: no GitHub, no other websites.";
  return [
    "You are working inside the Build chat of the BGP Console (bgp-admin). The person writing to you builds this game from a chat in their browser, with the game's live preview next to it. They are not a programmer and never see a terminal.",
    "",
    "How this environment works:",
    `- You run in a sandboxed container on the build server, in a clone of the game's repository (${job.repo.owner}/${job.repo.name}) on the branch \`${job.branch}\`. ${reach}`,
    ...(names.length
      ? [
          `- These keys are in your environment variables, from the same settings: ${names.join(", ")}. Use them from the shell (curl, node, bun) to call those services while you work, for example to generate images or sounds and save the files into the repository. Never write a key into a file, a commit or the game's code (the game is public: anyone could take it), and never print it in the chat. If you commit a key, the console refuses to save your changes.`,
        ]
      : []),
    "- If you need a website or a key you don't have, don't look for a way around it: tell the person they can add it in Settings → Claude → Internet and keys (for OpenAI or ElevenLabs they only paste the key and press Connect), and that you'll use it from their next message. When an API can give its result either inline or as a link to another site (OpenAI images: ask for base64), ask for it inline: only the sites listed above are reachable.",
    `- Commit each finished change to \`${job.branch}\` with a clear English commit message. Don't push and don't create branches: when you finish, the console pushes your commits. ${preview}`,
    "- Where the repository's instructions (AGENTS.md, docs/agents/working-style.md) say to push, to wait for or poll the deploy, to check GitHub Actions or to publish an Artifact, skip that step: the console does it. Everything else in them applies, above all the native boundary.",
    "- Before you finish a change, run the build (`bun run build`) and make sure it passes: if it fails, the preview doesn't update. Dependencies are already installed; if you add one, run `bun install`.",
    "- You can't open the preview or a browser. Say what you changed and what to look at in the preview on the right.",
    `- Files the person attaches to a message are in ${job.attachmentsDir ?? "/attachments"} (read-only; the message lists them). Read them with the Read tool: images and PDFs are shown to you. Files from earlier messages stay there. To use one in the game, copy it into the repository.`,
    "- Each message is one step of an ongoing conversation, not the end of a working session: only update AGENTS.md when you learned something the next agent really needs.",
    "",
    "Talking to them: reply in the language of their message. Keep it short and plain, with no code unless they ask for it. Lead with what you did or found. If something can't be done, or you need a decision from them, say so and ask one clear question.",
  ].join("\n");
}

/** The first message of a session that should have resumed one but couldn't find it. */
export function promptWithLostHistory(prompt) {
  return [
    "(The earlier messages of this chat couldn't be loaded, so you start without them. If you need context, look at the repository and its recent git log.)",
    "",
    prompt,
  ].join("\n");
}

/** What a file's size reads like. */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}

/** The message with the files sent with it listed at the end, where Claude finds them. */
export function promptWithAttachments(prompt, files, dir = "/attachments") {
  if (!files?.length) return prompt;
  const kind = (type) =>
    type?.startsWith("image/") ? "image" : type === "application/pdf" ? "PDF" : "text file";
  return [
    prompt,
    "",
    files.length === 1
      ? "Attached file (read it with the Read tool):"
      : "Attached files (read them with the Read tool):",
    ...files.map((f) => `- ${dir}/${f.name} (${kind(f.contentType)}, ${formatBytes(f.size)})`),
  ].join("\n");
}

/** A file name safe for the container, keeping the extension (same rule as the console). */
export function safeFileName(name) {
  const clean = String(name ?? "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+/, "")
    .slice(0, 80);
  return clean || "file";
}

/** `name`, or name-2, name-3… when a file of that name is already among `taken`. */
export function uniqueFileName(name, taken) {
  if (!taken.includes(name)) return name;
  const dot = name.lastIndexOf(".");
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}${ext}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

// No --max-turns unless a cap is set (MAX_TURNS above 0): by default a turn takes as many
// steps as it needs.
function maxTurnsArgs(maxTurns) {
  return maxTurns > 0 ? ["--max-turns", String(maxTurns)] : [];
}

/** The CLI's arguments. The account's token is never among them: it goes in an env file. */
export function claudeArgs({ prompt, model, effort, sessionId, maxTurns, job }) {
  return [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    model,
    ...(effort ? ["--effort", effort] : []),
    ...maxTurnsArgs(maxTurns),
    ...(sessionId ? ["--resume", sessionId] : []),
    "--append-system-prompt",
    systemPrompt(job),
    // No "Co-Authored-By"/"Generated with" lines: the commits are the game's history.
    "--settings",
    JSON.stringify({ attribution: { commit: "", pr: "" }, includeCoAuthoredBy: false }),
    // Inside the container it can't reach anything but the Claude API and npm.
    "--dangerously-skip-permissions",
    "--disallowedTools",
    "WebFetch",
  ];
}

/**
 * The CLI's arguments for one of Ruben's turns (the console's assistant): none of Claude
 * Code's own tools, the console's tools through the MCP server console-mcp.mjs, and the
 * instructions the console sends with the turn. No repository: it reads the console only.
 */
export function assistantArgs({
  prompt,
  model,
  effort,
  sessionId,
  maxTurns,
  systemPrompt,
  mcpConfig,
}) {
  return [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    model,
    ...(effort ? ["--effort", effort] : []),
    ...maxTurnsArgs(maxTurns),
    ...(sessionId ? ["--resume", sessionId] : []),
    "--append-system-prompt",
    systemPrompt,
    "--tools",
    "",
    "--mcp-config",
    mcpConfig,
    "--strict-mcp-config",
    "--settings",
    JSON.stringify({ attribution: { commit: "", pr: "" }, includeCoAuthoredBy: false }),
    "--dangerously-skip-permissions",
  ];
}

/**
 * One tiny call: a word from a small model, no tools, a one-line system prompt in place of
 * Claude Code's own. Claude answers it with the account's limits (a rate_limit_event), which
 * is what it's for: checking a token, and reading the usage when a page asks.
 */
export function pingArgs(model) {
  return [
    "-p",
    "Reply with the word OK.",
    "--model",
    model,
    "--max-turns",
    "1",
    "--output-format",
    "stream-json",
    "--verbose",
    "--tools",
    "",
    "--system-prompt",
    "Reply with the word OK and nothing else.",
  ];
}

// --- Reading the CLI's stream-json output ---------------------------------------------

/** One line of stream-json, or null. */
export function parseLine(line) {
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** A path as the person would read it: relative to the repository. */
function shortPath(path, root = "/work") {
  const value = String(path ?? "");
  return (value.startsWith(`${root}/`) ? value.slice(root.length + 1) : value) || "a file";
}

/** What each of the console's tools reads, for the chat (console-mcp.mjs names them mcp__console__…). */
const CONSOLE_TOOL_LABELS = {
  home: "Looked at Home",
  apps: "Listed the apps",
  app: "Looked at an app",
  build_chat: "Read a Build chat",
  expenses: "Read the expenses",
  revenue: "Read the revenue",
  downloads: "Read the downloads",
  reviews: "Read the reviews",
  settings: "Read the settings",
};

/** What a tool call did, in a few words. */
export function stepLabel(name, input = {}, root = "/work") {
  const consoleTool = /^mcp__console__(\w+)$/.exec(name)?.[1];
  if (consoleTool) return CONSOLE_TOOL_LABELS[consoleTool] ?? `Read ${oneLine(consoleTool, 40)}`;
  switch (name) {
    case "Read":
      return `Read ${shortPath(input.file_path, root)}`;
    case "Edit":
    case "MultiEdit":
      return `Edited ${shortPath(input.file_path, root)}`;
    case "Write":
      return `Wrote ${shortPath(input.file_path, root)}`;
    case "NotebookEdit":
      return `Edited ${shortPath(input.notebook_path, root)}`;
    case "Bash":
      return input.description
        ? oneLine(input.description, 120)
        : `Ran ${oneLine(input.command, 100)}`;
    case "Glob":
      return `Looked for files matching ${oneLine(input.pattern, 80)}`;
    case "Grep":
      return `Searched the code for “${oneLine(input.pattern, 60)}”`;
    case "WebSearch":
      return `Searched the web for “${oneLine(input.query, 80)}”`;
    case "TodoWrite":
      return "Updated the plan";
    case "Task":
    case "Agent":
      return input.description
        ? `Asked a helper: ${oneLine(input.description, 100)}`
        : "Asked a helper";
    case "Skill":
      return `Used the ${oneLine(input.skill ?? input.name, 60)} skill`;
    default:
      return `Used ${oneLine(name, 60)}`;
  }
}

/**
 * The chat events in one stream-json line: what Claude said ('text'), each tool it used
 * ('step') and when it summarizes the conversation to keep it short (a 'step' too).
 * Thinking, tool results and the CLI's other notices aren't shown.
 */
export function eventsFrom(message, root = "/work") {
  if (message?.type === "system" && message.subtype === "status" && message.status === "compacting")
    return [
      {
        kind: "step",
        body: { tool: "compact", label: "Summarized the conversation so far, to keep it short" },
      },
    ];
  if (message?.type !== "assistant") return [];
  const events = [];
  for (const block of message.message?.content ?? []) {
    if (block.type === "text" && block.text?.trim()) {
      events.push({ kind: "text", body: { text: block.text } });
    } else if (block.type === "tool_use") {
      const body = { tool: block.name, label: stepLabel(block.name, block.input, root) };
      if (block.name === "TodoWrite" && Array.isArray(block.input?.todos)) {
        body.todos = block.input.todos.slice(0, 30).map((t) => ({
          content: oneLine(t.content, 200),
          status: t.status,
        }));
      }
      events.push({ kind: "step", body });
    }
  }
  return events;
}

// The account's usage as a rate-limit notice gives it ({ fiveHour, weekly }, 0-100). The
// notices carry both windows in unifiedWindows (utilization 0-1, resetsAt in seconds).
export function usageFrom(info, at = new Date()) {
  if (!info || typeof info !== "object") return null;
  const usage = {};
  const put = (key, window) => {
    if (!window || typeof window.utilization !== "number") return;
    usage[key] = {
      percent: Math.round(window.utilization * 1000) / 10,
      resetsAt:
        typeof window.resetsAt === "number" ? new Date(window.resetsAt * 1000).toISOString() : null,
    };
  };
  if (info.unifiedWindows) {
    put("fiveHour", info.unifiedWindows.five_hour);
    put("weekly", info.unifiedWindows.seven_day);
  } else if (info.rateLimitType === "five_hour") put("fiveHour", info);
  else if (info.rateLimitType === "seven_day") put("weekly", info);
  return Object.keys(usage).length ? { ...usage, at: at.toISOString() } : null;
}

// --- The weekly share -------------------------------------------------------------------
//
// Settings → Claude caps what the Build chat may use of the account's weekly limit. The
// turn comes with the share and what the chat has used in the current window
// (job.budget: { percent, spent, resetsAt }); during the session, the account's usage at
// each call says how much this turn has added. Same arithmetic as the console's
// (src/lib/agent.ts, turnWeeklySpend).

/** What the chat has used this week, counting this turn so far. */
export function weeklySpent(budget, before, after) {
  const a = after?.weekly;
  if (!a) return budget?.spent ?? 0;
  const base = budget?.resetsAt && a.resetsAt === budget.resetsAt ? budget.spent : 0;
  const b = before?.weekly;
  const delta = b && b.resetsAt === a.resetsAt ? Math.max(0, a.percent - b.percent) : 0;
  return Math.round((base + delta) * 10) / 10;
}

export function overBudget(budget, before, after) {
  return Boolean(budget?.percent > 0) && weeklySpent(budget, before, after) >= budget.percent;
}

/** "Friday at 07:00", in the console's time zone. */
export function resetLabel(resetsAt) {
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

/** Why a session was stopped when the share ran out under it. */
export function budgetStopMessage(budget, after) {
  const resetsAt = after?.weekly?.resetsAt ?? budget?.resetsAt ?? null;
  return `The Build chat has used its share of the Claude account's weekly limit (${budget.percent}% of it), so Claude was stopped here. What it had already saved is kept; the rest waits until ${resetLabel(resetsAt)}. The share is set in Settings → Claude.`;
}

/**
 * How the session ended: { ok, reply } or { ok: false, why }, why in words for the
 * person in the chat. `missingSession` when --resume named a session the server doesn't
 * have (a new server, or its files were cleaned up): the runner starts a new one.
 */
export function readResult({ result, code, stderr, timedOut, minutes, cancelled }) {
  if (cancelled) return { ok: false, why: "Stopped." };
  if (timedOut)
    return {
      ok: false,
      why: `Claude hadn't finished after ${minutes} minutes, so it was stopped.`,
    };
  if (result && !result.is_error && result.subtype === "success") {
    return { ok: true, reply: typeof result.result === "string" ? result.result : "" };
  }
  const said = [result?.result ?? "", ...(result?.errors ?? []), stderr ?? ""].join("\n");
  if (/No conversation found with session ID/i.test(said))
    return { ok: false, missingSession: true, why: said };
  if (code === 137) return { ok: false, why: "Claude ran out of memory on the build server." };
  if (
    /invalid (api key|bearer token|token)|authentication_error|failed to authenticate|oauth (token|session) (has )?(expired|revoked)|\b401\b/i.test(
      said,
    )
  ) {
    return {
      ok: false,
      rejected: true,
      why: "Claude no longer accepts the linked account. Link it again in Settings → Claude.",
    };
  }
  if (/usage limit|limit reached|hit your limit|rate.?limit/i.test(said)) {
    return {
      ok: false,
      why: "The Claude account has used up its limit for now. Try again when it resets.",
    };
  }
  if (result?.subtype === "error_max_turns") {
    return {
      ok: false,
      why: "Claude took too many steps on this message and was stopped. Ask it to carry on.",
    };
  }
  // An error the CLI reports in its result (is_error) says more than the exit code.
  const tail = oneLine(
    result?.is_error && typeof result.result === "string" && result.result.trim()
      ? result.result
      : String(stderr ?? "")
          .trim()
          .split("\n")
          .slice(-3)
          .join(" "),
    300,
  );
  return {
    ok: false,
    why: `Claude didn't finish properly${tail ? `: ${tail}` : ` (${result?.subtype ?? `exit ${code}`})`}.`,
  };
}

// --- What a turn may not change -------------------------------------------------------

// The native boundary of the game repos' AGENTS.md (templates/agent-docs/AGENTS.md):
// bgp-admin generates these, so a change to them is overwritten on the next sync and
// can break the store builds. Commits that touch them aren't pushed.
const PROTECTED = [
  /^capacitor\.config\.[^/]+$/,
  /^(ios|android)\//,
  /^\.github\/workflows\/(deploy[^/]*|preview-deploy)\.ya?ml$/,
];

export function protectedPaths(files) {
  return files.filter((file) => PROTECTED.some((rule) => rule.test(file)));
}

/** For changes Claude left uncommitted when it finished. */
export const LEFTOVER_COMMIT_MESSAGE = "Apply changes requested in the Build chat";

// --- What a session may leave in .git ----------------------------------------------------
//
// Claude's container, and the dependency install's, have the game's clone writable, .git
// included, as the same user as the server. The server runs git there afterwards and puts
// the config back, so it first checks that .git is what git itself makes.

/** Files git reads from somewhere else: the config, refs or objects of a folder they name. */
const ELSEWHERE = ["commondir", "objects/info/alternates"];

/**
 * Why a clone's .git can't be trusted, or null. It must be a folder of plain files and
 * folders. A link anywhere in it has git, or the server, write over whatever it points to,
 * like the Claude token (a fetch writes FETCH_HEAD through one, `git add` the index), and
 * `commondir` or `objects/info/alternates` would have git take its config from a folder the
 * session chose, where a filter runs any command.
 */
export function gitDirProblem(repoDir) {
  const gitDir = join(repoDir, ".git");
  const top = lstatSync(gitDir, { throwIfNoEntry: false });
  if (!top) return ".git is missing";
  if (top.isSymbolicLink()) return ".git is a link";
  if (!top.isDirectory()) return ".git isn't a folder";
  const folders = [""];
  while (folders.length) {
    const folder = folders.pop();
    let entries;
    try {
      entries = readdirSync(join(gitDir, folder), { withFileTypes: true });
    } catch {
      return `${folder ? `.git/${folder}` : ".git"} can't be read`;
    }
    for (const entry of entries) {
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) return `.git/${path} is a link`;
      if (ELSEWHERE.includes(path)) return `.git/${path} is there`;
      if (entry.isDirectory()) folders.push(path);
      else if (!entry.isFile()) return `.git/${path} isn't a plain file`;
    }
  }
  return null;
}

/**
 * Writes a new file where a container may have left anything: what's there (a file, a link,
 * a folder) is removed, and the new file can only be created, so nothing is written through
 * a link, not even one that appears in between. `writeFileSync` alone follows a link.
 */
export function replaceFile(path, content, options = {}) {
  rmSync(path, { recursive: true, force: true });
  writeFileSync(path, content, { ...options, flag: "wx" });
}

// --- Internet and keys (Settings → Claude) ----------------------------------------------
//
// Like the cloud environment of Claude Code on the web: sites the Build chat's sessions may
// reach besides the Claude API and npm, and variables (API keys) they get. Both live only
// on the build server (environment.json); the console sees the sites and the variables'
// names with their last four characters. The console checks them the same way
// (src/lib/agent.ts); these are checked again here.

/** What the egress proxy always allows. */
export const BUILT_IN_HOSTS = ["api.anthropic.com", "registry.npmjs.org"];

/**
 * A site as written in the settings ("api.openai.com", "*.openai.com" for its subdomains
 * and itself), from what someone pasted: a URL, a host with a port, a trailing dot. Null
 * for what isn't a public host name: IP addresses, localhost, the home network's names.
 */
export function domainRule(text) {
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
  // At least two labels, the last one starting with a letter: no IPs, no single names
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/.test(value))
    return null;
  if (/\.(local|localhost|lan|home|internal|arpa|test|invalid)$/.test(value)) return null;
  return wildcard ? `*.${value}` : value;
}

export const MAX_DOMAINS = 50;
export const MAX_VARIABLES = 50;
export const MAX_VARIABLE_CHARS = 4000;

/**
 * Names the build server sets itself, or that change how Claude Code, git, Node or the
 * proxy behave: a pasted variable never replaces them.
 */
const RESERVED_VARIABLE =
  /^(HOME|PATH|SHELL|USER|TZ|LANG|LC_\w+|NODE_OPTIONS|NODE_PATH|BUN_\w+|NPM_CONFIG_\w+|LD_\w+|DYLD_\w+|\w*_PROXY|CLAUDE\w*|ANTHROPIC\w*|GIT_\w+|SSH_\w+|DISABLE_\w+)$/i;

export function variableProblem(name, value = "") {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(name)) return "isn't a valid variable name";
  if (RESERVED_VARIABLE.test(name)) return "is set by the build server itself";
  if (/[\r\n\0]/.test(value)) return "has a line break in its value";
  if (value.length > MAX_VARIABLE_CHARS) return "is too long";
  return null;
}

/**
 * The environment after a change from the console: `domains` replaces the sites (when
 * given), `addDomains` and `removeDomains` add and take out some (connecting a service in
 * Settings → Claude), `set` adds or replaces variables, `remove` deletes them. What
 * doesn't pass the checks is left out, and said in `skipped`.
 */
export function applyEnvironmentChange(current, change, { at, by } = {}) {
  const skipped = [];
  let domains = Array.isArray(change?.domains) ? [] : [...(current?.domains ?? [])];
  const add = [
    ...(Array.isArray(change?.domains) ? change.domains : []),
    ...(Array.isArray(change?.addDomains) ? change.addDomains : []),
  ];
  for (const raw of add) {
    const rule = domainRule(raw);
    if (!rule) skipped.push(`${String(raw).slice(0, 60)}: isn't a public site`);
    else if (!BUILT_IN_HOSTS.includes(rule) && !domains.includes(rule)) domains.push(rule);
  }
  const takeOut = (Array.isArray(change?.removeDomains) ? change.removeDomains : [])
    .map(domainRule)
    .filter(Boolean);
  domains = domains.filter((domain) => !takeOut.includes(domain));
  const variables = { ...(current?.variables ?? {}) };
  for (const name of Array.isArray(change?.remove) ? change.remove : []) delete variables[name];
  for (const [name, raw] of Object.entries(change?.set ?? {})) {
    const value = String(raw ?? "");
    const problem = variableProblem(name, value);
    if (problem) skipped.push(`${name}: ${problem}`);
    else if (value) variables[name] = value;
    else delete variables[name];
  }
  if (domains.length > MAX_DOMAINS) throw new Error(`At most ${MAX_DOMAINS} sites.`);
  if (Object.keys(variables).length > MAX_VARIABLES)
    throw new Error(`At most ${MAX_VARIABLES} keys.`);
  return {
    environment: { domains, variables, updatedAt: at ?? null, updatedBy: by ?? null },
    skipped,
  };
}

/** What the console may know about the environment: never a value. */
export function environmentSummary(environment) {
  const variables = Object.entries(environment?.variables ?? {})
    .map(([name, value]) => ({ name, last4: String(value).slice(-4) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    domains: environment?.domains ?? [],
    variables,
    updatedAt: environment?.updatedAt ?? null,
    updatedBy: environment?.updatedBy ?? null,
  };
}

/**
 * The variables whose value shows up in `text` (the patch of what Claude is about to
 * push). Short values ("1", "true", a model name) aren't keys and are left alone.
 */
export const SECRET_MIN_CHARS = 20;
export function secretsIn(text, variables) {
  return Object.entries(variables ?? {})
    .filter(([, value]) => String(value).length >= SECRET_MIN_CHARS && text.includes(value))
    .map(([name]) => name);
}

/** The longest value secretsIn looks for: how much of a stream to keep between chunks. */
export function longestSecret(variables) {
  return Math.max(
    0,
    ...Object.values(variables ?? {})
      .map((value) => String(value).length)
      .filter((length) => length >= SECRET_MIN_CHARS),
  );
}

// --- Memory -----------------------------------------------------------------------------

/** A Docker memory size ("1200m", "2g") in megabytes. */
export function megabytes(size) {
  const match = /^(\d+(?:\.\d+)?)\s*([kmg]?)b?$/i.exec(String(size).trim());
  if (!match) return null;
  const scale = { k: 1 / 1024, "": 1 / 1024 / 1024, m: 1, g: 1024 }[match[2].toLowerCase()];
  return Math.round(Number(match[1]) * scale);
}

/** What the machine can still hand out without swapping (MemAvailable in /proc/meminfo), in megabytes. */
export function availableMegabytes(meminfo) {
  const kb = /^MemAvailable:\s+(\d+)\s*kB/m.exec(String(meminfo))?.[1];
  return kb ? Math.floor(Number(kb) / 1024) : null;
}

/** A size as `docker stats` prints it ("512.3MiB", "1.17GiB", "980kB") in megabytes. */
export function dockerMegabytes(size) {
  const match = /^(\d+(?:\.\d+)?)\s*([kmg]?)(i?)b$/i.exec(String(size).trim());
  if (!match) return null;
  const base = match[3] ? 1024 : 1000;
  const power = { "": 0, k: 1, m: 2, g: 3 }[match[2].toLowerCase()];
  return Math.round((Number(match[1]) * base ** power) / 1024 / 1024);
}

/**
 * How much memory each container is using, from `docker stats --no-stream --format
 * "{{.Name}}\t{{.MemUsage}}"` ("bgp-agent-turn-… <tab> 512MiB / 1.172GiB" per line).
 */
export function containerMemory(statsOutput) {
  const used = {};
  for (const line of String(statsOutput ?? "").split("\n")) {
    const [name, usage] = line.split("\t");
    const megabytes = dockerMegabytes(String(usage ?? "").split("/")[0]);
    if (name?.trim() && megabytes !== null) used[name.trim()] = megabytes;
  }
  return used;
}

/**
 * Whether one more message may start while others run. Each running message may still grow
 * to its whole limit, so what it hasn't used yet counts as taken: the machine must have room
 * for all of them at their limit plus the new one, and still `minFreeMb` for the new one.
 * `used` is what the running messages' containers use now (0 for one that has none yet).
 */
export function roomForAnotherTurn({ availableMb, limitMb, minFreeMb, used }) {
  if (availableMb === null || availableMb === undefined) return true;
  const stillToGrow = used.reduce((sum, mb) => sum + Math.max(0, limitMb - (Number(mb) || 0)), 0);
  return availableMb - stillToGrow >= minFreeMb;
}

// --- Several messages at once ----------------------------------------------------------------

/** The container a message's Claude session runs in; the egress proxy knows it by this name. */
export const TURN_CONTAINER_PREFIX = "bgp-agent-turn-";
export const turnContainer = (turnId) =>
  `${TURN_CONTAINER_PREFIX}${String(turnId)
    .toLowerCase()
    .replace(/[^\w-]/g, "")}`;
/** The one `bun install` runs in, before the session: it never gets the extra sites. */
export const installContainer = (turnId) =>
  `bgp-agent-install-${String(turnId)
    .toLowerCase()
    .replace(/[^\w-]/g, "")}`;
/** Containers of messages a previous run of the service left behind (also v5's single one). */
export const isLeftoverContainer = (name) =>
  /^bgp-agent-(turn|install)(-[\w-]+)?$/.test(String(name).trim());

/**
 * Where a message measures the weekly share from. Messages that run at the same time all
 * raise the same account usage, so a message that starts while others run measures from
 * the earliest of their starting points (same weekly window): what they use together is
 * then counted once, and they all stop when the share runs out. `others` are the starting
 * points of the messages running now.
 */
export function budgetBaseline(usage, others = []) {
  const window = usage?.weekly?.resetsAt;
  const earlier = others
    .filter((o) => o?.weekly && window && o.weekly.resetsAt === window)
    .sort((a, b) => a.weekly.percent - b.weekly.percent)[0];
  return earlier && earlier.weekly.percent < usage.weekly.percent ? earlier : usage;
}

// --- Linking an account: `claude setup-token` in a pseudo-terminal ---------------------

// What a terminal shows, without colour or cursor codes (the CLI writes spaces by moving
// the cursor).
export function plainText(raw) {
  return String(raw)
    .replace(/\x1b\[\d*C/g, " ")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b\[[0-9;?<>=]*[a-zA-Z~]/g, "")
    .replace(/\x1b[()][A-Z0-9]/g, "")
    .replace(/\r/g, "");
}

/** The claude.ai link to sign in at. */
export function loginUrl(text) {
  return (
    /https:\/\/claude\.(?:com|ai)\/[\w/]*oauth\/authorize\?[\w%&=.~-]+/.exec(text)?.[0] ?? null
  );
}

/** The year-long token it prints once the code is accepted. */
export function loginToken(text) {
  return /sk-ant-oat\d+-[A-Za-z0-9_-]{20,}/.exec(text)?.[0] ?? null;
}

/** Or why it didn't print one (a wrong or expired code). */
export function loginError(text) {
  const said = /(OAuth error|Error)[^\n]*/i.exec(text)?.[0];
  return said ? oneLine(said.replace(/Press Enter to retry\.?/i, ""), 300) : null;
}

/** Whether a pasted token looks like one `claude setup-token` makes. */
export function isClaudeToken(token) {
  return /^sk-ant-oat\d+-[A-Za-z0-9_-]{20,}$/.test(String(token ?? "").trim());
}
