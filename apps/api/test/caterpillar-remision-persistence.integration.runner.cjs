// Phase 11A.4a - Remittance persistence (operacion.fn_registrar_remision_generada).
//
// Companion to test/caterpillar-model.integration.runner.cjs (Phase 11A.2)
// and test/caterpillar-execution-finalization.integration.runner.cjs (Phase
// 11A.3). Exercises exactly the one new persistence primitive this phase
// adds: operacion.fn_registrar_remision_generada(bigint, text, bigint, date,
// text, jsonb).
//
// Three connections, same pattern as the Phase 11A.3 runner:
//   - daubert_hub_test_user (TEST_DATABASE_URL): sets up/tears down temporary
//     automation/series/route fixtures (existing test-fixture INSERT/DELETE
//     grants) and reads operacion.remisiones (existing SELECT grant from
//     20260828_003_remisiones_audi_activity_read_permissions_test.up.sql,
//     predating Phase 11A.4a). It never registers a remision itself.
//   - n8n_cat_test (TEST_DATABASE_URL_N8N_CAT_TEST): the least-privilege role
//     that actually calls the SECURITY DEFINER functions, exactly as a
//     future n8n TEST workflow would.
//   - a separate, elevated TEST-only credential, TEST_DATABASE_URL_MIGRATOR
//     ("migrator"): used as a read-only introspection tool to verify
//     operacion.remision_detalle row state (the Hub role has no grant on
//     that table - adding one is out of this phase's scope; see the header
//     comment of the Phase 11A.3 runner for why expanding Hub privileges is
//     deliberately avoided). It is ALSO used, exactly once (test #17 below),
//     to fabricate an otherwise-unreachable fixture: two reservations that
//     overlap on the same (serie_id, folio) for two different executions.
//     That state can never arise through the real allocator
//     (operacion.reservar_folios_para_ejecucion always advances
//     siguiente_folio forward and never reuses an abandoned range), so the
//     only way to prove the persistence function's own defense-in-depth
//     "different execution owns this folio" guard actually fires is to
//     construct the impossible case directly via the elevated credential.
//     TEST_DATABASE_URL_MIGRATOR must never be wired into any application
//     role, any n8n credential, or any non-TEST database.
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set for the Caterpillar remision persistence integration runner.`);
  return value;
}

function assertDatabaseName(url, label) {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname).replace(/^\//, '');
  if (name !== 'daubert_hub_test') {
    throw new Error(`Refusing Caterpillar remision persistence integration tests for ${label} against "${name || '(missing)'}". Expected "daubert_hub_test".`);
  }
}

const marker = `HUB_TEST_CAT_REM_${randomUUID().replace(/-/g, '').toUpperCase()}`;
const autoCode = `${marker}_AUTO`;
const serieCode = `${marker}_SERIE_MAIN`;
const serieCodeTorreon = `${marker}_SERIE_TORREON`;
const serieCodeSpare = `${marker}_SERIE_SPARE`;
const serieCodeUnrouted = `${marker}_SERIE_UNROUTED`;
const serieCodeOverlap = `${marker}_SERIE_OVERLAP`;
const llave = `${marker}|MAIN|`;
const llaveTorreon = `${marker}|TORREON|`;
const llaveSpare = `${marker}|SPARE|`;
const llaveOverlap = `${marker}|OVERLAP|`;

// A fresh transaction per statement, mirroring the Phase 11A.2/11A.3 runners.
async function tx(pool, text, values = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB_TEST']);
    await client.query("SELECT set_config('app.request_id', $1, true)", [`cat-remision-test-${randomUUID()}`]);
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

async function expectError(promise, expectedCode, description) {
  try {
    await promise;
  } catch (error) {
    assert(error.code === expectedCode, `${description}: expected SQLSTATE ${expectedCode}, got ${error.code}: ${error.message}`);
    return;
  }
  throw new Error(`${description}: expected an error (SQLSTATE ${expectedCode}) but the call succeeded.`);
}

async function run() {
  const hubUrl = requireEnv('TEST_DATABASE_URL');
  const n8nUrl = requireEnv('TEST_DATABASE_URL_N8N_CAT_TEST');
  const migratorUrl = requireEnv('TEST_DATABASE_URL_MIGRATOR');
  assertDatabaseName(hubUrl, 'TEST_DATABASE_URL');
  assertDatabaseName(n8nUrl, 'TEST_DATABASE_URL_N8N_CAT_TEST');
  assertDatabaseName(migratorUrl, 'TEST_DATABASE_URL_MIGRATOR');

  const hub = new Pool({ connectionString: hubUrl });
  const cat = new Pool({ connectionString: n8nUrl });
  const migrator = new Pool({ connectionString: migratorUrl });

  try {
    assert((await hub.query('SELECT current_database() AS name')).rows[0].name === 'daubert_hub_test', 'Hub session database mismatch.');
    assert((await cat.query('SELECT current_database() AS name')).rows[0].name === 'daubert_hub_test', 'n8n_cat_test session database mismatch.');
    assert((await migrator.query('SELECT current_database() AS name')).rows[0].name === 'daubert_hub_test', 'Migrator session database mismatch.');

    // =========================================================
    // Fixtures: one temp automation (ACTIVA), several temp series (ACTIVA),
    // routes tying them together - independent of any real seeded
    // Caterpillar data.
    // =========================================================
    const empresaId = (await hub.query("SELECT empresa_id FROM core.empresas WHERE lower(btrim(nombre_comercial)) = 'caterpillar'")).rows[0].empresa_id;
    const otraEmpresaId = (await hub.query("SELECT empresa_id FROM core.empresas WHERE empresa_id <> $1 ORDER BY empresa_id LIMIT 1", [empresaId])).rows[0].empresa_id;

    const autoId = (await tx(hub, 'INSERT INTO ops.automatizaciones (codigo, nombre, estatus) VALUES ($1, $2, $3) RETURNING automatizacion_id::text', [autoCode, 'Temp CAT remision test automation', 'ACTIVA'])).rows[0].automatizacion_id;
    const serieId = (await tx(hub, 'INSERT INTO operacion.series_documentales (codigo, nombre, siguiente_folio, estatus) VALUES ($1, $2, $3, $4) RETURNING serie_id::text', [serieCode, 'Temp CAT remision main series', 500, 'ACTIVA'])).rows[0].serie_id;
    const serieIdTorreon = (await tx(hub, 'INSERT INTO operacion.series_documentales (codigo, nombre, siguiente_folio, estatus) VALUES ($1, $2, $3, $4) RETURNING serie_id::text', [serieCodeTorreon, 'Temp CAT remision torreon series', 700, 'ACTIVA'])).rows[0].serie_id;
    const serieIdSpare = (await tx(hub, 'INSERT INTO operacion.series_documentales (codigo, nombre, siguiente_folio, estatus) VALUES ($1, $2, $3, $4) RETURNING serie_id::text', [serieCodeSpare, 'Temp CAT remision spare series', 900, 'ACTIVA'])).rows[0].serie_id;
    const serieIdUnrouted = (await tx(hub, 'INSERT INTO operacion.series_documentales (codigo, nombre, siguiente_folio, estatus) VALUES ($1, $2, $3, $4) RETURNING serie_id::text', [serieCodeUnrouted, 'Temp CAT remision unrouted series', 1, 'ACTIVA'])).rows[0].serie_id;
    const serieIdOverlap = (await tx(hub, 'INSERT INTO operacion.series_documentales (codigo, nombre, siguiente_folio, estatus) VALUES ($1, $2, $3, $4) RETURNING serie_id::text', [serieCodeOverlap, 'Temp CAT remision overlap series', 5000, 'ACTIVA'])).rows[0].serie_id;

    await tx(hub, 'INSERT INTO ops.automatizacion_series_proceso (automatizacion_id, llave_proceso, serie_id, empresa_cliente_id, estatus) VALUES ($1, $2, $3, $4, $5)', [autoId, llave, serieId, empresaId, 'ACTIVA']);
    await tx(hub, 'INSERT INTO ops.automatizacion_series_proceso (automatizacion_id, llave_proceso, serie_id, empresa_cliente_id, estatus) VALUES ($1, $2, $3, $4, $5)', [autoId, llaveTorreon, serieIdTorreon, empresaId, 'ACTIVA']);
    await tx(hub, 'INSERT INTO ops.automatizacion_series_proceso (automatizacion_id, llave_proceso, serie_id, empresa_cliente_id, estatus) VALUES ($1, $2, $3, $4, $5)', [autoId, llaveSpare, serieIdSpare, empresaId, 'ACTIVA']);
    await tx(hub, 'INSERT INTO ops.automatizacion_series_proceso (automatizacion_id, llave_proceso, serie_id, empresa_cliente_id, estatus) VALUES ($1, $2, $3, $4, $5)', [autoId, llaveOverlap, serieIdOverlap, empresaId, 'ACTIVA']);
    // serieCodeUnrouted is deliberately left with NO route for autoId.

    let fixtureCounter = 0;
    async function newExecution() {
      fixtureCounter += 1;
      const rutaArchivo = `C:\\${marker}\\archivo${fixtureCounter}.xlsx`;
      const documentoId = (await cat.query(
        'SELECT documento_id::text FROM core.fn_crear_o_resolver_documento($1, $2, $3, $4, $5)',
        [empresaId, 'PROGRAMACION_ENTREGA', `archivo${fixtureCounter}.xlsx`, rutaArchivo, 'N8N']
      )).rows[0].documento_id;
      const ejecucionId = (await cat.query('SELECT ejecucion_id::text FROM ops.fn_crear_ejecucion_automatizacion($1, $2)', [autoCode, documentoId])).rows[0].ejecucion_id;
      return ejecucionId;
    }

    async function reserve(ejecucionId, code, cantidad) {
      return (await cat.query(
        'SELECT reserva_id::text, folio_inicial::text, folio_final::text FROM operacion.reservar_folios_para_ejecucion($1, $2, $3)',
        [ejecucionId, code, cantidad]
      )).rows[0];
    }

    async function persist(pool, ejecucionId, code, folio, fecha, pdfPath, detalles) {
      const result = await pool.query(
        'SELECT remision_id::text, ya_existia FROM operacion.fn_registrar_remision_generada($1, $2, $3, $4, $5, $6::jsonb)',
        [ejecucionId, code, folio, fecha, pdfPath, JSON.stringify(detalles)]
      );
      return result.rows[0];
    }

    async function loadHeader(remisionId) {
      return (await hub.query(
        'SELECT serie_id::text, folio::text, empresa_cliente_id::text, ejecucion_id::text, fecha_documento, pdf_path, estatus FROM operacion.remisiones WHERE remision_id = $1',
        [remisionId]
      )).rows[0];
    }

    async function loadDetails(remisionId) {
      return (await migrator.query(
        'SELECT codigo_interno, part_number, descripcion, cantidad_texto FROM operacion.remision_detalle WHERE remision_id = $1 ORDER BY detalle_id',
        [remisionId]
      )).rows;
    }

    async function countDetails(remisionId) {
      return Number((await migrator.query(
        'SELECT COUNT(*)::text AS n FROM operacion.remision_detalle WHERE remision_id = $1',
        [remisionId]
      )).rows[0].n);
    }

    // =========================================================
    // 1/3/4/5. Valid normal one-detail remittance: header + detail persisted,
    // empresa_cliente_id derived from the active route.
    // =========================================================
    let normalCase;
    {
      const ejecucionId = await newExecution();
      const reserva = await reserve(ejecucionId, serieCode, 1);
      const folio = Number(reserva.folio_inicial);
      const result = await persist(cat, ejecucionId, serieCode, folio, '2026-09-18', `\\\\SERVER\\CAT\\remisiones\\${marker}_1.pdf`, [
        { codigo_interno: 'INT-001', part_number: 'PN-001', descripcion: 'Pieza de prueba', cantidad_texto: '10 PZA' }
      ]);
      assert(result.ya_existia === false, 'A first registration must not report ya_existia.');
      assert(result.remision_id, 'A first registration must return a remision_id.');

      const header = await loadHeader(result.remision_id);
      assert(header.serie_id === serieId, 'Header serie_id must match the reserved series.');
      assert(header.folio === String(folio), 'Header folio must match the persisted folio.');
      assert(header.empresa_cliente_id === empresaId, '#5 empresa_cliente_id must be derived from the active route, not caller-supplied.');
      assert(header.ejecucion_id === ejecucionId, 'Header ejecucion_id must match the calling execution.');
      assert(header.pdf_path === `\\\\SERVER\\CAT\\remisiones\\${marker}_1.pdf`, 'Header pdf_path must be persisted exactly as provided.');
      assert(header.estatus === 'GENERADA', 'A freshly persisted remision must be GENERADA.');

      const details = await loadDetails(result.remision_id);
      assert(details.length === 1, '#4 exactly one detail row must be persisted for a normal remittance.');
      assert(details[0].codigo_interno === 'INT-001' && details[0].part_number === 'PN-001' && details[0].cantidad_texto === '10 PZA', 'Detail fields must be persisted exactly as provided.');

      normalCase = { ejecucionId, folio, remisionId: result.remision_id };
    }

    // =========================================================
    // 2/4. Valid multi-detail Torreon-style remittance: several details
    // under one header (Torreon groups by customer PO before generation).
    // =========================================================
    {
      const ejecucionId = await newExecution();
      const reserva = await reserve(ejecucionId, serieCodeTorreon, 1);
      const folio = Number(reserva.folio_inicial);
      const detalles = [
        { codigo_interno: 'INT-101', part_number: 'PN-101', descripcion: 'PO 1', cantidad_texto: '5 PZA' },
        { codigo_interno: 'INT-102', part_number: 'PN-102', descripcion: 'PO 2', cantidad_texto: '3 PZA' },
        { codigo_interno: null, part_number: '  ', descripcion: 'PO 3 sin codigo interno', cantidad_texto: '1 PZA' }
      ];
      const result = await persist(cat, ejecucionId, serieCodeTorreon, folio, '2026-09-18', `\\\\SERVER\\CAT\\remisiones\\${marker}_torreon.pdf`, detalles);
      assert(result.ya_existia === false, 'A first Torreon-style registration must not report ya_existia.');

      const details = await loadDetails(result.remision_id);
      assert(details.length === 3, '#4 all three detail rows must be persisted for a multi-detail remittance.');
      assert(details.map((d) => d.cantidad_texto).sort().join(',') === '1 PZA,3 PZA,5 PZA', 'All cantidad_texto values must be persisted exactly.');
      // #8 blank optional fields normalized to NULL.
      const thirdDetail = details.find((d) => d.cantidad_texto === '1 PZA');
      assert(thirdDetail.codigo_interno === null, '#8 a NULL codigo_interno must remain NULL.');
      assert(thirdDetail.part_number === null, '#8 a blank (whitespace-only) part_number must be normalized to NULL.');
    }

    // =========================================================
    // 6. Execution must be PROCESANDO.
    // =========================================================
    {
      const ejecucionId = await newExecution();
      const reserva = await reserve(ejecucionId, serieCode, 1);
      await cat.query('SELECT * FROM ops.fn_finalizar_ejecucion_automatizacion($1, $2)', [ejecucionId, 'CANCELADA']);
      await expectError(
        persist(cat, ejecucionId, serieCode, Number(reserva.folio_inicial), '2026-09-18', `\\\\SERVER\\CAT\\remisiones\\${marker}_cancelled.pdf`, [{ cantidad_texto: '1 PZA' }]),
        '55000',
        'Registering a remision for a non-PROCESANDO execution must be rejected'
      );
    }

    // =========================================================
    // 7. Route must belong to execution automation (series exists and is
    // ACTIVA, but has no route to this execution's automation).
    // =========================================================
    {
      const ejecucionId = await newExecution();
      await expectError(
        persist(cat, ejecucionId, serieCodeUnrouted, 1, '2026-09-18', `\\\\SERVER\\CAT\\remisiones\\${marker}_unrouted.pdf`, [{ cantidad_texto: '1 PZA' }]),
        '55000',
        'A series with no active route to the execution automation must be rejected'
      );
    }

    // Bonus: ambiguous route resolution (same series routed to the same
    // automation under two different customer companies) must also be
    // rejected safely, per validation requirement #15.
    {
      const ambiguousSerieCode = `${marker}_SERIE_AMBIGUOUS`;
      const ambiguousSerieId = (await tx(hub, 'INSERT INTO operacion.series_documentales (codigo, nombre, siguiente_folio, estatus) VALUES ($1, $2, $3, $4) RETURNING serie_id::text', [ambiguousSerieCode, 'Temp CAT remision ambiguous series', 1, 'ACTIVA'])).rows[0].serie_id;
      await tx(hub, 'INSERT INTO ops.automatizacion_series_proceso (automatizacion_id, llave_proceso, serie_id, empresa_cliente_id, estatus) VALUES ($1, $2, $3, $4, $5)', [autoId, `${marker}|AMBIG_A|`, ambiguousSerieId, empresaId, 'ACTIVA']);
      await tx(hub, 'INSERT INTO ops.automatizacion_series_proceso (automatizacion_id, llave_proceso, serie_id, empresa_cliente_id, estatus) VALUES ($1, $2, $3, $4, $5)', [autoId, `${marker}|AMBIG_B|`, ambiguousSerieId, otraEmpresaId, 'ACTIVA']);

      const ejecucionId = await newExecution();
      await expectError(
        persist(cat, ejecucionId, ambiguousSerieCode, 1, '2026-09-18', `\\\\SERVER\\CAT\\remisiones\\${marker}_ambiguous.pdf`, [{ cantidad_texto: '1 PZA' }]),
        '55000',
        'An ambiguous route (same series, two different customer companies) must be rejected safely'
      );
    }

    // =========================================================
    // 8. Reservation must exist for ejecucion_id + serie_id.
    // =========================================================
    {
      const ejecucionId = await newExecution();
      // serieCodeSpare IS an active route of this automation, but this
      // execution never reserved folios against it.
      await expectError(
        persist(cat, ejecucionId, serieCodeSpare, 1, '2026-09-18', `\\\\SERVER\\CAT\\remisiones\\${marker}_noreservation.pdf`, [{ cantidad_texto: '1 PZA' }]),
        'P0002',
        'Registering a remision with no matching reservation must be rejected'
      );
    }

    // =========================================================
    // 9/10. Folio outside the reserved range (below / above) rejected.
    // =========================================================
    {
      const ejecucionId = await newExecution();
      const reserva = await reserve(ejecucionId, serieCodeSpare, 2);
      const below = Number(reserva.folio_inicial) - 1;
      const above = Number(reserva.folio_final) + 1;

      await expectError(
        persist(cat, ejecucionId, serieCodeSpare, below, '2026-09-18', `\\\\SERVER\\CAT\\remisiones\\${marker}_below.pdf`, [{ cantidad_texto: '1 PZA' }]),
        '55000',
        'A folio below the reserved range must be rejected'
      );
      await expectError(
        persist(cat, ejecucionId, serieCodeSpare, above, '2026-09-18', `\\\\SERVER\\CAT\\remisiones\\${marker}_above.pdf`, [{ cantidad_texto: '1 PZA' }]),
        '55000',
        'A folio above the reserved range must be rejected'
      );
    }

    // =========================================================
    // 11/12. Empty / non-array details rejected.
    // =========================================================
    {
      const ejecucionId = await newExecution();
      const reserva = await reserve(ejecucionId, serieCode, 1);
      const folio = Number(reserva.folio_inicial);

      await expectError(
        persist(cat, ejecucionId, serieCode, folio, '2026-09-18', `\\\\SERVER\\CAT\\remisiones\\${marker}_empty.pdf`, []),
        '22023',
        'An empty details array must be rejected'
      );
      await expectError(
        cat.query(
          'SELECT remision_id::text, ya_existia FROM operacion.fn_registrar_remision_generada($1, $2, $3, $4, $5, $6::jsonb)',
          [ejecucionId, serieCode, folio, '2026-09-18', `\\\\SERVER\\CAT\\remisiones\\${marker}_notarray.pdf`, JSON.stringify({ cantidad_texto: '1 PZA' })]
        ),
        '22023',
        'A non-array details value (JSON object) must be rejected'
      );
    }

    // =========================================================
    // 13. Blank cantidad_texto rejected.
    // =========================================================
    {
      const ejecucionId = await newExecution();
      const reserva = await reserve(ejecucionId, serieCode, 1);
      await expectError(
        persist(cat, ejecucionId, serieCode, Number(reserva.folio_inicial), '2026-09-18', `\\\\SERVER\\CAT\\remisiones\\${marker}_blankqty.pdf`, [{ cantidad_texto: '   ' }]),
        '22023',
        'A blank (whitespace-only) cantidad_texto must be rejected'
      );
    }

    // =========================================================
    // 14. Blank pdf_path rejected.
    // =========================================================
    {
      const ejecucionId = await newExecution();
      const reserva = await reserve(ejecucionId, serieCode, 1);
      await expectError(
        persist(cat, ejecucionId, serieCode, Number(reserva.folio_inicial), '2026-09-18', '   ', [{ cantidad_texto: '1 PZA' }]),
        '22023',
        'A blank (whitespace-only) pdf_path must be rejected'
      );
    }

    // =========================================================
    // 15/16. Idempotent retry: same execution + folio returns the existing
    // remision_id and does not duplicate detail rows.
    //
    // REGRESSION MARKER (20260918_004): this is the exact call that exposed
    // the "column reference remision_id is ambiguous" bug in the originally
    // applied 20260918_001 function - it is the FIRST call in this runner
    // that hits the idempotency detail-multiset EXISTS(...) branch (a
    // "same execution + already-registered folio" retry), which contained
    // the unqualified `WHERE remision_id = v_existente.remision_id` inside
    // the "existentes" CTE. That reference collided with the function's own
    // RETURNS TABLE(remision_id, ...) output column, so PostgreSQL rejected
    // the query outright before `persist(...)` could even resolve - the
    // `await persist(...)` below threw and the assertions after it were
    // never reached. 20260918_004 qualifies that reference as
    // `d.remision_id`; this block, unchanged, is what proves the fix: it
    // must now complete and return ya_existia = true instead of throwing.
    // =========================================================
    {
      const before = await countDetails(normalCase.remisionId);
      const retry = await persist(
        cat, normalCase.ejecucionId, serieCode, normalCase.folio, '2026-09-18', `\\\\SERVER\\CAT\\remisiones\\${marker}_1.pdf`,
        [{ codigo_interno: 'INT-001', part_number: 'PN-001', descripcion: 'Pieza de prueba', cantidad_texto: '10 PZA' }]
      );
      assert(retry.ya_existia === true, '#15 a repeated call for the same execution+folio must report ya_existia = true.');
      assert(retry.remision_id === normalCase.remisionId, '#15 a repeated call must return the SAME remision_id.');

      const after = await countDetails(normalCase.remisionId);
      assert(after === before, '#16 an idempotent retry must not duplicate detail rows.');
    }

    // Conflicting retry: same execution + folio, but different header data,
    // must be rejected rather than silently rewriting history.
    {
      await expectError(
        persist(cat, normalCase.ejecucionId, serieCode, normalCase.folio, '2026-09-19', `\\\\SERVER\\CAT\\remisiones\\${marker}_1.pdf`, [{ cantidad_texto: '10 PZA' }]),
        '23505',
        'A retry with a different fecha_documento for the same execution+folio must be rejected, not silently applied'
      );
      await expectError(
        persist(cat, normalCase.ejecucionId, serieCode, normalCase.folio, '2026-09-18', `\\\\SERVER\\CAT\\remisiones\\${marker}_1_DIFFERENT.pdf`, [{ cantidad_texto: '10 PZA' }]),
        '23505',
        'A retry with a different pdf_path for the same execution+folio must be rejected, not silently applied'
      );
    }

    // =========================================================
    // Idempotent retry - detail content must ALSO match, compared as a
    // MULTISET (order-independent, duplicate multiplicity preserved).
    // =========================================================
    let detailCase;
    {
      const ejecucionId = await newExecution();
      const reserva = await reserve(ejecucionId, serieCode, 1);
      const folio = Number(reserva.folio_inicial);
      const pdfPath = `\\\\SERVER\\CAT\\remisiones\\${marker}_detailcase.pdf`;
      const detailA = { codigo_interno: 'A', part_number: 'PN1', descripcion: 'Product A', cantidad_texto: '500 bolsas' };
      const detailB = { codigo_interno: 'B', part_number: 'PN2', descripcion: 'Product B', cantidad_texto: '2 rollos' };

      const first = await persist(cat, ejecucionId, serieCode, folio, '2026-09-18', pdfPath, [detailA, detailB]);
      assert(first.ya_existia === false, 'Detail-multiset fixture must register successfully first.');
      detailCase = { ejecucionId, folio, pdfPath, remisionId: first.remision_id, detailA, detailB };

      const originalDetails = await loadDetails(detailCase.remisionId);
      assert(originalDetails.length === 2, 'Detail-multiset fixture must start with exactly 2 detail rows.');

      // Same details, same order -> idempotent.
      const sameOrder = await persist(cat, ejecucionId, serieCode, folio, '2026-09-18', pdfPath, [detailA, detailB]);
      assert(sameOrder.ya_existia === true && sameOrder.remision_id === detailCase.remisionId, 'Same details in the same order must be idempotent.');

      // Same details, reversed order -> idempotent (order must never matter).
      const reversedOrder = await persist(cat, ejecucionId, serieCode, folio, '2026-09-18', pdfPath, [detailB, detailA]);
      assert(reversedOrder.ya_existia === true && reversedOrder.remision_id === detailCase.remisionId, 'Same details in reversed order must still be idempotent.');

      const afterIdempotentRetries = await loadDetails(detailCase.remisionId);
      assert(afterIdempotentRetries.length === 2, 'Idempotent retries (same order or reversed) must never duplicate or rewrite detail rows.');

      async function expectDetailConflictRejected(detalles, description) {
        await expectError(persist(cat, ejecucionId, serieCode, folio, '2026-09-18', pdfPath, detalles), '23505', description);
        const unchanged = await loadDetails(detailCase.remisionId);
        assert(unchanged.length === originalDetails.length, `${description}: a rejected retry must leave the existing detail row COUNT untouched.`);
        assert(
          JSON.stringify(unchanged) === JSON.stringify(originalDetails),
          `${description}: a rejected retry must leave the existing detail row CONTENT untouched.`
        );
      }

      // Changed cantidad_texto on one detail -> reject.
      await expectDetailConflictRejected(
        [detailA, { ...detailB, cantidad_texto: '3 rollos' }],
        'A retry with a changed cantidad_texto must be rejected'
      );

      // Changed codigo_interno -> reject.
      await expectDetailConflictRejected(
        [{ ...detailA, codigo_interno: 'A2' }, detailB],
        'A retry with a changed codigo_interno must be rejected'
      );

      // Changed part_number -> reject.
      await expectDetailConflictRejected(
        [detailA, { ...detailB, part_number: 'PN2-X' }],
        'A retry with a changed part_number must be rejected'
      );

      // Changed descripcion -> reject.
      await expectDetailConflictRejected(
        [{ ...detailA, descripcion: 'Product A revised' }, detailB],
        'A retry with a changed descripcion must be rejected'
      );

      // Added detail -> reject.
      await expectDetailConflictRejected(
        [detailA, detailB, { cantidad_texto: '1 extra' }],
        'A retry with an added detail must be rejected'
      );

      // Removed detail -> reject.
      await expectDetailConflictRejected(
        [detailA],
        'A retry with a removed detail must be rejected'
      );

      const stillUnchanged = await loadDetails(detailCase.remisionId);
      assert(stillUnchanged.length === 2, 'After every rejected retry, the persisted detail rows must remain exactly as originally registered.');
    }

    // Duplicate detail multiplicity: a multiset comparison must preserve
    // multiplicity, not just distinct membership.
    {
      const ejecucionId = await newExecution();
      const reserva = await reserve(ejecucionId, serieCode, 1);
      const folio = Number(reserva.folio_inicial);
      const pdfPath = `\\\\SERVER\\CAT\\remisiones\\${marker}_dupcase.pdf`;
      const duplicateDetail = { codigo_interno: 'DUP', part_number: 'PN-DUP', descripcion: 'Duplicated line', cantidad_texto: '1 PZA' };

      const first = await persist(cat, ejecucionId, serieCode, folio, '2026-09-18', pdfPath, [duplicateDetail, duplicateDetail]);
      assert(first.ya_existia === false, 'Duplicate-multiplicity fixture must register successfully first.');
      const originalCount = await countDetails(first.remision_id);
      assert(originalCount === 2, 'Duplicate-multiplicity fixture must persist BOTH identical detail rows (duplicates are not deduplicated).');

      // Same multiplicity (two identical rows) -> idempotent.
      const sameMultiplicity = await persist(cat, ejecucionId, serieCode, folio, '2026-09-18', pdfPath, [duplicateDetail, duplicateDetail]);
      assert(sameMultiplicity.ya_existia === true, 'The same duplicate multiplicity (2 identical rows) must be idempotent.');

      // Multiplicity mismatch (only 1 of the 2 identical rows) -> reject.
      await expectError(
        persist(cat, ejecucionId, serieCode, folio, '2026-09-18', pdfPath, [duplicateDetail]),
        '23505',
        'A retry supplying only 1 of 2 originally-duplicated identical details (multiplicity mismatch) must be rejected'
      );

      const afterRejection = await countDetails(first.remision_id);
      assert(afterRejection === originalCount, 'A rejected multiplicity-mismatch retry must leave the persisted duplicate rows untouched.');
    }

    // =========================================================
    // 17. Conflicting DIFFERENT execution for the same active series+folio
    // is rejected, and the folio is never stolen. See the header comment for
    // why this fixture uses the elevated migrator credential: the real
    // allocator can never produce two executions with overlapping reserved
    // ranges on the same series, so this defense-in-depth guard can only be
    // exercised behaviorally by fabricating that otherwise-impossible state.
    // =========================================================
    {
      const execA = await newExecution();
      const reservaA = await reserve(execA, serieCodeOverlap, 1);
      const overlapFolio = Number(reservaA.folio_inicial);
      const firstResult = await persist(cat, execA, serieCodeOverlap, overlapFolio, '2026-09-18', `\\\\SERVER\\CAT\\remisiones\\${marker}_overlapA.pdf`, [{ cantidad_texto: '1 PZA' }]);
      assert(firstResult.ya_existia === false, 'Execution A must successfully register the overlap-test folio first.');

      const execB = await newExecution();
      await migrator.query(
        `INSERT INTO operacion.reservas_folios (ejecucion_id, serie_id, folio_inicial, folio_final, cantidad, estatus)
         VALUES ($1, $2, $3, $3, 1, 'RESERVADA')`,
        [execB, serieIdOverlap, overlapFolio]
      );

      await expectError(
        persist(cat, execB, serieCodeOverlap, overlapFolio, '2026-09-18', `\\\\SERVER\\CAT\\remisiones\\${marker}_overlapB.pdf`, [{ cantidad_texto: '1 PZA' }]),
        '23505',
        'A different execution must never be able to register a folio already registered by another execution'
      );

      const header = await loadHeader(firstResult.remision_id);
      assert(header.ejecucion_id === execA, 'The folio must remain owned by execution A; it must never be stolen by execution B.');
    }

    // =========================================================
    // 18. Atomic rollback: header + details persist or fail together as one
    // unit. n8n_cat_test has no direct table privileges, so the available,
    // honest way to prove atomicity (without granting it excess privileges
    // just to force an internal constraint failure) is the same technique
    // used by the Phase 11A.3 runner's own atomicity test: wrap a normally
    // successful call in a client-driven transaction and ROLLBACK it,
    // simulating a forced failure downstream of the call, then prove nothing
    // (neither header nor details) persisted.
    // =========================================================
    {
      const ejecucionId = await newExecution();
      const reserva = await reserve(ejecucionId, serieCode, 1);
      const folio = Number(reserva.folio_inicial);
      const client = await cat.connect();
      let rolledBackRemisionId;
      try {
        await client.query('BEGIN');
        const result = (await client.query(
          'SELECT remision_id::text, ya_existia FROM operacion.fn_registrar_remision_generada($1, $2, $3, $4, $5, $6::jsonb)',
          [ejecucionId, serieCode, folio, '2026-09-18', `\\\\SERVER\\CAT\\remisiones\\${marker}_rollback.pdf`, JSON.stringify([{ cantidad_texto: '1 PZA' }, { cantidad_texto: '2 PZA' }])]
        )).rows[0];
        assert(result.ya_existia === false, 'The in-transaction registration must appear to succeed before rollback.');
        rolledBackRemisionId = result.remision_id;
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      const headerAfter = (await hub.query('SELECT remision_id FROM operacion.remisiones WHERE remision_id = $1', [rolledBackRemisionId])).rows;
      assert(headerAfter.length === 0, 'A rolled-back registration must leave no header row behind.');
      const detailsAfter = await countDetails(rolledBackRemisionId);
      assert(detailsAfter === 0, 'A rolled-back registration must leave no detail rows behind.');

      // The folio is still genuinely available afterward - prove it by
      // actually registering it for real, leaving no dangling open fixture.
      const realResult = await persist(cat, ejecucionId, serieCode, folio, '2026-09-18', `\\\\SERVER\\CAT\\remisiones\\${marker}_rollback_real.pdf`, [{ cantidad_texto: '1 PZA' }]);
      assert(realResult.ya_existia === false, 'After a rolled-back attempt, the same folio must still be genuinely registrable.');
    }

    // =========================================================
    // 19/20. Permissions - proved behaviorally through the n8n_cat_test
    // connection itself, and statically via has_table_privilege.
    // =========================================================
    {
      // 19. n8n_cat_test CAN execute the persistence primitive - already
      // demonstrated by every successful persist(cat, ...) call above; a
      // fresh fixture proves it once more, explicitly, in isolation.
      const ejecucionId = await newExecution();
      const reserva = await reserve(ejecucionId, serieCode, 1);
      const proof = await persist(cat, ejecucionId, serieCode, Number(reserva.folio_inicial), '2026-09-18', `\\\\SERVER\\CAT\\remisiones\\${marker}_permproof.pdf`, [{ cantidad_texto: '1 PZA' }]);
      assert(proof.ya_existia === false, 'n8n_cat_test must be able to EXECUTE operacion.fn_registrar_remision_generada.');

      // 20. n8n_cat_test CANNOT directly INSERT/UPDATE remisiones or
      // remision_detalle.
      await expectError(
        cat.query(
          `INSERT INTO operacion.remisiones (serie_id, folio, empresa_cliente_id, ejecucion_id, fecha_documento, pdf_path, estatus)
           VALUES ($1, 999999, $2, $3, '2026-09-18', 'x', 'GENERADA')`,
          [serieId, empresaId, ejecucionId]
        ),
        '42501',
        'n8n_cat_test must not be able to directly INSERT into operacion.remisiones'
      );
      await expectError(
        cat.query("UPDATE operacion.remisiones SET estatus = 'CANCELADA' WHERE remision_id = $1", [proof.remision_id]),
        '42501',
        'n8n_cat_test must not be able to directly UPDATE operacion.remisiones'
      );
      await expectError(
        cat.query(
          `INSERT INTO operacion.remision_detalle (remision_id, cantidad_texto) VALUES ($1, '1 PZA')`,
          [proof.remision_id]
        ),
        '42501',
        'n8n_cat_test must not be able to directly INSERT into operacion.remision_detalle'
      );

      const hubPerms = (await hub.query(
        "SELECT has_function_privilege('daubert_hub_test_user', 'operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)', 'EXECUTE') AS persistence_fn"
      )).rows[0];
      assert(hubPerms.persistence_fn === false, 'The Hub role must not be able to EXECUTE the persistence primitive - only n8n_cat_test may.');
    }

    console.log('Caterpillar remision persistence integration checks passed.');
  } finally {
    try {
      assert((await hub.query('SELECT current_database() AS name')).rows[0].name === 'daubert_hub_test', 'Cleanup database mismatch.');
      await tx(hub, 'DELETE FROM ops.automatizacion_series_proceso WHERE llave_proceso LIKE $1', [`${marker}%`]);
      // The temp automation/series/documents/executions/reservations/
      // remisiones/remision_detalle created above cannot be deleted by any
      // TEST role by design (RESTRICT FKs) - they remain as harmless,
      // uniquely marked rows, same convention as the Phase 11A.2/11A.3
      // runners.
    } finally {
      await hub.end();
      await cat.end();
      await migrator.end();
    }
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
