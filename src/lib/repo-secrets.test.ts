import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("@/lib/telegram.server", () => ({ telegramChatId: async () => "-100chat" }));
// github.functions imports the agent docs, which only load under Vite.
mock.module("@/lib/agent-docs.server", () => ({ commitAgentDocs: async () => [] }));

const { ensurePublishTelegramSecrets } = await import("@/lib/repo-secrets.server");

// A 32-byte public key, as GitHub returns it.
const PUBLIC_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

describe("ensurePublishTelegramSecrets", () => {
  let calls: { url: string; method: string }[] = [];
  const realFetch = globalThis.fetch;
  const env = { ...process.env };

  const stubGithub = (names: string[]) => {
    calls = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.includes("/actions/secrets?")) {
        return new Response(JSON.stringify({ secrets: names.map((name) => ({ name })) }));
      }
      if (url.endsWith("/public-key")) {
        return new Response(JSON.stringify({ key: PUBLIC_KEY, key_id: "k1" }));
      }
      return new Response(null, { status: 201 });
    }) as typeof fetch;
  };

  beforeEach(() => {
    process.env.GITHUB_PAT = "pat";
    process.env.TELEGRAM_BOT_TOKEN = "bot";
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...env };
  });

  it("sets both secrets on a repo linked by hand without them", async () => {
    stubGithub(["ANDROID_KEYSTORE", "KEY_ALIAS"]);
    expect(await ensurePublishTelegramSecrets("bible-games-for-kids")).toEqual([]);
    const puts = calls.filter((c) => c.method === "PUT").map((c) => c.url.split("/").pop());
    expect(puts).toEqual(["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]);
  });

  it("leaves a repo that already has both alone", async () => {
    stubGithub(["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]);
    expect(await ensurePublishTelegramSecrets("exodus-serpent-saga")).toEqual([]);
    expect(calls.filter((c) => c.method === "PUT")).toEqual([]);
  });

  it("reports both names when GitHub won't list the secrets", async () => {
    calls = [];
    globalThis.fetch = (async () => new Response("", { status: 403 })) as unknown as typeof fetch;
    expect(await ensurePublishTelegramSecrets("x")).toEqual([
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_CHAT_ID",
    ]);
  });
});
