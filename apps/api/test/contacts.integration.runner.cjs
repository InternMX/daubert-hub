const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { Pool } = require('pg');

const port = 3103;
const marker = `HUB_TEST_CONTACT_${randomUUID().replace(/-/g, '').toUpperCase()}`;
const setupRequestId = `contact-setup-${randomUUID()}`;
const cleanupRequestId = `contact-cleanup-${randomUUID()}`;
const requestIds = new Set([setupRequestId, cleanupRequestId]);
const companyIds = new Set();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseTestDatabaseUrl(connectionString) {
  if (!connectionString) throw new Error('TEST_DATABASE_URL must be set for database integration tests.');
  const url = new URL(connectionString);
  const databaseName = decodeURIComponent(url.pathname).replace(/^\//, '');
  if (databaseName !== 'daubert_hub_test') {
    throw new Error(`Refusing database integration tests against "${databaseName || '(missing)'}". Expected "daubert_hub_test".`);
  }
  return { url, databaseName };
}

async function waitForApi() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return;
    } catch {
      // The process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for the API integration server.');
}

async function postContact(payload, requestId) {
  const response = await fetch(`http://127.0.0.1:${port}/api/contacts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
    body: JSON.stringify(payload)
  });
  return { response, body: await response.json() };
}

async function patchContact(id, payload, requestId) {
  const response = await fetch(`http://127.0.0.1:${port}/api/contacts/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
    body: JSON.stringify(payload)
  });
  return { response, body: await response.json() };
}

async function addContactMethod(id, payload, requestId) {
  const response = await fetch(`http://127.0.0.1:${port}/api/contacts/${id}/methods`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
    body: JSON.stringify(payload)
  });
  return { response, body: await response.json() };
}

async function patchContactMethod(id, payload, requestId) {
  const response = await fetch(`http://127.0.0.1:${port}/api/contact-methods/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
    body: JSON.stringify(payload)
  });
  return { response, body: await response.json() };
}

async function changeMethodStatus(id, action, requestId) {
  const response = await fetch(`http://127.0.0.1:${port}/api/contact-methods/${id}/${action}`, {
    method: 'POST', headers: { 'x-request-id': requestId }
  });
  return { response, body: await response.json() };
}

async function changeContactStatus(id, action, requestId) {
  const response = await fetch(`http://127.0.0.1:${port}/api/contacts/${id}/${action}`, {
    method: 'POST', headers: { 'x-request-id': requestId }
  });
  return { response, body: await response.json() };
}

async function getContactDirectoryList(search) {
  const query = new URLSearchParams({ search, page: '1', pageSize: '20' });
  const response = await fetch(`http://127.0.0.1:${port}/api/contact-directory/companies?${query}`);
  return { response, body: await response.json() };
}

async function getContactDirectory(id) {
  const response = await fetch(`http://127.0.0.1:${port}/api/contact-directory/companies/${id}`);
  return { response, body: await response.json() };
}

async function queryWithAuditContext(pool, requestId, text, values) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB_TEST']);
    await client.query("SELECT set_config('app.request_id', $1, true)", [requestId]);
    const result = await client.query(text, values);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createCompany(pool, suffix, status) {
  const result = await queryWithAuditContext(pool, setupRequestId,
    'INSERT INTO core.empresas (tipo_empresa, nombre_comercial, estatus) VALUES ($1, $2, $3) RETURNING empresa_id::text',
    ['OTRO', `${marker}_${suffix}`, status]);
  const id = result.rows[0].empresa_id;
  companyIds.add(id);
  return id;
}

async function createDirectContact(pool, companyId, suffix, status) {
  const result = await queryWithAuditContext(pool, setupRequestId,
    `INSERT INTO core.contactos (empresa_id, tipo_contacto, nombre, area, cargo, observaciones, estatus, es_contacto_principal)
     VALUES ($1, 'PERSONA', $2, 'Integration', 'Synthetic Contact', 'method safety fixture', $3, FALSE)
     RETURNING contacto_id::text`, [companyId, `${marker}_${suffix}`, status]);
  return result.rows[0].contacto_id;
}

