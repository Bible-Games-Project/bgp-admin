import { describe, expect, test } from "bun:test";
import {
  AGENT_SERVICES,
  accountFrom,
  agentSettingsFrom,
  attachmentProblem,
  attachmentType,
  budgetExhaustedMessage,
  cleanEvent,
  domainRule,
  environmentFrom,
  fixPreviewPrompt,
  isClaudeToken,
  isDeployKey,
  parseDomains,
  parseVariables,
  previewDeployState,
  previewSrc,
  resetLabel,
  runnerView,
  safeFileName,
  sameSecret,
  serviceKeyFrom,
  serviceKeyVerdict,
  turnWeeklySpend,
  usageIsStale,
  weeklyBudgetFrom,
} from "./agent";

const now = new Date("2026-11-02T20:00:00Z");

describe("runnerView", () => {
  test("online when heard from recently", () => {
    const row = { last_seen_at: "2026-11-02T19:59:00Z", host: "debian", version: "1", busy: false };
    expect(runnerView(row, now)).toEqual({
      online: true,
      lastSeenAt: row.last_seen_at,
      host: "debian",
      version: "1",
      busy: false,
    });
  });

  test("offline after a few minutes of silence, or never seen", () => {
    expect(
      runnerView(
        { last_seen_at: "2026-11-02T19:50:00Z", host: null, version: null, busy: false },
        now,
      ).online,
    ).toBe(false);
    expect(runnerView(null, now).online).toBe(false);
  });
});

describe("accountFrom", () => {
  test("reads what the server reports", () => {
    expect(
      accountFrom({ last4: "AbCd", linkedAt: "2026-11-02T19:00:00Z", linkedBy: "a@b.c" }),
    ).toEqual({
      last4: "AbCd",
      linkedAt: "2026-11-02T19:00:00Z",
      linkedBy: "a@b.c",
      rejectedAt: null,
    });
  });

  test("no account without last4", () => {
    expect(accountFrom(null)).toBeNull();
    expect(accountFrom({ token: "sk-ant-oat01-x" })).toBeNull();
  });
});

describe("agentSettingsFrom", () => {
  test("defaults, and ignores values that aren't offered", () => {
    expect(agentSettingsFrom([])).toEqual({
      model: "claude-opus-5-5",
      effort: "medium",
      weeklyBudgetPercent: 10,
    });
    expect(
      agentSettingsFrom([
        { key: "agent_model", value: "claude-sonnet-5-5" },
        { key: "agent_effort", value: "turbo" },
        { key: "agent_weekly_budget_percent", value: 25 },
      ]),
    ).toEqual({ model: "claude-sonnet-5-5", effort: "medium", weeklyBudgetPercent: 25 });
  });

  test("the weekly share: 0 is no limit, nonsense is the default", () => {
    const share = (value: unknown) =>
      agentSettingsFrom([{ key: "agent_weekly_budget_percent", value }]).weeklyBudgetPercent;
    expect(share(0)).toBe(0);
    expect(share("12.5")).toBe(12.5);
    expect(share(101)).toBe(10);
    expect(share("lots")).toBe(10);
  });
});

