#!/usr/bin/env node
'use strict';

// REHEARSAL of the real production sequence (013 -> role -> 016/017) on an ISOLATED copy of daubert_global. It never connects to the operational server (localhost:5432):
//   1. starts a throw-away PostgreSQL 18 instance of its own (initdb in a new folder, loopback only, port 55432, trust auth, no passwords stored);
//   2. creates the production role NAMES (no passwords, no superuser) and an EMPTY database named daubert_global with the production locale;
//   3. restores the backup into it (pg_restore --exit-on-error, owners and ACLs preserved);
//   4. runs the REAL migration files, byte for byte, exactly as the cutover will (the database really is called daubert_global there);
//   5. proves history/series/privileges are untouched, the contracts of the PROD candidate resolve, the gate protects history, rollback works before any emission and is refused after;
//   6. stops ITS instance (never any other) and leaves its time-stamped folder in place: the script deletes nothing. The report contains no secrets and no operational data beyond counts and ids.
//   node scripts/rehearse-caterpillar-prod-copy.cjs <backup.dump>
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { parseBlocks, assertReadOnly, SQL_FILE } = require('../apps/api/scripts/caterpillar-016-prod-inspect.cjs');

const BIN = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const ROOT = 'C:\\Users\\06\\Documents\\Daubert\\ensayo-postgres-prod';
const PORT = 55432, HOST = '127.0.0.1';
const MIGRATIONS = path.join(__dirname, '..', 'database', 'migrations', 'daubert_global');
const CANDIDATE = path.join(__dirname, '..', 'n8n', 'workflows', 'remisiones-caterpillar', 'candidate-016-prod', 'caterpillar-prod-016.CANDIDATE.INACTIVE.json');
// Cluster-level state is NOT in a database dump, so it is reproduced here from a read-only look at production (names and attributes only, never passwords):
// the same non-superuser LOGIN roles with their connection limits, n8n_app_test without INHERIT, and the one membership production has (daubert_backup in pg_read_all_data).
const ROLES = [['daubert_backup', 2, true], ['daubert_docs_ro', -1, true], ['daubert_hub_app', -1, true], ['daubert_hub_test_user', -1, true], ['n8n_app', -1, true], ['n8n_app_test', 10, false], ['n8n_cat_test', 5, true]];
const f = name => path.join(MIGRATIONS, name);
const results = [];
const check = (name, ok, detail) => { results.push({ name, pass: Boolean(ok), ...(ok ? {} : { detail: String(detail ?? '').slice(0, 300) }) }); if (!ok) throw Object.assign(new Error(`CHECK FAILED: ${name}`), { handled: true }); };

function run(command, args, options = {}) {
  // pg_ctl start leaves the server running with the inherited pipes open: capturing its output would block forever, so those calls ignore stdio (the server log file keeps the output).
  const result = spawnSync(path.join(BIN, command), args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...(options.env ?? {}) }, ...(options.quiet ? { stdio: 'ignore' } : {}) });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}
const psqlFile = (file, vars = {}) => {
  const args = ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', HOST, '-p', String(PORT), '-U', 'postgres', '-d', 'daubert_global', '--no-password'];
  for (const [key, value] of Object.entries(vars)) args.push('-v', `${key}=${value}`);
  args.push('-f', file);
  const out = run('psql.exe', args);
  return { ok: out.status === 0, text: out.stdout.trim(), error: out.stderr.trim().split('\n').slice(-2).join(' | ') };
};
async function connect(database = 'daubert_global') {
  const client = new Client({ host: HOST, port: PORT, user: 'postgres', database, connectionTimeoutMillis: 5000 });
  client.on('error', () => { /* the isolated server is stopped on purpose at the end or after a failure */ });
  await client.connect();
  return client;
}
const rows = async (client, sql, params) => (await client.query(sql, params)).rows;
async function expectFailure(db, label, work, pattern) {
  await db.query('SAVEPOINT expected');
  try { await work(); } catch (error) {
    await db.query('ROLLBACK TO SAVEPOINT expected');
    return pattern.test(`${error.code || ''} ${error.message}`);
  }
  await db.query('ROLLBACK TO SAVEPOINT expected');
  return false;
}

