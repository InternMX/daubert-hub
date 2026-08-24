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

async function changeMethodStatus(id, action, requestId) {
  const response = await fetch(`http://127.0.0.1:${port}/api/contact-methods/${id}/${action}`, {
    method: 'POST', headers: { 'x-request-id': requestId }
  });
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
  try {
    const currentDatabase = (await pool.query('SELECT current_database() AS name')).rows[0].name;
    assert(currentDatabase === 'daubert_hub_test', `Active session database mismatch: ${currentDatabase}`);
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
    const additions = [
      { requestId: `method-add-email-${randomUUID()}`, payload: { type: 'CORREO', value: addedEmail } },
      { requestId: `method-add-phone-${randomUUID()}`, payload: { type: 'TELEFONO', value: '449 123 4567 ext. 204' } },
      { requestId: `method-add-whatsapp-${randomUUID()}`, payload: { type: 'WHATSAPP', value: '+52 449 555 0202' } }
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
    assert(methodsAfterAdds.rows.length === 6 && persistedAdditions.length === 3, 'Method creation did not add exactly three rows.');
    assert(persistedAdditions.every((method) => method.estatus === 'ACTIVO' && method.es_principal === false && method.recibe_notificacion_pago === false && method.tipo_destinatario_pago === null), 'New methods did not persist explicit active/non-primary/non-payment values.');
    const originalMethodsAfterAdds = methodsAfterAdds.rows.filter((method) => !addedMethodIds.includes(method.medio_id));
    assert(JSON.stringify(originalMethodsAfterAdds) === JSON.stringify(methodsBeforeAdds.rows), 'Method creation changed an existing active or inactive method.');
    const contactAfterMethodAdds = (await pool.query('SELECT contacto_id::text, empresa_id::text, tipo_contacto, nombre, area, cargo, observaciones, estatus, es_contacto_principal FROM core.contactos WHERE contacto_id = $1', [addMethodContactId])).rows[0];
    const companyAfterMethodAdds = (await pool.query('SELECT empresa_id::text, tipo_empresa, nombre_comercial, estatus FROM core.empresas WHERE empresa_id = $1', [activeCompanyId])).rows[0];
    assert(JSON.stringify(contactAfterMethodAdds) === JSON.stringify(contactBeforeMethodAdds), 'Method creation changed contact data or lifecycle.');
    assert(JSON.stringify(companyAfterMethodAdds) === JSON.stringify(companyBeforeMethodAdds), 'Method creation changed company data or lifecycle.');

    const directoryAfterAdds = await getContactDirectory(activeCompanyId);
    const addedDirectoryContact = directoryAfterAdds.body.data.contacts.find((contact) => contact.id === addMethodContactId);
    assert(directoryAfterAdds.response.status === 200 && addedDirectoryContact && addedDirectoryContact.methods.length === 5 && addedDirectoryContact.inactiveMethods.length === 1, 'Directory did not return all active additions while preserving inactiveMethods.');
    assert(addedDirectoryContact.methods.filter((method) => method.type === 'CORREO').length === 2 && addedDirectoryContact.methods.filter((method) => method.type === 'TELEFONO').length === 2 && addedDirectoryContact.methods.filter((method) => method.type === 'WHATSAPP').length === 1, 'Directory collapsed multiple same-type or mixed methods.');
    assert(addedDirectoryContact.inactiveMethods[0].id === originalInactiveMethodId, 'Directory changed the original inactive method.');

    for (const addition of additions) {
      const methodAudit = await pool.query(`SELECT ${auditSchemaColumn} AS schema_name, ${auditTableColumn} AS table_name, ${auditOperationColumn} AS operation, ${auditOriginColumn} AS origin, request_id FROM audit.cambios WHERE ${auditOriginColumn} = $1 AND request_id = $2`, ['DAUBERT_HUB', addition.requestId]);
      assert(methodAudit.rows.length === 1 && methodAudit.rows[0].schema_name === 'core' && methodAudit.rows[0].table_name === 'medios_contacto' && String(methodAudit.rows[0].operation).toUpperCase().includes('INSERT') && methodAudit.rows[0].origin === 'DAUBERT_HUB' && methodAudit.rows[0].request_id === addition.requestId, `Method ${addition.payload.type} audit event is inconsistent.`);
    }

    for (const [payload, label] of [[{ type: 'CORREO', value: addedEmail }, 'exact email'], [{ type: 'CORREO', value: addedEmail.toUpperCase() }, 'case-insensitive email'], [{ type: 'TELEFONO', value: '449 123 4567 ext. 204' }, 'exact phone']]) {
      const duplicate = await addContactMethod(addMethodContactId, payload, `method-add-duplicate-${randomUUID()}`);
      assert(duplicate.response.status === 409 && duplicate.body.code === 'CONTACT_METHOD_DUPLICATE', `${label} duplicate was not rejected safely.`);
    }
    const countAfterDuplicates = await pool.query('SELECT count(*)::int AS count FROM core.medios_contacto WHERE contacto_id = $1', [addMethodContactId]);
    assert(countAfterDuplicates.rows[0].count === 6, 'Duplicate method rejection inserted an extra row.');

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

    const rollbackRequestId = `contact-rollback-${randomUUID()}`;
    requestIds.add(rollbackRequestId);
    const rolledBack = await postContact({ companyId: activeCompanyId, contactType: 'PERSONA', name: `${marker} ROLLBACK`, methods: [{ type: 'CORREO', value: `first.${marker.toLowerCase()}@example.test` }, { type: 'TELEFONO', value: '+52 449 555 0199\u0000rollback' }] }, rollbackRequestId);
    assert(rolledBack.response.status === 500, 'PostgreSQL method insertion failure did not fail the transaction.');
    const rollbackRows = await pool.query('SELECT c.contacto_id, m.medio_id FROM core.contactos c LEFT JOIN core.medios_contacto m ON m.contacto_id = c.contacto_id WHERE c.empresa_id = $1 AND c.nombre = $2', [activeCompanyId, `${marker} ROLLBACK`]);
    assert(rollbackRows.rows.length === 0, 'Method insertion failure left an orphan contact or partial methods.');
    console.log('Contact integration checks passed.');
  } finally {
    try {
      if (companyIds.size > 0) {
        const ids = [...companyIds];
        await queryWithAuditContext(pool, cleanupRequestId, 'DELETE FROM core.medios_contacto WHERE contacto_id IN (SELECT contacto_id FROM core.contactos WHERE empresa_id = ANY($1::bigint[]))', [ids]);
        await queryWithAuditContext(pool, cleanupRequestId, 'DELETE FROM core.contactos WHERE empresa_id = ANY($1::bigint[])', [ids]);
        await queryWithAuditContext(pool, cleanupRequestId, 'DELETE FROM core.empresas WHERE empresa_id = ANY($1::bigint[])', [ids]);
      }
      await pool.query('DELETE FROM audit.cambios WHERE request_id = ANY($1::text[])', [[...requestIds]]);
      const leftovers = await pool.query("SELECT count(*)::int AS count FROM core.empresas WHERE nombre_comercial LIKE 'HUB_TEST_CONTACT_%'");
      assert(leftovers.rows[0].count === 0, 'Contact integration cleanup left company fixtures.');
      console.log('Contact integration cleanup verified: no synthetic fixtures remain.');
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
