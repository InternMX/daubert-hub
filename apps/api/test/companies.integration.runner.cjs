const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { Pool } = require('pg');
const { createAuthenticatedTestSession, cleanupAuthenticatedTestSession } = require('./support/test-auth.cjs');

let sessionCookie = null;

const port = 3104;
const marker = `HUB_TEST_COMPANY_LOOKUP_${randomUUID().replace(/-/g, '').toUpperCase()}`;
const requestId = `company-lookup-${randomUUID()}`;
const cleanupRequestId = `company-lookup-cleanup-${randomUUID()}`;
const ids = new Set();
function assert(condition, message) { if (!condition) throw new Error(message); }
function testUrl() {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must be set for database integration tests.');
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (decodeURIComponent(url.pathname).replace(/^\//, '') !== 'daubert_hub_test') throw new Error('Company lookup integration tests require daubert_hub_test.');
  return url;
}
async function query(pool, text, values = []) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB_TEST']); await client.query("SELECT set_config('app.request_id', $1, true)", [requestId]); const result = await client.query(text, values); await client.query('COMMIT'); return result; } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
async function company(pool, suffix, status = 'ACTIVO', name = `${marker}_${suffix}`) {
  const result = await query(pool, 'INSERT INTO core.empresas (tipo_empresa, nombre_comercial, estatus) VALUES ($1, $2, $3) RETURNING empresa_id::text', ['OTRO', name, status]);
  ids.add(result.rows[0].empresa_id); return result.rows[0].empresa_id;
}
async function waitForApi() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch { /* starting */ } await new Promise((resolve) => setTimeout(resolve, 200)); }
  throw new Error('Timed out waiting for the company lookup API.');
}
async function search(value) { const response = await fetch(`http://127.0.0.1:${port}/api/companies/search?search=${encodeURIComponent(value)}`, { headers: sessionCookie ? { cookie: sessionCookie } : {} }); return { response, body: await response.json() }; }

