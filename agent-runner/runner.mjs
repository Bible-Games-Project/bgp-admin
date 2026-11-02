// The build server behind the console's Build chat (bgp-admin, /apps/<id>/build). It asks
// the console for work (/api/agent/poll) and, for each chat message, runs the Claude CLI on
// a clone of the game's repo, in a container whose only ways out are the Claude API and
// the npm registry. When Claude finishes it pushes the commits to the game's branch, which
// deploys the Cloudflare preview the page shows next to the chat.
//
// It also holds the Claude account it works with. Settings → Claude asks for a link; this
// runs `claude setup-token` and passes the claude.ai link and the code back and forth
// through the console. The token only lives here (STATE_DIR/claude.json): the console sees
// its last four characters.
//
// Runs as the systemd service bgp-agent (bgp-agent.service), user bgp-agent, set up by
// install.sh. See README.md.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { hostname, userInfo } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import * as lib from "./lib.mjs";

const VERSION = "1";
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
  turnMinutes: Number(env.TURN_MINUTES ?? 30),
  maxTurns: Number(env.MAX_TURNS ?? 200),
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
const ACCOUNT = join(CONFIG.state, "claude.json");
const CURRENT = join(CONFIG.state, "current.json");
const LOGS = join(CONFIG.state, "logs");
const KNOWN_HOSTS = join(CONFIG.state, ".ssh", "known_hosts");
const TURN_CONTAINER = "bgp-agent-turn";
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
// session (prepareRepo).
const git = (repoDir, args, options = {}) =>
  run("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], {
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

// --- Containers --------------------------------------------------------------------------

function dockerArgs({
  name,
  network = CONFIG.network,
  repoDir,
  homeDir,
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
    ...(repoDir ? ["-v", `${repoDir}:/work`, "-w", "/work"] : []),
    ...(homeDir
      ? ["-v", `${homeDir}:/home/agent`]
      : ["--tmpfs", `/home/agent:rw,size=64m,uid=${uid},gid=${gid},mode=0700`]),
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

// The token reaches a container through a file only it reads, never through argv.
function tokenFile(name, token) {
  const dir = join(CONFIG.state, "run");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${name}.env`);
  writeFileSync(file, `CLAUDE_CODE_OAUTH_TOKEN=${token}\n`, { mode: 0o600 });
  return file;
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
      writeFileSync(
        ASKPASS,
        '#!/bin/sh\ncase "$1" in Username*) echo x-access-token ;; *) echo "$GIT_PUSH_TOKEN" ;; esac\n',
        {
          mode: 0o700,
        },
      );
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

// The repo exactly as it is on GitHub, plus node_modules: whatever a previous turn left
// that never reached GitHub is gone.
async function prepareRepo(job, reporter) {
  const slug = repoSlug(job.repo);
  const repoDir = join(CONFIG.state, "repos", slug);
  const homeDir = join(CONFIG.state, "homes", slug);
  const keyFile = join(CONFIG.state, "keys", slug);
  for (const dir of ["repos", "homes", "keys", "installed"])
    mkdirSync(join(CONFIG.state, dir), { recursive: true, mode: 0o700 });
  mkdirSync(homeDir, { recursive: true, mode: 0o700 });

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
  const gitConfig = readFileSync(join(repoDir, ".git", "config"));
  await installDependencies(job, { repoDir, homeDir }, reporter);
  const base = (await git(repoDir, ["rev-parse", "HEAD"])).stdout.trim();
  return { repoDir, homeDir, gitEnv, gitConfig, base };
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
  const result =
    CONFIG.sandbox === "docker"
      ? await (async () => {
          await run("docker", ["rm", "-f", TURN_CONTAINER], { allowFail: true });
          return run(
            "docker",
            dockerArgs({ name: TURN_CONTAINER, ...repo, command: ["bun", "install"] }),
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
  if (result.code === 0) writeFileSync(stamp, digest);
  else {
    log(
      `bun install failed in ${job.repo.name}: ${result.stderr.trim().split("\n").slice(-3).join(" ")}`,
    );
    reporter.step("Installing the dependencies failed; Claude will see why");
  }
}

// --- One message -----------------------------------------------------------------------------

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
    this.usage = null;
    this.cancelled = false;
    this.onCancel = null;
    this.lastSent = 0;
    this.sending = false;
    this.timer = setInterval(() => this.flush(), 1000);
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
    for (let attempt = 0; attempt < 5 && (this.pending.length || attempt === 0); attempt++) {
      while (this.sending) await sleep(0.2);
      await this.flush(true);
    }
  }
}

// One Claude session: streams what it does to the reporter as it goes.
async function runClaude(job, repo, reporter, { prompt, sessionId }) {
  const args = lib.claudeArgs({
    prompt,
    model: job.model,
    effort: job.effort,
    sessionId,
    maxTurns: CONFIG.maxTurns,
    job,
  });
  let child;
  let secrets = null;
  if (CONFIG.sandbox === "docker") {
    secrets = tokenFile(TURN_CONTAINER, loadAccount().token);
    await run("docker", ["rm", "-f", TURN_CONTAINER], { allowFail: true });
    child = spawn(
      "docker",
      dockerArgs({
        name: TURN_CONTAINER,
        ...repo,
        envFile: secrets,
        extraEnv: authorEnv(job),
        command: ["claude", ...args],
      }),
      { env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] },
    );
  } else {
    child = spawn("claude", args, {
      cwd: repo.repoDir,
      env: { ...cleanEnv(), ...authorEnv(job) },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  const stop = () => {
    if (CONFIG.sandbox === "docker") run("docker", ["kill", TURN_CONTAINER], { allowFail: true });
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
      reporter.usage = { ...reporter.usage, ...lib.usageFrom(message.rate_limit_info) };
    } else if (message.type === "result") {
      result = message;
    }
    reporter.add(lib.eventsFrom(message, CONFIG.sandbox === "docker" ? "/work" : repo.repoDir));
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, CONFIG.turnMinutes * 60_000);
  const code = await new Promise((resolve) => {
    child.on("error", (error) => {
      stderr += error.message;
      resolve(-1);
    });
    child.on("close", resolve);
  });
  clearTimeout(timer);
  if (secrets) rmSync(secrets, { force: true });
  keepLog(`${repoSlug(job.repo)}-${job.id.slice(0, 8)}.jsonl`, lines.join("\n"));
  if (result?.session_id) reporter.sessionId = result.session_id;
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

// What the session left in the repo becomes the turn's result: commits pushed, or why not.
async function settle(job, repo, outcome, reporter) {
  const dirty = (await git(repo.repoDir, ["status", "--porcelain"])).stdout.trim();
  if (dirty && outcome.ok) {
    await git(repo.repoDir, ["add", "-A"]);
    await git(
      repo.repoDir,
      ["commit", "--quiet", "--no-verify", "-m", lib.LEFTOVER_COMMIT_MESSAGE],
      {
        extraEnv: authorEnv(job),
      },
    );
  } else if (dirty) {
    // A stopped or failed session may have left a change half done: only its commits count.
    await git(repo.repoDir, ["reset", "--quiet", "--hard", "HEAD"]);
  }

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
    if (touched.length) {
      error = `Claude changed files that the console manages (${touched.join(", ")}), so its changes weren't saved. Ask again, and say not to touch those files.`;
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

async function doTurn(job) {
  log(
    `turn ${job.id}: ${job.repo.owner}/${job.repo.name} (${job.model}, ${job.effort ?? "default effort"})`,
  );
  writeFileSync(CURRENT, JSON.stringify({ id: job.id }), { mode: 0o600 });
  const reporter = new TurnReporter(job.id);
  let report;
  try {
    if (CONFIG.sandbox === "docker" && !loadAccount()?.token) {
      throw new Said("No Claude account is linked. Link one in Settings → Claude.");
    }
    const repo = await prepareRepo(job, reporter);
    let outcome = { ok: false, why: "Stopped." };
    if (!reporter.cancelled) {
      reporter.sessionId = job.sessionId ?? null;
      outcome = await runClaude(job, repo, reporter, {
        prompt: job.prompt,
        sessionId: job.sessionId,
      });
      if (outcome.missingSession) {
        log(`turn ${job.id}: session ${job.sessionId} isn't here, starting a new one`);
        reporter.sessionId = null;
        outcome = await runClaude(job, repo, reporter, {
          prompt: lib.promptWithLostHistory(job.prompt),
          sessionId: null,
        });
      }
      writeFileSync(join(repo.repoDir, ".git", "config"), repo.gitConfig);
      if (outcome.rejected) markRejected();
    }
    report = await settle(job, repo, outcome, reporter);
  } catch (error) {
    if (!(error instanceof Said)) log(`turn ${job.id}: ${error.stack ?? error.message}`);
    report = {
      status: "failed",
      error:
        error instanceof Said ? error.message : `The build server couldn't do it: ${error.message}`,
    };
  }
  await reporter.close();
  await sendFinish(job.id, { ...report, sessionId: reporter.sessionId, usage: reporter.usage });
  log(
    `turn ${job.id}: ${report.status}${report.pushedSha ? ` (pushed ${report.pushedSha.slice(0, 7)})` : ""}`,
  );
  rmSync(CURRENT, { force: true });
}

// --- Linking an account ----------------------------------------------------------------------

// A token is only kept once Claude has answered with it.
async function checkToken(token) {
  const secrets = tokenFile("bgp-agent-check", token);
  try {
    await run("docker", ["rm", "-f", "bgp-agent-check"], { allowFail: true });
    const { code, stdout, stderr } = await run(
      "docker",
      dockerArgs({
        name: "bgp-agent-check",
        envFile: secrets,
        command: [
          "claude",
          "-p",
          "Reply with the word OK.",
          "--model",
          CHECK_MODEL,
          "--max-turns",
          "1",
          "--output-format",
          "stream-json",
          "--verbose",
          "--tools",
          "",
        ],
      }),
      { allowFail: true, timeoutMs: 120_000 },
    );
    const lines = stdout.split("\n").map(lib.parseLine).filter(Boolean);
    const outcome = lib.readResult({
      result: lines.findLast((l) => l.type === "result"),
      code,
      stderr,
    });
    const info = lines.findLast((l) => l.type === "rate_limit_event")?.rate_limit_info;
    return { ...outcome, usage: lib.usageFrom(info) };
  } finally {
    rmSync(secrets, { force: true });
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
    `--name ${LOGIN_CONTAINER} --memory 512m --cap-drop ALL --security-opt no-new-privileges --user ${uid}:${gid}`,
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

// A turn cut short by a restart: the chat says so instead of waiting forever.
async function recover() {
  if (CONFIG.sandbox === "docker") {
    await run("docker", ["rm", "-f", TURN_CONTAINER, LOGIN_CONTAINER, "bgp-agent-check"], {
      allowFail: true,
    });
  }
  if (!existsSync(CURRENT)) return;
  const { id } = JSON.parse(readFileSync(CURRENT, "utf8"));
  await sendFinish(id, {
    status: "failed",
    error: "The build server restarted in the middle of this message. Send it again.",
  });
  rmSync(CURRENT, { force: true });
}

// When install.sh leaves new code while a turn runs, the service exits after it and systemd
// starts it again with the new code.
const CODE = ["runner.mjs", "lib.mjs"].map((file) => new URL(file, import.meta.url));
const codeStamp = () => CODE.map((file) => statSync(file).mtimeMs).join(",");
const STARTED_WITH = codeStamp();

async function main() {
  if (!CONFIG.runnerToken) throw new Error("AGENT_RUNNER_TOKEN is missing (/etc/bgp-agent.env)");
  mkdirSync(CONFIG.state, { recursive: true, mode: 0o700 });
  log(`build server ${VERSION} (${CONFIG.sandbox}) asking ${CONFIG.console} for work`);
  await recover();
  let connected = false;
  for (;;) {
    if (codeStamp() !== STARTED_WITH) {
      log("new code: restarting");
      process.exit(0);
    }
    let work;
    try {
      work = await api("poll", { host: CONFIG.name, version: VERSION, account: accountSummary() });
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
    if (work.unlink) {
      rmSync(ACCOUNT, { force: true });
      log("Claude account unlinked");
    } else if (work.login) await doLogin(work.login);
    else if (work.turn) await doTurn(work.turn);
    else await sleep(work.pollSeconds ?? 10);
  }
}

main().catch((error) => {
  log(error.stack ?? error.message);
  process.exit(1);
});
