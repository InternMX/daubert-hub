const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const path = require('node:path');
const { Pool } = require('pg');
const { createAuthenticatedTestSession, cleanupAuthenticatedTestSession } = require('./support/test-auth.cjs');

let sessionCookie = null;

const port = 3106;
const apiDirectory = path.resolve(__dirname, '..');
const marker = `HUB_TEST_AUTOMATION_${randomUUID().replace(/-/g, '').toUpperCase()}`;
const automationCode = `${marker}_AUTO`;
const seriesCode = `${marker}_SERIES`;
const requestIds = new Set();

function assert(condition, message) { if (!condition) throw new Error(message); }
function databaseUrl() {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must be set for database integration tests.');
  const url = new URL(process.env.TEST_DATABASE_URL);
  const name = decodeURIComponent(url.pathname).replace(/^\//, '');
  if (name !== 'daubert_hub_test') throw new Error(`Refusing automation integration tests against "${name || '(missing)'}". Expected "daubert_hub_test".`);
  return url;
}
async function transaction(pool, text, values = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB_TEST']);
    const requestId = `automation-test-${randomUUID()}`;
    requestIds.add(requestId);
    await client.query("SELECT set_config('app.request_id', $1, true)", [requestId]);
    const result = await client.query(text, values);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
async function waitForApi(api, startupState) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (startupState.error) throw new Error(`Automation integration API failed to start: ${startupState.error.message}`);
    if (api.exitCode !== null) {
      const output = startupState.output.trim();
      throw new Error(`Automation integration API exited during startup with code ${api.exitCode}.${output ? `\n${output}` : ''}`);
    }
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch { /* Starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const output = startupState.output.trim();
  throw new Error(`Timed out waiting for the automation integration API.${output ? `\n${output}` : ''}`);
}
async function getConfiguration() {
  const response = await fetch(`http://127.0.0.1:${port}/api/automations/${automationCode}/document-series/${seriesCode}`, {
    headers: sessionCookie ? { cookie: sessionCookie } : {}
  });
  return { response, body: await response.json() };
}
async function adjust(payload) {
  const response = await fetch(`http://127.0.0.1:${port}/api/automations/${automationCode}/document-series/${seriesCode}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', ...(sessionCookie ? { cookie: sessionCookie } : {}) }, body: JSON.stringify(payload)
  });
  const requestId = response.headers.get('x-request-id');
  if (requestId) requestIds.add(requestId);
  return { response, body: await response.json(), requestId };
}

async function run() {
  const url = databaseUrl();
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let api;
  let seriesId;
  let databaseVerified = false;
  let authSession = null;
  try {
    assert((await pool.query('SELECT current_database() AS name')).rows[0].name === 'daubert_hub_test', 'Active session database mismatch.');
    databaseVerified = true;
    await transaction(pool, 'INSERT INTO ops.automatizaciones (codigo, nombre, descripcion, estatus) VALUES ($1, $2, $3, $4)', [automationCode, 'Temporary automation', 'Integration test only', 'ACTIVA']);
    const series = await transaction(pool, 'INSERT INTO operacion.series_documentales (codigo, nombre, siguiente_folio, estatus) VALUES ($1, $2, $3, $4) RETURNING serie_id::text', [seriesCode, 'Temporary series', 500, 'ACTIVA']);
    seriesId = series.rows[0].serie_id;
    await transaction(pool, `INSERT INTO operacion.ajustes_series
      (serie_id, siguiente_folio_anterior, siguiente_folio_nuevo, motivo, created_at)
      VALUES ($1, 498, 499, $2, '2026-01-01T00:00:00Z'), ($1, 499, 500, $3, '2026-01-02T00:00:00Z')`, [seriesId, `${marker}_OLDER`, `${marker}_NEWER`]);

    api = spawn(process.execPath, ['dist/src/main.js'], {
      cwd: apiDirectory,
      env: { ...process.env, DB_HOST: url.hostname, DB_PORT: url.port || '5432', DB_NAME: 'daubert_hub_test', DB_USER: decodeURIComponent(url.username), DB_PASSWORD: decodeURIComponent(url.password), API_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const startupState = { output: '', error: null };
    api.stdout.on('data', (chunk) => { startupState.output += chunk; });
    api.stderr.on('data', (chunk) => { startupState.output += chunk; });
    api.on('error', (error) => { startupState.error = error; });
    await waitForApi(api, startupState);
    authSession = await createAuthenticatedTestSession(`http://127.0.0.1:${port}/api`, marker);
    sessionCookie = authSession.cookie;

    const initial = await getConfiguration();
    assert(initial.response.status === 200, `Configuration read failed: ${JSON.stringify(initial.body)}`);
    assert(initial.body.data.automation.code === automationCode && initial.body.data.series.code === seriesCode, 'Configuration was not resolved by temporary stable codes.');
    assert(initial.body.data.series.nextFolio === 500, 'Current next folio was incorrect.');
    assert(initial.body.data.adjustments[0].reason === `${marker}_NEWER`, 'Adjustment history was not newest-first.');
    assert(initial.body.data.adjustments[0].previousFolio === 499 && initial.body.data.adjustments[0].newFolio === 500, 'Adjustment folios were not returned as numbers.');
    assert(!('id' in initial.body.data.automation) && !('id' in initial.body.data.series), 'The API exposed a database ID.');

    for (const payload of [{ nextFolio: 501, reason: `${marker}_FORWARD` }, { nextFolio: 499, reason: `${marker}_BACKWARD` }]) {
      const result = await adjust(payload);
      assert(result.response.status === 200 && result.body.data.series.nextFolio === payload.nextFolio, `Adjustment failed: ${JSON.stringify(result.body)}`);
      assert(result.body.data.adjustments.some((row) => row.newFolio === payload.nextFolio && row.reason === payload.reason), 'Adjustment history was not inserted.');
    }

    const identityRow = (await pool.query(
      'SELECT usuario_id, usuario_email FROM operacion.ajustes_series WHERE serie_id = $1 AND motivo = $2',
      [seriesId, `${marker}_FORWARD`]
    )).rows[0];
    assert(identityRow.usuario_id === authSession.userId, 'Authenticated Document Series adjustment did not record usuario_id from request.user.');
    assert(identityRow.usuario_email === authSession.email, 'Authenticated Document Series adjustment did not record usuario_email from request.user.');

    for (const payload of [
      { nextFolio: 0, reason: 'Invalid' }, { nextFolio: -1, reason: 'Invalid' },
      { nextFolio: 1.5, reason: 'Invalid' }, { nextFolio: 600, reason: '   ' }
    ]) {
      const result = await adjust(payload);
      assert(result.response.status === 400, `Invalid adjustment was accepted: ${JSON.stringify(payload)}`);
    }
    const unchanged = await adjust({ nextFolio: 499, reason: 'No change' });
    assert(unchanged.response.status === 409 && unchanged.body.code === 'DOCUMENT_SERIES_FOLIO_UNCHANGED', 'Unchanged folio did not return the expected conflict.');

    const concurrent = await Promise.all([
      adjust({ nextFolio: 498, reason: `${marker}_CONCURRENT_A` }),
      adjust({ nextFolio: 510, reason: `${marker}_CONCURRENT_B` })
    ]);
    assert(concurrent.every((result) => result.response.status === 200), 'A concurrent adjustment request failed.');
    const chain = await pool.query(`SELECT siguiente_folio_anterior, siguiente_folio_nuevo FROM operacion.ajustes_series
      WHERE serie_id = $1 AND motivo LIKE $2 ORDER BY ajuste_id`, [seriesId, `${marker}_CONCURRENT%`]);
    assert(chain.rows.length === 2, 'Concurrent adjustment history rows were not both inserted.');
    assert(chain.rows[0].siguiente_folio_anterior === '499', 'The first concurrent adjustment did not see the locked current value.');
    assert(chain.rows[1].siguiente_folio_anterior === chain.rows[0].siguiente_folio_nuevo, 'Concurrent history did not form an atomic previous-value chain.');
    console.log('Automation integration checks passed.');
  } finally {
    try {
      if (api && api.exitCode === null && !api.killed) { api.kill(); await once(api, 'exit'); }
    } finally {
      try {
        if (databaseVerified) {
          assert((await pool.query('SELECT current_database() AS name')).rows[0].name === 'daubert_hub_test', 'Cleanup database mismatch.');
          if (seriesId) await transaction(pool, 'DELETE FROM operacion.ajustes_series WHERE serie_id = $1', [seriesId]);
          await transaction(pool, 'DELETE FROM operacion.series_documentales WHERE codigo = $1', [seriesCode]);
          await transaction(pool, 'DELETE FROM ops.automatizaciones WHERE codigo = $1', [automationCode]);
          await pool.query('DELETE FROM audit.cambios WHERE request_id = ANY($1::text[])', [[...requestIds]]);
        }
      } finally {
        await cleanupAuthenticatedTestSession(authSession);
        await pool.end();
      }
    }
  }
}

run().catch((error) => { console.error(error.message); process.exitCode = 1; });
