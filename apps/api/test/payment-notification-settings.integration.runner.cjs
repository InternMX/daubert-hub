const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { createAuthenticatedTestSession, cleanupAuthenticatedTestSession } = require('./support/test-auth.cjs');

// Same local convenience as the other runners: read TEST_DATABASE_URL from apps/api/.env when the
// shell did not export it. The guard below still only ever trusts daubert_hub_test.
if (!process.env.TEST_DATABASE_URL) {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator === -1) continue;
      if (trimmed.slice(0, separator).trim() === 'TEST_DATABASE_URL' && process.env.TEST_DATABASE_URL === undefined) process.env.TEST_DATABASE_URL = trimmed.slice(separator + 1).trim();
    }
  }
}

// End-to-end configuration of Payment Notifications WITHOUT n8n and without manual SQL:
// a FLETE company like TRANSPORTES KARINA goes from creation to appearing in
// core.vw_catalogo_notificacion_pago_n8n purely through the Hub API. Synthetic data only.
let sessionCookie = null;
const port = 3116;
const prefix = 'HUB_TEST_PAYCFG_';
const marker = `${prefix}${randomUUID().replace(/-/g, '').toUpperCase()}`;
const cleanupRequestId = `cleanup-${randomUUID()}`;
const companyIds = new Set();
const requestIds = new Set([cleanupRequestId]);

function assert(condition, message) { if (!condition) throw new Error(message); }

function guardedUrl(value) {
  if (!value) throw new Error('TEST_DATABASE_URL must be set for database integration tests.');
  const url = new URL(value);
  const databaseName = decodeURIComponent(url.pathname).replace(/^\//, '');
  if (databaseName !== 'daubert_hub_test') throw new Error(`Refusing database integration tests against "${databaseName || '(missing)'}". Expected "daubert_hub_test".`);
  return { url, databaseName };
}

async function waitForApi() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for the API integration server.');
}