async function run() {
  const { url, databaseName } = parseTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let api;
  let databaseVerified = false;
  try {
    const currentDatabase = (await pool.query('SELECT current_database() AS name')).rows[0].name;
    assert(currentDatabase === 'daubert_hub_test', `Active session database mismatch: ${currentDatabase}`);
    databaseVerified = true;
    console.log(`Contact integration database verified: ${databaseName}`);

    const auditColumns = new Set((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'audit' AND table_name = 'cambios'")).rows.map((row) => row.column_name));
    const auditOriginColumn = ['origin', 'origen'].find((column) => auditColumns.has(column));
    const auditTableColumn = ['table_name', 'tabla'].find((column) => auditColumns.has(column));
    const auditSchemaColumn = ['table_schema', 'esquema'].find((column) => auditColumns.has(column));
    const auditOperationColumn = ['operation', 'operacion', 'action', 'accion'].find((column) => auditColumns.has(column));
    assert(auditOriginColumn && auditTableColumn && auditSchemaColumn && auditOperationColumn && auditColumns.has('request_id'), 'audit.cambios is missing required contact audit columns.');

    api = spawn(process.execPath, ['dist/src/main.js'], {
      cwd: process.cwd(),
      env: { ...process.env, DB_HOST: url.hostname, DB_PORT: url.port || '5432', DB_NAME: databaseName, DB_USER: decodeURIComponent(url.username), DB_PASSWORD: decodeURIComponent(url.password), API_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let startupOutput = '';
    api.stdout.on('data', (chunk) => { startupOutput += chunk; });
    api.stderr.on('data', (chunk) => { startupOutput += chunk; });
    await waitForApi();

    const activeCompanyId = await createCompany(pool, 'ACTIVE', 'ACTIVO');
    const inactiveCompanyId = await createCompany(pool, 'INACTIVE', 'INACTIVO');
    const blockedCompanyId = await createCompany(pool, 'BLOCKED', 'BLOQUEADO');

    const addMethodFixtureRequestId = `method-add-fixture-${randomUUID()}`;
    requestIds.add(addMethodFixtureRequestId);
    const originalEmail = `original.${marker.toLowerCase()}@example.test`;
    const originalPhone = '+52 449 555 0200';
    const originalInactivePhone = '+52 449 555 0201';
    const addMethodFixture = await postContact({
      companyId: activeCompanyId,
      contactType: 'PERSONA',
      name: `${marker} METHOD ADD`,
      area: 'Compras',
      position: 'Compradora',
      notes: 'add method fixture',
      methods: [
        { type: 'CORREO', value: originalEmail },
        { type: 'TELEFONO', value: originalPhone },
        { type: 'TELEFONO', value: originalInactivePhone }
      ]
    }, addMethodFixtureRequestId);
    assert(addMethodFixture.response.status === 201, `Add-method fixture creation failed: ${JSON.stringify(addMethodFixture.body)}`);
    const addMethodContactId = addMethodFixture.body.data.id;
    const originalInactiveMethodId = addMethodFixture.body.data.methods[2].id;
    const fixtureDeactivateRequestId = `method-add-fixture-deactivate-${randomUUID()}`;
    requestIds.add(fixtureDeactivateRequestId);
    const fixtureDeactivated = await changeMethodStatus(originalInactiveMethodId, 'deactivate', fixtureDeactivateRequestId);
    assert(fixtureDeactivated.response.status === 200, `Add-method inactive fixture setup failed: ${JSON.stringify(fixtureDeactivated.body)}`);

    const contactBeforeMethodAdds = (await pool.query('SELECT contacto_id::text, empresa_id::text, tipo_contacto, nombre, area, cargo, observaciones, estatus, es_contacto_principal FROM core.contactos WHERE contacto_id = $1', [addMethodContactId])).rows[0];
    const companyBeforeMethodAdds = (await pool.query('SELECT empresa_id::text, tipo_empresa, nombre_comercial, estatus FROM core.empresas WHERE empresa_id = $1', [activeCompanyId])).rows[0];
    const methodsBeforeAdds = await pool.query('SELECT medio_id::text, contacto_id::text, tipo_medio, valor, estatus, es_principal, recibe_notificacion_pago, tipo_destinatario_pago FROM core.medios_contacto WHERE contacto_id = $1 ORDER BY medio_id', [addMethodContactId]);
    assert(methodsBeforeAdds.rows.length === 3 && methodsBeforeAdds.rows.filter((method) => method.estatus === 'ACTIVO').length === 2 && methodsBeforeAdds.rows.filter((method) => method.estatus === 'INACTIVO').length === 1, 'Add-method fixture does not have two active methods and one inactive method.');

    const addedEmail = `second.${marker.toLowerCase()}@example.test`;
    const addedWebUrl = `https://portal.example.test/${marker.toLowerCase()}`;
    const additions = [
      { requestId: `method-add-email-${randomUUID()}`, payload: { type: 'CORREO', value: addedEmail } },
      { requestId: `method-add-phone-${randomUUID()}`, payload: { type: 'TELEFONO', value: '449 123 4567 ext. 204' } },
      { requestId: `method-add-whatsapp-${randomUUID()}`, payload: { type: 'WHATSAPP', value: '+52 449 555 0202' } },
      { requestId: `method-add-web-${randomUUID()}`, payload: { type: 'WEB', value: addedWebUrl } }
    ];
    const addedMethodIds = [];
    for (const addition of additions) {
      requestIds.add(addition.requestId);
      const added = await addContactMethod(addMethodContactId, addition.payload, addition.requestId);
      assert(added.response.status === 201, `Method ${addition.payload.type} creation failed: ${JSON.stringify(added.body)}`);
      assert(added.response.headers.get('x-request-id') === addition.requestId, `Method ${addition.payload.type} response did not preserve x-request-id.`);
      assert(typeof added.body.data.id === 'string' && added.body.data.type === addition.payload.type && added.body.data.value === addition.payload.value && added.body.data.status === 'ACTIVO', `Method ${addition.payload.type} response is inconsistent.`);
      assert(Object.keys(added.body.data).sort().join(',') === 'id,status,type,value', `Method ${addition.payload.type} response exposed fields outside the safe contract.`);
      addedMethodIds.push(added.body.data.id);
    }

    const methodsAfterAdds = await pool.query('SELECT medio_id::text, contacto_id::text, tipo_medio, valor, estatus, es_principal, recibe_notificacion_pago, tipo_destinatario_pago FROM core.medios_contacto WHERE contacto_id = $1 ORDER BY medio_id', [addMethodContactId]);
    const persistedAdditions = methodsAfterAdds.rows.filter((method) => addedMethodIds.includes(method.medio_id));
    assert(methodsAfterAdds.rows.length === 7 && persistedAdditions.length === 4, 'Method creation did not add exactly four rows.');
    assert(persistedAdditions.every((method) => method.estatus === 'ACTIVO' && method.es_principal === false && method.recibe_notificacion_pago === false && method.tipo_destinatario_pago === null), 'New methods did not persist explicit active/non-primary/non-payment values.');
    const addedWebMethod = persistedAdditions.find((method) => method.tipo_medio === 'WEB');
    assert(addedWebMethod && addedWebMethod.valor === addedWebUrl, 'WEB method did not persist its exact URL.');
    const originalMethodsAfterAdds = methodsAfterAdds.rows.filter((method) => !addedMethodIds.includes(method.medio_id));
    assert(JSON.stringify(originalMethodsAfterAdds) === JSON.stringify(methodsBeforeAdds.rows), 'Method creation changed an existing active or inactive method.');
    const contactAfterMethodAdds = (await pool.query('SELECT contacto_id::text, empresa_id::text, tipo_contacto, nombre, area, cargo, observaciones, estatus, es_contacto_principal FROM core.contactos WHERE contacto_id = $1', [addMethodContactId])).rows[0];
    const companyAfterMethodAdds = (await pool.query('SELECT empresa_id::text, tipo_empresa, nombre_comercial, estatus FROM core.empresas WHERE empresa_id = $1', [activeCompanyId])).rows[0];
    assert(JSON.stringify(contactAfterMethodAdds) === JSON.stringify(contactBeforeMethodAdds), 'Method creation changed contact data or lifecycle.');
    assert(JSON.stringify(companyAfterMethodAdds) === JSON.stringify(companyBeforeMethodAdds), 'Method creation changed company data or lifecycle.');

    const directoryAfterAdds = await getContactDirectory(activeCompanyId);
    const addedDirectoryContact = directoryAfterAdds.body.data.contacts.find((contact) => contact.id === addMethodContactId);
    assert(directoryAfterAdds.response.status === 200 && addedDirectoryContact && addedDirectoryContact.methods.length === 6 && addedDirectoryContact.inactiveMethods.length === 1, 'Directory did not return all active additions while preserving inactiveMethods.');
    assert(addedDirectoryContact.methods.filter((method) => method.type === 'CORREO').length === 2 && addedDirectoryContact.methods.filter((method) => method.type === 'TELEFONO').length === 2 && addedDirectoryContact.methods.filter((method) => method.type === 'WHATSAPP').length === 1 && addedDirectoryContact.methods.filter((method) => method.type === 'WEB' && method.value === addedWebUrl).length === 1, 'Directory collapsed existing method types or failed to return the exact WEB URL.');
    assert(addedDirectoryContact.inactiveMethods[0].id === originalInactiveMethodId, 'Directory changed the original inactive method.');

    for (const addition of additions) {
      const methodAudit = await pool.query(`SELECT ${auditSchemaColumn} AS schema_name, ${auditTableColumn} AS table_name, ${auditOperationColumn} AS operation, ${auditOriginColumn} AS origin, request_id FROM audit.cambios WHERE ${auditOriginColumn} = $1 AND request_id = $2`, ['DAUBERT_HUB', addition.requestId]);
      assert(methodAudit.rows.length === 1 && methodAudit.rows[0].schema_name === 'core' && methodAudit.rows[0].table_name === 'medios_contacto' && String(methodAudit.rows[0].operation).toUpperCase().includes('INSERT') && methodAudit.rows[0].origin === 'DAUBERT_HUB' && methodAudit.rows[0].request_id === addition.requestId, `Method ${addition.payload.type} audit event is inconsistent.`);
    }

    const editedWebUrl = `${addedWebUrl}/edited`;
    const webEditRequestId = `method-edit-web-${randomUUID()}`;
    requestIds.add(webEditRequestId);
    const editedWeb = await patchContactMethod(addedWebMethod.medio_id, { value: editedWebUrl }, webEditRequestId);
    assert(editedWeb.response.status === 200 && JSON.stringify(editedWeb.body) === JSON.stringify({ data: { id: addedWebMethod.medio_id, type: 'WEB', value: editedWebUrl, status: 'ACTIVO' } }), `WEB method edit did not return the exact updated URL: ${JSON.stringify(editedWeb.body)}`);
    const persistedEditedWeb = (await pool.query('SELECT tipo_medio, valor, estatus FROM core.medios_contacto WHERE medio_id = $1', [addedWebMethod.medio_id])).rows[0];
    assert(persistedEditedWeb && persistedEditedWeb.tipo_medio === 'WEB' && persistedEditedWeb.valor === editedWebUrl && persistedEditedWeb.estatus === 'ACTIVO', 'WEB method edit did not persist the exact updated URL.');

    const webDeactivateRequestId = `method-deactivate-web-${randomUUID()}`;
    requestIds.add(webDeactivateRequestId);
    const deactivatedWeb = await changeMethodStatus(addedWebMethod.medio_id, 'deactivate', webDeactivateRequestId);
    assert(deactivatedWeb.response.status === 200 && deactivatedWeb.body.data.type === 'WEB' && deactivatedWeb.body.data.value === editedWebUrl && deactivatedWeb.body.data.status === 'INACTIVO', `WEB method deactivation failed: ${JSON.stringify(deactivatedWeb.body)}`);
    const webReactivateRequestId = `method-reactivate-web-${randomUUID()}`;
    requestIds.add(webReactivateRequestId);
    const reactivatedWeb = await changeMethodStatus(addedWebMethod.medio_id, 'reactivate', webReactivateRequestId);
    assert(reactivatedWeb.response.status === 200 && reactivatedWeb.body.data.type === 'WEB' && reactivatedWeb.body.data.value === editedWebUrl && reactivatedWeb.body.data.status === 'ACTIVO', `WEB method reactivation failed: ${JSON.stringify(reactivatedWeb.body)}`);

    for (const [payload, label] of [[{ type: 'CORREO', value: addedEmail }, 'exact email'], [{ type: 'CORREO', value: addedEmail.toUpperCase() }, 'case-insensitive email'], [{ type: 'TELEFONO', value: '449 123 4567 ext. 204' }, 'exact phone']]) {
      const duplicate = await addContactMethod(addMethodContactId, payload, `method-add-duplicate-${randomUUID()}`);
      assert(duplicate.response.status === 409 && duplicate.body.code === 'CONTACT_METHOD_DUPLICATE', `${label} duplicate was not rejected safely.`);
    }
    const countAfterDuplicates = await pool.query('SELECT count(*)::int AS count FROM core.medios_contacto WHERE contacto_id = $1', [addMethodContactId]);
    assert(countAfterDuplicates.rows[0].count === 7, 'Duplicate method rejection inserted an extra row.');

    const crossContactCreateRequestId = `method-add-cross-contact-fixture-${randomUUID()}`;
    requestIds.add(crossContactCreateRequestId);
    const crossContact = await postContact({ companyId: activeCompanyId, contactType: 'PERSONA', name: `${marker} CROSS CONTACT`, methods: [{ type: 'TELEFONO', value: '+52 449 555 0299' }] }, crossContactCreateRequestId);
    assert(crossContact.response.status === 201, `Cross-contact fixture creation failed: ${JSON.stringify(crossContact.body)}`);
    const crossContactRequestId = `method-add-cross-contact-${randomUUID()}`;
    requestIds.add(crossContactRequestId);
    const crossContactAddition = await addContactMethod(crossContact.body.data.id, { type: 'CORREO', value: addedEmail.toUpperCase() }, crossContactRequestId);
    assert(crossContactAddition.response.status === 201, `Same value on a different contact was rejected: ${JSON.stringify(crossContactAddition.body)}`);

    const concurrentValue = '+52 449 555 0288';
    const concurrentRequestIds = [`method-add-concurrent-a-${randomUUID()}`, `method-add-concurrent-b-${randomUUID()}`];
    concurrentRequestIds.forEach((requestId) => requestIds.add(requestId));
    const concurrentAdds = await Promise.all(concurrentRequestIds.map((requestId) => addContactMethod(crossContact.body.data.id, { type: 'WHATSAPP', value: concurrentValue }, requestId)));
    assert(concurrentAdds.map(({ response }) => response.status).sort().join(',') === '201,409', `Concurrent equivalent requests were not serialized safely: ${concurrentAdds.map(({ response }) => response.status).join(',')}`);
    const concurrentRows = await pool.query('SELECT count(*)::int AS count FROM core.medios_contacto WHERE contacto_id = $1 AND tipo_medio = $2 AND valor = $3', [crossContact.body.data.id, 'WHATSAPP', concurrentValue]);
    assert(concurrentRows.rows[0].count === 1, 'Concurrent equivalent requests created duplicate method rows.');

    for (const [payload, label] of [[{ type: 'CORREO', value: ' ' }, 'blank'], [{ type: 'CORREO', value: 'not-an-email' }, 'invalid email'], [{ type: 'OTRO', value: 'legacy' }, 'OTRO'], [{ type: 'SMS', value: '449 123 4567' }, 'unsupported type']]) {
      const invalid = await addContactMethod(addMethodContactId, payload, `method-add-invalid-${randomUUID()}`);
      assert(invalid.response.status === 400, `${label} method payload was not rejected.`);
    }

    const unsafeContacts = [
      [await createDirectContact(pool, activeCompanyId, 'PENDING_CONTACT', 'PENDIENTE'), 'pending'],
      [await createDirectContact(pool, activeCompanyId, 'INACTIVE_CONTACT', 'INACTIVO'), 'inactive'],
      [await createDirectContact(pool, activeCompanyId, 'REJECTED_CONTACT', 'RECHAZADO'), 'rejected'],
      [await createDirectContact(pool, inactiveCompanyId, 'INACTIVE_COMPANY_CONTACT', 'ACTIVO'), 'inactive company'],
      [await createDirectContact(pool, blockedCompanyId, 'BLOCKED_COMPANY_CONTACT', 'ACTIVO'), 'blocked company']
    ];
    for (const [contactId, label] of unsafeContacts) {
      const rejected = await addContactMethod(contactId, { type: 'CORREO', value: `${label.replace(/ /g, '.')}.${marker.toLowerCase()}@example.test` }, `method-add-unsafe-${randomUUID()}`);
      assert(rejected.response.status === 409, `${label} did not reject method creation safely.`);
    }
    const missingContactMethod = await addContactMethod('999999999999999', { type: 'CORREO', value: `missing.${marker.toLowerCase()}@example.test` }, `method-add-missing-${randomUUID()}`);
    assert(missingContactMethod.response.status === 404, 'Nonexistent contact did not reject method creation safely.');

    const editFixtureRequestId = `method-edit-fixture-${randomUUID()}`;
    requestIds.add(editFixtureRequestId);
    const duplicateEmail = `duplicate.${marker.toLowerCase()}@example.test`;
    const editFixture = await postContact({
      companyId: activeCompanyId,
      contactType: 'PERSONA',
      name: `${marker} METHOD EDIT`,
      methods: [
        { type: 'CORREO', value: 'typo@example.test' },
        { type: 'TELEFONO', value: '+52 449 555 0301' },
        { type: 'WHATSAPP', value: '+52 449 555 0302' },
        { type: 'CORREO', value: duplicateEmail },
        { type: 'TELEFONO', value: '+52 449 555 0303' }
      ]
    }, editFixtureRequestId);
    assert(editFixture.response.status === 201, `Edit-method fixture creation failed: ${JSON.stringify(editFixture.body)}`);
    const editContactId = editFixture.body.data.id;
    const [activeEmailId, inactivePhoneId, changedTypeId, , activePhoneId] = editFixture.body.data.methods.map((item) => item.id);
    await queryWithAuditContext(pool, setupRequestId,
      `UPDATE core.medios_contacto SET es_principal = TRUE, recibe_notificacion_pago = TRUE,
       tipo_destinatario_pago = 'CC', observaciones = 'Preserve edit metadata' WHERE medio_id = $1`, [activeEmailId]);
    const editDeactivateRequestId = `method-edit-deactivate-${randomUUID()}`;
    requestIds.add(editDeactivateRequestId);
    const editDeactivated = await changeMethodStatus(inactivePhoneId, 'deactivate', editDeactivateRequestId);
    assert(editDeactivated.response.status === 200, `Edit-method inactive setup failed: ${JSON.stringify(editDeactivated.body)}`);

    const emailBeforeEdit = (await pool.query('SELECT medio_id::text, contacto_id::text, tipo_medio, valor, estatus, es_principal, recibe_notificacion_pago, tipo_destinatario_pago, observaciones FROM core.medios_contacto WHERE medio_id = $1', [activeEmailId])).rows[0];
    const emailEditRequestId = `method-edit-email-${randomUUID()}`;
    requestIds.add(emailEditRequestId);
    const correctedEmail = await patchContactMethod(activeEmailId, { value: 'corrected@example.test' }, emailEditRequestId);
    assert(correctedEmail.response.status === 200 && correctedEmail.response.headers.get('x-request-id') === emailEditRequestId, `Active email edit failed: ${JSON.stringify(correctedEmail.body)}`);
    assert(JSON.stringify(correctedEmail.body) === JSON.stringify({ data: { id: activeEmailId, type: 'CORREO', value: 'corrected@example.test', status: 'ACTIVO' } }), 'Method edit response did not expose exactly the safe updated representation with a string ID.');
    const emailAfterEdit = (await pool.query('SELECT medio_id::text, contacto_id::text, tipo_medio, valor, estatus, es_principal, recibe_notificacion_pago, tipo_destinatario_pago, observaciones FROM core.medios_contacto WHERE medio_id = $1', [activeEmailId])).rows[0];
    assert(emailAfterEdit.medio_id === emailBeforeEdit.medio_id && emailAfterEdit.contacto_id === emailBeforeEdit.contacto_id && emailAfterEdit.estatus === emailBeforeEdit.estatus && emailAfterEdit.es_principal === emailBeforeEdit.es_principal && emailAfterEdit.recibe_notificacion_pago === emailBeforeEdit.recibe_notificacion_pago && emailAfterEdit.tipo_destinatario_pago === emailBeforeEdit.tipo_destinatario_pago && emailAfterEdit.observaciones === emailBeforeEdit.observaciones, 'Email edit changed the ID, parent, status, principal, payment routing, or observations.');
    assert(emailAfterEdit.valor === 'corrected@example.test', 'Email edit did not persist the corrected value.');
    const methodEditAudit = await pool.query(`SELECT ${auditSchemaColumn} AS schema_name, ${auditTableColumn} AS table_name, ${auditOperationColumn} AS operation, ${auditOriginColumn} AS origin, request_id FROM audit.cambios WHERE ${auditOriginColumn} = $1 AND request_id = $2`, ['DAUBERT_HUB', emailEditRequestId]);
    assert(methodEditAudit.rows.length === 1 && methodEditAudit.rows[0].schema_name === 'core' && methodEditAudit.rows[0].table_name === 'medios_contacto' && String(methodEditAudit.rows[0].operation).toUpperCase().includes('UPDATE') && methodEditAudit.rows[0].origin === 'DAUBERT_HUB' && methodEditAudit.rows[0].request_id === emailEditRequestId, 'Method edit audit was not exactly one DAUBERT_HUB UPDATE with the HTTP request ID.');

    const inactiveValueRequestId = `method-edit-inactive-value-${randomUUID()}`;
    requestIds.add(inactiveValueRequestId);
    const inactiveValue = await patchContactMethod(inactivePhoneId, { value: '+52 449 555 0311 ext. 8' }, inactiveValueRequestId);
    assert(inactiveValue.response.status === 200 && inactiveValue.body.data.id === inactivePhoneId && inactiveValue.body.data.type === 'TELEFONO' && inactiveValue.body.data.status === 'INACTIVO', `Inactive method value edit failed: ${JSON.stringify(inactiveValue.body)}`);
    const inactiveTypeRequestId = `method-edit-inactive-type-${randomUUID()}`;
    requestIds.add(inactiveTypeRequestId);
    const inactiveType = await patchContactMethod(inactivePhoneId, { type: 'WHATSAPP' }, inactiveTypeRequestId);
    assert(inactiveType.response.status === 200 && inactiveType.body.data.type === 'WHATSAPP' && inactiveType.body.data.status === 'INACTIVO', `Inactive method type edit failed: ${JSON.stringify(inactiveType.body)}`);

    const whatsappValueRequestId = `method-edit-whatsapp-value-${randomUUID()}`;
    requestIds.add(whatsappValueRequestId);
    const whatsappValue = await patchContactMethod(changedTypeId, { value: '+52 449 555 0322' }, whatsappValueRequestId);
    assert(whatsappValue.response.status === 200 && whatsappValue.body.data.type === 'WHATSAPP', `WhatsApp value edit failed: ${JSON.stringify(whatsappValue.body)}`);
    const typeChangeRequestId = `method-edit-type-${randomUUID()}`;
    requestIds.add(typeChangeRequestId);
    const changedType = await patchContactMethod(changedTypeId, { type: 'TELEFONO' }, typeChangeRequestId);
    assert(changedType.response.status === 200 && changedType.body.data.id === changedTypeId && changedType.body.data.type === 'TELEFONO' && changedType.body.data.value === '+52 449 555 0322' && changedType.body.data.status === 'ACTIVO', `WHATSAPP to TELEFONO edit failed: ${JSON.stringify(changedType.body)}`);
    const phoneEditRequestId = `method-edit-phone-${randomUUID()}`;
    requestIds.add(phoneEditRequestId);
    const phoneEdit = await patchContactMethod(activePhoneId, { value: '+52 449 555 0333 x 9' }, phoneEditRequestId);
    assert(phoneEdit.response.status === 200 && phoneEdit.body.data.type === 'TELEFONO' && phoneEdit.body.data.value === '+52 449 555 0333 x 9', `Active phone edit failed: ${JSON.stringify(phoneEdit.body)}`);

    const ownValueRequestId = `method-edit-own-value-${randomUUID()}`;
    requestIds.add(ownValueRequestId);
    const ownValue = await patchContactMethod(activeEmailId, { value: 'corrected@example.test' }, ownValueRequestId);
    assert(ownValue.response.status === 200, `Method incorrectly conflicted with its own unchanged value: ${JSON.stringify(ownValue.body)}`);
    const methodCountBeforeDuplicates = (await pool.query('SELECT count(*)::int AS count FROM core.medios_contacto WHERE contacto_id = $1', [editContactId])).rows[0].count;
    for (const [methodId, payload, label] of [[activeEmailId, { value: duplicateEmail }, 'email duplicate'], [activeEmailId, { value: duplicateEmail.toUpperCase() }, 'case-insensitive email duplicate'], [activePhoneId, { value: '+52 449 555 0322' }, 'phone duplicate']]) {
      const duplicateEdit = await patchContactMethod(methodId, payload, `method-edit-duplicate-${randomUUID()}`);
      assert(duplicateEdit.response.status === 409 && duplicateEdit.body.code === 'CONTACT_METHOD_DUPLICATE', `${label} edit was not rejected safely.`);
    }
    const rowsAfterDuplicateEdits = await pool.query('SELECT medio_id::text, tipo_medio, valor FROM core.medios_contacto WHERE contacto_id = $1 ORDER BY medio_id', [editContactId]);
    assert(rowsAfterDuplicateEdits.rows.length === methodCountBeforeDuplicates, 'Duplicate edit created a replacement or duplicate row.');
    assert(rowsAfterDuplicateEdits.rows.find((row) => row.medio_id === activeEmailId).valor === 'corrected@example.test' && rowsAfterDuplicateEdits.rows.find((row) => row.medio_id === activePhoneId).valor === '+52 449 555 0333 x 9', 'Duplicate rejection changed the original method.');

    const concurrentEditMethodIds = [];
    for (const value of ['+52 449 555 0381', '+52 449 555 0382']) {
      const requestId = `method-edit-concurrent-fixture-${randomUUID()}`;
      requestIds.add(requestId);
      const createdMethod = await addContactMethod(editContactId, { type: 'TELEFONO', value }, requestId);
      assert(createdMethod.response.status === 201, `Concurrent edit fixture failed: ${JSON.stringify(createdMethod.body)}`);
      concurrentEditMethodIds.push(createdMethod.body.data.id);
    }
    const concurrentEditRequestIds = [`method-edit-concurrent-a-${randomUUID()}`, `method-edit-concurrent-b-${randomUUID()}`];
    concurrentEditRequestIds.forEach((requestId) => requestIds.add(requestId));
    const concurrentEdits = await Promise.all(concurrentEditMethodIds.map((methodId, index) => patchContactMethod(methodId, { value: '+52 449 555 0399' }, concurrentEditRequestIds[index])));
    assert(concurrentEdits.map(({ response }) => response.status).sort().join(',') === '200,409', `Concurrent equivalent edits were not serialized safely: ${concurrentEdits.map(({ response }) => response.status).join(',')}`);
    const concurrentEditRows = await pool.query('SELECT count(*)::int AS count FROM core.medios_contacto WHERE contacto_id = $1 AND tipo_medio = $2 AND valor = $3', [editContactId, 'TELEFONO', '+52 449 555 0399']);
    assert(concurrentEditRows.rows[0].count === 1, 'Concurrent equivalent edits created duplicate resulting methods.');

    const crossContactEditRequestId = `method-edit-cross-contact-${randomUUID()}`;
    requestIds.add(crossContactEditRequestId);
    const crossContactMethodId = crossContact.body.data.methods[0].id;
    const crossContactEdit = await patchContactMethod(crossContactMethodId, { value: '+52 449 555 0322' }, crossContactEditRequestId);
    assert(crossContactEdit.response.status === 200, `Same type/value on another contact was rejected: ${JSON.stringify(crossContactEdit.body)}`);

    for (const [methodId, payload, label] of [[activeEmailId, { value: ' ' }, 'blank'], [activeEmailId, { value: 'invalid-email' }, 'invalid email'], [activeEmailId, { type: 'TELEFONO' }, 'invalid final pair'], [activeEmailId, { type: 'OTRO' }, 'OTRO'], [activeEmailId, { type: 'SMS' }, 'unsupported type'], [activeEmailId, {}, 'empty PATCH']]) {
      const invalid = await patchContactMethod(methodId, payload, `method-edit-invalid-${randomUUID()}`);
      assert(invalid.response.status === 400, `${label} method edit was not rejected.`);
    }

    const unsafeEditMethods = [
      [await createDirectContact(pool, activeCompanyId, 'EDIT_INACTIVE_CONTACT', 'INACTIVO'), 'ACTIVO', 'inactive contact'],
      [await createDirectContact(pool, activeCompanyId, 'EDIT_PENDING_CONTACT', 'PENDIENTE'), 'ACTIVO', 'pending contact'],
      [await createDirectContact(pool, activeCompanyId, 'EDIT_REJECTED_CONTACT', 'RECHAZADO'), 'ACTIVO', 'rejected contact'],
      [await createDirectContact(pool, inactiveCompanyId, 'EDIT_INACTIVE_COMPANY', 'ACTIVO'), 'ACTIVO', 'inactive company'],
      [await createDirectContact(pool, blockedCompanyId, 'EDIT_BLOCKED_COMPANY', 'ACTIVO'), 'ACTIVO', 'blocked company'],
      [editContactId, 'PENDIENTE', 'pending method'],
      [editContactId, 'RECHAZADO', 'rejected method']
    ];
    for (const [contactId, status, label] of unsafeEditMethods) {
      const directMethod = await queryWithAuditContext(pool, setupRequestId,
        `INSERT INTO core.medios_contacto (contacto_id, tipo_medio, valor, estatus, es_principal, recibe_notificacion_pago)
         VALUES ($1, 'CORREO', $2, $3, FALSE, FALSE) RETURNING medio_id::text`, [contactId, `${label.replace(/ /g, '.')}.${marker.toLowerCase()}@example.test`, status]);
      const rejected = await patchContactMethod(directMethod.rows[0].medio_id, { value: `corrected.${label.replace(/ /g, '.')}.${marker.toLowerCase()}@example.test` }, `method-edit-unsafe-${randomUUID()}`);
      assert(rejected.response.status === 409, `${label} did not reject method editing safely.`);
    }
    const missingMethodEdit = await patchContactMethod('999999999999999', { value: 'missing@example.test' }, `method-edit-missing-${randomUUID()}`);
    assert(missingMethodEdit.response.status === 404, 'Nonexistent method did not reject editing safely.');
    const oversizedMethodEdit = await patchContactMethod('9223372036854775808', { value: 'oversized@example.test' }, `method-edit-oversized-${randomUUID()}`);
    assert(oversizedMethodEdit.response.status === 400, 'Out-of-range method ID did not reject editing safely.');

    const directoryAfterMethodEdits = await getContactDirectory(activeCompanyId);
    const editedDirectoryContact = directoryAfterMethodEdits.body.data.contacts.find((contact) => contact.id === editContactId);
    assert(editedDirectoryContact.methods.some((item) => item.id === activeEmailId && item.value === 'corrected@example.test'), 'Directory did not show the corrected active method.');
    assert(editedDirectoryContact.inactiveMethods.some((item) => item.id === inactivePhoneId && item.value === '+52 449 555 0311 ext. 8' && item.type === 'WHATSAPP'), 'Directory did not show the corrected inactive method in inactiveMethods.');

    const contactRequestId = `contact-create-${randomUUID()}`;
    requestIds.add(contactRequestId);
    const methods = [
      { type: 'CORREO', value: `maria.${marker.toLowerCase()}@example.test` },
      { type: 'CORREO', value: `compras.${marker.toLowerCase()}@example.test` },
      { type: 'TELEFONO', value: '+52 449 555 0101' },
      { type: 'TELEFONO', value: '449 555 0102 ext. 204' },
      { type: 'WHATSAPP', value: '+52 449 555 0103' }
    ];
    const created = await postContact({ companyId: activeCompanyId, contactType: 'PERSONA', name: `${marker} PERSON`, area: 'Integration', position: 'Synthetic Contact', notes: 'integration fixture', methods }, contactRequestId);
    assert(created.response.status === 201, `Active company contact creation failed: ${JSON.stringify(created.body)}`);
    assert(created.response.headers.get('x-request-id') === contactRequestId, 'Contact response did not preserve x-request-id.');
    assert(typeof created.body.data.id === 'string' && created.body.data.methods.length === 5 && created.body.data.methods.every((method) => typeof method.id === 'string'), 'Contact response did not preserve bigint IDs or all methods.');
    assert(!JSON.stringify(created.body).includes('recibe_notificacion_pago') && !JSON.stringify(created.body).includes('tipo_destinatario_pago'), 'Contact response exposed payment routing fields.');

    const storedContact = await pool.query("SELECT contacto_id::text, estatus, es_contacto_principal FROM core.contactos WHERE contacto_id = $1", [created.body.data.id]);
    assert(storedContact.rows.length === 1 && storedContact.rows[0].estatus === 'ACTIVO' && storedContact.rows[0].es_contacto_principal === false, 'Created contact did not persist ACTIVO and false primary flags.');
    const storedMethods = await pool.query('SELECT medio_id::text, tipo_medio, estatus, es_principal, recibe_notificacion_pago, tipo_destinatario_pago FROM core.medios_contacto WHERE contacto_id = $1 ORDER BY medio_id', [created.body.data.id]);
    assert(storedMethods.rows.length === 5, 'Created contact did not persist exactly five methods.');
    assert(storedMethods.rows.every((method) => method.estatus === 'ACTIVO' && method.es_principal === false && method.recibe_notificacion_pago === false && method.tipo_destinatario_pago === null), 'Created methods did not persist explicit active/non-primary/non-payment values.');
    const typeCounts = storedMethods.rows.reduce((counts, method) => ({ ...counts, [method.tipo_medio]: (counts[method.tipo_medio] || 0) + 1 }), {});
    assert(typeCounts.CORREO === 2 && typeCounts.TELEFONO === 2 && typeCounts.WHATSAPP === 1, 'Method types were lost or collapsed.');

    const auditRows = await pool.query(`SELECT ${auditSchemaColumn} AS schema_name, ${auditTableColumn} AS table_name, ${auditOperationColumn} AS operation, ${auditOriginColumn} AS origin, request_id FROM audit.cambios WHERE ${auditOriginColumn} = $1 AND request_id = $2`, ['DAUBERT_HUB', contactRequestId]);
    assert(auditRows.rows.length === 6, 'Expected one contact and five method audit insert events.');
    assert(auditRows.rows.filter((row) => row.schema_name === 'core' && row.table_name === 'contactos').length === 1, 'Missing audit insert for the contact.');
    assert(auditRows.rows.filter((row) => row.schema_name === 'core' && row.table_name === 'medios_contacto').length === 5, 'Missing audit inserts for contact methods.');
    assert(auditRows.rows.every((row) => String(row.operation).toUpperCase().includes('INSERT') && row.origin === 'DAUBERT_HUB' && row.request_id === contactRequestId), 'Contact audit origin, request ID, or operation is inconsistent.');

    const editPersonCreateId = `contact-edit-person-create-${randomUUID()}`;
    requestIds.add(editPersonCreateId);
    const editPerson = await postContact({ companyId: activeCompanyId, contactType: 'PERSONA', name: `${marker} Maria Lopez`, area: 'Compras', position: 'Compradora', notes: 'Observación inicial', methods: [{ type: 'CORREO', value: `edit.${marker.toLowerCase()}@example.test` }, { type: 'TELEFONO', value: '+52 449 555 0188' }] }, editPersonCreateId);
    assert(editPerson.response.status === 201, `PERSONA edit fixture creation failed: ${JSON.stringify(editPerson.body)}`);
    const editPersonId = editPerson.body.data.id;
    const inactiveEditMethodId = editPerson.body.data.methods[1].id;
    const editMethodDeactivateId = `contact-edit-method-deactivate-${randomUUID()}`;
    requestIds.add(editMethodDeactivateId);
    const editMethodDeactivated = await changeMethodStatus(inactiveEditMethodId, 'deactivate', editMethodDeactivateId);
    assert(editMethodDeactivated.response.status === 200, `PERSONA inactive method setup failed: ${JSON.stringify(editMethodDeactivated.body)}`);
    const methodsBeforeEdit = await pool.query('SELECT medio_id::text, contacto_id::text, tipo_medio, valor, estatus, es_principal, recibe_notificacion_pago, tipo_destinatario_pago FROM core.medios_contacto WHERE contacto_id = $1 ORDER BY medio_id', [editPersonId]);
    assert(methodsBeforeEdit.rows.length === 2 && methodsBeforeEdit.rows.filter((method) => method.estatus === 'ACTIVO').length === 1 && methodsBeforeEdit.rows.filter((method) => method.estatus === 'INACTIVO').length === 1, 'PERSONA edit fixture did not have one active and one inactive method.');

    const editPersonRequestId = `contact-edit-person-${randomUUID()}`;
    requestIds.add(editPersonRequestId);
    const editedPerson = await patchContact(editPersonId, { name: `${marker} María López`, area: 'Compras y Abastecimiento', position: null, notes: 'Observación actualizada' }, editPersonRequestId);
    assert(editedPerson.response.status === 200, `PERSONA PATCH failed: ${JSON.stringify(editedPerson.body)}`);
    assert(editedPerson.response.headers.get('x-request-id') === editPersonRequestId, 'PERSONA PATCH did not preserve x-request-id.');
    assert(editedPerson.body.data.id === editPersonId && typeof editedPerson.body.data.id === 'string' && editedPerson.body.data.companyId === activeCompanyId && editedPerson.body.data.contactType === 'PERSONA' && editedPerson.body.data.name === `${marker} María López` && editedPerson.body.data.area === 'Compras y Abastecimiento' && editedPerson.body.data.position === null && editedPerson.body.data.notes === 'Observación actualizada' && editedPerson.body.data.status === 'ACTIVO', 'PERSONA PATCH response did not return the updated immutable representation.');
    assert(!JSON.stringify(editedPerson.body).includes('recibe_notificacion_pago') && !JSON.stringify(editedPerson.body).includes('tipo_destinatario_pago'), 'PERSONA PATCH exposed payment routing fields.');
    const storedEditedPerson = await pool.query('SELECT contacto_id::text, empresa_id::text, tipo_contacto, nombre, area, cargo, observaciones, estatus, es_contacto_principal FROM core.contactos WHERE contacto_id = $1', [editPersonId]);
    const personRow = storedEditedPerson.rows[0];
    assert(personRow && personRow.empresa_id === activeCompanyId && personRow.tipo_contacto === 'PERSONA' && personRow.nombre === `${marker} María López` && personRow.area === 'Compras y Abastecimiento' && personRow.cargo === null && personRow.observaciones === 'Observación actualizada' && personRow.estatus === 'ACTIVO' && personRow.es_contacto_principal === false, 'PERSONA PATCH changed immutable fields or failed to persist descriptive fields.');
    const methodsAfterEdit = await pool.query('SELECT medio_id::text, contacto_id::text, tipo_medio, valor, estatus, es_principal, recibe_notificacion_pago, tipo_destinatario_pago FROM core.medios_contacto WHERE contacto_id = $1 ORDER BY medio_id', [editPersonId]);
    assert(JSON.stringify(methodsAfterEdit.rows) === JSON.stringify(methodsBeforeEdit.rows), 'PERSONA PATCH changed active/inactive methods or payment metadata.');
    const editAudit = await pool.query(`SELECT ${auditSchemaColumn} AS schema_name, ${auditTableColumn} AS table_name, ${auditOperationColumn} AS operation, ${auditOriginColumn} AS origin, request_id FROM audit.cambios WHERE ${auditOriginColumn} = $1 AND request_id = $2`, ['DAUBERT_HUB', editPersonRequestId]);
    assert(editAudit.rows.length === 1 && editAudit.rows[0].schema_name === 'core' && editAudit.rows[0].table_name === 'contactos' && String(editAudit.rows[0].operation).toUpperCase().includes('UPDATE') && editAudit.rows[0].origin === 'DAUBERT_HUB' && editAudit.rows[0].request_id === editPersonRequestId, 'PERSONA PATCH audit event was not one DAUBERT_HUB contact UPDATE with the request ID.');

    for (const [contactType, initialArea, updatedArea] of [['AREA', 'Compras', 'Compras y Abastecimiento'], ['BUZON_GENERICO', 'Pagos', 'Pagos a Proveedores']]) {
      const createId = `contact-edit-${contactType.toLowerCase()}-create-${randomUUID()}`;
      requestIds.add(createId);
      const fixture = await postContact({ companyId: activeCompanyId, contactType, area: initialArea, notes: 'Inicial', methods: [{ type: 'CORREO', value: `${contactType.toLowerCase()}.${marker.toLowerCase()}@example.test` }] }, createId);
      assert(fixture.response.status === 201, `${contactType} edit fixture creation failed: ${JSON.stringify(fixture.body)}`);
      const editId = `contact-edit-${contactType.toLowerCase()}-${randomUUID()}`;
      requestIds.add(editId);
      const edited = await patchContact(fixture.body.data.id, { area: updatedArea, notes: `Nota ${contactType}` }, editId);
      assert(edited.response.status === 200 && edited.body.data.contactType === contactType && edited.body.data.area === updatedArea && edited.body.data.name === null && edited.body.data.position === null, `${contactType} PATCH response violated type rules: ${JSON.stringify(edited.body)}`);
      const stored = (await pool.query('SELECT empresa_id::text, tipo_contacto, nombre, area, cargo, observaciones, estatus, es_contacto_principal FROM core.contactos WHERE contacto_id = $1', [fixture.body.data.id])).rows[0];
      assert(stored.empresa_id === activeCompanyId && stored.tipo_contacto === contactType && stored.nombre === null && stored.area === updatedArea && stored.cargo === null && stored.observaciones === `Nota ${contactType}` && stored.estatus === 'ACTIVO' && stored.es_contacto_principal === false, `${contactType} PATCH did not preserve immutable fields.`);
    }

    const methodIds = created.body.data.methods.map((method) => method.id);
    for (const methodId of methodIds) {
      const requestId = `method-deactivate-${randomUUID()}`;
      requestIds.add(requestId);
      const deactivated = await changeMethodStatus(methodId, 'deactivate', requestId);
      assert(deactivated.response.status === 200 && deactivated.body.data.status === 'INACTIVO' && deactivated.body.data.id === methodId, `Method deactivation failed: ${JSON.stringify(deactivated.body)}`);
      assert(!JSON.stringify(deactivated.body).includes('recibe_notificacion_pago') && !JSON.stringify(deactivated.body).includes('tipo_destinatario_pago'), 'Method lifecycle response exposed payment routing fields.');
      const lifecycleAudit = await pool.query(`SELECT ${auditSchemaColumn} AS schema_name, ${auditTableColumn} AS table_name, ${auditOperationColumn} AS operation, ${auditOriginColumn} AS origin, request_id FROM audit.cambios WHERE ${auditOriginColumn} = $1 AND request_id = $2`, ['DAUBERT_HUB', requestId]);
      assert(lifecycleAudit.rows.length === 1 && lifecycleAudit.rows[0].schema_name === 'core' && lifecycleAudit.rows[0].table_name === 'medios_contacto' && String(lifecycleAudit.rows[0].operation).toUpperCase().includes('UPDATE') && lifecycleAudit.rows[0].origin === 'DAUBERT_HUB' && lifecycleAudit.rows[0].request_id === requestId, 'Method lifecycle audit context or update event is inconsistent.');
    }
    const noActiveMethods = await pool.query('SELECT estatus FROM core.contactos WHERE contacto_id = $1', [created.body.data.id]);
    assert(noActiveMethods.rows[0].estatus === 'ACTIVO', 'Deactivating the last active method changed the contact lifecycle.');
    const directoryWithInactiveMethods = await getContactDirectory(activeCompanyId);
    const directoryContact = directoryWithInactiveMethods.body.data.contacts.find((contact) => contact.id === created.body.data.id);
    assert(directoryWithInactiveMethods.response.status === 200 && directoryContact && directoryContact.notes === 'integration fixture' && directoryContact.methods.length === 0 && directoryContact.inactiveMethods.length === 5, 'Directory did not return contact notes and separate inactive methods for an active contact.');
    const duplicate = await changeMethodStatus(methodIds[0], 'deactivate', `method-duplicate-${randomUUID()}`);
    assert(duplicate.response.status === 409 && duplicate.body.code === 'METHOD_ALREADY_INACTIVE', 'Repeated method deactivation did not return a safe conflict.');
    const reactivateRequestId = `method-reactivate-${randomUUID()}`;
    requestIds.add(reactivateRequestId);
    const reactivated = await changeMethodStatus(methodIds[0], 'reactivate', reactivateRequestId);
    assert(reactivated.response.status === 200 && reactivated.body.data.status === 'ACTIVO', `Method reactivation failed: ${JSON.stringify(reactivated.body)}`);
    const restoredMethod = await pool.query('SELECT estatus, es_principal, recibe_notificacion_pago, tipo_destinatario_pago FROM core.medios_contacto WHERE medio_id = $1', [methodIds[0]]);
    assert(restoredMethod.rows.length === 1 && restoredMethod.rows[0].estatus === 'ACTIVO' && restoredMethod.rows[0].es_principal === false && restoredMethod.rows[0].recibe_notificacion_pago === false && restoredMethod.rows[0].tipo_destinatario_pago === null, 'Method lifecycle changed fields other than status.');
    const missing = await changeMethodStatus('999999999999999', 'deactivate', `method-missing-${randomUUID()}`);
    assert(missing.response.status === 404, 'Missing method did not return a safe 404.');

    for (const [companyId, expectedStatus, label] of [[inactiveCompanyId, 409, 'inactive'], [blockedCompanyId, 409, 'blocked'], ['999999999999999', 404, 'nonexistent']]) {
      const rejected = await postContact({ companyId, contactType: 'PERSONA', name: `${marker} REJECTED`, methods: [{ type: 'CORREO', value: `rejected.${marker.toLowerCase()}@example.test` }] }, `contact-${label}-${randomUUID()}`);
      assert(rejected.response.status === expectedStatus, `${label} company did not reject contact creation safely.`);
    }

    const contactColumns = 'contacto_id::text, empresa_id::text, tipo_contacto, nombre, area, cargo, observaciones, estatus, es_contacto_principal';
    const methodColumns = 'medio_id::text, contacto_id::text, tipo_medio, valor, estatus, es_principal, recibe_notificacion_pago, tipo_destinatario_pago, observaciones';
    const companyColumns = 'empresa_id::text, tipo_empresa, nombre_comercial, estatus';
    const contactSnapshot = async (contactId) => (await pool.query(`SELECT ${contactColumns} FROM core.contactos WHERE contacto_id = $1`, [contactId])).rows[0];
    const methodSnapshot = async (contactId) => (await pool.query(`SELECT ${methodColumns} FROM core.medios_contacto WHERE contacto_id = $1 ORDER BY medio_id`, [contactId])).rows;
    const companySnapshot = async (companyId) => (await pool.query(`SELECT ${companyColumns} FROM core.empresas WHERE empresa_id = $1`, [companyId])).rows[0];
    const directoryCompany = async (companyId, search) => {
      const result = await getContactDirectoryList(search);
      assert(result.response.status === 200, `Contact Directory list failed: ${JSON.stringify(result.body)}`);
      const company = result.body.data.find((item) => item.id === companyId);
      assert(company && typeof company.id === 'string', `Contact Directory list omitted company ${companyId}.`);
      return company;
    };
    const assertContactLifecycleAudit = async (requestId) => {
      const audit = await pool.query(`SELECT ${auditSchemaColumn} AS schema_name, ${auditTableColumn} AS table_name, ${auditOperationColumn} AS operation, ${auditOriginColumn} AS origin, request_id FROM audit.cambios WHERE request_id = $1`, [requestId]);
      assert(audit.rows.length === 1 && audit.rows[0].schema_name === 'core' && audit.rows[0].table_name === 'contactos' && String(audit.rows[0].operation).toUpperCase().includes('UPDATE') && audit.rows[0].origin === 'DAUBERT_HUB' && audit.rows[0].request_id === requestId, `Contact lifecycle request ${requestId} was not exactly one correlated DAUBERT_HUB core.contactos UPDATE.`);
    };
    const expectedLifecycleData = (row, status) => ({
      id: row.contacto_id,
      companyId: row.empresa_id,
      contactType: row.tipo_contacto,
      name: row.nombre,
      area: row.area,
      position: row.cargo,
      notes: row.observaciones,
      status,
      isPrimary: row.es_contacto_principal
    });
    const assertSuccessfulContactLifecycle = async ({ contactId, companyId, action, status, requestId, beforeContact, beforeMethods, beforeCompany }) => {
      requestIds.add(requestId);
      const changed = await changeContactStatus(contactId, action, requestId);
      assert(changed.response.status === 200, `Contact ${action} did not return explicit 200: ${JSON.stringify(changed.body)}`);
      assert(changed.response.headers.get('x-request-id') === requestId, `Contact ${action} did not preserve x-request-id.`);
      assert(JSON.stringify(changed.body) === JSON.stringify({ data: expectedLifecycleData(beforeContact, status) }), `Contact ${action} did not return all normal fields, string BIGINT IDs, and the expected status.`);
      assert(!JSON.stringify(changed.body).includes('recibe_notificacion_pago') && !JSON.stringify(changed.body).includes('tipo_destinatario_pago'), `Contact ${action} exposed payment routing.`);
      const afterContact = await contactSnapshot(contactId);
      assert(afterContact.estatus === status, `Contact ${action} did not persist ${status}.`);
      assert(JSON.stringify({ ...afterContact, estatus: beforeContact.estatus }) === JSON.stringify(beforeContact), `Contact ${action} changed a core.contactos field other than estatus.`);
      assert(JSON.stringify(await methodSnapshot(contactId)) === JSON.stringify(beforeMethods), `Contact ${action} changed a method row, status, parent, principal, payment metadata, observations, value, or type.`);
      assert(JSON.stringify(await companySnapshot(companyId)) === JSON.stringify(beforeCompany), `Contact ${action} changed company data or lifecycle.`);
      await assertContactLifecycleAudit(requestId);
      return afterContact;
    };

    const lifecycleCompanyId = await createCompany(pool, 'LIFECYCLE_SINGLE', 'ACTIVO');
    const lifecycleContactId = await createDirectContact(pool, lifecycleCompanyId, 'LIFECYCLE_SINGLE', 'ACTIVO');
    const lifecycleMethods = await queryWithAuditContext(pool, setupRequestId,
      `INSERT INTO core.medios_contacto (contacto_id, tipo_medio, valor, estatus, es_principal, recibe_notificacion_pago, tipo_destinatario_pago, observaciones)
        VALUES ($1, 'CORREO', $2, 'ACTIVO', TRUE, TRUE, 'CC', 'Active payment metadata'),
               ($1, 'TELEFONO', $3, 'ACTIVO', FALSE, FALSE, NULL, 'Active telephone'),
               ($1, 'WHATSAPP', $4, 'INACTIVO', FALSE, FALSE, NULL, 'Inactive WhatsApp')
        RETURNING medio_id::text, estatus`, [lifecycleContactId, `lifecycle.${marker.toLowerCase()}@example.test`, '+52 449 555 0401', '+52 449 555 0402']);
    await queryWithAuditContext(pool, setupRequestId, 'UPDATE core.contactos SET es_contacto_principal = TRUE WHERE contacto_id = $1', [lifecycleContactId]);
    assert(lifecycleMethods.rows.length === 3, 'Single-contact lifecycle methods were not created.');
    let lifecycleContactBefore = await contactSnapshot(lifecycleContactId);
    const lifecycleMethodsBefore = await methodSnapshot(lifecycleContactId);
    const lifecycleCompanyBefore = await companySnapshot(lifecycleCompanyId);
    assert(lifecycleContactBefore.es_contacto_principal === true && lifecycleMethodsBefore.some((method) => method.tipo_medio === 'CORREO' && method.estatus === 'ACTIVO' && method.es_principal === true && method.recibe_notificacion_pago === true && method.tipo_destinatario_pago === 'CC' && method.observaciones === 'Active payment metadata') && lifecycleMethodsBefore.some((method) => method.tipo_medio === 'TELEFONO' && method.estatus === 'ACTIVO' && method.es_principal === false && method.recibe_notificacion_pago === false && method.tipo_destinatario_pago === null && method.observaciones === 'Active telephone') && lifecycleMethodsBefore.some((method) => method.tipo_medio === 'WHATSAPP' && method.estatus === 'INACTIVO' && method.es_principal === false && method.recibe_notificacion_pago === false && method.tipo_destinatario_pago === null && method.observaciones === 'Inactive WhatsApp'), 'Lifecycle fixture lacks the active email/phone, inactive WhatsApp, or meaningful payment metadata.');

    const lifecycleCompanySearch = `${marker}_LIFECYCLE_SINGLE`;
    const lifecycleListBefore = await directoryCompany(lifecycleCompanyId, lifecycleCompanySearch);
    assert(lifecycleListBefore.contactCount === 1, 'Single-contact directory count did not start at one active contact.');
    const lifecycleDetailBefore = await getContactDirectory(lifecycleCompanyId);
    const lifecycleActiveBefore = lifecycleDetailBefore.body.data.contacts.find((contact) => contact.id === lifecycleContactId);
    assert(lifecycleDetailBefore.response.status === 200 && lifecycleActiveBefore && lifecycleDetailBefore.body.data.inactiveContacts.length === 0 && lifecycleActiveBefore.notes === lifecycleContactBefore.observaciones && lifecycleActiveBefore.methods.length === 2 && lifecycleActiveBefore.inactiveMethods.length === 1, 'Single-contact directory detail did not initially partition active/inactive methods.');
    assert(!JSON.stringify(lifecycleDetailBefore.body).includes('recibe_notificacion_pago') && !JSON.stringify(lifecycleDetailBefore.body).includes('tipo_destinatario_pago'), 'Contact Directory detail exposed payment routing metadata.');

    const contactDeactivateRequestId = `contact-deactivate-${randomUUID()}`;
    lifecycleContactBefore = await assertSuccessfulContactLifecycle({ contactId: lifecycleContactId, companyId: lifecycleCompanyId, action: 'deactivate', status: 'INACTIVO', requestId: contactDeactivateRequestId, beforeContact: lifecycleContactBefore, beforeMethods: lifecycleMethodsBefore, beforeCompany: lifecycleCompanyBefore });
    const lifecycleListInactive = await directoryCompany(lifecycleCompanyId, lifecycleCompanySearch);
    assert(lifecycleListInactive.contactCount === 0 && (await companySnapshot(lifecycleCompanyId)).estatus === 'ACTIVO', 'Last-contact deactivation did not produce count zero while preserving the ACTIVO company.');
    const lifecycleDetailInactive = await getContactDirectory(lifecycleCompanyId);
    const lifecycleInactive = lifecycleDetailInactive.body.data.inactiveContacts.find((contact) => contact.id === lifecycleContactId);
    assert(lifecycleDetailInactive.response.status === 200 && lifecycleDetailInactive.body.data.contacts.length === 0 && lifecycleInactive && lifecycleInactive.status === 'INACTIVO' && lifecycleInactive.notes === lifecycleContactBefore.observaciones, 'Deactivated contact did not move from contacts to inactiveContacts with status and notes.');
    assert(lifecycleInactive.methods.length === 2 && lifecycleInactive.inactiveMethods.length === 1 && lifecycleInactive.methods.every((method) => lifecycleMethodsBefore.some((row) => row.medio_id === method.id && row.estatus === 'ACTIVO')) && lifecycleInactive.inactiveMethods[0].id === lifecycleMethodsBefore.find((method) => method.estatus === 'INACTIVO').medio_id, 'Inactive contact methods were not partitioned solely by method status.');
    assert(!JSON.stringify(lifecycleDetailInactive.body).includes('recibe_notificacion_pago') && !JSON.stringify(lifecycleDetailInactive.body).includes('tipo_destinatario_pago'), 'Inactive Contact Directory detail exposed payment routing metadata.');
    const duplicateContactDeactivate = await changeContactStatus(lifecycleContactId, 'deactivate', `contact-deactivate-repeated-${randomUUID()}`);
    assert(duplicateContactDeactivate.response.status === 409 && duplicateContactDeactivate.body.code === 'CONTACT_ALREADY_INACTIVE', 'Repeated contact deactivation did not return CONTACT_ALREADY_INACTIVE.');

    const contactReactivateRequestId = `contact-reactivate-${randomUUID()}`;
    lifecycleContactBefore = await assertSuccessfulContactLifecycle({ contactId: lifecycleContactId, companyId: lifecycleCompanyId, action: 'reactivate', status: 'ACTIVO', requestId: contactReactivateRequestId, beforeContact: lifecycleContactBefore, beforeMethods: lifecycleMethodsBefore, beforeCompany: lifecycleCompanyBefore });
    const lifecycleListRestored = await directoryCompany(lifecycleCompanyId, lifecycleCompanySearch);
    const lifecycleDetailRestored = await getContactDirectory(lifecycleCompanyId);
    const lifecycleActiveRestored = lifecycleDetailRestored.body.data.contacts.find((contact) => contact.id === lifecycleContactId);
    assert(lifecycleListRestored.contactCount === 1 && lifecycleActiveRestored && lifecycleDetailRestored.body.data.inactiveContacts.length === 0 && lifecycleActiveRestored.methods.length === 2 && lifecycleActiveRestored.inactiveMethods.length === 1, 'Reactivation did not restore list count and move the contact back to contacts.');
    const duplicateContactReactivate = await changeContactStatus(lifecycleContactId, 'reactivate', `contact-reactivate-repeated-${randomUUID()}`);
    assert(duplicateContactReactivate.response.status === 409 && duplicateContactReactivate.body.code === 'CONTACT_ALREADY_ACTIVE', 'Repeated contact reactivation did not return CONTACT_ALREADY_ACTIVE.');

    const multiCompanyId = await createCompany(pool, 'LIFECYCLE_MULTI', 'ACTIVO');
    const multiFirstId = await createDirectContact(pool, multiCompanyId, 'LIFECYCLE_MULTI_FIRST', 'ACTIVO');
    const multiSecondId = await createDirectContact(pool, multiCompanyId, 'LIFECYCLE_MULTI_SECOND', 'ACTIVO');
    let multiFirstBefore = await contactSnapshot(multiFirstId);
    const multiMethodsBefore = await methodSnapshot(multiFirstId);
    const multiCompanyBefore = await companySnapshot(multiCompanyId);
    const multiCompanySearch = `${marker}_LIFECYCLE_MULTI`;
    assert((await directoryCompany(multiCompanyId, multiCompanySearch)).contactCount === 2, 'Multi-contact directory count did not start at two.');
    const multiDeactivateRequestId = `contact-multi-deactivate-${randomUUID()}`;
    multiFirstBefore = await assertSuccessfulContactLifecycle({ contactId: multiFirstId, companyId: multiCompanyId, action: 'deactivate', status: 'INACTIVO', requestId: multiDeactivateRequestId, beforeContact: multiFirstBefore, beforeMethods: multiMethodsBefore, beforeCompany: multiCompanyBefore });
    const multiListInactive = await directoryCompany(multiCompanyId, multiCompanySearch);
    const multiDetailInactive = await getContactDirectory(multiCompanyId);
    assert(multiListInactive.contactCount === 1 && multiDetailInactive.body.data.contacts.length === 1 && multiDetailInactive.body.data.contacts[0].id === multiSecondId && multiDetailInactive.body.data.inactiveContacts.length === 1 && multiDetailInactive.body.data.inactiveContacts[0].id === multiFirstId && multiDetailInactive.body.data.inactiveContacts[0].status === 'INACTIVO', 'Multi-contact deactivation did not retain one active contact and separate one inactive contact.');
    const multiReactivateRequestId = `contact-multi-reactivate-${randomUUID()}`;
    await assertSuccessfulContactLifecycle({ contactId: multiFirstId, companyId: multiCompanyId, action: 'reactivate', status: 'ACTIVO', requestId: multiReactivateRequestId, beforeContact: multiFirstBefore, beforeMethods: multiMethodsBefore, beforeCompany: multiCompanyBefore });
    const multiDetailRestored = await getContactDirectory(multiCompanyId);
    assert((await directoryCompany(multiCompanyId, multiCompanySearch)).contactCount === 2 && multiDetailRestored.body.data.contacts.length === 2 && multiDetailRestored.body.data.inactiveContacts.length === 0, 'Multi-contact reactivation did not restore both active contacts and count two.');

    const pendingLifecycleId = await createDirectContact(pool, activeCompanyId, 'LIFECYCLE_PENDING', 'PENDIENTE');
    const rejectedLifecycleId = await createDirectContact(pool, activeCompanyId, 'LIFECYCLE_REJECTED', 'RECHAZADO');
    const inactiveParentLifecycleId = await createDirectContact(pool, inactiveCompanyId, 'LIFECYCLE_INACTIVE_PARENT', 'ACTIVO');
    const blockedParentLifecycleId = await createDirectContact(pool, blockedCompanyId, 'LIFECYCLE_BLOCKED_PARENT', 'ACTIVO');
    const lifecycleRejections = [
      [pendingLifecycleId, 'CONTACT_STATUS_NOT_MANAGEABLE', 'pending contact'],
      [rejectedLifecycleId, 'CONTACT_STATUS_NOT_MANAGEABLE', 'rejected contact'],
      [inactiveParentLifecycleId, 'COMPANY_INACTIVE', 'inactive parent'],
      [blockedParentLifecycleId, 'COMPANY_BLOCKED', 'blocked parent']
    ];
    for (const [contactId, code, label] of lifecycleRejections) {
      for (const action of ['deactivate', 'reactivate']) {
        const rejected = await changeContactStatus(contactId, action, `contact-${label.replace(/ /g, '-')}-${action}-${randomUUID()}`);
        assert(rejected.response.status === 409 && rejected.body.code === code, `${label} ${action} did not return 409 ${code}.`);
      }
    }
    for (const action of ['deactivate', 'reactivate']) {
      const missingContact = await changeContactStatus('999999999999999', action, `contact-missing-${action}-${randomUUID()}`);
      assert(missingContact.response.status === 404, `Missing contact ${action} did not return 404.`);
      const oversizedContact = await changeContactStatus('9223372036854775808', action, `contact-oversized-${action}-${randomUUID()}`);
      assert(oversizedContact.response.status === 400, `Out-of-range contact ${action} did not return 400.`);
    }

    const rollbackRequestId = `contact-rollback-${randomUUID()}`;
    requestIds.add(rollbackRequestId);
    const rolledBack = await postContact({ companyId: activeCompanyId, contactType: 'PERSONA', name: `${marker} ROLLBACK`, methods: [{ type: 'CORREO', value: `first.${marker.toLowerCase()}@example.test` }, { type: 'TELEFONO', value: '+52 449 555 0199\u0000rollback' }] }, rollbackRequestId);
    assert(rolledBack.response.status === 500, 'PostgreSQL method insertion failure did not fail the transaction.');
    const rollbackRows = await pool.query('SELECT c.contacto_id, m.medio_id FROM core.contactos c LEFT JOIN core.medios_contacto m ON m.contacto_id = c.contacto_id WHERE c.empresa_id = $1 AND c.nombre = $2', [activeCompanyId, `${marker} ROLLBACK`]);
    assert(rollbackRows.rows.length === 0, 'Method insertion failure left an orphan contact or partial methods.');
    console.log('Contact integration checks passed.');
  } finally {
    try {
      if (databaseVerified) {
        if (companyIds.size > 0) {
          const ids = [...companyIds];
          await queryWithAuditContext(pool, cleanupRequestId, 'DELETE FROM core.medios_contacto WHERE contacto_id IN (SELECT contacto_id FROM core.contactos WHERE empresa_id = ANY($1::bigint[]))', [ids]);
          await queryWithAuditContext(pool, cleanupRequestId, 'DELETE FROM core.contactos WHERE empresa_id = ANY($1::bigint[])', [ids]);
          await queryWithAuditContext(pool, cleanupRequestId, 'DELETE FROM core.empresas WHERE empresa_id = ANY($1::bigint[])', [ids]);
        }
        await pool.query('DELETE FROM audit.cambios WHERE request_id = ANY($1::text[])', [[...requestIds]]);
        const leftovers = await pool.query("SELECT (SELECT count(*)::int FROM core.empresas WHERE nombre_comercial LIKE 'HUB_TEST_CONTACT_%') AS company_count, (SELECT count(*)::int FROM core.medios_contacto WHERE tipo_medio = 'WEB' AND lower(valor) LIKE 'https://portal.example.test/hub_test_contact_%') AS web_count");
        assert(leftovers.rows[0].company_count === 0, 'Contact integration cleanup left company fixtures.');
        assert(leftovers.rows[0].web_count === 0, 'Contact integration cleanup left synthetic WEB fixtures.');
        console.log('Contact integration cleanup verified: no synthetic company or WEB fixtures remain.');
      }
    } finally {
      if (api && !api.killed) {
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
