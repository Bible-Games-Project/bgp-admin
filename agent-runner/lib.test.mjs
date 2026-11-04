import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  assistantArgs,
  availableMegabytes,
  budgetStopMessage,
  claudeArgs,
  eventsFrom,
  isClaudeToken,
  loginError,
  loginToken,
  loginUrl,
  megabytes,
  overBudget,
  parseLine,
  pingArgs,
  plainText,
  promptWithAttachments,
  protectedPaths,
  readResult,
  safeFileName,
  stepLabel,
  systemPrompt,
  uniqueFileName,
  usageFrom,
  weeklySpent,
} from "./lib.mjs";
import { isAllowedHost, parseTarget } from "./egress.mjs";

// A real session of Claude Code 2.1.316 (stream-json), paths moved to /work.
const stream = readFileSync(new URL("./fixtures/stream.jsonl", import.meta.url), "utf8")
  .split("\n")
  .map(parseLine)
  .filter(Boolean);

const job = {
  repo: { owner: "Bible-Games-Project", name: "bible-rpg" },
  branch: "main",
  previewUrl: "https://bgp-bible-rpg.pages.dev",
};

describe("eventsFrom", () => {
  test("turns a real session into steps and text", () => {
    const events = stream.flatMap((message) => eventsFrom(message));
    expect(
      events.map((e) => (e.kind === "step" ? e.body.label : `text: ${e.body.text.slice(0, 20)}`)),
    ).toEqual([
      "Read package.json",
      "List files in the working directory",
      "Read notes.txt",
      "Edited notes.txt",
      expect.stringMatching(/^Stage/),
      expect.stringMatching(/^text: I changed `notes/),
    ]);
  });

  test("ignores everything that isn't Claude speaking or acting", () => {
    expect(eventsFrom({ type: "user", message: { content: [{ type: "tool_result" }] } })).toEqual(
      [],
    );
    expect(
      eventsFrom({ type: "assistant", message: { content: [{ type: "thinking", thinking: "" }] } }),
    ).toEqual([]);
    expect(eventsFrom(null)).toEqual([]);
  });

  test("keeps the plan of a TodoWrite", () => {
    const [event] = eventsFrom({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "TodoWrite",
            input: { todos: [{ content: "Add a level", status: "pending", activeForm: "x" }] },
          },
        ],
      },
    });
    expect(event.body).toEqual({
      tool: "TodoWrite",
      label: "Updated the plan",
      todos: [{ content: "Add a level", status: "pending" }],
    });
  });
});

test("assistantArgs: no built-in tools, the console's through MCP, the console's instructions", () => {
  const args = assistantArgs({
    prompt: "What needs attention?",
    model: "claude-opus-5-5",
    effort: "medium",
    sessionId: "abc",
    maxTurns: 50,
    systemPrompt: "You are Ruben.",
    mcpConfig: "/home/agent/mcp.json",
  });
  expect(args[args.indexOf("--tools") + 1]).toBe("");
  expect(args[args.indexOf("--mcp-config") + 1]).toBe("/home/agent/mcp.json");
  expect(args).toContain("--strict-mcp-config");
  expect(args[args.indexOf("--append-system-prompt") + 1]).toBe("You are Ruben.");
  expect(args[args.indexOf("--resume") + 1]).toBe("abc");
  expect(args).not.toContain("--disallowedTools");
});

test("stepLabel", () => {
  expect(stepLabel("mcp__console__home", {})).toBe("Looked at Home");
  expect(stepLabel("mcp__console__revenue", {})).toBe("Read the revenue");
  expect(stepLabel("mcp__console__later", {})).toBe("Read later");
  expect(stepLabel("Write", { file_path: "/work/src/levels/two.ts" })).toBe(
    "Wrote src/levels/two.ts",
  );
  expect(stepLabel("Bash", { command: "bun run build" })).toBe("Ran bun run build");
  expect(stepLabel("Grep", { pattern: "playerSpeed" })).toBe("Searched the code for “playerSpeed”");
  expect(stepLabel("mcp__x__y", {})).toBe("Used mcp__x__y");
});

describe("readResult", () => {
  const result = stream.find((l) => l.type === "result");

  test("a finished session gives Claude's reply", () => {
    expect(readResult({ result, code: 0, stderr: "" })).toEqual({ ok: true, reply: result.result });
  });

  test("resuming a session the server doesn't have", () => {
    const missing = {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      errors: ["No conversation found with session ID: 0000"],
    };
    expect(readResult({ result: missing, code: 1, stderr: "" })).toMatchObject({
      ok: false,
      missingSession: true,
    });
  });

  test("says why in words for the chat", () => {
    expect(
      readResult({ result: null, code: 1, stderr: "API Error: 401 authentication_error" }),
    ).toMatchObject({ rejected: true });
    // What Claude Code 2.1.316 printed with an expired login: a "success" result with is_error.
    const expired = {
      type: "result",
      subtype: "success",
      is_error: true,
      result: "Failed to authenticate: OAuth session expired and could not be refreshed",
    };
    expect(readResult({ result: expired, code: 1, stderr: "" })).toMatchObject({
      ok: false,
      rejected: true,
    });
    expect(
      readResult({
        result: { subtype: "success", is_error: true, result: "Something odd" },
        code: 1,
      }).why,
    ).toBe("Claude didn't finish properly: Something odd.");
    expect(readResult({ result: null, code: 137, stderr: "" }).why).toContain("memory");
    expect(
      readResult({ result: null, code: null, stderr: "", timedOut: true, minutes: 30 }).why,
    ).toContain("30 minutes");
    expect(readResult({ result: null, code: 143, stderr: "", cancelled: true }).why).toBe(
      "Stopped.",
    );
    expect(
      readResult({ result: { subtype: "error_max_turns", is_error: true }, code: 1 }).why,
    ).toContain("too many steps");
  });
});

test("usageFrom reads both windows", () => {
  const info = stream.find((l) => l.type === "rate_limit_event").rate_limit_info;
  const at = new Date("2026-11-02T20:00:00Z");
  expect(usageFrom(info, at)).toEqual({
    weekly: { percent: 54, resetsAt: "2026-11-06T06:00:00.000Z" },
    at: at.toISOString(),
  });
  expect(
    usageFrom({ unifiedWindows: { five_hour: { utilization: 0.123, resetsAt: null } } }, at)
      .fiveHour,
  ).toEqual({ percent: 12.3, resetsAt: null });
  expect(usageFrom(null)).toBeNull();
});

describe("claudeArgs", () => {
  test("resumes the chat's session and never carries the token", () => {
    const args = claudeArgs({
      prompt: "Hazlo azul",
      model: "claude-opus-5-5",
      effort: "medium",
      sessionId: "abc",
      maxTurns: 200,
      job,
    });
    expect(args.slice(0, 2)).toEqual(["-p", "Hazlo azul"]);
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args[args.indexOf("--resume") + 1]).toBe("abc");
    expect(args[args.indexOf("--effort") + 1]).toBe("medium");
    expect(args.join(" ")).not.toContain("sk-ant");
  });

  test("a first message starts a new session", () => {
    expect(
      claudeArgs({ prompt: "x", model: "m", sessionId: null, maxTurns: 1, job }),
    ).not.toContain("--resume");
  });
});

test("pingArgs is one word from a small model with nothing else", () => {
  const args = pingArgs("claude-haiku-5-5");
  expect(args[args.indexOf("--model") + 1]).toBe("claude-haiku-5-5");
  expect(args[args.indexOf("--max-turns") + 1]).toBe("1");
  expect(args[args.indexOf("--tools") + 1]).toBe("");
  expect(args).toContain("--system-prompt");
  expect(args).toContain("stream-json");
  expect(args).not.toContain("--dangerously-skip-permissions");
});

test("systemPrompt says how this environment differs", () => {
  const text = systemPrompt(job);
  expect(text).toContain("Don't push");
  expect(text).toContain("https://bgp-bible-rpg.pages.dev");
  expect(text).toContain("/attachments");
  expect(systemPrompt({ ...job, previewUrl: null })).toContain("no Cloudflare preview");
  expect(systemPrompt({ ...job, attachmentsDir: "/tmp/att" })).toContain("/tmp/att");
});

describe("attachments", () => {
  test("the message lists the files where Claude finds them", () => {
    const files = [
      { name: "logo.png", contentType: "image/png", size: 120 * 1024 },
      { name: "brief.pdf", contentType: "application/pdf", size: 2 * 1024 * 1024 },
    ];
    const prompt = promptWithAttachments("Use this logo", files);
    expect(prompt.startsWith("Use this logo\n\nAttached files")).toBe(true);
    expect(prompt).toContain("- /attachments/logo.png (image, 120 KB)");
    expect(prompt).toContain("- /attachments/brief.pdf (PDF, 2 MB)");
    expect(promptWithAttachments("x", [files[0]], "/tmp/a")).toContain(
      "Attached file (read it with the Read tool):\n- /tmp/a/logo.png",
    );
    expect(promptWithAttachments("x", [])).toBe("x");
  });

  test("file names are safe and unique", () => {
    expect(safeFileName("../../etc/passwd")).toBe("etc-passwd");
    expect(safeFileName("Foto de perfil (1).JPG")).toBe("Foto-de-perfil-1-.JPG");
    expect(uniqueFileName("logo.png", ["logo.png", "logo-2.png"])).toBe("logo-3.png");
    expect(uniqueFileName("notes", ["notes"])).toBe("notes-2");
    expect(uniqueFileName("logo.png", [])).toBe("logo.png");
  });
});

describe("the weekly share", () => {
  const window = "2026-11-06T06:00:00.000Z";
  const at = (percent, resetsAt = window) => ({ weekly: { percent, resetsAt } });
  const budget = { percent: 10, spent: 8, resetsAt: window };

  test("counts what the chat used before plus this turn so far", () => {
    expect(weeklySpent(budget, at(54), at(55))).toBe(9);
    expect(overBudget(budget, at(54), at(55))).toBe(false);
    expect(overBudget(budget, at(54), at(56))).toBe(true);
    // A share that was already used up stops the turn at its first call.
    expect(overBudget({ ...budget, spent: 10 }, at(54), at(54))).toBe(true);
  });

  test("a new window starts from nothing, and no share means no stop", () => {
    const next = "2026-11-13T06:00:00.000Z";
    expect(weeklySpent(budget, at(99), at(1, next))).toBe(0);
    expect(weeklySpent({ ...budget, resetsAt: null }, at(1, next), at(3, next))).toBe(2);
    expect(overBudget({ percent: 0, spent: 50, resetsAt: window }, at(1), at(99))).toBe(false);
    expect(overBudget(null, at(1), at(99))).toBe(false);
    expect(weeklySpent(budget, null, null)).toBe(8);
  });

  test("says why it stopped and when it resets", () => {
    const why = budgetStopMessage(budget, at(56));
    expect(why).toContain("10% of it");
    expect(why).toContain("Friday at 07:00");
    expect(why).toContain("Settings → Claude");
  });
});

test("protectedPaths is the native boundary", () => {
  expect(
    protectedPaths([
      "src/main.ts",
      "capacitor.config.ts",
      "ios/App/Info.plist",
      "android/app/build.gradle",
      ".github/workflows/preview-deploy.yml",
      ".github/workflows/deploy.yml",
      ".github/workflows/lint.yml",
      "src/ios/thing.ts",
    ]),
  ).toEqual([
    "capacitor.config.ts",
    "ios/App/Info.plist",
    "android/app/build.gradle",
    ".github/workflows/preview-deploy.yml",
    ".github/workflows/deploy.yml",
  ]);
});

describe("setup-token output", () => {
  const screen =
    "\x1b[2J\x1b[1mBrowser didn't open? Use the url below to sign in:\x1b[0m\r\n\r\nhttps://claude.ai/oauth/authorize?code=true&client_id=9d1c&response_type=code&scope=user%3Ainference&state=Xy_z\r\n\r\nPaste code here if prompted >";
  test("finds the link, the token and errors", () => {
    expect(loginUrl(plainText(screen))).toBe(
      "https://claude.ai/oauth/authorize?code=true&client_id=9d1c&response_type=code&scope=user%3Ainference&state=Xy_z",
    );
    const token = `sk-ant-oat01-${"Ab9_-".repeat(20)}`;
    expect(
      loginToken(
        plainText(`\x1b[32m✓ Long-lived authentication token created:\x1b[0m\r\n${token}\r\n`),
      ),
    ).toBe(token);
    expect(loginError("OAuth error: invalid code. Press Enter to retry.")).toBe(
      "OAuth error: invalid code.",
    );
    expect(isClaudeToken(token)).toBe(true);
    expect(isClaudeToken("sk-ant-oat01-short")).toBe(false);
  });
});

test("summarizing the conversation shows as one step", () => {
  // What Claude Code 2.1.316 prints around a compaction (stream-json)
  const lines = [
    { type: "system", subtype: "status", status: "compacting", session_id: "s" },
    { type: "system", subtype: "status", status: null, compact_result: "success" },
    {
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: { trigger: "auto", pre_tokens: 181000, post_tokens: 12102 },
    },
    {
      type: "user",
      message: { role: "user", content: "This session is being continued from a previous …" },
    },
  ];
  expect(lines.flatMap((line) => eventsFrom(line))).toEqual([
    {
      kind: "step",
      body: { tool: "compact", label: "Summarized the conversation so far, to keep it short" },
    },
  ]);
});

test("memory sizes and what the machine has free", () => {
  expect(megabytes("1200m")).toBe(1200);
  expect(megabytes("2g")).toBe(2048);
  expect(megabytes("512M")).toBe(512);
  expect(megabytes("lots")).toBeNull();
  const meminfo =
    "MemTotal:        4003124 kB\nMemFree:          115712 kB\nMemAvailable:    1884160 kB\n";
  expect(availableMegabytes(meminfo)).toBe(1840);
  expect(availableMegabytes("MemTotal: 1 kB")).toBeNull();
});

test("egress only to the Claude API and npm, over TLS", () => {
  expect(isAllowedHost("api.anthropic.com")).toBe(true);
  expect(isAllowedHost("registry.npmjs.org.")).toBe(true);
  expect(isAllowedHost("github.com")).toBe(false);
  expect(isAllowedHost("evil-api.anthropic.com")).toBe(false);
  expect(parseTarget("api.anthropic.com:443")).toEqual({ host: "api.anthropic.com", port: 443 });
  expect(parseTarget("http://x")).toBeNull();
});
