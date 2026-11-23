// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { fileURLToPath } from "node:url";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { NitroPluginConfig } from "nitro/vite";

// Scheduled jobs on the Worker. Nitro turns scheduledTasks into Cloudflare Cron Triggers
// in the wrangler.json it generates. The handler needs an absolute path.
const nitro: NitroPluginConfig = {
  experimental: { tasks: true },
  tasks: {
    "income:sync": {
      handler: fileURLToPath(new URL("./src/tasks/income-sync.ts", import.meta.url)),
    },
    "monitor:run": {
      handler: fileURLToPath(new URL("./src/tasks/monitor.ts", import.meta.url)),
    },
    "videos:brief": {
      handler: fileURLToPath(new URL("./src/tasks/video-brief.ts", import.meta.url)),
    },
    "videos:comments": {
      handler: fileURLToPath(new URL("./src/tasks/video-comments.ts", import.meta.url)),
    },
  },
  // Each cron is a run of its own, with its own 50 requests on Cloudflare's free plan.
  scheduledTasks: {
    // Every hour, a few minutes past. The Revenue page tells people how often, from
    // SYNC_EVERY_MINUTES in src/lib/income-sync.ts: change both together.
    "7 * * * *": ["income:sync"],
    // Every 15 minutes, off the income job's minute. MONITOR_EVERY_MINUTES in
    // src/lib/monitor.ts has to match.
    "2,17,32,47 * * * *": ["monitor:run"],
    // Sunday night (UTC; 21:00 and 23:00 in Madrid in winter): the weekly reels brief. The
    // second run only sends to games whose first brief didn't leave a plan for next week.
    // WEEKLY_BRIEF_LABEL in src/lib/video-reels.ts tells people when: change both together.
    // Cloudflare rejects 0 for Sunday ("invalid cron string"): use the name.
    "0 20,22 * * SUN": ["videos:brief"],
    // Every night at midnight UTC (1:00 in Madrid in winter, 2:00 in summer): the comments
    // brief. COMMENTS_BRIEF_LABEL in src/lib/video-comments.ts tells people when.
    "0 0 * * *": ["videos:comments"],
  },
};

// Note: no spa.prerender here. The Capacitor app's static index.html comes from
// scripts/generate-capacitor-html.js (run via `bun run build:app`); the prerender
// phase breaks both Lovable's pipeline and local builds with the pinned
// @lovable.dev/vite-tanstack-config, and the SSR web build doesn't need it.
export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // The wrapper only types a few Nitro options, but hands nitro() all of them.
  nitro: nitro as { preset?: string },
  vite: {
    ssr: {
      // Don't externalize these for SSR - let them be bundled
      noExternal: [],
    },
  },
});