describe("the weekly share", () => {
  const window = "2026-11-06T06:00:00.000Z";
  const usage = (percent: number, resetsAt: string | null = window) => ({
    weekly: { percent, resetsAt },
    fiveHour: { percent: 3, resetsAt: null },
  });

  test("a message spends the difference between Claude's first and last report", () => {
    expect(turnWeeklySpend(usage(54), usage(57))).toEqual({ spent: 3, resetsAt: window });
    // The limit reset during the message: nothing is attributed to either window.
    expect(turnWeeklySpend(usage(99), usage(1, "2026-11-13T06:00:00.000Z"))).toEqual({
      spent: 0,
      resetsAt: "2026-11-13T06:00:00.000Z",
    });
    expect(turnWeeklySpend(null, usage(57))).toEqual({ spent: 0, resetsAt: window });
    expect(turnWeeklySpend(usage(54), null)).toBeNull();
    expect(turnWeeklySpend(usage(60), usage(57))!.spent).toBe(0);
  });

  test("adds up the current window's messages against the share", () => {
    const now = new Date("2026-11-03T10:00:00Z");
    expect(weeklyBudgetFrom(10, usage(57), [3, 2.5, null], now)).toEqual({
      percent: 10,
      spent: 5.5,
      resetsAt: window,
      exhausted: false,
    });
    expect(weeklyBudgetFrom(10, usage(57), [7, 3], now).exhausted).toBe(true);
    expect(weeklyBudgetFrom(0, usage(57), [70, 30], now).exhausted).toBe(false);
  });

  test("a window that has passed, or none reported yet, counts as unused", () => {
    const later = new Date("2026-11-08T10:00:00Z");
    expect(weeklyBudgetFrom(10, usage(57), [7, 3], later)).toEqual({
      percent: 10,
      spent: 0,
      resetsAt: null,
      exhausted: false,
    });
    expect(weeklyBudgetFrom(10, null, [7, 3]).resetsAt).toBeNull();
  });

  test("says when it resets, in Madrid time", () => {
    expect(resetLabel(window)).toBe("Friday at 07:00");
    expect(resetLabel(null)).toBe("when the limit resets");
    expect(
      budgetExhaustedMessage({ percent: 10, spent: 10.2, resetsAt: window, exhausted: true }),
    ).toContain("10% of it");
  });
});

test("usageIsStale after a quarter of an hour, or with no time", () => {
  const at = new Date("2026-11-04T08:00:00Z");
  const usage = (iso: string) => ({ weekly: { percent: 1, resetsAt: null }, at: iso });
  expect(usageIsStale(usage("2026-11-04T07:50:00Z"), at)).toBe(false);
  expect(usageIsStale(usage("2026-11-04T07:40:00Z"), at)).toBe(true);
  expect(usageIsStale({ weekly: { percent: 1, resetsAt: null } }, at)).toBe(true);
  expect(usageIsStale(null, at)).toBe(true);
});

describe("attachments", () => {
  test("what can be attached, by the file's name", () => {
    expect(attachmentType("Captura de pantalla.PNG")).toBe("image/png");
    expect(attachmentType("brief.pdf")).toBe("application/pdf");
    expect(attachmentType("notes.md")).toBe("text/markdown");
    expect(attachmentType("photo.heic")).toBeNull();
    expect(attachmentType("archive.zip")).toBeNull();
    expect(attachmentType("noext")).toBeNull();
  });

  test("why a file can't be attached", () => {
    expect(attachmentProblem({ name: "photo.heic", size: 10 })).toContain("only images");
    expect(attachmentProblem({ name: "big.pdf", size: 30 * 1024 * 1024 })).toContain("20 MB");
    expect(attachmentProblem({ name: "empty.txt", size: 0 })).toContain("empty");
    expect(attachmentProblem({ name: "ok.jpg", size: 1000 })).toBeNull();
  });

  test("safe file names keep the extension", () => {
    expect(safeFileName("Captura de pantalla 2026-11-03 a las 10.12.png")).toBe(
      "Captura-de-pantalla-2026-11-03-a-las-10.12.png",
    );
    expect(safeFileName("../../etc/passwd")).toBe("etc/passwd".replace("/", "-"));
    expect(safeFileName("")).toBe("file");
  });
});

describe("cleanEvent", () => {
  test("keeps text and steps, trimmed to size", () => {
    expect(cleanEvent({ kind: "text", body: { text: "Hecho." } })).toEqual({
      kind: "text",
      body: { text: "Hecho." },
    });
    const step = cleanEvent({
      kind: "step",
      body: {
        tool: "TodoWrite",
        label: "Updated the plan",
        todos: [{ content: "Add level 2", status: "in_progress" }, null],
      },
    });
    expect(step).toEqual({
      kind: "step",
      body: {
        tool: "TodoWrite",
        label: "Updated the plan",
        todos: [{ content: "Add level 2", status: "in_progress" }],
      },
    });
    expect(
      (cleanEvent({ kind: "text", body: { text: "x".repeat(30_000) } })!.body as { text: string })
        .text,
    ).toHaveLength(20_000);
  });

  test("drops anything else", () => {
    expect(cleanEvent({ kind: "text", body: { text: "   " } })).toBeNull();
    expect(cleanEvent({ kind: "html", body: { text: "<b>" } })).toBeNull();
    expect(cleanEvent({ kind: "step", body: {} })).toBeNull();
    expect(cleanEvent("text")).toBeNull();
  });
});

