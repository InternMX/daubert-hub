// Phase 11A.3 - Automation execution finalization.
//
// Companion to test/caterpillar-model.integration.runner.cjs (Phase 11A.2),
// which explicitly left execution finalization out of scope. This runner
// exercises exactly the one new primitive that phase added:
// ops.fn_finalizar_ejecucion_automatizacion(bigint, text, text, text).
//
// Phase 11A.4a update (20260918_003_caterpillar_completion_integrity.up.sql,
// applied AFTER this suite was first written): PROCESANDO -> COMPLETADA now
// additionally requires every reserved folio to already have a materialized
// GENERADA operacion.remisiones row - see materializeReservation() below.
// This runner does not test that invariant itself (see
// test/caterpillar-completion-integrity.integration.runner.cjs for that);
// it only satisfies it wherever a fixture here needs a genuine, successful
// COMPLETADA transition to keep testing what this suite has always tested.
// ERROR/CANCELADA fixtures are deliberately left unmaterialized throughout,
// which is itself still-correct coverage: those paths must never require it.
//
// Three connections, deliberately NOT three application roles:
//   - daubert_hub_test_user (TEST_DATABASE_URL): sets up/tears down temporary
//     automation/series/route fixtures (existing test-fixture INSERT/DELETE
//     grants) and reads operacion.reservas_folios (existing SELECT grant).
//     It is never used to finalize anything. Note: this role DOES already
//     have SELECT on ops.ejecuciones_automatizacion - granted by the
//     pre-existing, unrelated
//     20260828_003_remisiones_audi_activity_read_permissions_test.up.sql
//     (Hub activity-read functionality, predating Phase 11A.3, with a PROD
//     counterpart granting daubert_hub_app the same access). This runner
//     deliberately never asserts that permission either way - it is out of
//     Phase 11A.3's scope and must not be coupled to this suite.
//   - n8n_cat_test (TEST_DATABASE_URL_N8N_CAT_TEST): the least-privilege
//     role that actually calls the SECURITY DEFINER functions, exactly as a
//     future n8n TEST workflow would. Also used directly (not just via
//     has_table_privilege introspection) to *prove* it cannot mutate
//     ops.ejecuciones_automatizacion, operacion.reservas_folios, or
//     operacion.series_documentales - see the PERMISSIONS section.
//   - a separate, elevated TEST-only credential, TEST_DATABASE_URL_MIGRATOR
//     ("migrator"): used EXCLUSIVELY as a read-only introspection tool to
//     verify ops.ejecuciones_automatizacion row state (estado, finalizada_en,
//     error_nodo, error_mensaje) after each finalize call, independent of
//     whatever the Hub role's own historical grants happen to be.
//     TEST_DATABASE_URL_MIGRATOR is expected to point at the same elevated,
//     schema-owning credential a human already uses to apply these
//     migrations by hand (see README's "Database Migrations" section) -
//     nothing is granted to reach it; it is only *referenced*, read-only,
//     from this test runner. It must never be wired into any application
//     role, any n8n credential, or any non-TEST database.
//
// What Phase 11A.3 must never do is *expand* Hub table privileges itself.
// That invariant is checked statically, by reading the two already-applied
// Phase 11A.3 migration files directly and confirming neither one GRANTs
// anything to daubert_hub_test_user - see the MIGRATION-SCOPE REGRESSION
// section below. That check never depends on the live/historical ACL state.
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set for the Caterpillar execution finalization integration runner.`);
  return value;
}

function assertDatabaseName(url, label) {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname).replace(/^\//, '');
  if (name !== 'daubert_hub_test') {
    throw new Error(`Refusing Caterpillar execution finalization integration tests for ${label} against "${name || '(missing)'}". Expected "daubert_hub_test".`);
  }
}

const marker = `HUB_TEST_CAT_FIN_${randomUUID().replace(/-/g, '').toUpperCase()}`;
const autoCode = `${marker}_AUTO`;
const serieCode = `${marker}_SERIE`;
const serieCode2 = `${marker}_SERIE_2`;
const llave = `${marker}|ACTIVA|`;
const llave2 = `${marker}|ACTIVA_2|`;

// A fresh transaction per statement, mirroring the Phase 11A.2 runner and
// apps/api/test/automations.integration.runner.cjs.
async function tx(pool, text, values = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB_TEST']);
    await client.query("SELECT set_config('app.request_id', $1, true)", [`cat-finalize-test-${randomUUID()}`]);
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
    // Fixtures: one temp automation (ACTIVA), two temp series (ACTIVA), one
    // route each - independent of any real seeded Caterpillar data.
    // =========================================================
    const empresaId = (await hub.query("SELECT empresa_id FROM core.empresas WHERE lower(btrim(nombre_comercial)) = 'caterpillar'")).rows[0].empresa_id;

    const autoId = (await tx(hub, 'INSERT INTO ops.automatizaciones (codigo, nombre, estatus) VALUES ($1, $2, $3) RETURNING automatizacion_id::text', [autoCode, 'Temp CAT finalize test automation', 'ACTIVA'])).rows[0].automatizacion_id;
    const serieId = (await tx(hub, 'INSERT INTO operacion.series_documentales (codigo, nombre, siguiente_folio, estatus) VALUES ($1, $2, $3, $4) RETURNING serie_id::text', [serieCode, 'Temp CAT finalize test series', 900, 'ACTIVA'])).rows[0].serie_id;
    const serieId2 = (await tx(hub, 'INSERT INTO operacion.series_documentales (codigo, nombre, siguiente_folio, estatus) VALUES ($1, $2, $3, $4) RETURNING serie_id::text', [serieCode2, 'Temp CAT finalize test series 2', 3000, 'ACTIVA'])).rows[0].serie_id;

    await tx(hub, 'INSERT INTO ops.automatizacion_series_proceso (automatizacion_id, llave_proceso, serie_id, empresa_cliente_id, estatus) VALUES ($1, $2, $3, $4, $5)', [autoId, llave, serieId, empresaId, 'ACTIVA']);
    await tx(hub, 'INSERT INTO ops.automatizacion_series_proceso (automatizacion_id, llave_proceso, serie_id, empresa_cliente_id, estatus) VALUES ($1, $2, $3, $4, $5)', [autoId, llave2, serieId2, empresaId, 'ACTIVA']);

    let fixtureCounter = 0;
    async function newExecutionWithReservation(cantidad = 2) {
      fixtureCounter += 1;
      const rutaArchivo = `C:\\${marker}\\archivo${fixtureCounter}.xlsx`;
      const documentoId = (await cat.query(
        'SELECT documento_id::text FROM core.fn_crear_o_resolver_documento($1, $2, $3, $4, $5)',
        [empresaId, 'PROGRAMACION_ENTREGA', `archivo${fixtureCounter}.xlsx`, rutaArchivo, 'N8N']
      )).rows[0].documento_id;
      const ejecucionId = (await cat.query('SELECT ejecucion_id::text FROM ops.fn_crear_ejecucion_automatizacion($1, $2)', [autoCode, documentoId])).rows[0].ejecucion_id;
      const reserva = (await cat.query(
        'SELECT reserva_id::text, folio_inicial::text, folio_final::text FROM operacion.reservar_folios_para_ejecucion($1, $2, $3)',
        [ejecucionId, serieCode, cantidad]
      )).rows[0];
      return { ejecucionId, reserva };
    }

    async function finalize(pool, ejecucionId, estadoFinal, errorNodo, errorMensaje) {
      const result = await pool.query(
        'SELECT ejecucion_id::text, ya_estaba_finalizada, estado_final, reservas_aplicadas, reservas_abandonadas FROM ops.fn_finalizar_ejecucion_automatizacion($1, $2, $3, $4)',
        [ejecucionId, estadoFinal, errorNodo ?? null, errorMensaje ?? null]
      );
      return result.rows[0];
    }

    // Read-only introspection via the elevated migrator credential only -
    // neither hub nor cat may ever read this table (see header comment).
    async function loadExecution(ejecucionId) {
      return (await migrator.query(
        'SELECT estado, finalizada_en, error_nodo, error_mensaje, iniciada_en FROM ops.ejecuciones_automatizacion WHERE ejecucion_id = $1',
        [ejecucionId]
      )).rows[0];
    }

    async function loadReservation(reservaId) {
      return (await hub.query(
        'SELECT estatus, finalizada_en FROM operacion.reservas_folios WHERE reserva_id = $1',
        [reservaId]
      )).rows[0];
    }

    // Phase 11A.4a completion integrity (20260918_003, unaffected by this
    // runner - see the MIGRATION-SCOPE REGRESSION section below) requires
    // every RESERVADA folio to already have a materialized GENERADA
    // operacion.remisiones row before PROCESANDO -> COMPLETADA is allowed.
    // This runner only exercises the finalizer, so it materializes fixture
    // remisiones through the already-tested Phase 11A.4a persistence
    // primitive (operacion.fn_registrar_remision_generada), called via the
    // SAME n8n_cat_test connection a real workflow would use - not through
    // TEST_DATABASE_URL_MIGRATOR, which stays exclusively a read-only
    // introspection tool in this runner (see header comment). Only the
    // specific COMPLETADA call sites that must actually succeed call this;
    // every ERROR/CANCELADA/rejected-COMPLETADA fixture below is left
    // deliberately unmaterialized, proving those paths still never require it.
    async function materializeReservation(ejecucionId, code, reserva) {
      const folioInicial = Number(reserva.folio_inicial);
      const folioFinal = Number(reserva.folio_final);
      for (let folio = folioInicial; folio <= folioFinal; folio += 1) {
        await cat.query(
          'SELECT remision_id::text, ya_existia FROM operacion.fn_registrar_remision_generada($1, $2, $3, $4, $5, $6::jsonb)',
          [
            ejecucionId,
            code,
            folio,
            '2026-09-18',
            `C:\\${marker}\\remision_${code}_${folio}.pdf`,
            JSON.stringify([{ cantidad_texto: '1 PZA' }])
          ]
        );
      }
    }

    // =========================================================
    // 1/2. PROCESANDO -> COMPLETADA, and RESERVADA -> APLICADA.
    // =========================================================
    const completedCase = await newExecutionWithReservation(2);
    {
      const before = await loadExecution(completedCase.ejecucionId);
      assert(before.estado === 'PROCESANDO' && before.finalizada_en === null, 'Fixture execution must start PROCESANDO with no finalizada_en.');

      // Phase 11A.4a completion integrity: both reserved folios must be
      // materialized as GENERADA remisiones before COMPLETADA is allowed.
      await materializeReservation(completedCase.ejecucionId, serieCode, completedCase.reserva);

      const result = await finalize(cat, completedCase.ejecucionId, 'COMPLETADA');
      assert(result.ya_estaba_finalizada === false, 'A first COMPLETADA finalize must not report ya_estaba_finalizada.');
      assert(result.estado_final === 'COMPLETADA', 'estado_final must echo COMPLETADA.');
      assert(result.reservas_aplicadas === 1, `Expected exactly 1 reservation applied, got ${result.reservas_aplicadas}.`);
      assert(result.reservas_abandonadas === 0, 'COMPLETADA must never abandon reservations.');

      const execAfter = await loadExecution(completedCase.ejecucionId);
      assert(execAfter.estado === 'COMPLETADA', 'Execution must become COMPLETADA.');
      // #18 execution.finalizada_en behavior.
      assert(execAfter.finalizada_en !== null, 'finalizada_en must be set on COMPLETADA.');
      assert(new Date(execAfter.finalizada_en).getTime() >= new Date(execAfter.iniciada_en).getTime(), 'finalizada_en must not precede iniciada_en.');
      // #19 error fields remain NULL for COMPLETADA.
      assert(execAfter.error_nodo === null && execAfter.error_mensaje === null, 'error_nodo/error_mensaje must remain NULL for COMPLETADA.');

      const reservaAfter = await loadReservation(completedCase.reserva.reserva_id);
      assert(reservaAfter.estatus === 'APLICADA', 'Reservation must become APLICADA on completion.');
      // #17 reservation.finalizada_en behavior.
      assert(reservaAfter.finalizada_en !== null, 'Reservation finalizada_en must be set once APLICADA.');
    }

    // =========================================================
    // 9/10. Idempotent same-state re-finalization.
    // =========================================================
    {
      const repeat = await finalize(cat, completedCase.ejecucionId, 'COMPLETADA');
      assert(repeat.ya_estaba_finalizada === true, 'Repeating the same terminal state must report ya_estaba_finalizada = true.');
      assert(repeat.estado_final === 'COMPLETADA', 'Repeated call must still echo the (unchanged) terminal state.');
      assert(repeat.reservas_aplicadas === 0 && repeat.reservas_abandonadas === 0, 'An idempotent repeat must not report touching any reservation again.');

      const reservaStill = await loadReservation(completedCase.reserva.reserva_id);
      assert(reservaStill.estatus === 'APLICADA', 'Repeating COMPLETADA must not change the reservation status again.');
    }

    // =========================================================
    // 3/4/5. PROCESANDO -> ERROR, RESERVADA -> ABANDONADA, error metadata stored.
    // =========================================================
    const errorCase = await newExecutionWithReservation(3);
    {
      const seriesBefore = (await hub.query('SELECT siguiente_folio::text FROM operacion.series_documentales WHERE codigo = $1', [serieCode])).rows[0].siguiente_folio;

      const result = await finalize(cat, errorCase.ejecucionId, 'ERROR', 'Nodo Generar PDF', 'Fallo al generar el PDF de la remision.');
      assert(result.estado_final === 'ERROR', 'estado_final must echo ERROR.');
      assert(result.reservas_abandonadas === 1, `Expected exactly 1 reservation abandoned, got ${result.reservas_abandonadas}.`);
      assert(result.reservas_aplicadas === 0, 'ERROR must never apply reservations.');

      const execAfter = await loadExecution(errorCase.ejecucionId);
      assert(execAfter.estado === 'ERROR', 'Execution must become ERROR.');
      assert(execAfter.finalizada_en !== null, 'finalizada_en must be set on ERROR.');
      assert(execAfter.error_nodo === 'Nodo Generar PDF', 'error_nodo must be persisted exactly as provided.');
      assert(execAfter.error_mensaje === 'Fallo al generar el PDF de la remision.', 'error_mensaje must be persisted exactly as provided.');

      const reservaAfter = await loadReservation(errorCase.reserva.reserva_id);
      assert(reservaAfter.estatus === 'ABANDONADA', 'Reservation must become ABANDONADA on error.');
      assert(reservaAfter.finalizada_en !== null, 'Reservation finalizada_en must be set once ABANDONADA.');

      // #21 siguiente_folio is NEVER rolled back after ERROR.
      const seriesAfter = (await hub.query('SELECT siguiente_folio::text FROM operacion.series_documentales WHERE codigo = $1', [serieCode])).rows[0].siguiente_folio;
      assert(seriesAfter === seriesBefore, `ERROR must never roll back siguiente_folio (expected unchanged at ${seriesBefore}, got ${seriesAfter}).`);
    }

    // =========================================================
    // 6. ERROR requires a nonblank error message.
    // =========================================================
    {
      const nullMessageCase = await newExecutionWithReservation(1);
      await expectError(finalize(cat, nullMessageCase.ejecucionId, 'ERROR', 'Some node', null), '22023', 'ERROR with a NULL error_mensaje must be rejected');

      const blankMessageCase = await newExecutionWithReservation(1);
      await expectError(finalize(cat, blankMessageCase.ejecucionId, 'ERROR', 'Some node', '   '), '22023', 'ERROR with a blank (whitespace-only) error_mensaje must be rejected');

      // Neither rejected attempt may have mutated anything: still PROCESANDO/RESERVADA.
      const execNull = await loadExecution(nullMessageCase.ejecucionId);
      assert(execNull.estado === 'PROCESANDO', 'A rejected ERROR finalize (null message) must leave the execution PROCESANDO.');
      const reservaNull = await loadReservation(nullMessageCase.reserva.reserva_id);
      assert(reservaNull.estatus === 'RESERVADA', 'A rejected ERROR finalize (null message) must leave the reservation RESERVADA.');
    }

    // =========================================================
    // 7/8. PROCESANDO -> CANCELADA, RESERVADA -> ABANDONADA, #20 error fields NULL,
    // #22 siguiente_folio never rolled back after CANCELADA.
    // =========================================================
    const cancelledCase = await newExecutionWithReservation(4);
    {
      const seriesBefore = (await hub.query('SELECT siguiente_folio::text FROM operacion.series_documentales WHERE codigo = $1', [serieCode])).rows[0].siguiente_folio;

      const result = await finalize(cat, cancelledCase.ejecucionId, 'CANCELADA');
      assert(result.estado_final === 'CANCELADA', 'estado_final must echo CANCELADA.');
      assert(result.reservas_abandonadas === 1, `Expected exactly 1 reservation abandoned on cancellation, got ${result.reservas_abandonadas}.`);

      const execAfter = await loadExecution(cancelledCase.ejecucionId);
      assert(execAfter.estado === 'CANCELADA', 'Execution must become CANCELADA.');
      assert(execAfter.finalizada_en !== null, 'finalizada_en must be set on CANCELADA.');
      assert(execAfter.error_nodo === null && execAfter.error_mensaje === null, 'error_nodo/error_mensaje must remain NULL for CANCELADA.');

      const reservaAfter = await loadReservation(cancelledCase.reserva.reserva_id);
      assert(reservaAfter.estatus === 'ABANDONADA', 'Reservation must become ABANDONADA on cancellation.');

      const seriesAfter = (await hub.query('SELECT siguiente_folio::text FROM operacion.series_documentales WHERE codigo = $1', [serieCode])).rows[0].siguiente_folio;
      assert(seriesAfter === seriesBefore, `CANCELADA must never roll back siguiente_folio (expected unchanged at ${seriesBefore}, got ${seriesAfter}).`);
    }

    // =========================================================
    // 11/12/13. Terminal-to-terminal transitions are all rejected (never rewrite history).
    // =========================================================
    await expectError(finalize(cat, completedCase.ejecucionId, 'ERROR', null, 'Attempted rewrite'), '55000', 'COMPLETADA -> ERROR must be rejected');
    await expectError(finalize(cat, errorCase.ejecucionId, 'COMPLETADA'), '55000', 'ERROR -> COMPLETADA must be rejected');
    await expectError(finalize(cat, cancelledCase.ejecucionId, 'COMPLETADA'), '55000', 'CANCELADA -> COMPLETADA must be rejected');

    // =========================================================
    // 14. Nonexistent execution is rejected.
    // =========================================================
    await expectError(finalize(cat, '922337203685477999', 'COMPLETADA'), 'P0002', 'A nonexistent execution id must be rejected');

    // =========================================================
    // 15/16. Invalid target state, and PROCESANDO as a target, are both rejected.
    // =========================================================
    {
      const invalidTargetCase = await newExecutionWithReservation(1);
      await expectError(finalize(cat, invalidTargetCase.ejecucionId, 'NO_ES_UN_ESTADO'), '22023', 'An unrecognized target state must be rejected');

      const procesandoTargetCase = await newExecutionWithReservation(1);
      await expectError(finalize(cat, procesandoTargetCase.ejecucionId, 'PROCESANDO'), '22023', 'PROCESANDO must never be accepted as a final target');

      // Neither rejected attempt may have mutated the execution.
      const execAfter = await loadExecution(invalidTargetCase.ejecucionId);
      assert(execAfter.estado === 'PROCESANDO', 'A rejected invalid-target call must leave the execution untouched.');
    }

    // =========================================================
    // 23. Multiple reservations for one execution (different series) finalize consistently.
    // =========================================================
    {
      const rutaArchivo = `C:\\${marker}\\multi.xlsx`;
      const documentoId = (await cat.query('SELECT documento_id::text FROM core.fn_crear_o_resolver_documento($1, $2, $3, $4, $5)', [empresaId, 'PROGRAMACION_ENTREGA', 'multi.xlsx', rutaArchivo, 'N8N'])).rows[0].documento_id;
      const ejecucionId = (await cat.query('SELECT ejecucion_id::text FROM ops.fn_crear_ejecucion_automatizacion($1, $2)', [autoCode, documentoId])).rows[0].ejecucion_id;
      const reservaA = (await cat.query('SELECT reserva_id::text, folio_inicial::text, folio_final::text FROM operacion.reservar_folios_para_ejecucion($1, $2, $3)', [ejecucionId, serieCode, 1])).rows[0];
      const reservaB = (await cat.query('SELECT reserva_id::text, folio_inicial::text, folio_final::text FROM operacion.reservar_folios_para_ejecucion($1, $2, $3)', [ejecucionId, serieCode2, 1])).rows[0];

      // Phase 11A.4a completion integrity: EVERY reservation belonging to
      // this execution must be fully materialized, regardless of series.
      await materializeReservation(ejecucionId, serieCode, reservaA);
      await materializeReservation(ejecucionId, serieCode2, reservaB);

      const result = await finalize(cat, ejecucionId, 'COMPLETADA');
      assert(result.reservas_aplicadas === 2, `Expected both of the execution's reservations to be applied together, got ${result.reservas_aplicadas}.`);

      const stateA = await loadReservation(reservaA.reserva_id);
      const stateB = await loadReservation(reservaB.reserva_id);
      assert(stateA.estatus === 'APLICADA' && stateB.estatus === 'APLICADA', 'Every reservation belonging to the execution must finalize consistently, regardless of series.');
    }

    // =========================================================
    // 24. Transaction atomicity: a client-driven ROLLBACK after a successful
    // finalize call must undo every effect (execution AND reservation) as one
    // unit, simulating a forced failure downstream of the call.
    // =========================================================
    {
      const rollbackCase = await newExecutionWithReservation(1);
      // Phase 11A.4a completion integrity: materialize BEFORE opening the
      // to-be-rolled-back transaction below, as its own committed call - the
      // later client-driven ROLLBACK must only undo the finalize call's own
      // effects, not this fixture materialization.
      await materializeReservation(rollbackCase.ejecucionId, serieCode, rollbackCase.reserva);

      const client = await cat.connect();
      try {
        await client.query('BEGIN');
        const result = (await client.query(
          'SELECT ejecucion_id::text, estado_final, reservas_aplicadas FROM ops.fn_finalizar_ejecucion_automatizacion($1, $2)',
          [rollbackCase.ejecucionId, 'COMPLETADA']
        )).rows[0];
        assert(result.estado_final === 'COMPLETADA' && result.reservas_aplicadas === 1, 'The in-transaction finalize call must appear to succeed before rollback.');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      const execAfter = await loadExecution(rollbackCase.ejecucionId);
      assert(execAfter.estado === 'PROCESANDO' && execAfter.finalizada_en === null, 'A rolled-back finalize must leave the execution exactly as it was (PROCESANDO, no finalizada_en).');
      const reservaAfter = await loadReservation(rollbackCase.reserva.reserva_id);
      assert(reservaAfter.estatus === 'RESERVADA' && reservaAfter.finalizada_en === null, 'A rolled-back finalize must leave the reservation exactly as it was (RESERVADA, no finalizada_en).');

      // The execution is still genuinely PROCESANDO afterward - prove it by
      // actually finalizing it for real, leaving no dangling open fixture.
      const realResult = await finalize(cat, rollbackCase.ejecucionId, 'CANCELADA');
      assert(realResult.ya_estaba_finalizada === false && realResult.estado_final === 'CANCELADA', 'After a rolled-back attempt, the execution must still be genuinely finalizable.');
    }

    // Additional atomicity angle: an argument-validation failure (invalid
    // combination) must write nothing at all, not even partially.
    {
      const invalidComboCase = await newExecutionWithReservation(1);
      await expectError(finalize(cat, invalidComboCase.ejecucionId, 'COMPLETADA', 'Should not be allowed', null), '22023', 'COMPLETADA with a nonblank error_nodo must be rejected before any write');
      const execAfter = await loadExecution(invalidComboCase.ejecucionId);
      assert(execAfter.estado === 'PROCESANDO', 'A validation failure must leave the execution completely untouched.');
      const reservaAfter = await loadReservation(invalidComboCase.reserva.reserva_id);
      assert(reservaAfter.estatus === 'RESERVADA', 'A validation failure must leave the reservation completely untouched.');
    }

    // =========================================================
    // 25/26. Permissions - proved behaviorally through the n8n_cat_test
    // connection itself (TEST_DATABASE_URL_N8N_CAT_TEST), not by asking a
    // more-privileged role to introspect its ACL.
    // =========================================================
    {
      // 25. n8n_cat_test CAN execute the finalization primitive - already
      // demonstrated by every successful finalize(cat, ...) call above; a
      // fresh fixture proves it once more, explicitly, in isolation.
      const provingCase = await newExecutionWithReservation(1);
      const proof = await finalize(cat, provingCase.ejecucionId, 'CANCELADA');
      assert(proof.estado_final === 'CANCELADA', 'n8n_cat_test must be able to EXECUTE ops.fn_finalizar_ejecucion_automatizacion.');

      // 26a. n8n_cat_test CANNOT directly UPDATE ops.ejecuciones_automatizacion.
      await expectError(
        cat.query("UPDATE ops.ejecuciones_automatizacion SET estado = 'CANCELADA' WHERE ejecucion_id = $1", [provingCase.ejecucionId]),
        '42501',
        'n8n_cat_test must not be able to directly UPDATE ops.ejecuciones_automatizacion'
      );

      // 26b. n8n_cat_test CANNOT directly UPDATE operacion.reservas_folios.
      await expectError(
        cat.query("UPDATE operacion.reservas_folios SET estatus = 'ABANDONADA' WHERE reserva_id = $1", [provingCase.reserva.reserva_id]),
        '42501',
        'n8n_cat_test must not be able to directly UPDATE operacion.reservas_folios'
      );

      // 26c. n8n_cat_test CANNOT directly mutate operacion.series_documentales.
      await expectError(
        cat.query('UPDATE operacion.series_documentales SET siguiente_folio = siguiente_folio + 1 WHERE codigo = $1', [serieCode]),
        '42501',
        'n8n_cat_test must not be able to directly mutate operacion.series_documentales'
      );

      // The Hub role must likewise never be able to EXECUTE the finalizer
      // (only n8n_cat_test may) - a plain has_function_privilege check needs
      // no table grant of any kind to answer this.
      const hubPerms = (await hub.query(
        "SELECT has_function_privilege('daubert_hub_test_user', 'ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)', 'EXECUTE') AS finalizer_fn"
      )).rows[0];
      assert(hubPerms.finalizer_fn === false, 'The Hub role must not be able to EXECUTE the finalization primitive - only n8n_cat_test may.');

      // Deliberately NOT asserted here: whether daubert_hub_test_user has
      // SELECT on ops.ejecuciones_automatizacion. It does - granted by the
      // pre-existing, unrelated
      // 20260828_003_remisiones_audi_activity_read_permissions_test.up.sql
      // (Hub activity-read functionality, predating Phase 11A.3 entirely,
      // with a PROD counterpart granting daubert_hub_app the same access).
      // That grant is intentional historical application behavior, is out
      // of Phase 11A.3's scope, and must never be asserted true OR false by
      // this runner - either assertion would wrongly couple an unrelated
      // historical permission to this phase's own test suite. What Phase
      // 11A.3 actually must never do is *expand* Hub privileges itself; see
      // the static migration-content check below for that.
    }

    // =========================================================
    // Phase 11A.3 migration-scope regression (static, file-content only -
    // never depends on the live/historical ACL state, which the Hub role
    // legitimately already has permissions within from unrelated phases).
    // Verifies the invariant "Phase 11A.3 must not expand Hub table
    // privileges" directly against the two already-applied migration files,
    // without reapplying or otherwise touching them.
    // =========================================================
    {
      const migrationsDir = path.join(require('os').homedir(), 'Documents', 'Dropbox', 'Pruebas', 'BASE DE DATOS', 'MIGRACIONES', 'daubert_hub_test');
      const phase11a3Files = [
        '20260917_001_caterpillar_execution_finalization.up.sql',
        '20260917_002_caterpillar_execution_finalization_n8n_permissions.up.sql'
      ];
      for (const fileName of phase11a3Files) {
        const contents = fs.readFileSync(path.join(migrationsDir, fileName), 'utf8');
        const grantsToHub = contents
          .split('\n')
          .filter((line) => /\bGRANT\b/i.test(line) && /daubert_hub_test_user/i.test(line));
        assert(
          grantsToHub.length === 0,
          `Phase 11A.3 file ${fileName} must not GRANT anything to daubert_hub_test_user (found: ${JSON.stringify(grantsToHub)}).`
        );
      }
    }

    console.log('Caterpillar execution finalization integration checks passed.');
  } finally {
    try {
      assert((await hub.query('SELECT current_database() AS name')).rows[0].name === 'daubert_hub_test', 'Cleanup database mismatch.');
      // Route rows are leaves and can always be cleaned up.
      await tx(hub, 'DELETE FROM ops.automatizacion_series_proceso WHERE llave_proceso LIKE $1', [`${marker}%`]);
      // The temp automation/series/documents/executions/reservations created
      // above cannot be deleted by any TEST role by design (RESTRICT FKs) -
      // they remain as harmless, uniquely marked rows, same convention as
      // the Phase 11A.2 runner.
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
