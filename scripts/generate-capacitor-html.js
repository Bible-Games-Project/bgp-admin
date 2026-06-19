const fs = require('fs');
const path = require('path');

// Generates dist/client/index.html for Capacitor after a TanStack Start build.
//
// TanStack Router calls router.hydrate() which reads window.__TSR__.dehydrated.
// Two invariants must pass:
//   1. invariant(ctx)        → dehydrated must exist
//   2. invariant(ctx.router) → dehydrated.router must exist
// With dehydratedMatches:[] the router finds no cached server data and does a
// fresh client-side navigation to the current URL. React's hydrateRoot recovers
// from the empty body by doing a full client render (standard behaviour in prod).

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

// Debug script: logs the full stack trace of any invariant/startup error.
// Remove once the blank-screen issue is resolved.
const debugScript = `  <script>
  window.__TSR__={dehydrated:{router:{state:{dehydratedMatches:[]}}}};
  console.log('[BGP] init, __TSR__='+JSON.stringify(window.__TSR__));
  window.addEventListener('error',function(e){
    var s=e.error&&e.error.stack?e.error.stack:'(no stack)';
    console.error('[BGP-ERR] '+e.message+'\\n'+s);
  });
  window.addEventListener('unhandledrejection',function(e){
    var r=e.reason;
    console.error('[BGP-REJ] '+(r&&r.stack?r.stack:String(r)));
  });
  </script>`;

const parts = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="UTF-8" />',
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
  debugScript,
  cssLinks,
  `  <script type="module" src="${clientEntry}"></script>`,
  '</head>',
  '<body></body>',
  '</html>',
  '',
];

fs.writeFileSync('dist/client/index.html', parts.filter(Boolean).join('\n'));
console.log('Generated dist/client/index.html, entry:', clientEntry);
