import { createFileRoute } from "@tanstack/react-router";

// What the build server (agent-runner/) calls: /api/agent/poll, /turn, /finish, /login,
// /repo-key, /usage and /environment, each a POST with a JSON body and the
// AGENT_RUNNER_TOKEN as a Bearer token.
// The handlers live in agent.server.ts, imported here on demand so none of it reaches the
// browser bundle.
export const Route = createFileRoute("/api/agent/$")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { handleRunnerRequest } = await import("@/lib/agent.server");
        return handleRunnerRequest(params._splat ?? "", request);
      },
    },
  },
});
