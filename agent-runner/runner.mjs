// The build server behind the console's Build chat (bgp-admin, /apps/<id>/build). It asks
// the console for work (/api/agent/poll) and, for each chat message, runs the Claude CLI on
// a clone of the game's repo, in a container whose only ways out are the Claude API and
// the npm registry. When Claude finishes it pushes the commits to the game's branch, which
// deploys the Cloudflare preview the page shows next to the chat.
//
// Several messages run at once (AGENT_PARALLEL), at most one per game, as long as the
// machine has memory for them (freeSlots). Each has its own container.
//
// It also holds the Claude account it works with. Settings → Claude asks for a link; this
// runs `claude setup-token` and passes the claude.ai link and the code back and forth
// through the console. The token only lives here (STATE_DIR/claude.json): the console sees
// its last four characters. So do the keys of Settings → Claude → Internet and keys
// (STATE_DIR/environment.json), with the sites the sessions may reach besides Claude and npm.
//
// Runs as the systemd service bgp-agent (bgp-agent.service), user bgp-agent, set up by
// install.sh. See README.md.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { hostname, userInfo } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import * as lib from "./lib.mjs";

const VERSION = "7";
const env = process.env;
const CONFIG = {
  console: (env.CONSOLE_URL ?? "https://bgp-admin-preview.biblegamesproject.workers.dev").replace(
    /\/$/,
    "",
  ),
  runnerToken: env.AGENT_RUNNER_TOKEN ?? "",
  name: env.AGENT_NAME ?? hostname(),
  state: env.STATE_DIR ?? "/var/lib/bgp-agent",
  // "docker" on the server. "none" runs the CLI straight on this machine with the
  // machine's own Claude login, to try the runner out on a laptop: no sandbox at all.
  sandbox: env.AGENT_SANDBOX ?? "docker",
  image: env.AGENT_IMAGE ?? "bgp-agent:latest",
  network: env.AGENT_NETWORK ?? "bgp-agent-internal",
  proxy: env.AGENT_PROXY ?? "http://bgp-agent-egress:3128",
  memory: env.AGENT_MEMORY ?? "1200m",
  cpus: env.AGENT_CPUS ?? "2",
  // How many messages may run at once (different games; one game's go one after another).
  // Another only starts when the machine has room for it besides the running ones at their
  // memory limit, so on a small machine it's often one anyway.
  parallel: Math.max(1, Math.floor(Number(env.AGENT_PARALLEL ?? 3)) || 1),
  // No limit on how long a turn takes or how many steps it makes (0): a turn ends when
  // Claude finishes, someone presses Stop, or the account's usage (or the chat's weekly
  // share of it) runs out. A positive value brings a cap back.
  turnMinutes: Number(env.TURN_MINUTES ?? 0),
  maxTurns: Number(env.MAX_TURNS ?? 0),
  // How long a chat's conversation gets before Claude Code summarizes it (auto-compact).
  // The CLI's own choice for Opus 5.5 is about a million tokens, and every step of every
  // turn reads the whole conversation again. "auto" leaves it to the CLI.
  compactWindow: env.AGENT_COMPACT_WINDOW ?? "200k",
  // A GitHub token to clone and push with over HTTPS, instead of a deploy key per repo: for
  // an organization that doesn't allow deploy keys. A fine-grained token with Contents read
  // and write on the game repos is enough. It never reaches the container.
  pushToken: env.GIT_PUSH_TOKEN ?? "",
};
// Where game repos are cloned from, {owner} and {name} filled in. Tests point it at local
// bare repos (file://), which need no deploy key.
CONFIG.repoUrl =
  env.REPO_URL ??
  (CONFIG.pushToken
    ? "https://github.com/{owner}/{name}.git"
    : "git@github.com:{owner}/{name}.git");
// A turn only starts when the machine has this much memory free (all a turn may use, by
// default), so it can't be what leaves the machine's other services short.
CONFIG.minFreeMb = Number(env.AGENT_MIN_FREE_MB ?? lib.megabytes(CONFIG.memory) ?? 1200);
const ACCOUNT = join(CONFIG.state, "claude.json");
const ENVIRONMENT = join(CONFIG.state, "environment.json");
// Mounted read-only in the egress proxy's container as /etc/bgp-egress (install.sh)
const EGRESS_DIR = join(CONFIG.state, "egress");
const TURN_SITES = join(EGRESS_DIR, "turns");
// The messages in progress, so a restart can tell their chats (recover) and install.sh
// waits for them
const CURRENT = join(CONFIG.state, "current.json");
const LOGS = join(CONFIG.state, "logs");
// The files sent with the chats' messages, one folder per chat (see fetchAttachments).
const ATTACHMENTS = join(CONFIG.state, "attachments");
const ATTACHMENTS_MOUNT = "/attachments";
const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const KNOWN_HOSTS = join(CONFIG.state, ".ssh", "known_hosts");
const LOGIN_CONTAINER = "bgp-agent-login";
const CHECK_MODEL = "claude-haiku-5-5";

const log = (...parts) => console.log(new Date().toISOString(), ...parts);
const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/** An error whose message is meant for the person in the chat. */
class Said extends Error {}

// A program, without a shell. Resolves with what it printed; a failure says the last lines.
function run(
  command,
  args,
  { cwd = CONFIG.state, extraEnv = {}, timeoutMs = 20 * 60_000, allowFail = false } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...cleanEnv(), ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout = (stdout + chunk).slice(-1_000_000)));
    child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-100_000)));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !allowFail) {
        const tail = stderr.trim().split("\n").slice(-4).join(" ").slice(-400);
        reject(new Error(`${command} ${args[0] ?? ""} failed (${code}): ${tail}`));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}

// Programs don't inherit the service's secrets, only what they need.
function cleanEnv() {
  // Without the sandbox the CLI uses this machine's own login, which (on a Mac, in the
  // keychain) it finds through the user's environment.
  const own =
    CONFIG.sandbox === "docker"
      ? {}
      : Object.fromEntries(
          ["USER", "LOGNAME", "TMPDIR", "SHELL"].filter((k) => env[k]).map((k) => [k, env[k]]),
        );
  return {
    ...own,
    PATH: env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: CONFIG.sandbox === "docker" ? CONFIG.state : (env.HOME ?? CONFIG.state),
    LANG: "C.UTF-8",
    TZ: "Europe/Madrid",
    GIT_TERMINAL_PROMPT: "0",
  };
}

// git on the host never runs anything from the repo: Claude can write to .git from inside
// the container, so no hooks and no fsmonitor, and its config is put back after each
// session (takeBackRepo). Nor from a repo Claude nests in the game (a submodule), whose
// config is Claude's too: git doesn't go into it for a fetch, a push or a status, and what
// does go into it (`git add`) only runs in the sandbox (commitLeftovers).
const GIT_SAFE = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "submodule.recurse=false",
  "-c",
  "fetch.recurseSubmodules=false",
  "-c",
  "push.recurseSubmodules=no",
  "-c",
  "diff.ignoreSubmodules=all",
];
const git = (repoDir, args, options = {}) =>
  run("git", [...GIT_SAFE, ...args], {
    cwd: repoDir,
    ...options,
  });

// --- The console -----------------------------------------------------------------------

