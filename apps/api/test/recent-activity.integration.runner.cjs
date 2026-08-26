const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { Pool } = require('pg');

const port = 3105;
const marker = `HUB_TEST_ACTIVITY_${randomUUID().replace(/-/g, '').toUpperCase()}`;
const markerLower = marker.toLowerCase();
const setupRequestId = `activity-setup-${randomUUID()}`;
const deleteRequestId = `activity-delete-${randomUUID()}`;
const paymentRequestId = `activity-payment-${randomUUID()}`;
const cleanupRequestId = `activity-cleanup-${randomUUID()}`;
const requestIds = new Set([setupRequestId, deleteRequestId, paymentRequestId, cleanupRequestId]);

function assert(condition, message) { if (!condition) throw new Error(message); }

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

async function apiRequest(path, method = 'GET', payload, requestId) {
  const headers = {};
  if (payload !== undefined) headers['content-type'] = 'application/json';
  if (requestId) headers['x-request-id'] = requestId;
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method, headers, body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  return { response, body: await response.json() };
}

function nextRequestId(label) {
  const id = `activity-${label}-${randomUUID()}`;
  requestIds.add(id);
  return id;
}

function one(items, type, entity) {
  const matches = items.filter((item) => item.type === type && item.entity === entity);
  assert(matches.length === 1, `Expected exactly one ${type} event for ${entity}.`);
  return matches[0];
}

