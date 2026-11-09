# The build server (bgp-agent)

The machine behind the console's **Build chat** (`/apps/<id>/build`): a chat with Claude for each web game,
with the game's Cloudflare preview next to it, so a game can be built without Claude Code or a terminal.
The console (Cloudflare Workers) can't run the Claude CLI, so this does: it asks the console for work
and runs Claude on the game's repo.

```
browser ── console (Workers + Supabase) ◀── /api/agent/* ── bgp-agent (this) ── Claude CLI in Docker
              ▲                                                   │
              └──────── Cloudflare preview ◀── GitHub Actions ◀── git push (deploy key per repo)
```

Today it runs on the home server (Debian, `192.168.1.24`) as the systemd service `bgp-agent`, user
`bgp-agent`. Nothing in it is tied to that machine: any Debian or Ubuntu box with Docker and Node 22
(a VPS, for example) works the same. See "Moving it" below.

## What it does

It calls `POST <console>/api/agent/poll` every 2 seconds while someone has the Build chat or
Settings → Claude open, and every 10 seconds otherwise. The answer is one of these:

- **A chat message (a turn).** For each one, the server:
  1. Makes sure it has a deploy key for the game's repo. If it doesn't, it creates one, and the console adds
     it on GitHub (`/api/agent/repo-key`, with `GITHUB_PAT`). See "How it pushes" below.
  2. Clones the repo, or resets it to exactly what GitHub has. It runs `bun install` inside the container
     when `package.json` or the lockfile changed.
  3. Runs `claude -p` in a container: Opus 5.5 at medium effort unless Settings → Claude says
     otherwise. It resumes the chat's Claude session (`--resume`), so Claude remembers the conversation.
     What Claude says and does streams to the chat (`/api/agent/turn`), about once a second. The answer
     to each call also says whether someone pressed **Stop**.
  4. Commits what Claude left uncommitted (only when it finished well) and pushes to the game's branch.
     That deploys the Cloudflare preview, and the page reloads it once the deploy is live. If someone else
     pushed meanwhile, it rebases. If the changes clash, it saves them to a `build-chat/<id>` branch and
     says so in the chat.
  5. Reports the result (`/api/agent/finish`).
- **Link a Claude account** (Settings → Claude). The server runs `claude setup-token` in a pseudo-terminal
  and passes the claude.ai link to the page. The person signs in and pastes back the code; the CLI turns it
  into a token that lasts a year. A token made in a terminal can also be pasted instead. Before keeping it,
  the server checks the token with a one-word Claude call. The token lives only here, in
  `/var/lib/bgp-agent/claude.json` (600). The console only sees its last four characters.
- **Unlink**: it deletes that file.
- **A message to Ruben, the console's assistant** (a turn of `kind: "assistant"`). Ruben is the chat
  that floats over every page of the console (`src/lib/assistant.ts`). Its turns run like the Build
  chat's, but with no repository and none of Claude Code's own tools (`--tools ""`): Claude gets the
  console's tools through an MCP server inside the container, `console-mcp.mjs`, which forwards each
  call to `<console>/api/assistant/*` with a token the console made for that turn only (`ASSISTANT_TOKEN`,
  in the same env file as the Claude token). The egress proxy lets the container reach the console's host
  for that (`EGRESS_ALLOW`, set by install.sh from `CONSOLE_URL`). The tools only read (Home, apps, a
  Build chat, expenses, revenue, downloads, reviews, settings); what Ruben proposes to do shows in the chat
  as buttons, and the console does it as the person who presses them. The instructions Claude gets come
  with the turn (`job.systemPrompt`), so this server knows nothing about Ruben itself. Each person's chat
  resumes its own session from `homes/assistant-<chat id>/`.
- **Read the account's usage** (`refreshUsage`). The console only learns the account's limits from
  Claude, so between messages the usage it shows gets old. When a page asks (the one it has is older
  than 15 minutes, or someone pressed Refresh in Settings → Claude), the server makes one tiny call
  (a word from Haiku, no tools, a one-line system prompt), which Claude answers with the current
  limits, and reports them (`/api/agent/usage`). The token's scope (`user:inference`) doesn't allow
  the usage endpoint Claude Code's `/usage` uses, so this is the way.

Claude's instructions for this environment are in `lib.mjs` (`systemPrompt`). In short, they say:
commit, don't push, run `bun run build` before finishing, and skip the steps in the game's AGENTS.md
about pushing, deploy polling and Artifacts. Everything else in the game's AGENTS.md applies.

### Attached files

A message can carry files (photos, PDFs, text files; up to 8, 20 MB each). The console keeps them in
Storage (bucket `agent-attachments`) and hands the turn a signed link to each. Before Claude starts,
the server fetches them into `/var/lib/bgp-agent/attachments/<chat id>/`, which Claude's container
sees as `/attachments` (read-only), and the message ends with the list of them. Claude Code's Read
tool shows it images and PDFs. Files from earlier messages of the same chat stay in the folder; a
chat's folder untouched for two months is dropped.

### The weekly share