async function api(path, body, timeoutMs = 30_000) {
  const response = await fetch(`${CONFIG.console}/api/agent/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CONFIG.runnerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  const data = lib.parseLine(text);
  if (!response.ok) {
    const error = new Error(
      `the console answered ${response.status} to ${path}: ${data?.error ?? text.slice(0, 200)}`,
    );
    error.status = response.status;
    error.said = data?.error ?? null;
    throw error;
  }
  return data ?? {};
}

// The end of a turn has to reach the console, or the chat waits forever: retried.
async function sendFinish(id, report) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      await api("finish", { id, ...report }, 60_000);
      return;
    } catch (error) {
      log(`turn ${id}: couldn't report the end (${error.message})`);
      await sleep(attempt * 10);
    }
  }
}

// --- The Claude account ----------------------------------------------------------------

function loadAccount() {
  try {
    return JSON.parse(readFileSync(ACCOUNT, "utf8"));
  } catch {
    return null;
  }
}

function saveAccount(account) {
  writeFileSync(ACCOUNT, JSON.stringify(account, null, 2), { mode: 0o600 });
  chmodSync(ACCOUNT, 0o600);
}

/** What the console may know about the account: never the token. */
function accountSummary() {
  const account = loadAccount();
  if (account?.token) {
    return {
      last4: account.token.slice(-4),
      linkedAt: account.linkedAt ?? null,
      linkedBy: account.linkedBy ?? null,
      rejectedAt: account.rejectedAt ?? null,
    };
  }
  // Without the sandbox the CLI uses this machine's own login.
  if (CONFIG.sandbox !== "docker")
    return {
      last4: "····",
      linkedAt: null,
      linkedBy: `${CONFIG.name}'s own login`,
      rejectedAt: null,
    };
  return null;
}

function markRejected() {
  const account = loadAccount();
  if (account?.token && !account.rejectedAt)
    saveAccount({ ...account, rejectedAt: new Date().toISOString() });
}

// --- Internet and keys ------------------------------------------------------------------------

function loadEnvironment() {
  let saved = null;
  try {
    saved = JSON.parse(readFileSync(ENVIRONMENT, "utf8"));
  } catch {}
  return {
    domains: Array.isArray(saved?.domains) ? saved.domains : [],
    variables: saved?.variables && typeof saved.variables === "object" ? saved.variables : {},
    updatedAt: saved?.updatedAt ?? null,
    updatedBy: saved?.updatedBy ?? null,
  };
}

