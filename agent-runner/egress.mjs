// The only way out of the container Claude works in (the idea comes from NoHuman's Agent
// Factory, by way of cpl-cloud's agent). That container sits on a Docker network with no
// way out (--internal); this proxy is on that network and on the normal one, and only
// opens HTTPS tunnels to the Claude API, the npm registry and the sites allowed in
// Settings → Claude → Internet and keys. A session talked into something by what it reads
// can't send anything anywhere else, nor reach anything on the home network.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { lookup } from "node:dns/promises";
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

// The sites allowed in Settings → Claude, one per line. The build server writes the file
// (STATE_DIR/egress/allow, mounted read-only here) when a Build chat turn starts, and empties
// it when the turn ends: Ruben's turns and the dependency installs never get them. It's read
// on every tunnel, so a change applies at once.
const ALLOW_FILE = process.env.EGRESS_ALLOW_FILE ?? "/etc/bgp-egress/allow";

export function hostsFromFile(text) {
  return String(text ?? "")
    .split(/\s+/)
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function allowedNow() {
  try {
    return [...ALLOWED, ...hostsFromFile(readFileSync(ALLOW_FILE, "utf8"))];
  } catch {
    return ALLOWED;
  }
}

// "*.example.com" and ".example.com" both allow example.com and its subdomains
export function isAllowedHost(host, allow = ALLOWED) {
  const name = String(host).toLowerCase().replace(/\.$/, "");
  return allow.some((raw) => {
    const rule = raw.startsWith("*.") ? raw.slice(1) : raw;
    return rule.startsWith(".") ? name === rule.slice(1) || name.endsWith(rule) : name === rule;
  });
}

/**
 * Addresses that aren't on the internet: the home network, the machine itself, Docker's
 * networks. An allowed name that resolves to one of them (by mistake, or a site that
 * points its DNS there on purpose) isn't followed.
 */
export function isPrivateAddress(address) {
  const value = String(address).toLowerCase();
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(value);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  return (
    value === "::" ||
    value === "::1" ||
    /^f[cd][0-9a-f]{2}:/.test(value) ||
    /^fe[89ab][0-9a-f]:/.test(value) ||
    value.startsWith("ff")
  );
}

// "host:port" of a CONNECT, or null when it isn't one
export function parseTarget(target) {
  const match = /^([a-zA-Z0-9.-]{1,253}):(\d{1,5})$/.exec(target ?? "");
  if (!match) return null;
  const port = Number(match[2]);
  return port > 0 && port < 65536 ? { host: match[1], port } : null;
}

export function createEgressProxy(allow = allowedNow) {
  // No plain HTTP: everything that leaves is TLS to an allowed host
  const server = createServer((_request, response) =>
    response.writeHead(405, { connection: "close" }).end(),
  );
  server.on("connect", async (request, client, head) => {
    const refuse = (why) => {
      console.log(`refused ${String(request.url).slice(0, 100)}${why ? ` (${why})` : ""}`);
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    };
    client.on("error", () => client.destroy());
    const target = parseTarget(request.url);
    const rules = typeof allow === "function" ? allow() : allow;
    if (!target || target.port !== 443 || !isAllowedHost(target.host, rules)) return refuse();
    let address;
    try {
      ({ address } = await lookup(target.host));
    } catch {
      return refuse("not found");
    }
    if (isPrivateAddress(address)) return refuse(`private address ${address}`);
    const upstream = connect(target.port, address);
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
    console.log(
      `egress proxy on ${PORT}, only to ${ALLOWED.join(", ")} and the sites in ${ALLOW_FILE}`,
    ),
  );
}
