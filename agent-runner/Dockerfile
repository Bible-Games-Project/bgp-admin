# The container Claude works in, and the one of its egress proxy (egress.mjs), its only way
# out. It holds no secret: the account's token arrives through an env file when a session
# starts. Every version is pinned.
FROM oven/bun:1.4.4-debian AS bun

FROM node:22.14.0-bookworm-slim
ARG CLAUDE_CODE_VERSION=2.1.316
# git for Claude's commits; ca-certificates for the npm registry and the Claude API
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# The game repos build with bun, like their preview-deploy.yml on GitHub
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx && bun --version
# The platform package carries the native binary; no install script runs
RUN npm install -g --ignore-scripts "@anthropic-ai/claude-code-linux-x64@${CLAUDE_CODE_VERSION}" \
 && ln -s /usr/local/lib/node_modules/@anthropic-ai/claude-code-linux-x64/claude /usr/local/bin/claude \
 && claude --version \
 && rm -rf /root/.npm
COPY egress.mjs /opt/bgp-agent/egress.mjs
# The console's tools for Ruben, started by Claude Code inside the container
COPY console-mcp.mjs /opt/bgp-agent/console-mcp.mjs
