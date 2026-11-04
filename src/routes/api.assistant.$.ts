import { createFileRoute } from "@tanstack/react-router";

// What Ruben's tools call from the build server: /api/assistant/tools and /call, each a
// POST with a JSON body and the running turn's token as a Bearer token. The handlers live
// in assistant.server.ts, imported here on demand so none of it reaches the browser bundle.
export const Route = createFileRoute("/api/assistant/$")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { handleAssistantRequest } = await import("@/lib/assistant.server");
        return handleAssistantRequest(params._splat ?? "", request);
      },
    },
  },
});
