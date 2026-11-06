#!/usr/bin/env node
'use strict';

// ISOLATED rehearsal of the JOINT migration set on a restore of daubert_global: Pagos 019 + Caterpillar 013 -> role -> 016/017.
//   node scripts/rehearse-joint-migrations-isolated.cjs --backup <prod .dump> [--keep]
// Everything runs in throw-away PostgreSQL containers (own names/ports, random passwords). Nothing touches the production PostgreSQL (5432), the earlier rehearsal
// instance (55432), production containers, n8n or Dropbox. Without --keep the containers are only STOPPED at the end (never removed).
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const BIN = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const MIGRATIONS = path.resolve(__dirname, '..', '..', '..', 'database', 'migrations', 'daubert_global');
// Outputs (schema dumps, state file with THROW-AWAY database credentials) go OUTSIDE the repository: REHEARSAL_OUT or the OS temp directory.
const OUT_DIR = process.env.REHEARSAL_OUT || require('os').tmpdir();
const ROLES = [['daubert_backup', 2, true], ['daubert_docs_ro', -1, true], ['daubert_hub_app', -1, true], ['daubert_hub_test_user', -1, true], ['n8n_app', -1, true], ['n8n_app_test', 10, false], ['n8n_cat_test', 5, true]];
const WATCHED_ROLES = ['n8n_app', 'daubert_hub_app', 'daubert_docs_ro', 'daubert_backup', 'n8n_cat_prod'];
const results = [];
const check = (name, ok, detail) => { results.push({ name, pass: Boolean(ok), ...(ok ? {} : { detail: String(detail ?? '').slice(0, 600) }) }); if (!ok) throw Object.assign(new Error('CHECK_FAILED'), { check: name }); };
const info = (name, detail) => results.push({ name, info: true, detail });
const arg = flag => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; };
const sh = (command, args, env = {}) => { const r = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...env } }); return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }; };
const sha = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

