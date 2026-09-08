// Security V1 Phase 8B — browser Origin/Fetch-Metadata CSRF defense,
// exercised end-to-end against a real, running API instance (real HTTP,
// real global guard chain: CsrfOriginGuard -> AuthGuard ->
// MustChangePasswordGuard -> RolesGuard, exactly as registered in
// app.module.ts).
//
// This is browser CSRF defense-in-depth, not cryptographic proof of origin
// — see csrf-origin.guard.ts for the full rationale. This runner proves the
// live, wired-up behavior: same-origin/non-browser traffic (including every
// other existing integration runner, none of which send Origin or
// Sec-Fetch-Site) is unaffected, while a foreign Origin or a cross-site
// Fetch Metadata signal is rejected before any mutation or audit row is
// produced, and before login's Argon2/rate-limit bookkeeping runs.
require('reflect-metadata');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const {
  guardedUrl,
  createAuthenticatedTestSession,
  cleanupAuthenticatedTestSession
} = require('./support/test-auth.cjs');

const port = 3113;
const origin = `http://127.0.0.1:${port}`;
const marker = `HUB_TEST_P8B_${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForApi() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return;
    } catch {
      // Starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for the security Phase 8B integration API.');
}

async function apiRequest(path, { method = 'GET', headers = {}, body, cookie } = {}) {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const responseBody = await response.json().catch(() => null);
  return { status: response.status, body: responseBody };
}

async function login(email, password, extraHeaders = {}) {
  const response = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify({ email, password })
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function run() {
  const testUrl = guardedUrl('TEST_DATABASE_URL', { required: true });
  let api;
  let adminSession = null;
  const createdUserIds = [];

  const pool = new Pool({ connectionString: testUrl.toString() });

  try {
    const live = await pool.query('SELECT current_database() AS name');
    assert(live.rows[0].name === 'daubert_hub_test', `Live database mismatch: got "${live.rows[0].name}".`);

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

    // ---------------------------------------------------------------------
    // Login: same-origin works, foreign-Origin/cross-site rejected BEFORE
    // Argon2/rate-limit bookkeeping, invalid credentials still generic 401,
    // rate-limited login still 429.
    // ---------------------------------------------------------------------
    const loginEmail = `${marker}_login@example.test`;

    const foreignOriginLogin = await login(loginEmail, 'whatever', { Origin: 'https://evil.example' });
    assert(foreignOriginLogin.status === 403, `Foreign-origin login: expected 403, got ${foreignOriginLogin.status}`);
    assert(foreignOriginLogin.body.code === 'CSRF_ORIGIN_NOT_ALLOWED', `Foreign-origin login: expected code CSRF_ORIGIN_NOT_ALLOWED, got ${JSON.stringify(foreignOriginLogin.body)}`);

    const crossSiteLogin = await login(loginEmail, 'whatever', { 'Sec-Fetch-Site': 'cross-site' });
    assert(crossSiteLogin.status === 403, `Cross-site login: expected 403, got ${crossSiteLogin.status}`);
    assert(crossSiteLogin.body.code === 'CSRF_ORIGIN_NOT_ALLOWED', `Cross-site login: expected code CSRF_ORIGIN_NOT_ALLOWED, got ${JSON.stringify(crossSiteLogin.body)}`);

    // If either rejected attempt above had counted toward the rate limiter,
    // fewer than 10 same-origin wrong attempts would already be blocked.
    for (let i = 0; i < 10; i++) {
      const attempt = await login(loginEmail, 'still-wrong', { Origin: origin });
      assert(attempt.status === 401, `Same-origin attempt ${i + 1} after CSRF rejections: expected 401 (counter must be unaffected by the rejected attempts), got ${attempt.status}`);
      assert(attempt.body.message === 'Correo o contraseña incorrectos.', `Same-origin attempt ${i + 1}: unexpected message ${JSON.stringify(attempt.body)}`);
    }
    const eleventh = await login(loginEmail, 'still-wrong', { Origin: origin });
    assert(eleventh.status === 429, `11th same-origin attempt: expected 429 (real threshold behavior unaffected by CSRF layer), got ${eleventh.status}`);

    // Valid credentials, same-origin, unaffected. createAuthenticatedTestSession
    // already performs one real login with no Origin/Sec-Fetch-Site (the
    // non-browser path); here we also prove the explicit same-origin browser
    // path succeeds identically, with a real Origin header attached.
    const validSession = await createAuthenticatedTestSession(`${origin}/api`, `${marker}_VALID`);
    createdUserIds.push({ userId: validSession.userId, email: validSession.email });
    const sameOriginValidLogin = await login(validSession.email, 'Synthetic-Integration-Password-123', { Origin: origin });
    assert(sameOriginValidLogin.status === 200, `Same-origin login with valid credentials: expected 200, got ${sameOriginValidLogin.status} (${JSON.stringify(sameOriginValidLogin.body)})`);

    // ---------------------------------------------------------------------
    // Authenticated business mutation: POST /api/users (ADMIN-only).
    // Correct Origin -> succeeds. Foreign Origin -> 403, no mutation, no
    // audit row. Cross-site Fetch Metadata -> 403, no mutation, no audit row.
    // ---------------------------------------------------------------------
    adminSession = await createAuthenticatedTestSession(`${origin}/api`, `${marker}_ADMIN`, { role: 'ADMIN' });
    createdUserIds.push({ userId: adminSession.userId, email: adminSession.email });

    const foreignEmail = `${marker}_foreign_attempt@example.test`;
    const foreignMutation = await apiRequest('/users', {
      method: 'POST',
      cookie: adminSession.cookie,
      headers: { Origin: 'https://evil.example' },
      body: { displayName: 'Foreign Origin Attempt', email: foreignEmail, role: 'GENERAL', temporaryPassword: 'Synthetic-Integration-Password-123' }
    });
    assert(foreignMutation.status === 403, `Foreign-origin mutation: expected 403, got ${foreignMutation.status}`);
    assert(foreignMutation.body.code === 'CSRF_ORIGIN_NOT_ALLOWED', `Foreign-origin mutation: unexpected body ${JSON.stringify(foreignMutation.body)}`);

    const crossSiteEmail = `${marker}_crosssite_attempt@example.test`;
    const crossSiteMutation = await apiRequest('/users', {
      method: 'POST',
      cookie: adminSession.cookie,
      headers: { 'Sec-Fetch-Site': 'cross-site' },
      body: { displayName: 'Cross Site Attempt', email: crossSiteEmail, role: 'GENERAL', temporaryPassword: 'Synthetic-Integration-Password-123' }
    });
    assert(crossSiteMutation.status === 403, `Cross-site mutation: expected 403, got ${crossSiteMutation.status}`);
    assert(crossSiteMutation.body.code === 'CSRF_ORIGIN_NOT_ALLOWED', `Cross-site mutation: unexpected body ${JSON.stringify(crossSiteMutation.body)}`);

    // Neither rejected attempt produced a row or an audit entry.
    const foreignRow = await pool.query('SELECT user_id FROM security.users WHERE email = $1', [foreignEmail]);
    assert(foreignRow.rowCount === 0, 'Foreign-origin mutation must not have created a user row.');
    const crossSiteRow = await pool.query('SELECT user_id FROM security.users WHERE email = $1', [crossSiteEmail]);
    assert(crossSiteRow.rowCount === 0, 'Cross-site mutation must not have created a user row.');
    const rejectedAudit = await pool.query(
      "SELECT count(*)::int AS n FROM audit.cambios WHERE esquema='security' AND tabla='users' AND (datos_nuevos->>'email' = $1 OR datos_nuevos->>'email' = $2)",
      [foreignEmail, crossSiteEmail]
    );
    assert(rejectedAudit.rows[0].n === 0, 'Rejected mutations must not have produced any audit.cambios row.');

    // The correct-Origin mutation succeeds normally.
    const successEmail = `${marker}_success@example.test`;
    const successMutation = await apiRequest('/users', {
      method: 'POST',
      cookie: adminSession.cookie,
      headers: { Origin: origin },
      body: { displayName: 'Correct Origin Success', email: successEmail, role: 'GENERAL', temporaryPassword: 'Synthetic-Integration-Password-123' }
    });
    assert(successMutation.status === 201, `Correct-origin mutation: expected 201, got ${successMutation.status} (${JSON.stringify(successMutation.body)})`);
    createdUserIds.push({ userId: successMutation.body.data.id, email: successEmail });

    const successRow = await pool.query('SELECT user_id FROM security.users WHERE email = $1', [successEmail]);
    assert(successRow.rowCount === 1, 'Correct-origin mutation should have created exactly one user row.');
    const successAudit = await pool.query(
      "SELECT count(*)::int AS n FROM audit.cambios WHERE esquema='security' AND tabla='users' AND datos_nuevos->>'email' = $1",
      [successEmail]
    );
    assert(successAudit.rows[0].n >= 1, 'Correct-origin mutation should have produced at least one audit.cambios row.');

    // A non-browser client (no Origin, no Sec-Fetch-Site) doing the same
    // mutation still succeeds — existing integration runners rely on this.
    const nonBrowserEmail = `${marker}_nonbrowser@example.test`;
    const nonBrowserMutation = await apiRequest('/users', {
      method: 'POST',
      cookie: adminSession.cookie,
      body: { displayName: 'Non Browser Client', email: nonBrowserEmail, role: 'GENERAL', temporaryPassword: 'Synthetic-Integration-Password-123' }
    });
    assert(nonBrowserMutation.status === 201, `Non-browser-client mutation: expected 201, got ${nonBrowserMutation.status} (${JSON.stringify(nonBrowserMutation.body)})`);
    createdUserIds.push({ userId: nonBrowserMutation.body.data.id, email: nonBrowserEmail });

    console.log('Security Phase 8B (browser Origin/CSRF defense) integration checks passed.');
  } finally {
    for (const identity of createdUserIds) await cleanupAuthenticatedTestSession(identity);
    await pool.end();
    if (api) api.kill();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
