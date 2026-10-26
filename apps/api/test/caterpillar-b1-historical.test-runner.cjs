'use strict';

// REAL PostgreSQL TEST validation of B1 (historical skip). Uses ONLY TEST_DATABASE_URL_MIGRATOR (postgres@daubert_hub_test) and impersonates the worker with
// SET LOCAL ROLE n8n_cat_test. Everything runs in ONE transaction that is ALWAYS rolled back: no execution, reservation, remission, folio or snapshot survives.
// The real answer of the protected snapshot entry is fed through the REAL IF/Code nodes of the FULL TEST and PROD-candidate workflows (n8n-segment-runner).
//   node test/caterpillar-b1-historical.test-runner.cjs
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { assert, guardedUrl } = require('./support/caterpillar-cancellation-test-guards.cjs');
const { runSegment } = require('./support/n8n-segment-runner.cjs');

const folder = path.resolve(__dirname, '../../../n8n/workflows/remisiones-caterpillar');
const workflows = {
  FULL: JSON.parse(readFileSync(path.join(folder, 'candidate-015/caterpillar-test-015.FULL.INACTIVE.json'), 'utf8')),
  PROD_CANDIDATE: JSON.parse(readFileSync(path.join(folder, 'candidate-016-prod/caterpillar-prod-016.CANDIDATE.INACTIVE.json'), 'utf8'))
};
const SAVE = 'SELECT ops.fn_guardar_snapshot_caterpillar_test($1::bigint,$2::text) AS estado';
const results = [];
const check = (name, ok, detail) => { results.push({ name, pass: Boolean(ok), ...(ok ? {} : { detail: String(detail ?? '').slice(0, 300) }) }); if (!ok) throw Object.assign(new Error('CHECK_FAILED'), { check: name }); };

const COUNTS = `SELECT
  (SELECT count(*) FROM ops.ejecuciones_automatizacion)::int AS executions,
  (SELECT count(*) FROM operacion.reservas_folios)::int AS reservations,
  (SELECT count(*) FROM operacion.reservas_folios WHERE estatus = 'RESERVADA')::int AS reserved,
  (SELECT count(*) FROM operacion.remisiones)::int AS remissions,
  (SELECT count(*) FROM core.documentos WHERE caterpillar_admission IS NOT NULL)::int AS snapshots,
  (SELECT count(*) FROM core.documentos)::int AS documents,
  (SELECT string_agg(codigo || '=' || siguiente_folio, ',' ORDER BY codigo) FROM operacion.series_documentales) AS next_folios,
  (SELECT md5(string_agg(e.ejecucion_id || e.estado, ',' ORDER BY e.ejecucion_id)) FROM ops.ejecuciones_automatizacion e WHERE e.ejecucion_id IN (237, 238)) AS evidence_237_238`;

async function failing(client, sql, params) {
  await client.query('SAVEPOINT expected');
  try { await client.query(sql, params); await client.query('ROLLBACK TO SAVEPOINT expected'); return null; }
  catch (error) { await client.query('ROLLBACK TO SAVEPOINT expected'); return error; }
}

// What the workflow does with the snapshot answer of one scanned document (automatic scan or reprocess).
function throughWorkflow(workflow, answer, document, mode) {
  const source = { json: { documento_origen_id: String(document.documento_id), file_name: document.nombre_archivo, file_path: `TEST\\${document.nombre_archivo}`, hash_archivo: document.hash_archivo, ...(mode ? { mode } : {}) } };
  try {
    const run = runSegment(workflow, { start: '¿Histórico ya emitido?', items: [{ json: { estado: answer } }], stopAt: ['Loop Over Items', 'Preparar reserva folios PG'],
      outputs: { 'Propagar documento origen PG': [source], 'Normalizar datos CAT': [{ json: { marker: 'normalized' } }] } });
    return { reached: Object.keys(run.reached)[0], item: (run.reached['Loop Over Items'] ?? run.reached['Preparar reserva folios PG'])[0].json };
  } catch (error) { return { threw: String(error.message) }; }
}

