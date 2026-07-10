// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// SPA prerender exists only to produce the static index.html the Capacitor app
// boots from (see scripts/generate-capacitor-html.js). It must stay off for the
// regular web build: Lovable's pipeline can't run the prerender phase, and the
// SSR site doesn't need the file. Build the app bundle with `bun run build:app`.
const capacitorBuild = process.env.CAPACITOR_BUILD === "1";

export default defineConfig({
  tanstackStart: {
    ...(capacitorBuild
      ? { spa: { enabled: true, prerender: { outputPath: "index.html" } } }
      : {}),
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
