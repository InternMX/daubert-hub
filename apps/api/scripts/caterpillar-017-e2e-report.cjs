#!/usr/bin/env node
'use strict';

// READ ONLY report for the real Hub -> n8n -> PostgreSQL -> PDF regeneration test in daubert_hub_test.
//   node apps/api/scripts/caterpillar-017-e2e-report.cjs                      -> baseline (open executions, series, latest executions)
//   node apps/api/scripts/caterpillar-017-e2e-report.cjs <original-execution-id> -> full chain for that execution
// Writes nothing, takes no locks, prints no secrets. Checks that every PDF registered for the chain exists on disk.
const fs = require('node:fs');
const { Pool } = require('pg');
const { guardedUrl } = require('../test/support/caterpillar-cancellation-test-guards.cjs');

async function main() {
  const original = process.argv[2];
  if (original !== undefined && !/^[1-9]\d{0,17}$/.test(original)) throw new Error('execution id must be a positive integer');
  const pool = new Pool({ connectionString: guardedUrl(process.env.TEST_DATABASE_URL_MIGRATOR, 'postgres').toString(), max: 1, connectionTimeoutMillis: 5000 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY; SET LOCAL statement_timeout='15s'");
    const q = async (sql, params) => (await client.query(sql, params)).rows;
    const out = { database: (await q('SELECT current_database() AS d'))[0].d };
    out.processing = await q(`SELECT e.ejecucion_id::text AS id, e.n8n_execution_id FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
      WHERE a.codigo='REMISIONES_CATERPILLAR' AND e.estado='PROCESANDO'`);
    out.openReservations = await q(`SELECT reserva_id::text AS id, ejecucion_id::text AS execution, estatus FROM operacion.reservas_folios WHERE estatus='RESERVADA'`);
    out.series = await q(`SELECT codigo, siguiente_folio::text AS next_folio FROM operacion.series_documentales WHERE codigo IN ('REMISION_CAT_P2','REMISION_CAT_P5','REMISION_CAT_P6') ORDER BY 1`);
    if (!original) {
      out.latestExecutions = await q(`SELECT e.ejecucion_id::text AS id, e.estado, e.reproceso_de_id::text AS parent, d.nombre_archivo FROM ops.ejecuciones_automatizacion e JOIN core.documentos d ON d.documento_id=e.documento_origen_id
        JOIN ops.automatizaciones a ON a.automatizacion_id=e.automatizacion_id WHERE a.codigo='REMISIONES_CATERPILLAR' ORDER BY e.ejecucion_id DESC LIMIT 6`);
    } else {
      const chain = await q(`WITH RECURSIVE c AS (SELECT ejecucion_id FROM ops.ejecuciones_automatizacion WHERE ejecucion_id=$1::bigint
        UNION ALL SELECT e.ejecucion_id FROM ops.ejecuciones_automatizacion e JOIN c ON e.reproceso_de_id=c.ejecucion_id) SELECT ejecucion_id FROM c`, [original]);
      const ids = chain.map(r => r.ejecucion_id);
      out.executions = await q(`SELECT e.ejecucion_id::text AS id, e.estado, e.reproceso_de_id::text AS parent, e.n8n_execution_id, e.error_nodo, d.documento_id::text AS document, d.nombre_archivo,
        (to_jsonb(d)->'caterpillar_admission') IS NOT NULL AS has_snapshot FROM ops.ejecuciones_automatizacion e JOIN core.documentos d ON d.documento_id=e.documento_origen_id WHERE e.ejecucion_id=ANY($1::bigint[]) ORDER BY 1`, [ids]);
      out.reservations = await q(`SELECT f.reserva_id::text AS id, f.ejecucion_id::text AS execution, s.codigo AS series, f.folio_inicial::text AS first, f.folio_final::text AS last, f.cantidad, f.estatus
        FROM operacion.reservas_folios f JOIN operacion.series_documentales s USING(serie_id) WHERE f.ejecucion_id=ANY($1::bigint[]) ORDER BY f.reserva_id`, [ids]);
      out.remissions = await q(`SELECT m.ejecucion_id::text AS execution, m.estatus, count(*)::int AS remissions, min(m.folio)::text AS first, max(m.folio)::text AS last,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM operacion.cancelaciones_remisiones c WHERE c.remision_id=m.remision_id))::int AS with_formal_cancellation
        FROM operacion.remisiones m WHERE m.ejecucion_id=ANY($1::bigint[]) GROUP BY 1,2 ORDER BY 1,2`, [ids]);
      out.authorization = await q(`SELECT autorizacion_id::text AS id, ejecucion_origen_id::text AS original, ejecucion_nueva_id::text AS regenerated, motivo, usuario_email, autorizada_en, request_id
        FROM operacion.autorizaciones_regeneracion_caterpillar WHERE ejecucion_origen_id=ANY($1::bigint[]) ORDER BY 1`, [ids]);
      out.cancellations = (await q(`SELECT count(*)::int AS n FROM operacion.cancelaciones_remisiones c JOIN operacion.remisiones m USING(remision_id) WHERE m.ejecucion_id=ANY($1::bigint[])`, [ids]))[0].n;
      out.children = await q(`SELECT reproceso_de_id::text AS parent, count(*)::int AS children FROM ops.ejecuciones_automatizacion WHERE reproceso_de_id=ANY($1::bigint[]) GROUP BY 1`, [ids]);
      const pdfs = await q(`SELECT m.ejecucion_id::text AS execution, m.folio::text AS folio, m.estatus, m.pdf_path FROM operacion.remisiones m WHERE m.ejecucion_id=ANY($1::bigint[]) ORDER BY m.ejecucion_id, m.folio, m.remision_id`, [ids]);
      out.pdfs = pdfs.map(p => ({ execution: p.execution, folio: p.folio, status: p.estatus, file: String(p.pdf_path).split(/[\\/]/).pop(), onDisk: Boolean(p.pdf_path) && fs.existsSync(p.pdf_path) }));
    }
    console.log(JSON.stringify(out, null, 2));
  } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); await pool.end(); }
}
main().catch(error => { console.error(`E2E_REPORT_FAILED: ${String(error.message).split('\n')[0].slice(0, 200)}`); process.exitCode = 1; });
