const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { Pool } = require('pg');

const port = 3102;
const marker = `HUB_TEST_PROVIDER_${randomUUID().replace(/-/g, '').toUpperCase()}`;
const cleanupRequestId = `cleanup-${randomUUID()}`;
const createdIds = new Set();
const requestIds = new Set([cleanupRequestId]);

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
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {
      // The process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for the API integration server.');
}

async function postProvider(payload, requestId) {
  const response = await fetch(`http://127.0.0.1:${port}/api/providers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  return { response, body };
}

async function getProviders(query = '') {
  const response = await fetch(`http://127.0.0.1:${port}/api/providers${query}`);
  const body = await response.json();
  return { response, body };
}

async function getProvider(id) {
  const response = await fetch(`http://127.0.0.1:${port}/api/providers/${id}`);
  const body = await response.json();
  return { response, body };
}

async function getContactDirectory(path = '') {
  const response = await fetch(`http://127.0.0.1:${port}/api/contact-directory/companies${path}`);
  const body = await response.json();
  return { response, body };
}

async function patchProvider(id, payload, requestId) {
  const response = await fetch(`http://127.0.0.1:${port}/api/providers/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  return { response, body };
}

async function changeProviderStatus(id, action, requestId) {
  const response = await fetch(`http://127.0.0.1:${port}/api/providers/${id}/${action}`, {
    method: 'POST', headers: { 'x-request-id': requestId }
  });
  const body = await response.json();
  return { response, body };
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

async function run() {
  const { url, databaseName } = parseTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let api;
  try {
    const currentDatabase = (await pool.query('SELECT current_database() AS name')).rows[0].name;
    assert(currentDatabase === 'daubert_hub_test', `Active session database mismatch: ${currentDatabase}`);
    console.log(`Integration database verified: ${databaseName}`);

    const auditColumns = new Set((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'audit' AND table_name = 'cambios'")).rows.map((row) => row.column_name));
    const auditOriginColumn = ['origin', 'origen'].find((column) => auditColumns.has(column));
    assert(auditOriginColumn && auditColumns.has('request_id'), `audit.cambios must expose origin/origen and request_id columns. Available: ${[...auditColumns].join(', ')}`);
    const auditTableColumn = ['table_name', 'tabla'].find((column) => auditColumns.has(column));
    assert(auditTableColumn, 'audit.cambios must expose a table name column for audit verification.');
    const auditSchemaColumn = ['table_schema', 'esquema'].find((column) => auditColumns.has(column));
    assert(auditSchemaColumn, 'audit.cambios must expose a schema name column for audit verification.');

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
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let startupOutput = '';
    api.stdout.on('data', (chunk) => { startupOutput += chunk; });
    api.stderr.on('data', (chunk) => { startupOutput += chunk; });
    await waitForApi();

    const directory = await getContactDirectory('?page=1&pageSize=25');
    assert(directory.response.status === 200 && directory.body.data.length > 0 && directory.body.data.every((company) => typeof company.id === 'string' && Number.isInteger(company.contactCount)), 'Contact directory list failed or did not preserve company IDs/counts.');
    const directoryDetail = await getContactDirectory(`/${directory.body.data[0].id}`);
    assert(directoryDetail.response.status === 200 && Array.isArray(directoryDetail.body.data.contacts), 'Contact directory detail failed.');
    assert(!JSON.stringify(directoryDetail.body).includes('recibe_notificacion_pago') && !JSON.stringify(directoryDetail.body).includes('tipo_destinatario_pago'), 'Contact directory exposed payment routing fields.');
    const adhecintasDirectory = await getContactDirectory('/99');
    assert(adhecintasDirectory.response.status === 200 && adhecintasDirectory.body.data.contacts.length === 4 && adhecintasDirectory.body.data.contacts.every((contact) => contact.methods.length > 0 && contact.methods.every((method) => method.type === 'CORREO' && typeof method.value === 'string' && method.value.trim())), 'Contact directory did not return ADHECINTAS active contact methods with values.');

    const noFiscalRequestId = `provider-${randomUUID()}`;
    requestIds.add(noFiscalRequestId);
    const noFiscal = await postProvider({ commercialName: `${marker}_NO_FISCAL`, providerType: 'PROVEEDOR', fiscal: null, notes: null }, noFiscalRequestId);
    assert(noFiscal.response.status === 201, `Provider without fiscal failed: ${JSON.stringify(noFiscal.body)}`);
    assert(noFiscal.body.data.fiscal === null, 'Provider without fiscal returned fiscal data.');
    assert(noFiscal.response.headers.get('x-request-id') === noFiscalRequestId, 'Provider response did not preserve x-request-id.');
    createdIds.add(noFiscal.body.data.id);

    const fiscalRequestId = `provider-${randomUUID()}`;
    requestIds.add(fiscalRequestId);
    const fiscalRfc = `HUB${String(Date.now()).slice(-6)}ABC`;
    const withFiscal = await postProvider({ commercialName: `${marker}_WITH_FISCAL`, providerType: 'SERVICIO', fiscal: { legalName: '  Hub Test Legal Name  ', rfc: fiscalRfc.toLowerCase() }, notes: '  integration note  ' }, fiscalRequestId);
    assert(withFiscal.response.status === 201, `Provider with fiscal failed: ${JSON.stringify(withFiscal.body)}`);
    assert(withFiscal.body.data.fiscal.rfc === fiscalRfc, 'RFC was not normalized to uppercase.');
    assert(withFiscal.response.headers.get('x-request-id') === fiscalRequestId, 'Fiscal response did not preserve x-request-id.');
    createdIds.add(withFiscal.body.data.id);

    const freightRequestId = `provider-${randomUUID()}`;
    requestIds.add(freightRequestId);
    const freight = await postProvider({ commercialName: `${marker}_FREIGHT`, providerType: 'FLETE' }, freightRequestId);
    assert(freight.response.status === 201, `Freight provider failed: ${JSON.stringify(freight.body)}`);
    createdIds.add(freight.body.data.id);

    const freightFiscalRequestId = `provider-fiscal-${randomUUID()}`;
    requestIds.add(freightFiscalRequestId);
    await queryWithAuditContext(pool, freightFiscalRequestId, 'INSERT INTO core.empresas_fiscales (empresa_id, razon_social, rfc, es_vigente) VALUES ($1, $2, $3, TRUE)', [freight.body.data.id, 'alpha freight legal name', `FRT${String(Date.now()).slice(-6)}XYZ`]);

    const historicalFiscalRequestId = `provider-fiscal-${randomUUID()}`;
    requestIds.add(historicalFiscalRequestId);
    await queryWithAuditContext(pool, historicalFiscalRequestId, 'INSERT INTO core.empresas_fiscales (empresa_id, razon_social, rfc, es_vigente) VALUES ($1, $2, $3, FALSE)', [withFiscal.body.data.id, 'Historical Hub Test Legal Name', `OLD${String(Date.now()).slice(-6)}XYZ`]);

    const noFiscalDetail = await getProvider(noFiscal.body.data.id);
    assert(noFiscalDetail.response.status === 200, `Provider detail without fiscal failed: ${JSON.stringify(noFiscalDetail.body)}`);
    assert(typeof noFiscalDetail.body.data.id === 'string' && noFiscalDetail.body.data.id === noFiscal.body.data.id, 'Provider detail returned a non-string or incorrect ID.');
    assert(noFiscalDetail.body.data.providerType === 'PROVEEDOR' && noFiscalDetail.body.data.roles.join(',') === 'PROVEEDOR', 'Provider detail did not return the active provider role.');
    assert(noFiscalDetail.body.data.fiscal === null, 'Provider detail without fiscal returned fiscal data.');
    const fiscalDetail = await getProvider(withFiscal.body.data.id);
    assert(fiscalDetail.response.status === 200, `Provider detail with fiscal failed: ${JSON.stringify(fiscalDetail.body)}`);
    assert(fiscalDetail.body.data.fiscal && fiscalDetail.body.data.fiscal.id === withFiscal.body.data.fiscal.id && fiscalDetail.body.data.fiscal.legalName === 'Hub Test Legal Name' && fiscalDetail.body.data.fiscal.rfc === fiscalRfc, 'Provider detail did not select only the current fiscal record.');

    const clientRequestId = `provider-client-${randomUUID()}`;
    requestIds.add(clientRequestId);
    const clientCompany = await queryWithAuditContext(pool, clientRequestId, 'INSERT INTO core.empresas (tipo_empresa, nombre_comercial) VALUES ($1, $2) RETURNING empresa_id::text', ['CLIENTE', `${marker}_CLIENTE`]);
    createdIds.add(clientCompany.rows[0].empresa_id);
    await queryWithAuditContext(pool, clientRequestId, "INSERT INTO core.empresa_roles (empresa_id, rol) VALUES ($1, 'CLIENTE')", [clientCompany.rows[0].empresa_id]);
    const otherRequestId = `provider-other-${randomUUID()}`;
    requestIds.add(otherRequestId);
    const otherCompany = await queryWithAuditContext(pool, otherRequestId, 'INSERT INTO core.empresas (tipo_empresa, nombre_comercial) VALUES ($1, $2) RETURNING empresa_id::text', ['OTRO', `${marker}_OTHER`]);
    createdIds.add(otherCompany.rows[0].empresa_id);
    await queryWithAuditContext(pool, otherRequestId, "INSERT INTO core.empresa_roles (empresa_id, rol) VALUES ($1, 'OTRO')", [otherCompany.rows[0].empresa_id]);
    const aliasRequestId = `provider-alias-${randomUUID()}`;
    requestIds.add(aliasRequestId);
    const exactAlias = `${marker}_ALIAS_EXACT`;
    const sharedAlias = `${marker}_ALIAS_MULTI`;
    await queryWithAuditContext(pool, aliasRequestId,
      'INSERT INTO core.alias_empresa (empresa_id, alias, alias_normalizado, tipo_alias, estatus) VALUES ($1, $2, $2, $3, $4), ($1, $5, $5, $3, $4), ($1, $6, $6, $3, $4), ($7, $8, $8, $3, $4), ($9, $10, $10, $3, $4)',
      [noFiscal.body.data.id, exactAlias, 'NOMBRE_COMERCIAL_ALTERNATIVO', 'ACTIVO', `${sharedAlias}_ONE`, `${sharedAlias}_THREE`, withFiscal.body.data.id, `${sharedAlias}_TWO`, clientCompany.rows[0].empresa_id, `${marker}_CLIENT_ONLY_ALIAS`]);
    for (const id of [clientCompany.rows[0].empresa_id, otherCompany.rows[0].empresa_id, '999999999999999']) {
      const nonProviderDetail = await getProvider(id);
      assert(nonProviderDetail.response.status === 404, `Non-provider detail ${id} did not return 404.`);
    }
    for (const id of ['0', '-1', '1.5', 'abc']) {
      const invalidDetail = await getProvider(id);
      assert(invalidDetail.response.status === 400, `Invalid provider ID ${id} did not return 400.`);
    }

    const exactAliasSearch = await getProviders(`?search=${encodeURIComponent(`  ${exactAlias.toLowerCase()}  `)}`);
    assert(exactAliasSearch.response.status === 200 && exactAliasSearch.body.meta.total === 1 && exactAliasSearch.body.data[0].id === noFiscal.body.data.id, 'Exact, trimmed, case-insensitive alias search failed.');
    const partialAliasSearch = await getProviders(`?search=${encodeURIComponent('alias_exact')}`);
    assert(partialAliasSearch.body.meta.total === 1 && partialAliasSearch.body.data[0].id === noFiscal.body.data.id, 'Partial alias search failed.');
    const sharedAliasSearch = await getProviders(`?search=${encodeURIComponent(sharedAlias)}&sortBy=commercialName&sortOrder=asc&page=1&pageSize=1`);
    assert(sharedAliasSearch.body.meta.total === 2 && sharedAliasSearch.body.meta.totalPages === 2 && sharedAliasSearch.body.data.length === 1 && sharedAliasSearch.body.data[0].id === noFiscal.body.data.id, 'Alias search duplicated a provider or did not paginate after sorting.');
    const sharedAliasSecondPage = await getProviders(`?search=${encodeURIComponent(sharedAlias)}&sortBy=commercialName&sortOrder=asc&page=2&pageSize=1`);
    assert(sharedAliasSecondPage.body.data.length === 1 && sharedAliasSecondPage.body.data[0].id === withFiscal.body.data.id, 'Alias search pagination is incorrect.');
    const aliasWithType = await getProviders(`?search=${encodeURIComponent(sharedAlias)}&providerType=PROVEEDOR`);
    assert(aliasWithType.body.meta.total === 1 && aliasWithType.body.data[0].id === noFiscal.body.data.id, 'Alias search did not compose with provider type filtering.');
    const clientOnlyAliasSearch = await getProviders(`?search=${encodeURIComponent(`${marker}_CLIENT_ONLY_ALIAS`)}`);
    assert(clientOnlyAliasSearch.body.meta.total === 0, 'CLIENTE-only alias exposed a non-provider.');

    const listed = await getProviders(`?search=${encodeURIComponent(`  ${marker.toLowerCase()}  `)}`);
    assert(listed.response.status === 200, `Provider listing failed: ${JSON.stringify(listed.body)}`);
    assert(listed.body.meta.total === 3 && listed.body.meta.page === 1 && listed.body.meta.pageSize === 25 && listed.body.meta.totalPages === 1, 'Provider listing defaults or count are incorrect.');
    assert(listed.body.data.map((provider) => provider.commercialName).join(',') === [`${marker}_FREIGHT`, `${marker}_NO_FISCAL`, `${marker}_WITH_FISCAL`].join(','), 'Provider listing order is not deterministic by commercial name.');
    assert(listed.body.data.every((provider) => typeof provider.id === 'string'), 'Provider listing returned a non-string company ID.');
    const listedFiscal = listed.body.data.find((provider) => provider.id === withFiscal.body.data.id);
    assert(listedFiscal.fiscal && listedFiscal.fiscal.id === withFiscal.body.data.fiscal.id && listedFiscal.fiscal.legalName === 'Hub Test Legal Name', 'Provider listing did not select the current fiscal record.');

    const deactivateRequestId = `provider-deactivate-${randomUUID()}`;
    requestIds.add(deactivateRequestId);
    const deactivated = await changeProviderStatus(noFiscal.body.data.id, 'deactivate', deactivateRequestId);
    assert(deactivated.response.status === 201 && deactivated.body.data.status === 'INACTIVO', `Provider deactivation failed: ${JSON.stringify(deactivated.body)}`);
    const defaultAfterDeactivate = await getProviders(`?search=${encodeURIComponent(marker)}`);
    assert(defaultAfterDeactivate.body.meta.total === 2 && defaultAfterDeactivate.body.data.every((provider) => provider.id !== noFiscal.body.data.id), 'Default directory included an inactive provider.');
    const inactiveDirectory = await getProviders(`?search=${encodeURIComponent(marker)}&status=INACTIVO`);
    assert(inactiveDirectory.body.meta.total === 1 && inactiveDirectory.body.data[0].id === noFiscal.body.data.id, 'Inactive directory filter is incorrect.');
    const allDirectory = await getProviders(`?search=${encodeURIComponent(marker)}&status=ALL`);
    assert(allDirectory.body.meta.total === 3, 'All directory filter did not include active and inactive providers.');
    const inactiveDetail = await getProvider(noFiscal.body.data.id);
    assert(inactiveDetail.response.status === 200 && inactiveDetail.body.data.status === 'INACTIVO' && inactiveDetail.body.data.roles.join(',') === 'PROVEEDOR' && inactiveDetail.body.data.fiscal === null, 'Deactivation changed provider membership or detail data.');
    const repeatedDeactivate = await changeProviderStatus(noFiscal.body.data.id, 'deactivate', `provider-deactivate-${randomUUID()}`);
    assert(repeatedDeactivate.response.status === 409 && repeatedDeactivate.body.code === 'PROVIDER_ALREADY_INACTIVE', 'Repeated deactivation did not return the expected conflict.');
    const reactivateRequestId = `provider-reactivate-${randomUUID()}`;
    requestIds.add(reactivateRequestId);
    const reactivated = await changeProviderStatus(noFiscal.body.data.id, 'reactivate', reactivateRequestId);
    assert(reactivated.response.status === 201 && reactivated.body.data.status === 'ACTIVO', `Provider reactivation failed: ${JSON.stringify(reactivated.body)}`);
    const lifecycleAudit = await pool.query(`SELECT ${auditTableColumn} AS table_name FROM audit.cambios WHERE ${auditOriginColumn} = $1 AND request_id = ANY($2::text[])`, ['DAUBERT_HUB', [deactivateRequestId, reactivateRequestId]]);
    assert(lifecycleAudit.rows.length === 2 && lifecycleAudit.rows.every((row) => row.table_name === 'empresas'), 'Lifecycle audit touched tables other than core.empresas.');

    const commercialDescending = await getProviders(`?search=${encodeURIComponent(marker)}&sortBy=commercialName&sortOrder=desc`);
    assert(commercialDescending.body.data.map((provider) => provider.commercialName).join(',') === [`${marker}_WITH_FISCAL`, `${marker}_NO_FISCAL`, `${marker}_FREIGHT`].join(','), 'Descending commercial-name sorting is incorrect.');
    const typeAscending = await getProviders(`?search=${encodeURIComponent(marker)}&sortBy=providerType&sortOrder=asc`);
    assert(typeAscending.body.data.map((provider) => provider.providerType).join(',') === 'PROVEEDOR,SERVICIO,FLETE', 'Ascending provider-type business sorting is incorrect.');
    const typeDescending = await getProviders(`?search=${encodeURIComponent(marker)}&sortBy=providerType&sortOrder=desc`);
    assert(typeDescending.body.data.map((provider) => provider.providerType).join(',') === 'FLETE,SERVICIO,PROVEEDOR', 'Descending provider-type business sorting is incorrect.');
    const legalAscending = await getProviders(`?search=${encodeURIComponent(marker)}&sortBy=legalName&sortOrder=asc`);
    assert(legalAscending.body.data.map((provider) => provider.id).join(',') === [freight.body.data.id, withFiscal.body.data.id, noFiscal.body.data.id].join(','), 'Ascending legal-name sorting or NULLS LAST behavior is incorrect.');
    const legalDescending = await getProviders(`?search=${encodeURIComponent(marker)}&sortBy=legalName&sortOrder=desc`);
    assert(legalDescending.body.data.map((provider) => provider.id).join(',') === [withFiscal.body.data.id, freight.body.data.id, noFiscal.body.data.id].join(','), 'Descending legal-name sorting or NULLS LAST behavior is incorrect.');

    for (const [providerType, expectedId] of [['PROVEEDOR', noFiscal.body.data.id], ['SERVICIO', withFiscal.body.data.id], ['FLETE', freight.body.data.id]]) {
      const filtered = await getProviders(`?search=${encodeURIComponent(marker)}&providerType=${providerType}`);
      assert(filtered.body.meta.total === 1 && filtered.body.data[0].id === expectedId, `Provider type filter ${providerType} is incorrect.`);
    }

    const legalNameSearch = await getProviders(`?search=${encodeURIComponent('hub test legal')}`);
    assert(legalNameSearch.body.meta.total === 1 && legalNameSearch.body.data[0].id === withFiscal.body.data.id, 'Case-insensitive legal-name search is incorrect.');
    const rfcSearch = await getProviders(`?search=${encodeURIComponent(fiscalRfc.toLowerCase())}`);
    assert(rfcSearch.body.meta.total === 1 && rfcSearch.body.data[0].id === withFiscal.body.data.id, 'Case-insensitive RFC search is incorrect.');
    const historicalSearch = await getProviders('?search=historical%20hub%20test');
    assert(historicalSearch.body.meta.total === 0, 'Historical fiscal data was included in provider search.');
    const noResults = await getProviders('?search=not-a-provider-in-this-test');
    assert(noResults.body.meta.total === 0 && noResults.body.data.length === 0, 'Empty provider search is incorrect.');
    const paged = await getProviders(`?search=${encodeURIComponent(marker)}&sortBy=commercialName&sortOrder=desc&page=1&pageSize=1`);
    assert(paged.body.meta.total === 3 && paged.body.meta.page === 1 && paged.body.meta.pageSize === 1 && paged.body.meta.totalPages === 3 && paged.body.data.length === 1 && paged.body.data[0].id === withFiscal.body.data.id, 'Provider listing pagination did not apply after sorting.');
    const invalidListing = await getProviders('?providerType=CLIENTE&page=0&pageSize=101&sortBy=rfc&sortOrder=up');
    assert(invalidListing.response.status === 400, 'Invalid provider listing query did not return 400.');

    const extraRoleRequestId = `provider-role-${randomUUID()}`;
    requestIds.add(extraRoleRequestId);
    await queryWithAuditContext(pool, extraRoleRequestId, "INSERT INTO core.empresa_roles (empresa_id, rol, estatus) VALUES ($1, 'FLETE', 'ACTIVO')", [noFiscal.body.data.id]);
    await queryWithAuditContext(pool, extraRoleRequestId, "INSERT INTO core.empresa_roles (empresa_id, rol, estatus) VALUES ($1, 'CLIENTE', 'ACTIVO')", [noFiscal.body.data.id]);
    const multiRoleDetail = await getProvider(noFiscal.body.data.id);
    assert(multiRoleDetail.response.status === 200 && multiRoleDetail.body.data.providerType === 'PROVEEDOR' && multiRoleDetail.body.data.roles.join(',') === 'PROVEEDOR,FLETE,CLIENTE', 'Provider detail did not return deterministically ordered active roles.');
    const freightRoles = await getProviders(`?search=${encodeURIComponent(marker)}&providerType=FLETE`);
    assert(freightRoles.body.meta.total === 2 && freightRoles.body.data.filter((provider) => provider.id === noFiscal.body.data.id).length === 1, 'Provider listing did not deduplicate companies with multiple active roles.');
    const inactiveRoleRequestId = `provider-role-${randomUUID()}`;
    requestIds.add(inactiveRoleRequestId);
    await queryWithAuditContext(pool, inactiveRoleRequestId, "UPDATE core.empresa_roles SET estatus = 'INACTIVO' WHERE empresa_id = $1 AND rol = 'FLETE'", [freight.body.data.id]);
    const activeRoles = await getProviders(`?search=${encodeURIComponent(marker)}`);
    assert(activeRoles.body.meta.total === 2 && activeRoles.body.data.every((provider) => provider.id !== freight.body.data.id), 'Provider listing included a company with only an inactive provider role.');

    const mappedRows = await pool.query("SELECT e.tipo_empresa, r.rol FROM core.empresas e JOIN core.empresa_roles r ON r.empresa_id = e.empresa_id WHERE e.empresa_id = ANY($1::bigint[]) AND r.rol IN ('PROVEEDOR', 'SERVICIO', 'FLETE')", [[...createdIds]]);
    const primaryRoleRows = mappedRows.rows.filter((row) => row.tipo_empresa === row.rol);
    assert(primaryRoleRows.length === 3, 'Provider type and role mapping is incorrect.');
    assert(new Set(primaryRoleRows.map((row) => row.tipo_empresa)).size === 3, 'PROVEEDOR, SERVICIO, and FLETE were not all persisted.');

    const duplicateNameRequestId = `provider-${randomUUID()}`;
    requestIds.add(duplicateNameRequestId);
    const duplicateName = await postProvider({ commercialName: `  ${marker.toLowerCase()}_no_fiscal  `, providerType: 'PROVEEDOR' }, duplicateNameRequestId);
    assert(duplicateName.response.status === 409 && duplicateName.body.code === 'PROVIDER_NAME_ALREADY_EXISTS', 'Case-insensitive duplicate commercial name was not rejected.');
    const duplicateNameCount = await pool.query('SELECT count(*)::int AS count FROM core.empresas WHERE lower(btrim(nombre_comercial)) = lower(btrim($1))', [`${marker}_NO_FISCAL`]);
    assert(duplicateNameCount.rows[0].count === 1, 'Duplicate commercial name left a partial company.');

    const duplicateRfcRequestId = `provider-${randomUUID()}`;
    requestIds.add(duplicateRfcRequestId);
    const rollbackName = `${marker}_RFC_ROLLBACK`;
    const duplicateRfc = await postProvider({ commercialName: rollbackName, providerType: 'PROVEEDOR', fiscal: { legalName: 'Rollback Test', rfc: fiscalRfc } }, duplicateRfcRequestId);
    assert(duplicateRfc.response.status === 409 && duplicateRfc.body.code === 'RFC_ALREADY_EXISTS', 'Duplicate RFC was not rejected.');
    const rollbackRows = await pool.query('SELECT e.empresa_id, r.rol FROM core.empresas e LEFT JOIN core.empresa_roles r ON r.empresa_id = e.empresa_id WHERE e.nombre_comercial = $1', [rollbackName]);
    assert(rollbackRows.rows.length === 0, 'Duplicate RFC rollback left an orphan company or role.');

    const invalid = await postProvider({ commercialName: `${marker}_INVALID`, providerType: 'CLIENTE', fiscal: { legalName: 'Only legal name' } }, `provider-${randomUUID()}`);
    assert(invalid.response.status === 400, 'Invalid payload did not return 400.');
    const invalidCount = await pool.query('SELECT count(*)::int AS count FROM core.empresas WHERE nombre_comercial = $1', [`${marker}_INVALID`]);
    assert(invalidCount.rows[0].count === 0, 'Invalid payload touched PostgreSQL.');

    const auditRows = await pool.query(`SELECT ${auditSchemaColumn} AS schema_name, ${auditTableColumn} AS table_name, ${auditOriginColumn} AS origin, request_id FROM audit.cambios WHERE ${auditOriginColumn} = $1 AND request_id = $2`, ['DAUBERT_HUB', fiscalRequestId]);
    assert(auditRows.rows.length >= 3, 'Expected audit rows were not created.');
    const auditedTables = new Set(auditRows.rows.map((row) => `${row.schema_name}.${row.table_name}`));
    ['core.empresas', 'core.empresa_roles', 'core.empresas_fiscales'].forEach((table) => assert(auditedTables.has(table), `Missing audit row for ${table}.`));
    assert(auditRows.rows.every((row) => row.origin === 'DAUBERT_HUB' && row.request_id === fiscalRequestId), 'Audit context is inconsistent.');

    const editRequestId = `provider-edit-${randomUUID()}`;
    requestIds.add(editRequestId);
    const editedName = `${marker}_WITH_FISCAL_EDITED`;
    const edited = await patchProvider(withFiscal.body.data.id, { commercialName: editedName, providerType: 'FLETE', notes: '  corrected note  ', fiscal: { legalName: 'Corrected Legal Name', rfc: fiscalRfc } }, editRequestId);
    assert(edited.response.status === 200, `Provider edit failed: ${JSON.stringify(edited.body)}`);
    assert(edited.body.data.commercialName === editedName && edited.body.data.providerType === 'FLETE' && edited.body.data.notes === 'corrected note', 'Provider edit response is incorrect.');
    const editState = await pool.query('SELECT e.tipo_empresa, r.rol, f.razon_social, f.rfc FROM core.empresas e JOIN core.empresa_roles r ON r.empresa_id = e.empresa_id JOIN core.empresas_fiscales f ON f.empresa_id = e.empresa_id AND f.es_vigente = TRUE WHERE e.empresa_id = $1', [withFiscal.body.data.id]);
    assert(editState.rows.length === 1 && editState.rows[0].tipo_empresa === 'FLETE' && editState.rows[0].rol === 'FLETE' && editState.rows[0].razon_social === 'Corrected Legal Name', 'Provider type or fiscal correction was not synchronized.');

    const correctionRequestId = `provider-rfc-correction-${randomUUID()}`;
    requestIds.add(correctionRequestId);
    const correctedRfc = `CRR${String(Date.now()).slice(-6)}XYZ`;
    const correction = await patchProvider(withFiscal.body.data.id, { commercialName: editedName, providerType: 'FLETE', notes: 'corrected note', fiscal: { legalName: 'Corrected Legal Name', rfc: correctedRfc, changeMode: 'CORRECTION' } }, correctionRequestId);
    assert(correction.response.status === 200 && correction.body.data.fiscal.rfc === correctedRfc, 'RFC correction failed.');
    const correctionCount = await pool.query('SELECT count(*)::int AS count FROM core.empresas_fiscales WHERE empresa_id = $1', [withFiscal.body.data.id]);
    assert(correctionCount.rows[0].count === 2, 'RFC correction created a historical identity.');

    const identityRequestId = `provider-new-identity-${randomUUID()}`;
    requestIds.add(identityRequestId);
    const newRfc = `NEW${String(Date.now()).slice(-6)}XYZ`;
    const identity = await patchProvider(withFiscal.body.data.id, { commercialName: editedName, providerType: 'FLETE', notes: 'corrected note', fiscal: { legalName: 'New Legal Identity', rfc: newRfc, changeMode: 'NEW_IDENTITY', effectiveStartDate: '2026-08-21' } }, identityRequestId);
    assert(identity.response.status === 200 && identity.body.data.fiscal.rfc === newRfc, 'New fiscal identity failed.');
    const identities = await pool.query('SELECT rfc, es_vigente, fecha_inicio::text, fecha_fin::text FROM core.empresas_fiscales WHERE empresa_id = $1 ORDER BY empresa_fiscal_id', [withFiscal.body.data.id]);
    assert(identities.rows.filter((row) => row.es_vigente).length === 1 && identities.rows.some((row) => row.rfc === correctedRfc && !row.es_vigente && row.fecha_fin === '2026-08-21') && identities.rows.some((row) => row.rfc === newRfc && row.es_vigente && row.fecha_inicio === '2026-08-21'), 'Fiscal history transition was not preserved.');
    const editAuditRows = await pool.query(`SELECT ${auditSchemaColumn} AS schema_name, ${auditTableColumn} AS table_name, ${auditOriginColumn} AS origin, request_id FROM audit.cambios WHERE ${auditOriginColumn} = $1 AND request_id = $2`, ['DAUBERT_HUB', identityRequestId]);
    assert(editAuditRows.rows.some((row) => row.table_name === 'empresas_fiscales') && editAuditRows.rows.every((row) => row.origin === 'DAUBERT_HUB'), 'Fiscal edit audit context is inconsistent.');
    console.log('Provider integration checks passed.');
  } catch (error) {
    throw error;
  } finally {
    try {
      if (createdIds.size > 0) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB_TEST_CLEANUP']);
          await client.query("SELECT set_config('app.request_id', $1, true)", [cleanupRequestId]);
          await client.query('DELETE FROM core.empresas_fiscales WHERE empresa_id = ANY($1::bigint[])', [[...createdIds]]);
          await client.query('DELETE FROM core.empresa_roles WHERE empresa_id = ANY($1::bigint[])', [[...createdIds]]);
          await client.query('DELETE FROM core.empresas WHERE empresa_id = ANY($1::bigint[])', [[...createdIds]]);
          await client.query('COMMIT');
        } catch (cleanupError) {
          await client.query('ROLLBACK');
          throw cleanupError;
        } finally {
          client.release();
        }
      }
      await pool.query('DELETE FROM audit.cambios WHERE request_id = ANY($1::text[])', [[...requestIds]]);
      const leftovers = await pool.query('SELECT count(*)::int AS count FROM core.empresas WHERE nombre_comercial LIKE $1', ['HUB_TEST_PROVIDER_%']);
      assert(leftovers.rows[0].count === 0, 'Integration test cleanup left provider records.');
      console.log('Integration cleanup verified: no HUB_TEST_PROVIDER records remain.');
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
