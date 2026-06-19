const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Generates dist/client/index.html for Capacitor after a TanStack Start build.
//
// Strategy: start the Nitro server briefly and fetch the rendered page so we get
// a real window.__TSR__ dehydrated state. Without this, hydrateRoot throws
// multiple invariants because the router state is missing (no SSR server in Capacitor).

if (!fs.existsSync('dist/client') || fs.existsSync('dist/client/index.html')) {
  process.exit(0);
}

const SERVER_ENTRY = path.join(process.cwd(), 'dist/server/index.mjs');
if (!fs.existsSync(SERVER_ENTRY)) {
  console.error('dist/server/index.mjs not found');
  process.exit(1);
}

// Port unlikely to collide with anything
const PORT = 19473;

async function get(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 4000 }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function waitForServer(url, retries = 30, delay = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      await get(url);
      return;
    } catch {
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error(`Server did not become ready at ${url}`);
}

// Follow up to 5 redirects, collecting the first HTML response
async function fetchFollowingRedirects(baseUrl, maxRedirects = 5) {
  let url = baseUrl;
  for (let i = 0; i <= maxRedirects; i++) {
    const { status, headers, body } = await get(url);
    if (status >= 300 && status < 400 && headers.location) {
      const next = headers.location.startsWith('http')
        ? headers.location
        : new URL(headers.location, baseUrl).href;
      url = next;
      continue;
    }
    if (body.includes('<!DOCTYPE html') || body.includes('<html')) {
      return body;
    }
    throw new Error(`Unexpected response: status=${status}, body=${body.substring(0, 80)}`);
  }
  throw new Error('Too many redirects');
}

async function main() {
  const server = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      // Dummy values so the server starts even without real credentials in CI.
      // The render of the initial HTML shell does not require DB access.
      SUPABASE_URL: process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || 'placeholder',
    },
    stdio: 'pipe',
  });

  const logs = [];
  server.stdout.on('data', d => logs.push(d.toString()));
  server.stderr.on('data', d => logs.push(d.toString()));
  server.on('error', err => logs.push('process error: ' + err.message));

  const base = `http://127.0.0.1:${PORT}`;

  try {
    console.log(`Starting Nitro server on port ${PORT} for pre-render...`);
    await waitForServer(base);
    console.log('Server ready — fetching /');

    const html = await fetchFollowingRedirects(base + '/');
    fs.writeFileSync('dist/client/index.html', html);
    console.log('Generated dist/client/index.html via Nitro pre-render');
  } catch (err) {
    console.error('Pre-render failed:', err.message);
    console.error('Server logs:\n' + logs.join('').substring(0, 1000));
    process.exit(1);
  } finally {
    server.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 300));
    if (!server.killed) server.kill('SIGKILL');
  }
}

main();