async function cleanup(pool, names, paymentFixtures) {
  let cleanupError;
  try {
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
        'SELECT empresa_id::text AS id FROM core.empresas WHERE nombre_comercial = ANY($1::text[])',
        [[names.setupCompany, names.providerOriginal, names.providerUpdated]]
      );
      const companyIds = companies.rows.map((row) => row.id);
      if (companyIds.length) {
        await client.query('DELETE FROM core.medios_contacto WHERE contacto_id IN (SELECT contacto_id FROM core.contactos WHERE empresa_id = ANY($1::bigint[]))', [companyIds]);
        await client.query('DELETE FROM core.contactos WHERE empresa_id = ANY($1::bigint[])', [companyIds]);
        await client.query('DELETE FROM core.empresas_fiscales WHERE empresa_id = ANY($1::bigint[])', [companyIds]);
        await client.query('DELETE FROM core.empresa_roles WHERE empresa_id = ANY($1::bigint[])', [companyIds]);
        await client.query('DELETE FROM core.empresas WHERE empresa_id = ANY($1::bigint[])', [companyIds]);
      }
    });
  } catch (error) {
    cleanupError = error;
  }
  try {
    await pool.query('DELETE FROM audit.cambios WHERE request_id = ANY($1::text[])', [[...requestIds]]);
    const coreLeftovers = await pool.query(`
      SELECT
        (SELECT count(*) FROM core.empresas WHERE nombre_comercial LIKE $1) +
        (SELECT count(*) FROM core.contactos WHERE nombre LIKE $1) +
        (SELECT count(*) FROM core.medios_contacto WHERE lower(valor) LIKE $2) AS count`, [`${marker}%`, `%${markerLower}%`]);
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
    assert(Number(coreLeftovers.rows[0].count) === 0, 'Recent activity cleanup left core marker fixtures.');
    assert(auditLeftovers.rows[0].count === 0, 'Recent activity cleanup left correlated audit rows.');
    assert(Number(paymentLeftovers.rows[0].correo_count) === 0 && Number(paymentLeftovers.rows[0].result_count) === 0, 'Recent activity cleanup left synthetic payment fixtures.');
    assert(paymentExample.rows.length === 1 && paymentExample.rows[0].result_count === 5 && paymentExample.rows[0].ready_count === 4 && paymentExample.rows[0].manual_count === 1 && paymentExample.rows[0].error_count === 0, 'Cleanup changed the existing correo 32 example.');
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
      assert(Object.keys(activity).sort().join(',') === 'category,context,entity,occurredAt,title,type', `${expected.type} payment activity exposed unsupported fields.`);
      return activity;
    });
    assert(!/correo_id|outlook|remitente|destinatario|detalle_error/i.test(JSON.stringify(paymentEvents)), 'Payment notification activity exposed sensitive notification data.');

    const actionOrder = [];
    const providerCreateId = nextRequestId('provider-create'); actionOrder.push(providerCreateId);
    const provider = await apiRequest('/providers', 'POST', { commercialName: names.providerOriginal, providerType: 'PROVEEDOR' }, providerCreateId);
    assert(provider.response.status === 201, `Provider create failed with ${provider.response.status}.`);
    const companyId = provider.body.data.id;

    const providerUpdateId = nextRequestId('provider-update'); actionOrder.push(providerUpdateId);
    const providerUpdated = await apiRequest(`/providers/${companyId}`, 'PATCH', { commercialName: names.providerUpdated }, providerUpdateId);
    assert(providerUpdated.response.status === 200 && providerUpdated.body.data.commercialName === names.providerUpdated, 'Provider update failed.');

    const contactCreateId = nextRequestId('contact-create'); actionOrder.push(contactCreateId);
    const contact = await apiRequest('/contacts', 'POST', {
      companyId, contactType: 'PERSONA', name: names.contactOriginal,
      methods: [{ type: 'CORREO', value: names.initialEmail }, { type: 'TELEFONO', value: names.initialPhone }]
    }, contactCreateId);
    assert(contact.response.status === 201 && contact.body.data.methods.length === 2, 'Contact create with multiple initial methods failed.');
    const contactId = contact.body.data.id;

    const contactUpdateId = nextRequestId('contact-update'); actionOrder.push(contactUpdateId);
    const contactUpdated = await apiRequest(`/contacts/${contactId}`, 'PATCH', { name: names.contactUpdated }, contactUpdateId);
    assert(contactUpdated.response.status === 200 && contactUpdated.body.data.name === names.contactUpdated, 'Contact update failed.');

    const methodAddId = nextRequestId('method-add'); actionOrder.push(methodAddId);
    const method = await apiRequest(`/contacts/${contactId}/methods`, 'POST', { type: 'CORREO', value: names.methodOriginal }, methodAddId);
    assert(method.response.status === 201, 'Standalone method add failed.');
    const methodId = method.body.data.id;

    const methodEditId = nextRequestId('method-edit'); actionOrder.push(methodEditId);
    const editedMethod = await apiRequest(`/contact-methods/${methodId}`, 'PATCH', { value: names.methodUpdated }, methodEditId);
    assert(editedMethod.response.status === 200 && editedMethod.body.data.value === names.methodUpdated, 'Method edit failed.');

    const deactivateId = nextRequestId('method-deactivate'); actionOrder.push(deactivateId);
    const deactivated = await apiRequest(`/contact-methods/${methodId}/deactivate`, 'POST', undefined, deactivateId);
    assert(deactivated.response.status === 200 && deactivated.body.data.status === 'INACTIVO', 'Method deactivation failed.');

    const reactivateId = nextRequestId('method-reactivate'); actionOrder.push(reactivateId);
    const reactivated = await apiRequest(`/contact-methods/${methodId}/reactivate`, 'POST', undefined, reactivateId);
    assert(reactivated.response.status === 200 && reactivated.body.data.status === 'ACTIVO', 'Method reactivation failed.');

    const feed = await apiRequest('/recent-activity?limit=20');
    assert(feed.response.status === 200 && Object.keys(feed.body).join(',') === 'data' && Array.isArray(feed.body.data), 'Recent activity response contract is invalid.');
    const items = feed.body.data;
    const expectedKeys = 'category,context,entity,occurredAt,title,type';
    assert(items.every((item) => Object.keys(item).sort().join(',') === expectedKeys), 'Recent activity exposed request, audit, raw JSON, user, or other internal fields.');
    const forbidden = /^(request_?id|schema|table|operation|raw|before|after|user|usuario)$/i;
    assert(items.every((item) => Object.keys(item).every((key) => !forbidden.test(key))), 'Recent activity JSON exposed an internal audit or user field.');

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
    assert(items.filter((item) => item.entity.includes(marker) || item.context?.includes(marker)).length === 8, 'Expected one visible event for each of the eight synthetic endpoint requests.');
    assert(items.filter((item) => item.type === 'CONTACT_CREATED' && item.entity === names.contactOriginal).length === 1, 'Initial methods did not collapse into one CONTACT_CREATED event.');
    assert(!items.some((item) => item.type === 'CONTACT_METHOD_ADDED' && [names.initialEmail, names.initialPhone].includes(item.entity)), 'Initial contact methods leaked as standalone added events.');
    assert(!items.some((item) => [names.deleteValue, names.deleteContact, names.setupCompany].includes(item.entity)), 'DELETE-only fixture appeared in recent activity.');

    const indices = expected.map((item) => items.indexOf(item));
    assert(indices.every((index, position) => index >= 0 && (position === 0 || index > indices[position - 1])), 'Synthetic activity is not in descending business-request order.');
    assert(items.every((item, index) => index === 0 || new Date(items[index - 1].occurredAt).getTime() >= new Date(item.occurredAt).getTime()), 'Recent activity timestamps are not descending.');

    const endpointAudit = await pool.query("SELECT request_id FROM audit.cambios WHERE origen = 'DAUBERT_HUB' AND request_id = ANY($1::text[]) GROUP BY request_id", [actionOrder]);
    assert(endpointAudit.rows.length === 8, 'Not all eight endpoint request IDs reached the audit log.');
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
      await pool.end();
    }
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
