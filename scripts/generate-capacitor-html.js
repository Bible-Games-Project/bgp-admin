import fs from 'node:fs';
import path from 'node:path';

// Generates the static index.html the Capacitor app boots from, after a
// TanStack Start build (run via `bun run build:app`). The SSR web build must
// not gain this file, so the script is gated behind CAPACITOR_BUILD=1.
//
// The shell seeds the router bootstrap globals so TanStack Router's hydrate()
// invariants pass, then loads the client entry; the app renders fully
// client-side and talks to the deployed server for server functions (see
// src/start.ts). Router versions differ in which global they read:
//   - older:  window.__TSR__ with { dehydrated: { router: ... } }
//   - newer (router-core >= ~1.168): window.$_TSR with { buffer, router }
// Seeding both is harmless; each version only reads its own.
//
// Supports both build layouts:
//   - .output/public + .output/server  (@lovable.dev/vite-tanstack-config >= 2.7)
//   - dist/client + dist/server        (older layout)

if (process.env.CAPACITOR_BUILD !== '1') {
  process.exit(0);
}

const LAYOUTS = [
  { clientDir: path.join('.output', 'public'), serverDir: path.join('.output', 'server') },
  { clientDir: path.join('dist', 'client'), serverDir: path.join('dist', 'server') },
];

const layout = LAYOUTS.find((l) => fs.existsSync(l.clientDir));
if (!layout) {
  console.error('No client build output found (.output/public or dist/client). Run the build first.');
  process.exit(1);
}

const { clientDir, serverDir } = layout;

if (fs.existsSync(path.join(clientDir, 'index.html'))) {
  process.exit(0);
}

// Find the client entry from TanStack Start's server manifest. The manifest
// module lives directly in the server dir (new layout) or in its assets/
// subdirectory (old layout).
let clientEntry = null;

for (const dir of [serverDir, path.join(serverDir, 'assets')]) {
  if (clientEntry || !fs.existsSync(dir)) continue;
  const manifestFile = fs.readdirSync(dir).find((f) => f.includes('tanstack-start-manifest'));
  if (manifestFile) {
    const manifest = fs.readFileSync(path.join(dir, manifestFile), 'utf8');
    const m = manifest.match(/clientEntry[^'"]*['"]([^'"]+)['"]/);
    if (m) clientEntry = m[1];
  }
}

// Fallback: largest JS file in the client assets dir (the main bundle)
if (!clientEntry) {
  const clientAssetsDir = path.join(clientDir, 'assets');
  if (fs.existsSync(clientAssetsDir)) {
    const largest = fs.readdirSync(clientAssetsDir)
      .filter(f => f.endsWith('.js'))
      .map(f => ({ f, s: fs.statSync(path.join(clientAssetsDir, f)).size }))
      .sort((a, b) => b.s - a.s)[0];
    if (largest) clientEntry = `/assets/${largest.f}`;
  }
}

if (!clientEntry) {
  console.error(`Could not locate client entry point in ${clientDir}/assets/`);
  process.exit(1);
}

if (!clientEntry.startsWith('/')) clientEntry = '/' + clientEntry;

const clientAssetsDir = path.join(clientDir, 'assets');
const cssLinks = fs.existsSync(clientAssetsDir)
  ? fs.readdirSync(clientAssetsDir)
      .filter(f => f.endsWith('.css'))
      .map(f => `  <link rel="stylesheet" href="/assets/${f}" />`)
      .join('\n')
  : '';

const parts = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="UTF-8" />',
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />',
  '  <script>',
  '    window.__TSR__={dehydrated:{router:{state:{dehydratedMatches:[]}}}};',
  '    window.$_TSR={buffer:[],router:{matches:[]},h(){},e(){},c(){},p(cb){this.initialized?cb():this.buffer.push(cb)}};',
  '  </script>',
  cssLinks,
  // viewport-fit=cover lets the webview extend under the notch/home indicator;
  // this padding pushes the content back inside the safe area. Same block the
  // deploy workflows inject (keyed by id) — they skip it when already present.
  '  <style id="bgp-safe-area">',
  '    body {',
  '      padding-top: env(safe-area-inset-top, 0px);',
  '      padding-right: env(safe-area-inset-right, 0px);',
  '      padding-bottom: env(safe-area-inset-bottom, 0px);',
  '      padding-left: env(safe-area-inset-left, 0px);',
  '    }',
  '  </style>',
  `  <script type="module" src="${clientEntry}"></script>`,
  '</head>',
  '<body></body>',
  '</html>',
  '',
];

fs.writeFileSync(path.join(clientDir, 'index.html'), parts.filter(Boolean).join('\n'));
console.log(`Generated ${clientDir}/index.html, entry:`, clientEntry);
