require('reflect-metadata');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { Pool } = require('pg');
const {
  guardedUrl,
  buildDatabaseService,
  createAuthenticatedTestSession,
  cleanupAuthenticatedTestSession
} = require('./support/test-auth.cjs');

const port = 3110;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertLiveTestDatabase(database, label) {
  const [row] = await database.query('SELECT current_database() AS name');
  assert(row && row.name === 'daubert_hub_test', `${label}: live database mismatch, got "${row && row.name}".`);
}

async function assertLiveTestPool(pool, label) {
  const row = (await pool.query('SELECT current_database() AS name')).rows[0];
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
  throw new Error('Timed out waiting for the security Phase 4 integration API.');
}

async function apiRequest(path, { method = 'GET', cookie, body, headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const responseBody = await response.json().catch(() => null);
  return { response, body: responseBody, requestId: response.headers.get('x-request-id') };
}

async function login(email, password) {
  const result = await apiRequest('/auth/login', { method: 'POST', body: { email, password } });
  const setCookies = typeof result.response.headers.getSetCookie === 'function' ? result.response.headers.getSetCookie() : [];
  const sessionCookie = setCookies.find((value) => value.startsWith('daubert_session='));
  return { ...result, cookie: sessionCookie ? sessionCookie.split(';')[0] : null };
}

async function run() {
  const testUrl = guardedUrl('TEST_DATABASE_URL', { required: true });
  const { DatabaseService } = require('../dist/src/database/database.service');
  const { PasswordService } = require('../dist/src/security/password.service');
  const { UsersRepository } = require('../dist/src/security/users.repository');
  const { UsersService } = require('../dist/src/security/users.service');

  const database = buildDatabaseService(DatabaseService, testUrl);
  const pool = new Pool({ connectionString: testUrl.toString() });
  await assertLiveTestDatabase(database, 'startup');
  await assertLiveTestPool(pool, 'startup pool');

  const passwords = new PasswordService();
  const users = new UsersService(new UsersRepository(database), passwords);
  const marker = `HUB_TEST_SECURITY_PHASE4_${randomUUID().replace(/-/g, '').toUpperCase()}`;
  const requiredEmail = `${marker}_REQUIRED@example.test`;
  const requiredOldPassword = 'Synthetic-Phase4-Original-Password-123';
  const requiredNewPassword = 'Synthetic-Phase4-Rotated-Password-456';
  const requiredSetupContext = {
    requestId: `security-phase4-setup-${randomUUID()}`,
    origin: 'DAUBERT_HUB_TEST',
    actorUserId: null,
    actorUserEmail: null
  };
  const businessRequestIds = new Set();
  const providerIds = new Set();
  let ordinarySession = null;
  let requiredSession = null;
  let api;

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

    const health = await apiRequest('/health');
    assert(health.response.status === 200 && health.body.status === 'ok' && health.body.database === 'connected', 'Health is not publicly reachable with the minimal response.');
    const logoutNoCookie = await apiRequest('/auth/logout', { method: 'POST' });
    assert(logoutNoCookie.response.status === 200 && logoutNoCookie.body.data.success === true, 'Logout is not public/idempotent without a cookie.');
    const logoutInvalidCookie = await apiRequest('/auth/logout', { method: 'POST', cookie: 'daubert_session=invalid-phase4-cookie' });
    assert(logoutInvalidCookie.response.status === 200, 'Logout is not public/idempotent with an invalid cookie.');
    assert((await apiRequest('/auth/me')).response.status === 401, '/auth/me without a valid session did not return 401.');
    assert((await apiRequest('/providers')).response.status === 401, 'A representative business GET without a cookie did not return 401.');
    assert((await apiRequest('/providers', { cookie: 'daubert_session=invalid-phase4-cookie' })).response.status === 401, 'A representative business GET with an invalid cookie did not return 401.');

    ordinarySession = await createAuthenticatedTestSession(`http://127.0.0.1:${port}/api`, marker);
    assert(typeof ordinarySession.userId === 'string' && /^[0-9]+$/.test(ordinarySession.userId), 'Ordinary auth helper did not preserve the BIGINT user id as a string.');
    const publicLogin = await login(ordinarySession.email, 'Synthetic-Integration-Password-123');
    assert(publicLogin.response.status === 200 && publicLogin.cookie, 'Login was not publicly reachable without an existing session.');

    const generalBusiness = await apiRequest('/providers', { cookie: ordinarySession.cookie });
    assert(generalBusiness.response.status === 200, 'A valid GENERAL session could not reach a business route.');

    const sessionForExpiry = (await pool.query(
      'SELECT session_id::text AS id FROM security.sessions WHERE user_id = $1 AND revoked_at IS NULL ORDER BY session_id DESC LIMIT 1',
      [ordinarySession.userId]
    )).rows[0];
    assert(sessionForExpiry && typeof sessionForExpiry.id === 'string', 'Could not identify the ordinary session as a BIGINT-safe string.');
    await pool.query("UPDATE security.sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE session_id = $1", [sessionForExpiry.id]);
    assert((await apiRequest('/providers', { cookie: publicLogin.cookie })).response.status === 401, 'An expired session did not return 401.');

    const revocableLogin = await login(ordinarySession.email, 'Synthetic-Integration-Password-123');
    assert(revocableLogin.response.status === 200 && revocableLogin.cookie, 'Could not create the revocation test session.');
    const revocableHash = createHash('sha256').update(revocableLogin.cookie.slice('daubert_session='.length), 'utf8').digest('hex');
    await pool.query('UPDATE security.sessions SET revoked_at = now() WHERE token_hash = $1', [revocableHash]);
    assert((await apiRequest('/providers', { cookie: revocableLogin.cookie })).response.status === 401, 'A revoked session did not return 401.');

    const inactiveLogin = await login(ordinarySession.email, 'Synthetic-Integration-Password-123');
    assert(inactiveLogin.response.status === 200 && inactiveLogin.cookie, 'Could not create the inactive-user test session.');
    const inactiveTokenHash = createHash('sha256').update(inactiveLogin.cookie.slice('daubert_session='.length), 'utf8').digest('hex');
    await pool.query("UPDATE security.users SET status = 'INACTIVE' WHERE user_id = $1", [ordinarySession.userId]);
    assert((await apiRequest('/providers', { cookie: inactiveLogin.cookie })).response.status === 401, 'An inactive user with a valid session did not return 401.');
    assert((await apiRequest('/auth/logout', { method: 'POST', cookie: inactiveLogin.cookie })).response.status === 200, 'An inactive user could not safely log out.');
    assert((await pool.query('SELECT revoked_at IS NOT NULL AS revoked FROM security.sessions WHERE token_hash = $1', [inactiveTokenHash])).rows[0].revoked === true, 'Logout did not revoke the inactive user session.');
    await pool.query("UPDATE security.users SET status = 'ACTIVE' WHERE user_id = $1", [ordinarySession.userId]);
    assert((await apiRequest('/providers', { cookie: inactiveLogin.cookie })).response.status === 401, 'An inactive-user session became usable again after logout and reactivation.');
    assert((await apiRequest('/providers', { cookie: ordinarySession.cookie })).response.status === 200, 'A valid ACTIVE GENERAL session could not reach a business route.');

    const requiredUser = await users.createUser({
      displayName: `${marker} required display`,
      email: requiredEmail,
      password: requiredOldPassword,
      role: 'GENERAL'
    }, requiredSetupContext);
    requiredSession = { userId: requiredUser.id, email: requiredEmail, marker: `${marker}_REQUIRED` };
    assert(typeof requiredUser.id === 'string' && requiredUser.mustChangePassword === true, 'Mandatory-change fixture has an invalid id or password state.');

    const oldCredential = (await pool.query('SELECT password_hash, must_change_password FROM security.users WHERE user_id = $1', [requiredUser.id])).rows[0];
    assert(oldCredential.password_hash.startsWith('$argon2id$') && oldCredential.must_change_password === true, 'Mandatory-change fixture is not using Argon2id or the required state.');
    const requiredLogin = await login(requiredEmail, requiredOldPassword);
    assert(requiredLogin.response.status === 200 && requiredLogin.cookie && requiredLogin.body.data.user.mustChangePassword === true, 'Mandatory-change user could not log in normally.');
    assert((await apiRequest('/auth/me', { cookie: requiredLogin.cookie })).response.status === 200, '/auth/me was blocked during mandatory password change.');
    const blockedBusiness = await apiRequest('/providers', { cookie: requiredLogin.cookie });
    assert(blockedBusiness.response.status === 403 && blockedBusiness.body.code === 'PASSWORD_CHANGE_REQUIRED', 'Business access was not blocked by mandatory password policy.');

    const wrongCurrent = await apiRequest('/auth/change-password', {
      method: 'POST',
      cookie: requiredLogin.cookie,
      body: { currentPassword: 'Synthetic-Phase4-Wrong-Password-789', newPassword: requiredNewPassword }
    });
    assert(wrongCurrent.response.status === 401, 'Wrong current password was not rejected.');
    const afterWrong = (await pool.query('SELECT password_hash, must_change_password FROM security.users WHERE user_id = $1', [requiredUser.id])).rows[0];
    assert(afterWrong.password_hash === oldCredential.password_hash && afterWrong.must_change_password === true, 'Wrong current password changed credentials or cleared the required flag.');

    const samePassword = await apiRequest('/auth/change-password', {
      method: 'POST',
      cookie: requiredLogin.cookie,
      body: { currentPassword: requiredOldPassword, newPassword: requiredOldPassword }
    });
    assert(samePassword.response.status === 400, 'A new password equal to the current password was not rejected.');

    const spoofedRequestId = `caller-controlled-${randomUUID()}`;
    const changed = await apiRequest('/auth/change-password', {
      method: 'POST',
      cookie: requiredLogin.cookie,
      headers: { 'x-request-id': spoofedRequestId },
      body: { currentPassword: requiredOldPassword, newPassword: requiredNewPassword }
    });
    assert(changed.response.status === 200 && changed.body.data.user.mustChangePassword === false, `Valid password change failed: ${JSON.stringify(changed.body)}`);
    assert(changed.requestId && changed.requestId !== spoofedRequestId, 'Caller-controlled x-request-id became the trusted response correlation id.');

    const newCredential = (await pool.query('SELECT password_hash, must_change_password FROM security.users WHERE user_id = $1', [requiredUser.id])).rows[0];
    assert(newCredential.password_hash.startsWith('$argon2id$') && newCredential.password_hash !== oldCredential.password_hash, 'Password change did not persist a new Argon2id hash.');
    assert(newCredential.must_change_password === false, 'Password change did not clear must_change_password.');
    assert((await passwords.verifyPassword(newCredential.password_hash, requiredOldPassword)) === false, 'Old password still verifies after the change.');
    assert((await passwords.verifyPassword(newCredential.password_hash, requiredNewPassword)) === true, 'New password does not verify after the change.');
    assert((await apiRequest('/providers', { cookie: requiredLogin.cookie })).response.status === 200, 'The existing session did not become usable after password change.');
    assert((await login(requiredEmail, requiredOldPassword)).response.status === 401, 'Old password still logs in after the change.');
    assert((await login(requiredEmail, requiredNewPassword)).response.status === 200, 'New password cannot log in after the change.');

    const passwordAudit = (await pool.query(
      `SELECT request_id, usuario_id, usuario_email, datos_anteriores, datos_nuevos
       FROM audit.cambios
       WHERE esquema = 'security' AND tabla = 'users' AND registro_id = $1 AND operacion = 'UPDATE'
         AND datos_nuevos ->> 'password_changed' = 'true'
       ORDER BY cambio_id DESC LIMIT 1`,
      [`user_id=${requiredUser.id}`]
    )).rows[0];
    assert(passwordAudit, 'Password change did not produce a sanitized audit row.');
    assert(passwordAudit.usuario_id === requiredUser.id && passwordAudit.usuario_email === requiredEmail, 'Password audit actor identity does not match request.user.');
    assert(passwordAudit.datos_nuevos.password_changed === true, 'Password audit lacks password_changed=true.');
    assert(passwordAudit.request_id !== spoofedRequestId, 'Caller-controlled x-request-id reached the password audit row.');
    assert(!Object.prototype.hasOwnProperty.call(passwordAudit.datos_anteriores, 'password_hash') && !Object.prototype.hasOwnProperty.call(passwordAudit.datos_nuevos, 'password_hash'), 'Password audit exposes a password_hash key.');
    const passwordAuditJson = JSON.stringify(passwordAudit);
    for (const secret of [oldCredential.password_hash, newCredential.password_hash, requiredOldPassword, requiredNewPassword]) {
      assert(!passwordAuditJson.includes(secret), 'Password audit contains password or hash material.');
    }

    const providerName = `${marker}_AUDIT_PROVIDER`;
    const spoofedBusinessRequestId = `caller-controlled-${randomUUID()}`;
    const provider = await apiRequest('/providers', {
      method: 'POST',
      cookie: ordinarySession.cookie,
      headers: { 'x-request-id': spoofedBusinessRequestId },
      body: { commercialName: providerName, providerType: 'PROVEEDOR' }
    });
    assert(provider.response.status === 201, `Authenticated provider mutation failed: ${JSON.stringify(provider.body)}`);
    assert(provider.requestId && provider.requestId !== spoofedBusinessRequestId, 'Caller-controlled request id became the business response correlation id.');
    providerIds.add(provider.body.data.id);
    businessRequestIds.add(provider.requestId);
    const providerAudit = await pool.query(
      "SELECT request_id, usuario_id, usuario_email FROM audit.cambios WHERE origen = 'DAUBERT_HUB' AND request_id = $1",
      [provider.requestId]
    );
    assert(providerAudit.rows.length > 0, 'Authenticated provider mutation did not produce correlated audit rows.');
    assert(providerAudit.rows.every((row) => row.usuario_id === ordinarySession.userId && row.usuario_email === ordinarySession.email), 'Business audit actor identity does not match request.user.');
    assert((await pool.query('SELECT count(*)::int AS count FROM audit.cambios WHERE request_id = $1', [spoofedBusinessRequestId])).rows[0].count === 0, 'Caller-controlled request id reached audit.cambios.');

    console.log('Security Phase 4 integration checks passed.');
  } finally {
    if (api && api.exitCode === null && api.signalCode === null) {
      api.kill();
      await once(api, 'exit');
    }
    await assertLiveTestPool(pool, 'pre-business-cleanup');
    if (providerIds.size) {
      const cleanupRequestId = `security-phase4-cleanup-${randomUUID()}`;
      businessRequestIds.add(cleanupRequestId);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB_TEST_CLEANUP']);
        await client.query("SELECT set_config('app.request_id', $1, true)", [cleanupRequestId]);
        await client.query('DELETE FROM core.alias_empresa WHERE empresa_id = ANY($1::bigint[])', [[...providerIds]]);
        await client.query('DELETE FROM core.empresas_fiscales WHERE empresa_id = ANY($1::bigint[])', [[...providerIds]]);
        await client.query('DELETE FROM core.empresa_roles WHERE empresa_id = ANY($1::bigint[])', [[...providerIds]]);
        await client.query('DELETE FROM core.empresas WHERE empresa_id = ANY($1::bigint[])', [[...providerIds]]);
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* Preserve the cleanup error. */ }
        throw error;
      } finally {
        client.release();
      }
      await assertLiveTestPool(pool, 'pre-audit-cleanup');
      await pool.query('DELETE FROM audit.cambios WHERE request_id = ANY($1::text[])', [[...businessRequestIds]]);
    }
    await assertLiveTestDatabase(database, 'pre-security-cleanup');
    await cleanupAuthenticatedTestSession(requiredSession);
    await cleanupAuthenticatedTestSession(ordinarySession);
    await database.onModuleDestroy();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
