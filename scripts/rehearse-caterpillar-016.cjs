#!/usr/bin/env node
'use strict';

// Disposable REHEARSAL of the PRODUCTION migration 016 against a throwaway database restored from a TEST backup. It never touches daubert_global,
// daubert_hub_test or any existing role: it creates database daubert_cat_016_rehearsal and role n8n_cat_016_rehearsal, uses a copy of the 016 files with
// only those two names substituted, runs precheck -> up -> postcheck -> down -> up -> postcheck -> functional smoke -> bypass checks, then drops both.
//   $env:TEST_DATABASE_URL_MIGRATOR = '<postgres://postgres:...@localhost:5432/daubert_hub_test>'
//   node scripts/rehearse-caterpillar-016.cjs <path-to-pre015.dump>
// The password never leaves the environment and is never printed. The dump predates 015; the 014 column is dropped in the scratch copy so the
// starting state matches PRODUCTION (no snapshot column), which is what 016 expects.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { P016, PROD_DATABASE, PROD_WORKER_ROLE, PROD_HUB_ROLE, repin } = require('./generate-caterpillar-016-prod.cjs');

const requireFromRepo = createRequire(path.join(__dirname, '..', 'package.json'));
const { Client } = requireFromRepo('pg');

const SCRATCH_DB = 'daubert_cat_016_rehearsal';
const SCRATCH_ROLE = 'n8n_cat_016_rehearsal';
const BIN = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const DIR = path.join(__dirname, '..', 'database', 'migrations', 'daubert_global');

function connectionFor(database) {
  const base = process.env.TEST_DATABASE_URL_MIGRATOR;
  if (!base) throw new Error('TEST_DATABASE_URL_MIGRATOR is required');
  const url = new URL(base);
  if (decodeURIComponent(url.pathname).slice(1) !== 'daubert_hub_test' || decodeURIComponent(url.username) !== 'postgres') {
    throw new Error('The rehearsal only starts from postgres@daubert_hub_test credentials');
  }
  url.pathname = `/${database}`;
  return url;
}

const rewrite = text => text.split(PROD_DATABASE).join(SCRATCH_DB).split(PROD_WORKER_ROLE).join(SCRATCH_ROLE);
// The database name is inside the function bodies, so the body fingerprints are recomputed for the rewritten text; the postcheck then proves the
// fingerprint METHOD (JS md5 of the rendered text) equals what PostgreSQL stores, which is what the committed PROD pins rely on.
// 013 is allowed in daubert_hub_test and daubert_global only: the scratch database takes the place of daubert_global (its hub role is daubert_hub_app).
const rewrite013 = text => text.split(PROD_DATABASE).join(SCRATCH_DB);
const rawFile = kind => rewrite(fs.readFileSync(path.join(DIR, `${P016}.${kind}.sql`), 'utf8'));
const sqlFile = kind => (kind === 'postcheck' || kind === 'down' ? repin(rawFile(kind), rawFile('up')) : rawFile(kind));

async function withClient(database, work) {
  const client = new Client({ connectionString: connectionFor(database).toString(), connectionTimeoutMillis: 5000 });
  await client.connect();
  try { return await work(client); } finally { await client.end(); }
}

// Runs inside the smoke transaction: a savepoint keeps the transaction usable after the expected error.
async function expectFailure(db, label, work, pattern) {
  await db.query('SAVEPOINT expected');
  try { await work(); } catch (error) {
    await db.query('ROLLBACK TO SAVEPOINT expected');
    if (!pattern.test(`${error.code || ''} ${error.message}`)) throw new Error(`${label}: unexpected error ${error.code || ''} ${error.message.slice(0, 120)}`);
    return;
  }
  throw new Error(`${label}: expected a failure`);
}

