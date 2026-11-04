// The only way out of the container Claude works in (the idea comes from NoHuman's Agent
// Factory, by way of cpl-cloud's agent). That container sits on a Docker network with no
// way out (--internal); this proxy is on that network and on the normal one, and only
// opens HTTPS tunnels to the Claude API and the npm registry. A session talked into
// something by what it reads can't send anything anywhere else, nor reach anything on the
// home network.
import { createServer } from "node:http";
import { connect } from "node:net";

// The console is added through EGRESS_ALLOW (install.sh takes it from CONSOLE_URL): Ruben's
// tools read it from inside the container (console-mcp.mjs).
export const ALLOWED = [
  "api.anthropic.com",
  "registry.npmjs.org",
  ...String(process.env.EGRESS_ALLOW ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
];
const PORT = Number(process.env.EGRESS_PORT ?? 3128);

export function isAllowedHost(host, allow = ALLOWED) {
  const name = String(host).toLowerCase().replace(/\.$/, "");
  return allow.some((rule) =>
    rule.startsWith(".") ? name === rule.slice(1) || name.endsWith(rule) : name === rule,
  );
}

// "host:port" of a CONNECT, or null when it isn't one
export function parseTarget(target) {
  const match = /^([a-zA-Z0-9.-]{1,253}):(\d{1,5})$/.exec(target ?? "");
  if (!match) return null;
  const port = Number(match[2]);
  return port > 0 && port < 65536 ? { host: match[1], port } : null;
}

export function createEgressProxy(allow = ALLOWED) {
  // No plain HTTP: everything that leaves is TLS to an allowed host
  const server = createServer((_request, response) =>
    response.writeHead(405, { connection: "close" }).end(),
  );
  server.on("connect", (request, client, head) => {
    const target = parseTarget(request.url);
    const allowed = Boolean(target) && target.port === 443 && isAllowedHost(target.host, allow);
    if (!allowed) {
      console.log(`refused ${String(request.url).slice(0, 100)}`);
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = connect(target.port, target.host);
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    const close = () => {
      upstream.destroy();
      client.destroy();
    };
    upstream.on("error", close);
    client.on("error", close);
    upstream.on("close", close);
    client.on("close", close);
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createEgressProxy().listen(PORT, () =>
    console.log(`egress proxy on ${PORT}, only to ${ALLOWED.join(", ")}`),
  );
}
