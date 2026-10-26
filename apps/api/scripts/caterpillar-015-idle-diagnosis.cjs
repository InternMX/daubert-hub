// READ ONLY diagnosis of the 015 precheck "reviewed idle cutover required". BEGIN READ ONLY only; no writes, DDL or functions.
// Condition mirrored from 015 precheck: any REMISIONES_CATERPILLAR execution with estado='PROCESANDO' OR whose origin document has caterpillar_admission IS NOT NULL.
const { Pool } = require('pg');
const { guardedUrl } = require('../test/support/caterpillar-cancellation-test-guards.cjs');

const QUERIES = {
  blockers: `SELECT e.ejecucion_id, e.estado, e.documento_origen_id, e.n8n_execution_id, e.reproceso_de_id,
      (e.estado='PROCESANDO') AS blocks_by_processing,
      (to_jsonb(d)->'caterpillar_admission' IS NOT NULL AND to_jsonb(d)->'caterpillar_admission'<>'null'::jsonb) AS blocks_by_snapshot,
      (SELECT count(*)::int FROM operacion.reservas_folios r WHERE r.ejecucion_id=e.ejecucion_id) AS reservations,
      (SELECT jsonb_agg(DISTINCT r.estatus) FROM operacion.reservas_folios r WHERE r.ejecucion_id=e.ejecucion_id) AS reservation_states,
      (SELECT count(*)::int FROM operacion.remisiones m WHERE m.ejecucion_id=e.ejecucion_id) AS remissions,
      to_jsonb(e) - 'ejecucion_id' - 'estado' - 'documento_origen_id' - 'n8n_execution_id' - 'reproceso_de_id' AS other_columns
    FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
    JOIN core.documentos d ON d.documento_id=e.documento_origen_id
    WHERE a.codigo='REMISIONES_CATERPILLAR'
      AND (e.estado='PROCESANDO' OR (to_jsonb(d)->'caterpillar_admission' IS NOT NULL AND to_jsonb(d)->'caterpillar_admission'<>'null'::jsonb))
    ORDER BY e.ejecucion_id`,
  document214: `SELECT d.documento_id, d.tipo_documento,
      (to_jsonb(d)->'caterpillar_admission' IS NOT NULL AND to_jsonb(d)->'caterpillar_admission'<>'null'::jsonb) AS has_snapshot,
      (SELECT jsonb_agg(jsonb_build_object('ejecucion_id',e.ejecucion_id,'estado',e.estado,'n8n_execution_id',e.n8n_execution_id,'reproceso_de_id',e.reproceso_de_id) ORDER BY e.ejecucion_id)
         FROM ops.ejecuciones_automatizacion e WHERE e.documento_origen_id=d.documento_id) AS executions
    FROM core.documentos d WHERE d.documento_id=214`,
  worker_activity: `SELECT count(*)::int AS other_backends_in_test, count(*) FILTER (WHERE state<>'idle')::int AS non_idle,
      count(*) FILTER (WHERE usename='n8n_cat_test')::int AS cat_test_backends
    FROM pg_stat_activity WHERE datname='daubert_hub_test' AND pid<>pg_backend_pid()`,
  state_counts: `SELECT e.estado, count(*)::int FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
    WHERE a.codigo='REMISIONES_CATERPILLAR' GROUP BY 1 ORDER BY 1`
};

async function run() {
  const url = guardedUrl(process.env.TEST_DATABASE_URL_MIGRATOR, 'postgres');
  const pool = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 5000, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY; SET LOCAL statement_timeout='20s'");
    const out = {};
    for (const [name, sql] of Object.entries(QUERIES)) out[name] = (await client.query(sql)).rows;
    console.log(JSON.stringify({ result: 'TEST_015_IDLE_DIAGNOSIS_READONLY', ...out }, null, 2));
  } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); await pool.end(); }
}
if (require.main === module) run().catch(error => {
  console.error('TEST_015_IDLE_DIAGNOSIS_FAILED; raw errors suppressed; SQLSTATE=' + (/^[A-Z0-9]{5}$/.test(error.code || '') ? error.code : 'NONE'));
  process.exitCode = 1;
});
module.exports = { QUERIES };
