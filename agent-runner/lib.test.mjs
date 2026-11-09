import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyEnvironmentChange,
  assistantArgs,
  availableMegabytes,
  budgetBaseline,
  budgetStopMessage,
  claudeArgs,
  commitLeftoversCommand,
  containerMemory,
  dockerMegabytes,
  domainRule,
  environmentSummary,
  eventsFrom,
  gitDirProblem,
  installContainer,
  isClaudeToken,
  isLeftoverContainer,
  loginError,
  loginToken,
  loginUrl,
  longestSecret,
  megabytes,
  overBudget,
  parseLine,
  pingArgs,
  plainText,
  promptWithAttachments,
  protectedPaths,
  readResult,
  replaceFile,
  roomForAnotherTurn,
  safeFileName,
  secretsIn,
  stepLabel,
  systemPrompt,
  turnContainer,
  uniqueFileName,
  usageFrom,
  variableProblem,
  weeklySpent,
} from "./lib.mjs";
import {
  hostsFromFile,
  isAllowedHost,
  isPrivateAddress,
  parseTarget,
  turnContainerFrom,
} from "./egress.mjs";

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
  expect(args[args.indexOf("--max-turns") + 1]).toBe("50");
  expect(
    assistantArgs({ prompt: "x", model: "m", maxTurns: 0, systemPrompt: "", mcpConfig: "/m.json" }),
  ).not.toContain("--max-turns");
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

  test("no step limit unless one is set", () => {
    expect(
      claudeArgs({ prompt: "x", model: "m", sessionId: null, maxTurns: 0, job }),
    ).not.toContain("--max-turns");
    const capped = claudeArgs({ prompt: "x", model: "m", sessionId: null, maxTurns: 200, job });
    expect(capped[capped.indexOf("--max-turns") + 1]).toBe("200");
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

describe("what a session may leave in .git", () => {
  const scratch = mkdtempSync(join(tmpdir(), "bgp-agent-test-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  // A file of the server's, like STATE_DIR/claude.json, that a link in the clone points to
  const token = join(scratch, "claude.json");
  writeFileSync(token, '{"token":"sk-ant-oat-example"}');
  let count = 0;
  const clone = () => {
    const dir = join(scratch, `repo-${++count}`);
    execFileSync("git", ["init", "-q", dir]);
    writeFileSync(join(dir, ".git", "FETCH_HEAD"), "");
    return dir;
  };

  test("a clone as git makes it is fine", () => {
    expect(gitDirProblem(clone())).toBeNull();
  });

  test("a link anywhere in .git is not", () => {
    let dir = clone();
    rmSync(join(dir, ".git", "config"));
    symlinkSync(token, join(dir, ".git", "config"));
    expect(gitDirProblem(dir)).toBe(".git/config is a link");

    dir = clone();
    symlinkSync(join(scratch, "missing"), join(dir, ".git", "refs", "heads", "main"));
    expect(gitDirProblem(dir)).toBe(".git/refs/heads/main is a link");

    dir = clone();
    rmSync(join(dir, ".git", "FETCH_HEAD"));
    symlinkSync(token, join(dir, ".git", "FETCH_HEAD"));
    expect(gitDirProblem(dir)).toBe(".git/FETCH_HEAD is a link");
  });

  test(".git itself has to be a folder", () => {
    let dir = clone();
    rmSync(join(dir, ".git"), { recursive: true });
    expect(gitDirProblem(dir)).toBe(".git is missing");
    symlinkSync(join(clone(), ".git"), join(dir, ".git"));
    expect(gitDirProblem(dir)).toBe(".git is a link");

    dir = clone();
    rmSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, ".git"), `gitdir: ${join(scratch, "elsewhere")}\n`);
    expect(gitDirProblem(dir)).toBe(".git isn't a folder");
  });

  test("nothing that has git read from another folder, and only plain files", () => {
    let dir = clone();
    writeFileSync(join(dir, ".git", "commondir"), "../somewhere\n");
    expect(gitDirProblem(dir)).toBe(".git/commondir is there");

    dir = clone();
    writeFileSync(join(dir, ".git", "objects", "info", "alternates"), "/elsewhere/objects\n");
    expect(gitDirProblem(dir)).toBe(".git/objects/info/alternates is there");

    dir = clone();
    execFileSync("mkfifo", [join(dir, ".git", "ORIG_HEAD")]);
    expect(gitDirProblem(dir)).toBe(".git/ORIG_HEAD isn't a plain file");
  });

  // Root reads any folder, so this only means something as another user (the server's is)
  test.skipIf(process.getuid?.() === 0)("a folder it can't read counts as a problem", () => {
    const dir = clone();
    const objects = join(dir, ".git", "objects");
    chmodSync(objects, 0o000);
    try {
      expect(gitDirProblem(dir)).toBe(".git/objects can't be read");
    } finally {
      chmodSync(objects, 0o755);
    }
  });

  test("replaceFile never writes through what's there", () => {
    const dir = clone();
    const config = join(dir, ".git", "config");
    rmSync(config);
    symlinkSync(token, config);
    replaceFile(config, "[core]\n");
    expect(readFileSync(token, "utf8")).toBe('{"token":"sk-ant-oat-example"}');
    expect(lstatSync(config).isFile()).toBe(true);
    expect(readFileSync(config, "utf8")).toBe("[core]\n");

    const folder = join(dir, "mcp.json");
    mkdirSync(join(folder, "inside"), { recursive: true });
    replaceFile(folder, "{}", { mode: 0o600 });
    expect(readFileSync(folder, "utf8")).toBe("{}");
    expect(statSync(folder).mode & 0o777).toBe(0o600);
  });

  test("what Claude left uncommitted becomes one commit, and nothing else does", () => {
    const dir = clone();
    const env = {
      PATH: process.env.PATH,
      HOME: scratch,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Build chat",
      GIT_AUTHOR_EMAIL: "build-chat@localhost",
      GIT_COMMITTER_NAME: "Build chat",
      GIT_COMMITTER_EMAIL: "build-chat@localhost",
    };
    const [command, ...args] = commitLeftoversCommand();
    const commit = () => execFileSync(command, args, { cwd: dir, env });
    const log = () =>
      execFileSync("git", ["log", "--format=%s"], { cwd: dir, env, encoding: "utf8" }).trim();
    writeFileSync(join(dir, "game.txt"), "v1\n");
    commit();
    expect(log()).toBe("Apply changes requested in the Build chat");
    // Nothing left: no empty commit, and it doesn't fail
    commit();
    expect(log()).toBe("Apply changes requested in the Build chat");
    writeFileSync(join(dir, "game.txt"), "v2\n");
    commit();
    expect(log().split("\n")).toHaveLength(2);
  });
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

test("the egress proxy adds the sites of Settings → Claude, and never a private address", () => {
  const allow = ["api.anthropic.com", ...hostsFromFile("api.openai.com\n*.elevenlabs.io\n\n")];
  expect(isAllowedHost("api.openai.com", allow)).toBe(true);
  expect(isAllowedHost("openai.com", allow)).toBe(false);
  expect(isAllowedHost("api.elevenlabs.io", allow)).toBe(true);
  expect(isAllowedHost("elevenlabs.io", allow)).toBe(true);
  expect(isAllowedHost("elevenlabs.io.evil.com", allow)).toBe(false);
  for (const address of [
    "192.168.1.24",
    "10.0.0.1",
    "127.0.0.1",
    "172.18.0.2",
    "169.254.169.254",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:192.168.1.24",
    "100.100.1.1",
  ])
    expect(isPrivateAddress(address)).toBe(true);
  for (const address of ["104.18.6.192", "160.79.104.10", "2606:4700::6812:6c0", "172.67.1.1"])
    expect(isPrivateAddress(address)).toBe(false);
});

describe("internet and keys", () => {
  test("a site is kept as a public host name, whatever was pasted", () => {
    expect(domainRule("https://api.openai.com/v1/images")).toBe("api.openai.com");
    expect(domainRule("API.OpenAI.com:443")).toBe("api.openai.com");
    expect(domainRule("*.elevenlabs.io")).toBe("*.elevenlabs.io");
    expect(domainRule(".elevenlabs.io")).toBe("*.elevenlabs.io");
    expect(domainRule("fonts.googleapis.com.")).toBe("fonts.googleapis.com");
    for (const bad of [
      "192.168.1.24",
      "localhost",
      "intranet",
      "nas.local",
      "*",
      "*.com",
      "",
      "http://[::1]/",
    ])
      expect(domainRule(bad)).toBeNull();
  });

  test("variables can't replace what the build server sets", () => {
    expect(variableProblem("OPENAI_API_KEY", "sk-x")).toBeNull();
    expect(variableProblem("ELEVENLABS_API_KEY", "x")).toBeNull();
    for (const name of [
      "CLAUDE_CODE_OAUTH_TOKEN",
      "ANTHROPIC_BASE_URL",
      "HTTPS_PROXY",
      "no_proxy",
      "PATH",
      "HOME",
      "NODE_OPTIONS",
      "GIT_SSH_COMMAND",
      "LD_PRELOAD",
    ])
      expect(variableProblem(name, "x")).toBe("is set by the build server itself");
    expect(variableProblem("1KEY", "x")).toBe("isn't a valid variable name");
    expect(variableProblem("KEY", "a\nb")).toBe("has a line break in its value");
  });

  test("a change replaces the sites, sets and removes keys, and says what it left out", () => {
    const current = { domains: ["old.example.com"], variables: { A_KEY: "aaaa", GONE: "x" } };
    const { environment, skipped } = applyEnvironmentChange(
      current,
      {
        domains: ["api.openai.com", "api.anthropic.com", "192.168.1.24", "api.openai.com"],
        set: { OPENAI_API_KEY: "sk-proj-123456789", CLAUDE_CODE_OAUTH_TOKEN: "nope", A_KEY: "" },
        remove: ["GONE"],
      },
      { at: "2026-11-05T12:00:00Z", by: "joan@example.com" },
    );
    expect(environment.domains).toEqual(["api.openai.com"]);
    expect(environment.variables).toEqual({ OPENAI_API_KEY: "sk-proj-123456789" });
    expect(skipped).toEqual([
      "192.168.1.24: isn't a public site",
      "CLAUDE_CODE_OAUTH_TOKEN: is set by the build server itself",
    ]);
    // Without domains in the change, the sites stay
    expect(applyEnvironmentChange(current, { set: {} }).environment.domains).toEqual([
      "old.example.com",
    ]);
  });

  test("connecting a service adds its site, disconnecting takes it out", () => {
    const current = { domains: ["old.example.com"], variables: {} };
    const connected = applyEnvironmentChange(current, {
      addDomains: ["api.openai.com", "old.example.com"],
      set: { OPENAI_API_KEY: "sk-proj-123456789" },
    }).environment;
    expect(connected.domains).toEqual(["old.example.com", "api.openai.com"]);
    const gone = applyEnvironmentChange(connected, {
      removeDomains: ["api.openai.com"],
      remove: ["OPENAI_API_KEY"],
    }).environment;
    expect(gone).toMatchObject({ domains: ["old.example.com"], variables: {} });
  });

  test("the console only learns names and last four characters", () => {
    const summary = environmentSummary({
      domains: ["api.openai.com"],
      variables: { OPENAI_API_KEY: "sk-proj-abcdefWXYZ", B: "1" },
    });
    expect(summary.variables).toEqual([
      { name: "B", last4: "1" },
      { name: "OPENAI_API_KEY", last4: "WXYZ" },
    ]);
    expect(JSON.stringify(summary)).not.toContain("abcdef");
  });

  test("a key in the commits is found, short values aren't taken for keys", () => {
    const variables = { OPENAI_API_KEY: "sk-proj-0123456789abcdefghij", MODEL: "gpt-image-1" };
    const patch = '+const key = "sk-proj-0123456789abcdefghij";\n+const model = "gpt-image-1";';
    expect(secretsIn(patch, variables)).toEqual(["OPENAI_API_KEY"]);
    expect(secretsIn("+nothing here", variables)).toEqual([]);
    expect(longestSecret(variables)).toBe(28);
    expect(longestSecret({ MODEL: "gpt-image-1" })).toBe(0);
  });

  test("Claude is told which sites and keys it has, and where more come from", () => {
    const plain = systemPrompt(job);
    expect(plain).toContain("the Claude API and the npm registry, nothing else");
    expect(plain).toContain("Settings → Claude → Internet and keys");
    const text = systemPrompt({
      ...job,
      environment: { domains: ["api.openai.com"], variables: ["OPENAI_API_KEY"] },
    });
    expect(text).toContain("api.openai.com");
    expect(text).toContain("OPENAI_API_KEY");
    expect(text).toContain("Never write a key into a file");
  });
});

describe("several messages at once", () => {
  const window = "2026-11-06T06:00:00.000Z";
  const at = (percent, resetsAt = window) => ({ weekly: { percent, resetsAt } });

  test("each message has its own container, which the egress proxy recognizes", () => {
    const id = "6F1C2A4E-0B7d-4c1e-9a55-1234567890ab";
    expect(turnContainer(id)).toBe("bgp-agent-turn-6f1c2a4e-0b7d-4c1e-9a55-1234567890ab");
    expect(installContainer(id)).toBe("bgp-agent-install-6f1c2a4e-0b7d-4c1e-9a55-1234567890ab");
    expect(turnContainer("../etc/x")).toBe("bgp-agent-turn-etcx");
    expect(turnContainerFrom([`${turnContainer(id)}.bgp-agent-internal`])).toBe(turnContainer(id));
    // The installs, Ruben's check and anything else on the network get no sites
    expect(turnContainerFrom([`${installContainer(id)}.bgp-agent-internal`])).toBeNull();
    expect(turnContainerFrom(["bgp-agent-check.bgp-agent-internal"])).toBeNull();
    expect(turnContainerFrom([])).toBeNull();
    expect(turnContainerFrom(undefined)).toBeNull();
  });

  test("a restart clears every message's containers, version 5's too", () => {
    expect(isLeftoverContainer("bgp-agent-turn")).toBe(true);
    expect(isLeftoverContainer("bgp-agent-turn-abc-123")).toBe(true);
    expect(isLeftoverContainer("bgp-agent-install-abc")).toBe(true);
    expect(isLeftoverContainer("bgp-agent-egress")).toBe(false);
    expect(isLeftoverContainer("bgp-agent-login")).toBe(false);
    expect(isLeftoverContainer("saints-adventures-web-1")).toBe(false);
  });

  test("reads what docker stats says each container uses", () => {
    expect(dockerMegabytes("512MiB")).toBe(512);
    expect(dockerMegabytes("1.5GiB")).toBe(1536);
    expect(dockerMegabytes("980kB")).toBe(1);
    expect(dockerMegabytes("2.1GB")).toBe(2003);
    expect(dockerMegabytes("0B")).toBe(0);
    expect(dockerMegabytes("lots")).toBeNull();
    const stats =
      "bgp-agent-turn-a\t412.3MiB / 1.172GiB\nbgp-agent-egress\t20MiB / 128MiB\nbroken line\n";
    expect(containerMemory(stats)).toEqual({ "bgp-agent-turn-a": 412, "bgp-agent-egress": 20 });
    expect(containerMemory("")).toEqual({});
  });

  test("another message starts only if the running ones can still grow to their limit", () => {
    const room = (availableMb, used) =>
      roomForAnotherTurn({ availableMb, limitMb: 1200, minFreeMb: 1200, used });
    // The home server: one running message using 400 MB leaves about 1 GB
    expect(room(1050, [400])).toBe(false);
    // A VPS with 8 GB
    expect(room(5800, [600])).toBe(true);
    expect(room(4000, [1000, 900])).toBe(true);
    expect(room(3000, [0, 0])).toBe(false);
    // Over its limit (docker rounding) counts as nothing more to grow
    expect(room(1200, [1300])).toBe(true);
    // No /proc (a laptop trying it out): no limit
    expect(room(null, [400])).toBe(true);
  });

  test("messages running together measure the weekly share from the earliest start", () => {
    const budget = { percent: 10, spent: 2, resetsAt: window };
    // B starts at 53 while A, which started at 50, runs: B counts from 50 too
    const fromB = budgetBaseline(at(53), [at(50), null]);
    expect(fromB).toEqual(at(50));
    // Together they stop when the account has gone up the 8 points left of the share
    expect(overBudget(budget, fromB, at(57.9))).toBe(false);
    expect(overBudget(budget, fromB, at(58))).toBe(true);
    // Alone, or with others in another window, a message counts from its own start
    expect(budgetBaseline(at(53), [])).toEqual(at(53));
    expect(budgetBaseline(at(53), [at(50, "2026-10-30T06:00:00.000Z")])).toEqual(at(53));
    expect(budgetBaseline(at(53), [at(55)])).toEqual(at(53));
  });
});
