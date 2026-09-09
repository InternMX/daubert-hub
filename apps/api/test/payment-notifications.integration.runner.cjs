const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { Pool } = require('pg');
const { createAuthenticatedTestSession, cleanupAuthenticatedTestSession } = require('./support/test-auth.cjs');

const port = 3114;
const runnerFixturePrefix = 'HUB_TEST_PAYMENT_DASHBOARD_';
const marker = `${runnerFixturePrefix}${randomUUID().replace(/-/g, '').toUpperCase()}`;
const setupRequestId = `payment-dashboard-setup-${randomUUID()}`;
const requestIds = new Set([setupRequestId]);

function assert(condition, message) { if (!condition) throw new Error(message); }

function guardedDatabaseUrl(value) {
  if (!value) throw new Error('TEST_DATABASE_URL must be set for database integration tests.');
  let url;
  try { url = new URL(value); } catch { throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.'); }
  const databaseName = decodeURIComponent(url.pathname).replace(/^\//, '');
  if (databaseName !== 'daubert_hub_test') throw new Error('Payment Notifications integration tests require exactly daubert_hub_test.');
  return { url, databaseName, connectionString: value };
}

async function transaction(pool, requestId, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB_TEST']);
    await client.query("SELECT set_config('app.request_id', $1, true)", [requestId]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Preserve the original error. */ }
    throw error;
  } finally {
    client.release();
  }
}

async function waitForApi() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch { /* Starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for the payment notifications integration API.');
}

async function apiRequest(path, cookie) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { headers });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function findHistoricalSyntheticLeftovers(pool) {
  return (await pool.query(`
    SELECT correo_id::text AS id, outlook_message_id AS label
    FROM core.correos_notificacion_pago
    WHERE position($1 in outlook_message_id) > 0
      AND position($2 in outlook_message_id) = 0
    ORDER BY correo_id`, ['HUB_TEST_PAYMENT_DASHBOARD_', marker])).rows;
}

async function cleanup(pool, correoIds, authSessions) {
  let cleanupError;
  try {
    const currentDatabase = (await pool.query('SELECT current_database() AS name')).rows[0].name;
    assert(currentDatabase === 'daubert_hub_test', `Cleanup database mismatch: ${currentDatabase}`);
    if (correoIds.length) {
      await transaction(pool, `payment-dashboard-cleanup-${randomUUID()}`, async (client) => {
        await client.query('DELETE FROM core.resultados_notificacion_pago WHERE correo_id = ANY($1::bigint[])', [correoIds]);
        await client.query('DELETE FROM core.correos_notificacion_pago WHERE correo_id = ANY($1::bigint[])', [correoIds]);
      });
    }
  } catch (error) {
    cleanupError = error;
  }
  try {
    const leftover = await pool.query('SELECT count(*)::int AS n FROM core.correos_notificacion_pago WHERE correo_id = ANY($1::bigint[])', [correoIds.length ? correoIds : [-1]]);
    assert(leftover.rows[0].n === 0, `Payment Notifications cleanup left current-run execution fixtures for marker ${marker}.`);
    const resultLeftover = await pool.query('SELECT count(*)::int AS n FROM core.resultados_notificacion_pago WHERE correo_id = ANY($1::bigint[])', [correoIds.length ? correoIds : [-1]]);
    assert(resultLeftover.rows[0].n === 0, `Payment Notifications cleanup left current-run result fixtures for marker ${marker}.`);
    console.log(`Payment Notifications current-run cleanup verified for exact marker ${marker}.`);
    const historicalLeftovers = await findHistoricalSyntheticLeftovers(pool);
    if (historicalLeftovers.length > 0) {
      console.warn(`UNEXPECTED HISTORICAL SYNTHETIC LEFTOVERS (not current-run fixtures; not deleted): ${historicalLeftovers.map((row) => `core.correos_notificacion_pago#${row.id} (${row.label})`).join(', ')}`);
    }
  } catch (error) {
    cleanupError ??= error;
  }
  for (const session of authSessions) {
    try { await cleanupAuthenticatedTestSession(session); } catch (error) { cleanupError ??= error; }
  }
  if (cleanupError) throw cleanupError;
}

async function run() {
  const guarded = guardedDatabaseUrl(process.env.TEST_DATABASE_URL);
  const pool = new Pool({ connectionString: guarded.connectionString });
  let api;
  let databaseVerified = false;
  let correoIds = [];
  const authSessions = [];

  try {
    const currentDatabase = (await pool.query('SELECT current_database() AS name')).rows[0].name;
    assert(currentDatabase === 'daubert_hub_test', `Active session database mismatch: ${currentDatabase}`);
    databaseVerified = true;

    const companies = await pool.query('SELECT empresa_id::text AS id, nombre_comercial AS name FROM core.empresas ORDER BY empresa_id LIMIT 4');
    assert(companies.rows.length === 4, 'Payment Notifications integration fixtures require four existing test companies.');
    const [companyA, companyB, companyC, companyD] = companies.rows;

    const fixtures = await transaction(pool, setupRequestId, async (client) => {
      const insertCorreo = async (messageId, estado, { summarySent = false } = {}) => {
        const result = await client.query(`
          INSERT INTO core.correos_notificacion_pago (outlook_message_id, estado, fecha_procesado, resumen_enviado, fecha_resumen_enviado)
          VALUES ($1, $2, clock_timestamp(), $3, ${summarySent ? 'clock_timestamp()' : 'NULL'})
          RETURNING correo_id::text AS id, created_at, fecha_procesado`,
        [messageId, estado, summarySent]);
        return result.rows[0];
      };
      const insertResult = (correoId, empresaId, estado, motivo) => client.query(
        'INSERT INTO core.resultados_notificacion_pago (correo_id, empresa_id, estado, motivo) VALUES ($1, $2, $3, $4)',
        [correoId, empresaId, estado, motivo ?? null]
      );

      const completed = await insertCorreo(`${marker}_COMPLETED`, 'PROCESADO');
      await insertResult(completed.id, companyA.id, 'LISTO');
      await insertResult(completed.id, companyB.id, 'OMITIDO');

      const detail = await insertCorreo(`${marker}_DETAIL`, 'PROCESADO', { summarySent: true });
      await insertResult(detail.id, companyA.id, 'LISTO');
      await insertResult(detail.id, companyB.id, 'MANUAL', 'DESTINATARIOS_PARA');
      await insertResult(detail.id, companyC.id, 'ERROR', 'PROVEEDOR_NO_ENCONTRADO');
      await insertResult(detail.id, companyD.id, 'OMITIDO');

      const topLevelError = await insertCorreo(`${marker}_TOP_LEVEL_ERROR`, 'ERROR');

      const zeroResults = await insertCorreo(`${marker}_ZERO_RESULTS`, 'PROCESADO');

      return { completed, detail, topLevelError, zeroResults };
    });
    correoIds = Object.values(fixtures).map((fixture) => fixture.id);

    const { url, databaseName } = guarded;
    api = spawn(process.execPath, ['dist/src/main.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DB_HOST: url.hostname,
        DB_PORT: url.port || '5432',
        DB_NAME: databaseName,
        DB_USER: decodeURIComponent(url.username),
        DB_PASSWORD: decodeURIComponent(url.password),
        API_PORT: String(port)
      },
      stdio: 'ignore'
    });
    await waitForApi();

    const generalSession = await createAuthenticatedTestSession(`http://127.0.0.1:${port}/api`, `${marker}_GENERAL`, { role: 'GENERAL' });
    authSessions.push(generalSession);
    const adminSession = await createAuthenticatedTestSession(`http://127.0.0.1:${port}/api`, `${marker}_ADMIN`, { role: 'ADMIN' });
    authSessions.push(adminSession);

    // Unauthenticated requests are rejected by the existing global AuthGuard.
    const unauthenticatedList = await apiRequest('/automations/payment-notifications');
    assert(unauthenticatedList.response.status === 401, 'Unauthenticated list request was not rejected with 401.');
    const unauthenticatedDetail = await apiRequest(`/automations/payment-notifications/${fixtures.completed.id}`);
    assert(unauthenticatedDetail.response.status === 401, 'Unauthenticated detail request was not rejected with 401.');

    // Both GENERAL and ADMIN may read this operational module (no @Roles restriction).
    for (const session of [generalSession, adminSession]) {
      const list = await apiRequest('/automations/payment-notifications?page=1&pageSize=50', session.cookie);
      assert(list.response.status === 200, `${session.marker ?? session.email} could not list payment notification executions: ${JSON.stringify(list.body)}`);
      assert(Array.isArray(list.body.data) && list.body.data.length > 0, 'List response had no data.');
      assert(typeof list.body.meta.total === 'number' && typeof list.body.meta.totalPages === 'number', 'List response meta was malformed.');

      const byId = new Map(list.body.data.map((item) => [item.executionId, item]));

      const completedItem = byId.get(fixtures.completed.id);
      assert(completedItem, 'COMPLETED fixture execution missing from list.');
      assert(completedItem.processingStatus === 'PROCESADO' && completedItem.outcomeStatus === 'COMPLETED', `COMPLETED fixture had unexpected status: ${JSON.stringify(completedItem)}`);
      assert(completedItem.totalResults === 2 && completedItem.readyCount === 1 && completedItem.omittedCount === 1 && completedItem.manualCount === 0 && completedItem.errorCount === 0, 'COMPLETED fixture counts were wrong.');

      const detailItem = byId.get(fixtures.detail.id);
      assert(detailItem, 'PARTIAL fixture execution missing from list.');
      assert(detailItem.processingStatus === 'PROCESADO' && detailItem.outcomeStatus === 'PARTIAL', `PARTIAL fixture had unexpected status: ${JSON.stringify(detailItem)}`);
      assert(detailItem.totalResults === 4 && detailItem.readyCount === 1 && detailItem.manualCount === 1 && detailItem.errorCount === 1 && detailItem.omittedCount === 1, 'PARTIAL fixture counts were wrong.');
      assert(detailItem.summarySent === true && typeof detailItem.summarySentAt === 'string', 'PARTIAL fixture summary fields were wrong.');

      const failedItem = byId.get(fixtures.topLevelError.id);
      assert(failedItem, 'FAILED fixture execution missing from list.');
      assert(failedItem.processingStatus === 'ERROR' && failedItem.outcomeStatus === 'FAILED', `Top-level ERROR fixture had unexpected status: ${JSON.stringify(failedItem)}`);
      assert(failedItem.totalResults === 0, 'FAILED fixture unexpectedly had provider results.');

      const zeroItem = byId.get(fixtures.zeroResults.id);
      assert(zeroItem, 'Zero-result fixture execution missing from list (must not be hidden, unlike Recent Activity).');
      assert(zeroItem.processingStatus === 'PROCESADO' && zeroItem.outcomeStatus === null, `PROCESADO-with-zero-results must derive outcomeStatus=null, got: ${JSON.stringify(zeroItem)}`);
      assert(zeroItem.totalResults === 0, 'Zero-result fixture unexpectedly had provider results.');

      const responseText = JSON.stringify(list.body);
      assert(!/outlook|remitente|asunto|correos_para|correos_cc|correos_cco|rfc|detalle_error|DESTINATARIOS_PARA|PROVEEDOR_NO_ENCONTRADO/i.test(responseText), 'List response leaked a sensitive or raw internal field.');

      const detail = await apiRequest(`/automations/payment-notifications/${fixtures.detail.id}`, session.cookie);
      assert(detail.response.status === 200, `Detail fetch failed: ${JSON.stringify(detail.body)}`);
      const results = detail.body.data.results;
      assert(Array.isArray(results) && results.length === 4, 'Detail did not return all four provider results.');
      const byCompany = new Map(results.map((result) => [result.companyId, result]));
      assert(byCompany.get(companyA.id).status === 'LISTO' && byCompany.get(companyA.id).attentionReason === null, 'LISTO result had an unexpected attentionReason.');
      assert(byCompany.get(companyB.id).status === 'MANUAL' && byCompany.get(companyB.id).attentionReason === 'Faltan destinatarios principales configurados.', 'MANUAL result did not map the known reason.');
      assert(byCompany.get(companyC.id).status === 'ERROR' && byCompany.get(companyC.id).attentionReason === 'Requiere revisión.', 'ERROR result with an unknown motivo did not fall back to the generic reason.');
      assert(byCompany.get(companyD.id).status === 'OMITIDO', 'OMITIDO result missing from detail.');
      assert(byCompany.get(companyA.id).companyName === companyA.name, 'Result company name enrichment did not resolve the expected commercial name.');
      assert(typeof byCompany.get(companyA.id).companyId === 'string' && /^\d+$/.test(byCompany.get(companyA.id).companyId), 'companyId was not returned as a plain numeric string.');
      const detailText = JSON.stringify(detail.body);
      assert(!/DESTINATARIOS_PARA|PROVEEDOR_NO_ENCONTRADO|outlook|remitente|asunto/i.test(detailText), 'Detail response leaked a raw motivo value or sensitive field.');

      const notFound = await apiRequest('/automations/payment-notifications/999999999999999', session.cookie);
      assert(notFound.response.status === 404, `Unknown executionId did not return 404: ${notFound.response.status}`);

      const invalid = await apiRequest('/automations/payment-notifications/not-a-number', session.cookie);
      assert(invalid.response.status === 400, `Invalid executionId did not return 400: ${invalid.response.status}`);
    }

    console.log('Payment Notifications integration checks passed for GENERAL and ADMIN sessions.');
  } finally {
    try {
      if (api && api.exitCode === null && !api.killed) { api.kill(); await once(api, 'exit'); }
    } finally {
      if (databaseVerified) await cleanup(pool, correoIds, authSessions);
      await pool.end();
    }
  }
}

run().catch((error) => { console.error(error.message); process.exitCode = 1; });
