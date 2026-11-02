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

Claude's instructions for this environment are in `lib.mjs` (`systemPrompt`). In short, they say:
commit, don't push, run `bun run build` before finishing, and skip the steps in the game's AGENTS.md
about pushing, deploy polling and Artifacts. Everything else in the game's AGENTS.md applies.

## What Claude can and can't do

- **It can only reach the Claude API and the npm registry.** The container sits on a Docker network with
  no way out (`bgp-agent-internal`). The only thing on it is the proxy `bgp-agent-egress` (`egress.mjs`),
  which opens tunnels only to `api.anthropic.com:443` and `registry.npmjs.org:443`. It can't reach
  GitHub, other websites, or anything on the home network.
- **It sees nothing of the server** except the game's clone (`/work`) and its own home folder for that game
  (`/home/agent`, where Claude keeps the chat's session). It has no secret besides the Claude token. The
  GitHub keys stay outside, and so does the service's own token.
- **It can't run anything on the server.** The service runs git with the repo's hooks and fsmonitor off,
  and puts `.git/config` back after each session.
- **It can't change the native boundary.** Commits that touch `capacitor.config.*`, `ios/`, `android/` or
  the deploy and preview workflows aren't pushed, and the chat says why (`protectedPaths` in `lib.mjs`).
- **One turn at a time**, 30 minutes at most, with 1.2 GB of memory (`AGENT_MEMORY`). The home server has
  3.8 GB and also runs cpl-agent and other services.

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
(`1200m`), `AGENT_CPUS` (`2`), `TURN_MINUTES` (`30`) and `MAX_TURNS` (`200`).

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
