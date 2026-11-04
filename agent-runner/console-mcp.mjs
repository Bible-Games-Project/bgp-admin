// The console's tools for Ruben, as an MCP server Claude Code starts inside the container
// (stdio, newline-delimited JSON-RPC). It knows nothing itself: it lists what the console
// answers at /api/assistant/tools and forwards each call to /api/assistant/call, with the
// turn's token (ASSISTANT_TOKEN) and the console's address (CONSOLE_URL) from the
// environment the runner gives the container. The token only works while the turn runs.
import { createInterface } from "node:readline";

const PROTOCOL = "2024-11-05";

/** One call to the console. Resolves with the JSON it answered; a refusal is an error. */
export async function consoleApi(path, body, env = process.env, fetchImpl = fetch) {
  const base = String(env.CONSOLE_URL ?? "").replace(/\/$/, "");
  const response = await fetchImpl(`${base}/api/assistant/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.ASSISTANT_TOKEN ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // Not JSON: said below.
  }
  if (!response.ok) throw new Error(data?.error ?? `${response.status} ${text.slice(0, 200)}`);
  return data ?? {};
}

/** The answer to one JSON-RPC message, or null when it takes none (a notification). */
export async function handle(message, api = consoleApi) {
  const { id, method, params } = message ?? {};
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, text) => ({ jsonrpc: "2.0", id, error: { code, message: text } });
  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: params?.protocolVersion ?? PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "bgp-console", version: "1" },
      });
    case "ping":
      return reply({});
    case "tools/list": {
      try {
        const { tools } = await api("tools", {});
        return reply({ tools: Array.isArray(tools) ? tools : [] });
      } catch (error) {
        return fail(-32000, `The console didn't list its tools: ${error.message}`);
      }
    }
    case "tools/call": {
      try {
        const { result } = await api("call", {
          name: params?.name,
          arguments: params?.arguments ?? {},
        });
        const text = typeof result === "string" ? result : JSON.stringify(result ?? null, null, 1);
        return reply({ content: [{ type: "text", text }] });
      } catch (error) {
        return reply({
          content: [{ type: "text", text: `The console answered: ${error.message}` }],
          isError: true,
        });
      }
    }
    default:
      // Notifications (no id) take no answer; an unknown request is said so.
      return id === undefined || id === null ? null : fail(-32601, `Unknown method ${method}`);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const lines = createInterface({ input: process.stdin });
  lines.on("line", async (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const answer = await handle(message);
    if (answer) process.stdout.write(`${JSON.stringify(answer)}\n`);
  });
}
