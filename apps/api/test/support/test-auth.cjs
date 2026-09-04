// Shared TEST-only authentication helper for integration runners.
//
// Global authentication (Security V1 Phase 4) means every business route
// now requires a real session. Runners must exercise the actual
// authentication boundary — no AUTH_DISABLED flag, no bypass header, no
// magic test user recognized by production code. This helper:
//   1. creates a marker-prefixed synthetic security user directly through
//      the real Users domain (real Argon2id hashing, via PasswordService),
//   2. logs in for real against the running API (POST /api/auth/login),
//   3. hands back the `cookie` header value to attach to further requests,
//   4. cleans up afterward using the same guarded pattern established in
//      Phases 1-3 (an optional elevated TEST_DATABASE_ADMIN_URL, or
//      marker-scoped manual cleanup instructions — never a DELETE grant
//      added "for test convenience").
require('reflect-metadata');
const { randomUUID } = require('node:crypto');

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

async function assertLiveTestDatabase(database) {
  const [row] = await database.query('SELECT current_database() AS name');
  if (!row || row.name !== 'daubert_hub_test') {
    throw new Error(`Live database mismatch for test auth: got "${row && row.name}".`);
  }
}

// Creates a synthetic GENERAL, must_change_password=false user and logs in
// for real. `apiBaseUrl` is e.g. `http://127.0.0.1:3101/api`.
async function createAuthenticatedTestSession(apiBaseUrl, markerPrefix) {
  const testUrl = guardedUrl('TEST_DATABASE_URL', { required: true });

  const { DatabaseService } = require('../../dist/src/database/database.service');
  const { PasswordService } = require('../../dist/src/security/password.service');
  const { UsersRepository } = require('../../dist/src/security/users.repository');
  const { UsersService } = require('../../dist/src/security/users.service');

  const database = buildDatabaseService(DatabaseService, testUrl);
  await assertLiveTestDatabase(database);

  const repository = new UsersRepository(database);
  const passwords = new PasswordService();
  const users = new UsersService(repository, passwords);

  const marker = `${markerPrefix}_${randomUUID().replace(/-/g, '')}`;
  const email = `${marker}@example.test`;
  const password = 'Synthetic-Integration-Password-123';
  const setupContext = { requestId: `test-auth-setup-${randomUUID()}`, origin: 'DAUBERT_HUB_TEST', actorUserId: null, actorUserEmail: null };
  let cleanupIdentity = null;
  try {
    const created = await users.createUser({ displayName: `${marker} display`, email, password, role: 'GENERAL' }, setupContext);
    cleanupIdentity = { userId: created.id, email, marker };
    // Ordinary business integration runners need must_change_password=false —
    // an ADMIN-provisioned account defaults to true (Phase 2), so flip it via
    // the same real domain path (real Argon2id re-hash), not a raw SQL patch.
    await users.updatePassword(created.id, password, false, setupContext);

    const loginResponse = await fetch(`${apiBaseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const loginBody = await loginResponse.json().catch(() => null);
    if (loginResponse.status !== 200) {
      throw new Error(`Test auth setup could not log in: ${loginResponse.status} ${JSON.stringify(loginBody)}`);
    }
    const setCookies = typeof loginResponse.headers.getSetCookie === 'function' ? loginResponse.headers.getSetCookie() : [];
    const sessionCookie = setCookies.find((value) => value.startsWith('daubert_session='));
    if (!sessionCookie) throw new Error('Test auth setup did not receive a daubert_session cookie.');
    const cookie = sessionCookie.split(';')[0];

    return { ...cleanupIdentity, cookie };
  } catch (error) {
    await cleanupAuthenticatedTestSession(cleanupIdentity);
    throw error;
  } finally {
    await database.onModuleDestroy();
  }
}

// security.users/security.sessions intentionally have no DELETE grant for
// the application role (least privilege, Phase 1). This never grants one
// "for test convenience" — it uses an optional elevated
// TEST_DATABASE_ADMIN_URL when available, or hands off exact, marker-scoped
// cleanup SQL for a human with an administrative connection, exactly like
// every prior Security V1 integration runner.
async function cleanupAuthenticatedTestSession(session) {
  if (!session || !session.userId) return;
  const adminUrl = guardedUrl('TEST_DATABASE_ADMIN_URL');
  const userId = session.userId;

  if (!adminUrl) {
    console.warn('MANUAL CLEANUP REQUIRED: the application role has no DELETE on security.users/security.sessions by design.');
    console.warn('Run the following against daubert_hub_test with an administrative connection:');
    console.warn(`  DELETE FROM security.sessions WHERE user_id IN (SELECT user_id FROM security.users WHERE user_id = ${userId} AND email = '${session.email}');`);
    console.warn(`  DELETE FROM audit.cambios WHERE esquema='security' AND tabla='users' AND registro_id='user_id=${userId}';`);
    console.warn(`  DELETE FROM security.users WHERE user_id = ${userId} AND email = '${session.email}';`);
    return;
  }

  const { Pool } = require('pg');
  const adminPool = new Pool({ connectionString: adminUrl.toString() });
  try {
    const live = await adminPool.query('SELECT current_database() AS name');
    if (live.rows[0].name !== 'daubert_hub_test') {
      throw new Error(`Admin cleanup connection is not daubert_hub_test (got "${live.rows[0].name}").`);
    }
    await adminPool.query('DELETE FROM security.sessions WHERE user_id = $1', [userId]);
    await adminPool.query('DELETE FROM audit.cambios WHERE esquema=$1 AND tabla=$2 AND registro_id=$3', ['security', 'users', `user_id=${userId}`]);
    await adminPool.query('DELETE FROM security.users WHERE user_id = $1', [userId]);
    const leftoverUser = await adminPool.query('SELECT count(*)::int AS n FROM security.users WHERE user_id = $1', [userId]);
    const leftoverSessions = await adminPool.query('SELECT count(*)::int AS n FROM security.sessions WHERE user_id = $1', [userId]);
    if (leftoverUser.rows[0].n !== 0 || leftoverSessions.rows[0].n !== 0) {
      throw new Error('Automated admin cleanup left test-auth fixtures behind.');
    }
  } finally {
    await adminPool.end();
  }
}

module.exports = { guardedUrl, buildDatabaseService, createAuthenticatedTestSession, cleanupAuthenticatedTestSession };
