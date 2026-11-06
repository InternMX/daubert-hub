'use strict';

// READ ONLY report of the B1 end-to-end run in daubert_hub_test (BEGIN READ ONLY ... ROLLBACK). It writes nothing.
//   node scripts/caterpillar-b1-e2e-report.cjs [--since 238] [--historical 268]
// B1 expectations: the historical document keeps NO snapshot and gains no execution, reservation or remission after <since>; executions after <since> are COMPLETADA with
// their reservation APLICADA and equal remissions; no PROCESANDO; the evidence of 237/238 and the RESERVADA reservations are untouched.
const { Pool } = require('pg');
const { guardedUrl, assert } = require('../test/support/caterpillar-cancellation-test-guards.cjs');

const option = (flag, fallback) => { const i = process.argv.indexOf(flag); return i > 0 ? Number(process.argv[i + 1]) : fallback; };
const since = option('--since', 238);
const historical = option('--historical', 268);

async function run() {
  assert(Number.isSafeInteger(since) && since >= 0 && Number.isSafeInteger(historical) && historical > 0, 'Invalid arguments');
  const url = guardedUrl(process.env.TEST_DATABASE_URL_MIGRATOR, 'postgres');
  const pool = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 5000, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY; SET LOCAL statement_timeout='20s'");
    const one = async (sql, params = []) => (await client.query(sql, params)).rows;
    const historicalDocument = await one(`SELECT d.documento_id, d.nombre_archivo, (d.caterpillar_admission IS NOT NULL) AS has_snapshot,
        (SELECT count(*)::int FROM ops.ejecuciones_automatizacion e WHERE e.documento_origen_id = d.documento_id) AS executions,
        (SELECT count(*)::int FROM ops.ejecuciones_automatizacion e WHERE e.documento_origen_id = d.documento_id AND e.ejecucion_id > $2) AS executions_after_since,
        (SELECT count(*)::int FROM operacion.remisiones r JOIN ops.ejecuciones_automatizacion e USING (ejecucion_id) WHERE e.documento_origen_id = d.documento_id) AS remissions
      FROM core.documentos d WHERE d.documento_id = $1`, [historical, since]);
    const newExecutions = await one(`SELECT e.ejecucion_id, e.estado, e.documento_origen_id, e.n8n_execution_id, d.nombre_archivo, (d.caterpillar_admission IS NOT NULL) AS has_snapshot,
        (SELECT jsonb_agg(jsonb_build_object('serie', s.codigo, 'rango', f.folio_inicial || '-' || f.folio_final, 'cantidad', f.cantidad, 'estatus', f.estatus))
           FROM operacion.reservas_folios f JOIN operacion.series_documentales s USING (serie_id) WHERE f.ejecucion_id = e.ejecucion_id) AS reservations,
        (SELECT count(*)::int FROM operacion.remisiones r WHERE r.ejecucion_id = e.ejecucion_id AND r.estatus = 'GENERADA') AS generated_remissions
      FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING (automatizacion_id) JOIN core.documentos d ON d.documento_id = e.documento_origen_id
      WHERE a.codigo = 'REMISIONES_CATERPILLAR' AND e.ejecucion_id > $1 ORDER BY e.ejecucion_id`, [since]);
    const counters = await one(`SELECT
        (SELECT count(*)::int FROM ops.ejecuciones_automatizacion WHERE estado = 'PROCESANDO') AS procesando,
        (SELECT count(*)::int FROM operacion.reservas_folios WHERE estatus = 'RESERVADA') AS reservada,
        (SELECT string_agg(codigo || '=' || siguiente_folio, ', ' ORDER BY codigo) FROM operacion.series_documentales WHERE codigo IN ('REMISION_CAT_P2', 'REMISION_CAT_P5', 'REMISION_CAT_P6')) AS next_folios,
        (SELECT string_agg(ejecucion_id || ':' || estado, ',' ORDER BY ejecucion_id) FROM ops.ejecuciones_automatizacion WHERE ejecucion_id IN (237, 238)) AS evidence_237_238`);
    const mismatches = await one(`SELECT e.ejecucion_id FROM ops.ejecuciones_automatizacion e JOIN operacion.reservas_folios f USING (ejecucion_id)
      WHERE e.ejecucion_id > $1 AND (e.estado <> 'COMPLETADA' OR f.estatus <> 'APLICADA'
        OR f.cantidad <> (SELECT count(*) FROM operacion.remisiones r WHERE r.ejecucion_id = e.ejecucion_id AND r.estatus = 'GENERADA'))`, [since]);
    const document = historicalDocument[0];
    const checks = {
      historicalExists: Boolean(document),
      historicalStillWithoutSnapshot: document ? document.has_snapshot === false : false,
      historicalGainedNothing: document ? document.executions_after_since === 0 : false,
      newExecutionsAllCompletedAndReconciled: mismatches.length === 0 && newExecutions.every(e => e.estado === 'COMPLETADA'),
      noneOfTheNewExecutionsBelongsToTheHistorical: newExecutions.every(e => Number(e.documento_origen_id) !== historical),
      noProcessing: counters[0].procesando === 0
    };
    const pass = Object.values(checks).every(Boolean);
    console.log(JSON.stringify({ result: pass ? 'B1_E2E_REPORT_PASS' : 'B1_E2E_REPORT_REVIEW', since, historical: document, newExecutions, counters: counters[0], checks }, null, 2));
    if (!pass) process.exitCode = 3;
  } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); await pool.end(); }
}
run().catch(error => {
  console.error('B1_E2E_REPORT_FAILED; raw errors suppressed; SQLSTATE=' + (/^[A-Z0-9]{5}$/.test(error.code || '') ? error.code : 'NONE'));
  process.exitCode = 1;
});
