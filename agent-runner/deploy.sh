#!/usr/bin/env sh
# Copies the build server to its machine and installs it there (install.sh). From bgp-admin:
# make agent-deploy. Needs root SSH access with a key (AGENT_HOST, root@192.168.1.24 by
# default: the home server).
set -eu
host="${AGENT_HOST:-root@192.168.1.24}"
here="$(cd "$(dirname "$0")" && pwd)"
ssh "$host" 'rm -rf /root/bgp-agent-src && mkdir -p /root/bgp-agent-src'
scp -q "$here"/runner.mjs "$here"/lib.mjs "$here"/egress.mjs "$here"/console-mcp.mjs "$here"/Dockerfile "$here"/bgp-agent.service \
  "$here"/install.sh "$host":/root/bgp-agent-src/
ssh "$host" 'bash /root/bgp-agent-src/install.sh'
