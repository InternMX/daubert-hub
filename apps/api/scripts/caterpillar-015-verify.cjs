// (A cancelled remission is still a remission of its reservation: the check counts the folios of the range regardless of status.)
// READ ONLY post-test verification of Caterpillar executions in daubert_hub_test. Usage: node scripts/caterpillar-015-verify.cjs [--since <ejecucion_id>]
// Reports the executions after <since> (default 169 = highest execution id at the 015 cutover; older rows include the deliberate *_SERIE_OVERLAP allocator fixtures and pre-014 executions without snapshot) and the invariant violations (duplicate folios, multiple children, COMPLETADA mismatches are whole-table; overlaps and missing snapshots are scoped to rows after <since>).
const { Pool } = require('pg');
const { guardedUrl, assert } = require('../test/support/caterpillar-cancellation-test-guards.cjs');

const since = (() => { const i = process.argv.indexOf('--since'); return i > 0 ? Number(process.argv[i + 1]) : 169; })();
const QUERIES = {
  executions: `SELECT e.ejecucion_id,e.estado,e.documento_origen_id,e.n8n_execution_id,e.reproceso_de_id,e.intentos_fallidos,
      (to_jsonb(d)->'caterpillar_admission' IS NOT NULL AND to_jsonb(d)->'caterpillar_admission'<>'null'::jsonb) AS has_snapshot,
      (SELECT jsonb_agg(jsonb_build_object('serie',s.codigo,'rango',f.folio_inicial||'-'||f.folio_final,'cantidad',f.cantidad,'estatus',f.estatus))
         FROM operacion.reservas_folios f JOIN operacion.series_documentales s USING(serie_id) WHERE f.ejecucion_id=e.ejecucion_id) AS reservations,
      (SELECT jsonb_object_agg(x.estatus,x.n) FROM (SELECT estatus,count(*) n FROM operacion.remisiones m WHERE m.ejecucion_id=e.ejecucion_id GROUP BY 1) x) AS remissions
    FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id) JOIN core.documentos d ON d.documento_id=e.documento_origen_id
    WHERE a.codigo='REMISIONES_CATERPILLAR' AND e.ejecucion_id>$1 ORDER BY e.ejecucion_id`,
  violations: `SELECT 'DUPLICATE_FOLIO' AS rule,serie_id::text||':'||folio::text AS detail FROM operacion.remisiones GROUP BY serie_id,folio HAVING count(*)>1
    UNION ALL SELECT 'MULTIPLE_CHILDREN',reproceso_de_id::text FROM ops.ejecuciones_automatizacion WHERE reproceso_de_id IS NOT NULL GROUP BY 2 HAVING count(*)>1
    UNION ALL SELECT 'OVERLAPPING_RESERVATIONS',a.reserva_id||'/'||b.reserva_id FROM operacion.reservas_folios a JOIN operacion.reservas_folios b
      ON a.serie_id=b.serie_id AND a.reserva_id<b.reserva_id AND a.folio_inicial<=b.folio_final AND b.folio_inicial<=a.folio_final AND (a.ejecucion_id>$1 OR b.ejecucion_id>$1)
    UNION ALL SELECT 'COMPLETED_RESERVATION_MISMATCH',e.ejecucion_id::text FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones au USING(automatizacion_id)
      WHERE au.codigo='REMISIONES_CATERPILLAR' AND e.estado='COMPLETADA' AND EXISTS(SELECT 1 FROM operacion.reservas_folios f WHERE f.ejecucion_id=e.ejecucion_id
        AND f.cantidad<>(SELECT count(*) FROM operacion.remisiones r WHERE r.ejecucion_id=e.ejecucion_id AND r.serie_id=f.serie_id AND r.folio BETWEEN f.folio_inicial AND f.folio_final))
    UNION ALL SELECT 'PROCESSING_WITHOUT_OWNER',e.ejecucion_id::text FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones au USING(automatizacion_id)
      WHERE au.codigo='REMISIONES_CATERPILLAR' AND e.estado='PROCESANDO' AND e.n8n_execution_id IS NULL
    UNION ALL SELECT 'SNAPSHOT_EXECUTION_WITHOUT_SNAPSHOT',e.ejecucion_id::text FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones au USING(automatizacion_id)
      JOIN core.documentos d ON d.documento_id=e.documento_origen_id WHERE au.codigo='REMISIONES_CATERPILLAR' AND e.ejecucion_id>$1 AND d.caterpillar_admission IS NULL`,
  workerLegacyExecute: `SELECT p.oid::regprocedure::text AS signature FROM pg_proc p WHERE p.oid=ANY(ARRAY[
      'ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)'::regprocedure,'operacion.reservar_folios_para_ejecucion(bigint,text,integer)'::regprocedure,
      'operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)'::regprocedure,'ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)'::regprocedure,
      'ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)'::regprocedure]) AND has_function_privilege('n8n_cat_test',p.oid,'EXECUTE')`
};

async function run() {
  assert(Number.isSafeInteger(since) && since >= 0, 'Invalid --since');
  const url = guardedUrl(process.env.TEST_DATABASE_URL_MIGRATOR, 'postgres');
  const pool = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 5000, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY; SET LOCAL statement_timeout='20s'");
    const out = {};
    for (const [name, sql] of Object.entries(QUERIES)) out[name] = (await client.query(sql, sql.includes('$1') ? [since] : [])).rows;
    const pass = out.violations.length === 0 && out.workerLegacyExecute.length === 0;
    console.log(JSON.stringify({ result: pass ? 'TEST_015_VERIFY_PASS' : 'TEST_015_VERIFY_FAIL', since, ...out }, null, 2));
    if (!pass) process.exitCode = 3;
  } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); await pool.end(); }
}
if (require.main === module) run().catch(error => {
  console.error('TEST_015_VERIFY_FAILED; raw errors suppressed; SQLSTATE=' + (/^[A-Z0-9]{5}$/.test(error.code || '') ? error.code : 'NONE'));
  process.exitCode = 1;
});
module.exports = { QUERIES };
