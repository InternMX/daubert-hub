require('reflect-metadata');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { Pool } = require('pg');
const {
  guardedUrl,
  createAuthenticatedTestSession,
  cleanupAuthenticatedTestSession
} = require('./support/test-auth.cjs');

const port = 3111;
// Kept short deliberately: emails built directly from this marker (targetA's,
// below) go through CreateUserDto/UpdateUserDto's @IsEmail(), which enforces
// the standard <=64 octet local-part limit — a long marker plus a suffix
// (e.g. "_TARGETA_NEW") can exceed that.
const marker = `HUB_TEST_P6_${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
const automationCode = `${marker}_AUTO`;
const seriesCode = `${marker}_SERIES`;
const ORDINARY_PASSWORD = 'Synthetic-Integration-Password-123';

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
  throw new Error('Timed out waiting for the security Phase 6 integration API.');
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

async function auditRow(pool, userId, operation, extraWhere = '', extraParams = []) {
  const rows = (await pool.query(
    `SELECT request_id, usuario_id, usuario_email, datos_anteriores, datos_nuevos
     FROM audit.cambios
     WHERE esquema = 'security' AND tabla = 'users' AND registro_id = $1 AND operacion = $2 ${extraWhere}
     ORDER BY cambio_id DESC LIMIT 1`,
    [`user_id=${userId}`, operation, ...extraParams]
  )).rows;
  return rows[0] ?? null;
}

function assertNoPasswordMaterial(auditRowValue, label) {
  assert(auditRowValue, `${label}: expected an audit row.`);
  assert(!Object.prototype.hasOwnProperty.call(auditRowValue.datos_anteriores ?? {}, 'password_hash'), `${label}: datos_anteriores exposes password_hash.`);
  assert(!Object.prototype.hasOwnProperty.call(auditRowValue.datos_nuevos ?? {}, 'password_hash'), `${label}: datos_nuevos exposes password_hash.`);
}

async function run() {
  const testUrl = guardedUrl('TEST_DATABASE_URL', { required: true });
  const pool = new Pool({ connectionString: testUrl.toString() });
  await assertLiveTestPool(pool, 'startup');

  let api;
  const sessions = []; // every session created via the shared test-auth helper, for guaranteed cleanup
  let targetA = null; // section 26/27 fixture: created via POST /users by adminSession
  let admY = null; // section 31 Scenario B fixture

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

    const apiBase = `http://127.0.0.1:${port}/api`;
    const adminSession = await createAuthenticatedTestSession(apiBase, `${marker}_ADMIN`, { role: 'ADMIN' });
    sessions.push(adminSession);
    const generalSession = await createAuthenticatedTestSession(apiBase, `${marker}_GENERAL`);
    sessions.push(generalSession);

    // ---- 25: authorization ---------------------------------------------
    assert((await apiRequest('/users')).response.status === 401, 'Unauthenticated GET /users did not return 401.');

    assert((await apiRequest('/users', { cookie: generalSession.cookie })).response.status === 403, 'GENERAL GET /users was not rejected with 403.');
    assert((await apiRequest(`/users/${generalSession.userId}`, { cookie: generalSession.cookie })).response.status === 403, 'GENERAL GET /users/:id was not rejected with 403.');
    assert((await apiRequest('/users', { method: 'POST', cookie: generalSession.cookie, body: { displayName: 'x', email: `${marker}_x@example.test`, role: 'GENERAL', temporaryPassword: 'Whatever-Not-Used-000' } })).response.status === 403, 'GENERAL POST /users was not rejected with 403.');
    assert((await apiRequest(`/users/${generalSession.userId}`, { method: 'PATCH', cookie: generalSession.cookie, body: { displayName: 'x' } })).response.status === 403, 'GENERAL PATCH /users/:id was not rejected with 403.');
    assert((await apiRequest(`/users/${generalSession.userId}/deactivate`, { method: 'POST', cookie: generalSession.cookie })).response.status === 403, 'GENERAL deactivate was not rejected with 403.');
    assert((await apiRequest(`/users/${generalSession.userId}/reactivate`, { method: 'POST', cookie: generalSession.cookie })).response.status === 403, 'GENERAL reactivate was not rejected with 403.');
    assert((await apiRequest(`/users/${generalSession.userId}/reset-password`, { method: 'POST', cookie: generalSession.cookie, body: { newPassword: 'Whatever-Not-Used-111' } })).response.status === 403, 'GENERAL reset-password was not rejected with 403.');

    assert((await apiRequest('/users', { cookie: adminSession.cookie })).response.status === 200, 'ADMIN GET /users did not succeed.');
    assert((await apiRequest(`/users/${adminSession.userId}`, { cookie: adminSession.cookie })).response.status === 200, 'ADMIN GET /users/:id did not succeed.');

    // ---- 26: create user -------------------------------------------------
    const targetAEmail = `${marker}_TARGETA@example.test`;
    const targetATempPassword = 'Synthetic-Phase6-TargetA-Temp-123';
    const created = await apiRequest('/users', {
      method: 'POST',
      cookie: adminSession.cookie,
      body: { displayName: `${marker} Target A`, email: targetAEmail, role: 'GENERAL', temporaryPassword: targetATempPassword }
    });
    assert(created.response.status === 201, `ADMIN create user failed: ${JSON.stringify(created.body)}`);
    assert(created.body.data.status === 'ACTIVE' && created.body.data.mustChangePassword === true, 'Created user did not have the expected ACTIVE/mustChangePassword=true state.');
    assert(!('passwordHash' in created.body.data) && !('password_hash' in created.body.data), 'Create-user response exposed password material.');
    targetA = { userId: created.body.data.id, email: targetAEmail, marker: `${marker}_TARGETA` };

    const targetARow = (await pool.query('SELECT password_hash FROM security.users WHERE user_id = $1', [targetA.userId])).rows[0];
    assert(targetARow.password_hash.startsWith('$argon2id$'), 'Created user password was not stored as an Argon2id hash.');
    assert(!JSON.stringify(created.body).includes(targetATempPassword), 'Create-user response echoed the plaintext temporary password.');

    const createAudit = await auditRow(pool, targetA.userId, 'INSERT');
    assertNoPasswordMaterial(createAudit, 'create-user audit');
    assert(createAudit.usuario_id === adminSession.userId && createAudit.usuario_email === adminSession.email, 'Create-user audit actor identity does not match the acting ADMIN.');
    assert(!JSON.stringify(createAudit).includes(targetATempPassword), 'Create-user audit row contains the plaintext password.');

    const targetALogin = await login(targetAEmail, targetATempPassword);
    assert(targetALogin.response.status === 200 && targetALogin.cookie, 'Newly created user could not log in with the temporary password.');
    assert(targetALogin.body.data.user.mustChangePassword === true, 'Newly created user session did not report mustChangePassword=true.');
    const blockedA = await apiRequest('/providers', { cookie: targetALogin.cookie });
    assert(blockedA.response.status === 403 && blockedA.body.code === 'PASSWORD_CHANGE_REQUIRED', 'Mandatory password-change policy was not enforced for the newly created user.');

    const targetARealPassword = 'Synthetic-Phase6-TargetA-Real-456';
    const changedA = await apiRequest('/auth/change-password', {
      method: 'POST', cookie: targetALogin.cookie,
      body: { currentPassword: targetATempPassword, newPassword: targetARealPassword }
    });
    assert(changedA.response.status === 200 && changedA.body.data.user.mustChangePassword === false, 'Target A could not complete the mandatory password change.');
    let targetACookie = targetALogin.cookie; // self-service change-password never revokes the existing session (Phase 4/5)

    // ---- 27: update / session behavior -----------------------------------
    const dnPatch = await apiRequest(`/users/${targetA.userId}`, { method: 'PATCH', cookie: adminSession.cookie, body: { displayName: `${marker} Target A Renamed` } });
    assert(dnPatch.response.status === 200 && dnPatch.body.data.displayName === `${marker} Target A Renamed`, `displayName-only PATCH failed: ${JSON.stringify(dnPatch.body)}`);
    assert((await apiRequest('/auth/me', { cookie: targetACookie })).response.status === 200, 'A displayName-only change unexpectedly revoked the target session.');
    const dnAudit = await auditRow(pool, targetA.userId, 'UPDATE', "AND datos_nuevos ->> 'display_name' = $3", [`${marker} Target A Renamed`]);
    assert(dnAudit && dnAudit.usuario_id === adminSession.userId, 'displayName-change audit actor identity does not match the acting ADMIN.');

    const targetANewEmail = `${marker}_TARGETA_NEW@example.test`;
    const emailPatch = await apiRequest(`/users/${targetA.userId}`, { method: 'PATCH', cookie: adminSession.cookie, body: { email: targetANewEmail } });
    assert(emailPatch.response.status === 200 && emailPatch.body.data.email === targetANewEmail, `email PATCH failed: ${JSON.stringify(emailPatch.body)}`);
    targetA.email = targetANewEmail; // keep the cleanup-time email in sync with the database, which now holds the new address
    assert((await apiRequest('/auth/me', { cookie: targetACookie })).response.status === 401, 'An email change did not revoke the target session.');
    assert((await login(targetAEmail, targetARealPassword)).response.status === 401, 'The old email still authenticates after an email change.');
    const relogin1 = await login(targetANewEmail, targetARealPassword);
    assert(relogin1.response.status === 200 && relogin1.cookie, 'The new email cannot authenticate after an email change.');
    targetACookie = relogin1.cookie;
    const emailAudit = await auditRow(pool, targetA.userId, 'UPDATE', "AND datos_nuevos ->> 'email' = $3", [targetANewEmail]);
    assert(emailAudit && emailAudit.usuario_id === adminSession.userId, 'email-change audit actor identity does not match the acting ADMIN.');

    const rolePatch = await apiRequest(`/users/${targetA.userId}`, { method: 'PATCH', cookie: adminSession.cookie, body: { role: 'ADMIN' } });
    assert(rolePatch.response.status === 200 && rolePatch.body.data.role === 'ADMIN', `role PATCH failed: ${JSON.stringify(rolePatch.body)}`);
    assert((await apiRequest('/auth/me', { cookie: targetACookie })).response.status === 401, 'A role change did not revoke the target session.');
    const relogin2 = await login(targetANewEmail, targetARealPassword);
    assert(relogin2.response.status === 200 && relogin2.body.data.user.role === 'ADMIN', 'A fresh login after a role change does not reflect the new role.');
    const roleAudit = await auditRow(pool, targetA.userId, 'UPDATE', "AND datos_nuevos ->> 'role' = 'ADMIN'");
    assert(roleAudit && roleAudit.usuario_id === adminSession.userId, 'role-change audit actor identity does not match the acting ADMIN.');

    // ---- 28: deactivate / reactivate --------------------------------------
    const targetB = await createAuthenticatedTestSession(apiBase, `${marker}_TARGETB`);
    sessions.push(targetB);
    assert((await apiRequest('/providers', { cookie: targetB.cookie })).response.status === 200, 'Sanity check failed: Target B session did not work before deactivation.');

    const deactivate = await apiRequest(`/users/${targetB.userId}/deactivate`, { method: 'POST', cookie: adminSession.cookie });
    assert(deactivate.response.status === 200 && deactivate.body.data.status === 'INACTIVE', `Deactivate failed: ${JSON.stringify(deactivate.body)}`);
    assert((await apiRequest('/providers', { cookie: targetB.cookie })).response.status === 401, 'Deactivation did not revoke the target session.');
    assert((await login(targetB.email, ORDINARY_PASSWORD)).response.status === 401, 'A deactivated user could still log in.');
    const deactivateAudit = await auditRow(pool, targetB.userId, 'UPDATE', "AND datos_nuevos ->> 'status' = 'INACTIVE'");
    assert(deactivateAudit && deactivateAudit.usuario_id === adminSession.userId, 'Deactivate audit actor identity does not match the acting ADMIN.');

    const reactivate = await apiRequest(`/users/${targetB.userId}/reactivate`, { method: 'POST', cookie: adminSession.cookie });
    assert(reactivate.response.status === 200 && reactivate.body.data.status === 'ACTIVE', `Reactivate failed: ${JSON.stringify(reactivate.body)}`);
    assert((await apiRequest('/providers', { cookie: targetB.cookie })).response.status === 401, 'Reactivation unexpectedly restored the old (revoked) session.');
    const reloginB = await login(targetB.email, ORDINARY_PASSWORD);
    assert(reloginB.response.status === 200 && reloginB.cookie, 'A reactivated user with a still-valid password could not log in.');
    const reactivateAudit = await auditRow(pool, targetB.userId, 'UPDATE', "AND datos_nuevos ->> 'status' = 'ACTIVE'");
    assert(reactivateAudit && reactivateAudit.usuario_id === adminSession.userId, 'Reactivate audit actor identity does not match the acting ADMIN.');

    // ---- 29: password reset -----------------------------------------------
    const resetNewPassword = 'Synthetic-Phase6-TargetB-Reset-789';
    const reset = await apiRequest(`/users/${targetB.userId}/reset-password`, { method: 'POST', cookie: adminSession.cookie, body: { newPassword: resetNewPassword } });
    assert(reset.response.status === 200 && reset.body.data.mustChangePassword === true, `Reset-password failed: ${JSON.stringify(reset.body)}`);
    assert((await apiRequest('/auth/me', { cookie: reloginB.cookie })).response.status === 401, 'Password reset did not revoke the existing session.');
    assert((await login(targetB.email, ORDINARY_PASSWORD)).response.status === 401, 'The old password still works after an administrative reset.');
    const afterReset = await login(targetB.email, resetNewPassword);
    assert(afterReset.response.status === 200 && afterReset.body.data.user.mustChangePassword === true, 'The temporary reset password did not work or mustChangePassword was not set.');

    const resetAudit = await auditRow(pool, targetB.userId, 'UPDATE', "AND datos_nuevos ->> 'password_changed' = 'true'");
    assertNoPasswordMaterial(resetAudit, 'reset-password audit');
    assert(resetAudit.datos_nuevos.password_changed === true, 'Reset-password audit lacks password_changed=true.');
    assert(resetAudit.usuario_id === adminSession.userId && resetAudit.usuario_email === adminSession.email, 'Reset-password audit actor identity does not match the acting ADMIN.');
    const resetAuditJson = JSON.stringify(resetAudit);
    assert(!resetAuditJson.includes(resetNewPassword) && !resetAuditJson.includes(ORDINARY_PASSWORD), 'Reset-password audit contains plaintext password material.');

    // ---- 30 & 31 Scenario A: self-administration / last-active-admin ----
    // These two protections are deliberately layered: SELF_* rejects any
    // self-targeting admin-lifecycle call unconditionally (section 14), while
    // the repository's LAST_ACTIVE_ADMIN lock (unit-tested directly in
    // users.repository.spec.ts) guards role/deactivate mutations targeting ANY
    // admin. Because RolesGuard requires the acting user to be an ACTIVE ADMIN,
    // the only way an admin-lifecycle call can ever target "the last remaining
    // active admin" is for that admin to target themselves — which is exactly
    // the case SELF_* already intercepts first. So in practice, self-targeting
    // is how "cannot end with zero ACTIVE admins" manifests at the HTTP layer;
    // this block verifies that outcome (rejected, DB state unchanged) end to
    // end, and Scenario B below verifies the >=2-admin case where a distinct
    // actor legitimately reduces the admin count by one, using this very API.
    const selfDeactivate = await apiRequest(`/users/${adminSession.userId}/deactivate`, { method: 'POST', cookie: adminSession.cookie });
    assert(selfDeactivate.response.status === 409 && selfDeactivate.body.code === 'SELF_DEACTIVATION_NOT_ALLOWED', `Self-deactivation was not rejected as expected: ${JSON.stringify(selfDeactivate.body)}`);

    const selfReset = await apiRequest(`/users/${adminSession.userId}/reset-password`, { method: 'POST', cookie: adminSession.cookie, body: { newPassword: 'Synthetic-Phase6-Self-Reset-000' } });
    assert(selfReset.response.status === 409 && selfReset.body.code === 'SELF_PASSWORD_RESET_NOT_ALLOWED', `Self admin-reset was not rejected as expected: ${JSON.stringify(selfReset.body)}`);

    const selfRole = await apiRequest(`/users/${adminSession.userId}`, { method: 'PATCH', cookie: adminSession.cookie, body: { role: 'GENERAL' } });
    assert(selfRole.response.status === 409 && selfRole.body.code === 'SELF_ROLE_CHANGE_NOT_ALLOWED', `Self role-change was not rejected as expected: ${JSON.stringify(selfRole.body)}`);

    assert((await apiRequest('/providers', { cookie: adminSession.cookie })).response.status === 200, 'Rejected self-administration attempts unexpectedly broke the acting admin session.');
    const adminRowAfterSelfChecks = (await pool.query('SELECT role, status, password_hash FROM security.users WHERE user_id = $1', [adminSession.userId])).rows[0];
    assert(adminRowAfterSelfChecks.role === 'ADMIN' && adminRowAfterSelfChecks.status === 'ACTIVE', 'Rejected self-administration attempts changed the acting admin\'s role/status in the database.');

    // ---- 31 Scenario B: >=2 ACTIVE ADMINs -> one may be demoted ----------
    admY = await createAuthenticatedTestSession(apiBase, `${marker}_ADMY`, { role: 'ADMIN' });
    sessions.push(admY);
    const demote = await apiRequest(`/users/${admY.userId}`, { method: 'PATCH', cookie: adminSession.cookie, body: { role: 'GENERAL' } });
    assert(demote.response.status === 200 && demote.body.data.role === 'GENERAL', `Demoting an admin while another ACTIVE admin exists was unexpectedly rejected: ${JSON.stringify(demote.body)}`);
    const remainingActiveAdmins = (await pool.query("SELECT count(*)::int AS n FROM security.users WHERE role = 'ADMIN' AND status = 'ACTIVE'")).rows[0].n;
    assert(remainingActiveAdmins >= 1, 'Zero ACTIVE admins remained after a safe demotion — last-active-admin invariant violated.');
    const adminRowAfterDemote = (await pool.query('SELECT role, status FROM security.users WHERE user_id = $1', [adminSession.userId])).rows[0];
    assert(adminRowAfterDemote.role === 'ADMIN' && adminRowAfterDemote.status === 'ACTIVE', 'The acting admin lost its own ADMIN/ACTIVE state after demoting a different admin.');

    // ---- 32: Document Series authorization (approved operational access) --
    await transactionalInsert(pool, 'INSERT INTO ops.automatizaciones (codigo, nombre, descripcion, estatus) VALUES ($1, $2, $3, $4)', [automationCode, 'Phase 6 temporary automation', 'Integration test only', 'ACTIVA']);
    const seriesInsert = await transactionalInsert(pool, 'INSERT INTO operacion.series_documentales (codigo, nombre, siguiente_folio, estatus) VALUES ($1, $2, $3, $4) RETURNING serie_id::text', [seriesCode, 'Phase 6 temporary series', 700, 'ACTIVA']);
    const seriesId = seriesInsert.rows[0].serie_id;

    const seriesPath = `/automations/${automationCode}/document-series/${seriesCode}`;
    assert((await apiRequest(seriesPath)).response.status === 401, 'Unauthenticated GET Document Series did not return 401.');
    assert((await apiRequest(seriesPath, { method: 'PATCH', body: { nextFolio: 701, reason: 'x' } })).response.status === 401, 'Unauthenticated PATCH Document Series did not return 401.');

    const generalGet = await apiRequest(seriesPath, { cookie: generalSession.cookie });
    assert(generalGet.response.status === 200, `GENERAL GET Document Series failed: ${JSON.stringify(generalGet.body)}`);
    const generalPatch = await apiRequest(seriesPath, { method: 'PATCH', cookie: generalSession.cookie, body: { nextFolio: 701, reason: `${marker}_GENERAL_ADJUST` } });
    assert(generalPatch.response.status === 200 && generalPatch.body.data.series.nextFolio === 701, `GENERAL PATCH Document Series failed: ${JSON.stringify(generalPatch.body)}`);

    const adminGet = await apiRequest(seriesPath, { cookie: adminSession.cookie });
    assert(adminGet.response.status === 200, `ADMIN GET Document Series failed: ${JSON.stringify(adminGet.body)}`);
    const adminPatch = await apiRequest(seriesPath, { method: 'PATCH', cookie: adminSession.cookie, body: { nextFolio: 702, reason: `${marker}_ADMIN_ADJUST` } });
    assert(adminPatch.response.status === 200 && adminPatch.body.data.series.nextFolio === 702, `ADMIN PATCH Document Series failed: ${JSON.stringify(adminPatch.body)}`);

    const seriesAuditIdentity = (await pool.query(
      'SELECT usuario_id, usuario_email FROM operacion.ajustes_series WHERE serie_id = $1 AND motivo = $2',
      [seriesId, `${marker}_ADMIN_ADJUST`]
    )).rows[0];
    assert(seriesAuditIdentity && seriesAuditIdentity.usuario_id === adminSession.userId && seriesAuditIdentity.usuario_email === adminSession.email, 'Authenticated Document Series adjustment did not record the acting user identity.');

    await pool.query('DELETE FROM operacion.ajustes_series WHERE serie_id = $1', [seriesId]);
    await pool.query('DELETE FROM operacion.series_documentales WHERE codigo = $1', [seriesCode]);
    await pool.query('DELETE FROM ops.automatizaciones WHERE codigo = $1', [automationCode]);

    console.log('Security Phase 6 integration checks passed.');
  } finally {
    if (api && api.exitCode === null && api.signalCode === null) {
      api.kill();
      await once(api, 'exit');
    }
    await assertLiveTestPool(pool, 'pre-cleanup');
    // Best-effort fixture cleanup for the automation/series in case an assertion failed mid-run.
    try {
      await pool.query('DELETE FROM operacion.ajustes_series WHERE serie_id IN (SELECT serie_id FROM operacion.series_documentales WHERE codigo = $1)', [seriesCode]);
      await pool.query('DELETE FROM operacion.series_documentales WHERE codigo = $1', [seriesCode]);
      await pool.query('DELETE FROM ops.automatizaciones WHERE codigo = $1', [automationCode]);
    } catch {
      // Best-effort only; a failed earlier assertion may mean these were already removed.
    }
    if (targetA) await cleanupAuthenticatedTestSession(targetA);
    for (const session of sessions) await cleanupAuthenticatedTestSession(session);
    await pool.end();
  }
}

async function transactionalInsert(pool, text, values) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB_TEST']);
    await client.query("SELECT set_config('app.request_id', $1, true)", [`security-phase6-setup-${randomUUID()}`]);
    const result = await client.query(text, values);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Preserve the original error. */ }
    throw error;
  } finally {
    client.release();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