function saveEnvironment(environment) {
  const temporary = `${ENVIRONMENT}.new`;
  writeFileSync(temporary, JSON.stringify(environment, null, 2), { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, ENVIRONMENT);
}

/**
 * The sites the egress proxy lets a Build chat message's container reach besides its own: a
 * file named after the container, written before it starts and removed when it ends. The
 * proxy reads it on every tunnel from that container (egress.mjs). Ruben's containers and
 * the dependency installs have none.
 */
function allowSites(container, domains) {
  mkdirSync(TURN_SITES, { recursive: true });
  chmodSync(EGRESS_DIR, 0o755);
  chmodSync(TURN_SITES, 0o755);
  const file = join(TURN_SITES, container);
  writeFileSync(`${file}.new`, domains.map((d) => `${d}\n`).join(""), { mode: 0o644 });
  chmodSync(`${file}.new`, 0o644);
  renameSync(`${file}.new`, file);
}

const dropSites = (container) => rmSync(join(TURN_SITES, container), { force: true });

/** A change saved in Settings → Claude: kept here, and the console told what it is now. */
async function doEnvironment(change) {
  let error = null;
  let skipped = [];
  try {
    const result = lib.applyEnvironmentChange(loadEnvironment(), change, {
      at: new Date().toISOString(),
      by: change.createdByEmail ?? null,
    });
    saveEnvironment(result.environment);
    skipped = result.skipped;
    log(
      `internet and keys: ${result.environment.domains.length} sites, ${Object.keys(result.environment.variables).length} keys`,
    );
  } catch (caught) {
    error = caught.message;
    log(`internet and keys: ${error}`);
  }
  await api("environment", {
    id: change.id,
    ok: !error,
    error,
    skipped,
    environment: lib.environmentSummary(loadEnvironment()),
  }).catch((caught) => log(`couldn't report the change of internet and keys: ${caught.message}`));
}

// --- Containers --------------------------------------------------------------------------

function dockerArgs({
  name,
  network = CONFIG.network,
  repoDir,
  homeDir,
  attachmentsDir,
  envFile,
  extraEnv = {},
  tty = false,
  command,
}) {
  const { uid, gid } = userInfo();
  return [
    "run",
    "--rm",
    ...(tty ? ["-it"] : []),
    "--name",
    name,
    "--network",
    network,
    "--memory",
    CONFIG.memory,
    "--memory-swap",
    CONFIG.memory,
    // If the machine still runs out of memory, the kernel kills Claude before anything else
    "--oom-score-adj",
    "1000",
    "--cpus",
    CONFIG.cpus,
    "--pids-limit",
    "2048",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    `${uid}:${gid}`,
    ...(repoDir ? ["-v", `${repoDir}:/work`, "-w", "/work"] : ["-w", "/home/agent"]),
    ...(homeDir
      ? ["-v", `${homeDir}:/home/agent`]
      : ["--tmpfs", `/home/agent:rw,size=64m,uid=${uid},gid=${gid},mode=0700`]),
    // The chat's attached files, which Claude may read and copy into the game, not change
    ...(attachmentsDir ? ["-v", `${attachmentsDir}:${ATTACHMENTS_MOUNT}:ro`] : []),
    ...(envFile ? ["--env-file", envFile] : []),
    "-e",
    "HOME=/home/agent",
    ...(network === CONFIG.network
      ? [
          "-e",
          `HTTPS_PROXY=${CONFIG.proxy}`,
          "-e",
          `HTTP_PROXY=${CONFIG.proxy}`,
          "-e",
          `https_proxy=${CONFIG.proxy}`,
        ]
      : []),
    "-e",
    "NO_PROXY=localhost,127.0.0.1",
    "-e",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
    "-e",
    "DISABLE_AUTOUPDATER=1",
    "-e",
    "TZ=Europe/Madrid",
    ...Object.entries(extraEnv).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
    CONFIG.image,
    ...command,
  ];
}

// The token reaches a container through a file only it reads, never through argv. So
// does whatever else is secret for a turn (Ruben's token for the console's tools).
function tokenFile(name, token, extra = {}) {
  const dir = join(CONFIG.state, "run");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${name}.env`);
  const lines = [
    `CLAUDE_CODE_OAUTH_TOKEN=${token}`,
    ...Object.entries(extra).map(([k, v]) => `${k}=${v}`),
  ];
  writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
  return file;
}

// Ruben (the console's assistant) works with no repository: a home folder per chat for
// its session, and the MCP config that gives Claude the console's tools (console-mcp.mjs).
// What those tools may reach is decided by the console, with the turn's token.
function prepareAssistant(job) {
  const homeDir = join(
    CONFIG.state,
    "homes",
    `assistant-${String(job.chatId).replace(/[^\w-]/g, "")}`,
  );
  mkdirSync(join(CONFIG.state, "homes"), { recursive: true, mode: 0o700 });
  mkdirSync(homeDir, { recursive: true, mode: 0o700 });
  const server =
    CONFIG.sandbox === "docker"
      ? "/opt/bgp-agent/console-mcp.mjs"
      : new URL("console-mcp.mjs", import.meta.url).pathname;
  // A new file each time: the last turn's container had this folder writable
  lib.replaceFile(
    join(homeDir, "mcp.json"),
    JSON.stringify({ mcpServers: { console: { command: "node", args: [server] } } }),
    { mode: 0o600 },
  );
  return {
    repoDir: null,
    homeDir,
    mcpConfig: CONFIG.sandbox === "docker" ? "/home/agent/mcp.json" : join(homeDir, "mcp.json"),
    toolEnv: { CONSOLE_URL: CONFIG.console, ASSISTANT_TOKEN: job.toolToken ?? "" },
  };
}

// --- The game's repo -----------------------------------------------------------------------

const repoSlug = (repo) => `${repo.owner}__${repo.name}`.toLowerCase();
const repoUrlOf = (repo) =>
  CONFIG.repoUrl.replace("{owner}", repo.owner).replace("{name}", repo.name);
const keyBody = (publicKey) =>
  String(publicKey ?? "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");

// git asks this for the token, so it's never in a URL, a config file or a command line.
const ASKPASS = join(CONFIG.state, "askpass.sh");

function sshEnv(keyFile) {
  if (CONFIG.repoUrl.startsWith("file:")) return {};
  if (CONFIG.pushToken) {
    if (!existsSync(ASKPASS)) {
      // Written aside and moved in: another message's git may be reading it
      writeFileSync(
        `${ASKPASS}.${process.pid}.new`,
        '#!/bin/sh\ncase "$1" in Username*) echo x-access-token ;; *) echo "$GIT_PUSH_TOKEN" ;; esac\n',
        {
          mode: 0o700,
        },
      );
      renameSync(`${ASKPASS}.${process.pid}.new`, ASKPASS);
    }
    return { GIT_ASKPASS: ASKPASS, GIT_PUSH_TOKEN: CONFIG.pushToken };
  }
  const hosts = existsSync(KNOWN_HOSTS)
    ? `-o StrictHostKeyChecking=yes -o UserKnownHostsFile=${KNOWN_HOSTS}`
    : "-o StrictHostKeyChecking=accept-new";
  return { GIT_SSH_COMMAND: `ssh -i ${keyFile} -o IdentitiesOnly=yes ${hosts}` };
}

// One deploy key per repo, made here; the console adds it to the repo on GitHub.
async function ensureDeployKey(job, keyFile) {
  if (CONFIG.repoUrl.startsWith("file:") || CONFIG.pushToken) return;
  if (!existsSync(keyFile)) {
    await run("ssh-keygen", [
      "-q",
      "-t",
      "ed25519",
      "-N",
      "",
      "-C",
      `bgp-agent ${job.repo.owner}/${job.repo.name}`,
      "-f",
      keyFile,
    ]);
  }
  const publicKey = readFileSync(`${keyFile}.pub`, "utf8").trim();
  if (keyBody(job.deployKey) === keyBody(publicKey)) return;
  log(`registering the deploy key of ${job.repo.owner}/${job.repo.name}`);
  try {
    await api("repo-key", { repo: `${job.repo.owner}/${job.repo.name}`, publicKey });
  } catch (error) {
    // The console explains what's wrong (e.g. deploy keys off in the organization).
    if (error.status >= 400 && error.status < 500 && error.said) throw new Said(error.said);
    throw error;
  }
}

function authorEnv(job) {
  const email = job.author?.email || "build-chat@localhost";
  return {
    GIT_AUTHOR_NAME: "Build chat",
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: "Build chat",
    GIT_COMMITTER_EMAIL: email,
  };
}

// What the CLI gets besides the token: who the commits are from, and when to summarize.
function claudeEnv(job) {
  return {
    ...authorEnv(job),
    ...(CONFIG.compactWindow === "auto"
      ? {}
      : { CLAUDE_CODE_AUTO_COMPACT_WINDOW: CONFIG.compactWindow }),
  };
}

// The repo exactly as it is on GitHub, plus node_modules: whatever a previous turn left
// that never reached GitHub is gone.
async function prepareRepo(job, reporter) {
  const slug = repoSlug(job.repo);
  const repoDir = join(CONFIG.state, "repos", slug);
  const homeDir = join(CONFIG.state, "homes", slug);
  const keyFile = join(CONFIG.state, "keys", slug);
  const unchecked = join(CONFIG.state, "unchecked", slug);
  for (const dir of ["repos", "homes", "keys", "installed", "unchecked"])
    mkdirSync(join(CONFIG.state, dir), { recursive: true, mode: 0o700 });
  mkdirSync(homeDir, { recursive: true, mode: 0o700 });

  // Before git runs in the clone again: a .git that isn't what git makes means a new clone,
  // and a config the last message didn't get to put back (the server stopped, or the message
  // failed half way) is put back now.
  if (existsSync(repoDir)) {
    const problem = lib.gitDirProblem(repoDir);
    if (problem) {
      log(`${job.repo.owner}/${job.repo.name}: ${problem}, cloning the game again`);
      rmSync(repoDir, { recursive: true, force: true });
    } else if (existsSync(unchecked)) {
      lib.replaceFile(join(repoDir, ".git", "config"), readFileSync(unchecked));
    }
  }
  rmSync(unchecked, { force: true });

  await ensureDeployKey(job, keyFile);
  const gitEnv = sshEnv(keyFile);
  if (!existsSync(join(repoDir, ".git"))) {
    reporter.step("Downloading the game's code");
    await run("git", ["clone", "--quiet", repoUrlOf(job.repo), repoDir], { extraEnv: gitEnv });
  }
  // The way in may have changed since the clone (a deploy key, or a token over HTTPS).
  await git(repoDir, ["remote", "set-url", "origin", repoUrlOf(job.repo)]);
  await git(repoDir, ["fetch", "--quiet", "--prune", "origin"], { extraEnv: gitEnv });
  const remote = await git(
    repoDir,
    ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${job.branch}`],
    {
      allowFail: true,
    },
  );
  if (remote.code !== 0) throw new Said(`The game's repo has no branch ${job.branch} on GitHub.`);
  await git(repoDir, ["checkout", "--quiet", "--force", "-B", job.branch, `origin/${job.branch}`]);
  await git(repoDir, ["reset", "--quiet", "--hard", `origin/${job.branch}`]);
  await git(repoDir, ["clean", "-fdxq", "-e", "node_modules"]);
  const base = (await git(repoDir, ["rev-parse", "HEAD"])).stdout.trim();
  const gitConfig = readFileSync(join(repoDir, ".git", "config"));
  // From here a container has the clone writable (the packages' install scripts, then
  // Claude), and git doesn't run in it until takeBackRepo has checked it. The config to put
  // back is kept outside the clone too, in case that never happens.
  writeFileSync(unchecked, gitConfig, { mode: 0o600 });
  await installDependencies(job, { repoDir, homeDir }, reporter);
  return { repoDir, homeDir, gitEnv, gitConfig, unchecked, base };
}

/**
 * The clone back from the containers that had it writable (the install's scripts, Claude),
 * before the server runs git there and pushes. If Claude finished, what it left uncommitted
 * is committed in the sandbox in between (commitLeftovers), and the clone taken back again.
 */
