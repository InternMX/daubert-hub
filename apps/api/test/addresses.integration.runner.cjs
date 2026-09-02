const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { Pool } = require('pg');

const port = 3107;
const marker = `HUB_TEST_ADDRESS_${randomUUID().replace(/-/g, '').toUpperCase()}`;
const companyIds = new Set();
const requestIds = new Set();

function assert(condition, message) { if (!condition) throw new Error(message); }

function parseGuardedUrl(value) {
  if (!value) throw new Error('TEST_DATABASE_URL must be set for address integration tests.');
  const url = new URL(value);
  const databaseName = decodeURIComponent(url.pathname).replace(/^\//, '');
  if (databaseName !== 'daubert_hub_test') throw new Error(`Refusing address integration tests against "${databaseName || '(missing)'}". Expected "daubert_hub_test".`);
  return { url, databaseName };
}

async function assertLiveTestDatabase(pool, phase) {
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
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function createCompany(pool, suffix, status = 'ACTIVO') {
  const result = await audited(pool, `address-setup-${randomUUID()}`, 'INSERT INTO core.empresas (tipo_empresa, nombre_comercial, estatus) VALUES ($1, $2, $3) RETURNING empresa_id::text', ['OTRO', `${marker}_${suffix}`, status]);
  companyIds.add(result.rows[0].empresa_id);
  return result.rows[0].empresa_id;
}

async function request(path, method = 'GET', body, requestId = `address-${randomUUID()}`) {
  requestIds.add(requestId);
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method, headers: { 'x-request-id': requestId, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, body: await response.json(), requestId };
}

async function waitForApi() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch { /* API is starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for the address integration API.');
}

async function run() {
  // URL decoding is guarded before Pool construction. The live session is separately guarded before fixtures and cleanup.
  const { url, databaseName } = parseGuardedUrl(process.env.TEST_DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let server;
  let databaseVerified = false;
  let startup = '';
  try {
    await assertLiveTestDatabase(pool, 'Fixture');
    databaseVerified = true;
    server = spawn(process.execPath, ['dist/src/main.js'], { cwd: process.cwd(), env: { ...process.env, DB_HOST: url.hostname, DB_PORT: url.port || '5432', DB_NAME: databaseName, DB_USER: decodeURIComponent(url.username), DB_PASSWORD: decodeURIComponent(url.password), API_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', (chunk) => { startup += chunk; });
    server.stderr.on('data', (chunk) => { startup += chunk; });
    await waitForApi();

    const companyId = await createCompany(pool, 'ACTIVE');
    const otherCompanyId = await createCompany(pool, 'OTHER');
    const inactiveCompanyId = await createCompany(pool, 'INACTIVE', 'INACTIVO');

    assert((await request('/companies/999999999999999/addresses')).response.status === 404, 'Missing company GET was not 404.');
    const inactiveRead = await request(`/companies/${inactiveCompanyId}/addresses`);
    assert(inactiveRead.response.status === 200 && inactiveRead.body.data.length === 0, 'Existing inactive company was not readable.');
    assert((await request(`/companies/${inactiveCompanyId}/addresses`, 'POST', { tipoDireccion: 'OPERATIVA', calle: 'X' })).response.status === 409, 'Inactive company accepted a create.');

    for (const id of ['0', '01', '-1', '1.5', '9223372036854775808']) {
      assert((await request(`/companies/${id}/addresses`)).response.status === 400, `Invalid company ID ${id} was accepted.`);
      assert((await request(`/addresses/${id}`, 'PATCH', { calle: 'X' })).response.status === 400, `Invalid address ID ${id} was accepted.`);
    }
    for (const invalid of [{ tipoDireccion: 'ENVIO', calle: 'X' }, { tipoDireccion: 'OPERATIVA' }, { tipoDireccion: 'OPERATIVA', calle: 'X', estatus: 'ACTIVA' }, { tipoDireccion: 'OPERATIVA', calle: 'X', fechaInicio: '2026-02-30' }, { tipoDireccion: 'OPERATIVA', calle: 'X', fechaInicio: '2026-10-02', fechaFin: '2026-10-01' }]) {
      assert((await request(`/companies/${companyId}/addresses`, 'POST', invalid)).response.status === 400, `Invalid create was accepted: ${JSON.stringify(invalid)}`);
    }

    const types = ['FISCAL', 'COMERCIAL', 'OPERATIVA', 'ENTREGA', 'FACTURACION', 'OTRA'];
    const created = [];
    for (const tipoDireccion of types) {
      const requestId = `address-create-${tipoDireccion}-${randomUUID()}`;
      const result = await request(`/companies/${companyId}/addresses`, 'POST', { tipoDireccion, calle: `${marker} ${tipoDireccion}`, numeroExterior: '10', numeroInterior: null, colonia: 'Centro', codigoPostal: '20000', municipio: 'Aguascalientes', estado: 'Aguascalientes', referencias: null, esPrincipal: true, fechaInicio: '2026-09-01', fechaFin: '2026-09-30', ...(tipoDireccion === 'OPERATIVA' ? {} : { pais: null }) }, requestId);
      assert(result.response.status === 201 && result.response.headers.get('x-request-id') === requestId, `${tipoDireccion} create failed: ${JSON.stringify(result.body)}`);
      const expectedKeys = ['calle', 'codigoPostal', 'colonia', 'companyId', 'direccionCompleta', 'esPrincipal', 'estado', 'estatus', 'fechaFin', 'fechaInicio', 'id', 'municipio', 'numeroExterior', 'numeroInterior', 'pais', 'referencias', 'tipoDireccion'];
      assert(Object.keys(result.body.data).sort().join(',') === expectedKeys.sort().join(','), `${tipoDireccion} response has an incorrect contract.`);
      assert(typeof result.body.data.id === 'string' && result.body.data.tipoDireccion === tipoDireccion && result.body.data.estatus === 'ACTIVA' && result.body.data.fechaInicio === '2026-09-01' && result.body.data.fechaFin === '2026-09-30', `${tipoDireccion} response values are incorrect.`);
      created.push(result.body.data);
    }
    const operational = created.find((item) => item.tipoDireccion === 'OPERATIVA');
    const operationalStored = (await pool.query('SELECT pais FROM core.direcciones WHERE direccion_id = $1', [operational.id])).rows[0];
    assert(operationalStored.pais !== null, 'Omitted pais did not preserve its database default.');
    assert(created.filter((item) => item.tipoDireccion !== 'OPERATIVA').every((item) => item.pais === null), 'Explicit null pais was not preserved.');

    const older = await request(`/companies/${companyId}/addresses`, 'POST', { tipoDireccion: 'OTRA', calle: `${marker} Older`, fechaInicio: '2026-08-01' });
    const newer = await request(`/companies/${companyId}/addresses`, 'POST', { tipoDireccion: 'OTRA', calle: `${marker} Newer`, fechaInicio: '2026-08-15' });
    const ordered = await request(`/companies/${companyId}/addresses`);
    assert(ordered.response.status === 200 && ordered.body.data.findIndex((item) => item.id === newer.body.data.id) < ordered.body.data.findIndex((item) => item.id === older.body.data.id), 'GET did not order equal status/principal/type rows by fechaInicio descending.');

    const replacement = await request(`/companies/${companyId}/addresses`, 'POST', { tipoDireccion: 'OPERATIVA', direccionCompleta: `${marker} Complete`, esPrincipal: true });
    const other = await request(`/companies/${otherCompanyId}/addresses`, 'POST', { tipoDireccion: 'OPERATIVA', calle: `${marker} Other`, esPrincipal: true });
    assert(replacement.response.status === 201 && other.response.status === 201, 'Principal boundary fixtures failed.');
    const principalCounts = await pool.query("SELECT empresa_id::text, count(*) FILTER (WHERE estatus = 'ACTIVA' AND es_principal)::int AS count FROM core.direcciones WHERE empresa_id = ANY($1::bigint[]) AND empresa_fiscal_id IS NULL AND tipo_direccion = 'OPERATIVA' GROUP BY empresa_id", [[companyId, otherCompanyId]]);
    assert(principalCounts.rows.every((row) => row.count === 1), 'Principal demotion crossed companies or left duplicate ACTIVA principals.');

    const beforeRejectedPatch = (await pool.query('SELECT calle, direccion_completa, fecha_inicio::text, fecha_fin::text FROM core.direcciones WHERE direccion_id = $1', [operational.id])).rows[0];
    const invalidResultingContent = await request(`/addresses/${operational.id}`, 'PATCH', { calle: null });
    const invalidResultingDates = await request(`/addresses/${operational.id}`, 'PATCH', { fechaInicio: '2026-10-01' });
    assert(invalidResultingContent.response.status === 400 && invalidResultingDates.response.status === 400, 'PATCH resulting-state validation was bypassed.');
    const afterRejectedPatch = (await pool.query('SELECT calle, direccion_completa, fecha_inicio::text, fecha_fin::text FROM core.direcciones WHERE direccion_id = $1', [operational.id])).rows[0];
    assert(JSON.stringify(afterRejectedPatch) === JSON.stringify(beforeRejectedPatch), 'Rejected PATCH did not roll back completely.');
    const rolledBackAudit = await pool.query('SELECT count(*)::int AS count FROM audit.cambios WHERE request_id = ANY($1::text[])', [[invalidResultingContent.requestId, invalidResultingDates.requestId]]);
    assert(rolledBackAudit.rows[0].count === 0, 'Rejected PATCH retained an audit event instead of rolling back.');
    assert((await request(`/addresses/${operational.id}`, 'PATCH', {})).response.status === 400, 'Empty PATCH was accepted.');

    const patched = await request(`/addresses/${operational.id}`, 'PATCH', { direccionCompleta: `${marker} Updated complete`, calle: null, fechaInicio: '2026-09-15', fechaFin: null, esPrincipal: true });
    assert(patched.response.status === 200 && patched.body.data.calle === null && patched.body.data.direccionCompleta === `${marker} Updated complete` && patched.body.data.fechaInicio === '2026-09-15' && patched.body.data.fechaFin === null, `Valid PATCH failed: ${JSON.stringify(patched.body)}`);
    const deactivated = await request(`/addresses/${operational.id}/deactivate`, 'POST');
    assert(deactivated.response.status === 200 && deactivated.body.data.estatus === 'INACTIVA' && deactivated.body.data.fechaInicio === '2026-09-15', 'Deactivate failed or invented dates.');
    const withInactive = await request(`/companies/${companyId}/addresses`);
    assert(withInactive.body.data.findIndex((item) => item.id === operational.id) > withInactive.body.data.findLastIndex((item) => item.estatus === 'ACTIVA'), 'GET did not place INACTIVA rows after ACTIVA rows.');
    assert((await request(`/addresses/${operational.id}/deactivate`, 'POST')).response.status === 409, 'Repeated deactivate did not conflict.');
    const reactivated = await request(`/addresses/${operational.id}/reactivate`, 'POST');
    assert(reactivated.response.status === 200 && reactivated.body.data.estatus === 'ACTIVA' && reactivated.body.data.fechaFin === null, 'Reactivate failed or invented dates.');

    const concurrentIds = [];
    for (const suffix of ['A', 'B']) {
      const result = await request(`/companies/${companyId}/addresses`, 'POST', { tipoDireccion: 'FACTURACION', calle: `${marker} Concurrent ${suffix}` });
      concurrentIds.push(result.body.data.id);
    }
    const promotions = await Promise.all(concurrentIds.map((id) => request(`/addresses/${id}`, 'PATCH', { esPrincipal: true })));
    assert(promotions.every((item) => item.response.status === 200), 'Concurrent principal requests failed.');
    const concurrentCount = await pool.query("SELECT count(*)::int AS count FROM core.direcciones WHERE empresa_id = $1 AND empresa_fiscal_id IS NULL AND tipo_direccion = 'FACTURACION' AND estatus = 'ACTIVA' AND es_principal", [companyId]);
    assert(concurrentCount.rows[0].count === 1, 'Concurrent promotions left multiple principals.');

    const fiscal = await audited(pool, `address-fiscal-${randomUUID()}`, 'INSERT INTO core.empresas_fiscales (empresa_id, razon_social, rfc, es_vigente) VALUES ($1, $2, $3, TRUE) RETURNING empresa_fiscal_id::text', [companyId, `${marker} SA DE CV`, `TST${String(Date.now()).slice(-6)}ABC`]);
    const fiscalAddress = await audited(pool, `address-fiscal-row-${randomUUID()}`, "INSERT INTO core.direcciones (empresa_fiscal_id, tipo_direccion, calle) VALUES ($1, 'FISCAL', $2) RETURNING direccion_id::text", [fiscal.rows[0].empresa_fiscal_id, `${marker} Fiscal-owned`]);
    const list = await request(`/companies/${companyId}/addresses`);
    assert(list.response.status === 200 && !list.body.data.some((item) => item.id === fiscalAddress.rows[0].direccion_id), 'GET exposed a fiscal-owned row.');
    assert((await request(`/addresses/${fiscalAddress.rows[0].direccion_id}`, 'PATCH', { calle: 'Forbidden' })).response.status === 404, 'PATCH exposed a fiscal-owned row.');
    assert((await request(`/addresses/${fiscalAddress.rows[0].direccion_id}/deactivate`, 'POST')).response.status === 404, 'Lifecycle exposed a fiscal-owned row.');
    assert((await pool.query('SELECT calle FROM core.direcciones WHERE direccion_id = $1', [fiscalAddress.rows[0].direccion_id])).rows[0].calle === `${marker} Fiscal-owned`, 'Fiscal-owned row was mutated.');

    const columns = new Set((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'audit' AND table_name = 'cambios'")).rows.map((row) => row.column_name));
    const origin = ['origin', 'origen'].find((column) => columns.has(column));
    const table = ['table_name', 'tabla'].find((column) => columns.has(column));
    assert(origin && table && columns.has('request_id'), 'audit.cambios lacks required columns.');
    const createRequestId = [...requestIds].find((id) => id.startsWith('address-create-OPERATIVA-'));
    const audit = await pool.query(`SELECT ${origin} AS origin, ${table} AS table_name, request_id${columns.has('usuario_id') ? ', usuario_id' : ''}${columns.has('usuario_email') ? ', usuario_email' : ''} FROM audit.cambios WHERE request_id = $1`, [createRequestId]);
    assert(audit.rows.length === 1 && audit.rows[0].origin === 'DAUBERT_HUB' && audit.rows[0].table_name === 'direcciones', 'Address audit grouping/context is incorrect.');
    if (columns.has('usuario_id')) assert(audit.rows[0].usuario_id === null, 'Anonymous usuario_id was not null.');
    if (columns.has('usuario_email')) assert(audit.rows[0].usuario_email === null, 'Anonymous usuario_email was not null.');
    console.log('Address integration tests passed.');
  } catch (error) {
    if (server) console.error(startup || 'No API startup output.');
    throw error;
  } finally {
    if (server) { server.kill('SIGTERM'); await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]); }
    if (databaseVerified) {
      await assertLiveTestDatabase(pool, 'Cleanup');
      await audited(pool, `address-cleanup-${randomUUID()}`, 'DELETE FROM core.direcciones WHERE empresa_id = ANY($1::bigint[]) OR empresa_fiscal_id IN (SELECT empresa_fiscal_id FROM core.empresas_fiscales WHERE empresa_id = ANY($1::bigint[]))', [[...companyIds]]);
      await audited(pool, `address-cleanup-${randomUUID()}`, 'DELETE FROM core.empresas_fiscales WHERE empresa_id = ANY($1::bigint[])', [[...companyIds]]);
      await audited(pool, `address-cleanup-${randomUUID()}`, 'DELETE FROM core.empresas WHERE empresa_id = ANY($1::bigint[])', [[...companyIds]]);
      if (requestIds.size) await pool.query('DELETE FROM audit.cambios WHERE request_id = ANY($1::text[])', [[...requestIds]]);
    }
    await pool.end();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