async function run() {
  const url = testUrl(); const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL }); let api; let databaseVerified = false; let authSession = null;
  try {
    assert((await pool.query('SELECT current_database() AS name')).rows[0].name === 'daubert_hub_test', 'Active session database mismatch.');
    databaseVerified = true;
    const active = await company(pool, 'ACTIVE');
    await query(pool, 'INSERT INTO core.empresas_fiscales (empresa_id, razon_social, rfc, es_vigente) VALUES ($1, $2, $3, TRUE)', [active, `${marker} LEGAL`, `${marker.slice(-8)}RFC`]);
    await query(pool, "INSERT INTO core.alias_empresa (empresa_id, alias, alias_normalizado, tipo_alias, estatus) VALUES ($1, $2, $2, 'NOMBRE_COMERCIAL_ALTERNATIVO', 'ACTIVO'), ($1, $3, $3, 'NOMBRE_COMERCIAL_ALTERNATIVO', 'ACTIVO'), ($1, $4, $4, 'NOMBRE_COMERCIAL_ALTERNATIVO', 'ACTIVO'), ($1, $5, $5, 'NOMBRE_COMERCIAL_ALTERNATIVO', 'INACTIVO')", [active, `${marker}_ALIAS`, `${marker}_ALIAS_EXTENDED`, `X_${marker}_ALIAS`, `${marker}_INACTIVE_ALIAS`]);
    const direct = await company(pool, 'DIRECT', 'ACTIVO', `${marker}_ALIAS_DIRECT`);
    await query(pool, "INSERT INTO core.alias_empresa (empresa_id, alias, alias_normalizado, tipo_alias, estatus) VALUES ($1, $2, $2, 'NOMBRE_COMERCIAL_ALTERNATIVO', 'ACTIVO')", [direct, `${marker}_ALIAS_DIRECT_ALT`]);
    const inactive = await company(pool, 'INACTIVE', 'INACTIVO'); const blocked = await company(pool, 'BLOCKED', 'BLOQUEADO');
    await query(pool, "INSERT INTO core.alias_empresa (empresa_id, alias, alias_normalizado, tipo_alias, estatus) VALUES ($1, $2, $2, 'NOMBRE_COMERCIAL_ALTERNATIVO', 'ACTIVO'), ($3, $4, $4, 'NOMBRE_COMERCIAL_ALTERNATIVO', 'ACTIVO')", [inactive, `${marker}_EXCLUDED_INACTIVE`, blocked, `${marker}_EXCLUDED_BLOCKED`]);
    await query(pool, "INSERT INTO core.contactos (empresa_id, tipo_contacto, nombre, estatus) VALUES ($1, 'PERSONA', $2, 'ACTIVO') RETURNING contacto_id::text", [active, `${marker}_CONTACT_ONLY`]);

    api = spawn(process.execPath, ['dist/src/main.js'], { cwd: process.cwd(), env: { ...process.env, DB_HOST: url.hostname, DB_PORT: url.port || '5432', DB_NAME: 'daubert_hub_test', DB_USER: decodeURIComponent(url.username), DB_PASSWORD: decodeURIComponent(url.password), API_PORT: String(port) }, stdio: 'ignore' });
    await waitForApi();
    authSession = await createAuthenticatedTestSession(`http://127.0.0.1:${port}/api`, marker);
    sessionCookie = authSession.cookie;
    const alias = await search(`${marker}_ALIAS`);
    assert(alias.response.status === 200 && alias.body.data.filter((row) => row.id === active).length === 1, 'Active alias search did not return exactly one company.');
    assert(alias.body.data.find((row) => row.id === active).matchedAlias === `${marker}_ALIAS`, 'Exact active alias was not selected deterministically.');
    const directMatch = await search(`${marker}_ALIAS_DIRECT`);
    assert(directMatch.body.data.find((row) => row.id === direct).matchedAlias === null, 'Direct commercial-name match exposed an alias.');
    const legal = await search(`${marker} LEGAL`); assert(legal.body.data.some((row) => row.id === active), 'Current legal-name search failed.');
    const rfc = await search(`${marker.slice(-8)}RFC`); assert(rfc.body.data.some((row) => row.id === active), 'Current RFC search failed.');
    const inactiveAlias = await search(`${marker}_INACTIVE_ALIAS`); assert(inactiveAlias.body.data.length === 0, 'Inactive alias matched a company.');
    const excluded = await search(`${marker}_EXCLUDED`); assert(excluded.body.data.length === 0, 'Inactive or blocked companies were returned.');
    const contactOnly = await search(`${marker}_CONTACT_ONLY`); assert(contactOnly.body.data.length === 0, 'Contact fields expanded the company selector search.');
    assert(typeof alias.body.data.find((row) => row.id === active).id === 'string', 'Company lookup did not preserve BIGINT IDs as strings.');
    console.log('Company lookup integration checks passed.');
  } finally {
    try { if (databaseVerified && ids.size) { assert((await pool.query('SELECT current_database() AS name')).rows[0].name === 'daubert_hub_test', 'Cleanup database mismatch.'); const client = await pool.connect(); try { await client.query('BEGIN'); await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB_TEST_CLEANUP']); await client.query("SELECT set_config('app.request_id', $1, true)", [cleanupRequestId]); await client.query('DELETE FROM core.medios_contacto WHERE contacto_id IN (SELECT contacto_id FROM core.contactos WHERE empresa_id = ANY($1::bigint[]))', [[...ids]]); await client.query('DELETE FROM core.contactos WHERE empresa_id = ANY($1::bigint[])', [[...ids]]); await client.query('DELETE FROM core.alias_empresa WHERE empresa_id = ANY($1::bigint[])', [[...ids]]); await client.query('DELETE FROM core.empresas_fiscales WHERE empresa_id = ANY($1::bigint[])', [[...ids]]); await client.query('DELETE FROM core.empresa_roles WHERE empresa_id = ANY($1::bigint[])', [[...ids]]); await client.query('DELETE FROM core.empresas WHERE empresa_id = ANY($1::bigint[])', [[...ids]]); await client.query('COMMIT'); await pool.query('DELETE FROM audit.cambios WHERE request_id = ANY($1::text[])', [[requestId, cleanupRequestId]]); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } } } finally { await cleanupAuthenticatedTestSession(authSession); if (api && !api.killed) { api.kill(); await once(api, 'exit'); } await pool.end(); }
  }
}
run().catch((error) => { console.error(error.message); process.exitCode = 1; });