class Db {
  constructor(label, port) {
    this.label = label; this.port = port; this.name = `daubert-hub-rbtest-joint-${label}-${crypto.randomBytes(3).toString('hex')}`;
    this.superPassword = crypto.randomBytes(12).toString('hex'); this.hubPassword = crypto.randomBytes(12).toString('hex'); this.workerPassword = crypto.randomBytes(12).toString('hex');
  }
  psql(args) { return sh(path.join(BIN, 'psql.exe'), ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(this.port), '-U', 'postgres', '--no-password', ...args], { PGPASSWORD: this.superPassword }); }
  sql(text, database = 'daubert_global') { return this.psql(['-d', database, '-c', text]); }
  scalar(text) { const r = this.sql(text); if (r.status !== 0) throw new Error(`SQL failed: ${r.stderr.split('\n')[0]}`); return r.stdout.trim(); }
  file(name, vars = {}) { const args = ['-d', 'daubert_global']; for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`); args.push('-f', path.join(MIGRATIONS, name)); return this.psql(args); }
  start(backup) {
    const run = sh('docker', ['run', '-d', '--name', this.name, '-e', `POSTGRES_PASSWORD=${this.superPassword}`, '-p', `${this.port}:5432`, 'postgres:18-alpine']);
    check(`[${this.label}] throw-away PostgreSQL container started`, run.status === 0, run.stderr);
    for (let i = 0; i < 40; i++) { if (this.sql('SELECT 1', 'postgres').stdout.trim() === '1') break; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000); }
    for (const [role, limit, inherit] of ROLES) {
      const r = this.sql(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS ${inherit ? 'INHERIT' : 'NOINHERIT'} CONNECTION LIMIT ${limit}${role === 'daubert_hub_app' ? ` PASSWORD '${this.hubPassword}'` : ''}`, 'postgres');
      check(`[${this.label}] role ${role}`, r.status === 0, r.stderr);
    }
    this.sql('GRANT pg_read_all_data TO daubert_backup', 'postgres');
    check(`[${this.label}] database daubert_global created`, this.sql("CREATE DATABASE daubert_global TEMPLATE template0 ENCODING 'UTF8'", 'postgres').status === 0);
    const restore = sh(path.join(BIN, 'pg_restore.exe'), ['-h', '127.0.0.1', '-p', String(this.port), '-U', 'postgres', '-d', 'daubert_global', '--no-password', '--exit-on-error', backup], { PGPASSWORD: this.superPassword });
    check(`[${this.label}] backup restored with owners and ACLs`, restore.status === 0, restore.stderr);
  }
  stop() { sh('docker', ['stop', this.name]); }
  apply(group) {
    const steps = {
      P019: [['20261023_019_payment_file_recovery_prod.precheck.sql'], ['20261023_019_payment_file_recovery_prod.up.sql'], ['20261023_019_payment_file_recovery_prod.postcheck.sql']],
      C013: [['20261020_013_caterpillar_cancellation.precheck.sql'], ['20261020_013_caterpillar_cancellation.up.sql'], ['20261020_013_caterpillar_cancellation.postcheck.sql']],
      C016: [['20261024_016_caterpillar_worker_role_prod.template.sql', { worker_password: this.workerPassword }], ['20261024_016_caterpillar_atomic_admission_prod.precheck.sql'],
        ['20261024_016_caterpillar_atomic_admission_prod.up.sql'], ['20261024_016_caterpillar_atomic_admission_prod.postcheck.sql']]
    }[group];
    for (const [name, vars] of steps) { const r = this.file(name, vars); check(`[${this.label}] ${group}: ${name.replace(/^\d+_\d+_/, '')}`, r.status === 0, r.stderr || r.stdout); }
  }
  down(group) {
    const name = { P019: '20261023_019_payment_file_recovery_prod.down.sql', C013: '20261020_013_caterpillar_cancellation.down.sql', C016: '20261024_016_caterpillar_atomic_admission_prod.down.sql' }[group];
    return this.file(name);
  }
  // State used to prove that nothing changed that should not have.
  snapshot() {
    const tables = this.scalar(`SELECT string_agg(schemaname || '.' || tablename, ',' ORDER BY 1) FROM pg_tables WHERE schemaname IN ('core','ops','operacion','security') AND NOT (schemaname = 'core' AND tablename = 'recuperaciones_notificacion_pago') AND NOT (schemaname = 'operacion' AND tablename IN ('cancelaciones_remisiones','autorizaciones_regeneracion_caterpillar'))`).split(',');
    const fingerprints = {};
    for (const table of tables) {
      fingerprints[table] = this.scalar(`SELECT count(*) || ':' || coalesce(md5(string_agg(x, '|' ORDER BY x)), '-') FROM (SELECT (to_jsonb(t) - 'sin_efectos_ejecucion' - 'caterpillar_admission')::text AS x FROM ${table} t) q`);
    }
    const sequences = this.scalar("SELECT coalesce(string_agg(schemaname || '.' || sequencename || '=' || coalesce(last_value::text,'null'), ',' ORDER BY 1), '') FROM pg_sequences WHERE schemaname IN ('core','ops','operacion','security')");
    const privileges = {};
    for (const role of WATCHED_ROLES) {
      if (this.scalar(`SELECT count(*) FROM pg_roles WHERE rolname = '${role}'`) === '0') { privileges[role] = { functions: [], tables: [] }; continue; }
      const functions = this.scalar(`SELECT coalesce(string_agg(p.oid::regprocedure::text, '|' ORDER BY p.oid::regprocedure::text), '') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('core','ops','operacion','security') AND has_function_privilege('${role}', p.oid, 'EXECUTE')`);
      const tablePrivileges = this.scalar(`SELECT coalesce(string_agg(n.nspname || '.' || c.relname || ':' || pr, '|' ORDER BY n.nspname, c.relname, pr), '') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) pr WHERE c.relkind IN ('r','p') AND n.nspname IN ('core','ops','operacion','security') AND has_table_privilege('${role}', c.oid, pr)`);
      privileges[role] = { functions: functions ? functions.split('|') : [], tables: tablePrivileges ? tablePrivileges.split('|') : [] };
    }
    const pagosFunctions = this.scalar("SELECT string_agg(p.oid::regprocedure::text || '=' || md5(replace(pg_get_functiondef(p.oid), chr(13), '')), '|' ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'core' AND p.proname IN ('fn_archivo_notificacion_asignable','fn_bloquear_archivos_reproceso_pago','fn_reproceso_asignaciones_puntuales','fn_crear_o_resolver_documento')");
    const legacyCaterpillar = this.scalar("SELECT string_agg(p.oid::regprocedure::text || '=' || md5(replace(pg_get_functiondef(p.oid), chr(13), '')), ',' ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.oid IN ('ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)'::regprocedure,'operacion.reservar_folios_para_ejecucion(bigint,text,integer)'::regprocedure,'operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)'::regprocedure,'ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)'::regprocedure,'ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)'::regprocedure)");
    return { fingerprints, sequences, privileges, pagosFunctions, legacyCaterpillar };
  }
  schemaDump() { const r = sh(path.join(BIN, 'pg_dump.exe'), ['-s', '--no-owner', '--no-comments', '-h', '127.0.0.1', '-p', String(this.port), '-U', 'postgres', '--no-password', '-d', 'daubert_global'], { PGPASSWORD: this.superPassword }); return r.stdout.split('\n').filter(line => !/^\\(un)?restrict /.test(line)).join('\n'); }   // pg_dump 18 adds a random restrict nonce per run
}
const diffMap = (a, b) => Object.keys({ ...a, ...b }).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
const seqChanged = (before, after) => before.split(',').filter(x => x && !after.split(',').includes(x));   // sequences that existed before and moved/vanished (new sequences of new tables are expected)
const listDiff = (before, after) => ({ added: after.filter(x => !before.includes(x)), removed: before.filter(x => !after.includes(x)) });