test("sameSecret", () => {
  expect(sameSecret("abc123", "abc123")).toBe(true);
  expect(sameSecret("abc124", "abc123")).toBe(false);
  expect(sameSecret("abc", "abc123")).toBe(false);
  expect(sameSecret("", "")).toBe(false);
});

test("token and key formats", () => {
  expect(isClaudeToken("sk-ant-oat01-" + "a".repeat(40))).toBe(true);
  expect(isClaudeToken("sk-ant-api03-" + "a".repeat(40))).toBe(false);
  expect(
    isDeployKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGl8 bgp-agent Bible-Games-Project/bible-rpg"),
  ).toBe(true);
  expect(isDeployKey("ssh-rsa AAAAB3Nza")).toBe(false);
  expect(isDeployKey("ssh-ed25519 AAAA\nssh-ed25519 BBBB")).toBe(false);
});

describe("previewDeployState", () => {
  const steps = (deploy: string, build = "success") => [
    { name: "Install dependencies", status: "completed", conclusion: "success" },
    { name: "Build", status: "completed", conclusion: build },
    { name: "Deploy to Cloudflare Pages", status: "completed", conclusion: deploy },
  ];
  const run = (status: string, conclusion: string | null) => ({
    status,
    conclusion,
    html_url: "https://github.com/run/1",
  });

  test("waiting until GitHub has a run, building while it runs", () => {
    expect(previewDeployState(null, [])).toEqual({ state: "waiting" });
    expect(previewDeployState(run("in_progress", null), [])).toEqual({
      state: "building",
      runUrl: "https://github.com/run/1",
    });
  });

  test("live only when the deploy step ran", () => {
    expect(previewDeployState(run("completed", "success"), steps("success"))).toEqual({
      state: "live",
      runUrl: "https://github.com/run/1",
    });
  });

  test("a green run whose deploy was skipped is a failed build", () => {
    expect(previewDeployState(run("completed", "success"), steps("skipped"))).toEqual({
      state: "failed",
      runUrl: "https://github.com/run/1",
      step: "Build",
    });
    expect(
      previewDeployState(run("completed", "failure"), steps("skipped", "failure")),
    ).toMatchObject({ step: "Build" });
  });
});

test("fixPreviewPrompt carries the error", () => {
  expect(fixPreviewPrompt("")).not.toContain("```");
  expect(fixPreviewPrompt("error TS2304: Cannot find name 'x'")).toContain("Cannot find name 'x'");
});

test("previewSrc adds a cache-busting parameter", () => {
  expect(previewSrc("https://bgp-bible-rpg.pages.dev", "abc")).toBe(
    "https://bgp-bible-rpg.pages.dev/?bgp_preview=abc",
  );
});

describe("internet and keys", () => {
  test("the websites box takes what Claude Code's environment shows, and only public sites", () => {
    const { domains, problems } = parseDomains(
      "api.openai.com\nhttps://api.elevenlabs.io/v1\n*.googleapis.com, api.openai.com\n# a comment\nregistry.npmjs.org\n\n",
    );
    expect(domains).toEqual(["api.openai.com", "api.elevenlabs.io", "*.googleapis.com"]);
    expect(problems).toEqual([]);
    expect(parseDomains("192.168.1.24 localhost").problems).toHaveLength(2);
    expect(domainRule("API.OpenAI.com:443")).toBe("api.openai.com");
  });

  test("the keys box reads .env lines, quotes and export included", () => {
    const { variables, problems } = parseVariables(
      [
        "# from Claude Code",
        "OPENAI_API_KEY=sk-proj-abc",
        'export ELEVENLABS_API_KEY="xi-123"',
        "SPACED = 'a b'",
        "",
      ].join("\n"),
    );
    expect(variables).toEqual({
      OPENAI_API_KEY: "sk-proj-abc",
      ELEVENLABS_API_KEY: "xi-123",
      SPACED: "a b",
    });
    expect(problems).toEqual([]);
  });

  test("the keys box says what's wrong, line by line", () => {
    const { variables, problems } = parseVariables(
      "OPENAI_API_KEY=\njust some text\nCLAUDE_CODE_OAUTH_TOKEN=x\nHTTPS_PROXY=http://x\n9X=1",
    );
    expect(variables).toEqual({});
    expect(problems).toEqual([
      "OPENAI_API_KEY has no value.",
      "Line 2 has no “=”: write it as NAME=value.",
      "CLAUDE_CODE_OAUTH_TOKEN is set by the build server itself.",
      "HTTPS_PROXY is set by the build server itself.",
      "9X isn't a valid name.",
    ]);
  });

  test("environmentFrom keeps names and last four, whatever the server sent", () => {
    expect(environmentFrom(null)).toEqual({
      domains: [],
      variables: [],
      updatedAt: null,
      updatedBy: null,
    });
    expect(
      environmentFrom({
        domains: ["api.openai.com", 3],
        variables: [{ name: "OPENAI_API_KEY", last4: "WXYZ", value: "leak" }, { last4: "x" }],
        updatedAt: "2026-11-05T12:00:00Z",
      }),
    ).toEqual({
      domains: ["api.openai.com"],
      variables: [{ name: "OPENAI_API_KEY", last4: "WXYZ" }],
      updatedAt: "2026-11-05T12:00:00Z",
      updatedBy: null,
    });
  });
});