async function takeBackRepo(job, repo, { commit }) {
  await checkRepo(job, repo);
  if (commit) {
    await commitLeftovers(job, repo);
    await checkRepo(job, repo);
  }
  rmSync(repo.unchecked, { force: true });
}

/**
 * Its .git has to be what git makes (lib.gitDirProblem): if not, the turn fails, nothing is
 * pushed, and the next message clones the game again (prepareRepo). Its config is put back
 * as it was before the containers, as a new file, never written through what's there.
 */
async function checkRepo(job, repo) {
  // Gone for sure first: a docker client that died early leaves its container running
  if (CONFIG.sandbox === "docker")
    await run("docker", ["rm", "-f", lib.turnContainer(job.id), lib.installContainer(job.id)], {
      allowFail: true,
    });
  const problem = lib.gitDirProblem(repo.repoDir);
  if (problem) {
    log(
      `turn ${job.id}: ${problem} in ${job.repo.owner}/${job.repo.name} after the session, not pushing`,
    );
    throw new Said(
      `Claude left the game's .git folder in a state the build server doesn't trust (${problem}), so its changes weren't saved. Send the message again: Claude will start from a fresh copy of the game.`,
    );
  }
  lib.replaceFile(join(repo.repoDir, ".git", "config"), repo.gitConfig);
}

// bun install, inside the container (it runs the packages' install scripts), and only when
// the package files changed since the last time.
async function installDependencies(job, repo, reporter) {
  if (!existsSync(join(repo.repoDir, "package.json"))) return;
  const hash = createHash("sha256");
  for (const file of ["package.json", "bun.lock", "bun.lockb", "package-lock.json"]) {
    const path = join(repo.repoDir, file);
    if (existsSync(path)) hash.update(file).update(readFileSync(path));
  }
  const digest = hash.digest("hex");
  const stamp = join(CONFIG.state, "installed", repoSlug(job.repo));
  if (
    existsSync(join(repo.repoDir, "node_modules")) &&
    existsSync(stamp) &&
    readFileSync(stamp, "utf8") === digest
  )
    return;

  reporter.step("Installing the game's dependencies");
  const container = lib.installContainer(job.id);
  // Games first made in Lovable lock part of their packages to Lovable's copy of npm, which
  // the egress proxy doesn't reach. The install reads a bun.lock that takes those from npm
  // itself (same files: bun checks each one's sha512), and the game's own bun.lock is put
  // back as soon as it ends, before Claude starts: the repo, Claude and the push never see
  // the change, and the proxy needs no other site.
  const lockfile = join(repo.repoDir, "bun.lock");
  // Only a plain file: the server never writes through a link the repo could point anywhere
  const original = lstatSync(lockfile, { throwIfNoEntry: false })?.isFile()
    ? readFileSync(lockfile)
    : null;
  const forNpm = lib.lockfileForNpm(original?.toString("utf8") ?? "");
  if (forNpm.count) {
    writeFileSync(lockfile, forNpm.text);
    log(
      `bun install in ${job.repo.name}: ${forNpm.count} packages locked to an npm mirror come from registry.npmjs.org`,
    );
  }
  let result;
  try {
    result =
      CONFIG.sandbox === "docker"
        ? await (async () => {
            await run("docker", ["rm", "-f", container], { allowFail: true });
            return run(
              "docker",
              dockerArgs({ name: container, ...repo, command: ["bun", "install"] }),
              {
                allowFail: true,
                timeoutMs: 15 * 60_000,
              },
            );
          })()
        : await run("bun", ["install"], {
            cwd: repo.repoDir,
            allowFail: true,
            timeoutMs: 15 * 60_000,
          });
  } finally {
    if (forNpm.count) {
      // A timeout kills the docker client, not the container, which could still write it
      if (CONFIG.sandbox === "docker" && result?.code !== 0)
        await run("docker", ["rm", "-f", container], { allowFail: true }).catch(() => {});
      // A new file where it was: the packages' scripts ran with the repo writable, and one could
      // have left a link there to a file of the server's.
      rmSync(lockfile, { force: true });
      writeFileSync(lockfile, original, { flag: "wx" });
    }
  }
  if (result.code === 0) writeFileSync(stamp, digest);
  else {
    log(
      `bun install failed in ${job.repo.name}: ${result.stderr.trim().split("\n").slice(-3).join(" ")}`,
    );
    reporter.step("Installing the dependencies failed; Claude will see why");
  }
}

// --- One message -----------------------------------------------------------------------------

/** The reporters of the messages in progress: where each measures the weekly share from. */
const liveReporters = new Set();

/**
 * Sends the turn's events to the console about once a second while Claude works, and
 * hears back whether the person pressed Stop. The calls also tell the console the server
 * is alive during a long turn.
 */
class TurnReporter {
  constructor(id) {
    this.id = id;
    this.pending = [];
    this.sessionId = null;
    // The account's usage as Claude first and last reported it in this turn: the
    // difference is what the turn used (the console adds it to the chat's weekly share).
    this.usage = null;
    this.usageBefore = null;
    // Where the share is measured from while it runs: the earliest start of the messages
    // running alongside it (lib.budgetBaseline), so together they stop at the share.
    this.budgetFrom = null;
    this.budgetStop = false;
    this.cancelled = false;
    this.onCancel = null;
    this.lastSent = 0;
    this.sending = false;
    this.timer = setInterval(() => this.flush(), 1000);
    liveReporters.add(this);
  }

  add(events) {
    this.pending.push(...events);
  }

  step(label) {
    this.add([{ kind: "step", body: { tool: "setup", label } }]);
  }

  async flush(force = false) {
    if (this.sending) return;
    if (!force && !this.pending.length && Date.now() - this.lastSent < 5000) return;
    this.sending = true;
    const events = this.pending.splice(0, 100);
    try {
      const answer = await api("turn", { id: this.id, events, sessionId: this.sessionId });
      this.lastSent = Date.now();
      if (answer.cancel && !this.cancelled) {
        this.cancelled = true;
        log(`turn ${this.id}: stopped from the chat`);
        this.onCancel?.();
      }
    } catch (error) {
      this.pending.unshift(...events);
      log(`turn ${this.id}: couldn't send events (${error.message})`);
    } finally {
      this.sending = false;
    }
  }

  async close() {
    clearInterval(this.timer);
    liveReporters.delete(this);
    for (let attempt = 0; attempt < 5 && (this.pending.length || attempt === 0); attempt++) {
      while (this.sending) await sleep(0.2);
      await this.flush(true);
    }
  }
}