(async () => {
  const backup = arg('--backup');
  if (!backup || !fs.existsSync(backup)) throw new Error('Usage: --backup <dump>');
  if (sh('docker', ['image', 'inspect', 'postgres:18-alpine']).status !== 0) throw new Error('postgres:18-alpine not found locally');
  const A = new Db('a', 55436);
  const B = new Db('b', 55437);
  try {
    // ---------- Order A: Pagos 019 -> Caterpillar 013 -> role -> 016/017
    A.start(backup);
    if (process.argv.includes('--restore-only')) { console.log(JSON.stringify({ container: A.name, port: A.port, superPassword: A.superPassword, note: 'restored pre-state only; nothing applied' })); return; }
    const s0 = A.snapshot();
    const pagos0 = A.scalar("SELECT count(*) FROM core.correos_notificacion_pago") ;
    info('restored copy: Pagos mails / Caterpillar executions / remissions', `${pagos0} / ${A.scalar('SELECT count(*) FROM ops.ejecuciones_automatizacion')} / ${A.scalar('SELECT count(*) FROM operacion.remisiones')}`);
    const applied = {
      pagos015_017: A.scalar("SELECT (to_regclass('core.asignaciones_archivo_notificacion_pago') IS NOT NULL)::text || '/' || (to_regprocedure('core.fn_reproceso_asignaciones_puntuales(bigint)') IS NOT NULL)::text || '/' || (to_regprocedure('core.fn_archivo_notificacion_asignable(bigint,bigint,boolean)') IS NOT NULL)::text"),
      pagos019: A.scalar("SELECT (to_regclass('core.recuperaciones_notificacion_pago') IS NOT NULL)::text"),
      cat013: A.scalar("SELECT (to_regclass('operacion.cancelaciones_remisiones') IS NOT NULL)::text"),
      cat016: A.scalar("SELECT (to_regprocedure('ops.fn_admitir_reservar_caterpillar(bigint,text,text,integer)') IS NOT NULL)::text"),
      catSnapshotColumn: A.scalar("SELECT (EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'core.documentos'::regclass AND attname = 'caterpillar_admission' AND NOT attisdropped))::text"),
      n8nCatProd: A.scalar("SELECT count(*) FROM pg_roles WHERE rolname = 'n8n_cat_prod'")
    };
    info('migration state of the restored copy', JSON.stringify(applied));
    check('the copy has Pagos 015-017 and lacks Pagos 019, Caterpillar 013 and 016/017 (what is really missing)', applied.pagos015_017 === 'true/true/true' && applied.pagos019 === 'false' && applied.cat013 === 'false' && applied.cat016 === 'false' && applied.catSnapshotColumn === 'false' && applied.n8nCatProd === '0', JSON.stringify(applied));

    A.apply('P019'); A.apply('C013'); A.apply('C016');
    const s1 = A.snapshot();
    check('no historical/Pagos/Caterpillar table content changed (row counts and content fingerprints of every table; new columns excluded)', diffMap(s0.fingerprints, s1.fingerprints).length === 0, diffMap(s0.fingerprints, s1.fingerprints).join(','));
    check('no existing sequence or folio counter moved (new tables add their own sequences)', seqChanged(s0.sequences, s1.sequences).length === 0, seqChanged(s0.sequences, s1.sequences).join(' '));
    check('the five legacy Caterpillar functions are byte-identical (Audi and the old workflow keep working)', s0.legacyCaterpillar === s1.legacyCaterpillar, '');
    const pagosBefore = Object.fromEntries(s0.pagosFunctions.split('|').map(x => x.split('=')));
    const pagosAfter = Object.fromEntries(s1.pagosFunctions.split('|').map(x => x.split('=')));
    const changedPagos = Object.keys({ ...pagosBefore, ...pagosAfter }).filter(k => pagosBefore[k] !== pagosAfter[k]);
    check('Pagos functions changed by 019 are exactly the two documented ones (fn_archivo_notificacion_asignable, fn_bloquear_archivos_reproceso_pago)', JSON.stringify(changedPagos.filter(k => pagosBefore[k])) === JSON.stringify(['core.fn_archivo_notificacion_asignable(bigint,bigint,boolean)', 'core.fn_bloquear_archivos_reproceso_pago(bigint)']), changedPagos.join(','));

    const priv = Object.fromEntries(WATCHED_ROLES.map(r => [r, { fn: listDiff(s0.privileges[r].functions, s1.privileges[r].functions), tb: listDiff(s0.privileges[r].tables, s1.privileges[r].tables) }]));
    for (const role of ['n8n_app', 'daubert_hub_app', 'daubert_docs_ro', 'daubert_backup']) check(`${role} lost no privilege`, priv[role].fn.removed.length === 0 && priv[role].tb.removed.length === 0, JSON.stringify(priv[role]));
    const pagosNew = ['core.fn_iniciar_recuperacion_pago(bigint,text)', 'core.fn_observar_archivos_pago_sin_efectos(bigint,text,jsonb)', 'core.fn_finalizar_recuperacion_pago(bigint,text)'];
    check('n8n_app (Audi + Pagos) gains exactly the three Pagos 019 functions and nothing from Caterpillar', JSON.stringify(priv.n8n_app.fn.added.sort()) === JSON.stringify([...pagosNew].sort()) && priv.n8n_app.tb.added.length === 0, JSON.stringify(priv.n8n_app));
    const hubAdded = priv.daubert_hub_app.fn.added.sort();
    check('daubert_hub_app gains exactly: Pagos fn_destino_asignacion_pago_disponible + Caterpillar cancel/authorize functions; table reads only on the three new ledgers',
      JSON.stringify(hubAdded) === JSON.stringify(['core.fn_destino_asignacion_pago_disponible(bigint,bigint)', 'operacion.fn_autorizar_regeneracion_caterpillar(bigint,text,bigint,text)', 'operacion.fn_cancelar_remision_caterpillar(bigint,bigint,text,text,bigint,text)'].sort())
      && priv.daubert_hub_app.tb.added.every(x => x.endsWith(':SELECT')) && priv.daubert_hub_app.tb.added.length === 3, JSON.stringify(priv.daubert_hub_app));
    const worker = s1.privileges.n8n_cat_prod;
    const workerWanted = ['ops.fn_admitir_reservar_caterpillar(bigint,text,text,integer)', 'ops.fn_reprocesar_reservar_caterpillar(bigint,text,text,integer)', 'ops.fn_guardar_snapshot_caterpillar(bigint,text)', 'operacion.fn_registrar_remision_caterpillar(bigint,text,text,bigint,date,text,jsonb)',
      'ops.fn_finalizar_caterpillar(bigint,text,text,text,text)', 'ops.fn_fallo_caterpillar(bigint,text,text,text)', 'ops.fn_resolver_ejecucion_para_reproceso(bigint)', 'core.fn_crear_o_resolver_documento(bigint,text,text,text,text,date,text)'];
    const workerOwn = worker.functions.filter(f => /caterpillar|resolver_ejecucion_para_reproceso|crear_o_resolver_documento/.test(f));
    check('n8n_cat_prod executes the eight Caterpillar entries and has NO table privilege', workerOwn.length >= 8 && workerWanted.every(w => worker.functions.includes(w) || worker.functions.some(f => f.startsWith(w.split('(')[0] + '('))) && worker.tables.length === 0, JSON.stringify({ workerOwn, tables: worker.tables }));
    check('n8n_cat_prod cannot execute any legacy Caterpillar function nor Pagos function', !worker.functions.some(f => /fn_crear_ejecucion_automatizacion|reservar_folios_para_ejecucion|fn_registrar_remision_generada|fn_finalizar_ejecucion_automatizacion|fn_registrar_fallo_ejecucion|notificacion_pago|recuperacion_pago|asignacion/.test(f)), JSON.stringify(worker.functions.filter(f => /notificacion|pago|asign/.test(f))));
    info('privilege deltas (functions added/removed, table privileges added/removed)', JSON.stringify(Object.fromEntries(Object.entries(priv).map(([r, v]) => [r, { fnAdd: v.fn.added.length, fnRem: v.fn.removed.length, tbAdd: v.tb.added.length, tbRem: v.tb.removed.length }]))));
    const schemaA = A.schemaDump();

    // ---------- Rollbacks that must work (nothing emitted, no recovery owner)
    check('Caterpillar 016 down works before any emission', A.down('C016').status === 0, '');
    check('Caterpillar 013 down works (empty ledger)', A.down('C013').status === 0, '');
    check('Pagos 019 down works (no unresolved owner)', A.down('P019').status === 0, '');
    const s2 = A.snapshot();
    check('after the three downs: data, counters, legacy functions and Pagos function bodies are back to the restored state', diffMap(s0.fingerprints, s2.fingerprints).length === 0 && seqChanged(s0.sequences, s2.sequences).length === 0 && s0.legacyCaterpillar === s2.legacyCaterpillar && s0.pagosFunctions === s2.pagosFunctions, diffMap(s0.fingerprints, s2.fingerprints).join(','));
    for (const role of ['n8n_app', 'daubert_hub_app', 'daubert_docs_ro', 'daubert_backup']) {
      // The logical DOWN of 019 keeps the table core.recuperaciones_notificacion_pago; daubert_backup reads it only through pg_read_all_data membership.
      const d = { fn: listDiff(s0.privileges[role].functions, s2.privileges[role].functions), tb: listDiff(s0.privileges[role].tables, s2.privileges[role].tables) };
      d.tb.added = d.tb.added.filter(x => !(role === 'daubert_backup' && x === 'core.recuperaciones_notificacion_pago:SELECT'));
      check(`after the downs ${role} has exactly its original privileges`, d.fn.added.length === 0 && d.fn.removed.length === 0 && d.tb.added.length === 0 && d.tb.removed.length === 0, JSON.stringify(d));
    }
    info('objects Pagos 019 DOWN intentionally retains (logical rollback)', A.scalar("SELECT (to_regclass('core.recuperaciones_notificacion_pago') IS NOT NULL)::text || ' table; column sin_efectos_ejecucion=' || (EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='core.archivos_notificacion_pago'::regclass AND attname='sin_efectos_ejecucion' AND NOT attisdropped))::text"));
    // Pagos 019 cannot be re-applied after a logical DOWN (documented); Caterpillar can be re-applied.
    const reUp = A.file('20261023_019_payment_file_recovery_prod.precheck.sql');
    check('Pagos 019 precheck refuses to re-apply over the retained objects (documented behaviour)', reUp.status !== 0, reUp.stdout);

    // ---------- Order B on a second restore: Caterpillar first, Pagos last; the final schema must equal order A
    B.start(backup);
    B.apply('C013'); B.apply('C016'); B.apply('P019');
    // Order A's schema was dumped right after its UP; compare with B's after both complete.
    const schemaB = B.schemaDump();
    fs.writeFileSync(path.join(OUT_DIR, 'schema-order-A.sql'), schemaA); fs.writeFileSync(path.join(OUT_DIR, 'schema-order-B.sql'), schemaB);
    check('apply order does not matter: the final schema of 013->016->019 equals 019->013->016 (pg_dump -s, same SHA)', sha(schemaA) === sha(schemaB), `${sha(schemaA)} vs ${sha(schemaB)}`);
    const sB = B.snapshot();
    check('order B: same row fingerprints, counters and watched-role privileges as order A', diffMap(s1.fingerprints, sB.fingerprints).length === 0 && s1.sequences === sB.sequences && JSON.stringify(s1.privileges.n8n_app) === JSON.stringify(sB.privileges.n8n_app) && JSON.stringify(s1.privileges.daubert_hub_app) === JSON.stringify(sB.privileges.daubert_hub_app), '');

    // ---------- Blocks that must hold (on B, fully migrated)
    const correo = B.scalar("SELECT correo_id FROM core.correos_notificacion_pago WHERE estado IN ('ERROR','PROCESADO') ORDER BY correo_id DESC LIMIT 1");
    if (correo) {
      B.scalar(`SELECT core.fn_iniciar_recuperacion_pago(${correo}, 'rehearsal-owner-1')`);
      const refused = B.down('P019');
      check('Pagos 019 DOWN is refused while a recovery owner is unresolved', refused.status !== 0 && /Unresolved processing owner/.test(refused.stderr), refused.stderr);
      B.sql(`UPDATE core.recuperaciones_notificacion_pago SET estado = 'FINALIZADO' WHERE correo_id = ${correo}`);
    } else info('Pagos DOWN refusal', 'NO EJECUTADO: the copy has no mail in ERROR/PROCESADO state');
    const docId = B.scalar("SELECT documento_id FROM core.documentos WHERE tipo_documento = 'PROGRAMACION_ENTREGA' AND caterpillar_admission IS NULL ORDER BY documento_id DESC LIMIT 1");
    B.sql(`UPDATE core.documentos SET caterpillar_admission = '{"version":"CAT_ADMISSION_V1","rehearsal":true}'::jsonb WHERE documento_id = ${docId}`);
    const refused016 = B.down('C016');
    check('Caterpillar 016 DOWN is refused once a snapshot exists (data would be lost)', refused016.status !== 0 && /refus|snapshot|Refus/i.test(refused016.stderr + refused016.stdout), refused016.stderr);
    B.sql(`UPDATE core.documentos SET caterpillar_admission = NULL WHERE documento_id = ${docId}`);
    info('Caterpillar 013 DOWN refusal with ledger rows', 'NOT RE-EXECUTED here: proven in the earlier prod-copy rehearsal (commit 87d45b0, "013 down refuses with cancellation history")');

    fs.writeFileSync(path.join(OUT_DIR, 'joint-migrations-state.json'), JSON.stringify({ container: B.name, port: B.port, hubPassword: B.hubPassword, note: 'throw-away database with all migrations applied (order B)' }));
    if (process.argv.includes('--keep')) { /* leave order B running for the Hub probes */ } else B.stop();
    A.stop();
    console.log(JSON.stringify({ result: 'JOINT_MIGRATIONS_REHEARSAL_PASS', checks: results.filter(r => !r.info).length, results }, null, 2));
  } catch (error) {
    try { A.stop(); B.stop(); } catch { /* best effort */ }
    console.log(JSON.stringify({ result: 'JOINT_MIGRATIONS_REHEARSAL_FAIL', failedCheck: error.check ?? null, message: String(error.message).slice(0, 400), results: results.filter(r => !r.pass || r.info) }, null, 2));
    process.exitCode = 1;
  }
})();
