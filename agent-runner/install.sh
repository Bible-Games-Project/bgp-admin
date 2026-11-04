#!/usr/bin/env bash
# Sets up (or updates) the build server on a Debian machine with Docker and Node 22. Runs as
# root on that machine, from a copy of this folder (deploy.sh copies it there and runs it).
# It can always run again: it only creates what's missing, and always rebuilds the container
# and restarts the service with the new code.
#
# It only touches what is its own: the user bgp-agent, /opt/bgp-agent, /var/lib/bgp-agent,
# the Docker network bgp-agent-internal, the container bgp-agent-egress and the service
# bgp-agent. The secrets (/etc/bgp-agent.env) are put there separately; see README.md.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

id bgp-agent >/dev/null 2>&1 ||
  useradd --system --create-home --home-dir /var/lib/bgp-agent --shell /usr/sbin/nologin bgp-agent
# To start the sessions' containers
usermod -aG docker bgp-agent

install -d -o root -g root -m 755 /opt/bgp-agent
install -o root -g root -m 644 "$here"/runner.mjs "$here"/lib.mjs "$here"/egress.mjs "$here"/console-mcp.mjs "$here"/Dockerfile /opt/bgp-agent/
install -d -o bgp-agent -g bgp-agent -m 700 /var/lib/bgp-agent

# GitHub's host key, so the deploy keys only ever talk to GitHub
install -d -o bgp-agent -g bgp-agent -m 700 /var/lib/bgp-agent/.ssh
if ! grep -q "^github.com " /var/lib/bgp-agent/.ssh/known_hosts 2>/dev/null; then
  ssh-keyscan -t ed25519 github.com 2>/dev/null >>/var/lib/bgp-agent/.ssh/known_hosts
  chown bgp-agent:bgp-agent /var/lib/bgp-agent/.ssh/known_hosts
fi

# A turn in progress is never cut short by an update: the new code waits, and the service
# restarts itself with it when the turn ends (runner.mjs checks after each turn and poll).
busy=0
[ -f /var/lib/bgp-agent/current.json ] && busy=1
# Same for someone linking a Claude account in Settings → Claude
[ -n "$(docker ps -q --filter name='^bgp-agent-login$')" ] && busy=1

# The sessions' network with no way out, and the proxy that only lets them reach the Claude
# API and npm. The proxy is only replaced when it changed: replacing it would cut the
# session going through it.
docker network inspect bgp-agent-internal >/dev/null 2>&1 || docker network create --internal bgp-agent-internal >/dev/null
docker build --quiet -t bgp-agent:latest /opt/bgp-agent >/dev/null
# The console's host, which Ruben's tools reach from inside the container (console-mcp.mjs)
console_host="$(sed -n 's#^CONSOLE_URL=https\?://\([^/]*\).*#\1#p' /etc/bgp-agent.env 2>/dev/null | head -1)"
console_host="${console_host:-bgp-admin-preview.biblegamesproject.workers.dev}"
egress="$(sha256sum /opt/bgp-agent/egress.mjs | cut -d' ' -f1)-$console_host"
running="$(docker inspect -f '{{index .Config.Labels "egress"}}' bgp-agent-egress 2>/dev/null || true)"
if [ "$running" != "$egress" ] && [ "$busy" = 0 ]; then
  docker rm -f bgp-agent-egress >/dev/null 2>&1 || true
  docker run -d --name bgp-agent-egress --restart unless-stopped --memory 128m --oom-score-adj 1000 --pids-limit 64 \
    --cap-drop ALL --security-opt no-new-privileges --user node --label "egress=$egress" \
    -e "EGRESS_ALLOW=$console_host" \
    bgp-agent:latest node /opt/bgp-agent/egress.mjs >/dev/null
  docker network connect bgp-agent-internal bgp-agent-egress
fi

install -o root -g root -m 644 "$here"/bgp-agent.service /etc/systemd/system/bgp-agent.service
systemctl daemon-reload
if [ ! -f /etc/bgp-agent.env ]; then
  echo "/etc/bgp-agent.env is missing: the service won't start until it's there (README.md)"
elif [ "$busy" = 1 ]; then
  systemctl enable --quiet bgp-agent
  echo "A turn or a sign-in is in progress: bgp-agent restarts itself with the new code when it ends"
else
  systemctl enable --quiet bgp-agent
  systemctl restart bgp-agent
  echo "bgp-agent started"
fi
