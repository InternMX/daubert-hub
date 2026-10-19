const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { createAuthenticatedTestSession, cleanupAuthenticatedTestSession } = require('./support/test-auth.cjs');

// Set once run() logs in the synthetic test session; read by request() below.
let sessionCookie = null;

// Local dev convenience: apps/api/.env carries TEST_DATABASE_URL for the spawned Nest process
// (loaded there via ConfigModule), but this runner never gets it unless the shell exports it
// first. Fall back to reading the same .env file here, without overriding anything the caller
// (CI, a real export) already set. The guard below still only ever trusts TEST_DATABASE_URL.
if (!process.env.TEST_DATABASE_URL) {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator === -1) continue;
      const key = trimmed.slice(0, separator).trim();
      if (key === 'TEST_DATABASE_URL' && process.env[key] === undefined) process.env[key] = trimmed.slice(separator + 1).trim();
    }
  }
}

const port = 3109;
const marker = `HUB_TEST_ALIAS_${randomUUID().replace(/-/g, '').toUpperCase()}`;
const companyIds = new Set();
const paymentFixtureIds = new Set();
const requestIds = new Set();

function assert(condition, message) { if (!condition) throw new Error(message); }

function guardedUrl(value) {
  if (!value) throw new Error('TEST_DATABASE_URL must be set for Aliases integration tests.');
  const url = new URL(value);
  const databaseName = decodeURIComponent(url.pathname).replace(/^\//, '');
  if (databaseName !== 'daubert_hub_test') throw new Error(`Refusing Aliases integration tests against "${databaseName || '(missing)'}". Expected "daubert_hub_test".`);
  return { url, databaseName };
}

async function assertLiveDatabase(pool, phase) {
  const name = (await pool.query('SELECT current_database() AS name')).rows[0].name;
  assert(name === 'daubert_hub_test', `${phase} database mismatch: ${name}`);
}

async function audited(pool, requestId, sql, values = []) {
  requestIds.add(requestId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB_TEST']);
    await client.query("SELECT set_config('app.request_id', $1, true)", [requestId]);
    await client.query("SELECT set_config('app.user_id', COALESCE($1, ''), true)", [null]);
    await client.query("SELECT set_config('app.user_email', COALESCE($1, ''), true)", [null]);
    const result = await client.query(sql, values);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Preserve the fixture error. */ }
    throw error;
  } finally { client.release(); }
}

