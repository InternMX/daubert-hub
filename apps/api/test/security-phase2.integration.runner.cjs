require('reflect-metadata');
const { randomUUID } = require('node:crypto');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Same guarded pattern as every other integration runner: decode the
// configured URL's database name AND verify a live SELECT current_database()
// before any write. Used for both TEST_DATABASE_URL (required) and the
// optional TEST_DATABASE_ADMIN_URL (cleanup only, see cleanup() below).
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

// security.users intentionally has no DELETE grant for the application role
// (least privilege, established in Security V1 Phase 1). This runner never
// grants DELETE "for test convenience". If an operator supplies a guarded
// TEST_DATABASE_ADMIN_URL, cleanup runs automatically through it; otherwise
// this hands off the exact, marker-scoped statements for a human with an
// administrative connection to run — the same safe pattern already used for
// Phase 1/1.1 fixture cleanup.
async function cleanup(createdId) {
  if (!createdId) return;
  const adminUrl = guardedUrl('TEST_DATABASE_ADMIN_URL');
  const deleteAuditSql = "DELETE FROM audit.cambios WHERE esquema='security' AND tabla='users' AND registro_id=$1";
  const deleteUserSql = 'DELETE FROM security.users WHERE user_id = $1';

  if (!adminUrl) {
    console.warn('MANUAL CLEANUP REQUIRED: the application role has no DELETE on security.users by design.');
    console.warn('Run the following against daubert_hub_test with an administrative connection:');
    console.warn(`  DELETE FROM audit.cambios WHERE esquema='security' AND tabla='users' AND registro_id='user_id=${createdId}';`);
    console.warn(`  DELETE FROM security.users WHERE user_id = ${createdId};`);
    return;
  }

  const { Pool } = require('pg');
  const adminPool = new Pool({ connectionString: adminUrl.toString() });
  try {
    const live = await adminPool.query('SELECT current_database() AS name');
    assert(live.rows[0].name === 'daubert_hub_test', `Admin cleanup connection is not daubert_hub_test (got "${live.rows[0].name}").`);
    await adminPool.query(deleteAuditSql, [`user_id=${createdId}`]);
    await adminPool.query(deleteUserSql, [createdId]);
    const leftoverUser = await adminPool.query('SELECT count(*)::int AS n FROM security.users WHERE user_id = $1', [createdId]);
    const leftoverAudit = await adminPool.query("SELECT count(*)::int AS n FROM audit.cambios WHERE esquema='security' AND tabla='users' AND registro_id=$1", [`user_id=${createdId}`]);
    assert(leftoverUser.rows[0].n === 0, 'Automated admin cleanup left the synthetic user behind.');
    assert(leftoverAudit.rows[0].n === 0, 'Automated admin cleanup left synthetic audit rows behind.');
    console.log('Security Phase 2 cleanup verified (automated via TEST_DATABASE_ADMIN_URL).');
  } finally {
    await adminPool.end();
  }
}

