// Phase 11A.4a - Completion integrity for ops.fn_finalizar_ejecucion_automatizacion.
//
// Companion to test/caterpillar-execution-finalization.integration.runner.cjs
// (Phase 11A.3, unmodified and re-run separately as a regression) and
// test/caterpillar-remision-persistence.integration.runner.cjs (this phase's
// other new primitive). Exercises exactly the strengthening this phase adds
// to the already-applied Phase 11A.3 finalizer, via CREATE OR REPLACE on the
// same signature (20260918_003_caterpillar_completion_integrity.up.sql):
// PROCESANDO -> COMPLETADA now requires every reserved folio to have a
// materialized GENERADA operacion.remisiones row before it is allowed.
//
// Same three-connection pattern as the Phase 11A.3 runner - see that file's
// header for the general rationale. TEST_DATABASE_URL_MIGRATOR is used here
// for two purposes:
//   - read-only introspection of ops.ejecuciones_automatizacion, exactly as
//     the Phase 11A.3 runner already does;
//   - fabricating, exactly once (test #26 below), a reservation that
//     overlaps another execution's already-registered folio on the same
//     series - the same otherwise-unreachable fixture technique the
//     persistence runner's own test #17 uses, and for the same reason: the
//     real allocator can never produce this state, so the only way to prove
//     the finalizer's "does this folio genuinely belong to THIS execution"
//     check actually fires is to construct the impossible case directly.
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set for the Caterpillar completion integrity integration runner.`);
  return value;
}

function assertDatabaseName(url, label) {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname).replace(/^\//, '');
  if (name !== 'daubert_hub_test') {
    throw new Error(`Refusing Caterpillar completion integrity integration tests for ${label} against "${name || '(missing)'}". Expected "daubert_hub_test".`);
  }
}

const marker = `HUB_TEST_CAT_CI_${randomUUID().replace(/-/g, '').toUpperCase()}`;
const autoCode = `${marker}_AUTO`;
const serieCode = `${marker}_SERIE_A`;
const serieCode2 = `${marker}_SERIE_B`;
const serieCodeOverlap = `${marker}_SERIE_OVERLAP`;
const llave = `${marker}|A|`;
const llave2 = `${marker}|B|`;
const llaveOverlap = `${marker}|OVERLAP|`;

async function tx(pool, text, values = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB_TEST']);
    await client.query("SELECT set_config('app.request_id', $1, true)", [`cat-completion-test-${randomUUID()}`]);
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
    // Fixtures.
    // =========================================================
    const empresaId = (await hub.query("SELECT empresa_id FROM core.empresas WHERE lower(btrim(nombre_comercial)) = 'caterpillar'")).rows[0].empresa_id;

    const autoId = (await tx(hub, 'INSERT INTO ops.automatizaciones (codigo, nombre, estatus) VALUES ($1, $2, $3) RETURNING automatizacion_id::text', [autoCode, 'Temp CAT completion integrity automation', 'ACTIVA'])).rows[0].automatizacion_id;
    const serieId = (await tx(hub, 'INSERT INTO operacion.series_documentales (codigo, nombre, siguiente_folio, estatus) VALUES ($1, $2, $3, $4) RETURNING serie_id::text', [serieCode, 'Temp CAT completion series A', 200, 'ACTIVA'])).rows[0].serie_id;
    const serieId2 = (await tx(hub, 'INSERT INTO operacion.series_documentales (codigo, nombre, siguiente_folio, estatus) VALUES ($1, $2, $3, $4) RETURNING serie_id::text', [serieCode2, 'Temp CAT completion series B', 400, 'ACTIVA'])).rows[0].serie_id;
    const serieIdOverlap = (await tx(hub, 'INSERT INTO operacion.series_documentales (codigo, nombre, siguiente_folio, estatus) VALUES ($1, $2, $3, $4) RETURNING serie_id::text', [serieCodeOverlap, 'Temp CAT completion overlap series', 6000, 'ACTIVA'])).rows[0].serie_id;

    await tx(hub, 'INSERT INTO ops.automatizacion_series_proceso (automatizacion_id, llave_proceso, serie_id, empresa_cliente_id, estatus) VALUES ($1, $2, $3, $4, $5)', [autoId, llave, serieId, empresaId, 'ACTIVA']);
    await tx(hub, 'INSERT INTO ops.automatizacion_series_proceso (automatizacion_id, llave_proceso, serie_id, empresa_cliente_id, estatus) VALUES ($1, $2, $3, $4, $5)', [autoId, llave2, serieId2, empresaId, 'ACTIVA']);
    await tx(hub, 'INSERT INTO ops.automatizacion_series_proceso (automatizacion_id, llave_proceso, serie_id, empresa_cliente_id, estatus) VALUES ($1, $2, $3, $4, $5)', [autoId, llaveOverlap, serieIdOverlap, empresaId, 'ACTIVA']);

    let fixtureCounter = 0;
    async function newExecution() {
      fixtureCounter += 1;
      const rutaArchivo = `C:\\${marker}\\archivo${fixtureCounter}.xlsx`;
      const documentoId = (await cat.query(
        'SELECT documento_id::text FROM core.fn_crear_o_resolver_documento($1, $2, $3, $4, $5)',
        [empresaId, 'PROGRAMACION_ENTREGA', `archivo${fixtureCounter}.xlsx`, rutaArchivo, 'N8N']
      )).rows[0].documento_id;
      return (await cat.query('SELECT ejecucion_id::text FROM ops.fn_crear_ejecucion_automatizacion($1, $2)', [autoCode, documentoId])).rows[0].ejecucion_id;
    }

    async function reserve(ejecucionId, code, cantidad) {
      return (await cat.query(
        'SELECT reserva_id::text, folio_inicial::text, folio_final::text FROM operacion.reservar_folios_para_ejecucion($1, $2, $3)',
        [ejecucionId, code, cantidad]
      )).rows[0];
    }

    async function persist(ejecucionId, code, folio, detalles = [{ cantidad_texto: '1 PZA' }]) {
      return (await cat.query(
        'SELECT remision_id::text, ya_existia FROM operacion.fn_registrar_remision_generada($1, $2, $3, $4, $5, $6::jsonb)',
        [ejecucionId, code, folio, '2026-09-18', `\\\\SERVER\\CAT\\remisiones\\${marker}_${folio}.pdf`, JSON.stringify(detalles)]
      )).rows[0];
    }

    async function finalize(pool, ejecucionId, estadoFinal, errorNodo, errorMensaje) {
      const result = await pool.query(
        'SELECT ejecucion_id::text, ya_estaba_finalizada, estado_final, reservas_aplicadas, reservas_abandonadas FROM ops.fn_finalizar_ejecucion_automatizacion($1, $2, $3, $4)',
        [ejecucionId, estadoFinal, errorNodo ?? null, errorMensaje ?? null]
      );
      return result.rows[0];
    }

    async function loadExecution(ejecucionId) {
      return (await migrator.query(
        'SELECT estado, finalizada_en FROM ops.ejecuciones_automatizacion WHERE ejecucion_id = $1',
        [ejecucionId]
      )).rows[0];
    }

    async function loadReservation(reservaId) {
      return (await hub.query(
        'SELECT estatus, finalizada_en FROM operacion.reservas_folios WHERE reserva_id = $1',
        [reservaId]
      )).rows[0];
    }

    async function loadSiguienteFolio(code) {
      return (await hub.query('SELECT siguiente_folio::text FROM operacion.series_documentales WHERE codigo = $1', [code])).rows[0].siguiente_folio;
    }

    // =========================================================
    // 21. COMPLETADA succeeds when every reserved folio is GENERADA.
    // =========================================================
    let fullyMaterializedCase;
    {
      const ejecucionId = await newExecution();
      const reserva = await reserve(ejecucionId, serieCode, 3);
      const folioInicial = Number(reserva.folio_inicial);
      for (let i = 0; i < 3; i += 1) {
        await persist(ejecucionId, serieCode, folioInicial + i);
      }

      const result = await finalize(cat, ejecucionId, 'COMPLETADA');
      assert(result.estado_final === 'COMPLETADA', '#21 COMPLETADA must succeed when every reserved folio has a materialized GENERADA remision.');
      assert(result.reservas_aplicadas === 1, 'Expected exactly 1 reservation applied.');

      const execAfter = await loadExecution(ejecucionId);
      assert(execAfter.estado === 'COMPLETADA', 'Execution must become COMPLETADA.');
      const reservaAfter = await loadReservation(reserva.reserva_id);
      assert(reservaAfter.estatus === 'APLICADA', 'Reservation must become APLICADA.');

      fullyMaterializedCase = { ejecucionId };
    }

    // =========================================================
    // 22. Every reservation belonging to a multi-series execution must
    // become APLICADA together, each requiring its own full materialization.
    // =========================================================
    {
      const ejecucionId = await newExecution();
      const reservaA = await reserve(ejecucionId, serieCode, 2);
      const reservaB = await reserve(ejecucionId, serieCode2, 1);
      const folioAInicial = Number(reservaA.folio_inicial);
      await persist(ejecucionId, serieCode, folioAInicial);
      await persist(ejecucionId, serieCode, folioAInicial + 1);
      await persist(ejecucionId, serieCode2, Number(reservaB.folio_inicial));

      const result = await finalize(cat, ejecucionId, 'COMPLETADA');
      assert(result.reservas_aplicadas === 2, '#22 every reservation belonging to the execution must be applied together.');

      const stateA = await loadReservation(reservaA.reserva_id);
      const stateB = await loadReservation(reservaB.reserva_id);
      assert(stateA.estatus === 'APLICADA' && stateB.estatus === 'APLICADA', '#22 all reservations must become APLICADA.');
    }

    // =========================================================
    // 23/24/25. COMPLETADA fails when one reserved folio is missing; the
    // execution remains PROCESANDO and the reservation remains RESERVADA.
    // =========================================================
    {
      const ejecucionId = await newExecution();
      const reserva = await reserve(ejecucionId, serieCode, 4);
      const folioInicial = Number(reserva.folio_inicial);
      // Only 119-121-equivalent (3 of 4) are materialized; the last folio is
      // deliberately left unregistered.
      await persist(ejecucionId, serieCode, folioInicial);
      await persist(ejecucionId, serieCode, folioInicial + 1);
      await persist(ejecucionId, serieCode, folioInicial + 2);

      await expectError(
        finalize(cat, ejecucionId, 'COMPLETADA'),
        '55000',
        '#23 COMPLETADA must fail when one reserved folio has no materialized GENERADA remision'
      );

      const execAfter = await loadExecution(ejecucionId);
      assert(execAfter.estado === 'PROCESANDO', '#24 the execution must remain PROCESANDO after a failed completion.');
      const reservaAfter = await loadReservation(reserva.reserva_id);
      assert(reservaAfter.estatus === 'RESERVADA' && reservaAfter.finalizada_en === null, '#25 the reservation must remain RESERVADA after a failed completion.');

      // The execution must still be genuinely completable once the missing
      // folio is materialized - proves the check is exact, not permanently
      // stuck.
      await persist(ejecucionId, serieCode, folioInicial + 3);
      const retry = await finalize(cat, ejecucionId, 'COMPLETADA');
      assert(retry.estado_final === 'COMPLETADA', 'Once every folio is materialized, COMPLETADA must succeed.');
    }

    // =========================================================
    // 26. COMPLETADA fails if a matching folio belongs to a DIFFERENT
    // execution. See header comment for why the overlap fixture requires the
    // elevated migrator credential.
    // =========================================================
    {
      const execA = await newExecution();
      const reservaA = await reserve(execA, serieCodeOverlap, 1);
      const overlapFolio = Number(reservaA.folio_inicial);
      const registered = await persist(execA, serieCodeOverlap, overlapFolio);
      assert(registered.ya_existia === false, 'Execution A must register the overlap-test folio first.');

      const execB = await newExecution();
      await migrator.query(
        `INSERT INTO operacion.reservas_folios (ejecucion_id, serie_id, folio_inicial, folio_final, cantidad, estatus)
         VALUES ($1, $2, $3, $3, 1, 'RESERVADA')`,
        [execB, serieIdOverlap, overlapFolio]
      );

      await expectError(
        finalize(cat, execB, 'COMPLETADA'),
        '55000',
        '#26 COMPLETADA must fail when the only matching folio actually belongs to a different execution'
      );

      const execBAfter = await loadExecution(execB);
      assert(execBAfter.estado === 'PROCESANDO', 'Execution B must remain PROCESANDO - it never genuinely owned that folio.');
    }

    // =========================================================
    // 27. COMPLETADA fails if the matching remittance is CANCELADA instead
    // of GENERADA. There is no cancellation primitive yet (out of this
    // phase's scope), so the CANCELADA state is fabricated directly via the
    // elevated migrator credential purely to exercise this one check.
    // =========================================================
    {
      const ejecucionId = await newExecution();
      const reserva = await reserve(ejecucionId, serieCode2, 1);
      const folio = Number(reserva.folio_inicial);
      const registered = await persist(ejecucionId, serieCode2, folio);
      await migrator.query("UPDATE operacion.remisiones SET estatus = 'CANCELADA' WHERE remision_id = $1", [registered.remision_id]);

      await expectError(
        finalize(cat, ejecucionId, 'COMPLETADA'),
        '55000',
        '#27 COMPLETADA must fail when the matching remision is CANCELADA rather than GENERADA'
      );

      const execAfter = await loadExecution(ejecucionId);
      assert(execAfter.estado === 'PROCESANDO', 'The execution must remain PROCESANDO when the only matching remision is CANCELADA.');
    }

    // =========================================================
    // 28/29. ERROR and CANCELADA still succeed with ZERO materialized
    // remittances - the completion-integrity check applies only to
    // COMPLETADA.
    // =========================================================
    {
      const errorCase = await newExecution();
      await reserve(errorCase, serieCode, 1);
      const errorResult = await finalize(cat, errorCase, 'ERROR', 'Nodo Generar PDF', 'Fallo simulado sin remisiones materializadas.');
      assert(errorResult.estado_final === 'ERROR', '#28 ERROR must succeed with zero materialized remisiones.');
      assert(errorResult.reservas_abandonadas === 1, 'ERROR must abandon the reservation.');

      const cancelledCase = await newExecution();
      await reserve(cancelledCase, serieCode, 1);
      const cancelledResult = await finalize(cat, cancelledCase, 'CANCELADA');
      assert(cancelledResult.estado_final === 'CANCELADA', '#29 CANCELADA must succeed with zero materialized remisiones.');
      assert(cancelledResult.reservas_abandonadas === 1, 'CANCELADA must abandon the reservation.');
    }

    // =========================================================
    // 30. ERROR/CANCELADA still never roll back siguiente_folio.
    // =========================================================
    {
      const before = await loadSiguienteFolio(serieCode);
      const ejecucionId = await newExecution();
      await reserve(ejecucionId, serieCode, 2);
      await finalize(cat, ejecucionId, 'ERROR', 'Nodo X', 'Fallo simulado.');
      const after = await loadSiguienteFolio(serieCode);
      assert(after !== before, 'siguiente_folio must still advance when a reservation is made (sanity check on the fixture itself).');

      const beforeCancel = await loadSiguienteFolio(serieCode);
      const cancelCase = await newExecution();
      await reserve(cancelCase, serieCode, 2);
      const afterReserve = await loadSiguienteFolio(serieCode);
      await finalize(cat, cancelCase, 'CANCELADA');
      const afterFinalize = await loadSiguienteFolio(serieCode);
      assert(afterFinalize === afterReserve && afterFinalize !== beforeCancel, '#30 CANCELADA must never roll back siguiente_folio (it stays at its post-reservation value).');
    }

    // =========================================================
    // 31. Same-state finalizer idempotency remains intact after the
    // completion-integrity change.
    // =========================================================
    {
      const repeat = await finalize(cat, fullyMaterializedCase.ejecucionId, 'COMPLETADA');
      assert(repeat.ya_estaba_finalizada === true, '#31 repeating the same terminal state (COMPLETADA) must still report ya_estaba_finalizada = true.');
      assert(repeat.reservas_aplicadas === 0 && repeat.reservas_abandonadas === 0, '#31 an idempotent repeat must not report touching any reservation again.');
      assert(repeat.estado_final === 'COMPLETADA', '#31 the repeated call must still echo the unchanged terminal state.');

      // The idempotency short-circuit must fire BEFORE the completion
      // integrity check would ever re-run (it must never re-validate
      // materialization on an already-COMPLETADA execution).
      const execAfter = await loadExecution(fullyMaterializedCase.ejecucionId);
      assert(execAfter.estado === 'COMPLETADA', 'Execution must remain COMPLETADA.');
    }

    console.log('Caterpillar completion integrity integration checks passed.');
  } finally {
    try {
      assert((await hub.query('SELECT current_database() AS name')).rows[0].name === 'daubert_hub_test', 'Cleanup database mismatch.');
      await tx(hub, 'DELETE FROM ops.automatizacion_series_proceso WHERE llave_proceso LIKE $1', [`${marker}%`]);
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
