import fs from 'node:fs';
import path from 'node:path';

// Generates dist/client/index.html for Capacitor after a TanStack Start build.
//
// When TanStack Start SPA mode is enabled (spa.prerender.outputPath = "index.html"),
// the build already produces dist/client/index.html with window.$_TSR properly
// initialised. This script exits immediately in that case.
//
// For non-SPA TanStack Start builds (no index.html produced), this script
// generates a minimal static shell with window.__TSR__ seeded so TanStack
// Router's hydrate() invariants pass.

// Only relevant for Capacitor app builds (bun run build:app). The regular web
// build must not gain a static index.html — the site is SSR'd by the server.
if (process.env.CAPACITOR_BUILD !== '1') {
  process.exit(0);
}

if (!fs.existsSync('dist/client') || fs.existsSync('dist/client/index.html')) {
  process.exit(0);
}

// Find client entry from TanStack Start's server manifest
const serverAssetsDir = path.join('dist', 'server', 'assets');
let clientEntry = null;

if (fs.existsSync(serverAssetsDir)) {
  const manifestFile = fs.readdirSync(serverAssetsDir)
    .find(f => f.includes('tanstack-start-manifest'));
  if (manifestFile) {
    const manifest = fs.readFileSync(path.join(serverAssetsDir, manifestFile), 'utf8');
    const m = manifest.match(/clientEntry[^'"]*['"]([^'"]+)['"]/);
    if (m) clientEntry = m[1];
  }
}

// Fallback: largest JS file in dist/client/assets (the main bundle)
if (!clientEntry) {
  const clientAssetsDir = path.join('dist', 'client', 'assets');
  if (fs.existsSync(clientAssetsDir)) {
    const largest = fs.readdirSync(clientAssetsDir)
      .filter(f => f.endsWith('.js'))
      .map(f => ({ f, s: fs.statSync(path.join(clientAssetsDir, f)).size }))
      .sort((a, b) => b.s - a.s)[0];
    if (largest) clientEntry = `/assets/${largest.f}`;
  }
}

if (!clientEntry) {
  console.error('Could not locate client entry point in dist/client/assets/');
  process.exit(1);
}

if (!clientEntry.startsWith('/')) clientEntry = '/' + clientEntry;

const clientAssetsDir = path.join('dist', 'client', 'assets');
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
  '  <script>window.__TSR__={dehydrated:{router:{state:{dehydratedMatches:[]}}}}</script>',
  cssLinks,
  `  <script type="module" src="${clientEntry}"></script>`,
  '</head>',
  '<body></body>',
  '</html>',
  '',
];

fs.writeFileSync('dist/client/index.html', parts.filter(Boolean).join('\n'));
console.log('Generated dist/client/index.html (fallback), entry:', clientEntry);
