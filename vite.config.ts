// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

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
  vite: {
    ssr: {
      // Don't externalize these for SSR - let them be bundled
      noExternal: [],
    },
  },
});