Settings → Claude says how much of the Claude account's weekly limit the Build chat may use (10% by
default; 0 for no limit). Claude reports the account's usage at every call it makes, so each turn
knows the usage when it started and when it ended, and the difference is what the turn used. The
console adds those up over the current week (`weekly_spent` on `agent_turns`), refuses new messages
once the share is used, and tells the server the share and what is used so far with each turn
(`job.budget`). If the share runs out during a turn, the server stops Claude after the call that
crossed it, like Stop: the commits it had made are pushed, the rest waits until the limit resets. The
reports come in whole percents, and anything else using the account during a turn counts, so the
share is approximate by a percent or two.

## What Claude can and can't do

- **It can only reach the Claude API, the npm registry, the console and the sites allowed in Settings →
  Claude → Internet and keys.** The container sits on a Docker network with no way out
  (`bgp-agent-internal`). The only thing on it is the proxy `bgp-agent-egress` (`egress.mjs`), which opens
  tunnels only to `api.anthropic.com:443`, `registry.npmjs.org:443`, the console's host (for Ruben's tools,
  which the console only answers with a turn's token) and, for a Build chat message's own container, the
  sites of Internet and keys. It never follows a name to a private address (the home network, the machine, Docker),
  so it can't reach anything on the home network even through an allowed site.
- **Internet and keys** is the Build chat's version of Claude Code on the web's cloud environment. OpenAI
  and ElevenLabs connect with just their key (the console checks it with the service first and adds the
  service's site); anything else goes under "Other websites and keys", pasted as in Claude Code. A change goes
  to the server through `agent_environment_changes` (the values are deleted from the database as soon as
  the server takes them) and lives in `STATE_DIR/environment.json` (600), like the Claude token; the
  console only sees the sites and each key's last four characters (`agent_runner.environment`). The server
  writes a Build chat message's sites to `STATE_DIR/egress/turns/<container>` before its container starts
  and removes the file when it ends. The proxy reads it (mounted at `/etc/bgp-egress`) on every tunnel
  from that container: it knows the container by its address, which Docker's DNS on `bgp-agent-internal`
  names after it, and only the server names containers. So messages running at the same time each get
  their own, and Ruben's containers and the dependency installs, which have no file, get none. The keys reach the container
  through the same env file as the token. Ruben's turns and the dependency installs get neither. Names the
  server sets itself (`CLAUDE_*`, `ANTHROPIC_*`, `*_PROXY`, `PATH`, `HOME`, `GIT_*`…) can't be replaced.
- **It can't publish a key.** Before pushing, the server reads the patch of every commit of the turn; if
  the value of a key (20 characters or more) is in it, nothing is pushed and the chat says why
  (`leakedSecrets` in `runner.mjs`). The game is public: a key in it is a key anyone can use.
- **It sees nothing of the server** except the game's clone (`/work`) and its own home folder for that game
  (`/home/agent`, where Claude keeps the chat's session). It has no secret besides the Claude token and
  the keys of Internet and keys. The
  GitHub keys stay outside, and so does the service's own token.
- **It can't run anything on the server.** The service runs git with the repo's hooks and fsmonitor off,
  and puts `.git/config` back after each session.
- **It can't make the server write over its files.** Claude has the clone writable, `.git` included, and so
  do the packages' install scripts. Before the server runs git there again, it checks that `.git` is what git
  makes (`gitDirProblem` in `lib.mjs`): plain files and folders only, and no `commondir` or
  `objects/info/alternates`, which would have git take its config from a folder Claude chose. A link there
  would have git or the server write over whatever it points to, like the Claude token (a fetch writes
  `FETCH_HEAD` through one, `git add` the index). If something's off, nothing is pushed, the chat says why,
  and the next message clones the game again. `.git/config` goes back as a new file, never written through
  what's there (`replaceFile`), and a copy waits in `STATE_DIR/unchecked/<game>` until then: if the server
  stops in the middle of a message, the next one puts it back first.
- **It can't change the native boundary.** Commits that touch `capacitor.config.*`, `ios/`, `android/` or
  the deploy and preview workflows aren't pushed, and the chat says why (`protectedPaths` in `lib.mjs`).
- **Several messages at once, one per game.** Up to `AGENT_PARALLEL` (3) messages of different games (or
  Ruben chats) run at the same time, each in its own container (`bgp-agent-turn-<turn id>`); a game's
  messages go one after another. The console hands out the oldest queued message of a game the server isn't
  on (`sortOutTurns` in `src/lib/agent.ts`), and the server says at each poll which messages it's on and
  whether it can take another (`freeSlots`). Messages running together measure the weekly share from the
  earliest of their starts, so together they stop at the share, and the console counts what they used
  together once (`windowSpent`).
- **1.2 GB of memory per message** (`AGENT_MEMORY`) and no swap. A message has no time or step
  limit: it runs until Claude finishes, someone presses Stop, or the account's usage (or the chat's weekly
  share of it) runs out. `TURN_MINUTES` and `MAX_TURNS` bring a cap back if one is ever wanted.
- **It gives way to the machine's other services.** The home server has 3.8 GB and also runs cpl-agent,
  the GitHub Actions runners and other services that must not stop. So:
  - another message only starts while others run when the machine has room for all of them at their
    limit plus `AGENT_MIN_FREE_MB` for the new one (`roomForAnotherTurn` in `lib.mjs`). Until then it waits in
    the queue and its chat says what it waits for. On the home server that's one message at a time, now and
    then two; a VPS with 8 GB runs three;
  - the first message only starts when the machine has as much memory free as the turn may use (`AGENT_MIN_FREE_MB`,
    1200 by default). If it doesn't, the chat says to try again in a few minutes;
  - a turn that needs more than its 1.2 GB is stopped on its own, and the chat says it ran out of memory;
  - if the machine runs out of memory anyway (because of something else), the kernel kills Claude's container and
    this service first (`--oom-score-adj 1000`, `OOMScoreAdjust=1000`). The service is capped at 512 MB.

## Install or update

From bgp-admin, with root SSH access to the machine:

```sh
make agent-deploy                          # copies agent-runner/ and runs install.sh there
AGENT_HOST=root@my-vps make agent-deploy   # anywhere else
```

`install.sh` can always run again. It creates what's missing (the user, the folders, GitHub's host key,
the network and the proxy), rebuilds the image and restarts the service with the new code. A turn in
progress is never cut short: the service restarts by itself when the turn ends.