// One Claude session: streams what it does to the reporter as it goes.
async function runClaude(job, repo, reporter, { prompt, sessionId, attachments }) {
  const assistant = job.kind === "assistant";
  // Ruben gets neither the sites nor the keys: only the Build chat's sessions do.
  const environment = assistant ? { domains: [], variables: {} } : loadEnvironment();
  const args = assistant
    ? lib.assistantArgs({
        prompt,
        model: job.model,
        effort: job.effort,
        sessionId,
        maxTurns: CONFIG.maxTurns,
        systemPrompt: job.systemPrompt ?? "",
        mcpConfig: repo.mcpConfig,
      })
    : lib.claudeArgs({
        prompt: lib.promptWithAttachments(prompt, attachments.files, attachments.mount),
        model: job.model,
        effort: job.effort,
        sessionId,
        maxTurns: CONFIG.maxTurns,
        job: {
          ...job,
          attachmentsDir: attachments.mount,
          environment: {
            domains: environment.domains,
            variables: Object.keys(environment.variables),
          },
        },
      });
  let child;
  let secrets = null;
  const container = lib.turnContainer(job.id);
  if (CONFIG.sandbox === "docker") {
    secrets = tokenFile(container, loadAccount().token, {
      ...environment.variables,
      ...(repo.toolEnv ?? {}),
    });
    if (!assistant) allowSites(container, environment.domains);
    await run("docker", ["rm", "-f", container], { allowFail: true });
    child = spawn(
      "docker",
      dockerArgs({
        name: container,
        ...repo,
        attachmentsDir: attachments.dir,
        envFile: secrets,
        extraEnv: claudeEnv(job),
        command: ["claude", ...args],
      }),
      { env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] },
    );
  } else {
    child = spawn("claude", args, {
      cwd: repo.repoDir ?? repo.homeDir,
      env: {
        ...cleanEnv(),
        ...environment.variables,
        ...claudeEnv(job),
        ...(repo.toolEnv ?? {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  const stop = () => {
    if (CONFIG.sandbox === "docker") run("docker", ["kill", container], { allowFail: true });
    else child.kill("SIGTERM");
  };
  reporter.onCancel = stop;
  if (reporter.cancelled) stop();

  const lines = [];
  let size = 0;
  let result = null;
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-50_000)));
  createInterface({ input: child.stdout }).on("line", (line) => {
    if (size < 5_000_000) {
      lines.push(line);
      size += line.length;
    }
    const message = lib.parseLine(line);
    if (!message) return;
    if (message.type === "system" && message.subtype === "init" && message.session_id) {
      reporter.sessionId = message.session_id;
    } else if (message.type === "rate_limit_event") {
      const usage = lib.usageFrom(message.rate_limit_info);
      if (usage) {
        reporter.usage = { ...reporter.usage, ...usage };
        reporter.usageBefore ??= usage;
        reporter.budgetFrom ??= lib.budgetBaseline(
          usage,
          [...liveReporters].filter((r) => r !== reporter).map((r) => r.budgetFrom),
        );
        // The share ran out under this turn: stopped after this call, like Stop.
        if (!reporter.budgetStop && lib.overBudget(job.budget, reporter.budgetFrom, usage)) {
          reporter.budgetStop = true;
          log(`turn ${job.id}: the chat's weekly share is used up, stopping`);
          stop();
        }
      }
    } else if (message.type === "result") {
      result = message;
    }
    reporter.add(
      lib.eventsFrom(message, CONFIG.sandbox === "docker" ? "/work" : (repo.repoDir ?? "/")),
    );
  });

  let timedOut = false;
  const timer =
    CONFIG.turnMinutes > 0
      ? setTimeout(() => {
          timedOut = true;
          stop();
        }, CONFIG.turnMinutes * 60_000)
      : null;
  const code = await new Promise((resolve) => {
    child.on("error", (error) => {
      stderr += error.message;
      resolve(-1);
    });
    child.on("close", resolve);
  });
  clearTimeout(timer);
  if (secrets) rmSync(secrets, { force: true });
  if (CONFIG.sandbox === "docker") dropSites(container);
  keepLog(
    `${assistant ? "assistant" : repoSlug(job.repo)}-${job.id.slice(0, 8)}.jsonl`,
    lines.join("\n"),
  );
  if (result?.session_id) reporter.sessionId = result.session_id;
  if (reporter.budgetStop)
    return { ok: false, why: lib.budgetStopMessage(job.budget, reporter.usage) };
  return lib.readResult({
    result,
    code,
    stderr,
    timedOut,
    minutes: CONFIG.turnMinutes,
    cancelled: reporter.cancelled,
  });
}

// Puts the commits on GitHub. Someone else may have pushed meanwhile (another chat, Claude
// Code on the web): the commits then go on top of theirs, or, if they clash, to a branch of
// their own so nothing is lost.
async function push(job, repo) {
  const target = `HEAD:refs/heads/${job.branch}`;
  const options = { extraEnv: { ...repo.gitEnv, ...authorEnv(job) }, allowFail: true };
  const first = await git(
    repo.repoDir,
    ["push", "--quiet", "--no-verify", "origin", target],
    options,
  );
  if (first.code !== 0) {
    if (!/rejected|non-fast-forward|fetch first/i.test(first.stderr)) {
      throw new Said(
        `GitHub didn't accept Claude's changes: ${first.stderr.trim().split("\n").slice(-2).join(" ")}`,
      );
    }
    await git(repo.repoDir, ["fetch", "--quiet", "origin"], options);
    const rebase = await git(repo.repoDir, ["rebase", "--quiet", `origin/${job.branch}`], options);
    if (rebase.code !== 0) {
      await git(repo.repoDir, ["rebase", "--abort"], options);
      const side = `build-chat/${job.id.slice(0, 8)}`;
      await git(
        repo.repoDir,
        ["push", "--quiet", "--no-verify", "--force", "origin", `HEAD:refs/heads/${side}`],
        options,
      );
      throw new Said(
        `Someone else changed the game at the same time and Claude's changes clash with theirs, so they weren't applied (they're kept on the branch ${side}). Send your message again and Claude will redo it on the latest version.`,
      );
    }
    const second = await git(
      repo.repoDir,
      ["push", "--quiet", "--no-verify", "origin", target],
      options,
    );
    if (second.code !== 0)
      throw new Said(`GitHub didn't accept Claude's changes: ${second.stderr.trim().slice(-300)}`);
  }
  return (await git(repo.repoDir, ["rev-parse", "HEAD"])).stdout.trim();
}

/**
 * The keys of Settings → Claude whose value is in the commits about to be pushed (every
 * commit, not just the end result: a key added and then removed stays in the history).
 * The patch is read as it comes, never whole, and no key goes on a command line.
 */
async function leakedSecrets(repo, range) {
  const { variables } = loadEnvironment();
  const keep = lib.longestSecret(variables);
  if (!keep) return [];
  const found = new Set();
  await new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      [...GIT_SAFE, "log", "-p", "--text", "--no-color", "--no-ext-diff", "--format=%H %s", range],
      { cwd: repo.repoDir, env: cleanEnv(), stdio: ["ignore", "pipe", "ignore"] },
    );
    let tail = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      const text = tail + chunk;
      for (const name of lib.secretsIn(text, variables)) found.add(name);
      tail = text.slice(-keep);
    });
    child.on("error", reject);
    child.on("close", resolve);
  });
  return [...found].sort();
}

/**
 * What a finished session left uncommitted becomes a commit of its own, made in the sandbox
 * like the install (lib.commitLeftoversCommand), between two checks of the repo (takeBackRepo).
 */
async function commitLeftovers(job, repo) {
  const command = lib.commitLeftoversCommand();
  const container = lib.turnContainer(job.id);
  const result =
    CONFIG.sandbox === "docker"
      ? await (async () => {
          await run("docker", ["rm", "-f", container], { allowFail: true });
          return run(
            "docker",
            dockerArgs({ name: container, ...repo, extraEnv: authorEnv(job), command }),
            { allowFail: true, timeoutMs: 5 * 60_000 },
          );
        })()
      : await run(command[0], command.slice(1), {
          cwd: repo.repoDir,
          extraEnv: authorEnv(job),
          allowFail: true,
          timeoutMs: 5 * 60_000,
        });
  if (result.code !== 0) {
    const tail = result.stderr.trim().split("\n").slice(-2).join(" ").slice(-300);
    log(`turn ${job.id}: committing what Claude left failed (${result.code}): ${tail}`);
    throw new Said(
      `Claude's last changes couldn't be committed (${tail || `exit ${result.code}`}), so nothing was saved. Send the message again.`,
    );
  }
}

