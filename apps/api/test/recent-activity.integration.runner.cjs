const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { Pool } = require('pg');

const port = 3105;
const marker = `HUB_TEST_ACTIVITY_${randomUUID().replace(/-/g, '').toUpperCase()}`;
const markerLower = marker.toLowerCase();
const setupRequestId = `activity-setup-${randomUUID()}`;
const deleteRequestId = `activity-delete-${randomUUID()}`;
const cleanupRequestId = `activity-cleanup-${randomUUID()}`;
const requestIds = new Set([setupRequestId, deleteRequestId, cleanupRequestId]);

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

async function cleanup(pool, names) {
  let cleanupError;
  try {
    await transaction(pool, 'DAUBERT_HUB_TEST_CLEANUP', cleanupRequestId, async (client) => {
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
    assert(Number(coreLeftovers.rows[0].count) === 0, 'Recent activity cleanup left core marker fixtures.');
    assert(auditLeftovers.rows[0].count === 0, 'Recent activity cleanup left correlated audit rows.');
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
    methodUpdated: `standalone.updated.${markerLower}@example.test`
  };

  try {
    const currentDatabase = (await pool.query('SELECT current_database() AS name')).rows[0].name;
    assert(currentDatabase === 'daubert_hub_test', `Active session database mismatch: ${currentDatabase}`);
    databaseVerified = true;

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
    const expectedKeys = 'context,entity,occurredAt,title,type';
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
    assert(items.filter((item) => item.entity.includes(marker) || item.context?.includes(marker)).length === 8, 'Expected one visible event for each of the eight synthetic endpoint requests.');
    assert(items.filter((item) => item.type === 'CONTACT_CREATED' && item.entity === names.contactOriginal).length === 1, 'Initial methods did not collapse into one CONTACT_CREATED event.');
    assert(!items.some((item) => item.type === 'CONTACT_METHOD_ADDED' && [names.initialEmail, names.initialPhone].includes(item.entity)), 'Initial contact methods leaked as standalone added events.');
    assert(!items.some((item) => [names.deleteValue, names.deleteContact, names.setupCompany].includes(item.entity)), 'DELETE-only fixture appeared in recent activity.');

    const indices = expected.map((item) => items.indexOf(item));
    assert(indices.every((index, position) => index >= 0 && (position === 0 || index > indices[position - 1])), 'Synthetic activity is not in descending business-request order.');
    assert(items.every((item, index) => index === 0 || new Date(items[index - 1].occurredAt).getTime() >= new Date(item.occurredAt).getTime()), 'Recent activity timestamps are not descending.');

    const endpointAudit = await pool.query("SELECT request_id FROM audit.cambios WHERE origen = 'DAUBERT_HUB' AND request_id = ANY($1::text[]) GROUP BY request_id", [actionOrder]);
    assert(endpointAudit.rows.length === 8, 'Not all eight endpoint request IDs reached the audit log.');
    console.log('Recent activity integration checks passed.');
  } finally {
    try {
      if (databaseVerified) {
        await cleanup(pool, names);
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
