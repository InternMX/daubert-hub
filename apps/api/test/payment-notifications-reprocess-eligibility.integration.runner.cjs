// Reprocess eligibility (reprocessAvailable + click-time check) against the REAL SQL in
// daubert_hub_test.
//
// Safety model:
//   - TEST_DATABASE_URL must decode to exactly daubert_hub_test, and the live session is verified.
//   - EVERYTHING (fixtures, configuration changes, queries) runs inside ONE transaction that is
//     ALWAYS rolled back. Nothing is ever committed, so no fixture, company configuration change or
//     result row can remain (identity sequences are non-transactional and may advance).
//   - No HTTP API, no authentication users, no n8n: the real repository/service classes (compiled
//     in dist/) run over that transaction. The webhook client is a local spy, never the real one.
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
require('reflect-metadata');

function assert(condition, message) { if (!condition) throw new Error(message); }

function guardedDatabaseUrl(value) {
  if (!value) throw new Error('TEST_DATABASE_URL must be set for database integration tests.');
  let url;
  try { url = new URL(value); } catch { throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.'); }
  const databaseName = decodeURIComponent(url.pathname).replace(/^\//, '');
  if (databaseName !== 'daubert_hub_test') throw new Error('Payment Notifications reprocess integration tests require exactly daubert_hub_test.');
  return value;
}

const VALID_HASH = 'a1B2c3D4'.repeat(8); // 64 hex chars, mixed case
const SHORT_HASH = VALID_HASH.slice(0, 63);
const results = [];

async function run() {
  const client = new Client({ connectionString: guardedDatabaseUrl(process.env.TEST_DATABASE_URL) });
  await client.connect();
  let transactionOpen = false;
  try {
    const live = (await client.query('SELECT current_database() AS name')).rows[0].name;
    assert(live === 'daubert_hub_test', `Active session database mismatch: ${live}`);
    console.log(`Connected database verified: ${live}`);

    await client.query('BEGIN');
    transactionOpen = true;
    await client.query("SELECT set_config('app.origin', 'DAUBERT_HUB_TEST', true)");
    await client.query("SELECT set_config('app.request_id', $1, true)", [`payment-reprocess-eligibility-${randomUUID()}`]);

    // Every statement issued by the Hub classes goes through here so writes can be detected.
    const hubStatements = [];
    const database = { query: async (sql, params) => { hubStatements.push(sql); return (await client.query(sql, params)).rows; } };

    const { PaymentNotificationsRepository } = require('../dist/src/automations/payment-notifications/payment-notifications.repository');
    const { PaymentNotificationsService } = require('../dist/src/automations/payment-notifications/payment-notifications.service');
    const repository = new PaymentNotificationsRepository(database);
    const webhookCalls = [];
    const webhookClient = { triggerReprocess: async (correoId) => { webhookCalls.push(correoId); return 'ACCEPTED'; } };
    const triggerRequests = { record: async () => undefined };
    const reviewAcknowledgements = { findLatest: async () => null };
    const service = new PaymentNotificationsService(repository, reviewAcknowledgements, webhookClient, triggerRequests);
    const identity = { userId: '1', userEmail: 'integration@example.test' };

    // ---- companies and their (transaction-local) configuration ---------------------------------
    const companyRows = (await client.query('SELECT empresa_id::text AS id FROM core.empresas ORDER BY empresa_id LIMIT 5')).rows;
    assert(companyRows.length === 5, 'Reprocess eligibility fixtures require five existing test companies.');
    const [enabled, disabled, none, procOnly, notifOnly] = companyRows.map((row) => row.id);
    const setConfig = (id, procesa, activas) => client.query(`
      INSERT INTO core.empresas_notificacion_pago (empresa_id, procesa_comprobantes_pago, notificaciones_activas)
      VALUES ($1, $2, $3)
      ON CONFLICT (empresa_id) DO UPDATE SET procesa_comprobantes_pago = EXCLUDED.procesa_comprobantes_pago, notificaciones_activas = EXCLUDED.notificaciones_activas`,
    [id, procesa, activas]);
    await setConfig(enabled, true, true);
    await setConfig(disabled, false, false);
    await setConfig(procOnly, true, false);
    await setConfig(notifOnly, false, true);
    await client.query('DELETE FROM core.empresas_notificacion_pago WHERE empresa_id = $1', [none]);
    const configRows = (await client.query('SELECT count(*)::int AS n FROM core.empresas_notificacion_pago WHERE empresa_id = $1', [none])).rows[0].n;
    assert(configRows === 0, 'Company without configuration fixture could not be prepared.');

    // ---- baseline: historical counts and row count BEFORE adding fixtures -----------------------
    const baselineSql = `
      SELECT correo.correo_id::text AS id, count(resultado.correo_id)::int AS total,
             count(*) FILTER (WHERE resultado.estado = 'LISTO')::int AS ready,
             count(*) FILTER (WHERE resultado.estado = 'MANUAL')::int AS manual,
             count(*) FILTER (WHERE resultado.estado = 'ERROR')::int AS error,
             count(*) FILTER (WHERE resultado.estado = 'OMITIDO')::int AS omitted
      FROM core.correos_notificacion_pago correo
      LEFT JOIN core.resultados_notificacion_pago resultado USING (correo_id)
      GROUP BY correo.correo_id`;
    const baseline = new Map((await client.query(baselineSql)).rows.map((row) => [row.id, row]));
    const resultSnapshotSql = 'SELECT correo_id::text, empresa_id::text, estado, motivo FROM core.resultados_notificacion_pago ORDER BY correo_id, empresa_id';

    // ---- fixtures ---------------------------------------------------------------------------------
    const marker = `HUB_TEST_REPROCESS_ELIGIBILITY_${randomUUID().replace(/-/g, '').toUpperCase()}`;
    const fixtures = [];
    async function fixture(name, estado, resultRows, { detalleError = null, expected }) {
      const correo = (await client.query(
        `INSERT INTO core.correos_notificacion_pago (outlook_message_id, estado, fecha_procesado, detalle_error)
         VALUES ($1, $2, clock_timestamp(), $3) RETURNING correo_id::text AS id`,
        [`${marker}_${fixtures.length}`, estado, detalleError]
      )).rows[0];
      for (const [empresaId, resultEstado] of resultRows) {
        await client.query('INSERT INTO core.resultados_notificacion_pago (correo_id, empresa_id, estado) VALUES ($1, $2, $3)', [correo.id, empresaId, resultEstado]);
      }
      fixtures.push({ name, id: correo.id, expected, resultRows });
      return correo.id;
    }

    await fixture('1. PROCESADO + only LISTO', 'PROCESADO', [[enabled, 'LISTO'], [disabled, 'LISTO']], { expected: false });
    await fixture('2. PROCESADO + MANUAL', 'PROCESADO', [[enabled, 'LISTO'], [disabled, 'MANUAL']], { expected: true });
    await fixture('3. PROCESADO + ERROR per company', 'PROCESADO', [[enabled, 'LISTO'], [disabled, 'ERROR']], { expected: true });
    await fixture('4. PROCESADO + OMITIDO, company disabled (both flags false)', 'PROCESADO', [[disabled, 'OMITIDO']], { expected: false });
    const reactivated = await fixture('5. PROCESADO + OMITIDO, company re-enabled (correo 42 case)', 'PROCESADO', [[enabled, 'OMITIDO']], { expected: true });
    await fixture('6. PROCESADO + valid HASH', 'PROCESADO', [[enabled, 'LISTO']], { detalleError: `13.-X.pdf: ALIAS_NO_CATALOGADO - X | HASH=${VALID_HASH}`, expected: true });
    await fixture('7a. PROCESADO + HASH too short (63 hex)', 'PROCESADO', [[enabled, 'LISTO']], { detalleError: `13.-X.pdf: ALIAS_NO_CATALOGADO - X | HASH=${SHORT_HASH}`, expected: false });
    await fixture('7b. PROCESADO + HASH with non-hex characters', 'PROCESADO', [[enabled, 'LISTO']], { detalleError: `13.-X.pdf: ALIAS_NO_CATALOGADO - X | HASH=${'z'.repeat(64)}`, expected: false });
    await fixture('7c. PROCESADO + free-text detalle_error without HASH', 'PROCESADO', [[enabled, 'LISTO']], { detalleError: 'Error: algo antiguo', expected: false });
    await fixture('8. ERROR correo without results', 'ERROR', [], { expected: true });
    await fixture('9a. PENDIENTE without anything', 'PENDIENTE', [], { expected: false });
    await fixture('9b. PENDIENTE with MANUAL, enabled OMITIDO and valid HASH', 'PENDIENTE', [[disabled, 'MANUAL'], [enabled, 'OMITIDO']], { detalleError: `x.pdf: E - y | HASH=${VALID_HASH}`, expected: false });
    await fixture('10a. PROCESADO + OMITIDO, company without configuration row', 'PROCESADO', [[none, 'OMITIDO']], { expected: false });
    await fixture('10b. PROCESADO + OMITIDO, only procesa_comprobantes_pago=true', 'PROCESADO', [[procOnly, 'OMITIDO']], { expected: false });
    await fixture('10c. PROCESADO + OMITIDO, only notificaciones_activas=true', 'PROCESADO', [[notifOnly, 'OMITIDO']], { expected: false });
    await fixture('12a. PROCESADO + several LISTO + one re-enabled OMITIDO', 'PROCESADO', [[disabled, 'LISTO'], [none, 'LISTO'], [procOnly, 'LISTO'], [notifOnly, 'LISTO'], [enabled, 'OMITIDO']], { expected: true });
    await fixture('12b. PROCESADO + several LISTO + one disabled OMITIDO', 'PROCESADO', [[enabled, 'LISTO'], [none, 'LISTO'], [procOnly, 'LISTO'], [notifOnly, 'LISTO'], [disabled, 'OMITIDO']], { expected: false });
    await fixture('12c. PROCESADO + several LISTO + pending HASH', 'PROCESADO', [[enabled, 'LISTO'], [none, 'LISTO'], [procOnly, 'LISTO']], { detalleError: `x.pdf: E - y | HASH=${VALID_HASH}`, expected: true });
    await fixture('12d. PROCESADO + disabled OMITIDO + re-enabled OMITIDO + LISTO (no row multiplication)', 'PROCESADO', [[enabled, 'OMITIDO'], [disabled, 'OMITIDO'], [none, 'LISTO']], { expected: true });

    const resultsBefore = JSON.stringify((await client.query(resultSnapshotSql)).rows);

    // ---- list (real SQL) ------------------------------------------------------------------------
    const everything = await service.list({ page: 1, pageSize: 1000000 });
    const listed = new Map(everything.data.map((row) => [row.executionId, row]));
    assert(everything.meta.total === everything.data.length, `List row count (${everything.data.length}) differs from correos count (${everything.meta.total}): duplicated or dropped rows.`);
    assert(listed.size === everything.data.length, 'List contains duplicated executionIds.');

    const record = (name, ok, detail) => { results.push({ name, ok, detail }); };

    // Historical counts unchanged by the new join, for every pre-existing correo.
    let historicalMismatches = 0;
    for (const [id, base] of baseline) {
      const row = listed.get(id);
      if (!row || row.totalResults !== base.total || row.readyCount !== base.ready || row.manualCount !== base.manual || row.errorCount !== base.error || row.omittedCount !== base.omitted) historicalMismatches += 1;
    }
    record(`historical counts identical to join-free baseline for ${baseline.size} pre-existing correos`, historicalMismatches === 0, `${historicalMismatches} mismatches`);

    for (const item of fixtures) {
      const row = listed.get(item.id);
      const expectedCounts = { total: item.resultRows.length };
      for (const state of ['LISTO', 'MANUAL', 'ERROR', 'OMITIDO']) expectedCounts[state] = item.resultRows.filter(([, estado]) => estado === state).length;
      const countsOk = row && row.totalResults === expectedCounts.total && row.readyCount === expectedCounts.LISTO && row.manualCount === expectedCounts.MANUAL && row.errorCount === expectedCounts.ERROR && row.omittedCount === expectedCounts.OMITIDO;
      record(`${item.name}: counts unchanged (no duplicated rows)`, Boolean(countsOk), JSON.stringify(row));
      record(`${item.name}: list reprocessAvailable=${item.expected}`, row?.reprocessAvailable === item.expected, `got ${row?.reprocessAvailable}`);
      assert(!('reactivatedOmittedCount' in row) && !('hasPendingFileHash' in row) && !('reactivated_omitted_count' in row), 'Internal indicators leaked into the public summary.');
    }

    // ---- click-time check vs list, for the fixtures AND every pre-existing correo --------------
    let consistencyMismatches = 0;
    for (const row of everything.data) {
      const lookup = await repository.findReprocessableCorreoByExecutionId(row.executionId);
      if ((lookup.status === 'FOUND') !== row.reprocessAvailable) consistencyMismatches += 1;
    }
    record(`list vs click-time agree for all ${everything.data.length} correos`, consistencyMismatches === 0, `${consistencyMismatches} disagreements`);

    for (const item of fixtures) {
      webhookCalls.length = 0;
      const outcome = await service.reprocess(item.id, `req-${item.id}`, identity);
      const expectedStatus = item.expected ? 'TRIGGERED' : 'NOT_ELIGIBLE';
      record(`${item.name}: POST -> ${expectedStatus}`, outcome.status === expectedStatus, `got ${outcome.status}`);
      record(`${item.name}: webhook ${item.expected ? 'receives only the correo id' : 'not called'}`, item.expected ? (webhookCalls.length === 1 && webhookCalls[0] === item.id) : webhookCalls.length === 0, JSON.stringify(webhookCalls));
    }

    // ---- 11. configuration changes between list and POST ----------------------------------------
    const beforeToggle = await service.list({ page: 1, pageSize: 1000000 });
    assert(beforeToggle.data.find((row) => row.executionId === reactivated)?.reprocessAvailable === true, 'Scenario 11 precondition failed.');
    webhookCalls.length = 0;
    await client.query('UPDATE core.empresas_notificacion_pago SET notificaciones_activas = FALSE WHERE empresa_id = $1', [enabled]);
    const afterDisable = await service.reprocess(reactivated, 'req-toggle-off', identity);
    record('11. company disabled after the list was loaded -> POST NOT_ELIGIBLE (409), no webhook', afterDisable.status === 'NOT_ELIGIBLE' && webhookCalls.length === 0, `got ${afterDisable.status}, webhook calls ${webhookCalls.length}`);
    const relisted = await service.list({ page: 1, pageSize: 1000000 });
    record('11. list recalculated with the current configuration -> false', relisted.data.find((row) => row.executionId === reactivated)?.reprocessAvailable === false, 'list still true');
    await client.query('UPDATE core.empresas_notificacion_pago SET notificaciones_activas = TRUE, procesa_comprobantes_pago = FALSE WHERE empresa_id = $1', [enabled]);
    const afterProcOff = await service.reprocess(reactivated, 'req-toggle-proc', identity);
    record('11. procesa_comprobantes_pago turned off -> NOT_ELIGIBLE', afterProcOff.status === 'NOT_ELIGIBLE', `got ${afterProcOff.status}`);
    await client.query('UPDATE core.empresas_notificacion_pago SET procesa_comprobantes_pago = TRUE WHERE empresa_id = $1', [enabled]);
    const afterReenable = await service.reprocess(reactivated, 'req-toggle-on', identity);
    record('11. company still/again enabled -> POST accepted (TRIGGERED)', afterReenable.status === 'TRIGGERED' && webhookCalls.length === 1 && webhookCalls[0] === reactivated, `got ${afterReenable.status}`);

    // ---- no Hub writes ----------------------------------------------------------------------------
    const resultsAfter = JSON.stringify((await client.query(resultSnapshotSql)).rows);
    record('core.resultados_notificacion_pago unchanged by the Hub (OMITIDO stays OMITIDO, LISTO untouched)', resultsBefore === resultsAfter, 'snapshot differs');
    const writes = hubStatements.filter((sql) => /\b(INSERT|UPDATE|DELETE)\b/i.test(sql));
    record(`no write statements issued by the Hub classes (${hubStatements.length} statements inspected)`, writes.length === 0, `${writes.length} writes`);
  } finally {
    // Always roll back (also when an assertion or SQL error aborted the run); never commit.
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); console.log('Transaction rolled back: no fixture or configuration change persisted.'); }
      catch { console.error('ROLLBACK could not be confirmed; the connection is closed next, which also discards the uncommitted transaction.'); }
    }
    try { await client.end(); } catch { /* already closed */ }
    // Show whatever was checked before an abort, so a failure is diagnosable.
    for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.ok ? '' : `  -> ${item.detail}`}`);
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`Reprocess eligibility integration: ${results.length - failed.length} passed, ${failed.length} failed.`);
  if (failed.length) process.exitCode = 1;
}

run().catch((error) => { console.error(error.message); process.exitCode = 1; });