async function main() {
  const dump = process.argv.slice(2).find(argument => !argument.startsWith('--'));
  if (!dump || !fs.existsSync(dump)) throw new Error('Usage: node scripts/rehearse-caterpillar-016.cjs <pre015.dump>');
  const results = [];
  const check = (name, ok) => { results.push([name, ok]); if (!ok) throw new Error(`CHECK FAILED: ${name}`); };

  await withClient('postgres', async admin => {
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
    await admin.query(`DROP ROLE IF EXISTS ${SCRATCH_ROLE}`);
    await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
    await admin.query(`CREATE ROLE ${SCRATCH_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5`);
  });
  try {
    const url = connectionFor(SCRATCH_DB);
    const restore = spawnSync(path.join(BIN, 'pg_restore.exe'), ['-h', url.hostname, '-p', url.port || '5432', '-U', 'postgres', '-d', SCRATCH_DB, '--no-password', dump],
      { env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) }, encoding: 'utf8' });
    if (restore.status !== 0 && !/errors ignored on restore/.test(restore.stderr || '')) throw new Error(`pg_restore failed (${restore.status}): ${(restore.stderr || '').split('\n').slice(0, 3).join(' | ')}`);

    await withClient(SCRATCH_DB, async db => {
      const q = async (sql, params) => (await db.query(sql, params)).rows;
      // PRODUCTION-like start: no snapshot column, dedicated role with only schema USAGE and the read-only resolvers.
      await db.query('ALTER TABLE core.documentos DROP COLUMN IF EXISTS caterpillar_admission');
      await db.query(`GRANT USAGE ON SCHEMA core, ops, operacion TO ${SCRATCH_ROLE}`);
      // The restored copy carries the TEST Hub grants; the production Hub role already has schema USAGE in daubert_global (scratch database only).
      await db.query(`GRANT USAGE ON SCHEMA core, ops, operacion TO ${PROD_HUB_ROLE}`);
      await db.query(`GRANT EXECUTE ON FUNCTION core.fn_crear_o_resolver_documento(bigint,text,text,text,text,date,text), ops.fn_resolver_ejecucion_para_reproceso(bigint) TO ${SCRATCH_ROLE}`);
      const idle = await q(`SELECT count(*)::int AS n FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id) WHERE a.codigo='REMISIONES_CATERPILLAR' AND e.estado='PROCESANDO'`);
      check('restored copy is idle', idle[0].n === 0);
      // PRODUCTION does not have migration 013 (individual cancellation) yet, and 016 requires it. --simulate-prod removes it from the restored TEST copy so the
      // same order as the cutover is rehearsed: 013 (precheck, up, postcheck) first, then 016. A dump that already has 013 skips this step.
      if (process.argv.includes('--simulate-prod')) {
        await db.query('DROP FUNCTION IF EXISTS operacion.fn_cancelar_remision_caterpillar(bigint,bigint,text,text,bigint,text)');
        await db.query('DROP TABLE IF EXISTS operacion.cancelaciones_remisiones');
      }
      if (!(await q("SELECT to_regclass('operacion.cancelaciones_remisiones') IS NOT NULL AS present"))[0].present) {
        for (const kind of ['precheck', 'up', 'postcheck']) await db.query(rewrite013(fs.readFileSync(path.join(DIR, `20261020_013_caterpillar_cancellation.${kind}.sql`), 'utf8')));
        check('013 (formal cancellation) applied before 016, as in the cutover', true);
      }
      const before = await q(`SELECT (SELECT count(*) FROM operacion.remisiones)::int AS remissions, (SELECT count(*) FROM operacion.reservas_folios)::int AS reservations,
        (SELECT string_agg(codigo||':'||siguiente_folio,',' ORDER BY codigo) FROM operacion.series_documentales) AS series,
        (SELECT md5(COALESCE(string_agg((to_jsonb(d))::text,'|' ORDER BY documento_id),'')) FROM core.documentos d) AS documents`);

      await db.query(sqlFile('precheck')); check('precheck passes', true);
      await db.query(sqlFile('up')); check('up applies', true);
      await db.query(sqlFile('postcheck')); check('postcheck passes', true);
      await db.query(sqlFile('down')); check('down applies while no evidence exists', true);
      const gone = await q(`SELECT (SELECT count(*) FROM pg_proc WHERE proname = ANY(ARRAY['fn_cat_key_text_015','fn_cat_snapshot_015','fn_cat_worker_015','fn_admitir_reservar_caterpillar','fn_reprocesar_reservar_caterpillar','fn_guardar_snapshot_caterpillar','fn_registrar_remision_caterpillar','fn_finalizar_caterpillar','fn_fallo_caterpillar']))::int AS fns,
        EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='core.documentos'::regclass AND attname='caterpillar_admission' AND NOT attisdropped) AS col`);
      check('down removed every 016 object', gone[0].fns === 0 && gone[0].col === false);
      await db.query(sqlFile('precheck')); await db.query(sqlFile('up')); await db.query(sqlFile('postcheck')); check('re-apply after down', true);

      const after = await q(`SELECT (SELECT count(*) FROM operacion.remisiones)::int AS remissions, (SELECT count(*) FROM operacion.reservas_folios)::int AS reservations,
        (SELECT string_agg(codigo||':'||siguiente_folio,',' ORDER BY codigo) FROM operacion.series_documentales) AS series,
        (SELECT md5(COALESCE(string_agg((to_jsonb(d)-'caterpillar_admission')::text,'|' ORDER BY documento_id),'')) FROM core.documentos d) AS documents`);
      check('history, series and counters are untouched by the migration', JSON.stringify(before) === JSON.stringify(after));

      // Functional smoke as the dedicated role (everything inside one transaction that is rolled back).
      const series = (await q(`SELECT s.codigo FROM ops.automatizacion_series_proceso r JOIN operacion.series_documentales s USING(serie_id)
        JOIN ops.automatizaciones a USING(automatizacion_id) WHERE a.codigo='REMISIONES_CATERPILLAR' AND r.llave_proceso='CATERPILLAR_P2|P2|' LIMIT 1`))[0].codigo;
      // The source company is taken from the data (TEST uses 1207, PRODUCTION 122): never hardcoded.
      const company = (await q(`SELECT d.empresa_id FROM core.documentos d JOIN ops.ejecuciones_automatizacion e ON e.documento_origen_id=d.documento_id JOIN ops.automatizaciones a USING(automatizacion_id) WHERE a.codigo='REMISIONES_CATERPILLAR' ORDER BY d.documento_id LIMIT 1`))[0].empresa_id;
      const manifest = JSON.stringify({ version: 'CAT_OPERATIONAL_CONTENT_V1', scope: ['CATERPILLAR_P2', 'P2', '', 'CATERPILLAR MEXICO RECIBOS PLANTA 2.', 'CME940630QM2'],
        deliveryDate: '2026-07-23', grouping: 'POR_ARTICULO', documents: [{ purchaseOrder: '9900000001', lines: [['REHEARSAL-001', '89-REH001', '9900000001', 10, 'BOLSAS']] }] });
      await db.query('BEGIN');
      try {
        await db.query(`SET LOCAL ROLE ${SCRATCH_ROLE}`);
        const doc = (await q('SELECT * FROM core.fn_crear_o_resolver_documento($1::bigint,$2::text,$3::text,$4::text,$5::text,$6::date,$7::text)',
          [company, 'PROGRAMACION_ENTREGA', 'PROGRAMACION DE ENTREGA CAT P2 REHEARSAL 016.xlsx', 'C:/rehearsal/REHEARSAL 016.xlsx', 'DROPBOX', '2026-10-24', 'rehearsal016']))[0];
        check('snapshot stored', (await q('SELECT ops.fn_guardar_snapshot_caterpillar($1::bigint,$2::text) AS s', [doc.documento_id, manifest]))[0].s === 'STORED');
        check('snapshot repeat is idempotent', (await q('SELECT ops.fn_guardar_snapshot_caterpillar($1::bigint,$2::text) AS s', [doc.documento_id, manifest]))[0].s === 'ALREADY_STORED');
        const gate = (await q('SELECT * FROM ops.fn_admitir_reservar_caterpillar($1::bigint,$2::text,$3::text,$4::integer)', [doc.documento_id, 'W-REH-1', series, 1]))[0];
        check('gate admits and reserves for the dedicated role', gate.decision === 'ADMIT' && gate.reason === 'ACQUIRED' && gate.can_emit === true);
        check('a second worker cannot take over', (await q('SELECT * FROM ops.fn_admitir_reservar_caterpillar($1::bigint,$2::text,$3::text,$4::integer)', [doc.documento_id, 'W-REH-2', series, 1]))[0].reason === 'PROGRAM_IN_PROGRESS');
        await expectFailure(db, 'foreign worker cannot register', () => db.query('SELECT * FROM operacion.fn_registrar_remision_caterpillar($1,$2,$3,$4,$5,$6,$7::jsonb)',
          [gate.ejecucion_id, 'W-REH-2', series, gate.folio_inicial, '2026-10-24', 'x.pdf', '[]']), /NOT_OWNER|42501/);
        await db.query('SAVEPOINT s1');
        await db.query('SELECT * FROM operacion.fn_registrar_remision_caterpillar($1,$2,$3,$4,$5,$6,$7::jsonb)',
          [gate.ejecucion_id, 'W-REH-1', series, gate.folio_inicial, '2026-10-24', 'REHEARSAL/NO_FILE/1.pdf', '[{"codigo_interno":"REH","cantidad_texto":"10 bolsas"}]']);
        const done = (await q("SELECT * FROM ops.fn_finalizar_caterpillar($1::bigint,$2::text,'COMPLETADA')", [gate.ejecucion_id, 'W-REH-1']))[0];
        check('owner completes: reservation applied', done.estado_final === 'COMPLETADA' && done.reservas_aplicadas === 1);
        await db.query('ROLLBACK TO SAVEPOINT s1');
        const failed = (await q("SELECT * FROM ops.fn_finalizar_caterpillar($1::bigint,$2::text,'ERROR',$3::text,$4::text)", [gate.ejecucion_id, 'W-REH-1', 'REHEARSAL', 'controlled failure']))[0];
        check('controlled error abandons the reservation', failed.estado_final === 'ERROR' && failed.reservas_abandonadas === 1);
        const child = (await q('SELECT * FROM ops.fn_reprocesar_reservar_caterpillar($1::bigint,$2::text,$3::text,$4::integer)', [gate.ejecucion_id, 'W-REH-3', series, 1]))[0];
        check('reprocess of the ERROR parent reserves NEW folios', child.reason === 'REPROCESS_ACQUIRED' && child.can_emit === true && child.folio_inicial !== gate.folio_inicial);
        check('second reprocess does not emit', (await q('SELECT * FROM ops.fn_reprocesar_reservar_caterpillar($1::bigint,$2::text,$3::text,$4::integer)', [gate.ejecucion_id, 'W-REH-4', series, 1]))[0].can_emit === false);
        // Commercial regeneration (017 inside 016): complete -> formal cancellation (013, by the owner) -> ADMIN authorization as the Hub role -> regenerating gate as the worker.
        await db.query('RESET ROLE');
        const adminId = (await q("SELECT user_id::text AS id FROM security.users WHERE role='ADMIN' AND status='ACTIVE' AND NOT must_change_password ORDER BY user_id LIMIT 1"))[0].id;
        await db.query(`SET LOCAL ROLE ${SCRATCH_ROLE}`);
        const manifest2 = JSON.stringify({ ...JSON.parse(manifest), documents: [{ purchaseOrder: '9900000002', lines: [['REHEARSAL-002', '89-REH002', '9900000002', 20, 'BOLSAS']] }] });
        const doc2 = (await q('SELECT * FROM core.fn_crear_o_resolver_documento($1::bigint,$2::text,$3::text,$4::text,$5::text,$6::date,$7::text)',
          [company, 'PROGRAMACION_ENTREGA', 'PROGRAMACION DE ENTREGA CAT P2 REHEARSAL 016 B.xlsx', 'C:/rehearsal/REHEARSAL 016 B.xlsx', 'DROPBOX', '2026-10-24', 'rehearsal016b']))[0];
        await q('SELECT ops.fn_guardar_snapshot_caterpillar($1::bigint,$2::text)', [doc2.documento_id, manifest2]);
        const g2 = (await q('SELECT * FROM ops.fn_admitir_reservar_caterpillar($1::bigint,$2::text,$3::text,$4::integer)', [doc2.documento_id, 'W-REH-6', series, 1]))[0];
        await q('SELECT * FROM operacion.fn_registrar_remision_caterpillar($1,$2,$3,$4,$5,$6,$7::jsonb)', [g2.ejecucion_id, 'W-REH-6', series, g2.folio_inicial, '2026-10-24', 'REHEARSAL/NO_FILE/b.pdf', '[{"codigo_interno":"REH","cantidad_texto":"20 bolsas"}]']);
        await q("SELECT * FROM ops.fn_finalizar_caterpillar($1::bigint,$2::text,'COMPLETADA')", [g2.ejecucion_id, 'W-REH-6']);
        await db.query('RESET ROLE');
        const live = (await q("SELECT remision_id::text AS id, to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS revision FROM operacion.remisiones WHERE ejecucion_id=$1", [g2.ejecucion_id]));
        for (const r of live) await q('SELECT * FROM operacion.fn_cancelar_remision_caterpillar($1::bigint,$2::bigint,$3::text,$4::text,$5::bigint,$6::text)', [g2.ejecucion_id, r.id, r.revision, 'rehearsal cancellation', adminId, 'rehearsal']);
        await db.query(`SET LOCAL ROLE ${PROD_HUB_ROLE}`);
        const auth = (await q('SELECT * FROM operacion.fn_autorizar_regeneracion_caterpillar($1::bigint,$2::text,$3::bigint,$4::text)', [g2.ejecucion_id, 'rehearsal regeneration', adminId, 'rehearsal-auth']))[0];
        check('regeneration: the production Hub role authorizes a formally cancelled COMPLETADA execution', auth.resultado === 'AUTHORIZED' && auth.usuario_email);
        await expectFailure(db, 'regeneration: Hub cannot write the authorization table', () => db.query("INSERT INTO operacion.autorizaciones_regeneracion_caterpillar(ejecucion_origen_id,motivo,usuario_email,usuario_nombre) VALUES(1,'x','x','x')"), /42501|permission denied|permiso denegado/i);
        await db.query(`SET LOCAL ROLE ${SCRATCH_ROLE}`);
        const regen = (await q('SELECT * FROM ops.fn_reprocesar_reservar_caterpillar($1::bigint,$2::text,$3::text,$4::integer)', [g2.ejecucion_id, 'W-REH-7', series, 1]))[0];
        check('regeneration: the worker gets ONE new execution with NEW folios', regen.can_emit && regen.reason === 'REPROCESS_ACQUIRED' && Number(regen.folio_inicial) > Number(g2.folio_final));
        check('regeneration: a second request does not emit', (await q('SELECT * FROM ops.fn_reprocesar_reservar_caterpillar($1::bigint,$2::text,$3::text,$4::integer)', [g2.ejecucion_id, 'W-REH-8', series, 1]))[0].can_emit === false);
        await expectFailure(db, 'regeneration: the worker cannot authorize', () => db.query('SELECT * FROM operacion.fn_autorizar_regeneracion_caterpillar($1::bigint,$2::text,$3::bigint,$4::text)', [g2.ejecucion_id, 'x', adminId, 'w']), /42501|permission denied|permiso denegado/i);
        for (const legacy of ['SELECT * FROM operacion.reservar_folios_para_ejecucion(1,\'x\',1)', 'SELECT * FROM ops.fn_crear_ejecucion_automatizacion(\'REMISIONES_CATERPILLAR\',1,\'x\',\'x\',null)']) {
          await expectFailure(db, 'legacy bypass', () => db.query(legacy), /42501|permission denied|permiso denegado/i);
        }
        await expectFailure(db, 'direct DML', () => db.query('UPDATE core.documentos SET caterpillar_admission=NULL'), /42501|permission denied|permiso denegado/i);
      } finally { await db.query('ROLLBACK'); }
    });
  } finally {
    await withClient('postgres', async admin => {
      await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
      await admin.query(`DROP ROLE IF EXISTS ${SCRATCH_ROLE}`);
    });
  }
  console.log(JSON.stringify({ result: 'REHEARSAL_016_PASS', checks: results.length, list: results.map(([name]) => name) }, null, 2));
}

main().catch(error => {
  console.error(`REHEARSAL_016_FAILED: ${error.message.split('\n')[0].slice(0, 300)}`);
  process.exitCode = 1;
});
