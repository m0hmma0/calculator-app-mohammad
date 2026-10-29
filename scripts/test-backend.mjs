/**
 * Runs the real Worker against local D1 and R2, plus a small key server standing in
 * for Google's.
 *
 * The point is that the Worker's verification path is *not* stubbed: it fetches a
 * JWKS, checks an RS256 signature, and pins the audience and issuer, exactly as it
 * does in production. Only the key's owner differs. A test that bypassed
 * verification would prove nothing about the thing most worth proving.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const PROJECT_ID = 'sabboura-test';

const KEY_PORT = 8799;
const WORKER_PORT = 8788;
const KID = 'test-key';

// The emulated database is a file that outlives a run, so the schema is applied
// every time; migrations are idempotent and tests isolate by signing in as a
// different account each time rather than by wiping it.
spawnSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'sabboura', '--local'], {
  stdio: 'ignore',
});

/*
 * A separate bundle built *with* a Firebase project configured. The default build
 * has none, which is what makes it fall back to a single local board — right for the
 * published preview, wrong for testing accounts. Values are dummies: the Firebase
 * SDK is never asked to authenticate anything, because the tests supply their own
 * token and the Worker is what verifies it.
 */
const ASSETS = 'dist-test';
spawnSync('npx', ['vite', 'build', '--outDir', ASSETS, '--emptyOutDir'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_FIREBASE_API_KEY: 'test-api-key',
    VITE_FIREBASE_AUTH_DOMAIN: 'sabboura-test.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: PROJECT_ID,
  },
});

const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256', use: 'sig' };

async function mint(params) {
  const uid = params.get('uid') ?? 'test-user';
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: params.get('email') ?? `${uid}@example.test`,
    name: params.get('name') ?? 'Test Person',
    picture: null,
  })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setSubject(uid)
    .setAudience(PROJECT_ID)
    .setIssuer(`https://securetoken.google.com/${PROJECT_ID}`)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);
}

const keyServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${KEY_PORT}`);
  response.setHeader('access-control-allow-origin', '*');

  if (url.pathname === '/jwks') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ keys: [jwk] }));
    return;
  }
  // A page with the tags a link preview reads, for the embed tests.
  if (url.pathname === '/article') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><head>
      <title>Fallback title</title>
      <meta property="og:title" content="Workshops that work">
      <meta property="og:description" content="Seven habits of facilitators people come back to.">
      <meta property="og:image" content="/article.png">
      <meta property="og:site_name" content="Test Journal">
    </head><body>Article</body></html>`);
    return;
  }
  if (url.pathname === '/article.png') {
    // One teal pixel.
    response.writeHead(200, { 'content-type': 'image/png' });
    response.end(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    return;
  }
  if (url.pathname === '/ready') {
    // Readiness means *both* halves answer. Probing the Worker alone would let a
    // stale one from an earlier run satisfy the check while this key server — the
    // thing that signs the tokens — was never started.
    try {
      const probe = await fetch(`http://localhost:${WORKER_PORT}/api/health`);
      response.writeHead(probe.ok ? 200 : 503);
    } catch {
      response.writeHead(503);
    }
    response.end();
    return;
  }
  if (url.pathname === '/token') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end(await mint(url.searchParams));
    return;
  }
  response.writeHead(404);
  response.end();
});

await new Promise((resolve) => keyServer.listen(KEY_PORT, resolve));
console.log(`keys on http://localhost:${KEY_PORT}`);

const worker = spawn(
  'npx',
  [
    'wrangler',
    'dev',
    '--local',
    '--port',
    String(WORKER_PORT),
    '--var',
    `FIREBASE_PROJECT_ID:${PROJECT_ID}`,
    '--var',
    `FIREBASE_JWKS_URL:http://localhost:${KEY_PORT}/jwks`,
    // The link-preview test page is served by the key server, on localhost.
    '--var',
    'UNFURL_ALLOW_LOCAL:1',
    // A window that vanished is dropped after 45 seconds here, not 3 minutes.
    '--var',
    'PEER_STALE_MS:45000',
    '--assets',
    ASSETS,
  ],
  { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, CI: '1' } },
);

const shutdown = () => {
  worker.kill('SIGTERM');
  keyServer.close();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
worker.on('exit', (code) => {
  keyServer.close();
  process.exit(code ?? 0);
});