// ----- fingerprints of everything that is HISTORY or COUNTER (must never change)
const TABLES = [['core.documentos', "to_jsonb(t)-'caterpillar_admission'", 'documento_id'], ['ops.ejecuciones_automatizacion', 'to_jsonb(t)', 'ejecucion_id'], ['operacion.remisiones', 'to_jsonb(t)', 'remision_id'],
  ['operacion.remision_detalle', 'to_jsonb(t)', 'detalle_id'], ['operacion.reservas_folios', 'to_jsonb(t)', 'reserva_id'], ['operacion.series_documentales', 'to_jsonb(t)', 'serie_id'],
  ['operacion.ajustes_series', 'to_jsonb(t)', 'ajuste_id'], ['ops.automatizacion_series_proceso', 'to_jsonb(t)', 'ruta_id'], ['ops.automatizaciones', 'to_jsonb(t)', 'automatizacion_id']];
async function fingerprint(db) {
  const out = {};
  for (const [table, expr, key] of TABLES) {
    const r = (await rows(db, `SELECT count(*)::int AS n, md5(COALESCE(string_agg((${expr})::text,'|' ORDER BY ${key}),'')) AS h FROM ${table} t`))[0];
    out[table] = `${r.n}:${r.h}`;
  }
  return out;
}
// ----- effective privileges of a role, as a sorted text list (functions in the app schemas + tables)
async function privileges(db, role) {
  const fns = await rows(db, `SELECT p.oid::regprocedure::text AS s FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('core','ops','operacion') AND has_function_privilege($1,p.oid,'EXECUTE') ORDER BY 1`, [role]);
  const tabs = await rows(db, `SELECT c.oid::regclass::text AS s, array_to_string(ARRAY[CASE WHEN has_table_privilege($1,c.oid,'SELECT') THEN 'S' END, CASE WHEN has_table_privilege($1,c.oid,'INSERT') THEN 'I' END,
    CASE WHEN has_table_privilege($1,c.oid,'UPDATE') THEN 'U' END, CASE WHEN has_table_privilege($1,c.oid,'DELETE') THEN 'D' END],'') AS p
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('core','ops','operacion','security') AND c.relkind='r' ORDER BY 1`, [role]);
  return { functions: fns.map(r => r.s), tables: tabs.filter(r => r.p).map(r => `${r.s}:${r.p}`) };
}
const diffLists = (before, after) => ({ added: after.filter(x => !before.includes(x)), removed: before.filter(x => !after.includes(x)) });

async function inspect(db) {
  const blocks = parseBlocks(fs.readFileSync(SQL_FILE, 'utf8'));
  assertReadOnly(blocks);
  const out = {};
  await db.query('BEGIN READ ONLY');
  for (const block of blocks) {
    await db.query('SAVEPOINT b');
    try { out[block.name] = (await db.query(block.sql)).rows; await db.query('RELEASE SAVEPOINT b'); }
    catch (error) { await db.query('ROLLBACK TO SAVEPOINT b'); out[block.name] = { error: String(error.message).split('\n')[0] }; }
  }
  await db.query('ROLLBACK'); // closes the read-only transaction: it must not keep locks that would block the migrations
  return out;
}