// What the session left in the repo becomes the turn's result: commits pushed, or why not.
async function settle(job, repo, outcome, reporter) {
  // A stopped or failed session may have left a change half done: only its commits count.
  if (!outcome.ok) await git(repo.repoDir, ["reset", "--quiet", "--hard", "HEAD"]);

  const commits = Number(
    (await git(repo.repoDir, ["rev-list", "--count", `origin/${job.branch}..HEAD`])).stdout.trim(),
  );
  let pushedSha = null;
  let error = outcome.ok ? null : outcome.why;
  if (commits > 0) {
    const files = (
      await git(repo.repoDir, ["diff", "--name-only", `origin/${job.branch}...HEAD`])
    ).stdout
      .split("\n")
      .filter(Boolean);
    const touched = lib.protectedPaths(files);
    const leaked = await leakedSecrets(repo, `origin/${job.branch}..HEAD`);
    if (touched.length) {
      error = `Claude changed files that the console manages (${touched.join(", ")}), so its changes weren't saved. Ask again, and say not to touch those files.`;
      await git(repo.repoDir, ["reset", "--quiet", "--hard", `origin/${job.branch}`]);
    } else if (leaked.length) {
      log(`turn ${job.id}: the commits carry the value of ${leaked.join(", ")}, not pushed`);
      error = `Claude put ${leaked.length === 1 ? "a key" : "keys"} from Settings → Claude → Internet and keys (${leaked.join(", ")}) into the game's files, so its changes weren't saved: anyone who opens the game could have taken ${leaked.length === 1 ? "it" : "them"}. Ask again, and say to use the key only while working, never in the game.`;
      await git(repo.repoDir, ["reset", "--quiet", "--hard", `origin/${job.branch}`]);
    } else {
      reporter.step("Saving the changes to GitHub");
      try {
        pushedSha = await push(job, repo);
      } catch (pushError) {
        error = pushError.message;
      }
    }
  }
  const status = reporter.cancelled ? "cancelled" : error ? "failed" : "done";
  return { status, reply: outcome.reply ?? null, error, commits, pushedSha };
}

// --- Attachments ---------------------------------------------------------------------------------

/**
 * The files sent with the message, fetched from the console's Storage (a signed link each)
 * into the chat's folder, which Claude's container sees as /attachments. Earlier messages'
 * files stay in the folder, so Claude can go back to them.
 */
async function fetchAttachments(job, reporter) {
  const none = { dir: null, mount: ATTACHMENTS_MOUNT, files: [] };
  const wanted = Array.isArray(job.attachments) ? job.attachments : [];
  if (!wanted.length) return none;
  const dir = join(ATTACHMENTS, String(job.chatId ?? job.id).replace(/[^\w-]/g, ""));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  reporter.step(
    wanted.length === 1
      ? "Fetching the attached file"
      : `Fetching the ${wanted.length} attached files`,
  );
  const files = [];
  const taken = [];
  for (const attachment of wanted) {
    const name = lib.uniqueFileName(lib.safeFileName(attachment.name), taken);
    taken.push(name);
    if (!attachment.url) throw new Said(`The console gave no link to the attached file ${name}.`);
    let bytes;
    try {
      const response = await fetch(attachment.url, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`it answered ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      throw new Said(
        `The attached file ${name} couldn't be fetched (${error.message}). Send the message again.`,
      );
    }
    if (bytes.length > ATTACHMENT_MAX_BYTES)
      throw new Said(`The attached file ${name} is too big (${lib.formatBytes(bytes.length)}).`);
    writeFileSync(join(dir, name), bytes, { mode: 0o600 });
    files.push({ name, contentType: attachment.contentType, size: bytes.length });
  }
  return {
    dir,
    mount: CONFIG.sandbox === "docker" ? ATTACHMENTS_MOUNT : dir,
    files,
  };
}

/** Chats' attachment folders untouched for two months are dropped. */
function pruneAttachments() {
  if (!existsSync(ATTACHMENTS)) return;
  const before = Date.now() - 60 * 24 * 3600_000;
  for (const name of readdirSync(ATTACHMENTS)) {
    const dir = join(ATTACHMENTS, name);
    if (statSync(dir).mtimeMs < before) rmSync(dir, { recursive: true, force: true });
  }
}

// null where there's no /proc (a laptop trying the runner out)
function freeMegabytes() {
  return existsSync("/proc/meminfo")
    ? lib.availableMegabytes(readFileSync("/proc/meminfo", "utf8"))
    : null;
}

async function doTurn(job) {
  const assistant = job.kind === "assistant";
  log(
    `turn ${job.id}: ${assistant ? "the assistant" : `${job.repo.owner}/${job.repo.name}`} (${job.model}, ${job.effort ?? "default effort"})`,
  );
  const reporter = new TurnReporter(job.id);
  let report;
  try {
    if (CONFIG.sandbox === "docker" && !loadAccount()?.token) {
      throw new Said("No Claude account is linked. Link one in Settings → Claude.");
    }
    // With others running, freeSlots already found room for this one before taking it.
    const free = running.size <= 1 ? freeMegabytes() : null;
    if (free !== null && free < CONFIG.minFreeMb) {
      log(
        `turn ${job.id}: only ${free} MB of memory free (it needs ${CONFIG.minFreeMb}), not starting`,
      );
      throw new Said(
        "The build server is short of memory right now, so Claude didn't start. Send the message again in a few minutes.",
      );
    }
    // The console gives a game one message at a time; its clone can't take two either.
    const sameGame = [...running.values()].some(
      (other) =>
        other.job.id !== job.id &&
        other.job.repo &&
        job.repo &&
        repoSlug(other.job.repo) === repoSlug(job.repo),
    );
    if (sameGame)
      throw new Said(
        "Claude is already working on this game. Send the message again when it's done.",
      );
    const repo = assistant ? prepareAssistant(job) : await prepareRepo(job, reporter);
    pruneAttachments();
    const attachments = assistant
      ? { dir: null, mount: ATTACHMENTS_MOUNT, files: [] }
      : await fetchAttachments(job, reporter);
    let outcome = { ok: false, why: "Stopped." };
    if (!reporter.cancelled) {
      reporter.sessionId = job.sessionId ?? null;
      outcome = await runClaude(job, repo, reporter, {
        prompt: job.prompt,
        sessionId: job.sessionId,
        attachments,
      });
      if (outcome.missingSession) {
        log(`turn ${job.id}: session ${job.sessionId} isn't here, starting a new one`);
        reporter.sessionId = null;
        outcome = await runClaude(job, repo, reporter, {
          prompt: lib.promptWithLostHistory(job.prompt),
          sessionId: null,
          attachments,
        });
      }
      if (outcome.rejected) markRejected();
    }
    if (!assistant) await takeBackRepo(job, repo, { commit: outcome.ok });
    report = assistant
      ? {
          status: reporter.cancelled ? "cancelled" : outcome.ok ? "done" : "failed",
          reply: outcome.reply ?? null,
          error: outcome.ok ? null : outcome.why,
          commits: 0,
          pushedSha: null,
        }
      : await settle(job, repo, outcome, reporter);
  } catch (error) {
    if (!(error instanceof Said)) log(`turn ${job.id}: ${error.stack ?? error.message}`);
    report = {
      status: "failed",
      error:
        error instanceof Said ? error.message : `The build server couldn't do it: ${error.message}`,
    };
  }
  await reporter.close();
  await sendFinish(job.id, {
    ...report,
    sessionId: reporter.sessionId,
    usage: reporter.usage,
    usageBefore: reporter.usageBefore,
  });
  log(
    `turn ${job.id}: ${report.status}${report.pushedSha ? ` (pushed ${report.pushedSha.slice(0, 7)})` : ""}`,
  );
}