describe("connecting a service with its key", () => {
  const [openai, elevenlabs] = AGENT_SERVICES;
  const key = "sk-proj-AbCdEf0123456789XyZ";

  test("the key alone, its line from Claude Code, or all the lines", () => {
    expect(serviceKeyFrom(`  ${key}\n`, openai)).toEqual({ key });
    expect(serviceKeyFrom(`OPENAI_API_KEY=${key}`, openai)).toEqual({ key });
    expect(serviceKeyFrom(`export OPENAI_API_KEY="${key}"`, openai)).toEqual({ key });
    expect(
      serviceKeyFrom(`ELEVENLABS_API_KEY=sk_0123456789abcdef0123\nOPENAI_API_KEY=${key}`, openai),
    ).toEqual({ key });
    expect(serviceKeyFrom("sk_0123456789abcdef0123456789", elevenlabs)).toEqual({
      key: "sk_0123456789abcdef0123456789",
    });
  });

  test("says plainly what's wrong with what was pasted", () => {
    expect(serviceKeyFrom("", openai)).toEqual({ problem: "Paste the key first." });
    expect(serviceKeyFrom("sk-proj-abc", openai)).toEqual({
      problem: "That's too short to be a key. Copy it again, whole.",
    });
    expect(serviceKeyFrom(`OPENAI_API_KEY=${key}`, elevenlabs)).toEqual({
      problem: "That's the OpenAI key: paste it in the OpenAI box.",
    });
    expect(serviceKeyFrom("my key is sk-proj-AbCdEf0123456789XyZ", openai)).toEqual({
      problem: "A key has no spaces. Copy it again, on its own.",
    });
    expect(serviceKeyFrom("A=1\nB=2", openai)).toEqual({
      problem: "Paste only the key, or the line that starts with OPENAI_API_KEY=.",
    });
  });

  test("only a plain 'invalid key' answer stops it", () => {
    // What both services answered a made-up key on 2026-11-05
    const openaiInvalid = {
      error: { message: "Incorrect API key provided: sk-proj-***0000.", code: "invalid_api_key" },
    };
    const elevenInvalid = { detail: { status: "invalid_api_key", message: "Invalid API key" } };
    expect(serviceKeyVerdict("openai", 401, openaiInvalid)).toBe("invalid");
    expect(serviceKeyVerdict("elevenlabs", 401, elevenInvalid)).toBe("invalid");
    expect(serviceKeyVerdict("openai", 200, {})).toBe("ok");
    // A key limited to some things, a service in trouble, no answer at all
    expect(
      serviceKeyVerdict("openai", 401, { error: { message: "Missing scopes: api.model.read" } }),
    ).toBe("unknown");
    expect(
      serviceKeyVerdict("elevenlabs", 401, { detail: { status: "missing_permissions" } }),
    ).toBe("unknown");
    expect(serviceKeyVerdict("openai", 503, null)).toBe("unknown");
  });
});