async function main() {
  const dump = process.argv.slice(2).find(argument => !argument.startsWith('--'));
  const keep = process.argv.includes('--keep');
  if (!dump || !fs.existsSync(dump)) throw new Error('Usage: node scripts/rehearse-caterpillar-prod-copy.cjs <backup.dump> [--keep]');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(dump)).digest('hex').toUpperCase();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  const base = path.join(ROOT, stamp), data = path.join(base, 'data'), log = path.join(base, 'postgres.log');
  if (fs.existsSync(base)) throw new Error('Refusing to reuse an existing rehearsal folder');
  fs.mkdirSync(base, { recursive: true });
  const report = { backup: { file: path.basename(dump), sha256 }, instance: { port: PORT, host: HOST } };
  let started = false;
  try {
    // ---- isolated instance
    const init = run('initdb.exe', ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale', 'Spanish_Spain.1252']);
    check('isolated instance initialised (own data folder, trust auth on loopback only)', init.status === 0, init.stderr);
    const start = run('pg_ctl.exe', ['-D', data, '-o', `-p ${PORT} -c listen_addresses=${HOST} -c max_connections=30`, '-l', log, '-w', 'start'], { quiet: true });
    check('isolated instance started on 127.0.0.1:55432', start.status === 0, start.stderr);
    started = true;
    const admin = await connect('postgres');
    report.instance.version = (await rows(admin, 'SHOW server_version'))[0].server_version;
    check('the instance is a separate PostgreSQL 18 server, not the operational one', Number((await rows(admin, 'SHOW port'))[0].port) === PORT);
    for (const [role, limit, inherit] of ROLES) await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS ${inherit ? 'INHERIT' : 'NOINHERIT'} CONNECTION LIMIT ${limit}`);
    await admin.query('GRANT pg_read_all_data TO daubert_backup');
    await admin.query("CREATE DATABASE daubert_global TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'Spanish_Spain.1252' LC_CTYPE 'Spanish_Spain.1252'");
    await admin.end();

    // ---- real restore into the EMPTY database
    const restore = run('pg_restore.exe', ['-h', HOST, '-p', String(PORT), '-U', 'postgres', '-d', 'daubert_global', '--no-password', '--exit-on-error', dump]);
    check('pg_restore completed with no error (owners and ACLs preserved)', restore.status === 0, restore.stderr);
    const db = await connect();
    check('restored database identity', (await rows(db, 'SELECT current_database() AS d'))[0].d === 'daubert_global');

    const before = await fingerprint(db);
    const inspected0 = await inspect(db);
    const nextFolios = Object.fromEntries(inspected0.series_state_and_discrepancies.map(r => [r.codigo, r.siguiente_folio]));
    report.before = { fingerprint: before, nextFolios, executionsByState: inspected0.executions_by_state, processing: inspected0.executions_processing.length,
      legacyPins: inspected0.legacy_function_pins.map(r => r.matches_test_validated) };
    check('restored copy has the production tables, the Caterpillar series and executions', before['ops.ejecuciones_automatizacion'].split(':')[0] !== '0' && Object.keys(nextFolios).length === 3, JSON.stringify(nextFolios));
    check('restored copy is idle (no PROCESANDO)', inspected0.executions_processing.length === 0);
    check('the five legacy functions are the validated ones', inspected0.legacy_function_pins.every(r => r.matches_test_validated));
    check('013 and 016/017 objects are absent before the migrations', inspected0.cancellation_and_regeneration_objects[0].cancellation_ledger === false && inspected0.new_object_name_collisions.length === 0);
    const appBefore = await privileges(db, 'n8n_app'), hubBefore = await privileges(db, 'daubert_hub_app');

    // ---- 013 (formal cancellation)
    for (const kind of ['precheck', 'up', 'postcheck']) {
      const out = psqlFile(f(`20261020_013_caterpillar_cancellation.${kind}.sql`));
      check(`013 ${kind}`, out.ok, out.error);
    }
    const after013 = await fingerprint(db);
    check('013 changed no historical table nor counter', JSON.stringify(after013) === JSON.stringify(before));
    const hub013 = await privileges(db, 'daubert_hub_app');
    const hubDiff013 = diffLists([...hubBefore.functions, ...hubBefore.tables], [...hub013.functions, ...hub013.tables]);
    check('013 gave the Hub only the cancel function and read of the ledger', hubDiff013.removed.length === 0 && hubDiff013.added.length === 2 && hubDiff013.added.some(x => x.includes('fn_cancelar_remision_caterpillar')) && hubDiff013.added.some(x => x.startsWith('operacion.cancelaciones_remisiones:S')), JSON.stringify(hubDiff013));
    const appAfter013 = await privileges(db, 'n8n_app');
    check('013 left n8n_app (Audi) exactly as it was', JSON.stringify(appAfter013) === JSON.stringify(appBefore));
    const state013 = after013, hub013Snapshot = hub013;

    // ---- worker role (real template; the password is random, in memory only) and 016/017
    const password = crypto.randomBytes(18).toString('base64url');
    const roleRun = psqlFile(f('20261024_016_caterpillar_worker_role_prod.template.sql'), { worker_password: password });
    check('worker role template: n8n_cat_prod created with no legacy EXECUTE and no table privileges', roleRun.ok, roleRun.error);
    const pre = psqlFile(f('20261024_016_caterpillar_atomic_admission_prod.precheck.sql'));
    check('016 precheck passes on real production data', pre.ok && /PRECHECK_016_PASS/.test(pre.text), pre.error || pre.text.slice(-200));
    const up = psqlFile(f('20261024_016_caterpillar_atomic_admission_prod.up.sql'));
    check('016/017 up applies', up.ok, up.error);
    const post = psqlFile(f('20261024_016_caterpillar_atomic_admission_prod.postcheck.sql'));
    check('016/017 postcheck passes', post.ok && /POSTCHECK_016_PASS/.test(post.text), post.error || post.text.slice(-200));

    // ---- comparison before/after
    const after016 = await fingerprint(db);
    check('016 changed no historical table nor counter (ignoring only the new NULL column)', JSON.stringify(after016) === JSON.stringify(before));
    const snapshots = (await rows(db, 'SELECT count(*)::int AS n FROM core.documentos WHERE caterpillar_admission IS NOT NULL'))[0].n;
    check('no historical snapshot was invented', snapshots === 0, snapshots);
    const inspected1 = await inspect(db);
    check('next folios of P2/P5/P6 are exactly the backup ones', JSON.stringify(Object.fromEntries(inspected1.series_state_and_discrepancies.map(r => [r.codigo, r.siguiente_folio]))) === JSON.stringify(nextFolios));
    check('no PROCESANDO and no new execution/reservation/remission', inspected1.executions_processing.length === 0 && after016['ops.ejecuciones_automatizacion'] === before['ops.ejecuciones_automatizacion']);
    const appAfter = await privileges(db, 'n8n_app');
    check('n8n_app (Audi) keeps every privilege it had and gains none', JSON.stringify(appAfter) === JSON.stringify(appBefore), JSON.stringify(diffLists([...appBefore.functions, ...appBefore.tables], [...appAfter.functions, ...appAfter.tables])));
    // Functions that PUBLIC may execute (PostgreSQL's default, e.g. the shared updated_at trigger function) are not a privilege of the role; they are reported, not counted.
    const publicFunctions = (await rows(db, "SELECT p.oid::regprocedure::text AS s FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('core','ops','operacion') AND has_function_privilege('public',p.oid,'EXECUTE') ORDER BY 1")).map(r => r.s);
    report.publicExecutableFunctions = publicFunctions;
    const workerAll = await privileges(db, 'n8n_cat_prod');
    const worker = { ...workerAll, functions: workerAll.functions.filter(name => !publicFunctions.includes(name)) };
    const expectedWorker = ['core.fn_crear_o_resolver_documento(bigint,text,text,text,text,date,text)', 'ops.fn_admitir_reservar_caterpillar(bigint,text,text,integer)', 'ops.fn_fallo_caterpillar(bigint,text,text,text)',
      'ops.fn_finalizar_caterpillar(bigint,text,text,text,text)', 'ops.fn_guardar_snapshot_caterpillar(bigint,text)', 'ops.fn_reprocesar_reservar_caterpillar(bigint,text,text,integer)', 'ops.fn_resolver_ejecucion_para_reproceso(bigint)',
      'operacion.fn_registrar_remision_caterpillar(bigint,text,text,bigint,date,text,jsonb)'].sort();
    check('n8n_cat_prod executes exactly the 6 protected entries + the 2 read-only resolvers, and has no table privilege at all',
      JSON.stringify([...worker.functions].sort()) === JSON.stringify(expectedWorker) && worker.tables.length === 0, JSON.stringify(worker));
    const hub016 = await privileges(db, 'daubert_hub_app');
    const hubDiff016 = diffLists([...hub013Snapshot.functions, ...hub013Snapshot.tables], [...hub016.functions, ...hub016.tables]);
    check('016 gave the Hub only the authorization function and read of the authorization table', hubDiff016.removed.length === 0 && hubDiff016.added.length === 2
      && hubDiff016.added.some(x => x.includes('fn_autorizar_regeneracion_caterpillar')) && hubDiff016.added.some(x => x.startsWith('operacion.autorizaciones_regeneracion_caterpillar:S')), JSON.stringify(hubDiff016));
    check('PUBLIC and the other roles hold no EXECUTE on the new functions', (await rows(db, `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_roles r ON NOT r.rolsuper AND r.rolname !~ '^pg_' AND r.rolname NOT IN ('n8n_cat_prod','daubert_hub_app')
      WHERE p.proname = ANY(ARRAY['fn_admitir_reservar_caterpillar','fn_reprocesar_reservar_caterpillar','fn_guardar_snapshot_caterpillar','fn_registrar_remision_caterpillar','fn_finalizar_caterpillar','fn_fallo_caterpillar','fn_autorizar_regeneracion_caterpillar'])
        AND has_function_privilege(r.oid,p.oid,'EXECUTE')`))[0].n === 0);
    const legacy = ['ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)', 'operacion.reservar_folios_para_ejecucion(bigint,text,integer)', 'operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)',
      'ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)', 'ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)'];
    check('the Caterpillar worker cannot execute any legacy function; n8n_app still can (Audi)', (await rows(db, 'SELECT bool_or(has_function_privilege($1,s::regprocedure,$3)) AS worker, bool_and(has_function_privilege($2,s::regprocedure,$3)) AS app FROM unnest($4::text[]) s', ['n8n_cat_prod', 'n8n_app', 'EXECUTE', legacy]))
      .every(r => r.worker === false && r.app === true));

    // ---- contracts of the PROD candidate resolve against the migrated copy (statements are PREPAREd as the worker, never executed)
    const candidate = JSON.parse(fs.readFileSync(CANDIDATE, 'utf8'));
    const statements = [];
    for (const node of candidate.nodes.filter(n => n.type.endsWith('.postgres'))) {
      const query = String(node.parameters.query);
      const literals = query.startsWith('=') ? [...query.matchAll(/"(SELECT[^"]*)"/g)].map(m => m[1]) : [query];
      for (const sql of literals) statements.push({ node: node.name, sql: sql.replace(/;\s*$/, '') });
    }
    await db.query('BEGIN');
    await db.query('SET LOCAL ROLE n8n_cat_prod');
    let prepared = 0;
    for (const [index, { node, sql }] of statements.entries()) { await db.query(`PREPARE cand_${index} AS ${sql}`); prepared++; void node; }
    await db.query('ROLLBACK');
    check(`every SQL statement of the PROD candidate (${statements.length}) prepares as n8n_cat_prod against the migrated copy`, prepared === statements.length && statements.length >= 8, `${prepared}/${statements.length}`);

    // ---- gate protection of REAL history, functional smoke, bypass (single transaction, rolled back)
    const company = (await rows(db, "SELECT d.empresa_id FROM core.documentos d JOIN ops.ejecuciones_automatizacion e ON e.documento_origen_id=d.documento_id JOIN ops.automatizaciones a USING(automatizacion_id) WHERE a.codigo='REMISIONES_CATERPILLAR' ORDER BY 1 LIMIT 1"))[0].empresa_id;
    const adminId = (await rows(db, "SELECT user_id::text AS id FROM security.users WHERE role='ADMIN' AND status='ACTIVE' AND NOT must_change_password ORDER BY user_id LIMIT 1"))[0].id;
    const fileHash = (await rows(db, 'SELECT hash_archivo FROM core.documentos WHERE documento_id=(SELECT documento_origen_id FROM ops.ejecuciones_automatizacion WHERE ejecucion_id=22)'))[0]?.hash_archivo;
    const manifest = (processKey, name, quantity = 1) => JSON.stringify({ version: 'CAT_OPERATIONAL_CONTENT_V1', scope: [...processKey, 'CATERPILLAR MEXICO RECIBOS PLANTA 2.', 'CME940630QM2'], deliveryDate: '2026-10-24', grouping: 'POR_ARTICULO',
      documents: Array.from({ length: quantity }, (_unused, n) => ({ purchaseOrder: `99000000${n}${name.length}`, lines: [[`ENSAYO-${n}`, `89-ENS${n}`, `99000000${n}${name.length}`, 10 + n, 'BOLSAS']] })) });
    const P2 = ['CATERPILLAR_P2', 'P2', ''], P5 = ['CAT_P3_P4_P5_P6', 'P5', ''];
    const resolve = (client, name, hash) => rows(client, 'SELECT * FROM core.fn_crear_o_resolver_documento($1::bigint,$2::text,$3::text,$4::text,$5::text,$6::date,$7::text)', [company, 'PROGRAMACION_ENTREGA', name, `C:/ensayo/${name}`, 'DROPBOX', '2026-10-24', hash]).then(r => r[0].documento_id);
    await db.query('BEGIN');
    try {
      await db.query('SET LOCAL ROLE n8n_cat_prod');
      // (a) a program that is genuinely new is admitted and reserves exactly the next backup folio
      const docNew = await resolve(db, 'PROGRAMACION DE ENTREGA CAT P2 ENSAYO 016 NUEVO.xlsx', 'ensayo-hash-nuevo');
      check('snapshot of a new program stored', (await rows(db, 'SELECT ops.fn_guardar_snapshot_caterpillar($1::bigint,$2::text) AS s', [docNew, manifest(P2, 'nuevo')]))[0].s === 'STORED');
      const gate = (await rows(db, 'SELECT * FROM ops.fn_admitir_reservar_caterpillar($1::bigint,$2::text,$3::text,$4::integer)', [docNew, 'ENSAYO-W1', 'REMISION_CAT_P2', 1]))[0];
      check('a new program is admitted and reserves exactly the next P2 folio of the backup', gate.decision === 'ADMIT' && gate.can_emit && String(gate.folio_inicial) === String(nextFolios.REMISION_CAT_P2), JSON.stringify(gate));
      // (b) the historical re-issue patterns of PROD are stopped without folios
      const sameName = await resolve(db, 'PROGRAMACIÓN DE ENTREGA CAT CF PLANTA 5 260929 TEMPLATE.xlsx', 'ensayo-hash-otro');
      await rows(db, 'SELECT ops.fn_guardar_snapshot_caterpillar($1::bigint,$2::text)', [sameName, manifest(P5, 'mismo-nombre')]);
      const g1 = (await rows(db, 'SELECT * FROM ops.fn_admitir_reservar_caterpillar($1::bigint,$2::text,$3::text,$4::integer)', [sameName, 'ENSAYO-W2', 'REMISION_CAT_P5', 1]))[0];
      check('historical pattern 13->14 (same file name, other content) is REVIEW / LEGACY_NAME_MATCH with no folios', !g1.can_emit && g1.decision === 'REVIEW' && g1.reason === 'LEGACY_NAME_MATCH' && !g1.reserva_id, JSON.stringify(g1));
      const sameBytes = await resolve(db, 'PROGRAMACIÓN DE ENTREGA CAT CF PLANTA 5 261020 RENOMBRADO ENSAYO.xlsx', fileHash);
      await rows(db, 'SELECT ops.fn_guardar_snapshot_caterpillar($1::bigint,$2::text)', [sameBytes, manifest(P5, 'mismos-bytes')]);
      const g2 = (await rows(db, 'SELECT * FROM ops.fn_admitir_reservar_caterpillar($1::bigint,$2::text,$3::text,$4::integer)', [sameBytes, 'ENSAYO-W3', 'REMISION_CAT_P5', 1]))[0];
      check('historical pattern 22->23 (same bytes, renamed) is REVIEW / LEGACY_FILE_MATCH with no folios', !g2.can_emit && g2.decision === 'REVIEW' && g2.reason === 'LEGACY_FILE_MATCH' && !g2.reserva_id, JSON.stringify(g2));
      // (c) historical executions are never reprocessed nor regenerated automatically
      for (const id of [14, 22, 23]) {
        const r = (await rows(db, 'SELECT * FROM ops.fn_reprocesar_reservar_caterpillar($1::bigint,$2::text,$3::text,$4::integer)', [id, 'ENSAYO-W4', 'REMISION_CAT_P5', 1]))[0];
        check(`historical execution ${id} cannot be reprocessed (no snapshot)`, !r.can_emit && r.reason === 'REPROCESS_SNAPSHOT_REQUIRED', JSON.stringify(r));
      }
      await db.query('RESET ROLE');
      await db.query('SET LOCAL ROLE daubert_hub_app');
      for (const id of [14, 22]) check(`historical execution ${id}: regeneration is not authorizable (informal cancellation, no snapshot)`, await expectFailure(db, 'auth', () => db.query('SELECT * FROM operacion.fn_autorizar_regeneracion_caterpillar($1::bigint,$2::text,$3::bigint,$4::text)', [id, 'ensayo', adminId, 'ensayo']), /PCR0[34]/));
      await db.query('RESET ROLE');
      // (d) bypass attempts as the Caterpillar worker
      await db.query('SET LOCAL ROLE n8n_cat_prod');
      const attempts = [
        ["SELECT * FROM operacion.reservar_folios_para_ejecucion(1,'REMISION_CAT_P2',1)"],
        ["SELECT * FROM ops.fn_crear_ejecucion_automatizacion('REMISIONES_CATERPILLAR',1,'x',null,null)"],
        ['UPDATE operacion.series_documentales SET siguiente_folio=1'],
        ['UPDATE core.documentos SET caterpillar_admission=NULL'],
        ["SELECT * FROM operacion.fn_autorizar_regeneracion_caterpillar(14,'x',1,'x')"]];
      let allDenied = true;
      for (const [sql] of attempts) allDenied = (await expectFailure(db, sql, () => db.query(sql), /42501|denied|denegado/i)) && allDenied;
      check('worker: legacy functions, direct DML and the authorization function are denied', allDenied);
    } finally { await db.query('ROLLBACK').catch(() => {}); }
    const afterSmoke = await fingerprint(db);
    check('the smoke left no trace (history and counters identical)', JSON.stringify(afterSmoke) === JSON.stringify(before));

    // ---- rollback BEFORE any emission: 016 down, then 013 down, back to the exact original state; then forward again
    const down016 = psqlFile(f('20261024_016_caterpillar_atomic_admission_prod.down.sql'));
    check('rollback before emission: 016 down applies', down016.ok, down016.error);
    check('after 016 down the 016/017 objects are gone and state equals the 013 state', (await rows(db, "SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE '%\\_caterpillar' ESCAPE '\\' AND proname NOT LIKE 'fn\\_cancelar%' ESCAPE '\\'"))[0].n === 0
      && JSON.stringify(await fingerprint(db)) === JSON.stringify(state013) && JSON.stringify((await privileges(db, 'daubert_hub_app'))) === JSON.stringify(hub013Snapshot));
    const down013 = psqlFile(f('20261020_013_caterpillar_cancellation.down.sql'));
    check('rollback before emission: 013 down applies (empty ledger)', down013.ok, down013.error);
    check('after 013 down the database is back to the exact restored state (history, counters, Hub and Audi privileges)', JSON.stringify(await fingerprint(db)) === JSON.stringify(before)
      && JSON.stringify(await privileges(db, 'daubert_hub_app')) === JSON.stringify(hubBefore) && JSON.stringify(await privileges(db, 'n8n_app')) === JSON.stringify(appBefore));
    for (const kind of ['precheck', 'up', 'postcheck']) check(`re-apply 013 ${kind}`, psqlFile(f(`20261020_013_caterpillar_cancellation.${kind}.sql`)).ok);
    for (const kind of ['precheck', 'up', 'postcheck']) check(`re-apply 016 ${kind}`, psqlFile(f(`20261024_016_caterpillar_atomic_admission_prod.${kind}.sql`)).ok);

    // ---- rollback AFTER an emission is refused (the copy now holds a snapshot-backed completed execution)
    await db.query('BEGIN');
    await db.query('SET LOCAL ROLE n8n_cat_prod');
    const doc = await resolve(db, 'PROGRAMACION DE ENTREGA CAT P2 ENSAYO 016 EMISION.xlsx', 'ensayo-hash-emision');
    await rows(db, 'SELECT ops.fn_guardar_snapshot_caterpillar($1::bigint,$2::text)', [doc, manifest(P2, 'emision')]);
    const emit = (await rows(db, 'SELECT * FROM ops.fn_admitir_reservar_caterpillar($1::bigint,$2::text,$3::text,$4::integer)', [doc, 'ENSAYO-W9', 'REMISION_CAT_P2', 1]))[0];
    await db.query('SELECT * FROM operacion.fn_registrar_remision_caterpillar($1,$2,$3,$4,$5,$6,$7::jsonb)', [emit.ejecucion_id, 'ENSAYO-W9', 'REMISION_CAT_P2', emit.folio_inicial, '2026-10-24', 'ENSAYO/NO_FILE/1.pdf', '[{"codigo_interno":"ENS","cantidad_texto":"10 bolsas"}]']);
    await db.query("SELECT * FROM ops.fn_finalizar_caterpillar($1::bigint,$2::text,'COMPLETADA')", [emit.ejecucion_id, 'ENSAYO-W9']);
    await db.query('COMMIT');
    const refused = psqlFile(f('20261024_016_caterpillar_atomic_admission_prod.down.sql'));
    check('rollback AFTER an emission is refused by 016 down (no data loss, no counter reset)', !refused.ok && /rollback refused|evidence/i.test(refused.error), refused.error);
    const afterEmission = await rows(db, "SELECT (SELECT siguiente_folio FROM operacion.series_documentales WHERE codigo='REMISION_CAT_P2')::text AS p2, (SELECT count(*) FROM operacion.remisiones)::int AS remissions");
    check('the emission consumed exactly one folio and the refusal changed nothing', String(afterEmission[0].p2) === String(Number(nextFolios.REMISION_CAT_P2) + 1), JSON.stringify(afterEmission));

    report.results = { checks: results.length, p2NextFolioAfterOneEmission: afterEmission[0].p2, historicalDocumentsWithSnapshot: snapshots, workerFunctions: worker.functions.length };
    await db.end();
  } finally {
    // The script NEVER deletes anything: it only stops its own instance (identified by the data folder it created) and leaves the folder for inspection.
    // A later run uses a new time-stamped folder; removing old ones is a manual, explicit decision.
    if (started) {
      const stop = run('pg_ctl.exe', ['-D', data, '-m', 'fast', '-w', 'stop'], { quiet: true });
      report.instance.stopped = stop.status === 0;
      report.instance.dataFolder = data;
    }
  }
  console.log(JSON.stringify({ result: 'PROD_COPY_REHEARSAL_PASS', ...report, list: results.map(r => r.name) }, null, 2));
}

main().catch(error => {
  console.log(JSON.stringify({ result: 'PROD_COPY_REHEARSAL_FAIL', checks: results.length, failed: results.filter(r => !r.pass), message: error.handled ? undefined : String(error.message).split('\n')[0].slice(0, 300) }, null, 2));
  process.exitCode = 1;
});