// --- Linking an account ----------------------------------------------------------------------

/**
 * One tiny Claude call with the token (lib.pingArgs): whether Claude accepts it, and the
 * account's usage as it reports it. Checks a token before it's kept, and reads the usage
 * when a page asks for a fresh one (doUsageRefresh).
 */
async function claudePing(token) {
  const args = lib.pingArgs(CHECK_MODEL);
  let ran;
  if (CONFIG.sandbox === "docker") {
    const secrets = tokenFile("bgp-agent-check", token);
    try {
      await run("docker", ["rm", "-f", "bgp-agent-check"], { allowFail: true });
      ran = await run(
        "docker",
        dockerArgs({ name: "bgp-agent-check", envFile: secrets, command: ["claude", ...args] }),
        { allowFail: true, timeoutMs: 120_000 },
      );
    } finally {
      rmSync(secrets, { force: true });
    }
  } else {
    // Without the sandbox, the machine's own login.
    ran = await run("claude", args, { allowFail: true, timeoutMs: 120_000 });
  }
  const lines = ran.stdout.split("\n").map(lib.parseLine).filter(Boolean);
  const outcome = lib.readResult({
    result: lines.findLast((l) => l.type === "result"),
    code: ran.code,
    stderr: ran.stderr,
  });
  const info = lines.findLast((l) => l.type === "rate_limit_event")?.rate_limit_info;
  return { ...outcome, usage: lib.usageFrom(info) };
}

// A token is only kept once Claude has answered with it.
const checkToken = claudePing;

/**
 * A page asked for a fresh reading of the account's usage (the one the console has is
 * from the last message, hours old by now): one tiny call, and the answer goes to the
 * console (/api/agent/usage).
 */
async function doUsageRefresh() {
  const token = loadAccount()?.token;
  if (CONFIG.sandbox === "docker" && !token) return;
  log("reading the account's usage");
  try {
    const ping = await claudePing(token);
    if (ping.rejected) markRejected();
    await api("usage", { usage: ping.usage, error: ping.ok ? undefined : ping.why });
    const windows = [
      ping.usage?.weekly && `${ping.usage.weekly.percent}% of the week`,
      ping.usage?.fiveHour && `${ping.usage.fiveHour.percent}% of the 5 hours`,
    ].filter(Boolean);
    log(windows.length ? `usage: ${windows.join(", ")}` : `the usage wasn't reported: ${ping.why}`);
  } catch (error) {
    log(`reading the usage: ${error.message}`);
    await api("usage", { error: error.message }).catch(() => {});
  }
}

async function keepToken(login, token) {
  const check = await checkToken(token);
  if (!check.ok) {
    await api("login", {
      id: login.id,
      error: `claude.ai gave a token, but Claude didn't accept it: ${check.why}`,
    });
    return;
  }
  saveAccount({
    token,
    linkedAt: new Date().toISOString(),
    linkedBy: login.createdByEmail ?? null,
  });
  await api("login", { id: login.id, linked: accountSummary(), usage: check.usage });
  log("Claude account linked");
}

