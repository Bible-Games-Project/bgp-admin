// The only way out of the container Claude works in (the idea comes from NoHuman's Agent
// Factory, by way of cpl-cloud's agent). That container sits on a Docker network with no
// way out (--internal); this proxy is on that network and on the normal one, and only
// opens HTTPS tunnels to the Claude API, the npm registry and the sites allowed in
// Settings → Claude → Internet and keys. A session talked into something by what it reads
// can't send anything anywhere else, nor reach anything on the home network.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { lookup, Resolver } from "node:dns/promises";
import { connect } from "node:net";
import { join } from "node:path";

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

// The sites allowed in Settings → Claude, one per line, in a file per Build chat message:
// STATE_DIR/egress/turns/<container> (mounted read-only here). The build server writes it
// before that message's container starts and removes it when it ends. The proxy knows which
// container a tunnel comes from by its address on the sessions' network, which Docker's DNS
// names after the container (only the build server names containers). So with several
// messages at once each gets its own sites, and Ruben's turns and the dependency installs,
// which have no file, never get any. The file is read on every tunnel.
const TURNS_DIR = process.env.EGRESS_TURNS_DIR ?? "/etc/bgp-egress/turns";
const TURN_CONTAINER = /^bgp-agent-turn-[\w-]+$/;

export function hostsFromFile(text) {
  return String(text ?? "")
    .split(/\s+/)
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The message container a reverse lookup names ("bgp-agent-turn-<id>.bgp-agent-internal"),
 * or null for anything else.
 */
export function turnContainerFrom(names) {
  const name = String((Array.isArray(names) ? names[0] : names) ?? "")
    .toLowerCase()
    .split(".")[0];
  return TURN_CONTAINER.test(name) ? name : null;
}

async function allowedFor(address) {
  let container = null;
  try {
    // A new resolver each time: the shared one caches answers (Docker gives them 10 minutes),
    // and a container that got the address of one that ended would pass for it.
    const resolver = new Resolver({ timeout: 2000, tries: 2 });
    container = turnContainerFrom(await resolver.reverse(String(address).replace(/^::ffff:/, "")));
  } catch {}
  if (!container) return ALLOWED;
  try {
    return [...ALLOWED, ...hostsFromFile(readFileSync(join(TURNS_DIR, container), "utf8"))];
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

/** `allow`: the hosts allowed, or a function of the client's address that says them. */
export function createEgressProxy(allow = allowedFor) {
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
    const rules = typeof allow === "function" ? await allow(client.remoteAddress) : allow;
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
      `egress proxy on ${PORT}, only to ${ALLOWED.join(", ")} and each message's sites in ${TURNS_DIR}`,
    ),
  );
}