async function request(method, urlPath, payload) {
  const response = await fetch(`http://127.0.0.1:${port}/api${urlPath}`, {
    method,
    headers: { ...(payload === undefined ? {} : { 'content-type': 'application/json' }), ...(sessionCookie ? { cookie: sessionCookie } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  const body = await response.json().catch(() => null);
  const requestId = response.headers.get('x-request-id');
  if (requestId) requestIds.add(requestId);
  return { response, status: response.status, body };
}

async function run() {
  const { url, databaseName } = guardedUrl(process.env.TEST_DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let api;
  let verified = false;
  let authSession = null;
  let startup = '';
  try {
    assert((await pool.query('SELECT current_database() AS name')).rows[0].name === 'daubert_hub_test', 'Active session is not daubert_hub_test.');
    verified = true;
    console.log(`Integration database verified: ${databaseName}`);

    api = spawn(process.execPath, ['dist/src/main.js'], {
      cwd: process.cwd(),
      env: { ...process.env, DB_HOST: url.hostname, DB_PORT: url.port || '5432', DB_NAME: databaseName, DB_USER: decodeURIComponent(url.username), DB_PASSWORD: decodeURIComponent(url.password), API_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    api.stdout.on('data', (chunk) => { startup += chunk; });
    api.stderr.on('data', (chunk) => { startup += chunk; });
    await waitForApi();
    authSession = await createAuthenticatedTestSession(`http://127.0.0.1:${port}/api`, marker);
    sessionCookie = authSession.cookie;

    const settingsRow = async (id) => (await pool.query('SELECT procesa_comprobantes_pago AS processes, notificaciones_activas AS active, ruta_destino AS destination FROM core.empresas_notificacion_pago WHERE empresa_id = $1', [id])).rows[0];
    const DEFAULT_DESTINATION = 'PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}';
    const expectMissing = (result, codes, label) => {
      assert(result.status === 409 && result.body.code === 'PAYMENT_NOTIFICATIONS_NOT_READY', `${label}: expected 409 PAYMENT_NOTIFICATIONS_NOT_READY, got ${result.status} ${JSON.stringify(result.body)}`);
      assert(JSON.stringify(result.body.missingRequirements) === JSON.stringify(codes), `${label}: unexpected missing requirements ${JSON.stringify(result.body.missingRequirements)}`);
      assert(!/select |insert |core\.|constraint/i.test(JSON.stringify(result.body)), `${label}: error leaked internals.`);
    };

    // 1. Provider creation makes the config row atomically, false/false, never activated.
    const created = await request('POST', '/providers', { commercialName: `${marker}_TRANSPORTES KARINA`, providerType: 'FLETE' });
    assert(created.status === 201, `Provider creation failed: ${JSON.stringify(created.body)}`);
    const companyId = created.body.data.id;
    companyIds.add(companyId);
    assert(created.body.data.rutaDropbox === null, 'A new provider without a path must report rutaDropbox null.');
    const initialRow = await settingsRow(companyId);
    assert(initialRow && initialRow.processes === false && initialRow.active === false && initialRow.destination === DEFAULT_DESTINATION, `Config row not created with safe defaults: ${JSON.stringify(initialRow)}`);

    // 2. GET exposes camelCase defaults and everything that is missing.
    const initial = await request('GET', `/companies/${companyId}/payment-notification-settings`);
    assert(initial.status === 200 && initial.body.data.companyId === companyId && typeof initial.body.data.companyId === 'string', 'GET settings failed or the BIGINT id is not a string.');
    assert(initial.body.data.dropboxPath === null && initial.body.data.destinationPath === null && initial.body.data.processesPaymentReceipts === false && initial.body.data.notificationsActive === false, `Unexpected initial settings: ${JSON.stringify(initial.body.data)}`);
    assert(JSON.stringify(initial.body.data.readiness) === JSON.stringify({ ready: false, missingRequirements: ['DROPBOX_PATH_REQUIRED', 'PAYMENT_PROCESSING_REQUIRED', 'PAYMENT_RECIPIENT_PARA_REQUIRED'] }), 'Initial readiness is wrong.');
    assert(!/procesa_|notificaciones_activas|ruta_dropbox|ruta_destino|empresa_id/.test(JSON.stringify(initial.body)), 'Settings response exposed snake_case fields.');

    // 3. Incomplete activation attempts are refused and persist nothing.
    expectMissing(await request('PATCH', `/companies/${companyId}/payment-notification-settings`, { notificationsActive: true }), ['DROPBOX_PATH_REQUIRED', 'PAYMENT_PROCESSING_REQUIRED', 'PAYMENT_RECIPIENT_PARA_REQUIRED'], 'Activation with nothing configured');
    assert((await settingsRow(companyId)).active === false, 'A refused activation persisted notificationsActive=true.');
    assert((await request('PATCH', `/companies/${companyId}/payment-notification-settings`, {})).status === 400, 'An empty settings PATCH was accepted.');
    assert((await request('PATCH', `/companies/${companyId}/payment-notification-settings`, { notificationsActive: 'yes' })).status === 400, 'A non-boolean flag was accepted.');
    assert((await request('PATCH', `/companies/${companyId}/payment-notification-settings`, { destinationPath: 'C:\\evil', notificationsActive: false })).status === 400, 'A client-supplied destination path was accepted.');

    // 4. Aliases (existing endpoint), contact and CORREO.
    const aliases = await request('PATCH', `/companies/${companyId}/aliases`, { aliases: [`${marker}_KARINA MEZA`] });
    assert(aliases.status === 200 && aliases.body.data.aliases.includes(`${marker}_KARINA MEZA`), `Alias update failed: ${JSON.stringify(aliases.body)}`);
    const email = `${marker.toLowerCase()}_pagos@example.test`;
    const contact = await request('POST', '/contacts', { companyId, contactType: 'AREA', area: 'Pagos', methods: [{ type: 'CORREO', value: email }] });
    assert(contact.status === 201, `Contact creation failed: ${JSON.stringify(contact.body)}`);
    const contactId = contact.body.data.id;
    const methodId = contact.body.data.methods[0].id;
    assert(contact.body.data.methods[0].isPrimary === false, 'A new method should not be primary.');

    // 5. Method payment flags: validation errors first, then CORREO + PARA.
    const noType = await request('PATCH', `/contact-methods/${methodId}`, { receivesPaymentNotifications: true });
    assert(noType.status === 400 && noType.body.code === 'PAYMENT_RECIPIENT_TYPE_REQUIRED', `receives=true without a type was not rejected: ${JSON.stringify(noType.body)}`);
    const phone = await request('POST', `/contacts/${contactId}/methods`, { type: 'TELEFONO', value: '449 555 0100', receivesPaymentNotifications: true, paymentRecipientType: 'PARA' });
    assert(phone.status === 400 && phone.body.code === 'PAYMENT_NOTIFICATION_REQUIRES_EMAIL', 'A phone number was allowed to receive payment notifications.');
    const stillOff = (await pool.query('SELECT recibe_notificacion_pago AS receives, tipo_destinatario_pago AS type, es_principal AS principal FROM core.medios_contacto WHERE medio_id = $1', [methodId])).rows[0];
    assert(stillOff.receives === false && stillOff.type === null, 'A rejected method edit mutated the method.');
    const withPara = await request('PATCH', `/contact-methods/${methodId}`, { receivesPaymentNotifications: true, paymentRecipientType: 'PARA' });
    assert(withPara.status === 200 && withPara.body.data.receivesPaymentNotifications === true && withPara.body.data.paymentRecipientType === 'PARA' && withPara.body.data.isPrimary === false, `CORREO+PARA edit failed or made the method primary: ${JSON.stringify(withPara.body)}`);
    const paraRow = (await pool.query('SELECT es_principal AS principal FROM core.medios_contacto WHERE medio_id = $1', [methodId])).rows[0];
    assert(paraRow.principal === false, 'PARA must not imply es_principal.');
    const primaryOnly = await request('PATCH', `/contact-methods/${methodId}`, { isPrimary: true, receivesPaymentNotifications: false });
    assert(primaryOnly.status === 200 && primaryOnly.body.data.isPrimary === true && primaryOnly.body.data.receivesPaymentNotifications === false && primaryOnly.body.data.paymentRecipientType === null, `Primary/recipient independence failed: ${JSON.stringify(primaryOnly.body)}`);

    // 6. es_principal is NOT a substitute for PARA: readiness still lacks the recipient.
    const primaryButNoPara = await request('GET', `/companies/${companyId}/payment-notification-settings`);
    assert(primaryButNoPara.body.data.readiness.missingRequirements.includes('PAYMENT_RECIPIENT_PARA_REQUIRED'), 'es_principal was treated as a PARA recipient.');
    const back = await request('PATCH', `/contact-methods/${methodId}`, { isPrimary: false, receivesPaymentNotifications: true, paymentRecipientType: 'PARA' });
    assert(back.status === 200 && back.body.data.paymentRecipientType === 'PARA' && back.body.data.isPrimary === false, 'Restoring PARA failed.');

    // 7. Dropbox path validation, then the real path (destination derived and synced).
    for (const bad of ['C:\\Users\\06\\Documents\\Dropbox\\FLETES', '\\\\server\\share\\FLETES', '/abs/path', 'FLETES/../x']) {
      const rejected = await request('PATCH', `/providers/${companyId}`, { rutaDropbox: bad });
      assert(rejected.status === 400 && /^DROPBOX_PATH_/.test(rejected.body.code), `Unsafe path ${bad} was not rejected: ${JSON.stringify(rejected.body)}`);
    }
    const dropboxInput = `FLETES\\${marker} TRANSPORTES KARINA`;
    const withPath = await request('PATCH', `/providers/${companyId}`, { rutaDropbox: dropboxInput });
    const canonical = `FLETES/${marker} TRANSPORTES KARINA`;
    assert(withPath.status === 200 && withPath.body.data.rutaDropbox === canonical, `Provider PATCH did not canonicalize the path: ${JSON.stringify(withPath.body)}`);
    const expectedDestination = `FLETES\\${marker} TRANSPORTES KARINA\\PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}`;
    assert((await settingsRow(companyId)).destination === expectedDestination, 'ruta_destino was not synced with ruta_dropbox in the same operation.');
    assert((await pool.query('SELECT ruta_dropbox FROM core.empresas WHERE empresa_id = $1', [companyId])).rows[0].ruta_dropbox === canonical, 'ruta_dropbox was not persisted in canonical "/" form.');
    expectMissing(await request('PATCH', `/companies/${companyId}/payment-notification-settings`, { notificationsActive: true }), ['PAYMENT_PROCESSING_REQUIRED'], 'Activation without processing');

    // 8. Processing on, then activation succeeds (and only now).
    const processing = await request('PATCH', `/companies/${companyId}/payment-notification-settings`, { processesPaymentReceipts: true });
    assert(processing.status === 200 && processing.body.data.processesPaymentReceipts === true && processing.body.data.notificationsActive === false && processing.body.data.readiness.ready === true, `Enabling processing failed: ${JSON.stringify(processing.body)}`);
    assert(processing.body.data.destinationPath === expectedDestination, 'GET/PATCH did not expose the derived destination.');
    const activated = await request('PATCH', `/companies/${companyId}/payment-notification-settings`, { notificationsActive: true });
    assert(activated.status === 200 && activated.body.data.notificationsActive === true, `Activation of a complete company failed: ${JSON.stringify(activated.body)}`);

    // 9. n8n contract: the company shows up correctly in the catalog view, with the PARA recipient.
    const catalog = await pool.query('SELECT alias_pdf, correos_para, correos_cc, correos_cco, ruta_destino, ruta_dropbox, procesa_comprobantes_pago, notificaciones_activas FROM core.vw_catalogo_notificacion_pago_n8n WHERE empresa_id = $1 ORDER BY alias_pdf', [companyId]);
    assert(catalog.rows.length >= 2, `The company is missing from vw_catalogo_notificacion_pago_n8n (rows: ${catalog.rows.length}).`);
    assert(catalog.rows.some((row) => row.alias_pdf === `${marker}_KARINA MEZA`) && catalog.rows.some((row) => row.alias_pdf === `${marker}_TRANSPORTES KARINA`), 'The catalog view lacks the commercial name or the alias.');
    assert(catalog.rows.every((row) => row.correos_para === email && row.correos_cc === '' && row.correos_cco === '' && row.ruta_destino === expectedDestination && row.ruta_dropbox === canonical && row.procesa_comprobantes_pago === true && row.notificaciones_activas === true), `Catalog view values are wrong: ${JSON.stringify(catalog.rows[0])}`);
    const contactsView = await pool.query('SELECT correos_para, total_correos_para FROM core.vw_contactos_notificacion_pago_n8n WHERE empresa_id = $1', [companyId]);
    assert(contactsView.rows.length === 1 && contactsView.rows[0].correos_para === email && Number(contactsView.rows[0].total_correos_para) === 1, 'vw_contactos_notificacion_pago_n8n does not show the PARA recipient.');

    // 10. Recipient variations block (re)activation: CC-only, CCO-only, inactive method/contact, recibe=false.
    const off = await request('PATCH', `/companies/${companyId}/payment-notification-settings`, { notificationsActive: false });
    assert(off.status === 200 && off.body.data.notificationsActive === false, 'Deactivation failed.');
    // The view keeps every company with procesa_comprobantes_pago=true and exposes the flag; n8n filters on it.
    const deactivatedCatalog = await pool.query('SELECT notificaciones_activas FROM core.vw_catalogo_notificacion_pago_n8n WHERE empresa_id = $1', [companyId]);
    assert(deactivatedCatalog.rows.every((row) => row.notificaciones_activas === false), 'The n8n catalog still reports a deactivated company as active.');
    const activate = () => request('PATCH', `/companies/${companyId}/payment-notification-settings`, { notificationsActive: true });
    for (const type of ['CC', 'CCO']) {
      assert((await request('PATCH', `/contact-methods/${methodId}`, { paymentRecipientType: type })).status === 200, `Switching to ${type} failed.`);
      expectMissing(await activate(), ['PAYMENT_RECIPIENT_PARA_REQUIRED'], `${type}-only recipient`);
    }
    await request('PATCH', `/contact-methods/${methodId}`, { paymentRecipientType: 'PARA' });
    assert((await request('POST', `/contact-methods/${methodId}/deactivate`)).status === 200, 'Method deactivation failed.');
    expectMissing(await activate(), ['PAYMENT_RECIPIENT_PARA_REQUIRED'], 'Inactive method');
    assert((await request('POST', `/contact-methods/${methodId}/reactivate`)).status === 200, 'Method reactivation failed.');
    assert((await request('POST', `/contacts/${contactId}/deactivate`)).status === 200, 'Contact deactivation failed.');
    expectMissing(await activate(), ['PAYMENT_RECIPIENT_PARA_REQUIRED'], 'Inactive contact');
    assert((await request('POST', `/contacts/${contactId}/reactivate`)).status === 200, 'Contact reactivation failed.');
    assert((await request('PATCH', `/contact-methods/${methodId}`, { receivesPaymentNotifications: false })).status === 200, 'Turning recibe off failed.');
    expectMissing(await activate(), ['PAYMENT_RECIPIENT_PARA_REQUIRED'], 'recibe_notificacion_pago=false');
    assert((await settingsRow(companyId)).active === false, 'A refused activation persisted notificationsActive=true.');
    // Two valid PARA recipients are fine.
    const second = await request('POST', `/contacts/${contactId}/methods`, { type: 'CORREO', value: `${marker.toLowerCase()}_pagos2@example.test`, receivesPaymentNotifications: true, paymentRecipientType: 'PARA' });
    assert(second.status === 201 && second.body.data.paymentRecipientType === 'PARA', 'Adding a second PARA recipient failed.');
    await request('PATCH', `/contact-methods/${methodId}`, { receivesPaymentNotifications: true, paymentRecipientType: 'PARA' });
    assert((await activate()).status === 200, 'Activation with two PARA recipients failed.');
    const twoPara = await pool.query('SELECT total_correos_para FROM core.vw_contactos_notificacion_pago_n8n WHERE empresa_id = $1', [companyId]);
    assert(Number(twoPara.rows[0].total_correos_para) === 2, 'The view does not list both PARA recipients.');

    // 10b. Invariant (phase 1.1): while notifications are active the company always keeps an operable PARA.
    const inv = await request('POST', '/providers', { commercialName: `${marker}_INVARIANT`, providerType: 'FLETE', rutaDropbox: `FLETES/${marker} INVARIANT` });
    assert(inv.status === 201, `Invariant fixture creation failed: ${JSON.stringify(inv.body)}`);
    const invId = inv.body.data.id;
    companyIds.add(invId);
    const invSettingsPath = `/companies/${invId}/payment-notification-settings`;
    const invEmail = (suffix) => `${marker.toLowerCase()}_inv_${suffix}@example.test`;
    const invContact = await request('POST', '/contacts', { companyId: invId, contactType: 'AREA', area: 'Pagos', methods: [{ type: 'CORREO', value: invEmail('a') }] });
    assert(invContact.status === 201, 'Invariant contact creation failed.');
    const invContactId = invContact.body.data.id;
    const invMethodA = invContact.body.data.methods[0].id;
    assert((await request('PATCH', `/contact-methods/${invMethodA}`, { receivesPaymentNotifications: true, paymentRecipientType: 'PARA' })).status === 200, 'Setting the first PARA failed.');
    const invMethodB = (await request('POST', `/contacts/${invContactId}/methods`, { type: 'CORREO', value: invEmail('b'), receivesPaymentNotifications: true, paymentRecipientType: 'PARA' })).body.data.id;
    assert(invMethodB, 'Adding the second PARA failed.');
    assert((await request('PATCH', invSettingsPath, { processesPaymentReceipts: true, notificationsActive: true })).status === 200, 'Activation with two PARA failed.');

    const methodState = async (id) => (await pool.query('SELECT estatus, tipo_medio, valor, recibe_notificacion_pago AS receives, tipo_destinatario_pago AS recipient, es_principal AS principal FROM core.medios_contacto WHERE medio_id = $1', [id])).rows[0];
    const contactStatus = async (id) => (await pool.query('SELECT estatus FROM core.contactos WHERE contacto_id = $1', [id])).rows[0].estatus;
    const catalogPara = async () => (await pool.query('SELECT DISTINCT correos_para FROM core.vw_catalogo_notificacion_pago_n8n WHERE empresa_id = $1 AND notificaciones_activas = true', [invId])).rows.map((row) => row.correos_para);
    const expectBlocked = (result, label) => {
      assert(result.status === 409 && result.body.code === 'PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA', `${label}: expected 409 PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA, got ${result.status} ${JSON.stringify(result.body)}`);
      assert(JSON.stringify(result.body.missingRequirements) === JSON.stringify(['PAYMENT_RECIPIENT_PARA_REQUIRED']), `${label}: missingRequirements not returned.`);
      assert(!/select |insert |core\.|constraint/i.test(JSON.stringify(result.body)), `${label}: error leaked internals.`);
    };

    // Two PARA: the invariant allows removing one...
    assert((await request('POST', `/contact-methods/${invMethodA}/deactivate`)).status === 200, 'Removing one of two PARA was refused.');
    assert((await catalogPara()).length > 0 && (await catalogPara()).every((value) => value === invEmail('b')), 'The catalog should list only the remaining PARA.');
    // ...but not the last one, by any route. Every refusal leaves the database untouched and notifications active.
    const beforeMethod = await methodState(invMethodB);
    const attempts = [
      ['recibe true -> false', () => request('PATCH', `/contact-methods/${invMethodB}`, { receivesPaymentNotifications: false })],
      ['PARA -> CC', () => request('PATCH', `/contact-methods/${invMethodB}`, { paymentRecipientType: 'CC' })],
      ['PARA -> CCO', () => request('PATCH', `/contact-methods/${invMethodB}`, { paymentRecipientType: 'CCO' })],
      ['CORREO -> TELEFONO', () => request('PATCH', `/contact-methods/${invMethodB}`, { type: 'TELEFONO', value: '449 555 0111' })],
      ['deactivate method', () => request('POST', `/contact-methods/${invMethodB}/deactivate`)],
      ['deactivate contact', () => request('POST', `/contacts/${invContactId}/deactivate`)]
    ];
    for (const [label, attempt] of attempts) {
      expectBlocked(await attempt(), label);
      assert(JSON.stringify(await methodState(invMethodB)) === JSON.stringify(beforeMethod), `${label}: the method was partially modified.`);
      assert(await contactStatus(invContactId) === 'ACTIVO', `${label}: the contact was modified.`);
      const state = await settingsRow(invId);
      assert(state.active === true && state.processes === true, `${label}: notifications were deactivated automatically.`);
      assert(JSON.stringify(await catalogPara()) === JSON.stringify([invEmail('b')]), `${label}: vw_catalogo_notificacion_pago_n8n lost correos_para.`);
    }
    // Operations that cannot worsen readiness stay allowed for the only PARA.
    assert((await request('PATCH', `/contact-methods/${invMethodB}`, { isPrimary: true })).status === 200, 'Changing isPrimary on the only PARA was refused (es_principal must not intervene).');
    const addedCc = await request('POST', `/contacts/${invContactId}/methods`, { type: 'CORREO', value: invEmail('cc'), receivesPaymentNotifications: true, paymentRecipientType: 'CC' });
    assert(addedCc.status === 201, 'Adding a CC was refused.');
    assert((await request('PATCH', `/contact-methods/${addedCc.body.data.id}`, { value: invEmail('cc2') })).status === 200, 'Editing a CC was refused.');
    assert((await request('POST', `/contact-methods/${addedCc.body.data.id}/deactivate`)).status === 200, 'Deactivating a CC was refused.');
    assert((await request('POST', `/contact-methods/${invMethodA}/reactivate`)).status === 200, 'Reactivating a PARA was refused.');
    // With two PARA again, the previously blocked change is fine; then it is blocked once more.
    assert((await request('PATCH', `/contact-methods/${invMethodB}`, { paymentRecipientType: 'CC' })).status === 200, 'Turning one of two PARA into CC was refused.');
    expectBlocked(await request('PATCH', `/contact-methods/${invMethodA}`, { paymentRecipientType: 'CCO' }), 'PARA -> CCO with one PARA left');
    assert((await methodState(invMethodA)).recipient === 'PARA', 'The refused change was applied.');
    // Another contact with a PARA makes deactivating the first contact legal.
    const otherContact = await request('POST', '/contacts', { companyId: invId, contactType: 'AREA', area: 'Tesoreria', methods: [{ type: 'CORREO', value: invEmail('t') }] });
    const otherMethod = otherContact.body.data.methods[0].id;
    assert((await request('PATCH', `/contact-methods/${otherMethod}`, { receivesPaymentNotifications: true, paymentRecipientType: 'PARA' })).status === 200, 'Second contact PARA failed.');
    assert((await request('POST', `/contacts/${invContactId}/deactivate`)).status === 200, 'Deactivating a contact while another contact keeps a PARA was refused.');
    expectBlocked(await request('POST', `/contacts/${otherContact.body.data.id}/deactivate`), 'deactivate the contact with the last PARA');
    assert(await contactStatus(otherContact.body.data.id) === 'ACTIVO', 'The refused contact deactivation was applied.');
    assert(JSON.stringify(await catalogPara()) === JSON.stringify([invEmail('t')]), 'correos_para must be the remaining contact PARA.');
    // Notifications inactive: the last PARA may go, and re-activating without any PARA is refused as before.
    assert((await request('PATCH', invSettingsPath, { notificationsActive: false })).status === 200, 'Deactivating notifications failed.');
    assert((await request('POST', `/contacts/${otherContact.body.data.id}/deactivate`)).status === 200, 'With notifications inactive the last PARA could not be removed.');
    assert((await request('PATCH', invSettingsPath, { notificationsActive: true })).status === 409, 'Re-activation without any PARA was accepted.');

    // 11. Clearing the dropbox path while active is refused; deactivate first, then it works.
    const clearActive = await request('PATCH', `/providers/${companyId}`, { rutaDropbox: null });
    assert(clearActive.status === 409 && clearActive.body.code === 'PAYMENT_NOTIFICATIONS_DROPBOX_PATH_IN_USE', `Clearing the path while active was not refused: ${JSON.stringify(clearActive.body)}`);
    await request('PATCH', `/companies/${companyId}/payment-notification-settings`, { notificationsActive: false });
    const cleared = await request('PATCH', `/providers/${companyId}`, { rutaDropbox: null });
    assert(cleared.status === 200 && cleared.body.data.rutaDropbox === null, 'Clearing the path failed.');
    assert((await settingsRow(companyId)).destination === DEFAULT_DESTINATION, 'Clearing the path did not reset ruta_destino to the schema default.');

    // 12. Provider creation with a path stores the derived destination atomically; an invalid path stores nothing.
    const withPathCreate = await request('POST', '/providers', { commercialName: `${marker}_WITH_PATH`, providerType: 'SERVICIO', rutaDropbox: 'PROVEEDOR DE SERVICIOS\\Synthetic' });
    assert(withPathCreate.status === 201 && withPathCreate.body.data.rutaDropbox === 'PROVEEDOR DE SERVICIOS/Synthetic', `Provider creation with a path failed: ${JSON.stringify(withPathCreate.body)}`);
    companyIds.add(withPathCreate.body.data.id);
    const withPathRow = await settingsRow(withPathCreate.body.data.id);
    assert(withPathRow.destination === 'PROVEEDOR DE SERVICIOS\\Synthetic\\PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}' && withPathRow.active === false && withPathRow.processes === false, 'Provider created with a path has the wrong config row.');
    const badCreate = await request('POST', '/providers', { commercialName: `${marker}_BAD_PATH`, providerType: 'FLETE', rutaDropbox: 'C:\\FLETES' });
    assert(badCreate.status === 400, 'A provider with an absolute path was created.');
    assert((await pool.query('SELECT count(*)::int AS count FROM core.empresas WHERE nombre_comercial = $1', [`${marker}_BAD_PATH`])).rows[0].count === 0, 'A rejected provider creation left a company behind.');

    // 13. Historical company WITHOUT a config row: GET tolerates it, PATCH creates it (upsert).
    const historical = await request('POST', '/providers', { commercialName: `${marker}_HISTORICAL`, providerType: 'PROVEEDOR', rutaDropbox: 'PROVEEDORES/Synthetic Historical' });
    assert(historical.status === 201, 'Historical fixture creation failed.');
    const historicalId = historical.body.data.id;
    companyIds.add(historicalId);
    await pool.query('DELETE FROM core.empresas_notificacion_pago WHERE empresa_id = $1', [historicalId]);
    const historicalGet = await request('GET', `/companies/${historicalId}/payment-notification-settings`);
    assert(historicalGet.status === 200 && historicalGet.body.data.processesPaymentReceipts === false && historicalGet.body.data.notificationsActive === false && historicalGet.body.data.dropboxPath === 'PROVEEDORES/Synthetic Historical', `GET for a company without a row failed: ${JSON.stringify(historicalGet.body)}`);
    assert((await pool.query('SELECT 1 FROM core.empresas_notificacion_pago WHERE empresa_id = $1', [historicalId])).rows.length === 0, 'GET wrote a row for a historical company.');
    const historicalPatch = await request('PATCH', `/companies/${historicalId}/payment-notification-settings`, { processesPaymentReceipts: true });
    assert(historicalPatch.status === 200 && historicalPatch.body.data.processesPaymentReceipts === true, `PATCH did not upsert the missing row: ${JSON.stringify(historicalPatch.body)}`);
    const upserted = await settingsRow(historicalId);
    assert(upserted && upserted.processes === true && upserted.active === false && upserted.destination === 'PROVEEDORES\\Synthetic Historical\\PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}', `Upserted row is wrong: ${JSON.stringify(upserted)}`);
    await pool.query('DELETE FROM core.empresas_notificacion_pago WHERE empresa_id = $1', [historicalId]);
    const pathChangeHistorical = await request('PATCH', `/providers/${historicalId}`, { rutaDropbox: 'PROVEEDORES/Synthetic Moved' });
    assert(pathChangeHistorical.status === 200, 'Changing the path of a historical company failed.');
    const recreated = await settingsRow(historicalId);
    assert(recreated && recreated.active === false && recreated.processes === false && recreated.destination.startsWith('PROVEEDORES\\Synthetic Moved\\'), 'A path change on a historical company must create a safe false/false row with the new destination.');

    // 13b. P1: a historical ruta_destino template survives a ruta_dropbox change (prefix swapped, sub-path
    // verbatim); a standard destination is regenerated; an unrelated one is left alone. Synthetic companies only
    // (cleaned up with the rest of companyIds), flags never change.
    const STANDARD_SUFFIX = 'PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}';
    const protectCase = async (label, storedDestination, newPath) => {
      const created = await request('POST', '/providers', { commercialName: `${marker}_P1_${label}`, providerType: 'PROVEEDOR', rutaDropbox: `PROVEEDORES/Synthetic P1 ${label}` });
      assert(created.status === 201, `P1 fixture ${label} was not created: ${JSON.stringify(created.body)}`);
      const id = created.body.data.id;
      companyIds.add(id);
      if (storedDestination !== null) await pool.query('UPDATE core.empresas_notificacion_pago SET ruta_destino = $2 WHERE empresa_id = $1', [id, storedDestination]);
      const before = await settingsRow(id);
      const moved = await request('PATCH', `/providers/${id}`, { rutaDropbox: newPath });
      assert(moved.status === 200, `P1 ${label}: changing the path failed: ${JSON.stringify(moved.body)}`);
      const after = await settingsRow(id);
      assert(after.active === before.active && after.processes === before.processes && after.active === false && after.processes === false, `P1 ${label}: the flags changed.`);
      return after;
    };
    const historicalDestination = 'PROVEEDORES\\Synthetic P1 HIST\\PAGO PROVEEDOR\\{ANIO}\\{MES_NOMBRE_TITULO}';
    assert((await protectCase('HIST', historicalDestination, 'PROVEEDORES/Synthetic P1 HIST Moved')).destination === 'PROVEEDORES\\Synthetic P1 HIST Moved\\PAGO PROVEEDOR\\{ANIO}\\{MES_NOMBRE_TITULO}', 'P1: the historical sub-path was not preserved.');
    assert((await protectCase('STD', null, 'PROVEEDORES/Synthetic P1 STD Moved')).destination === `PROVEEDORES\\Synthetic P1 STD Moved\\${STANDARD_SUFFIX}`, 'P1: a standard destination was not regenerated for the new path.');
    assert((await protectCase('UNREL', 'OTRA CARPETA SYNTHETIC\\PAGOS\\{ANIO}', 'PROVEEDORES/Synthetic P1 UNREL Moved')).destination === 'OTRA CARPETA SYNTHETIC\\PAGOS\\{ANIO}', 'P1: an unrelated destination was overwritten.');

    // 14. Error contract and BIGINT ids.
    let missingId = '9007199254740993';
    while ((await pool.query('SELECT 1 FROM core.empresas WHERE empresa_id = $1', [missingId])).rows.length) missingId = (BigInt(missingId) + 1n).toString();
    assert((await request('GET', `/companies/${missingId}/payment-notification-settings`)).status === 404, 'Unknown company did not 404 on GET.');
    assert((await request('PATCH', `/companies/${missingId}/payment-notification-settings`, { notificationsActive: false })).status === 404, 'Unknown company did not 404 on PATCH.');
    for (const id of ['0', '01', '-1', 'abc', '9223372036854775808']) {
      assert((await request('GET', `/companies/${id}/payment-notification-settings`)).status === 400, `Invalid BIGINT id ${id} was accepted.`);
    }

    // 15. Audit: settings changes ran under the Hub audit context (empresas is audited; the settings table is not).
    const auditColumns = new Set((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'audit' AND table_name = 'cambios'")).rows.map((row) => row.column_name));
    const originColumn = ['origin', 'origen'].find((column) => auditColumns.has(column));
    const tableColumn = ['table_name', 'tabla'].find((column) => auditColumns.has(column));
    const audit = await pool.query(`SELECT ${tableColumn} AS table_name, ${originColumn} AS origin FROM audit.cambios WHERE request_id = ANY($1::text[])`, [[...requestIds]]);
    assert(audit.rows.some((row) => row.table_name === 'empresas') && audit.rows.some((row) => row.table_name === 'medios_contacto') && audit.rows.every((row) => row.origin === 'DAUBERT_HUB'), 'Hub mutations were not audited under the Hub origin.');

    console.log('Payment notification settings integration checks passed.');
  } catch (error) {
    if (api) console.error(startup || 'No API startup output.');
    throw error;
  } finally {
    if (api && !api.killed) {
      api.kill('SIGTERM');
      await Promise.race([once(api, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    if (verified) {
      try {
        assert((await pool.query('SELECT current_database() AS name')).rows[0].name === 'daubert_hub_test', 'Cleanup database mismatch.');
        const current = await pool.query('SELECT empresa_id::text AS id FROM core.empresas WHERE left(nombre_comercial, length($1)) = $1', [marker]);
        current.rows.forEach((row) => companyIds.add(row.id));
        if (companyIds.size > 0) {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB_TEST_CLEANUP']);
            await client.query("SELECT set_config('app.request_id', $1, true)", [cleanupRequestId]);
            const ids = [...companyIds];
            await client.query('DELETE FROM core.medios_contacto WHERE contacto_id IN (SELECT contacto_id FROM core.contactos WHERE empresa_id = ANY($1::bigint[]))', [ids]);
            await client.query('DELETE FROM core.contactos WHERE empresa_id = ANY($1::bigint[])', [ids]);
            await client.query('DELETE FROM core.empresas_notificacion_pago WHERE empresa_id = ANY($1::bigint[])', [ids]);
            await client.query('DELETE FROM core.alias_empresa WHERE empresa_id = ANY($1::bigint[])', [ids]);
            await client.query('DELETE FROM core.empresas_fiscales WHERE empresa_id = ANY($1::bigint[])', [ids]);
            await client.query('DELETE FROM core.empresa_roles WHERE empresa_id = ANY($1::bigint[])', [ids]);
            await client.query('DELETE FROM core.empresas WHERE empresa_id = ANY($1::bigint[])', [ids]);
            await client.query('COMMIT');
          } catch (cleanupError) {
            await client.query('ROLLBACK');
            throw cleanupError;
          } finally {
            client.release();
          }
        }
        await pool.query('DELETE FROM audit.cambios WHERE request_id = ANY($1::text[])', [[...requestIds]]);
        const leftovers = await pool.query('SELECT count(*)::int AS count FROM core.empresas WHERE left(nombre_comercial, length($1)) = $1', [marker]);
        assert(leftovers.rows[0].count === 0, `Cleanup left company fixtures for marker ${marker}.`);
        console.log(`Payment notification settings cleanup verified for exact marker ${marker}.`);
      } catch (cleanupFailure) {
        console.error(`CLEANUP FAILED: ${cleanupFailure.message}`);
        process.exitCode = 1;
      }
    }
    await cleanupAuthenticatedTestSession(authSession);
    await pool.end();
  }
}

run().catch((error) => { console.error(error.message); process.exitCode = 1; });
