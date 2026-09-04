require('reflect-metadata');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { once } = require('node:events');

const port = 3106;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function guardedUrl(envVarName, { required } = { required: false }) {
  const value = process.env[envVarName];
  if (!value) {
    if (required) throw new Error(`${envVarName} must be set for database integration tests.`);
    return null;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${envVarName} must be a valid PostgreSQL URL.`);
  }
  const databaseName = decodeURIComponent(url.pathname).replace(/^\//, '');
  if (databaseName !== 'daubert_hub_test') {
    throw new Error(`${envVarName} must point at daubert_hub_test; got "${databaseName}".`);
  }
  return url;
}

function buildDatabaseService(DatabaseService, url) {
  const config = {
    get: (key) => {
      if (key !== 'database') throw new Error(`Unexpected config key requested: ${key}`);
      return {
        host: url.hostname,
        port: Number(url.port || 5432),
        name: decodeURIComponent(url.pathname).replace(/^\//, ''),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password)
      };
    }
  };
  return new DatabaseService(config);
}

async function assertLiveDatabase(database, label) {
  const [row] = await database.query('SELECT current_database() AS name');
  assert(row && row.name === 'daubert_hub_test', `${label}: live database mismatch, got "${row && row.name}".`);
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
  throw new Error('Timed out waiting for the security Phase 3 integration API.');
}

function parseSetCookie(setCookieHeaderValue) {
  const parts = setCookieHeaderValue.split(';').map((part) => part.trim());
  const [nameValue, ...attributeParts] = parts;
  const separatorIndex = nameValue.indexOf('=');
  const name = nameValue.slice(0, separatorIndex);
  const value = nameValue.slice(separatorIndex + 1);
  const attributes = new Set(attributeParts.map((attribute) => attribute.split('=')[0].toLowerCase()));
  const maxAgeAttribute = attributeParts.find((attribute) => attribute.toLowerCase().startsWith('max-age='));
  return {
    name,
    value,
    httpOnly: attributes.has('httponly'),
    secure: attributes.has('secure'),
    sameSite: attributeParts.find((attribute) => attribute.toLowerCase().startsWith('samesite='))?.split('=')[1] ?? null,
    path: attributeParts.find((attribute) => attribute.toLowerCase().startsWith('path='))?.split('=')[1] ?? null,
    maxAgeSeconds: maxAgeAttribute ? Number(maxAgeAttribute.split('=')[1]) : null
  };
}

async function cleanup(createdIds) {
  const hasFixtures = createdIds.userId || createdIds.sessionIds.length > 0;
  if (!hasFixtures) return;
  const adminUrl = guardedUrl('TEST_DATABASE_ADMIN_URL');

  if (!adminUrl) {
    console.warn('MANUAL CLEANUP REQUIRED: the application role has no DELETE on security.users/security.sessions by design.');
    console.warn('Run the following against daubert_hub_test with an administrative connection:');
    if (createdIds.userId) {
      console.warn(`  DELETE FROM security.sessions WHERE user_id = ${createdIds.userId};`);
      console.warn(`  DELETE FROM audit.cambios WHERE esquema='security' AND tabla='users' AND registro_id='user_id=${createdIds.userId}';`);
      console.warn(`  DELETE FROM security.users WHERE user_id = ${createdIds.userId};`);
    }
    return;
  }

  const { Pool } = require('pg');
  const adminPool = new Pool({ connectionString: adminUrl.toString() });
  try {
    const live = await adminPool.query('SELECT current_database() AS name');
    assert(live.rows[0].name === 'daubert_hub_test', `Admin cleanup connection is not daubert_hub_test (got "${live.rows[0].name}").`);
    if (createdIds.userId) {
      await adminPool.query('DELETE FROM security.sessions WHERE user_id = $1', [createdIds.userId]);
      await adminPool.query('DELETE FROM audit.cambios WHERE esquema=$1 AND tabla=$2 AND registro_id=$3', ['security', 'users', `user_id=${createdIds.userId}`]);
      await adminPool.query('DELETE FROM security.users WHERE user_id = $1', [createdIds.userId]);
      const leftoverUser = await adminPool.query('SELECT count(*)::int AS n FROM security.users WHERE user_id = $1', [createdIds.userId]);
      const leftoverSessions = await adminPool.query('SELECT count(*)::int AS n FROM security.sessions WHERE user_id = $1', [createdIds.userId]);
      const leftoverAudit = await adminPool.query("SELECT count(*)::int AS n FROM audit.cambios WHERE esquema='security' AND tabla='users' AND registro_id=$1", [`user_id=${createdIds.userId}`]);
      assert(leftoverUser.rows[0].n === 0, 'Automated admin cleanup left the synthetic user behind.');
      assert(leftoverSessions.rows[0].n === 0, 'Automated admin cleanup left synthetic sessions behind.');
      assert(leftoverAudit.rows[0].n === 0, 'Automated admin cleanup left synthetic audit rows behind.');
    }
    console.log('Security Phase 3 cleanup verified (automated via TEST_DATABASE_ADMIN_URL).');
  } finally {
    await adminPool.end();
  }
}

async function run() {
  const testUrl = guardedUrl('TEST_DATABASE_URL', { required: true });

  const { DatabaseService } = require('../dist/src/database/database.service');
  const { PasswordService } = require('../dist/src/security/password.service');
  const { UsersRepository } = require('../dist/src/security/users.repository');
  const { UsersService } = require('../dist/src/security/users.service');

  const database = buildDatabaseService(DatabaseService, testUrl);
  await assertLiveDatabase(database, 'startup');

  const repository = new UsersRepository(database);
  const passwords = new PasswordService();
  const users = new UsersService(repository, passwords);

  const marker = `hub_test_security_phase3_${randomUUID().replace(/-/g, '')}`;
  const email = `${marker}@example.test`;
  const password = 'Synthetic-Phase3-Password-123';
  const setupContext = { requestId: `security-phase3-setup-${randomUUID()}`, origin: 'DAUBERT_HUB_TEST', actorUserId: null, actorUserEmail: null };

  const createdIds = { userId: null, sessionIds: [] };
  let api;

  try {
    const synthetic = await users.createUser({ displayName: `${marker} display`, email, password, role: 'GENERAL' }, setupContext);
    createdIds.userId = synthetic.id;

    const url = testUrl;
    const databaseName = decodeURIComponent(url.pathname).replace(/^\//, '');
    api = spawn(process.execPath, ['dist/src/main.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DB_HOST: url.hostname,
        DB_PORT: url.port || '5432',
        DB_NAME: databaseName,
        DB_USER: decodeURIComponent(url.username),
        DB_PASSWORD: decodeURIComponent(url.password),
        API_PORT: String(port),
        AUTH_COOKIE_SECURE: 'false'
      },
      stdio: 'ignore'
    });
    await waitForApi();

    // --- invalid login paths: all produce the identical status + shape ---
    const wrongPassword = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'not-the-real-password' }) });
    const unknownEmail = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${marker}_nobody@example.test`, password: 'anything-at-all' }) });
    await database.query("UPDATE security.users SET status = 'INACTIVE' WHERE user_id = $1", [createdIds.userId]);
    const inactiveLogin = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    await database.query("UPDATE security.users SET status = 'ACTIVE' WHERE user_id = $1", [createdIds.userId]);

    for (const [label, response] of [['wrong password', wrongPassword], ['unknown email', unknownEmail], ['inactive user', inactiveLogin]]) {
      assert(response.status === 401, `${label}: expected 401, got ${response.status}`);
      const body = await response.json();
      assert(body.message === 'Correo o contraseña incorrectos.', `${label}: unexpected message "${body.message}"`);
      assert(response.headers.getSetCookie().length === 0, `${label}: unexpectedly set a cookie on a failed login.`);
    }

    // --- successful login ---
    // Baseline right before the login that matters for the last_login_at
    // audit-noise check below: the earlier inactive/active toggles above are
    // genuine status changes and correctly DO produce their own audit rows.
    const auditRowsBeforeLogin = await database.query("SELECT count(*)::int AS n FROM audit.cambios WHERE esquema='security' AND tabla='users' AND registro_id=$1", [`user_id=${createdIds.userId}`]);
    const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const loginBody = await loginResponse.json();
    assert(loginResponse.status === 200, `Login failed with ${loginResponse.status}: ${JSON.stringify(loginBody)}`);
    assert(Object.keys(loginBody).join(',') === 'data', 'Login response has an unexpected top-level shape.');
    assert(Object.keys(loginBody.data).join(',') === 'user', 'Login response data has an unexpected shape.');
    const safeUserKeys = Object.keys(loginBody.data.user).sort();
    assert(safeUserKeys.join(',') === ['createdAt', 'displayName', 'email', 'id', 'lastLoginAt', 'mustChangePassword', 'role', 'status', 'updatedAt'].sort().join(','), `Login user shape leaked or omitted fields: ${safeUserKeys.join(',')}`);
    assert(!('passwordHash' in loginBody.data.user), 'Login response leaked passwordHash.');
    assert(loginBody.data.user.id === createdIds.userId, 'Login response user id does not match the synthetic user.');
    assert(loginBody.data.user.mustChangePassword === true, 'New user did not have mustChangePassword=true.');
    assert(!JSON.stringify(loginBody).includes(password), 'Login response body leaked the plaintext password.');

    const setCookies = loginResponse.headers.getSetCookie();
    assert(setCookies.length === 1, `Expected exactly one Set-Cookie header, got ${setCookies.length}.`);
    const cookie = parseSetCookie(setCookies[0]);
    assert(cookie.name === 'daubert_session', `Unexpected cookie name: ${cookie.name}`);
    assert(cookie.httpOnly === true, 'Session cookie is missing HttpOnly.');
    assert(cookie.sameSite && cookie.sameSite.toLowerCase() === 'strict', `Session cookie SameSite is not Strict: ${cookie.sameSite}`);
    assert(cookie.path === '/api', `Session cookie Path is not /api: ${cookie.path}`);
    assert(cookie.secure === false, 'Session cookie unexpectedly set Secure with AUTH_COOKIE_SECURE=false (TEST).');
    assert(cookie.maxAgeSeconds === 12 * 60 * 60, `Session cookie Max-Age is not 12 hours: ${cookie.maxAgeSeconds}`);
    assert(!JSON.stringify(loginBody).includes(cookie.value), 'Response body unexpectedly contains the raw session token.');

    const rawToken = cookie.value;
    const cookieHeader = `daubert_session=${rawToken}`;

    // --- raw token vs stored hash ---
    const [sessionRow] = await database.query('SELECT session_id::text AS id, token_hash FROM security.sessions WHERE user_id = $1 ORDER BY session_id DESC LIMIT 1', [createdIds.userId]);
    assert(sessionRow, 'No session row was created for the synthetic user.');
    createdIds.sessionIds.push(sessionRow.id);
    assert(sessionRow.token_hash !== rawToken, 'Raw session token was stored verbatim in security.sessions.');
    assert(sessionRow.token_hash === createHash('sha256').update(rawToken, 'utf8').digest('hex'), 'Stored token_hash does not match SHA-256(raw token).');

    // --- last_login_at behavior per the §11 decision (no generic audit row from login alone) ---
    const [afterLoginUser] = await database.query('SELECT last_login_at FROM security.users WHERE user_id = $1', [createdIds.userId]);
    assert(afterLoginUser.last_login_at !== null, 'last_login_at was not updated on successful login.');
    const auditRowsAfterLogin = await database.query("SELECT count(*)::int AS n FROM audit.cambios WHERE esquema='security' AND tabla='users' AND registro_id=$1", [`user_id=${createdIds.userId}`]);
    assert(auditRowsAfterLogin[0].n === auditRowsBeforeLogin[0].n, `Login produced generic audit noise: ${auditRowsBeforeLogin[0].n} rows before, ${auditRowsAfterLogin[0].n} after.`);

    // --- GET /auth/me ---
    const meWithCookie = await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers: { cookie: cookieHeader } });
    assert(meWithCookie.status === 200, `/auth/me with a valid cookie failed with ${meWithCookie.status}`);
    const meBody = await meWithCookie.json();
    assert(meBody.data.user.id === createdIds.userId, '/auth/me returned the wrong user.');
    assert(!('passwordHash' in meBody.data.user), '/auth/me leaked passwordHash.');

    const meWithoutCookie = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
    assert(meWithoutCookie.status === 401, `/auth/me without a cookie should be 401, got ${meWithoutCookie.status}`);

    // --- expired session -> 401 (simulated by backdating both created_at and
    // expires_at together, into the past, so ck_sessions_expires_after_created
    // (expires_at > created_at) still holds while expires_at < now(); the
    // app role has UPDATE, so no admin connection is needed for this) ---
    await database.query("UPDATE security.sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE session_id = $1", [sessionRow.id]);
    const meExpired = await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers: { cookie: cookieHeader } });
    assert(meExpired.status === 401, `Expired session should yield 401, got ${meExpired.status}`);
    await database.query("UPDATE security.sessions SET created_at = now(), expires_at = now() + interval '1 hour' WHERE session_id = $1", [sessionRow.id]);

    // --- inactive user with an otherwise-valid session -> 401 ---
    await database.query("UPDATE security.users SET status = 'INACTIVE' WHERE user_id = $1", [createdIds.userId]);
    const meInactiveUser = await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers: { cookie: cookieHeader } });
    assert(meInactiveUser.status === 401, `Inactive user with a valid session should yield 401, got ${meInactiveUser.status}`);
    await database.query("UPDATE security.users SET status = 'ACTIVE' WHERE user_id = $1", [createdIds.userId]);

    // Confirm the session is genuinely usable again once the user is ACTIVE and not expired.
    const meRestored = await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers: { cookie: cookieHeader } });
    assert(meRestored.status === 200, `Session should be valid again once restored, got ${meRestored.status}`);

    // --- logout ---
    const logoutResponse = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, { method: 'POST', headers: { cookie: cookieHeader } });
    assert(logoutResponse.status === 200, `Logout failed with ${logoutResponse.status}`);
    const logoutCookies = logoutResponse.headers.getSetCookie();
    assert(logoutCookies.length === 1, `Logout should clear exactly one cookie, got ${logoutCookies.length}.`);
    const clearedCookie = parseSetCookie(logoutCookies[0]);
    assert(clearedCookie.name === 'daubert_session', 'Logout did not clear daubert_session.');
    assert(clearedCookie.value === '' || clearedCookie.maxAgeSeconds === 0 || clearedCookie.maxAgeSeconds === undefined, 'Logout Set-Cookie does not look like a clearing cookie.');

    const meAfterLogout = await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers: { cookie: cookieHeader } });
    assert(meAfterLogout.status === 401, `/auth/me after logout should be 401, got ${meAfterLogout.status}`);

    const [sessionAfterLogout] = await database.query('SELECT revoked_at FROM security.sessions WHERE session_id = $1', [sessionRow.id]);
    assert(sessionAfterLogout.revoked_at !== null, 'Logout did not revoke the session row.');

    // --- logout is idempotent: missing cookie, and an already-revoked session ---
    const logoutNoCookie = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, { method: 'POST' });
    assert(logoutNoCookie.status === 200, `Logout with no cookie should still succeed safely, got ${logoutNoCookie.status}`);
    assert(logoutNoCookie.headers.getSetCookie().length === 1, 'Logout with no cookie should still clear the cookie.');

    const logoutAlreadyRevoked = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, { method: 'POST', headers: { cookie: cookieHeader } });
    assert(logoutAlreadyRevoked.status === 200, `Logout of an already-revoked session should still succeed safely, got ${logoutAlreadyRevoked.status}`);

    console.log('Security Phase 3 integration checks passed.');
  } finally {
    await assertLiveDatabase(database, 'pre-cleanup');
    await cleanup(createdIds);
    if (api && api.exitCode === null && api.signalCode === null) {
      api.kill();
      await once(api, 'exit');
    }
    await database.onModuleDestroy();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
