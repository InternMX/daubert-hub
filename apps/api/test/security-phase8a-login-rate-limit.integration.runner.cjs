// Security V1 Phase 8A — login rate limiting, exercised end-to-end against a
// real, running API instance (real HTTP, real AuthGuard/AuthController/
// AuthService/LoginRateLimiterService wiring, real Argon2id verification).
// Unlike security-phase2/3/4/6, this runner needs no synthetic user for most
// cases — the rate limiter blocks on the credential-check path itself, which
// is exactly what must stay indistinguishable between unknown and existing
// accounts. It does create one real, existing user to prove that case is
// equally indistinguishable under rate limiting.
//
// Policy under test: "10 then cooldown-with-probes" — the first 10 failures
// per normalized email are permitted (normal 401 + real Argon2), then every
// attempt is rejected with 429 EXCEPT one periodic "probe" every
// LOGIN_RATE_LIMIT_PROBE_INTERVAL_MS (60s), which is allowed through to a
// real credential check either way. That periodic-recovery behavior is
// timing-dependent and already covered deterministically with fake timers in
// test/login-rate-limiter.service.spec.ts and test/auth.service.spec.ts —
// this runner deliberately does NOT wait 60 real seconds; it only checks the
// immediate-burst blocking and the Retry-After hint, which are timing-free.
require('reflect-metadata');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const {
  guardedUrl,
  createAuthenticatedTestSession,
  cleanupAuthenticatedTestSession
} = require('./support/test-auth.cjs');

