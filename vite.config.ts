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
  },
  // Every hour, a few minutes past. The Revenue page tells people how often, from
  // SYNC_EVERY_MINUTES in src/lib/income-sync.ts: change both together.
  scheduledTasks: { "7 * * * *": ["income:sync"] },
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
