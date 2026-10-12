// End-to-end proof of the startup database guard using the REAL compiled API (dist/src/main.js).
//
// Safety: every "unsafe" case points DB_HOST at 127.0.0.1:1 (nothing listens there), so even if the
// guard were broken the process could not reach any real database; the case would then fail because
// the API would start listening / not exit. The only case that opens a real connection is the final
// positive one, which is restricted to daubert_hub_test (TEST_DATABASE_URL) and only calls /api/health.
// The child runs in an empty temp directory so apps/api/.env is NOT loaded: the environment is hermetic.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAIN = path.join(__dirname, '..', 'dist', 'src', 'main.js');
// Fake marker used only to prove it never reaches the logs (assembled so no credential-shaped literal is committed).
const PLACEHOLDER_PASSWORD = ['guard', 'test', 'marker', '9f3b'].join('-');
const results = [];

function assert(condition, message) { if (!condition) throw new Error(message); }
const inContainer = fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');

function guardedTestUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  if (decodeURIComponent(url.pathname).replace(/^\//, '') !== 'daubert_hub_test') throw new Error('TEST_DATABASE_URL must point at daubert_hub_test.');
  return url;
}

// Starts the API; resolves with { exitCode, listened, log, health } after it exits or after maxMs.
async function runApi(name, env, { maxMs = 25000, stopWhenHealthy = false } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dbguard-'));
  const port = 3200 + Math.floor(Math.random() * 600);
  const childEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, ...env, API_PORT: String(port) };
  const child = spawn(process.execPath, [MAIN], { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = ''; child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
  let exitCode = null; child.on('exit', (code) => { exitCode = code; });
  let listened = false; let health = null;
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline && exitCode === null) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
      listened = true; health = await response.json().catch(() => null);
      if (stopWhenHealthy) break;
    } catch { /* not listening (yet) */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (exitCode === null) { child.kill(); await new Promise((resolve) => child.once('exit', resolve)); }
  fs.rmSync(cwd, { recursive: true, force: true });
  const clean = log.replace(/\x1b\[[0-9;]*m/g, '');
  return { name, exitCode, listened, health, log: clean };
}

function expectRejected(result, pattern) {
  assert(result.exitCode === 1, `${result.name}: expected exit code 1, got ${result.exitCode}.`);
  assert(!result.listened, `${result.name}: the API accepted a request before/while being rejected.`);
  assert(pattern.test(result.log), `${result.name}: expected log to match ${pattern}.`);
  assert(!result.log.includes(PLACEHOLDER_PASSWORD), `${result.name}: the log leaked the configured password.`);
  assert(!/postgres(ql)?:\/\//.test(result.log), `${result.name}: the log contains a connection string.`);
  results.push(`PASS  ${result.name}`);
}

async function run() {
  assert(fs.existsSync(MAIN), 'dist/src/main.js not found: run `npm run build` first.');
  const unreachable = { DB_HOST: '127.0.0.1', DB_PORT: '1', DB_PASSWORD: PLACEHOLDER_PASSWORD };

  expectRejected(
    await runApi('direct start, no NODE_ENV, DB_NAME=daubert_global -> rejected before listening', { ...unreachable, DB_NAME: 'daubert_global', DB_USER: 'guard_test_user' }),
    /production database "daubert_global"/
  );
  expectRejected(
    await runApi('direct start, NODE_ENV=test, DB_NAME=daubert_global -> rejected before listening', { ...unreachable, NODE_ENV: 'test', DB_NAME: 'daubert_global', DB_USER: 'guard_test_user' }),
    /production database "daubert_global"/
  );
  if (inContainer) {
    results.push('SKIP  host with NODE_ENV=production: this runner itself runs inside a container, where that combination IS the production runtime.');
  } else {
    expectRejected(
      await runApi('host (no container) with NODE_ENV=production + daubert_global -> rejected: NODE_ENV alone is not a boundary', { ...unreachable, NODE_ENV: 'production', DB_NAME: 'daubert_global', DB_USER: 'guard_test_user' }),
      /production database "daubert_global"/
    );
  }
  expectRejected(
    await runApi('production role against a TEST database name -> rejected before connecting', { ...unreachable, DB_NAME: 'daubert_hub_test', DB_USER: 'daubert_hub_app' }),
    /production role "daubert_hub_app"/
  );
  expectRejected(
    await runApi('safe DB_NAME but the connection fails -> startup closed with a generic message', { ...unreachable, DB_NAME: 'daubert_hub_test', DB_USER: 'daubert_hub_test_user' }),
    /could not verify the live database/
  );

  const testUrl = guardedTestUrl(process.env.TEST_DATABASE_URL);
  if (!testUrl) {
    results.push('SKIP  positive case against daubert_hub_test: TEST_DATABASE_URL is not set.');
  } else {
    const ok = await runApi('development + daubert_hub_test -> starts and reports TEST', {
      DB_HOST: testUrl.hostname, DB_PORT: testUrl.port || '5432', DB_NAME: 'daubert_hub_test',
      DB_USER: decodeURIComponent(testUrl.username), DB_PASSWORD: decodeURIComponent(testUrl.password)
    }, { stopWhenHealthy: true, maxMs: 40000 });
    assert(ok.listened && ok.health && ok.health.environment === 'TEST', `${ok.name}: expected /api/health environment=TEST, got ${JSON.stringify(ok.health)}.`);
    assert(/Live database guard passed: connected to "daubert_hub_test"/.test(ok.log), `${ok.name}: guard success line missing.`);
    assert(!ok.log.includes(decodeURIComponent(testUrl.password)), `${ok.name}: the log leaked the TEST password.`);
    results.push(`PASS  ${ok.name}`);
  }
}

run()
  .then(() => { for (const line of results) console.log(line); console.log(`Production database guard integration checks passed (${results.filter((l) => l.startsWith('PASS')).length} passed, ${results.filter((l) => l.startsWith('SKIP')).length} skipped).`); })
  .catch((error) => { for (const line of results) console.log(line); console.error(error.message); process.exitCode = 1; });
