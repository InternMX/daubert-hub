// Phase 11A.2 - Caterpillar PostgreSQL model & configuration.
//
// Pure DB-level integration runner: no HTTP API is spawned because Phase
// 11A.2 deliberately adds no API endpoints (no dashboard, no history, no
// n8n workflow changes) - only the generic PostgreSQL primitives that a
// later phase will wire n8n and the API up to.
//
// Two roles are exercised on purpose:
//   - daubert_hub_test_user (TEST_DATABASE_URL): sets up/tears down
//     temporary automation/series/route fixtures (it already has
//     test-fixture INSERT/DELETE on those three tables) and is also the
//     subject of the "Hub role cannot reserve folios" permission checks.
//   - n8n_cat_test (TEST_DATABASE_URL_N8N_CAT_TEST): the least-privilege
//     role that actually calls the four generic SECURITY DEFINER functions,
//     exactly as a future n8n TEST workflow would.
//
// Known, intentional scope boundary: Phase 11A.2 adds no primitive to mark
// an execution COMPLETADA/ERROR/CANCELADA (that belongs to later workflow
// orchestration once PDF generation exists). So the "already completed"
// duplicate-safety branch and "cancelled/completed execution cannot
// reserve" cannot be exercised behaviorally through any TEST role's actual
// privileges without fabricating state no real caller could produce today;
// those two properties are instead verified structurally (the partial
// unique index and the PROCESANDO check both exist with the right
// predicate/condition) - see the SAFETY FENCE section below.
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set for the Caterpillar model integration runner.`);
  return value;
}

function assertDatabaseName(url, label) {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname).replace(/^\//, '');
  if (name !== 'daubert_hub_test') {
    throw new Error(`Refusing Caterpillar model integration tests for ${label} against "${name || '(missing)'}". Expected "daubert_hub_test".`);
  }
}

const marker = `HUB_TEST_CAT_${randomUUID().replace(/-/g, '').toUpperCase()}`;
const autoCodeA = `${marker}_AUTO_A`;
const autoCodeB = `${marker}_AUTO_B`;
const serieCode = `${marker}_SERIE`;
const serieInactiveCode = `${marker}_SERIE_INACTIVE`;
const serieOwnedByBCode = `${marker}_SERIE_OWNED_B`;
const llaveActiva = `${marker}|ACTIVA|`;
const llaveInactiva = `${marker}|INACTIVA|`;

// A fresh transaction per statement, mirroring apps/api/test/automations.integration.runner.cjs.
async function tx(pool, text, values = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB_TEST']);
    await client.query("SELECT set_config('app.request_id', $1, true)", [`cat-model-test-${randomUUID()}`]);
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
  const hubUrl = requireEnv('TEST_DATABASE_URL');
  const n8nUrl = requireEnv('TEST_DATABASE_URL_N8N_CAT_TEST');
  assertDatabaseName(hubUrl, 'TEST_DATABASE_URL');
  assertDatabaseName(n8nUrl, 'TEST_DATABASE_URL_N8N_CAT_TEST');

  const hub = new Pool({ connectionString: hubUrl });
  const cat = new Pool({ connectionString: n8nUrl });

  let empresaId;
  let autoIdA;
  let autoIdB;
  let serieId;
  let serieInactiveId;
  let serieOwnedByBId;

  try {
    assert((await hub.query('SELECT current_database() AS name')).rows[0].name === 'daubert_hub_test', 'Hub session database mismatch.');
    assert((await cat.query('SELECT current_database() AS name')).rows[0].name === 'daubert_hub_test', 'n8n_cat_test session database mismatch.');

    // =========================================================
    // 1. CAT configuration (real seeded Phase 11A.2 data, read-only)
    // =========================================================
    {
      const series = await hub.query("SELECT codigo, siguiente_folio::text AS siguiente_folio, estatus FROM operacion.series_documentales WHERE codigo LIKE 'REMISION_CAT_%' ORDER BY codigo");
      assert(series.rows.length === 8, `Expected exactly 8 CAT series, found ${series.rows.length}.`);
      assert(!series.rows.some((row) => row.codigo === 'CATERPILLAR_LEGACY'), 'A Legacy series must not exist.');

      const byCode = Object.fromEntries(series.rows.map((row) => [row.codigo, row]));
      assert(byCode.REMISION_CAT_P2.siguiente_folio === '81' && byCode.REMISION_CAT_P2.estatus === 'ACTIVA', 'REMISION_CAT_P2 must be ACTIVA at next folio 81.');
      assert(byCode.REMISION_CAT_P5.siguiente_folio === '119' && byCode.REMISION_CAT_P5.estatus === 'ACTIVA', 'REMISION_CAT_P5 must be ACTIVA at next folio 119.');
      assert(byCode.REMISION_CAT_P6.siguiente_folio === '7' && byCode.REMISION_CAT_P6.estatus === 'ACTIVA', 'REMISION_CAT_P6 must be ACTIVA at next folio 7.');
      for (const code of ['REMISION_CAT_P3', 'REMISION_CAT_P4', 'REMISION_CAT_NL_FINSA_1', 'REMISION_CAT_NL_FINSA_3', 'REMISION_CAT_TORREON']) {
        assert(byCode[code].estatus === 'INACTIVA', `${code} must remain INACTIVA (placeholder, no productive approval).`);
      }

      const routes = await hub.query(`
        SELECT rsp.llave_proceso FROM ops.automatizacion_series_proceso rsp
        JOIN ops.automatizaciones a ON a.automatizacion_id = rsp.automatizacion_id
        WHERE a.codigo = 'REMISIONES_CATERPILLAR'`);
      assert(routes.rows.length === 9, `Expected exactly 9 CAT process-key routes, found ${routes.rows.length}.`);
      assert(!routes.rows.some((row) => row.llave_proceso.toUpperCase().includes('LEGACY')), 'No Legacy route may exist.');
    }

    // Torreon + Torreon Planta 2 resolve to the same series; unknown key fails closed.
    {
      const normal = await cat.query("SELECT * FROM ops.fn_resolver_ruta_automatizacion('REMISIONES_CATERPILLAR', 'CAT_TORREON|TORREON|')");
      const planta2 = await cat.query("SELECT * FROM ops.fn_resolver_ruta_automatizacion('REMISIONES_CATERPILLAR', 'CAT_TORREON|TORREON|PLANTA_2')");
      assert(normal.rows.length === 1 && planta2.rows.length === 1, 'Both Torreon process identities must resolve.');
      assert(normal.rows[0].serie_id === planta2.rows[0].serie_id, 'Torreon and Torreon Planta 2 must resolve to the same series.');
      assert(normal.rows[0].serie_codigo === 'REMISION_CAT_TORREON', 'Torreon must resolve to REMISION_CAT_TORREON.');

      const unknown = await cat.query("SELECT * FROM ops.fn_resolver_ruta_automatizacion('REMISIONES_CATERPILLAR', 'NOT_A_REAL_KEY|X|')");
      assert(unknown.rows.length === 0, 'An unknown process key must fail closed (zero rows), not throw or guess.');
    }

    // =========================================================
    // 2. Fixtures for routing/reservation behavior (never touching real CAT rows)
    // =========================================================
    empresaId = (await hub.query("SELECT empresa_id FROM core.empresas WHERE lower(btrim(nombre_comercial)) = 'caterpillar'")).rows[0].empresa_id;

    autoIdA = (await tx(hub, 'INSERT INTO ops.automatizaciones (codigo, nombre, estatus) VALUES ($1, $2, $3) RETURNING automatizacion_id::text', [autoCodeA, 'Temp CAT test automation A', 'ACTIVA'])).rows[0].automatizacion_id;
    autoIdB = (await tx(hub, 'INSERT INTO ops.automatizaciones (codigo, nombre, estatus) VALUES ($1, $2, $3) RETURNING automatizacion_id::text', [autoCodeB, 'Temp CAT test automation B', 'ACTIVA'])).rows[0].automatizacion_id;
    serieId = (await tx(hub, 'INSERT INTO operacion.series_documentales (codigo, nombre, siguiente_folio, estatus) VALUES ($1, $2, $3, $4) RETURNING serie_id::text', [serieCode, 'Temp CAT test series', 500, 'ACTIVA'])).rows[0].serie_id;
    serieInactiveId = (await tx(hub, 'INSERT INTO operacion.series_documentales (codigo, nombre, siguiente_folio, estatus) VALUES ($1, $2, $3, $4) RETURNING serie_id::text', [serieInactiveCode, 'Temp CAT test inactive series', 1, 'INACTIVA'])).rows[0].serie_id;
    serieOwnedByBId = (await tx(hub, 'INSERT INTO operacion.series_documentales (codigo, nombre, siguiente_folio, estatus) VALUES ($1, $2, $3, $4) RETURNING serie_id::text', [serieOwnedByBCode, 'Temp CAT test series owned by B', 1, 'ACTIVA'])).rows[0].serie_id;

    await tx(hub, 'INSERT INTO ops.automatizacion_series_proceso (automatizacion_id, llave_proceso, serie_id, empresa_cliente_id, estatus) VALUES ($1, $2, $3, $4, $5)', [autoIdA, llaveActiva, serieId, empresaId, 'ACTIVA']);
    await tx(hub, 'INSERT INTO ops.automatizacion_series_proceso (automatizacion_id, llave_proceso, serie_id, empresa_cliente_id, estatus) VALUES ($1, $2, $3, $4, $5)', [autoIdA, llaveInactiva, serieInactiveId, empresaId, 'INACTIVA']);
    await tx(hub, 'INSERT INTO ops.automatizacion_series_proceso (automatizacion_id, llave_proceso, serie_id, empresa_cliente_id, estatus) VALUES ($1, $2, $3, $4, $5)', [autoIdB, `${marker}|B|`, serieOwnedByBId, empresaId, 'ACTIVA']);

    // =========================================================
    // 3. Routing checks
    // =========================================================
    {
      // route belongs to automation.
      const resolvedForA = await cat.query('SELECT * FROM ops.fn_resolver_ruta_automatizacion($1, $2)', [autoCodeA, llaveActiva]);
      assert(resolvedForA.rows.length === 1 && resolvedForA.rows[0].serie_id === serieId, 'Route must resolve for its owning automation.');

      // wrong automation cannot use the same process key.
      const resolvedForB = await cat.query('SELECT * FROM ops.fn_resolver_ruta_automatizacion($1, $2)', [autoCodeB, llaveActiva]);
      assert(resolvedForB.rows.length === 0, "A different automation must not resolve automation A's process key.");

      // inactive route rejected by the resolver.
      const resolvedInactive = await cat.query('SELECT * FROM ops.fn_resolver_ruta_automatizacion($1, $2)', [autoCodeA, llaveInactiva]);
      assert(resolvedInactive.rows.length === 0, 'An inactive route must not resolve.');

      // wrong company/series relation cannot be fabricated: automation A cannot claim
      // a series already owned by automation B (enforced by the ownership trigger).
      let fabricated = false;
      try {
        await tx(hub, 'INSERT INTO ops.automatizacion_series_proceso (automatizacion_id, llave_proceso, serie_id, empresa_cliente_id, estatus) VALUES ($1, $2, $3, $4, $5)', [autoIdA, `${marker}|STEAL|`, serieOwnedByBId, empresaId, 'ACTIVA']);
        fabricated = true;
      } catch (error) {
        assert(error.code === '23505', `Expected the ownership trigger to raise a unique_violation-shaped error, got ${error.code}: ${error.message}`);
      }
      assert(!fabricated, 'A series already owned by automation B must not become fabricable under automation A.');
    }

    // =========================================================
    // 4. Reservation: document + execution + reservation chain
    // =========================================================
    const rutaArchivo = `C:\\${marker}\\archivo.xlsx`;
    const docResult = await cat.query('SELECT documento_id::text, ya_existia FROM core.fn_crear_o_resolver_documento($1, $2, $3, $4, $5)', [empresaId, 'PROGRAMACION_ENTREGA', 'archivo.xlsx', rutaArchivo, 'N8N']);
    const documentoId = docResult.rows[0].documento_id;
    assert(docResult.rows[0].ya_existia === false, 'A brand-new document path must not be reported as already existing.');

    const docAgain = await cat.query('SELECT documento_id::text, ya_existia FROM core.fn_crear_o_resolver_documento($1, $2, $3, $4, $5)', [empresaId, 'PROGRAMACION_ENTREGA', 'archivo.xlsx', rutaArchivo, 'N8N']);
    assert(docAgain.rows[0].documento_id === documentoId && docAgain.rows[0].ya_existia === true, 'Re-submitting the same source path must resolve to the same document, not duplicate it.');

    const execResult = await cat.query('SELECT ejecucion_id::text, ya_existia, motivo FROM ops.fn_crear_ejecucion_automatizacion($1, $2)', [autoCodeA, documentoId]);
    const ejecucionId = execResult.rows[0].ejecucion_id;
    assert(execResult.rows[0].motivo === 'CREATED', 'The first execution over a fresh document must be CREATED.');

    // "Already processing" duplicate-safety fence: same automation+document while still PROCESANDO.
    const execAgain = await cat.query('SELECT ejecucion_id::text, ya_existia, motivo FROM ops.fn_crear_ejecucion_automatizacion($1, $2)', [autoCodeA, documentoId]);
    assert(execAgain.rows[0].ejecucion_id === ejecucionId && execAgain.rows[0].motivo === 'ALREADY_PROCESSING', 'A concurrent poll over the same in-flight document must not create a second execution.');

    // second, independent execution (different document) for the disjoint-ranges check below.
    const rutaArchivo2 = `C:\\${marker}\\archivo2.xlsx`;
    const doc2 = (await cat.query('SELECT documento_id::text FROM core.fn_crear_o_resolver_documento($1, $2, $3, $4, $5)', [empresaId, 'PROGRAMACION_ENTREGA', 'archivo2.xlsx', rutaArchivo2, 'N8N'])).rows[0].documento_id;
    const ejecucionId2 = (await cat.query('SELECT ejecucion_id::text FROM ops.fn_crear_ejecucion_automatizacion($1, $2)', [autoCodeA, doc2])).rows[0].ejecucion_id;

    // one execution reserves a contiguous range; series next-folio semantics (500 => 500..504).
    const reserva1 = (await cat.query('SELECT reserva_id::text, folio_inicial::text, folio_final::text, cantidad FROM operacion.reservar_folios_para_ejecucion($1, $2, $3)', [ejecucionId, serieCode, 5])).rows[0];
    assert(reserva1.folio_inicial === '500' && reserva1.folio_final === '504' && reserva1.cantidad === 5, `Expected a contiguous 500-504 range, got ${JSON.stringify(reserva1)}.`);

    const afterFirst = (await hub.query('SELECT siguiente_folio::text FROM operacion.series_documentales WHERE codigo = $1', [serieCode])).rows[0].siguiente_folio;
    assert(afterFirst === '505', `Series must advance to 505 after a 5-folio reservation, got ${afterFirst}.`);

    // retry: same execution + series + quantity is idempotent (no second advance).
    const reserva1Retry = (await cat.query('SELECT reserva_id::text, folio_inicial::text, folio_final::text, cantidad FROM operacion.reservar_folios_para_ejecucion($1, $2, $3)', [ejecucionId, serieCode, 5])).rows[0];
    assert(reserva1Retry.reserva_id === reserva1.reserva_id && reserva1Retry.folio_final === '504', 'An idempotent retry must return the exact same reservation.');
    const afterRetry = (await hub.query('SELECT siguiente_folio::text FROM operacion.series_documentales WHERE codigo = $1', [serieCode])).rows[0].siguiente_folio;
    assert(afterRetry === '505', 'An idempotent retry must not advance the series a second time.');

    // retry with a different quantity must fail.
    let mismatchRejected = false;
    try {
      await cat.query('SELECT * FROM operacion.reservar_folios_para_ejecucion($1, $2, $3)', [ejecucionId, serieCode, 9]);
    } catch (error) {
      mismatchRejected = true;
      assert(error.code === '23505', `Expected a 23505-shaped rejection for a quantity mismatch, got ${error.code}.`);
    }
    assert(mismatchRejected, 'Retrying with a different quantity must be rejected, not silently accepted.');

    // two different executions reserve disjoint ranges from the same series.
    const reserva2 = (await cat.query('SELECT folio_inicial::text, folio_final::text FROM operacion.reservar_folios_para_ejecucion($1, $2, $3)', [ejecucionId2, serieCode, 3])).rows[0];
    assert(reserva2.folio_inicial === '505' && reserva2.folio_final === '507', `Expected the second execution to receive 505-507, got ${JSON.stringify(reserva2)}.`);
    assert(Number(reserva2.folio_inicial) > Number(reserva1.folio_final), 'The two executions must receive disjoint, non-overlapping ranges.');

    // concurrent identical requests for the same execution+series must not double-advance.
    const beforeConcurrent = (await hub.query('SELECT siguiente_folio::text FROM operacion.series_documentales WHERE codigo = $1', [serieCode])).rows[0].siguiente_folio;
    const concurrentResults = await Promise.all([
      cat.query('SELECT reserva_id::text, folio_inicial::text, folio_final::text FROM operacion.reservar_folios_para_ejecucion($1, $2, $3)', [ejecucionId2, serieCode, 3]),
      cat.query('SELECT reserva_id::text, folio_inicial::text, folio_final::text FROM operacion.reservar_folios_para_ejecucion($1, $2, $3)', [ejecucionId2, serieCode, 3])
    ]);
    const [rowsA, rowsB] = concurrentResults.map((result) => result.rows[0]);
    assert(rowsA.reserva_id === rowsB.reserva_id && rowsA.folio_final === rowsB.folio_final, 'Two concurrent identical requests for the same execution+series must converge on one reservation.');
    const afterConcurrent = (await hub.query('SELECT siguiente_folio::text FROM operacion.series_documentales WHERE codigo = $1', [serieCode])).rows[0].siguiente_folio;
    assert(afterConcurrent === beforeConcurrent, 'A pair of concurrent identical (execution, series, quantity) requests must advance the series at most once total.');

    // an inactive series cannot be reserved from, even with a fully valid execution/route.
    const execInactive = (await cat.query('SELECT ejecucion_id::text FROM ops.fn_crear_ejecucion_automatizacion($1, $2)', [autoCodeA, (await cat.query('SELECT documento_id::text FROM core.fn_crear_o_resolver_documento($1, $2, $3, $4, $5)', [empresaId, 'PROGRAMACION_ENTREGA', 'inactivo.xlsx', `C:\\${marker}\\inactivo.xlsx`, 'N8N'])).rows[0].documento_id])).rows[0].ejecucion_id;
    let inactiveRejected = false;
    try {
      await cat.query('SELECT * FROM operacion.reservar_folios_para_ejecucion($1, $2, $3)', [execInactive, serieInactiveCode, 1]);
    } catch (error) {
      inactiveRejected = true;
      assert(error.code === '55000', `Expected an inactive series to be rejected with 55000, got ${error.code}.`);
    }
    assert(inactiveRejected, 'Reserving from an inactive series must be rejected.');

    // wrong automation cannot use a series it doesn't own.
    const execForB = (await cat.query('SELECT ejecucion_id::text FROM ops.fn_crear_ejecucion_automatizacion($1, $2)', [autoCodeB, (await cat.query('SELECT documento_id::text FROM core.fn_crear_o_resolver_documento($1, $2, $3, $4, $5)', [empresaId, 'PROGRAMACION_ENTREGA', 'cruzado.xlsx', `C:\\${marker}\\cruzado.xlsx`, 'N8N'])).rows[0].documento_id])).rows[0].ejecucion_id;
    let crossAutomationRejected = false;
    try {
      await cat.query('SELECT * FROM operacion.reservar_folios_para_ejecucion($1, $2, $3)', [execForB, serieCode, 1]);
    } catch (error) {
      crossAutomationRejected = true;
      assert(error.code === '55000', `Expected a cross-automation reservation attempt to be rejected with 55000, got ${error.code}.`);
    }
    assert(crossAutomationRejected, "Automation B's execution must not be able to reserve from a series routed only to automation A.");

    // rollback leaves the next folio unchanged: a client-driven ROLLBACK after a
    // successful reservation call must undo both the ledger row and the counter advance.
    {
      const client = await cat.connect();
      try {
        await client.query('BEGIN');
        const before = (await hub.query('SELECT siguiente_folio::text FROM operacion.series_documentales WHERE codigo = $1', [serieCode])).rows[0].siguiente_folio;
        const docForRollback = (await client.query('SELECT documento_id::text FROM core.fn_crear_o_resolver_documento($1, $2, $3, $4, $5)', [empresaId, 'PROGRAMACION_ENTREGA', 'rollback.xlsx', `C:\\${marker}\\rollback.xlsx`, 'N8N'])).rows[0].documento_id;
        const execForRollback = (await client.query('SELECT ejecucion_id::text FROM ops.fn_crear_ejecucion_automatizacion($1, $2)', [autoCodeA, docForRollback])).rows[0].ejecucion_id;
        const withinTxReservation = (await client.query('SELECT folio_inicial::text FROM operacion.reservar_folios_para_ejecucion($1, $2, $3)', [execForRollback, serieCode, 2])).rows[0];
        assert(withinTxReservation.folio_inicial === before, 'The in-transaction reservation must start where the series currently stands.');
        await client.query('ROLLBACK');

        const after = (await hub.query('SELECT siguiente_folio::text FROM operacion.series_documentales WHERE codigo = $1', [serieCode])).rows[0].siguiente_folio;
        assert(after === before, `A rolled-back reservation must leave siguiente_folio unchanged (expected ${before}, got ${after}).`);
      } finally {
        client.release();
      }
    }

    // =========================================================
    // 5. Safety fence, structural verification
    //    (behavioral verification is out of reach for any TEST role because
    //    Phase 11A.2 adds no execution-completion primitive - see header.)
    // =========================================================
    {
      const dedupIndex = await hub.query(`
        SELECT pg_get_indexdef(indexrelid) AS definition
        FROM pg_index
        WHERE indexrelid = 'ops.uq_ejecuciones_automatizacion_completada_original'::regclass`);
      assert(dedupIndex.rows.length === 1, 'The completed-original dedup index must exist.');
      assert(/estado = 'COMPLETADA'/.test(dedupIndex.rows[0].definition) && /reproceso_de_id IS NULL/.test(dedupIndex.rows[0].definition), 'The dedup index must be scoped to COMPLETADA original (non-reprocess) executions.');

      const reprocesoColumn = await hub.query(`
        SELECT a.attname FROM pg_attribute a
        JOIN pg_constraint c ON c.conrelid = a.attrelid AND a.attnum = ANY (c.conkey)
        WHERE c.conname = 'fk_ejecuciones_automatizacion_reproceso' AND a.attname = 'reproceso_de_id'`);
      assert(reprocesoColumn.rows.length === 1, 'Explicit linked reprocessing (reproceso_de_id) must remain a first-class, FK-enforced column.');
    }

    // =========================================================
    // 6. BIGINT handling: decimal strings, never Number/parseInt, exact above MAX_SAFE_INTEGER.
    // =========================================================
    {
      const bigValue = '9223372036854775001'; // within int8 range, far above Number.MAX_SAFE_INTEGER
      const result = await hub.query('SELECT $1::bigint AS big_id', [bigValue]);
      assert(typeof result.rows[0].big_id === 'string', `pg must return bigint as a string, got ${typeof result.rows[0].big_id}.`);
      assert(result.rows[0].big_id === bigValue, 'A bigint value above Number.MAX_SAFE_INTEGER must round-trip exactly as a decimal string.');
      assert(Number(bigValue) !== Number(BigInt(bigValue)) || !Number.isSafeInteger(Number(bigValue)), 'Sanity check: the fixture value must actually exceed Number.MAX_SAFE_INTEGER.');

      assert(typeof reserva1.reserva_id === 'string', 'reserva_id must be returned as a decimal string, not a number.');
      assert(typeof ejecucionId === 'string', 'ejecucion_id must be returned as a decimal string, not a number.');
      assert(typeof documentoId === 'string', 'documento_id must be returned as a decimal string, not a number.');
    }

    // =========================================================
    // 7. Permissions
    // =========================================================
    {
      const hubPerms = (await hub.query(`
        SELECT
          has_function_privilege('daubert_hub_test_user', 'operacion.reservar_folios_para_ejecucion(bigint,text,integer)', 'EXECUTE') AS can_reserve,
          has_table_privilege('daubert_hub_test_user', 'operacion.reservas_folios', 'INSERT') AS ledger_insert,
          has_table_privilege('daubert_hub_test_user', 'operacion.reservas_folios', 'UPDATE') AS ledger_update,
          has_table_privilege('daubert_hub_test_user', 'operacion.reservas_folios', 'DELETE') AS ledger_delete
      `)).rows[0];
      assert(hubPerms.can_reserve === false, 'The Hub role must not be able to EXECUTE the folio allocator.');
      assert(hubPerms.ledger_insert === false && hubPerms.ledger_update === false && hubPerms.ledger_delete === false, 'The Hub role must have SELECT-only access to the reservation ledger.');

      const n8nPerms = (await hub.query(`
        SELECT
          has_function_privilege('n8n_cat_test', 'ops.fn_resolver_ruta_automatizacion(text,text)', 'EXECUTE') AS resolver,
          has_function_privilege('n8n_cat_test', 'core.fn_crear_o_resolver_documento(bigint,text,text,text,text,date,text)', 'EXECUTE') AS document_fn,
          has_function_privilege('n8n_cat_test', 'ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)', 'EXECUTE') AS execution_fn,
          has_function_privilege('n8n_cat_test', 'operacion.reservar_folios_para_ejecucion(bigint,text,integer)', 'EXECUTE') AS reservation_fn,
          has_function_privilege('n8n_cat_test', 'operacion.reservar_folios(text,integer)', 'EXECUTE') AS legacy_reservar_folios,
          has_table_privilege('n8n_cat_test', 'operacion.series_documentales', 'UPDATE') AS series_update,
          has_table_privilege('n8n_cat_test', 'operacion.series_documentales', 'SELECT') AS series_select,
          has_table_privilege('n8n_cat_test', 'ops.ejecuciones_automatizacion', 'DELETE') AS ejecuciones_delete,
          has_table_privilege('n8n_cat_test', 'ops.automation_review_acknowledgements', 'INSERT') AS review_ack_insert,
          has_table_privilege('n8n_cat_test', 'core.empresas', 'SELECT') AS empresas_select,
          has_table_privilege('n8n_cat_test', 'security.users', 'SELECT') AS security_users_select
      `)).rows[0];
      assert(n8nPerms.resolver && n8nPerms.document_fn && n8nPerms.execution_fn && n8nPerms.reservation_fn, 'n8n_cat_test must be able to EXECUTE exactly the four approved integration functions.');
      assert(n8nPerms.legacy_reservar_folios === false, 'n8n_cat_test must not be able to EXECUTE the Audi-only reservar_folios(text,integer).');
      assert(n8nPerms.series_update === false, 'n8n_cat_test must not be able to UPDATE operacion.series_documentales directly.');
      assert(n8nPerms.series_select === false, 'n8n_cat_test must have no direct table grants at all - only the four functions.');
      assert(n8nPerms.ejecuciones_delete === false, 'n8n_cat_test must never be able to DELETE.');
      assert(n8nPerms.review_ack_insert === false, 'n8n_cat_test must not be able to write review acknowledgements.');
      assert(n8nPerms.empresas_select === false, 'n8n_cat_test must not have unrelated direct table access (core.empresas).');
      assert(n8nPerms.security_users_select === false, 'n8n_cat_test must not have unrelated direct table access (security.users).');
    }

    console.log('Caterpillar model integration checks passed.');
  } finally {
    try {
      assert((await hub.query('SELECT current_database() AS name')).rows[0].name === 'daubert_hub_test', 'Cleanup database mismatch.');
      // Route rows are leaves and can always be cleaned up.
      await tx(hub, 'DELETE FROM ops.automatizacion_series_proceso WHERE llave_proceso LIKE $1', [`${marker}%`]);
      // The temp automations/series/documents/executions/reservations created
      // above cannot be deleted by any TEST role by design (see Section 7's
      // "no deletion-based recovery" requirement and the RESTRICT FKs this
      // model relies on) - they remain as harmless, uniquely marked rows.
    } finally {
      await hub.end();
      await cat.end();
    }
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
