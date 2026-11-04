// What the build server works out without talking to anyone: the arguments and the
// instructions the Claude CLI gets, how its stream-json output becomes the chat's events,
// what a finished session means, and what a turn may not change. Kept apart from
// runner.mjs so it can be tested (lib.test.mjs).

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
  return [
    "You are working inside the Build chat of the BGP Console (bgp-admin). The person writing to you builds this game from a chat in their browser, with the game's live preview next to it. They are not a programmer and never see a terminal.",
    "",
    "How this environment works:",
    `- You run in a sandboxed container on the build server, in a clone of the game's repository (${job.repo.owner}/${job.repo.name}) on the branch \`${job.branch}\`. You can reach the Claude API and the npm registry, nothing else: no GitHub, no other websites.`,
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
    "--max-turns",
    String(maxTurns),
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
    "--max-turns",
    String(maxTurns),
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
