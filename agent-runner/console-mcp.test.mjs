import { describe, expect, test } from "bun:test";
import { consoleApi, handle } from "./console-mcp.mjs";

// The console as the MCP server sees it: its tools and their answers.
const api = async (path, body) => {
  if (path === "tools")
    return {
      tools: [{ name: "home", description: "What Home shows", inputSchema: { type: "object" } }],
    };
  if (body.name === "home") return { result: { attention: [] } };
  throw new Error("No tool named nope");
};

describe("console-mcp", () => {
  test("introduces itself and lists the console's tools", async () => {
    const init = await handle(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      api,
    );
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities).toEqual({ tools: {} });
    expect(await handle({ jsonrpc: "2.0", method: "notifications/initialized" }, api)).toBeNull();
    const list = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }, api);
    expect(list.result.tools.map((t) => t.name)).toEqual(["home"]);
  });

  test("forwards a call and reports a refusal as the tool's error", async () => {
    const ok = await handle(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "home", arguments: {} } },
      api,
    );
    expect(ok.result.content[0].text).toContain('"attention": []');
    const bad = await handle(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } },
      api,
    );
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0].text).toContain("No tool named nope");
    const unknown = await handle({ jsonrpc: "2.0", id: 5, method: "resources/list" }, api);
    expect(unknown.error.code).toBe(-32601);
  });

  test("calls the console with the turn's token", async () => {
    let seen;
    const fetchImpl = async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ tools: [] }), { status: 200 });
    };
    await consoleApi(
      "tools",
      {},
      { CONSOLE_URL: "https://console.test/", ASSISTANT_TOKEN: "ast_x" },
      fetchImpl,
    );
    expect(seen.url).toBe("https://console.test/api/assistant/tools");
    expect(seen.init.headers.Authorization).toBe("Bearer ast_x");
    const refused = async () =>
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    await expect(consoleApi("call", {}, { CONSOLE_URL: "https://c" }, refused)).rejects.toThrow(
      "Unauthorized",
    );
  });
});