async function fixtureCompany(pool, suffix, options = {}) {
  const requestId = `alias-fixture-${randomUUID()}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB_TEST']);
    await client.query("SELECT set_config('app.request_id', $1, true)", [requestId]);
    await client.query("SELECT set_config('app.user_id', COALESCE($1, ''), true)", [null]);
    await client.query("SELECT set_config('app.user_email', COALESCE($1, ''), true)", [null]);
    requestIds.add(requestId);
    const name = `${marker}_${suffix}`;
    const insert = await client.query('INSERT INTO core.empresas (tipo_empresa, nombre_comercial, estatus) VALUES ($1, $2, $3) RETURNING empresa_id::text', [options.type || 'CLIENTE', name, options.status || 'ACTIVO']);
    const id = insert.rows[0].empresa_id;
    companyIds.add(id);
    for (const role of options.roles || ['CLIENTE']) {
      await client.query('INSERT INTO core.empresa_roles (empresa_id, rol, estatus) VALUES ($1, $2, $3)', [id, role.name || role, role.status || 'ACTIVO']);
    }
    await client.query('COMMIT');
    return { id, name };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Preserve the fixture error. */ }
    throw error;
  } finally { client.release(); }
}

// x-request-id is always server-generated (Security V1 Phase 4); a client
// can no longer choose the value that lands in audit.cambios.request_id, so
// this captures the returned response header instead of trusting an input.
async function request(path, method = 'GET', body) {
  const headers = { ...(sessionCookie ? { cookie: sessionCookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) };
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const requestId = response.headers.get('x-request-id');
  requestIds.add(requestId);
  return { response, body: await response.json(), requestId };
}

async function getAliases(companyId) { return request(`/companies/${companyId}/aliases`, 'GET', undefined); }
async function patchAliases(companyId, aliases) { return request(`/companies/${companyId}/aliases`, 'PATCH', { aliases }); }
async function getProvider(id) { return request(`/providers/${id}`); }

async function waitForApi() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch { /* API is starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for the Aliases integration API.');
}

async function run() {
  const { url, databaseName } = guardedUrl(process.env.TEST_DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let api;
  let verified = false;
  let startup = '';
  let authSession = null;
  try {
    await assertLiveDatabase(pool, 'Fixture');
    verified = true;

    api = spawn(process.execPath, ['dist/src/main.js'], {
      cwd: process.cwd(),
      env: { ...process.env, DB_HOST: url.hostname, DB_PORT: url.port || '5432', DB_NAME: databaseName, DB_USER: decodeURIComponent(url.username), DB_PASSWORD: decodeURIComponent(url.password), API_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    api.stdout.on('data', (chunk) => { startup += chunk; });
    api.stderr.on('data', (chunk) => { startup += chunk; });
    await waitForApi();
    const unauthenticated = await request('/companies/1/aliases/payment-notifications', 'POST', { alias: marker });
    assert(unauthenticated.response.status === 401, 'Permanent alias mutation must require authentication.');
    assert((await request('/automations/payment-notifications/1')).response.status === 401, 'Enriched notification detail must require authentication.');
    assert((await request('/aliases/1/payment-notifications', 'PATCH', { action: 'DEACTIVATE', expectedCompanyId: '1', expectedUpdatedAt: 'old', confirmed: true })).response.status === 401, 'Alias management must require authentication.');
    authSession = await createAuthenticatedTestSession(`http://127.0.0.1:${port}/api`, marker);
    sessionCookie = authSession.cookie;

    // A CLIENTE-only company has no PROVEEDOR/SERVICIO/FLETE role: the Providers alias endpoint
    // 404s for it today. This is exactly the gap the generic companies/:id/aliases contract fixes.
    const clientOnly = await fixtureCompany(pool, 'CLIENT_ONLY', { type: 'CLIENTE', roles: ['CLIENTE'] });
    const providerLookup = await getProvider(clientOnly.id);
    assert(providerLookup.response.status === 404, 'A CLIENTE-only company unexpectedly has a Providers detail route.');

    const empty = await getAliases(clientOnly.id);
    assert(empty.response.status === 200 && Array.isArray(empty.body.data.aliases) && empty.body.data.aliases.length === 0 && empty.body.data.otherAliases.length === 0, `CLIENTE-only company should read an empty alias set: ${JSON.stringify(empty.body)}`);

    const added = await patchAliases(clientOnly.id, [`${marker}_ALT_NAME`]);
    assert(added.response.status === 200 && added.body.data.aliases.includes(`${marker}_ALT_NAME`), `CLIENTE-only company should be able to add an alias: ${JSON.stringify(added.body)}`);
    const afterAdd = await getAliases(clientOnly.id);
    assert(afterAdd.response.status === 200 && afterAdd.body.data.aliases.length === 1, 'Added alias was not persisted for the CLIENTE-only company.');

    // Prove the endpoint is genuinely company-neutral, not merely "also works for Providers"
    // by accident: a PROVEEDOR company must see the exact same data through both contracts.
    const providerCompany = await fixtureCompany(pool, 'PROVIDER', { type: 'PROVEEDOR', roles: ['PROVEEDOR'] });
    const providerAdded = await patchAliases(providerCompany.id, [`${marker}_PROVIDER_ALT`]);
    assert(providerAdded.response.status === 200 && providerAdded.body.data.aliases.includes(`${marker}_PROVIDER_ALT`), `Generic endpoint should work for a Provider company too: ${JSON.stringify(providerAdded.body)}`);
    const providerDetail = await getProvider(providerCompany.id);
    assert(providerDetail.response.status === 200 && providerDetail.body.data.aliases.includes(`${marker}_PROVIDER_ALT`), 'Alias added through the generic endpoint is not visible through the existing Provider detail route.');

    // Cross-company active-alias conflict must be rejected without partial mutation.
    const conflictTarget = await fixtureCompany(pool, 'CONFLICT_TARGET', { type: 'CLIENTE', roles: ['CLIENTE'] });
    const conflict = await patchAliases(conflictTarget.id, [`${marker}_PROVIDER_ALT`]);
    assert(conflict.response.status === 409 && conflict.body.code === 'ALIAS_ALREADY_ASSOCIATED', `Cross-company alias conflict was not rejected: ${JSON.stringify(conflict.body)}`);
    const conflictState = await getAliases(conflictTarget.id);
    assert(conflictState.body.data.aliases.length === 0, 'A rejected alias conflict left a partial mutation.');

    // Permanent assignment reuses the aliases domain, without replacing the existing list.
    // The real GENERAL session exercises the same permissions as the current alias CRUD.
    const permanentPath = `/companies/${providerCompany.id}/aliases/payment-notifications`;
    const blockedOrigin = await fetch(`http://127.0.0.1:${port}/api${permanentPath}`, {
      method: 'POST', headers: { cookie: sessionCookie, origin: 'https://untrusted.example.test', 'content-type': 'application/json' },
      body: JSON.stringify({ alias: `${marker} FORGED`, confirmPermanent: true })
    });
    assert(blockedOrigin.status === 403, 'Permanent assignment must enforce the global CSRF origin protection.');
    const permanent = `${marker} ÁLIAS--PDF`;
    const canonical = `${marker.replace(/[^A-Z0-9]+/g, ' ')} ALIAS PDF`;
    const assigned = await request(permanentPath, 'POST', { alias: permanent, confirmPermanent: true });
    assert(assigned.response.status === 201 && assigned.body.data.normalizedAlias === canonical, `Permanent assignment failed: ${JSON.stringify(assigned.body)}`);
    const stored = (await pool.query('SELECT alias, alias_normalizado, tipo_alias, estatus FROM core.alias_empresa WHERE empresa_id = $1 AND alias = $2', [providerCompany.id, permanent])).rows;
    assert(stored.length === 1 && stored[0].alias_normalizado === canonical && stored[0].tipo_alias === 'NOMBRE_ARCHIVO' && stored[0].estatus === 'ACTIVO', 'Permanent alias was not persisted with the required model.');
    assert((await getAliases(providerCompany.id)).body.data.aliases.includes(`${marker}_PROVIDER_ALT`), 'Assignment replaced another alias.');
    const duplicatePermanent = await request(permanentPath, 'POST', { alias: canonical, confirmPermanent: true });
    assert(duplicatePermanent.response.status === 201 && duplicatePermanent.body.data.alreadyAssigned, 'Equivalent alias on the same company should be idempotent.');
    const canonicalConflict = await request(`/companies/${conflictTarget.id}/aliases/payment-notifications`, 'POST', { alias: canonical, confirmPermanent: true });
    assert(canonicalConflict.response.status === 409, 'Canonical cross-company conflict accepted.');
    const nameConflict = await request(permanentPath, 'POST', { alias: conflictTarget.name, confirmPermanent: true });
    assert(nameConflict.response.status === 409, 'Commercial-name collision accepted.');
    const unconfirmed = await request(permanentPath, 'POST', { alias: '1800006184145' });
    assert(unconfirmed.response.status === 400 && unconfirmed.body.code === 'PERMANENT_ALIAS_CONFIRMATION_REQUIRED', 'Numeric identifier did not require confirmation.');
    const confirmed = await request(permanentPath, 'POST', { alias: `${marker} DOCUMENTO 1800006184145`, confirmPermanent: true });
    assert(confirmed.response.status === 201, 'Explicitly confirmed permanent identifier failed.');
    const raceAlias = `${marker} RACE`;
    const racing = await Promise.all([
      request(permanentPath, 'POST', { alias: raceAlias, confirmPermanent: true }),
      request(`/companies/${conflictTarget.id}/aliases/payment-notifications`, 'POST', { alias: raceAlias.replace(/ /g, '-'), confirmPermanent: true })
    ]);
    assert(racing.map((item) => item.response.status).sort().join(',') === '201,409', 'Concurrent canonical assignments must have exactly one winner.');

    // Catalog visibility must follow existing configuration, never enable it as a side effect.
    assert((await pool.query('SELECT 1 FROM core.empresas_notificacion_pago WHERE empresa_id = $1', [providerCompany.id])).rows.length === 0, 'Saving an alias changed payment configuration.');
    await audited(pool, `alias-catalog-${randomUUID()}`, `INSERT INTO core.empresas_notificacion_pago (empresa_id, procesa_comprobantes_pago, notificaciones_activas) VALUES ($1, TRUE, FALSE)`, [providerCompany.id]);
    const catalogAliases = (await pool.query('SELECT alias_pdf FROM core.vw_catalogo_notificacion_pago_n8n WHERE empresa_id = $1', [providerCompany.id])).rows;
    assert(catalogAliases.some((row) => row.alias_pdf === permanent), 'The permanent alias is missing from the existing n8n catalog after enabling receipt processing.');

    // Current assignment is read independently of historical file errors and survives a reload.
    const detailFixtures = new Map();
    const resolve = async (aliases = [canonical]) => {
      const key = JSON.stringify(aliases);
      if (!detailFixtures.has(key)) {
        const error = aliases.map((alias, index) => `test-${index}.pdf: ALIAS_NO_CATALOGADO - ${alias} | HASH=${String(index + 1).padStart(64, 'a')}`).join(' | ');
        const inserted = await audited(pool, `alias-detail-fixture-${randomUUID()}`, `INSERT INTO core.correos_notificacion_pago (outlook_message_id, estado, detalle_error) VALUES ($1, 'ERROR', $2) RETURNING correo_id::text AS id`, [`${marker}_${randomUUID()}`, error]);
        const id = inserted.rows[0].id;
        paymentFixtureIds.add(id); detailFixtures.set(key, id);
      }
      const result = await request(`/automations/payment-notifications/${detailFixtures.get(key)}`);
      assert(result.response.status === 200, `Notification detail lookup failed: ${JSON.stringify(result.body)}`);
      assert(result.body.data.processingStatus === 'ERROR' && result.body.data.fileErrors === aliases.length, 'Alias management changed the historical payment state/counts.');
      assert(result.body.data.fileErrorDetails.every((file) => file.errorCode === 'ALIAS_NO_CATALOGADO'), 'Historical error was lost.');
      return { ...result, body: { data: result.body.data.fileErrorDetails.map((file) => file.aliasResolution) } };
    };
    const initialResolution = await resolve();
    assert(initialResolution.response.status === 200 && initialResolution.body.data[0].state === 'ACTIVE', 'Active alias was not resolved in the existing notification detail.');
    const originalAlias = initialResolution.body.data[0].assignment;
    assert(originalAlias.companyId === providerCompany.id && originalAlias.aliasId, 'Resolution did not expose the exact manageable alias record.');
    const managePath = `/aliases/${originalAlias.aliasId}/payment-notifications`;
    const reassignBody = { action: 'REASSIGN', companyId: conflictTarget.id, expectedCompanyId: originalAlias.companyId, expectedUpdatedAt: originalAlias.updatedAt, confirmed: true };
    const csrfManagement = await fetch(`http://127.0.0.1:${port}/api${managePath}`, {
      method: 'PATCH', headers: { cookie: sessionCookie, origin: 'https://untrusted.example.test', 'content-type': 'application/json' }, body: JSON.stringify(reassignBody)
    });
    assert(csrfManagement.status === 403, 'Alias management bypassed CSRF protection.');
    assert((await request(managePath, 'PATCH', { ...reassignBody, confirmed: false })).response.status === 400, 'Unconfirmed reassignment was accepted.');
    assert((await request(managePath, 'PATCH', { ...reassignBody, expectedCompanyId: clientOnly.id })).response.status === 409, 'Stale company snapshot was accepted.');

    // A commercial name on a third synthetic company blocks ambiguous reassignment.
    await audited(pool, `alias-name-conflict-${randomUUID()}`, 'UPDATE core.empresas SET nombre_comercial = $2 WHERE empresa_id = $1', [clientOnly.id, canonical]);
    const managementConflict = await request(managePath, 'PATCH', reassignBody);
    assert(managementConflict.response.status === 409 && managementConflict.body.code === 'ALIAS_ALREADY_ASSOCIATED', 'Reassignment ignored a canonical commercial-name conflict.');
    assert((await resolve()).body.data[0].state === 'CONFLICT', 'Resolution falsely reported a unique assignment for an ambiguous catalog.');
    await audited(pool, `alias-name-restore-${randomUUID()}`, 'UPDATE core.empresas SET nombre_comercial = $2 WHERE empresa_id = $1', [clientOnly.id, clientOnly.name]);

    await audited(pool, `alias-target-catalog-${randomUUID()}`, 'INSERT INTO core.empresas_notificacion_pago (empresa_id, procesa_comprobantes_pago, notificaciones_activas) VALUES ($1, TRUE, FALSE)', [conflictTarget.id]);
    const reassigned = await request(managePath, 'PATCH', reassignBody);
    assert(reassigned.response.status === 200 && reassigned.body.data.companyId === conflictTarget.id && reassigned.body.data.aliasId === originalAlias.aliasId, `Reassignment failed or replaced the row: ${JSON.stringify(reassigned.body)}`);
    const currentResolution = (await resolve()).body.data[0];
    assert(currentResolution.state === 'ACTIVE' && currentResolution.company.id === conflictTarget.id, 'Reassignment was not persisted for a new resolution request.');
    const aliasCatalog = async () => (await pool.query('SELECT empresa_id::text AS company_id FROM core.vw_catalogo_notificacion_pago_n8n WHERE alias_pdf = $1', [permanent])).rows;
    assert((await aliasCatalog()).length === 1 && (await aliasCatalog())[0].company_id === conflictTarget.id, 'n8n catalog did not move the alias to the target company.');
    const staleMutation = await request(managePath, 'PATCH', { ...reassignBody, action: 'DEACTIVATE' });
    assert(staleMutation.response.status === 409 && staleMutation.body.code === 'ALIAS_STATE_CHANGED', 'A stale screen could deactivate a reassigned alias.');

    const deactivated = await request(managePath, 'PATCH', { action: 'DEACTIVATE', expectedCompanyId: conflictTarget.id, expectedUpdatedAt: reassigned.body.data.updatedAt, confirmed: true });
    assert(deactivated.response.status === 200 && deactivated.body.data.status === 'INACTIVO', 'Deactivation failed.');
    assert((await aliasCatalog()).length === 0, 'Inactive alias remains in the active n8n catalog.');
    assert((await resolve()).body.data[0].state === 'INACTIVE', 'Inactive alias history was not resolved after reload.');
    const inactiveRow = (await pool.query('SELECT alias_id::text, empresa_id::text, estatus FROM core.alias_empresa WHERE alias_id = $1', [originalAlias.aliasId])).rows;
    assert(inactiveRow.length === 1 && inactiveRow[0].estatus === 'INACTIVO' && inactiveRow[0].empresa_id === conflictTarget.id, 'Deactivation physically deleted the record or lost the relation.');
    const reassignAudit = (await pool.query(`SELECT datos_anteriores, datos_nuevos, usuario_id, origen, operacion FROM audit.cambios WHERE request_id = $1 AND tabla = 'alias_empresa'`, [reassigned.requestId])).rows;
    assert(reassignAudit.length === 1 && reassignAudit[0].operacion === 'UPDATE' && String(reassignAudit[0].datos_anteriores.empresa_id) === providerCompany.id && String(reassignAudit[0].datos_nuevos.empresa_id) === conflictTarget.id && reassignAudit[0].usuario_id === authSession.userId && reassignAudit[0].origen === 'DAUBERT_HUB', 'Reassignment audit lost the before/after relation or actor.');
    const deactivateAudit = (await pool.query(`SELECT datos_anteriores, datos_nuevos, usuario_id, operacion FROM audit.cambios WHERE request_id = $1 AND tabla = 'alias_empresa'`, [deactivated.requestId])).rows;
    assert(deactivateAudit.length === 1 && deactivateAudit[0].operacion === 'UPDATE' && deactivateAudit[0].datos_anteriores.estatus === 'ACTIVO' && deactivateAudit[0].datos_nuevos.estatus === 'INACTIVO' && deactivateAudit[0].usuario_id === authSession.userId, 'Deactivation audit lost status history or actor.');

    // Reassignment and deactivation of one snapshot cannot both succeed concurrently.
    const raceManageAlias = `${marker} MANAGE CONCURRENCY`;
    assert((await request(permanentPath, 'POST', { alias: raceManageAlias, confirmPermanent: true })).response.status === 201, 'Management race fixture failed.');
    const raceRecord = (await resolve([raceManageAlias])).body.data[0].assignment;
    const common = { expectedCompanyId: raceRecord.companyId, expectedUpdatedAt: raceRecord.updatedAt, confirmed: true };
    const concurrentManagement = await Promise.all([
      request(`/aliases/${raceRecord.aliasId}/payment-notifications`, 'PATCH', { ...common, action: 'REASSIGN', companyId: conflictTarget.id }),
      request(`/aliases/${raceRecord.aliasId}/payment-notifications`, 'PATCH', { ...common, action: 'DEACTIVATE' })
    ]);
    assert(concurrentManagement.map((item) => item.response.status).sort().join(',') === '200,409', 'Concurrent management did not reject the stale writer.');

    // Reproduce the reported mappings exclusively with marker-prefixed TEST companies/aliases.
    // The production names are references, never queried or modified in production.
    for (const [detected, destination] of [['MINERVA ALVAREZ', 'MINERVA'], ['MINTT SOLUTIONS', 'Bind ERP'], ['CTRO DE ABSTECIMEINT', 'CADIS']]) {
      const target = await fixtureCompany(pool, destination, { type: 'PROVEEDOR', roles: ['PROVEEDOR'] });
      const testAlias = `${marker} ${detected}`;
      await audited(pool, `alias-case-config-${randomUUID()}`, 'INSERT INTO core.empresas_notificacion_pago (empresa_id, procesa_comprobantes_pago, notificaciones_activas) VALUES ($1, TRUE, FALSE)', [target.id]);
      assert((await resolve([testAlias])).body.data[0].state === 'UNASSIGNED', 'Fresh synthetic case already assigned.');
      assert((await request(`/companies/${target.id}/aliases/payment-notifications`, 'POST', { alias: testAlias, confirmPermanent: true })).response.status === 201, 'Synthetic case assignment failed.');
      const reopened = (await resolve([testAlias])).body.data[0];
      assert(reopened.state === 'ACTIVE' && reopened.company.id === target.id, 'Reopening a historical-error notification lost its current assignment.');
      assert((await resolve([testAlias])).body.data[0].company.id === target.id, 'Another detail request lost the persisted assignment.');
      const viewRows = (await pool.query('SELECT empresa_id::text AS id FROM core.vw_catalogo_notificacion_pago_n8n WHERE alias_pdf = $1', [testAlias])).rows;
      assert(viewRows.length === 1 && viewRows[0].id === target.id, 'Current detail state disagrees with the active n8n catalog.');
    }

    // Validation: blank entries and case-insensitive duplicates are rejected before any write.
    const blank = await patchAliases(clientOnly.id, ['', 'Valid']);
    assert(blank.response.status === 400, 'A blank alias was accepted.');
    const duplicate = await patchAliases(clientOnly.id, ['Daubert', 'daubert']);
    assert(duplicate.response.status === 400, 'Case-insensitive duplicate aliases were accepted.');
    const unchangedAfterRejections = await getAliases(clientOnly.id);
    assert(unchangedAfterRejections.body.data.aliases.length === 1, 'A rejected validation payload mutated the alias set.');

    // Clearing all aliases (empty array) is a valid, intentional operation.
    const cleared = await patchAliases(clientOnly.id, []);
    assert(cleared.response.status === 200 && cleared.body.data.aliases.length === 0, `Clearing aliases with an empty array failed: ${JSON.stringify(cleared.body)}`);

    // Not-found and malformed-id behavior, matching the rest of the API's contract.
    let missingId = '9007199254740993';
    while ((await pool.query('SELECT 1 FROM core.empresas WHERE empresa_id = $1', [missingId])).rows.length) missingId = (BigInt(missingId) + 1n).toString();
    const missingGet = await getAliases(missingId);
    assert(missingGet.response.status === 404, 'A well-formed but unknown company id did not 404 on GET.');
    const missingPatch = await patchAliases(missingId, ['X']);
    assert(missingPatch.response.status === 404, 'A well-formed but unknown company id did not 404 on PATCH.');
    for (const id of ['0', '01', '-1', '1.5', 'abc', '9223372036854775808']) {
      assert((await getAliases(id)).response.status === 400, `Invalid BIGINT company id ${id} was accepted.`);
    }

    // request-id / error contract.
    assert(afterAdd.response.headers.get('x-request-id') !== null, 'x-request-id was not echoed back.');
    const notFoundContract = await request(`/companies/${missingId}/aliases`, 'GET', undefined);
    const errorBodyKeys = Object.keys(notFoundContract.body).sort();
    assert(errorBodyKeys.every((key) => ['statusCode', 'message', 'code'].includes(key)) && !JSON.stringify(notFoundContract.body).toLowerCase().includes('select '), `Error contract leaked internal details: ${JSON.stringify(notFoundContract.body)}`);

    // Audit context: the shared mutation path must still be captured under one request id.
    const auditColumns = new Set((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'audit' AND table_name = 'cambios'")).rows.map((row) => row.column_name));
    const origin = ['origin', 'origen'].find((column) => auditColumns.has(column));
    const table = ['table_name', 'tabla'].find((column) => auditColumns.has(column));
    assert(origin && table, 'audit.cambios lacks required context columns.');
    const addAudit = await pool.query(`SELECT ${origin} AS origin, ${table} AS table_name${auditColumns.has('usuario_id') ? ', usuario_id' : ''}${auditColumns.has('usuario_email') ? ', usuario_email' : ''} FROM audit.cambios WHERE request_id = $1`, [added.requestId]);
    assert(addAudit.rows.length > 0 && addAudit.rows.every((row) => row.table_name === 'alias_empresa' && row.origin === 'DAUBERT_HUB'), 'Alias mutation was not audited under its request ID.');
    if (auditColumns.has('usuario_id')) assert(addAudit.rows.every((row) => row.usuario_id === authSession.userId), 'Authenticated audit usuario_id was not populated from request.user.');
    if (auditColumns.has('usuario_email')) assert(addAudit.rows.every((row) => row.usuario_email === authSession.email), 'Authenticated audit usuario_email was not populated from request.user.');

    console.log('Aliases integration checks passed.');
  } catch (error) {
    if (api) console.error(startup || 'No Aliases API startup output.');
    throw error;
  } finally {
    if (api) {
      api.kill('SIGTERM');
      await Promise.race([once(api, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    if (verified) {
      await assertLiveDatabase(pool, 'Cleanup');
      const cleanupRequestId = `alias-cleanup-${randomUUID()}`;
      requestIds.add(cleanupRequestId);
      await audited(pool, cleanupRequestId, 'DELETE FROM core.alias_empresa WHERE empresa_id = ANY($1::bigint[])', [[...companyIds]]);
      await assertLiveDatabase(pool, 'Cleanup roles');
      await audited(pool, cleanupRequestId, 'DELETE FROM core.empresa_roles WHERE empresa_id = ANY($1::bigint[])', [[...companyIds]]);
      await assertLiveDatabase(pool, 'Cleanup companies');
      await audited(pool, cleanupRequestId, 'DELETE FROM core.empresas WHERE empresa_id = ANY($1::bigint[])', [[...companyIds]]);
      await assertLiveDatabase(pool, 'Cleanup audit');
      await pool.query('DELETE FROM core.correos_notificacion_pago WHERE correo_id = ANY($1::bigint[])', [[...paymentFixtureIds]]);
      assert((await pool.query('SELECT 1 FROM core.correos_notificacion_pago WHERE correo_id = ANY($1::bigint[])', [[...paymentFixtureIds]])).rows.length === 0, 'Synthetic notification fixtures remain.');
      await pool.query('DELETE FROM audit.cambios WHERE request_id = ANY($1::text[])', [[...requestIds]]);
      const leftovers = await pool.query('SELECT count(*)::int AS count FROM core.empresas WHERE nombre_comercial LIKE $1 OR empresa_id = ANY($2::bigint[])', ['HUB_TEST_ALIAS_%', [...companyIds]]);
      assert(leftovers.rows[0].count === 0, 'Aliases cleanup left company fixtures.');
      const auditLeftovers = await pool.query('SELECT count(*)::int AS count FROM audit.cambios WHERE request_id = ANY($1::text[])', [[...requestIds]]);
      assert(auditLeftovers.rows[0].count === 0, 'Aliases cleanup left audit fixtures.');
      console.log('Aliases cleanup verified: zero company/role/alias/audit fixtures remain.');
    }
    await cleanupAuthenticatedTestSession(authSession);
    await pool.end();
  }
}

run().catch((error) => { console.error(error.message); process.exitCode = 1; });