// `claude setup-token`, the real one, in a pretend terminal (script): its claude.ai link
// goes to the page, the person signs in there with the account to use and pastes the code
// claude.ai shows, and the CLI turns it into a year-long token. This container has the
// normal network: the CLI has to reach claude.ai, and no outside text gets into it.
async function linkAccount(login) {
  await run("docker", ["rm", "-f", LOGIN_CONTAINER], { allowFail: true });
  const { uid, gid } = userInfo();
  const command = [
    "stty cols 1000 rows 50; exec docker run --rm -it",
    `--name ${LOGIN_CONTAINER} --memory 512m --memory-swap 512m --oom-score-adj 1000 --cap-drop ALL --security-opt no-new-privileges --user ${uid}:${gid}`,
    `--tmpfs /home/agent:rw,size=64m,uid=${uid},gid=${gid},mode=0700 -e HOME=/home/agent -e TERM=xterm`,
    `${CONFIG.image} claude setup-token`,
  ].join(" ");
  const child = spawn("script", ["-qfec", command, "/dev/null"], {
    env: cleanEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  // While it waits for the code the CLI keeps redrawing an animated logo; what it says after
  // the code is kept apart, so the trimming of the first can't lose it.
  let raw = "";
  let after = null;
  const take = (chunk) => {
    raw = (raw + chunk).slice(-200_000);
    if (after !== null) after = (after + chunk).slice(-200_000);
  };
  child.stdout.on("data", take);
  child.stderr.on("data", take);
  const deadline = Date.now() + 10 * 60_000;
  try {
    let url = null;
    while (!url && child.exitCode === null && Date.now() < deadline) {
      await sleep(1);
      url = lib.loginUrl(lib.plainText(raw));
    }
    if (!url) {
      await api("login", {
        id: login.id,
        error: "The Claude CLI didn't give a link to sign in with.",
      });
      return;
    }
    let answer = await api("login", { id: login.id, url });
    let code = null;
    while (!code && answer.status === "waiting_code" && Date.now() < deadline) {
      await sleep(2);
      answer = await api("login", { id: login.id });
      if (answer.status === "checking") code = answer.code ?? null;
    }
    if (!code) return;
    after = "";
    // Enter on its own: a long code with Enter stuck to it reads as a paste and isn't sent.
    child.stdin.write(code);
    await sleep(1);
    child.stdin.write("\r");

    let token = null;
    let error = null;
    for (const until = Date.now() + 90_000; !token && !error && Date.now() < until; ) {
      await sleep(1);
      const said = lib.plainText(after);
      token = lib.loginToken(said);
      error = lib.loginError(said);
    }
    if (token) await keepToken(login, token);
    else {
      keepLog(
        "login.txt",
        lib
          .plainText(after)
          .replace(/sk-ant-[\w-]+/g, "sk-ant-…")
          .slice(-4000),
      );
      await api("login", {
        id: login.id,
        error: error ?? "The Claude CLI didn't return a token. Try again.",
      });
    }
  } finally {
    child.kill("SIGKILL");
    await run("docker", ["rm", "-f", LOGIN_CONTAINER], { allowFail: true });
  }
}

async function doLogin(login) {
  log(`linking a Claude account (${login.mode})`);
  try {
    if (CONFIG.sandbox !== "docker") {
      await api("login", {
        id: login.id,
        error: "This build server runs without its sandbox and uses its own login.",
      });
    } else if (login.mode === "token") {
      const token = String(login.token ?? "").trim();
      if (!lib.isClaudeToken(token)) {
        await api("login", {
          id: login.id,
          error:
            "That doesn't look like a token from `claude setup-token` (they start with sk-ant-oat).",
        });
      } else await keepToken(login, token);
    } else await linkAccount(login);
  } catch (error) {
    log(`linking an account: ${error.message}`);
    await api("login", {
      id: login.id,
      error: `The build server couldn't link it: ${error.message}`,
    }).catch(() => {});
  }
}

// --- The loop -------------------------------------------------------------------------------------

// What each session printed, to look at when something went wrong (the last 60).
function keepLog(name, text) {
  mkdirSync(LOGS, { recursive: true, mode: 0o700 });
  writeFileSync(join(LOGS, `${new Date().toISOString().replaceAll(":", "-")}-${name}`), text, {
    mode: 0o600,
  });
  const files = readdirSync(LOGS)
    .map((file) => ({ file, at: statSync(join(LOGS, file)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  for (const { file } of files.slice(60)) rmSync(join(LOGS, file), { force: true });
}

// --- The messages in progress -------------------------------------------------------------------

/** The messages being worked on now, by turn id. */
const running = new Map();

function saveRunning() {
  if (running.size)
    writeFileSync(CURRENT, JSON.stringify({ ids: [...running.keys()] }), { mode: 0o600 });
  else rmSync(CURRENT, { force: true });
}

/** The messages a previous run was on (version 5 kept a single one). */
function savedRunning() {
  try {
    const saved = JSON.parse(readFileSync(CURRENT, "utf8"));
    return Array.isArray(saved.ids) ? saved.ids : saved.id ? [saved.id] : [];
  } catch {
    return [];
  }
}

function startTurn(job) {
  const entry = { job, promise: null };
  running.set(job.id, entry);
  saveRunning();
  entry.promise = doTurn(job)
    .catch((error) => log(`turn ${job.id}: ${error.stack ?? error.message}`))
    .finally(() => {
      running.delete(job.id);
      saveRunning();
    });
}

/** Resolves when one of the messages in progress ends (never, with none). */
const anyTurnEnds = () => Promise.race([...running.values()].map((entry) => entry.promise));

/** What each running message's containers use now, in megabytes (0 before it has any). */
async function runningMemory() {
  const ids = [...running.keys()];
  if (CONFIG.sandbox !== "docker") return ids.map(() => 0);
  const stats = await run(
    "docker",
    ["stats", "--no-stream", "--format", "{{.Name}}\t{{.MemUsage}}"],
    { allowFail: true, timeoutMs: 30_000 },
  );
  // If docker can't say, nothing counts as used: the most cautious reading
  const used = lib.containerMemory(stats.stdout);
  return ids.map(
    (id) => (used[lib.turnContainer(id)] ?? 0) + (used[lib.installContainer(id)] ?? 0),
  );
}

/**
 * How many more messages may start now. None past AGENT_PARALLEL. The first one always: if
 * the machine is short of memory, doTurn says so in its chat. Another one only when the
 * machine has room for it with the running ones at their limit (lib.roomForAnotherTurn);
 * until then it waits in the queue, and its chat says what it waits for.
 */
async function freeSlots() {
  if (running.size >= CONFIG.parallel) return 0;
  if (!running.size) return CONFIG.parallel;
  const room = lib.roomForAnotherTurn({
    availableMb: freeMegabytes(),
    limitMb: lib.megabytes(CONFIG.memory) ?? CONFIG.minFreeMb,
    minFreeMb: CONFIG.minFreeMb,
    used: await runningMemory(),
  });
  return room ? CONFIG.parallel - running.size : 0;
}

// Messages cut short by a restart: their chats say so instead of waiting forever.
async function recover() {
  if (CONFIG.sandbox === "docker") {
    // Version 5's single file of sites, and the files of the messages that were running
    rmSync(join(EGRESS_DIR, "allow"), { force: true });
    rmSync(TURN_SITES, { recursive: true, force: true });
    const { stdout } = await run("docker", ["ps", "-a", "--format", "{{.Names}}"], {
      allowFail: true,
    });
    const leftovers = stdout
      .split("\n")
      .map((name) => name.trim())
      .filter(lib.isLeftoverContainer);
    await run("docker", ["rm", "-f", ...leftovers, LOGIN_CONTAINER, "bgp-agent-check"], {
      allowFail: true,
    });
  }
  for (const id of savedRunning()) {
    await sendFinish(id, {
      status: "failed",
      error: "The build server restarted in the middle of this message. Send it again.",
    });
  }
  rmSync(CURRENT, { force: true });
}

// When install.sh leaves new code while messages run, the service stops taking new ones,
// exits once they end, and systemd starts it again with the new code.
const CODE = ["runner.mjs", "lib.mjs"].map((file) => new URL(file, import.meta.url));
const codeStamp = () => CODE.map((file) => statSync(file).mtimeMs).join(",");
const STARTED_WITH = codeStamp();

async function main() {
  if (!CONFIG.runnerToken) throw new Error("AGENT_RUNNER_TOKEN is missing (/etc/bgp-agent.env)");
  mkdirSync(CONFIG.state, { recursive: true, mode: 0o700 });
  log(
    `build server ${VERSION} (${CONFIG.sandbox}, up to ${CONFIG.parallel} messages at once) asking ${CONFIG.console} for work`,
  );
  await recover();
  let connected = false;
  let draining = false;
  // A console from before version 6 takes a message still running at a poll for one the
  // server lost. Until the console says it knows better, the server only asks between
  // messages, as before.
  let consoleRunsSeveral = false;
  for (;;) {
    if (!draining && codeStamp() !== STARTED_WITH) {
      draining = true;
      log(
        running.size
          ? `new code: restarting when the ${running.size} message(s) in progress end`
          : "new code: restarting",
      );
    }
    if (draining || (running.size && !consoleRunsSeveral)) {
      if (!running.size) process.exit(0);
      await anyTurnEnds();
      continue;
    }
    let work;
    try {
      work = await api("poll", {
        host: CONFIG.name,
        version: VERSION,
        account: accountSummary(),
        environment: lib.environmentSummary(loadEnvironment()),
        running: [...running.keys()],
        slots: await freeSlots(),
        parallel: CONFIG.parallel,
      });
    } catch (error) {
      log(error.message);
      connected = false;
      await sleep(20);
      continue;
    }
    // Only the changes are logged: a working server polls in silence.
    if (!connected)
      log(`connected to the console${accountSummary() ? "" : " (no Claude account linked yet)"}`);
    connected = true;
    if ((work.several === true) !== consoleRunsSeveral)
      log(
        work.several === true
          ? `the console hands out several messages at once (up to ${CONFIG.parallel} here)`
          : "the console hands out one message at a time",
      );
    consoleRunsSeveral = work.several === true;
    if (work.unlink) {
      rmSync(ACCOUNT, { force: true });
      log("Claude account unlinked");
    } else if (work.login) await doLogin(work.login);
    else if (work.environment) await doEnvironment(work.environment);
    else if (work.turn) startTurn(work.turn);
    else if (work.refreshUsage) await doUsageRefresh();
    // A message ending frees a place: the next one in the queue starts right away.
    else await Promise.race([sleep(work.pollSeconds ?? 10), anyTurnEnds()]);
  }
}

main().catch((error) => {
  log(error.stack ?? error.message);
  process.exit(1);
});