async function run() {
  const testUrl = guardedUrl('TEST_DATABASE_URL', { required: true });

  const { DatabaseService } = require('../dist/src/database/database.service');
  const { PasswordService } = require('../dist/src/security/password.service');
  const { UsersRepository } = require('../dist/src/security/users.repository');
  const { UsersService, UserEmailConflictError } = require('../dist/src/security/users.service');

  const database = buildDatabaseService(DatabaseService, testUrl);
  await assertLiveDatabase(database, 'startup');

  const repository = new UsersRepository(database);
  const passwords = new PasswordService();
  const users = new UsersService(repository, passwords);

  const marker = `hub_test_security_phase2_${randomUUID().replace(/-/g, '')}`;
  const email = `${marker}@example.test`;
  const originalPassword = 'Synthetic-Original-Password-123';
  const newPassword = 'Synthetic-Rotated-Password-456';
  const baseContext = { requestId: `security-phase2-create-${randomUUID()}`, origin: 'DAUBERT_HUB_TEST', actorUserId: null, actorUserEmail: null };

  let createdId;
  try {
    // --- create synthetic user through the Users domain ---
    const created = await users.createUser({ displayName: `${marker} display`, email, password: originalPassword, role: 'GENERAL' }, baseContext);
    assert(!Object.prototype.hasOwnProperty.call(created, 'passwordHash'), 'Safe user representation leaked a passwordHash key.');
    createdId = created.id;
    assert(typeof createdId === 'string' && /^[0-9]+$/.test(createdId), 'Returned user id is not a plain numeric string.');
    assert(created.role === 'GENERAL' && created.status === 'ACTIVE' && created.mustChangePassword === true, 'New user did not get the expected ACTIVE/mustChangePassword defaults.');

    const [dbRow] = await database.query('SELECT user_id::text AS id, password_hash FROM security.users WHERE user_id = $1', [createdId]);
    assert(dbRow, 'Created user row not found in security.users.');
    assert(dbRow.id === createdId, 'BIGINT-safe id mismatch between service result and a raw DB read.');
    assert(dbRow.password_hash !== originalPassword, 'Plaintext password was stored verbatim in security.users.');
    assert(dbRow.password_hash.startsWith('$argon2id$'), `Stored hash is not Argon2id (got prefix: ${dbRow.password_hash.slice(0, 12)}).`);
    assert(!dbRow.password_hash.includes(originalPassword), 'Plaintext leaked inside the stored hash value.');

    const insertAudit = await database.query(
      "SELECT datos_nuevos FROM audit.cambios WHERE esquema='security' AND tabla='users' AND registro_id=$1 AND operacion='INSERT' ORDER BY cambio_id DESC LIMIT 1",
      [`user_id=${createdId}`]
    );
    assert(insertAudit.length === 1, 'Expected exactly one INSERT audit row for the synthetic user.');
    const insertJson = JSON.stringify(insertAudit[0].datos_nuevos);
    assert(!Object.prototype.hasOwnProperty.call(insertAudit[0].datos_nuevos, 'password_hash'), 'audit.cambios INSERT row exposes a password_hash key.');
    assert(!insertJson.includes(originalPassword), 'audit.cambios INSERT row leaks the plaintext password.');
    assert(!insertJson.includes(dbRow.password_hash), 'audit.cambios INSERT row leaks the stored hash value.');

    assert((await passwords.verifyPassword(dbRow.password_hash, originalPassword)) === true, 'Password verify failed for the correct original password.');
    assert((await passwords.verifyPassword(dbRow.password_hash, 'totally-wrong-password-value')) === false, 'Password verify unexpectedly succeeded for a wrong password.');

    const foundByVariantEmail = await users.findForAuthentication(`  ${email.toUpperCase()}  `);
    assert(foundByVariantEmail && foundByVariantEmail.id === createdId, 'Case-insensitive / whitespace-tolerant email lookup failed to find the user.');

    // --- password update ---
    const updateContext = { ...baseContext, requestId: `security-phase2-update-${randomUUID()}` };
    const updated = await users.updatePassword(createdId, newPassword, false, updateContext);
    assert(updated && updated.mustChangePassword === false, 'updatePassword did not apply the caller-specified mustChangePassword=false.');

    const [afterRow] = await database.query('SELECT password_hash FROM security.users WHERE user_id = $1', [createdId]);
    assert((await passwords.verifyPassword(afterRow.password_hash, originalPassword)) === false, 'Old password still verifies after the password was rotated.');
    assert((await passwords.verifyPassword(afterRow.password_hash, newPassword)) === true, 'New password does not verify after rotation.');

    const updateAudit = await database.query(
      "SELECT datos_anteriores, datos_nuevos FROM audit.cambios WHERE esquema='security' AND tabla='users' AND registro_id=$1 AND operacion='UPDATE' ORDER BY cambio_id DESC LIMIT 1",
      [`user_id=${createdId}`]
    );
    assert(updateAudit.length === 1, 'Expected exactly one UPDATE audit row for the password rotation.');
    const updateEntry = updateAudit[0];
    assert(updateEntry.datos_nuevos.password_changed === true, 'audit.cambios UPDATE row is missing the password_changed=true marker.');
    assert(
      !Object.prototype.hasOwnProperty.call(updateEntry.datos_nuevos, 'password_hash')
        && !Object.prototype.hasOwnProperty.call(updateEntry.datos_anteriores, 'password_hash'),
      'audit.cambios UPDATE row exposes a password_hash key.'
    );
    const updateJson = JSON.stringify(updateEntry);
    assert(!updateJson.includes(dbRow.password_hash), 'audit.cambios UPDATE row leaks the OLD hash value.');
    assert(!updateJson.includes(afterRow.password_hash), 'audit.cambios UPDATE row leaks the NEW hash value.');
    assert(!updateJson.includes(originalPassword) && !updateJson.includes(newPassword), 'audit.cambios UPDATE row leaks a plaintext password.');

    // --- bootstrap-style duplicate refusal (no ON CONFLICT DO UPDATE anywhere) ---
    let conflictCaught = false;
    try {
      await users.createUser({ displayName: 'Should not be created', email: email.toUpperCase(), password: 'Another-Valid-Password-789', role: 'ADMIN' }, baseContext);
    } catch (error) {
      conflictCaught = error instanceof UserEmailConflictError;
    }
    assert(conflictCaught, 'A duplicate (case-insensitive) email did not refuse with UserEmailConflictError.');

    const [afterConflictRow] = await database.query('SELECT role, password_hash FROM security.users WHERE user_id = $1', [createdId]);
    assert(afterConflictRow.role === 'GENERAL', 'A duplicate creation attempt mutated the existing user role.');
    assert(afterConflictRow.password_hash === afterRow.password_hash, 'A duplicate creation attempt mutated the existing password hash.');

    console.log('Security Phase 2 integration checks passed.');
  } finally {
    await assertLiveDatabase(database, 'pre-cleanup');
    await cleanup(createdId);
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