The secrets go in `/etc/bgp-agent.env` (root, 600), once:

```sh
AGENT_RUNNER_TOKEN=…   # the same value as the GitHub secret AGENT_RUNNER_TOKEN of bgp-admin
CONSOLE_URL=https://bgp-admin-preview.biblegamesproject.workers.dev
```

### How it pushes to the game repos

Two ways; the first is the default.

- **A deploy key per repo.** The server creates the key, the console adds it to the repo, and the key can
  only write to that one repo. GitHub only allows this when the organization accepts deploy keys:
  **Bible-Games-Project → Settings → Member privileges → Deploy keys → Enabled**. It was off on
  2026-11-02. While it's off, the first message to a game fails at once, before Claude runs, and the chat
  says where to turn it on.
- **A token** (`GIT_PUSH_TOKEN` in the env file): the server clones and pushes over HTTPS with it and
  makes no deploy keys. Use a fine-grained token from an account in the organization, with access to the
  game repos and **Contents: Read and write** only. git gets it through an askpass script, so it never
  appears in a URL, in `.git/config` or on a command line, and it never reaches the container. Its reach
  is wider than a deploy key's: every repo it was given.

Optional settings: `AGENT_NAME` (how Settings → Claude names it, the hostname by default), `AGENT_MEMORY`
(`1200m`), `AGENT_MIN_FREE_MB` (`1200`), `AGENT_PARALLEL` (`3`), `AGENT_CPUS` (`2`), `TURN_MINUTES` (`0`, no limit), `MAX_TURNS` (`0`, no limit) and
`AGENT_COMPACT_WINDOW` (`200k`, see below).

### Long chats

Each game's chat is one Claude session, and every step of every turn reads that whole conversation again.
When it gets long, Claude Code summarizes it and carries on from the summary (auto-compact); the chat
shows that as a step. The CLI would wait until about a million tokens with Opus 5.5, so the server asks
for a summary near 200k instead (`AGENT_COMPACT_WINDOW`: from `100k` to `1M`, or `auto` to leave it to
the CLI). New chat, on the Build page, starts from nothing.

`AGENT_RUNNER_TOKEN` reaches the console as a Worker secret through `cloudflare-preview.yml`. To change it,
set the GitHub secret, push to main (or re-run that workflow), and put the same value in the env file.

## Moving it (to a VPS)

1. `AGENT_HOST=root@<new machine> make agent-deploy`, then create `/etc/bgp-agent.env` there (same values)
   and run `systemctl restart bgp-agent`.
2. Stop the old one: `systemctl disable --now bgp-agent`.
3. Link the Claude account again in Settings → Claude, since the token stays on the old machine. The new
   server makes new deploy keys, and the console replaces the old ones on GitHub by itself. The chats'
   Claude sessions don't move, so each game's next message starts a fresh session, and Claude is told so.

## Look at what it does

```sh
ssh root@192.168.1.24 journalctl -u bgp-agent -f       # what it's doing
ssh root@192.168.1.24 ls /var/lib/bgp-agent/logs        # each session's stream-json (the last 60)
```

Settings → Claude says whether the server is online and when it last checked in.

## Try it on a laptop

`AGENT_SANDBOX=none` runs the CLI directly, with no container, using the machine's own Claude login.
`REPO_URL=file:///path/{owner}/{name}.git` clones from local bare repos instead of GitHub. Point
`CONSOLE_URL` at a console that answers `/api/agent/*`, such as a small stand-in that hands out turns.
This is how the runner was tested before it first shipped. Without the sandbox, Claude can do anything on
that machine, so only try it on repos you'd let it touch.

## Tests

`bun test agent-runner` (part of `bun run test`) covers `lib.mjs` and the egress rules, against a real
stream-json session (`fixtures/stream.jsonl`).
