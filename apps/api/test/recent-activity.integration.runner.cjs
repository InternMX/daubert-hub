const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { Pool } = require('pg');
const { createAuthenticatedTestSession, cleanupAuthenticatedTestSession } = require('./support/test-auth.cjs');

const port = 3105;
const runnerFixturePrefix = 'HUB_TEST_ACTIVITY_';
const historicalFixturePrefixes = [runnerFixturePrefix, 'DBG_'];
const marker = `${runnerFixturePrefix}${randomUUID().replace(/-/g, '').toUpperCase()}`;
const markerLower = marker.toLowerCase();
const setupRequestId = `activity-setup-${randomUUID()}`;
const deleteRequestId = `activity-delete-${randomUUID()}`;
const paymentRequestId = `activity-payment-${randomUUID()}`;
const cleanupRequestId = `activity-cleanup-${randomUUID()}`;
const requestIds = new Set([setupRequestId, deleteRequestId, paymentRequestId, cleanupRequestId]);

function assert(condition, message) { if (!condition) throw new Error(message); }

let rfcSequence = 0;
function nextRfc(prefix = 'CLI') {
  rfcSequence += 1;
  return `${prefix}${String(Date.now() + rfcSequence).slice(-6)}ABC`;
}

function guardedDatabaseUrl(value) {
  if (!value) throw new Error('TEST_DATABASE_URL must be set for database integration tests.');
  let url;
  try { url = new URL(value); } catch { throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.'); }
  const databaseName = decodeURIComponent(url.pathname).replace(/^\//, '');
  if (databaseName !== 'daubert_hub_test') throw new Error('Recent activity integration tests require exactly daubert_hub_test.');
  return { url, databaseName, connectionString: value };
}

async function transaction(pool, origin, requestId, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.origin', $1, true)", [origin]);
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
  throw new Error('Timed out waiting for the recent activity integration API.');
}

// Set once by run() after the synthetic test session logs in; attached to
// every business request below.
let sessionCookie = null;

// x-request-id is always server-generated (Security V1 Phase 4) — a client
// can no longer choose the value that lands in audit.cambios.request_id.
// Callers must read the returned `requestId` (from the response header) for
// any later audit correlation, instead of pre-choosing one to send.
async function apiRequest(path, method = 'GET', payload) {
  const headers = {};
  if (payload !== undefined) headers['content-type'] = 'application/json';
  if (sessionCookie) headers.cookie = sessionCookie;
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method, headers, body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  const requestId = response.headers.get('x-request-id');
  if (requestId) requestIds.add(requestId);
  return { response, body: await response.json(), requestId };
}

function one(items, type, entity) {
  const matches = items.filter((item) => item.type === type && item.entity === entity);
  assert(matches.length === 1, `Expected exactly one ${type} event for ${entity}.`);
  return matches[0];
}

async function findHistoricalSyntheticLeftovers(pool) {
  return (await pool.query(`
    WITH prefixes AS (SELECT unnest($1::text[]) AS value), leftovers AS (
      SELECT 'core.empresas' AS source, empresa_id::text AS id, nombre_comercial AS label
      FROM core.empresas
      WHERE EXISTS (SELECT 1 FROM prefixes WHERE left(nombre_comercial, length(prefixes.value)) = prefixes.value)
        AND left(nombre_comercial, length($2)) <> $2
      UNION ALL
      SELECT 'core.contactos', contacto_id::text, coalesce(nombre, '')
      FROM core.contactos
      WHERE EXISTS (SELECT 1 FROM prefixes WHERE left(coalesce(nombre, ''), length(prefixes.value)) = prefixes.value)
        AND left(coalesce(nombre, ''), length($2)) <> $2
      UNION ALL
      SELECT 'core.medios_contacto', medio_id::text, valor
      FROM core.medios_contacto
      WHERE EXISTS (SELECT 1 FROM prefixes WHERE position(lower(prefixes.value) in lower(valor)) > 0)
        AND position(lower($2) in lower(valor)) = 0
      UNION ALL
      SELECT 'operacion.series_documentales', serie_id::text, codigo
      FROM operacion.series_documentales
      WHERE EXISTS (SELECT 1 FROM prefixes WHERE left(codigo, length(prefixes.value)) = prefixes.value)
        AND left(codigo, length($2)) <> $2
      UNION ALL
      SELECT 'operacion.ajustes_series', ajuste_id::text, motivo
      FROM operacion.ajustes_series
      WHERE EXISTS (SELECT 1 FROM prefixes WHERE left(motivo, length(prefixes.value)) = prefixes.value)
        AND left(motivo, length($2)) <> $2
      UNION ALL
      SELECT 'ops.automatizaciones', codigo, codigo
      FROM ops.automatizaciones
      WHERE EXISTS (SELECT 1 FROM prefixes WHERE left(codigo, length(prefixes.value)) = prefixes.value)
        AND left(codigo, length($2)) <> $2
      UNION ALL
      SELECT 'core.correos_notificacion_pago', correo_id::text, outlook_message_id
      FROM core.correos_notificacion_pago
      WHERE EXISTS (SELECT 1 FROM prefixes WHERE position(prefixes.value in outlook_message_id) > 0)
        AND position($2 in outlook_message_id) = 0
      UNION ALL
      SELECT 'security.users', user_id::text, email
      FROM security.users
      WHERE EXISTS (SELECT 1 FROM prefixes WHERE left(email, length(prefixes.value)) = prefixes.value)
        AND left(email, length($2)) <> $2
      UNION ALL
      SELECT 'audit.cambios', cambio_id::text, coalesce(request_id, '(no request_id)')
      FROM audit.cambios
      WHERE EXISTS (
          SELECT 1 FROM prefixes
          WHERE position(prefixes.value in coalesce(datos_anteriores::text, '') || coalesce(datos_nuevos::text, '') || coalesce(usuario_email, '')) > 0
        )
        AND position($2 in coalesce(datos_anteriores::text, '') || coalesce(datos_nuevos::text, '') || coalesce(usuario_email, '')) = 0
    )
    SELECT source, id, label FROM leftovers ORDER BY source, id`, [historicalFixturePrefixes, marker])).rows;
}

async function cleanup(pool, names, paymentFixtures) {
  let cleanupError;
  try {
    const currentDatabase = (await pool.query('SELECT current_database() AS name')).rows[0].name;
    assert(currentDatabase === 'daubert_hub_test', `Cleanup database mismatch: ${currentDatabase}`);
    await transaction(pool, 'DAUBERT_HUB_TEST_CLEANUP', cleanupRequestId, async (client) => {
      if (paymentFixtures.length) {
        const correoIds = paymentFixtures.map((fixture) => fixture.correoId);
        await client.query(`
          DELETE FROM core.resultados_notificacion_pago resultado
          WHERE resultado.correo_id = ANY($1::bigint[])
            AND EXISTS (
              SELECT 1 FROM core.correos_notificacion_pago correo
              WHERE correo.correo_id = resultado.correo_id AND correo.outlook_message_id = ANY($2::text[])
            )`, [correoIds, names.paymentMessageIds]);
        await client.query(
          'DELETE FROM core.correos_notificacion_pago WHERE correo_id = ANY($1::bigint[]) AND outlook_message_id = ANY($2::text[])',
          [correoIds, names.paymentMessageIds]
        );
      }
      const companies = await client.query(
        'SELECT empresa_id::text AS id FROM core.empresas WHERE left(nombre_comercial, length($1)) = $1',
        [marker]
      );
      const companyIds = companies.rows.map((row) => row.id);
      if (companyIds.length) {
        await client.query('DELETE FROM core.medios_contacto WHERE contacto_id IN (SELECT contacto_id FROM core.contactos WHERE empresa_id = ANY($1::bigint[]))', [companyIds]);
        await client.query('DELETE FROM core.contactos WHERE empresa_id = ANY($1::bigint[])', [companyIds]);
        await client.query('DELETE FROM core.direcciones WHERE empresa_id = ANY($1::bigint[])', [companyIds]);
        await client.query('DELETE FROM core.alias_empresa WHERE empresa_id = ANY($1::bigint[])', [companyIds]);
        await client.query('DELETE FROM core.empresas_fiscales WHERE empresa_id = ANY($1::bigint[])', [companyIds]);
        await client.query('DELETE FROM core.empresa_roles WHERE empresa_id = ANY($1::bigint[])', [companyIds]);
        await client.query('DELETE FROM core.empresas WHERE empresa_id = ANY($1::bigint[])', [companyIds]);
      }
      await client.query('DELETE FROM operacion.ajustes_series WHERE serie_id IN (SELECT serie_id FROM operacion.series_documentales WHERE codigo = $1)', [names.seriesCode]);
      await client.query('DELETE FROM operacion.series_documentales WHERE codigo = $1', [names.seriesCode]);
      await client.query('DELETE FROM ops.automatizaciones WHERE codigo = $1', [names.seriesAutomationCode]);
    });
  } catch (error) {
    cleanupError = error;
  }
  try {
    await pool.query('DELETE FROM audit.cambios WHERE request_id = ANY($1::text[])', [[...requestIds]]);
    const coreLeftovers = await pool.query(`
      SELECT
        (SELECT count(*) FROM core.empresas WHERE left(nombre_comercial, length($1)) = $1) +
        (SELECT count(*) FROM core.contactos WHERE left(coalesce(nombre, ''), length($1)) = $1) +
        (SELECT count(*) FROM core.medios_contacto WHERE position($2 in lower(valor)) > 0) AS count`, [marker, markerLower]);
    const auditLeftovers = await pool.query('SELECT count(*)::int AS count FROM audit.cambios WHERE request_id = ANY($1::text[])', [[...requestIds]]);
    const paymentLeftovers = await pool.query(`
      SELECT
        (SELECT count(*) FROM core.correos_notificacion_pago WHERE outlook_message_id = ANY($1::text[])) AS correo_count,
        (SELECT count(*) FROM core.resultados_notificacion_pago WHERE correo_id = ANY($2::bigint[])) AS result_count`,
      [names.paymentMessageIds, paymentFixtures.length ? paymentFixtures.map((fixture) => fixture.correoId) : [-1]]
    );
    const paymentExample = await pool.query(`
      SELECT count(resultado.correo_id)::int AS result_count,
        count(*) FILTER (WHERE resultado.estado = 'LISTO')::int AS ready_count,
        count(*) FILTER (WHERE resultado.estado = 'MANUAL')::int AS manual_count,
        count(*) FILTER (WHERE resultado.estado = 'ERROR')::int AS error_count
      FROM core.correos_notificacion_pago correo
      LEFT JOIN core.resultados_notificacion_pago resultado USING (correo_id)
      WHERE correo.correo_id = 32
      GROUP BY correo.correo_id`);
    const seriesLeftovers = await pool.query(`
      SELECT
        (SELECT count(*) FROM operacion.series_documentales WHERE codigo = $1) +
        (SELECT count(*) FROM operacion.ajustes_series WHERE left(motivo, length($3)) = $3) +
        (SELECT count(*) FROM ops.automatizaciones WHERE codigo = $2) AS count`, [names.seriesCode, names.seriesAutomationCode, marker]);
    assert(Number(coreLeftovers.rows[0].count) === 0, `Recent activity cleanup left core fixtures for current-run marker ${marker}.`);
    assert(Number(seriesLeftovers.rows[0].count) === 0, `Recent activity cleanup left document-series/automation fixtures for current-run marker ${marker}.`);
    assert(auditLeftovers.rows[0].count === 0, `Recent activity cleanup left correlated audit rows for current-run marker ${marker}.`);
    assert(Number(paymentLeftovers.rows[0].correo_count) === 0 && Number(paymentLeftovers.rows[0].result_count) === 0, `Recent activity cleanup left payment fixtures for current-run marker ${marker}.`);
    assert(paymentExample.rows.length === 1 && paymentExample.rows[0].result_count === 5 && paymentExample.rows[0].ready_count === 4 && paymentExample.rows[0].manual_count === 1 && paymentExample.rows[0].error_count === 0, 'Cleanup changed the existing correo 32 example.');
    console.log(`Recent Activity current-run cleanup verified for exact marker ${marker}.`);
    const historicalLeftovers = await findHistoricalSyntheticLeftovers(pool);
    if (historicalLeftovers.length > 0) {
      console.warn(`UNEXPECTED HISTORICAL SYNTHETIC LEFTOVERS (not current-run fixtures; not deleted): ${historicalLeftovers.map((row) => `${row.source}#${row.id} (${row.label})`).join(', ')}`);
    }
  } catch (error) {
    cleanupError ??= error;
  }
  if (cleanupError) throw cleanupError;
}

async function run() {
  const guarded = guardedDatabaseUrl(process.env.TEST_DATABASE_URL);
  const pool = new Pool({ connectionString: guarded.connectionString });
  let api;
  let databaseVerified = false;
  let paymentFixtures = [];
  let authSession = null;
  const names = {
    setupCompany: `${marker}_DELETE_COMPANY`,
    deleteContact: `${marker}_DELETE_CONTACT`,
    deleteValue: `delete.${markerLower}@example.test`,
    providerOriginal: `${marker}_PROVIDER_ORIGINAL`,
    providerUpdated: `${marker}_PROVIDER_UPDATED`,
    contactOriginal: `${marker}_CONTACT_ORIGINAL`,
    contactUpdated: `${marker}_CONTACT_UPDATED`,
    initialEmail: `initial.${markerLower}@example.test`,
    initialPhone: `+52 449 ${String(Date.now()).slice(-7)}`,
    methodOriginal: `standalone.${markerLower}@example.test`,
    methodUpdated: `standalone.updated.${markerLower}@example.test`,
    clientNew: `${marker}_CLIENT_NEW`,
    clientFromProvider: `${marker}_CLIENT_FROM_PROVIDER`,
    clientForUpdate: `${marker}_CLIENT_FOR_UPDATE`,
    clientUpdatedName: `${marker}_CLIENT_UPDATED_NAME`,
    clientForFiscal: `${marker}_CLIENT_FOR_FISCAL`,
    clientFinalRole: `${marker}_CLIENT_FINAL_ROLE`,
    clientForAddress: `${marker}_CLIENT_FOR_ADDRESS`,
    clientForAlias: `${marker}_CLIENT_FOR_ALIAS`,
    providerLifecycle: `${marker}_PROVIDER_LIFECYCLE`,
    providerMultiRole: `${marker}_PROVIDER_MULTI_ROLE`,
    contactLifecycleCompany: `${marker}_CONTACT_LIFECYCLE_CO`,
    contactLifecycle: `${marker}_CONTACT_LIFECYCLE`,
    seriesAutomationCode: `${marker}_SERIES_AUTO`,
    seriesCode: `${marker}_SERIES`,
    seriesName: `${marker} Serie de prueba`,
    paymentMessageIds: [
      `SYNTHETIC_PAYMENT_PROCESSED_${marker}`,
      `SYNTHETIC_PAYMENT_FAILED_${marker}`,
      `SYNTHETIC_PAYMENT_PARTIAL_ERROR_${marker}`
    ]
  };

  try {
    const currentDatabase = (await pool.query('SELECT current_database() AS name')).rows[0].name;
    assert(currentDatabase === 'daubert_hub_test', `Active session database mismatch: ${currentDatabase}`);
    databaseVerified = true;

    const paymentExample = await pool.query(`
      SELECT
        correo.estado,
        correo.fecha_procesado,
        count(resultado.correo_id)::int AS result_count,
        count(*) FILTER (WHERE resultado.estado = 'LISTO')::int AS ready_count,
        count(*) FILTER (WHERE resultado.estado = 'MANUAL')::int AS manual_count,
        count(*) FILTER (WHERE resultado.estado = 'ERROR')::int AS error_count
      FROM core.correos_notificacion_pago correo
      LEFT JOIN core.resultados_notificacion_pago resultado USING (correo_id)
      WHERE correo.correo_id = 32
      GROUP BY correo.correo_id, correo.estado, correo.fecha_procesado`);
    assert(paymentExample.rows.length === 1, 'Expected the existing payment notification example.');
    assert(paymentExample.rows[0].estado === 'PROCESADO' && paymentExample.rows[0].fecha_procesado, 'Payment notification example lacks its supported terminal state or timestamp.');
    assert(paymentExample.rows[0].result_count === 5 && paymentExample.rows[0].ready_count === 4 && paymentExample.rows[0].manual_count === 1 && paymentExample.rows[0].error_count === 0, 'Existing payment notification example is not 4 LISTO + 1 MANUAL.');

    const deletedMethodId = await transaction(pool, 'DAUBERT_HUB_TEST', setupRequestId, async (client) => {
      const company = await client.query("INSERT INTO core.empresas (tipo_empresa, nombre_comercial) VALUES ('OTRO', $1) RETURNING empresa_id::text AS id", [names.setupCompany]);
      const contact = await client.query("INSERT INTO core.contactos (empresa_id, tipo_contacto, nombre, estatus) VALUES ($1, 'PERSONA', $2, 'ACTIVO') RETURNING contacto_id::text AS id", [company.rows[0].id, names.deleteContact]);
      const method = await client.query("INSERT INTO core.medios_contacto (contacto_id, tipo_medio, valor, estatus, es_principal, recibe_notificacion_pago) VALUES ($1, 'CORREO', $2, 'ACTIVO', FALSE, FALSE) RETURNING medio_id::text AS id", [contact.rows[0].id, names.deleteValue]);
      return method.rows[0].id;
    });
    await transaction(pool, 'DAUBERT_HUB', deleteRequestId, (client) => client.query('DELETE FROM core.medios_contacto WHERE medio_id = $1', [deletedMethodId]));
    const deleteAudit = await pool.query("SELECT tabla, operacion FROM audit.cambios WHERE origen = 'DAUBERT_HUB' AND request_id = $1", [deleteRequestId]);
    assert(deleteAudit.rows.length === 1 && deleteAudit.rows[0].tabla === 'medios_contacto' && String(deleteAudit.rows[0].operacion).toUpperCase() === 'DELETE', 'DELETE-only fixture did not produce exactly one method DELETE audit row.');

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

    authSession = await createAuthenticatedTestSession(`http://127.0.0.1:${port}/api`, marker);
    sessionCookie = authSession.cookie;

    paymentFixtures = await transaction(pool, 'DAUBERT_HUB_TEST', paymentRequestId, async (client) => {
      const companies = await client.query('SELECT empresa_id::text AS id FROM core.empresas ORDER BY empresa_id LIMIT 5');
      assert(companies.rows.length === 5, 'Synthetic payment fixture requires five existing test companies.');

      const insertCorreo = async (messageId, state) => {
        const correo = await client.query(`
          INSERT INTO core.correos_notificacion_pago (outlook_message_id, estado, fecha_procesado)
          VALUES ($1, $2, clock_timestamp())
          RETURNING correo_id::text AS id, fecha_procesado`, [messageId, state]);
        return { correoId: correo.rows[0].id, occurredAt: new Date(correo.rows[0].fecha_procesado).toISOString() };
      };

      const processed = await insertCorreo(names.paymentMessageIds[0], 'PROCESADO');
      const states = ['LISTO', 'LISTO', 'LISTO', 'LISTO', 'MANUAL'];
      for (const [index, company] of companies.rows.entries()) {
        await client.query(
          'INSERT INTO core.resultados_notificacion_pago (correo_id, empresa_id, estado) VALUES ($1, $2, $3)',
          [processed.correoId, company.id, states[index]]
        );
      }

      const failed = await insertCorreo(names.paymentMessageIds[1], 'ERROR');
      const partialError = await insertCorreo(names.paymentMessageIds[2], 'ERROR');
      await client.query(`
        INSERT INTO core.resultados_notificacion_pago (correo_id, empresa_id, estado)
        VALUES ($1, $2, 'LISTO'), ($1, $3, 'ERROR')`, [partialError.correoId, companies.rows[0].id, companies.rows[1].id]);
      return [processed, failed, partialError];
    });

    const paymentFeed = await apiRequest('/recent-activity?limit=20');
    assert(paymentFeed.response.status === 200, 'Could not load payment notification activity.');
    const paymentEvents = [
      { fixture: paymentFixtures[0], type: 'AUTOMATION_PARTIAL', title: 'Automatización con incidencias', context: '4 listos · 1 manual' },
      { fixture: paymentFixtures[1], type: 'AUTOMATION_FAILED', title: 'Automatización con error', context: 'No fue posible completar la automatización' },
      { fixture: paymentFixtures[2], type: 'AUTOMATION_PARTIAL', title: 'Automatización con incidencias', context: '1 listo · 1 con error' }
    ].map((expected) => {
      const matches = paymentFeed.body.data.filter((item) => item.occurredAt === expected.fixture.occurredAt && item.type === expected.type && item.entity === 'Notificaciones de pago');
      assert(matches.length === 1, `Expected exactly one synthetic ${expected.type} payment activity.`);
      const activity = matches[0];
      assert(activity.category === 'AUTOMATION' && activity.title === expected.title && activity.context === expected.context, `${expected.type} payment activity has incorrect business fields.`);
      assert(activity.occurredAt === expected.fixture.occurredAt, `${expected.type} payment activity does not use fecha_procesado.`);
      assert(Object.keys(activity).sort().join(',') === 'actor,category,context,entity,occurredAt,title,type', `${expected.type} payment activity exposed unsupported fields.`);
      assert(activity.actor === null, `${expected.type} payment activity must report actor=null for system-generated activity.`);
      return activity;
    });
    assert(!/correo_id|outlook|remitente|destinatario|detalle_error/i.test(JSON.stringify(paymentEvents)), 'Payment notification activity exposed sensitive notification data.');

    // --- Client Recent Activity scenarios (A-J) ---
    // Run before the Provider/Contact block below so its own Provider fixture (scenario B) is
    // older than names.providerOriginal/providerUpdated and does not disturb their "newest two"
    // PROVIDER-category assertions further down.
    const clientActionOrder = [];

    // A: brand-new company + CLIENTE role -> exactly one CLIENT_CREATED
        const clientNew = await apiRequest('/clients', 'POST', { commercialName: names.clientNew });
    clientActionOrder.push(clientNew.requestId);
    assert(clientNew.response.status === 201, `Client create failed with ${clientNew.response.status}.`);

    // B: existing Provider gains CLIENTE -> exactly one CLIENT_CREATED, Provider role untouched
        const providerForClient = await apiRequest('/providers', 'POST', { commercialName: names.clientFromProvider, providerType: 'PROVEEDOR' });
    clientActionOrder.push(providerForClient.requestId);
    assert(providerForClient.response.status === 201, `Provider fixture for Client gain failed with ${providerForClient.response.status}.`);
    const clientFromProviderId = providerForClient.body.data.id;

        const clientGain = await apiRequest('/clients', 'POST', { commercialName: names.clientFromProvider });
    clientActionOrder.push(clientGain.requestId);
    assert(clientGain.response.status === 201 && clientGain.body.data.id === clientFromProviderId, `Existing Provider did not gain CLIENTE on the same company: ${JSON.stringify(clientGain.body)}`);
    const clientFromProviderRoles = await pool.query('SELECT rol, estatus FROM core.empresa_roles WHERE empresa_id = $1 ORDER BY rol', [clientFromProviderId]);
    assert(clientFromProviderRoles.rows.some((row) => row.rol === 'PROVEEDOR' && row.estatus === 'ACTIVO'), 'Existing PROVEEDOR role was disturbed when gaining CLIENTE.');
    assert(clientFromProviderRoles.rows.some((row) => row.rol === 'CLIENTE' && row.estatus === 'ACTIVO'), 'CLIENTE role was not added.');

    // C: update Client general data -> exactly one CLIENT_UPDATED
        const clientForUpdate = await apiRequest('/clients', 'POST', { commercialName: names.clientForUpdate });
    clientActionOrder.push(clientForUpdate.requestId);
    assert(clientForUpdate.response.status === 201, 'Client-for-update fixture create failed.');
    const clientForUpdateId = clientForUpdate.body.data.id;
        const clientUpdated = await apiRequest(`/clients/${clientForUpdateId}`, 'PATCH', { commercialName: names.clientUpdatedName, notes: 'Nota de prueba' });
    clientActionOrder.push(clientUpdated.requestId);
    assert(clientUpdated.response.status === 200 && clientUpdated.body.data.commercialName === names.clientUpdatedName, 'Client update failed.');

    // D: fiscal update / NEW_IDENTITY -> exactly one CLIENT_UPDATED despite multiple audit rows
    const clientForFiscalRfc = nextRfc('CFF');
        const clientForFiscal = await apiRequest('/clients', 'POST', { commercialName: names.clientForFiscal, fiscal: { legalName: `${names.clientForFiscal} SA`, rfc: clientForFiscalRfc } });
    clientActionOrder.push(clientForFiscal.requestId);
    assert(clientForFiscal.response.status === 201, 'Client-for-fiscal fixture create failed.');
    const clientForFiscalId = clientForFiscal.body.data.id;
    const clientNewIdentityRfc = nextRfc('CNI');
        const clientFiscalUpdated = await apiRequest(`/clients/${clientForFiscalId}`, 'PATCH', { fiscal: { legalName: 'Nueva Identidad SA', rfc: clientNewIdentityRfc, changeMode: 'NEW_IDENTITY', effectiveStartDate: '2026-09-10' } });
    clientActionOrder.push(clientFiscalUpdated.requestId);
    assert(clientFiscalUpdated.response.status === 200 && clientFiscalUpdated.body.data.fiscal.rfc === clientNewIdentityRfc, 'Client fiscal NEW_IDENTITY update failed.');
    const clientFiscalAudit = await pool.query("SELECT tabla, operacion FROM audit.cambios WHERE origen = 'DAUBERT_HUB' AND request_id = $1", [clientFiscalUpdated.requestId]);
    assert(clientFiscalAudit.rows.length >= 2, 'Fiscal NEW_IDENTITY update did not produce multiple audit rows as expected.');

    // E/F: deactivate then reactivate a multi-role Client (company stays ACTIVO throughout)
        const clientDeactivatedMulti = await apiRequest(`/clients/${clientFromProviderId}/deactivate`, 'POST', undefined);
    clientActionOrder.push(clientDeactivatedMulti.requestId);
    assert(clientDeactivatedMulti.response.status === 200 && clientDeactivatedMulti.body.data.clientStatus === 'INACTIVO', 'Multi-role Client deactivate failed.');
    const multiRoleCompanyAfterDeactivate = await pool.query('SELECT estatus FROM core.empresas WHERE empresa_id = $1', [clientFromProviderId]);
    assert(multiRoleCompanyAfterDeactivate.rows[0].estatus === 'ACTIVO', 'Multi-role Client deactivate incorrectly deactivated the company.');

        const clientReactivatedMulti = await apiRequest(`/clients/${clientFromProviderId}/reactivate`, 'POST', undefined);
    clientActionOrder.push(clientReactivatedMulti.requestId);
    assert(clientReactivatedMulti.response.status === 200 && clientReactivatedMulti.body.data.clientStatus === 'ACTIVO', 'Multi-role Client reactivate failed.');

    // G: deactivate a final-role Client (company status also flips) -> exactly one CLIENT_DEACTIVATED
        const clientFinalRole = await apiRequest('/clients', 'POST', { commercialName: names.clientFinalRole });
    clientActionOrder.push(clientFinalRole.requestId);
    assert(clientFinalRole.response.status === 201, 'Client-final-role fixture create failed.');
    const clientFinalRoleId = clientFinalRole.body.data.id;
        const clientFinalDeactivated = await apiRequest(`/clients/${clientFinalRoleId}/deactivate`, 'POST', undefined);
    clientActionOrder.push(clientFinalDeactivated.requestId);
    assert(clientFinalDeactivated.response.status === 200, 'Final-role Client deactivate failed.');
    const finalRoleCompanyAfterDeactivate = await pool.query('SELECT estatus FROM core.empresas WHERE empresa_id = $1', [clientFinalRoleId]);
    assert(finalRoleCompanyAfterDeactivate.rows[0].estatus === 'INACTIVO', 'Final-role Client deactivate did not also deactivate the company.');
    const clientFinalDeactivateAudit = await pool.query("SELECT tabla, operacion FROM audit.cambios WHERE origen = 'DAUBERT_HUB' AND request_id = $1", [clientFinalDeactivated.requestId]);
    assert(clientFinalDeactivateAudit.rows.length === 2, 'Final-role Client deactivate did not produce both the role and company audit rows.');

    // H: change a Client's company address through the generic address API -> no CLIENT activity
        const clientForAddress = await apiRequest('/clients', 'POST', { commercialName: names.clientForAddress });
    clientActionOrder.push(clientForAddress.requestId);
    assert(clientForAddress.response.status === 201, 'Client-for-address fixture create failed.');
    const clientForAddressId = clientForAddress.body.data.id;
        const clientAddress = await apiRequest(`/companies/${clientForAddressId}/addresses`, 'POST', { tipoDireccion: 'OPERATIVA', calle: `${marker} Calle` });
    clientActionOrder.push(clientAddress.requestId);
    assert(clientAddress.response.status === 201, 'Client address create failed.');

    // I: change a Client's aliases through the generic company alias API -> no CLIENT activity
        const clientForAlias = await apiRequest('/clients', 'POST', { commercialName: names.clientForAlias });
    clientActionOrder.push(clientForAlias.requestId);
    assert(clientForAlias.response.status === 201, 'Client-for-alias fixture create failed.');
    const clientForAliasId = clientForAlias.body.data.id;
        const clientAlias = await apiRequest(`/companies/${clientForAliasId}/aliases`, 'PATCH', { aliases: [`${marker}_ALIAS`] });
    clientActionOrder.push(clientAlias.requestId);
    assert(clientAlias.response.status === 200, 'Client alias update failed.');

    const clientEndpointAudit = await pool.query("SELECT request_id FROM audit.cambios WHERE origen = 'DAUBERT_HUB' AND request_id = ANY($1::text[]) GROUP BY request_id", [clientActionOrder]);
    assert(clientEndpointAudit.rows.length === clientActionOrder.length, `Not all Client scenario request IDs reached the audit log (expected ${clientActionOrder.length}, got ${clientEndpointAudit.rows.length}).`);

    const actionOrder = [];
        const provider = await apiRequest('/providers', 'POST', { commercialName: names.providerOriginal, providerType: 'PROVEEDOR' });
    actionOrder.push(provider.requestId);
    assert(provider.response.status === 201, `Provider create failed with ${provider.response.status}.`);
    const companyId = provider.body.data.id;

        const providerUpdated = await apiRequest(`/providers/${companyId}`, 'PATCH', { commercialName: names.providerUpdated });
    actionOrder.push(providerUpdated.requestId);
    assert(providerUpdated.response.status === 200 && providerUpdated.body.data.commercialName === names.providerUpdated, 'Provider update failed.');

        const contact = await apiRequest('/contacts', 'POST', {
      companyId, contactType: 'PERSONA', name: names.contactOriginal,
      methods: [{ type: 'CORREO', value: names.initialEmail }, { type: 'TELEFONO', value: names.initialPhone }]
    });
    actionOrder.push(contact.requestId);
    assert(contact.response.status === 201 && contact.body.data.methods.length === 2, 'Contact create with multiple initial methods failed.');
    const contactId = contact.body.data.id;

        const contactUpdated = await apiRequest(`/contacts/${contactId}`, 'PATCH', { name: names.contactUpdated });
    actionOrder.push(contactUpdated.requestId);
    assert(contactUpdated.response.status === 200 && contactUpdated.body.data.name === names.contactUpdated, 'Contact update failed.');

        const method = await apiRequest(`/contacts/${contactId}/methods`, 'POST', { type: 'CORREO', value: names.methodOriginal });
    actionOrder.push(method.requestId);
    assert(method.response.status === 201, 'Standalone method add failed.');
    const methodId = method.body.data.id;

        const editedMethod = await apiRequest(`/contact-methods/${methodId}`, 'PATCH', { value: names.methodUpdated });
    actionOrder.push(editedMethod.requestId);
    assert(editedMethod.response.status === 200 && editedMethod.body.data.value === names.methodUpdated, 'Method edit failed.');

        const deactivated = await apiRequest(`/contact-methods/${methodId}/deactivate`, 'POST', undefined);
    actionOrder.push(deactivated.requestId);
    assert(deactivated.response.status === 200 && deactivated.body.data.status === 'INACTIVO', 'Method deactivation failed.');

        const reactivated = await apiRequest(`/contact-methods/${methodId}/reactivate`, 'POST', undefined);
    actionOrder.push(reactivated.requestId);
    assert(reactivated.response.status === 200 && reactivated.body.data.status === 'ACTIVO', 'Method reactivation failed.');

    const feed = await apiRequest('/recent-activity?limit=20');
    assert(feed.response.status === 200 && Object.keys(feed.body).join(',') === 'data' && Array.isArray(feed.body.data), 'Recent activity response contract is invalid.');
    const items = feed.body.data;
    const expectedKeys = 'actor,category,context,entity,occurredAt,title,type';
    assert(items.every((item) => Object.keys(item).sort().join(',') === expectedKeys), 'Recent activity exposed request, audit, raw JSON, user, or other internal fields.');
    const forbidden = /^(request_?id|schema|table|operation|raw|before|after|user|usuario)$/i;
    assert(items.every((item) => Object.keys(item).every((key) => !forbidden.test(key))), 'Recent activity JSON exposed an internal audit or user field.');
    assert(items.every((item) => item.actor === null || (typeof item.actor === 'object' && Object.keys(item.actor).sort().join(',') === 'displayName,email,id')), 'Recent activity actor field has an incorrect shape.');

    const expected = [
      one(items, 'CONTACT_METHOD_REACTIVATED', names.methodUpdated),
      one(items, 'CONTACT_METHOD_DEACTIVATED', names.methodUpdated),
      one(items, 'CONTACT_METHOD_UPDATED', names.methodUpdated),
      one(items, 'CONTACT_METHOD_ADDED', names.methodOriginal),
      one(items, 'CONTACT_UPDATED', names.contactUpdated),
      one(items, 'CONTACT_CREATED', names.contactOriginal),
      one(items, 'PROVIDER_UPDATED', names.providerUpdated),
      one(items, 'PROVIDER_CREATED', names.providerOriginal)
    ];
    assert(expected.slice(0, 6).every((item) => item.context === names.providerUpdated), 'Contact activity did not include the correct company context.');
    assert(expected.slice(6).every((item) => item.context === null), 'Provider activity unexpectedly included company context.');
    assert(expected.slice(0, 6).every((item) => item.category === 'CONTACT'), 'Contact activity has an incorrect category.');
    assert(expected.slice(6).every((item) => item.category === 'PROVIDER'), 'Provider activity has an incorrect category.');
    // Scoped to the original Provider/Contact fixture names specifically (not a bare marker
    // substring match) because the Client scenarios below also create a marker-tagged Provider
    // fixture (names.clientFromProvider) to exercise "existing Provider gains CLIENTE".
    const providerContactNames = new Set([names.providerOriginal, names.providerUpdated, names.contactOriginal, names.contactUpdated, names.methodOriginal, names.methodUpdated]);
    assert(items.filter((item) => (item.category === 'PROVIDER' || item.category === 'CONTACT') && (providerContactNames.has(item.entity) || (item.context && providerContactNames.has(item.context)))).length === 8, 'Expected one visible event for each of the eight synthetic Provider/Contact endpoint requests.');
    assert(items.filter((item) => item.type === 'CONTACT_CREATED' && item.entity === names.contactOriginal).length === 1, 'Initial methods did not collapse into one CONTACT_CREATED event.');
    assert(!items.some((item) => item.type === 'CONTACT_METHOD_ADDED' && [names.initialEmail, names.initialPhone].includes(item.entity)), 'Initial contact methods leaked as standalone added events.');
    assert(!items.some((item) => [names.deleteValue, names.deleteContact, names.setupCompany].includes(item.entity)), 'DELETE-only fixture appeared in recent activity.');

    const indices = expected.map((item) => items.indexOf(item));
    assert(indices.every((index, position) => index >= 0 && (position === 0 || index > indices[position - 1])), 'Synthetic activity is not in descending business-request order.');
    assert(items.every((item, index) => index === 0 || new Date(items[index - 1].occurredAt).getTime() >= new Date(item.occurredAt).getTime()), 'Recent activity timestamps are not descending.');

    const providerFeed = await apiRequest('/recent-activity?limit=2&category=PROVIDER');
    assert(providerFeed.response.status === 200 && providerFeed.body.data.length === 2, 'Provider activity filter did not return the newest two matching events.');
    assert(providerFeed.body.data.every((item) => item.category === 'PROVIDER'), 'Provider activity filter returned another category.');
    assert(providerFeed.body.data.map((item) => item.entity).join(',') === `${names.providerUpdated},${names.providerOriginal}`, 'Provider activity filter was applied after the final limit or ordered incorrectly.');

    const contactFeed = await apiRequest('/recent-activity?limit=2&category=CONTACT');
    assert(contactFeed.response.status === 200 && contactFeed.body.data.length === 2, 'Contact activity filter did not return the newest two matching events.');
    assert(contactFeed.body.data.every((item) => item.category === 'CONTACT'), 'Contact activity filter returned another category.');
    assert(contactFeed.body.data[0].type === 'CONTACT_METHOD_REACTIVATED' && contactFeed.body.data[1].type === 'CONTACT_METHOD_DEACTIVATED', 'Contact activity filter returned the wrong matching order.');

    const automationFeed = await apiRequest('/recent-activity?limit=20&category=AUTOMATION');
    assert(automationFeed.response.status === 200 && automationFeed.body.data.length >= paymentEvents.length && automationFeed.body.data.length <= 20, 'Automation activity filter did not return a bounded feed containing the synthetic payment events.');
    assert(automationFeed.body.data.every((item) => item.category === 'AUTOMATION'), 'Automation activity filter returned another category.');
    assert(automationFeed.body.data.every((item, index) => index === 0 || new Date(automationFeed.body.data[index - 1].occurredAt).getTime() >= new Date(item.occurredAt).getTime()), 'Automation activity filter is not globally ordered by timestamp.');
    for (const expected of paymentEvents) {
      const matches = automationFeed.body.data.filter((item) => item.type === expected.type && item.entity === expected.entity && item.occurredAt === expected.occurredAt);
      assert(matches.length === 1, `Automation activity filter did not preserve synthetic payment event ${expected.type} at ${expected.occurredAt}.`);
    }

    // J: category=CLIENT filter -> returns Client activities only, covering the scenarios above.
    const clientFeed = await apiRequest('/recent-activity?limit=20&category=CLIENT');
    assert(clientFeed.response.status === 200 && Array.isArray(clientFeed.body.data), 'Client activity filter request failed.');
    const clientItems = clientFeed.body.data;
    assert(clientItems.every((item) => item.category === 'CLIENT'), 'Client activity filter returned another category.');
    assert(clientItems.every((item) => Object.keys(item).sort().join(',') === expectedKeys), 'Client activity exposed request, audit, raw JSON, user, or other internal fields.');

    one(clientItems, 'CLIENT_CREATED', names.clientNew); // A
    one(clientItems, 'CLIENT_CREATED', names.clientFromProvider); // B
    one(clientItems, 'CLIENT_UPDATED', names.clientUpdatedName); // C
    one(clientItems, 'CLIENT_UPDATED', names.clientForFiscal); // D (fiscal-only PATCH keeps the current commercial name)
    one(clientItems, 'CLIENT_DEACTIVATED', names.clientFromProvider); // E
    one(clientItems, 'CLIENT_REACTIVATED', names.clientFromProvider); // F
    one(clientItems, 'CLIENT_DEACTIVATED', names.clientFinalRole); // G
    assert(!clientItems.some((item) => item.entity === names.clientForAddress && item.type !== 'CLIENT_CREATED'), 'H: the generic address mutation leaked into Client activity.'); // H
    assert(!clientItems.some((item) => item.entity === names.clientForAlias && item.type !== 'CLIENT_CREATED'), 'I: the generic alias mutation leaked into Client activity.'); // I
    assert(!items.some((item) => item.category === 'CLIENT' && item.entity === names.clientForAddress && item.type !== 'CLIENT_CREATED'), 'H: the generic address mutation leaked into the unfiltered feed as Client activity.');
    assert(!items.some((item) => item.category === 'CLIENT' && item.entity === names.clientForAlias && item.type !== 'CLIENT_CREATED'), 'I: the generic alias mutation leaked into the unfiltered feed as Client activity.');

    const invalidCategory = await apiRequest('/recent-activity?limit=6&category=UNKNOWN');
    assert(invalidCategory.response.status === 400, 'Invalid recent activity category was not rejected.');

    const endpointAudit = await pool.query("SELECT request_id FROM audit.cambios WHERE origen = 'DAUBERT_HUB' AND request_id = ANY($1::text[]) GROUP BY request_id", [actionOrder]);
    assert(endpointAudit.rows.length === 8, 'Not all eight endpoint request IDs reached the audit log.');

    // --- Provider lifecycle + Contact lifecycle + Document Series scenarios (K-O) ---
    // Run last, using per-category feeds (never the unfiltered/limit-bounded `feed` above) so
    // these additional events cannot disturb the strict top-N ordering assertions already made.
    const lifecycleActionOrder = [];

    // K: single-role Provider deactivate/reactivate -> exactly one PROVIDER_DEACTIVATED/PROVIDER_REACTIVATED,
    // company status tracks the role (no other active role exists).
    const providerLifecycle = await apiRequest('/providers', 'POST', { commercialName: names.providerLifecycle, providerType: 'PROVEEDOR' });
    lifecycleActionOrder.push(providerLifecycle.requestId);
    assert(providerLifecycle.response.status === 201, 'Provider-lifecycle fixture create failed.');
    const providerLifecycleId = providerLifecycle.body.data.id;

    const providerLifecycleDeactivated = await apiRequest(`/providers/${providerLifecycleId}/deactivate`, 'POST', undefined);
    lifecycleActionOrder.push(providerLifecycleDeactivated.requestId);
    assert(providerLifecycleDeactivated.response.status === 200 && providerLifecycleDeactivated.body.data.status === 'INACTIVO', 'Single-role Provider deactivate did not deactivate the company.');

    const providerLifecycleReactivated = await apiRequest(`/providers/${providerLifecycleId}/reactivate`, 'POST', undefined);
    lifecycleActionOrder.push(providerLifecycleReactivated.requestId);
    assert(providerLifecycleReactivated.response.status === 200 && providerLifecycleReactivated.body.data.status === 'ACTIVO', 'Single-role Provider reactivate did not reactivate the company.');

    // L: multi-role Provider+Client deactivate -> role-scoped only, company (and CLIENTE role) stays ACTIVO.
    const providerMultiRole = await apiRequest('/providers', 'POST', { commercialName: names.providerMultiRole, providerType: 'PROVEEDOR' });
    lifecycleActionOrder.push(providerMultiRole.requestId);
    assert(providerMultiRole.response.status === 201, 'Provider-multi-role fixture create failed.');
    const providerMultiRoleId = providerMultiRole.body.data.id;

    const providerMultiRoleClientGain = await apiRequest('/clients', 'POST', { commercialName: names.providerMultiRole });
    lifecycleActionOrder.push(providerMultiRoleClientGain.requestId);
    assert(providerMultiRoleClientGain.response.status === 201 && providerMultiRoleClientGain.body.data.id === providerMultiRoleId, 'Provider fixture did not gain CLIENTE on the same company.');

    const providerMultiRoleDeactivated = await apiRequest(`/providers/${providerMultiRoleId}/deactivate`, 'POST', undefined);
    lifecycleActionOrder.push(providerMultiRoleDeactivated.requestId);
    assert(providerMultiRoleDeactivated.response.status === 200, 'Multi-role Provider deactivate failed.');
    assert(providerMultiRoleDeactivated.body.data.status === 'INACTIVO', 'Multi-role Provider detail did not expose the inactive provider-role lifecycle.');
    assert(!providerMultiRoleDeactivated.body.data.roles.includes('PROVEEDOR') && providerMultiRoleDeactivated.body.data.roles.includes('CLIENTE'), 'Multi-role Provider deactivate did not leave the role set correctly scoped.');
    const providerMultiRoleState = await pool.query("SELECT e.estatus AS company_status, p.estatus AS provider_status, c.estatus AS client_status FROM core.empresas e JOIN core.empresa_roles p ON p.empresa_id = e.empresa_id AND p.rol = 'PROVEEDOR' JOIN core.empresa_roles c ON c.empresa_id = e.empresa_id AND c.rol = 'CLIENTE' WHERE e.empresa_id = $1", [providerMultiRoleId]);
    assert(providerMultiRoleState.rows[0].company_status === 'ACTIVO' && providerMultiRoleState.rows[0].provider_status === 'INACTIVO' && providerMultiRoleState.rows[0].client_status === 'ACTIVO', 'Multi-role Provider deactivate did not preserve the company and CLIENTE lifecycle.');

    const providerMultiRoleReactivated = await apiRequest(`/providers/${providerMultiRoleId}/reactivate`, 'POST', undefined);
    lifecycleActionOrder.push(providerMultiRoleReactivated.requestId);
    assert(providerMultiRoleReactivated.response.status === 200 && providerMultiRoleReactivated.body.data.roles.includes('PROVEEDOR'), 'Multi-role Provider reactivate failed.');

    // M: Contact lifecycle deactivate/reactivate -> CONTACT_DEACTIVATED/CONTACT_REACTIVATED,
    // never CONTACT_UPDATED for the pure status transition.
    const contactLifecycleCompany = await apiRequest('/clients', 'POST', { commercialName: names.contactLifecycleCompany });
    lifecycleActionOrder.push(contactLifecycleCompany.requestId);
    assert(contactLifecycleCompany.response.status === 201, 'Contact-lifecycle company fixture create failed.');
    const contactLifecycleCompanyId = contactLifecycleCompany.body.data.id;

    const contactLifecycleContact = await apiRequest('/contacts', 'POST', { companyId: contactLifecycleCompanyId, contactType: 'PERSONA', name: names.contactLifecycle, methods: [{ type: 'CORREO', value: `contact-lifecycle.${markerLower}@example.test` }] });
    lifecycleActionOrder.push(contactLifecycleContact.requestId);
    assert(contactLifecycleContact.response.status === 201, 'Contact-lifecycle fixture create failed.');
    const contactLifecycleId = contactLifecycleContact.body.data.id;

    const contactLifecycleDeactivated = await apiRequest(`/contacts/${contactLifecycleId}/deactivate`, 'POST', undefined);
    lifecycleActionOrder.push(contactLifecycleDeactivated.requestId);
    assert(contactLifecycleDeactivated.response.status === 200 && contactLifecycleDeactivated.body.data.status === 'INACTIVO', 'Contact lifecycle deactivate failed.');

    const contactLifecycleReactivated = await apiRequest(`/contacts/${contactLifecycleId}/reactivate`, 'POST', undefined);
    lifecycleActionOrder.push(contactLifecycleReactivated.requestId);
    assert(contactLifecycleReactivated.response.status === 200 && contactLifecycleReactivated.body.data.status === 'ACTIVO', 'Contact lifecycle reactivate failed.');

    // N: Document Series folio adjustment -> exactly one DOCUMENT_SERIES_ADJUSTED with before/after
    // folio context and the real actor (attributed, not fabricated).
    await transaction(pool, 'DAUBERT_HUB_TEST', setupRequestId, (client) => client.query(
      'INSERT INTO ops.automatizaciones (codigo, nombre, descripcion, estatus) VALUES ($1, $2, $3, $4)',
      [names.seriesAutomationCode, 'Temporary activity automation', 'Recent activity integration test only', 'ACTIVA']
    ));
    await transaction(pool, 'DAUBERT_HUB_TEST', setupRequestId, (client) => client.query(
      'INSERT INTO operacion.series_documentales (codigo, nombre, siguiente_folio, estatus) VALUES ($1, $2, $3, $4)',
      [names.seriesCode, names.seriesName, 951, 'ACTIVA']
    ));
    const seriesAdjustment = await apiRequest(`/automations/${names.seriesAutomationCode}/document-series/${names.seriesCode}`, 'PATCH', { nextFolio: 960, reason: `${marker}_FOLIO_ADJUSTMENT` });
    lifecycleActionOrder.push(seriesAdjustment.requestId);
    assert(seriesAdjustment.response.status === 200 && seriesAdjustment.body.data.series.nextFolio === 960, 'Document series folio adjustment failed.');

    // Category-scoped feeds: each of these newly created events is the newest in its own
    // category, so a generous per-category limit guarantees it appears regardless of how many
    // older events exist in OTHER categories (unlike the unfiltered feed above).
    const providerLifecycleFeed = await apiRequest('/recent-activity?limit=20&category=PROVIDER');
    const contactLifecycleFeed = await apiRequest('/recent-activity?limit=20&category=CONTACT');
    const automationLifecycleFeed = await apiRequest('/recent-activity?limit=20&category=AUTOMATION');
    assert(providerLifecycleFeed.response.status === 200 && contactLifecycleFeed.response.status === 200 && automationLifecycleFeed.response.status === 200, 'Could not load the lifecycle/document-series category feeds.');
    const providerLifecycleItems = providerLifecycleFeed.body.data;
    const contactLifecycleItems = contactLifecycleFeed.body.data;
    const automationLifecycleItems = automationLifecycleFeed.body.data;

    const providerDeactivated = one(providerLifecycleItems, 'PROVIDER_DEACTIVATED', names.providerLifecycle);
    const providerReactivated = one(providerLifecycleItems, 'PROVIDER_REACTIVATED', names.providerLifecycle);
    assert(providerDeactivated.category === 'PROVIDER' && providerReactivated.category === 'PROVIDER', 'Provider lifecycle activity has an incorrect category.');
    one(providerLifecycleItems, 'PROVIDER_DEACTIVATED', names.providerMultiRole);
    one(providerLifecycleItems, 'PROVIDER_REACTIVATED', names.providerMultiRole);
    assert(!providerLifecycleItems.some((item) => item.entity === names.providerMultiRole && item.type === 'CLIENT_DEACTIVATED'), 'Multi-role Provider deactivate incorrectly produced Client lifecycle activity.');

    const contactDeactivated = one(contactLifecycleItems, 'CONTACT_DEACTIVATED', names.contactLifecycle);
    const contactReactivated = one(contactLifecycleItems, 'CONTACT_REACTIVATED', names.contactLifecycle);
    assert(contactDeactivated.category === 'CONTACT' && contactReactivated.category === 'CONTACT', 'Contact lifecycle activity has an incorrect category.');
    assert(!contactLifecycleItems.some((item) => item.entity === names.contactLifecycle && item.type === 'CONTACT_UPDATED'), 'Pure Contact status transition leaked into CONTACT_UPDATED.');

    const seriesActivity = one(automationLifecycleItems, 'DOCUMENT_SERIES_ADJUSTED', names.seriesName);
    assert(seriesActivity.category === 'AUTOMATION' && seriesActivity.title === 'Folio ajustado', 'Document series activity has incorrect business fields.');
    assert(seriesActivity.context === '951 → 960', `Document series activity context was "${seriesActivity.context}", expected "951 → 960".`);
    assert(seriesActivity.actor && seriesActivity.actor.email === authSession.email, 'Document series activity did not attribute the real actor by email.');
    assert(seriesActivity.actor.displayName === `${authSession.marker} display`, 'Document series activity actor display name was not enriched from security.users.');

    // O: actor attribution on ordinary audit-derived activity (not fabricated, enriched from security.users).
    const contactCreatedActor = one(contactLifecycleItems, 'CONTACT_CREATED', names.contactOriginal).actor;
    assert(contactCreatedActor && contactCreatedActor.email === authSession.email, 'Audit-derived activity did not attribute the authenticated actor by email.');
    assert(contactCreatedActor.displayName === `${authSession.marker} display`, 'Audit-derived activity actor display name was not enriched from security.users.');
    assert(typeof contactCreatedActor.id === 'string' && contactCreatedActor.id === String(authSession.userId), 'Audit-derived activity actor id was not the BIGINT-as-string user id.');
    const automationActorCheck = automationLifecycleItems.find((item) => item.entity === 'Notificaciones de pago');
    assert(automationActorCheck && automationActorCheck.actor === null, 'System/automation activity with no human actor must report actor=null, not omit or fabricate one.');

    const lifecycleEndpointAudit = await pool.query("SELECT request_id FROM audit.cambios WHERE origen = 'DAUBERT_HUB' AND request_id = ANY($1::text[]) GROUP BY request_id", [lifecycleActionOrder.filter((id) => id !== seriesAdjustment.requestId)]);
    assert(lifecycleEndpointAudit.rows.length === lifecycleActionOrder.length - 1, `Not all lifecycle scenario request IDs reached the audit log (expected ${lifecycleActionOrder.length - 1}, got ${lifecycleEndpointAudit.rows.length}).`);

    console.log('Recent activity integration checks passed, including synthetic FAILED and PARTIAL ERROR payment executions.');
  } finally {
    try {
      if (databaseVerified) {
        await cleanup(pool, names, paymentFixtures);
        console.log('Recent activity integration cleanup verified.');
      }
    } finally {
      if (api && api.exitCode === null && api.signalCode === null) {
        api.kill();
        await once(api, 'exit');
      }
      await cleanupAuthenticatedTestSession(authSession);
      await pool.end();
    }
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