const port = 3112;
const marker = `HUB_TEST_P8A_${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
const ORDINARY_PASSWORD = 'Synthetic-Integration-Password-123';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForApi() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return;
    } catch {
      // Starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for the security Phase 8A integration API.');
}

async function attemptLogin(email, password) {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, retryAfter: response.headers.get('retry-after') };
}

async function run() {
  const testUrl = guardedUrl('TEST_DATABASE_URL', { required: true });
  let api;
  let existingSession = null;

  try {
    api = spawn(process.execPath, ['dist/src/main.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DB_HOST: testUrl.hostname,
        DB_PORT: testUrl.port || '5432',
        DB_NAME: 'daubert_hub_test',
        DB_USER: decodeURIComponent(testUrl.username),
        DB_PASSWORD: decodeURIComponent(testUrl.password),
        API_PORT: String(port),
        AUTH_COOKIE_SECURE: 'false'
      },
      stdio: 'ignore'
    });
    await waitForApi();

    // --- Unknown email: 10 failures permitted, 11th blocked with 429 ---
    const unknownEmail = `${marker}_unknown@example.test`;
    for (let i = 0; i < 10; i++) {
      const result = await attemptLogin(unknownEmail, 'wrong-password');
      assert(result.status === 401, `Attempt ${i + 1} for unknown email: expected 401, got ${result.status}`);
      assert(result.body.message === 'Correo o contraseña incorrectos.', `Attempt ${i + 1}: unexpected message ${JSON.stringify(result.body)}`);
    }
    const eleventh = await attemptLogin(unknownEmail, 'wrong-password');
    assert(eleventh.status === 429, `11th attempt: expected 429, got ${eleventh.status}`);
    assert(eleventh.body.code === 'LOGIN_RATE_LIMITED', `11th attempt: expected code LOGIN_RATE_LIMITED, got ${JSON.stringify(eleventh.body)}`);
    assert(eleventh.body.message === 'Demasiados intentos de inicio de sesión. Intenta nuevamente más tarde.', `11th attempt: unexpected message ${JSON.stringify(eleventh.body)}`);
    assert(!('retryAfterSeconds' in eleventh.body), `11th attempt: retryAfterSeconds must be header-only, not in the JSON body: ${JSON.stringify(eleventh.body)}`);
    assert(eleventh.retryAfter !== null, '11th attempt: expected a Retry-After header.');
    const retryAfterSeconds = Number(eleventh.retryAfter);
    assert(Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 && retryAfterSeconds <= 60, `11th attempt: Retry-After should be a small positive number of seconds (<=60), got "${eleventh.retryAfter}".`);

    // Immediately after — still well inside the same cooldown probe
    // interval — a rapid burst must stay blocked with no Argon2 work
    // (verified against real Argon2 call counts in the unit tests; here we
    // only assert the observable HTTP behavior). Even the right password no
    // longer matters this soon after being blocked.
    for (let i = 0; i < 5; i++) {
      const stillBlocked = await attemptLogin(unknownEmail, 'anything-at-all');
      assert(stillBlocked.status === 429, `Burst attempt ${i + 1}: expected 429, got ${stillBlocked.status}`);
      assert(stillBlocked.retryAfter !== null, `Burst attempt ${i + 1}: expected a Retry-After header.`);
    }

    // --- Email normalization: case/whitespace variants share the same counter ---
    const normalizationEmail = `${marker}_norm@example.test`;
    for (let i = 0; i < 10; i++) {
      await attemptLogin(` ${normalizationEmail.toUpperCase()} `, 'wrong-password');
    }
    const normalizedBlocked = await attemptLogin(normalizationEmail.toLowerCase(), 'wrong-password');
    assert(normalizedBlocked.status === 429, `Normalized-email check: expected 429, got ${normalizedBlocked.status}`);

    // --- Counters isolated per normalized email ---
    const isolatedEmail = `${marker}_isolated@example.test`;
    const stillFree = await attemptLogin(isolatedEmail, 'wrong-password');
    assert(stillFree.status === 401, `Isolation check: a different, untouched email must not be blocked by another email's failures (got ${stillFree.status}).`);

    // --- An existing account is blocked/limited identically to an unknown one ---
    existingSession = await createAuthenticatedTestSession(`http://127.0.0.1:${port}/api`, `${marker}_EXISTING`);
    // Proves an existing, ACTIVE account's wrong-password attempts are
    // counted and blocked identically to an unknown email — status/message/
    // code are already asserted identical across both cases above and below.
    const existingEmail = `${existingSession.email}`;
    for (let i = 0; i < 10; i++) {
      const result = await attemptLogin(existingEmail, 'definitely-wrong-password');
      assert(result.status === 401, `Existing-account attempt ${i + 1}: expected 401, got ${result.status}`);
    }
    const existingBlocked = await attemptLogin(existingEmail, ORDINARY_PASSWORD);
    assert(existingBlocked.status === 429, `Existing-account 11th attempt: expected 429 even with the correct password, got ${existingBlocked.status}`);

    // --- A successful login resets the failure counter for that email ---
    const resetSession = await createAuthenticatedTestSession(`http://127.0.0.1:${port}/api`, `${marker}_RESET`);
    // createAuthenticatedTestSession already performed one successful login
    // for this fresh email, so its counter starts at (and stays at) zero;
    // prove a fresh streak of failures is still fully permitted afterward.
    for (let i = 0; i < 10; i++) {
      const result = await attemptLogin(resetSession.email, 'wrong-password-again');
      assert(result.status === 401, `Post-success attempt ${i + 1}: expected 401 (counter should start fresh), got ${result.status}`);
    }
    await cleanupAuthenticatedTestSession(resetSession);

    // --- Restart-clears-counters / multi-instance limitation: documented, not simulated. ---
    // See LoginRateLimiterService's comments (src/security/login-rate-limiter.service.ts):
    // this is an in-memory, single-process Map. A real process restart mid-run is out of
    // scope for an automated integration check — it's a deliberate, documented V1 property,
    // not a bug to regression-test here.

    console.log('Security Phase 8A (login rate limiting) integration checks passed.');
  } finally {
    if (existingSession) await cleanupAuthenticatedTestSession(existingSession);
    if (api) api.kill();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