async function main() {
  const url = guardedUrl(process.env.TEST_DATABASE_URL_MIGRATOR, 'postgres');
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const before = (await client.query(COUNTS)).rows[0];
    await client.query('BEGIN');
    const identity = (await client.query("SELECT current_database() AS db")).rows[0];
    check('connected to daubert_hub_test only', identity.db === 'daubert_hub_test', identity.db);
    const inTransactionBefore = (await client.query(COUNTS)).rows[0];

    const source = (await client.query("SELECT documento_id, nombre_archivo, caterpillar_admission->>'manifestCanonical' AS manifest FROM core.documentos WHERE caterpillar_admission IS NOT NULL AND nombre_archivo ILIKE '%PRUEBA REGEN 017%' ORDER BY documento_id DESC LIMIT 1")).rows[0];
    check('snapshotted P2 TEST document available as manifest source', source && source.manifest, 'no source');
    const historical = (await client.query(`SELECT d.documento_id, d.nombre_archivo, d.hash_archivo,
        (SELECT count(*) FROM operacion.remisiones r JOIN ops.ejecuciones_automatizacion e ON e.ejecucion_id = r.ejecucion_id WHERE e.documento_origen_id = d.documento_id)::int AS remissions
      FROM core.documentos d WHERE d.caterpillar_admission IS NULL AND d.tipo_documento = 'PROGRAMACION_ENTREGA' AND d.nombre_archivo ILIKE '%SC PLANTA 2%'
        AND EXISTS (SELECT 1 FROM ops.ejecuciones_automatizacion e WHERE e.documento_origen_id = d.documento_id AND e.estado <> 'PROCESANDO') ORDER BY d.documento_id`)).rows;
    check('at least three already-emitted P2 historical documents without snapshot exist in TEST', historical.length >= 3 && historical.some(d => d.remissions > 0), `found ${historical.length}`);

    await client.query('SET LOCAL ROLE n8n_cat_test');
    for (const document of historical) {
      const answer = (await client.query(SAVE, [document.documento_id, source.manifest])).rows[0].estado;
      check(`document ${document.documento_id} (${document.remissions} remissions) -> HISTORICAL_LOCKED returned as a value`, answer === 'HISTORICAL_LOCKED', answer);
      for (const [label, workflow] of Object.entries(workflows)) {
        const automatic = throughWorkflow(workflow, answer, document, undefined);
        check(`${label}: document ${document.documento_id} automatic scan is skipped as SKIPPED_HISTORICAL and returns to the loop`,
          automatic.reached === 'Loop Over Items' && automatic.item.resultado === 'SKIPPED_HISTORICAL' && automatic.item.documento_origen_id === String(document.documento_id), JSON.stringify(automatic));
        const reprocess = throughWorkflow(workflow, answer, document, 'REPROCESS');
        check(`${label}: document ${document.documento_id} reprocess still fails closed`, /SNAPSHOT_NOT_STORED/.test(reprocess.threw ?? ''), JSON.stringify(reprocess));
      }
    }
    const stillNoSnapshot = (await client.query('SELECT count(*)::int AS n FROM core.documentos WHERE documento_id = ANY($1) AND caterpillar_admission IS NOT NULL', [historical.map(d => d.documento_id)])).rows[0].n;
    check('no snapshot was invented for any historical document', stillNoSnapshot === 0, stillNoSnapshot);

    // The same entry on a document that already has a snapshot, and on faulty inputs: none of them may be skipped.
    const stored = (await client.query(SAVE, [source.documento_id, source.manifest])).rows[0].estado;
    check('document with the same stored snapshot -> ALREADY_STORED (normal path, not skipped)', stored === 'ALREADY_STORED', stored);
    const normalPath = throughWorkflow(workflows.FULL, stored, source, undefined);
    check('ALREADY_STORED reaches the reservation preparation (a new file continues the normal path)', normalPath.reached === 'Preparar reserva folios PG', JSON.stringify(normalPath));
    const other = JSON.stringify({ ...JSON.parse(source.manifest), deliveryDate: '2031-01-01' });
    const conflict = (await client.query(SAVE, [source.documento_id, other])).rows[0].estado;
    check('different content for a stored snapshot -> CONFLICT (not skipped, aborts at the verifier)', conflict === 'CONFLICT' && /SNAPSHOT_NOT_STORED/.test(throughWorkflow(workflows.FULL, conflict, source).threw ?? ''), conflict);
    const missing = await failing(client, SAVE, [999999999, source.manifest]);
    check('unknown document -> real SQL error P0002 (raised by the call itself, so no node can turn it into SKIPPED)', missing && missing.code === 'P0002', missing && missing.code);
    const invalid = await failing(client, SAVE, [historical[0].documento_id, null]);
    check('missing manifest -> real SQL error 22023', invalid && invalid.code === '22023', invalid && invalid.code);
    const corrupt = await failing(client, SAVE, [historical[0].documento_id, '{"scope":"x"}']);
    check('malformed manifest -> real SQL error 22023', corrupt && corrupt.code === '22023', corrupt && corrupt.code);

    await client.query('RESET ROLE');
    const inTransactionAfter = (await client.query(COUNTS)).rows[0];
    check('no execution, reservation, remission, snapshot or folio changed inside the transaction', JSON.stringify(inTransactionAfter) === JSON.stringify(inTransactionBefore), JSON.stringify({ inTransactionBefore, inTransactionAfter }));
    await client.query('ROLLBACK');
    const after = (await client.query(COUNTS)).rows[0];
    check('after ROLLBACK the database is identical to the start (237/238 evidence and the RESERVADA reservations included)', JSON.stringify(after) === JSON.stringify(before), JSON.stringify({ before, after }));
    console.log(JSON.stringify({ result: 'B1_TEST_DB_PASS', checks: results.length, reservedKept: after.reserved, nextFolios: after.next_folios, evidence237238: after.evidence_237_238 }, null, 2));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* connection already closed */ }
    console.log(JSON.stringify({ result: 'B1_TEST_DB_FAIL', failedCheck: error.check ?? null, message: String(error.message).slice(0, 200), results: results.filter(r => !r.pass) }, null, 2));
    process.exitCode = 1;
  } finally { await client.end(); }
}
main();
