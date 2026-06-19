const fs = require('fs');
const path = require('path');

// Generates dist/client/index.html for Capacitor after a TanStack Start build.
// TanStack Start does not emit an index.html (the Nitro server renders HTML at request time),
// but Capacitor needs a static entry point. We also seed window.__TSR__ so router.hydrate()
// does not throw when there is no SSR server (Capacitor loads local static files).
if (!fs.existsSync('dist/client') || fs.existsSync('dist/client/index.html')) {
  process.exit(0);
}

const manifestDir = 'dist/server/assets';
if (!fs.existsSync(manifestDir)) {
  console.error('dist/server/assets not found — run bun run build first');
  process.exit(1);
}

const manifestFile = fs.readdirSync(manifestDir).find(f => f.includes('tanstack-start-manifest'));
if (!manifestFile) { console.error('No TanStack manifest found'); process.exit(1); }

const manifest = fs.readFileSync(path.join(manifestDir, manifestFile), 'utf8');
const entryMatch = manifest.match(/clientEntry:\s*['"]([^'"]+)['"]/);
if (!entryMatch) { console.error('clientEntry not found in manifest'); process.exit(1); }

const clientEntry = entryMatch[1];
const cssFiles = fs.readdirSync('dist/client/assets')
  .filter(f => f.endsWith('.css'))
  .map(f => '/assets/' + f);
const links = cssFiles.map(f => '  <link rel="stylesheet" href="' + f + '" />').join('\n');

const html = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="UTF-8" />',
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
  '  <script>window.__TSR__={dehydrated:{}};try{history.replaceState({},"",location.href)}catch(e){}</script>',
  links,
  '  <script type="module" src="' + clientEntry + '"></script>',
  '</head>',
  '<body></body>',
  '</html>',
  '',
].join('\n');

fs.writeFileSync('dist/client/index.html', html);
console.log('Generated dist/client/index.html for Capacitor (entry: ' + clientEntry + ')');
