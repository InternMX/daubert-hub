const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

// Local dev convenience: apps/api/.env carries TEST_DATABASE_URL for the spawned Nest process
// (loaded there via ConfigModule), but this runner never gets it unless the shell exports it
// first. Fall back to reading the same .env file here, without overriding anything the caller
// (CI, a real export) already set.
if (!process.env.TEST_DATABASE_URL) {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator === -1) continue;
      const key = trimmed.slice(0, separator).trim();
      if (process.env[key] === undefined) process.env[key] = trimmed.slice(separator + 1).trim();
    }
  }
}

const port = 3108;
const marker = `HUB_TEST_CLIENT_${randomUUID().replace(/-/g, '').toUpperCase()}`;
const companyIds = new Set();
const requestIds = new Set();
let rfcSequence = 0;

function assert(condition, message) { if (!condition) throw new Error(message); }

function guardedUrl(value) {
  if (!value) throw new Error('TEST_DATABASE_URL must be set for Clients integration tests.');
  const url = new URL(value);
  const databaseName = decodeURIComponent(url.pathname).replace(/^\//, '');
  if (databaseName !== 'daubert_hub_test') throw new Error(`Refusing Clients integration tests against "${databaseName || '(missing)'}". Expected "daubert_hub_test".`);
  return { url, databaseName };
}

async function assertLiveDatabase(pool, phase) {
  const name = (await pool.query('SELECT current_database() AS name')).rows[0].name;
  assert(name === 'daubert_hub_test', `${phase} database mismatch: ${name}`);
}

function nextRfc(prefix = 'CLI') {
  rfcSequence += 1;
  return `${prefix}${String(Date.now() + rfcSequence).slice(-6)}ABC`;
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
  const requestId = `client-fixture-${randomUUID()}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB_TEST']);
    await client.query("SELECT set_config('app.request_id', $1, true)", [requestId]);
    await client.query("SELECT set_config('app.user_id', COALESCE($1, ''), true)", [null]);
    await client.query("SELECT set_config('app.user_email', COALESCE($1, ''), true)", [null]);
    requestIds.add(requestId);
    const name = `${marker}_${suffix}`;
    const insert = options.id
      ? await client.query('INSERT INTO core.empresas (empresa_id, tipo_empresa, nombre_comercial, estatus) OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4) RETURNING empresa_id::text', [options.id, options.type || 'PROVEEDOR', name, options.status || 'ACTIVO'])
      : await client.query('INSERT INTO core.empresas (tipo_empresa, nombre_comercial, estatus) VALUES ($1, $2, $3) RETURNING empresa_id::text', [options.type || 'PROVEEDOR', name, options.status || 'ACTIVO']);
    const id = insert.rows[0].empresa_id;
    companyIds.add(id);
    for (const role of options.roles || ['PROVEEDOR']) {
      await client.query('INSERT INTO core.empresa_roles (empresa_id, rol, estatus) VALUES ($1, $2, $3)', [id, role.name || role, role.status || 'ACTIVO']);
    }
    if (options.fiscal) await client.query('INSERT INTO core.empresas_fiscales (empresa_id, razon_social, rfc, es_vigente) VALUES ($1, $2, $3, TRUE)', [id, `${name} SA`, options.fiscal]);
    await client.query('COMMIT');
    return { id, name, rfc: options.fiscal || null };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Preserve the fixture error. */ }
    throw error;
  } finally { client.release(); }
}

async function request(path, method = 'GET', body, requestId = `client-api-${randomUUID()}`) {
  requestIds.add(requestId);
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method,
    headers: { 'x-request-id': requestId, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { response, body: await response.json(), requestId };
}

async function create(payload, requestId) { return request('/clients', 'POST', payload, requestId); }
async function patch(id, payload, requestId) { return request(`/clients/${id}`, 'PATCH', payload, requestId); }
async function lifecycle(id, action, requestId) { return request(`/clients/${id}/${action}`, 'POST', undefined, requestId); }

async function waitForApi() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch { /* API is starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for the Clients integration API.');
}

async function run() {
  const { url, databaseName } = guardedUrl(process.env.TEST_DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let api;
  let verified = false;
  let startup = '';
  try {
    await assertLiveDatabase(pool, 'Fixture');
    verified = true;
    const forbiddenTable = await pool.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'core' AND table_name = 'clientes'");
    assert(forbiddenTable.rows[0].count === 0, 'Unexpected core.clientes table exists.');

    api = spawn(process.execPath, ['dist/src/main.js'], {
      cwd: process.cwd(),
      env: { ...process.env, DB_HOST: url.hostname, DB_PORT: url.port || '5432', DB_NAME: databaseName, DB_USER: decodeURIComponent(url.username), DB_PASSWORD: decodeURIComponent(url.password), API_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    api.stdout.on('data', (chunk) => { startup += chunk; });
    api.stderr.on('data', (chunk) => { startup += chunk; });
    await waitForApi();

    for (const id of ['0', '01', '-1', '1.5', 'abc', '9223372036854775808']) {
      assert((await request(`/clients/${id}`)).response.status === 400, `Invalid BIGINT ID ${id} was accepted.`);
    }

    const noFiscalName = `${marker}_CASE_A_NO_FISCAL`;
    const noFiscalRequest = `client-case-a-${randomUUID()}`;
    const noFiscal = await create({ commercialName: noFiscalName, notes: null }, noFiscalRequest);
    assert(noFiscal.response.status === 201 && typeof noFiscal.body.data.id === 'string' && noFiscal.body.data.fiscal === null, `Case A without fiscal failed: ${JSON.stringify(noFiscal.body)}`);
    companyIds.add(noFiscal.body.data.id);

    const fiscalRfc = nextRfc('CFA');
    const withFiscalRequest = `client-case-a-fiscal-${randomUUID()}`;
    const withFiscal = await create({ commercialName: `${marker}_CASE_A_FISCAL`, notes: '  note  ', fiscal: { legalName: '  Client Fiscal SA  ', rfc: fiscalRfc.toLowerCase() } }, withFiscalRequest);
    assert(withFiscal.response.status === 201 && withFiscal.body.data.fiscal.rfc === fiscalRfc && withFiscal.body.data.notes === 'note', `Case A with fiscal failed: ${JSON.stringify(withFiscal.body)}`);
    companyIds.add(withFiscal.body.data.id);

    const caseB = await create({ commercialName: `  ${noFiscalName.toLowerCase()}  ` });
    assert(caseB.response.status === 409 && caseB.body.code === 'CLIENT_ALREADY_ACTIVE', 'Case B did not reject the existing active CLIENTE.');

    const caseCRfc = nextRfc('CFC');
    const caseCCompany = await fixtureCompany(pool, 'CASE_C', { fiscal: caseCRfc, roles: ['PROVEEDOR'] });
    const caseC = await create({ commercialName: caseCCompany.name, fiscal: { legalName: `${caseCCompany.name} SA`, rfc: caseCRfc } });
    assert(caseC.response.status === 201 && caseC.body.data.id === caseCCompany.id, `Case C did not reuse empresa_id: ${JSON.stringify(caseC.body)}`);
    const caseCState = await pool.query("SELECT e.nombre_comercial, count(*) FILTER (WHERE r.rol = 'PROVEEDOR' AND r.estatus = 'ACTIVO')::int AS providers, count(*) FILTER (WHERE r.rol = 'CLIENTE' AND r.estatus = 'ACTIVO')::int AS clients FROM core.empresas e JOIN core.empresa_roles r ON r.empresa_id = e.empresa_id WHERE e.empresa_id = $1 GROUP BY e.empresa_id", [caseCCompany.id]);
    assert(caseCState.rows[0].providers === 1 && caseCState.rows[0].clients === 1, 'Case C did not preserve the original role or add CLIENTE exactly once.');
    assert((await pool.query('SELECT count(*)::int AS count FROM core.empresas WHERE lower(btrim(nombre_comercial)) = lower(btrim($1))', [caseCCompany.name])).rows[0].count === 1, 'Case C duplicated core.empresas.');

    const omitFiscal = await fixtureCompany(pool, 'OMIT_FISCAL', { fiscal: nextRfc('CFO'), roles: ['SERVICIO'] });
    const omitted = await create({ commercialName: omitFiscal.name });
    assert(omitted.response.status === 201 && omitted.body.data.id === omitFiscal.id && omitted.body.data.fiscal.rfc === omitFiscal.rfc, 'Omitted fiscal did not preserve an existing current identity.');

    // B1: reuse must compare RFCs case-insensitively — a company whose current fiscal RFC happens
    // to be stored lower-case must still be recognized as the same identity, not rejected.
    const createLowerRfc = nextRfc('CRL').toLowerCase();
    const createLowerCompany = await fixtureCompany(pool, 'CREATE_LOWER_RFC', { fiscal: createLowerRfc, roles: ['PROVEEDOR'] });
    const createLowerReuse = await create({ commercialName: createLowerCompany.name, fiscal: { legalName: `${createLowerCompany.name} SA`, rfc: createLowerRfc } });
    assert(createLowerReuse.response.status === 201 && createLowerReuse.body.data.id === createLowerCompany.id, `Case-insensitive RFC reuse failed: ${JSON.stringify(createLowerReuse.body)}`);

    // B2: reuse into a company with NO current fiscal identity must attach the supplied one
    // (the RFC lookup already proved no other company owns it) instead of forcing POST-then-PATCH.
    const noFiscalReuseCompany = await fixtureCompany(pool, 'NO_FISCAL_REUSE', { roles: ['SERVICIO'] });
    const attachRfc = nextRfc('ATF');
    const attachFiscalReuse = await create({ commercialName: noFiscalReuseCompany.name, fiscal: { legalName: `${noFiscalReuseCompany.name} SA`, rfc: attachRfc } });
    assert(attachFiscalReuse.response.status === 201 && attachFiscalReuse.body.data.id === noFiscalReuseCompany.id && attachFiscalReuse.body.data.fiscal?.rfc === attachRfc, `Reuse into a fiscal-less company should attach the new identity: ${JSON.stringify(attachFiscalReuse.body)}`);
    const attachFiscalRows = await pool.query('SELECT count(*)::int AS count FROM core.empresas_fiscales WHERE empresa_id = $1', [noFiscalReuseCompany.id]);
    assert(attachFiscalRows.rows[0].count === 1, 'Reuse into a fiscal-less company inserted more than one fiscal row.');

    const caseD = await fixtureCompany(pool, 'CASE_D', { fiscal: nextRfc('CFD'), roles: ['FLETE'] });
    const beforeD = await pool.query('SELECT count(*)::int AS roles FROM core.empresa_roles WHERE empresa_id = $1', [caseD.id]);
    const conflictD = await create({ commercialName: caseD.name, fiscal: { legalName: 'Conflict SA', rfc: nextRfc('DFR') } });
    assert(conflictD.response.status === 409 && conflictD.body.code === 'CLIENT_NAME_RFC_CONFLICT', 'Case D did not reject conflicting name/RFC identity.');
    assert((await pool.query('SELECT count(*)::int AS roles FROM core.empresa_roles WHERE empresa_id = $1', [caseD.id])).rows[0].roles === beforeD.rows[0].roles, 'Case D modified roles.');

    const caseE = await fixtureCompany(pool, 'CASE_E', { fiscal: nextRfc('CFE'), roles: ['PROVEEDOR'] });
    const conflictE = await create({ commercialName: `${marker}_CASE_E_DIFFERENT`, fiscal: { legalName: 'Different SA', rfc: caseE.rfc } });
    assert(conflictE.response.status === 409 && conflictE.body.code === 'CLIENT_RFC_CONFLICT', 'Case E did not reject same RFC with a different commercial name.');
    assert((await pool.query('SELECT count(*)::int AS count FROM core.empresas WHERE nombre_comercial = $1', [`${marker}_CASE_E_DIFFERENT`])).rows[0].count === 0, 'Case E created a duplicate company.');

    const inactiveRole = await fixtureCompany(pool, 'INACTIVE_ROLE', { roles: [{ name: 'CLIENTE', status: 'INACTIVO' }, 'PROVEEDOR'] });
    const readded = await create({ commercialName: inactiveRole.name });
    assert(readded.response.status === 201 && readded.body.data.id === inactiveRole.id, 'Inactive CLIENTE was not reactivated through identity-safe creation.');

    const inactiveCompany = await fixtureCompany(pool, 'INACTIVE_COMPANY', { status: 'INACTIVO', roles: [{ name: 'CLIENTE', status: 'INACTIVO' }] });
    const restoredCompany = await create({ commercialName: inactiveCompany.name });
    assert(restoredCompany.response.status === 201 && restoredCompany.body.data.status === 'ACTIVO', 'Inactive company and role were not restored together.');

    const contradictory = await fixtureCompany(pool, 'CONTRADICTORY', { status: 'INACTIVO', roles: ['CLIENTE'] });
    const contradictoryCreate = await create({ commercialName: contradictory.name });
    assert(contradictoryCreate.response.status === 409 && contradictoryCreate.body.code === 'CLIENT_ALREADY_ACTIVE', 'Case B modified contradictory active membership.');
    const contradictoryRestore = await lifecycle(contradictory.id, 'reactivate');
    assert(contradictoryRestore.response.status === 200 && contradictoryRestore.body.data.status === 'ACTIVO', 'Reactivate did not repair INACTIVO company + active CLIENTE.');

    const rollbackName = `${marker}_ROLLBACK`;
    const rollback = await create({ commercialName: rollbackName, fiscal: { legalName: 'Rollback SA', rfc: fiscalRfc } });
    assert(rollback.response.status === 409 && rollback.body.code === 'CLIENT_RFC_CONFLICT', 'Duplicate fiscal identity did not return a safe conflict.');
    assert((await pool.query('SELECT count(*)::int AS count FROM core.empresas WHERE nombre_comercial = $1', [rollbackName])).rows[0].count === 0, 'Fiscal failure left a partial company or role.');

    assert((await patch(noFiscal.body.data.id, {})).response.status === 400, 'Empty PATCH was accepted.');
    assert((await patch(noFiscal.body.data.id, { status: 'INACTIVO' })).response.status === 400, 'Unsupported PATCH field was accepted.');
    const addedRfc = nextRfc('CFU');
    const updatedName = `${marker}_CASE_A_UPDATED`;
    const updated = await patch(noFiscal.body.data.id, { commercialName: updatedName, notes: ' updated ', fiscal: { legalName: 'Added Fiscal SA', rfc: addedRfc } });
    assert(updated.response.status === 200 && updated.body.data.commercialName === updatedName && updated.body.data.notes === 'updated' && updated.body.data.fiscal.rfc === addedRfc, `Client update/fiscal add failed: ${JSON.stringify(updated.body)}`);
    const correctedRfc = nextRfc('CRC');
    const correction = await patch(noFiscal.body.data.id, { fiscal: { legalName: 'Corrected Fiscal SA', rfc: correctedRfc, changeMode: 'CORRECTION' } });
    assert(correction.response.status === 200 && correction.body.data.fiscal.rfc === correctedRfc, 'Fiscal correction failed.');
    const newIdentityRfc = nextRfc('CNI');
    const historyRequest = `client-history-${randomUUID()}`;
    const history = await patch(noFiscal.body.data.id, { fiscal: { legalName: 'New Identity SA', rfc: newIdentityRfc, changeMode: 'NEW_IDENTITY', effectiveStartDate: '2026-09-03' } }, historyRequest);
    assert(history.response.status === 200 && history.body.data.fiscal.rfc === newIdentityRfc, 'Fiscal NEW_IDENTITY failed.');
    const identities = await pool.query('SELECT rfc, es_vigente, fecha_inicio::text, fecha_fin::text FROM core.empresas_fiscales WHERE empresa_id = $1 ORDER BY empresa_fiscal_id', [noFiscal.body.data.id]);
    assert(identities.rows.filter((row) => row.es_vigente).length === 1 && identities.rows.some((row) => row.rfc === correctedRfc && !row.es_vigente && row.fecha_fin === '2026-09-03'), 'Fiscal history/current semantics are incorrect.');

    // Paired fiscal contract (kept identical to Providers): legalName and rfc must arrive together.
    const fiscalSnapshotBefore = await pool.query('SELECT empresa_fiscal_id, razon_social, rfc, es_vigente FROM core.empresas_fiscales WHERE empresa_id = $1 ORDER BY empresa_fiscal_id', [noFiscal.body.data.id]);
    assert((await patch(noFiscal.body.data.id, { fiscal: { legalName: 'Only Legal Name SA' } })).response.status === 400, 'PATCH with legalName only was accepted.');
    assert((await patch(noFiscal.body.data.id, { fiscal: { rfc: nextRfc('ONL') } })).response.status === 400, 'PATCH with rfc only was accepted.');
    const changeModeOnly = await patch(noFiscal.body.data.id, { fiscal: { changeMode: 'CORRECTION' } });
    assert(changeModeOnly.response.status === 400 && changeModeOnly.body.code === 'FISCAL_CHANGE_WITHOUT_DATA', `changeMode without fiscal data was accepted: ${JSON.stringify(changeModeOnly.body)}`);
    const removalAttempt = await patch(noFiscal.body.data.id, { fiscal: { legalName: '', rfc: '' } });
    assert(removalAttempt.response.status === 400 && removalAttempt.body.code === 'FISCAL_REMOVAL_NOT_ALLOWED', `Fiscal removal via blank pair was accepted: ${JSON.stringify(removalAttempt.body)}`);
    const missingChangeMode = await patch(noFiscal.body.data.id, { fiscal: { legalName: 'Missing Mode SA', rfc: nextRfc('MCM') } });
    assert(missingChangeMode.response.status === 400 && missingChangeMode.body.code === 'FISCAL_CHANGE_MODE_REQUIRED', `RFC change without changeMode was accepted: ${JSON.stringify(missingChangeMode.body)}`);
    const whitespaceCommercialName = await patch(noFiscal.body.data.id, { commercialName: '   ' });
    assert(whitespaceCommercialName.response.status === 400, `Whitespace-only commercialName should be rejected (B5), got ${whitespaceCommercialName.response.status}: ${JSON.stringify(whitespaceCommercialName.body)}`);
    const fiscalSnapshotAfter = await pool.query('SELECT empresa_fiscal_id, razon_social, rfc, es_vigente FROM core.empresas_fiscales WHERE empresa_id = $1 ORDER BY empresa_fiscal_id', [noFiscal.body.data.id]);
    assert(JSON.stringify(fiscalSnapshotBefore.rows) === JSON.stringify(fiscalSnapshotAfter.rows), 'Rejected fiscal PATCH payloads mutated fiscal history.');
    assert((await pool.query('SELECT nombre_comercial FROM core.empresas WHERE empresa_id = $1', [noFiscal.body.data.id])).rows[0].nombre_comercial === updatedName, 'A rejected PATCH mutated the company name.');

    // PATCH must be atomic: a colliding RFC must roll back the commercialName change from the same payload.
    const rollbackAttemptName = `${marker}_CASE_A_ROLLBACK_ATTEMPT`;
    const patchRollback = await patch(noFiscal.body.data.id, { commercialName: rollbackAttemptName, fiscal: { legalName: 'Rollback Attempt SA', rfc: caseE.rfc, changeMode: 'CORRECTION' } });
    assert(patchRollback.response.status === 409, `PATCH with a colliding RFC should conflict, got ${patchRollback.response.status}: ${JSON.stringify(patchRollback.body)}`);
    assert((await pool.query('SELECT nombre_comercial FROM core.empresas WHERE empresa_id = $1', [noFiscal.body.data.id])).rows[0].nombre_comercial === updatedName, 'PATCH did not roll back commercialName when the fiscal write failed.');

    // B4: PATCH must compare the current RFC case-insensitively — a company whose stored RFC is
    // lower-case must not be forced through a changeMode just to fix an unrelated razon social typo.
    const lowerRfc = nextRfc('CFL').toLowerCase();
    const lowerCaseCompany = await fixtureCompany(pool, 'LOWER_RFC', { fiscal: lowerRfc, roles: ['CLIENTE'] });
    const lowerCaseRename = await patch(lowerCaseCompany.id, { fiscal: { legalName: 'Lower Case Renamed SA', rfc: lowerRfc.toUpperCase() } });
    assert(lowerCaseRename.response.status === 200 && lowerCaseRename.body.data.fiscal.legalName === 'Lower Case Renamed SA', `Case-insensitive RFC match on PATCH failed: ${JSON.stringify(lowerCaseRename.body)}`);
    assert((await pool.query('SELECT count(*)::int AS count FROM core.empresas_fiscales WHERE empresa_id = $1', [lowerCaseCompany.id])).rows[0].count === 1, 'Case-insensitive RFC match on PATCH created a spurious history row.');

    const multiDeactivate = await lifecycle(caseCCompany.id, 'deactivate');
    assert(multiDeactivate.response.status === 200, 'Multi-role Client deactivation failed.');
    const multiState = (await pool.query("SELECT e.estatus, r.rol, r.estatus AS role_status FROM core.empresas e JOIN core.empresa_roles r ON r.empresa_id = e.empresa_id WHERE e.empresa_id = $1 ORDER BY r.rol", [caseCCompany.id])).rows;
    assert(multiState.every((row) => row.estatus === 'ACTIVO') && multiState.some((row) => row.rol === 'CLIENTE' && row.role_status === 'INACTIVO') && multiState.some((row) => row.rol === 'PROVEEDOR' && row.role_status === 'ACTIVO'), 'Multi-role deactivation changed company or unrelated role state.');
    assert((await request(`/clients/${caseCCompany.id}`)).response.status === 404, 'Inactive CLIENTE remained visible in detail.');
    assert((await lifecycle(caseCCompany.id, 'reactivate')).response.status === 200, 'Multi-role Client reactivation failed.');

    const finalDeactivate = await lifecycle(withFiscal.body.data.id, 'deactivate');
    assert(finalDeactivate.response.status === 200 && finalDeactivate.body.data.status === 'INACTIVO', 'Final-role deactivation did not inactivate the company.');
    assert((await request(`/clients/${withFiscal.body.data.id}`)).response.status === 404, 'Inactive company remained visible as an active Client.');
    const finalReactivate = await lifecycle(withFiscal.body.data.id, 'reactivate');
    assert(finalReactivate.response.status === 200 && finalReactivate.body.data.status === 'ACTIVO', 'Final-role reactivation did not restore company and role.');

    let bigintId = '9007199254740993';
    while ((await pool.query('SELECT 1 FROM core.empresas WHERE empresa_id = $1', [bigintId])).rows.length) bigintId = (BigInt(bigintId) + 1n).toString();
    const bigint = await fixtureCompany(pool, 'BIGINT', { id: bigintId, type: 'CLIENTE', roles: ['CLIENTE'] });
    const bigintDetail = await request(`/clients/${bigint.id}`);
    assert(bigintDetail.response.status === 200 && bigintDetail.body.data.id === bigintId && typeof bigintDetail.body.data.id === 'string', 'BIGINT ID lost precision.');

    const list = await request(`/clients?search=${encodeURIComponent(marker)}&page=1&pageSize=100`);
    assert(list.response.status === 200 && Array.isArray(list.body.data) && list.body.data.every((item) => typeof item.id === 'string'), 'Client list contract or BIGINT serialization is incorrect.');

    // request-id / error contract: x-request-id is echoed on both success and error responses,
    // and error bodies never leak SQL/internal details.
    assert(list.response.headers.get('x-request-id') === list.requestId, 'x-request-id was not echoed back on a successful response.');
    const missingId = '424242424242424242';
    assert((await pool.query('SELECT 1 FROM core.empresas WHERE empresa_id = $1', [missingId])).rows.length === 0, 'Chosen not-found fixture ID unexpectedly exists.');
    const notFoundRequest = `client-notfound-${randomUUID()}`;
    const notFoundResponse = await request(`/clients/${missingId}`, 'GET', undefined, notFoundRequest);
    assert(notFoundResponse.response.status === 404, 'Unknown but well-formed BIGINT id did not return 404.');
    assert(notFoundResponse.response.headers.get('x-request-id') === notFoundRequest, 'x-request-id was not echoed back on a 404 response.');
    const errorBodyKeys = Object.keys(notFoundResponse.body).sort();
    assert(errorBodyKeys.every((key) => ['statusCode', 'message', 'code'].includes(key)) && notFoundResponse.body.statusCode === 404 && !JSON.stringify(notFoundResponse.body).toLowerCase().includes('select '), `Error contract leaked internal details: ${JSON.stringify(notFoundResponse.body)}`);

    const auditColumns = new Set((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'audit' AND table_name = 'cambios'")).rows.map((row) => row.column_name));
    const origin = ['origin', 'origen'].find((column) => auditColumns.has(column));
    const table = ['table_name', 'tabla'].find((column) => auditColumns.has(column));
    assert(origin && table && auditColumns.has('request_id'), 'audit.cambios lacks required context columns.');
    const createAudit = await pool.query(`SELECT ${origin} AS origin, ${table} AS table_name${auditColumns.has('usuario_id') ? ', usuario_id' : ''}${auditColumns.has('usuario_email') ? ', usuario_email' : ''} FROM audit.cambios WHERE request_id = $1`, [withFiscalRequest]);
    const tables = new Set(createAudit.rows.map((row) => row.table_name));
    assert(['empresas', 'empresa_roles', 'empresas_fiscales'].every((name) => tables.has(name)) && createAudit.rows.every((row) => row.origin === 'DAUBERT_HUB'), 'Create audit transaction/context is incomplete.');
    if (auditColumns.has('usuario_id')) assert(createAudit.rows.every((row) => row.usuario_id === null), 'Anonymous audit usuario_id is not null.');
    if (auditColumns.has('usuario_email')) assert(createAudit.rows.every((row) => row.usuario_email === null), 'Anonymous audit usuario_email is not null.');
    const historyAudit = await pool.query(`SELECT count(*)::int AS count FROM audit.cambios WHERE request_id = $1 AND ${table} = 'empresas_fiscales'`, [historyRequest]);
    assert(historyAudit.rows[0].count >= 2, 'Fiscal history mutation was not audited under one request ID.');

    console.log('Clients integration checks passed.');
  } catch (error) {
    if (api) console.error(startup || 'No Clients API startup output.');
    throw error;
  } finally {
    if (api) {
      api.kill('SIGTERM');
      await Promise.race([once(api, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    if (verified) {
      await assertLiveDatabase(pool, 'Cleanup');
      const cleanupRequestId = `client-cleanup-${randomUUID()}`;
      requestIds.add(cleanupRequestId);
      await audited(pool, cleanupRequestId, 'DELETE FROM core.empresas_fiscales WHERE empresa_id = ANY($1::bigint[])', [[...companyIds]]);
      await assertLiveDatabase(pool, 'Cleanup roles');
      await audited(pool, cleanupRequestId, 'DELETE FROM core.empresa_roles WHERE empresa_id = ANY($1::bigint[])', [[...companyIds]]);
      await assertLiveDatabase(pool, 'Cleanup companies');
      await audited(pool, cleanupRequestId, 'DELETE FROM core.empresas WHERE empresa_id = ANY($1::bigint[])', [[...companyIds]]);
      await assertLiveDatabase(pool, 'Cleanup audit');
      await pool.query('DELETE FROM audit.cambios WHERE request_id = ANY($1::text[])', [[...requestIds]]);
      const leftovers = await pool.query('SELECT count(*)::int AS count FROM core.empresas WHERE nombre_comercial LIKE $1 OR empresa_id = ANY($2::bigint[])', ['HUB_TEST_CLIENT_%', [...companyIds]]);
      assert(leftovers.rows[0].count === 0, 'Clients cleanup left company fixtures.');
      const auditLeftovers = await pool.query('SELECT count(*)::int AS count FROM audit.cambios WHERE request_id = ANY($1::text[])', [[...requestIds]]);
      assert(auditLeftovers.rows[0].count === 0, 'Clients cleanup left audit fixtures.');
      console.log('Clients cleanup verified: zero company/role/fiscal/audit fixtures remain.');
    }
    await pool.end();
  }
}

run().catch((error) => { console.error(error.message); process.exitCode = 1; });
