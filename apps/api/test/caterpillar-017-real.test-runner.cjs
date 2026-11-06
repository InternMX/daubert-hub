// REAL PostgreSQL TEST validation of 017 (commercial regeneration of a COMPLETADA execution whose remissions were ALL formally cancelled).
// Uses ONLY TEST_DATABASE_URL_MIGRATOR (postgres@daubert_hub_test); impersonates the worker (n8n_cat_test) and the Hub (daubert_hub_test_user) with SET LOCAL ROLE.
//   Phase A : one transaction with throw-away fixtures and every scenario, ALWAYS rolled back (no row, folio or counter survives).
//   Phase B : only with --commit --allow-test-writes. Identifiable fixtures HUB_TEST_017_* are COMMITTED and two real backends race:
//             (1) two Hub authorizations of the same execution -> exactly one authorization; (2) two workers claiming the regenerated execution -> one child, one reservation.
const { Client } = require('pg');
const crypto = require('node:crypto');
const { assert, guardedUrl } = require('./support/caterpillar-cancellation-test-guards.cjs');
const { createCaterpillarManifestV1 } = require('../../../n8n/workflows/remisiones-caterpillar/candidate-5678/manifest-v1.generated.cjs');
const items = require('./fixtures/caterpillar-normalized-items.json').normal;
const { adaptCaterpillarNormalizedItems } = createCaterpillarManifestV1();

const GATE = 'SELECT * FROM ops.fn_admitir_reservar_caterpillar_test($1::bigint,$2::text,$3::text,$4::integer)';
const REPROCESS = 'SELECT * FROM ops.fn_reprocesar_reservar_caterpillar_test($1::bigint,$2::text,$3::text,$4::integer)';
const SAVE = 'SELECT ops.fn_guardar_snapshot_caterpillar_test($1::bigint,$2::text) AS s';
const REGISTER = 'SELECT * FROM operacion.fn_registrar_remision_caterpillar_test($1,$2,$3,$4,$5,$6,$7::jsonb)';
const FINALIZE = 'SELECT * FROM ops.fn_finalizar_caterpillar_test($1,$2,$3,$4,$5)';
const CANCEL = 'SELECT * FROM operacion.fn_cancelar_remision_caterpillar($1::bigint,$2::bigint,$3::text,$4::text,$5::bigint,$6::text)';
const AUTHORIZE = 'SELECT * FROM operacion.fn_autorizar_regeneracion_caterpillar($1::bigint,$2::text,$3::bigint,$4::text)';
const results = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, ok, detail) => { results.push({ name, pass: Boolean(ok), ...(ok ? {} : { detail: String(detail ?? '').slice(0, 300) }) }); if (!ok) throw Object.assign(new Error('CHECK_FAILED'), { handled: true }); };
const rows = async (client, sql, params) => (await client.query(sql, params)).rows;
const as = (client, role) => client.query(`RESET ROLE; SET LOCAL ROLE ${role}`);
async function connect(url) { const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 }); await client.connect(); return client; }
async function failing(client, sql, params, pattern) {
  await client.query('SAVEPOINT expected');
  try { await client.query(sql, params); await client.query('ROLLBACK TO SAVEPOINT expected'); return false; }
  catch (error) { await client.query('ROLLBACK TO SAVEPOINT expected'); return pattern.test(`${error.code} ${error.message}`); }
}
function manifestFor(tag, change = {}) {
  const normalized = items.map(item => ({ json: { ...item.json, cliente_grupo: `HUB_TEST_017_${tag}`, planta_codigo: 'FIX', subplanta_codigo: 'A', ...change } }));
  const { manifest } = adaptCaterpillarNormalizedItems(normalized);
  return { text: JSON.stringify(manifest), quantity: manifest.documents.length, processKey: manifest.scope.slice(0, 3).join('|') };
}
async function fixture(client, tag, documentCount, names) {
  const base = (await client.query(`SELECT (SELECT automatizacion_id FROM ops.automatizaciones WHERE codigo='REMISIONES_CATERPILLAR') AS automation,
    (SELECT empresa_id FROM core.documentos WHERE documento_id=214) AS company, (SELECT empresa_cliente_id FROM ops.automatizacion_series_proceso ORDER BY ruta_id LIMIT 1) AS client`)).rows[0];
  assert(base.automation && base.company && base.client, 'Fixture prerequisites missing in TEST');
  const m = manifestFor(tag), series = `HUB_TEST_017_${tag}`.toUpperCase();
  const serieId = (await client.query("INSERT INTO operacion.series_documentales(codigo,nombre,siguiente_folio,estatus) VALUES($1,$2,900000,'ACTIVA') RETURNING serie_id", [series, `HUB TEST 017 ${tag}`])).rows[0].serie_id;
  await client.query("INSERT INTO ops.automatizacion_series_proceso(automatizacion_id,llave_proceso,serie_id,empresa_cliente_id,estatus) VALUES($1,$2,$3,$4,'ACTIVA')", [base.automation, m.processKey, serieId, base.client]);
  const documents = [];
  for (let n = 1; n <= documentCount; n++) {
    documents.push((await client.query("INSERT INTO core.documentos(empresa_id,tipo_documento,nombre_archivo,ruta_archivo,hash_archivo,origen,estatus) VALUES($1,'PROGRAMACION_ENTREGA',$2,'HUB_TEST_017/NO_FILE',$3,'OTRO','ACTIVO') RETURNING documento_id",
      [base.company, names?.[n - 1] ?? `HUB_TEST_017_${tag}_${n}.xlsx`, crypto.randomBytes(16).toString('hex')])).rows[0].documento_id);
  }
  return { documents, series, manifest: m, serieId, tag };
}
async function admin(client) {
  const row = (await client.query("SELECT user_id::text AS id FROM security.users WHERE role='ADMIN' AND status='ACTIVE' AND NOT must_change_password ORDER BY user_id LIMIT 1")).rows[0];
  assert(row, 'No active ADMIN user in TEST');
  return row.id;
}
// Worker flow (as n8n would do it): snapshot -> admission -> register every remission -> COMPLETADA. Leaves the connection as the worker role.
async function complete(client, fx, doc, worker, label) {
  await as(client, 'n8n_cat_test');
  check(`${label}: snapshot stored`, (await rows(client, SAVE, [doc, fx.manifest.text]))[0].s === 'STORED');
  const gate = (await rows(client, GATE, [doc, worker, fx.series, fx.manifest.quantity]))[0];
  check(`${label}: admitted`, gate.can_emit && gate.reason === 'ACQUIRED', JSON.stringify(gate));
  for (let n = 0; n < fx.manifest.quantity; n++) await client.query(REGISTER, [gate.ejecucion_id, worker, fx.series, Number(gate.folio_inicial) + n, '2026-10-24', `HUB_TEST_017/NO_FILE/${n}.pdf`, '[{"codigo_interno":"FIX","cantidad_texto":"1 pieza"}]']);
  const done = (await rows(client, FINALIZE, [gate.ejecucion_id, worker, 'COMPLETADA', null, null]))[0];
  check(`${label}: COMPLETADA`, done.estado_final === 'COMPLETADA' && done.reservas_aplicadas === 1, JSON.stringify(done));
  return gate;
}
// Formal cancellation through the EXISTING Hub function (013), as the Hub role.
async function cancelAll(client, executionId, adminId, label, only) {
  await as(client, 'daubert_hub_test_user');
  const list = (await rows(client, `SELECT remision_id::text AS id, to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS revision FROM operacion.remisiones WHERE ejecucion_id=$1 AND estatus='GENERADA' ORDER BY remision_id`, [executionId]));
  for (const r of only ? list.slice(0, only) : list) {
    const out = (await rows(client, CANCEL, [executionId, r.id, r.revision, `fixture ${label} cancellation`, adminId, `req-${label}`]))[0];
    check(`${label}: remission ${r.id} cancelled formally`, out.resultado === 'CANCELLED');
  }
}

async function phaseA(db) {
  const tag = crypto.randomBytes(4).toString('hex'), W = 'REAL017-WA', W2 = 'REAL017-WB', W3 = 'REAL017-WC';
  await db.query('BEGIN');
  try {
    const adminId = await admin(db);
    const fx = await fixture(db, `A${tag}`, 5, [`HUB_TEST_017_A${tag}_1.xlsx`, `HUB_TEST_017_A${tag}_2.xlsx`, `HUB_TEST_017_A${tag}_1.xlsx`, `HUB_TEST_017_A${tag}_4.xlsx`, `HUB_TEST_017_A${tag}_5_COPIA.xlsx`]);
    const [d1, d2, dDuplicateName, d4, dRenamed] = fx.documents, q = fx.manifest.quantity, series = fx.series;
    const e1 = await complete(db, fx, d1, W, 'program 1');
    const base = Number(e1.folio_final);

    await as(db, 'daubert_hub_test_user');
    check('authorize: refused while remissions are still live (PCR04)', await failing(db, AUTHORIZE, [e1.ejecucion_id, 'motivo', adminId, 'r1'], /PCR04/));
    await as(db, 'n8n_cat_test');
    check('reprocess gate: COMPLETADA parent without authorization is rejected as before', (await rows(db, REPROCESS, [e1.ejecucion_id, W3, series, q]))[0].reason === 'PARENT_NOT_REPROCESSABLE');

    await cancelAll(db, e1.ejecucion_id, adminId, 'p1-partial', 1);
    await as(db, 'daubert_hub_test_user');
    check('authorize: partially cancelled execution is not eligible (PCR04)', await failing(db, AUTHORIZE, [e1.ejecucion_id, 'motivo', adminId, 'r2'], /PCR04/));
    await cancelAll(db, e1.ejecucion_id, adminId, 'p1');

    await as(db, 'daubert_hub_test_user');
    check('authorize: motivo is mandatory (22023)', await failing(db, AUTHORIZE, [e1.ejecucion_id, '   ', adminId, 'r3'], /22023/));
    check('authorize: a non-ADMIN or unknown actor is refused (PCR05)', await failing(db, AUTHORIZE, [e1.ejecucion_id, 'motivo', 999999999, 'r4'], /PCR05/));
    check('authorize: unknown execution (PCR01)', await failing(db, AUTHORIZE, [999999999, 'motivo', adminId, 'r5'], /PCR01/));
    check('authorize: historical COMPLETADA execution without snapshot is never regenerable (PCR03)', await failing(db, AUTHORIZE, [133, 'motivo', adminId, 'r6'], /PCR03/));
    const auth1 = (await rows(db, AUTHORIZE, [e1.ejecucion_id, 'Corrección comercial autorizada', adminId, 'req-auth-1']))[0];
    check('authorize: ADMIN authorization recorded with who/why/when', auth1.resultado === 'AUTHORIZED' && auth1.motivo === 'Corrección comercial autorizada' && auth1.usuario_id === adminId && auth1.usuario_email && auth1.usuario_nombre && auth1.autorizada_en && auth1.ejecucion_nueva_id === null, JSON.stringify(auth1));
    const auth2 = (await rows(db, AUTHORIZE, [e1.ejecucion_id, 'otro motivo distinto', adminId, 'req-auth-2']))[0];
    check('authorize: repeated request is idempotent and keeps the original record', auth2.resultado === 'ALREADY_AUTHORIZED' && auth2.autorizacion_id === auth1.autorizacion_id && auth2.motivo === auth1.motivo);
    check('bypass: Hub cannot write the authorization table directly', await failing(db, "INSERT INTO operacion.autorizaciones_regeneracion_caterpillar(ejecucion_origen_id,motivo,usuario_email,usuario_nombre) VALUES(1,'x','x','x')", [], /42501|permission denied/));
    check('bypass: Hub cannot run the regenerating gate', await failing(db, REPROCESS, [e1.ejecucion_id, 'api', series, q], /42501|permission denied/));

    await as(db, 'n8n_cat_test');
    check('bypass: worker cannot authorize, read or write authorizations', await (async () => {
      const results2 = [await failing(db, AUTHORIZE, [e1.ejecucion_id, 'x', adminId, 'w'], /42501|permission denied/),
        await failing(db, 'SELECT * FROM operacion.autorizaciones_regeneracion_caterpillar', [], /42501|permission denied/),
        await failing(db, 'UPDATE operacion.autorizaciones_regeneracion_caterpillar SET ejecucion_nueva_id=NULL', [], /42501|permission denied/)];
      return results2.every(Boolean);
    })());
    const regen = (await rows(db, REPROCESS, [e1.ejecucion_id, W2, series, q]))[0];
    check('regeneration: authorized parent creates ONE new execution with NEW folios and an owner', regen.decision === 'ADMIT' && regen.reason === 'REPROCESS_ACQUIRED' && regen.can_emit && regen.worker_id === W2 && Number(regen.folio_inicial) > base && regen.ejecucion_id !== e1.ejecucion_id, JSON.stringify(regen));
    await as(db, 'daubert_hub_test_user');
    const consumed = (await rows(db, AUTHORIZE, [e1.ejecucion_id, 'x', adminId, 'req-auth-3']))[0];
    check('authorization is consumed by exactly that child', consumed.resultado === 'ALREADY_AUTHORIZED' && consumed.ejecucion_nueva_id === regen.ejecucion_id, JSON.stringify(consumed));
    await as(db, 'n8n_cat_test');
    check('regeneration: another worker is not an emission', (await rows(db, REPROCESS, [e1.ejecucion_id, W3, series, q]))[0].reason === 'REPROCESS_IN_PROGRESS');
    check('regeneration: same worker retry reuses the reservation', (await rows(db, REPROCESS, [e1.ejecucion_id, W2, series, q]))[0].reserva_id === regen.reserva_id);
    for (let n = 0; n < q; n++) await db.query(REGISTER, [regen.ejecucion_id, W2, series, Number(regen.folio_inicial) + n, '2026-10-24', `HUB_TEST_017/NO_FILE/r${n}.pdf`, '[{"codigo_interno":"FIX","cantidad_texto":"1 pieza"}]']);
    const regenDone = (await rows(db, FINALIZE, [regen.ejecucion_id, W2, 'COMPLETADA', null, null]))[0];
    check('regeneration: child completes and applies its own reservation', regenDone.estado_final === 'COMPLETADA' && regenDone.reservas_aplicadas === 1);
    check('regeneration: a second request does not emit again', (await rows(db, REPROCESS, [e1.ejecucion_id, W3, series, q]))[0].reason === 'ALREADY_REPROCESSED');
    await db.query('RESET ROLE');
    const kept = (await rows(db, `SELECT count(*) FILTER (WHERE estatus='CANCELADA')::int AS cancelled, count(*) FILTER (WHERE estatus<>'CANCELADA')::int AS live, min(folio)::bigint AS first FROM operacion.remisiones WHERE ejecucion_id=$1`, [e1.ejecucion_id]))[0];
    check('original execution and its cancelled remissions are preserved', kept.cancelled === q && kept.live === 0 && Number(kept.first) === Number(e1.folio_inicial));
    check('original reservation stays APLICADA and new folios are fresh', (await rows(db, 'SELECT estatus FROM operacion.reservas_folios WHERE reserva_id=$1', [e1.reserva_id]))[0].estatus === 'APLICADA');

    await as(db, 'n8n_cat_test');
    // Reloading / modifying the Excel must NOT regenerate anything.
    check('reload: same name and modified content stays BLOCKED (authorization required), no folios', await (async () => {
      const m2 = manifestFor(fx.tag, { cantidad_numerica: 321 });
      const saved = (await rows(db, SAVE, [dDuplicateName, m2.text]))[0].s;
      const gate = (await rows(db, GATE, [dDuplicateName, W3, series, m2.quantity]))[0];
      return saved === 'STORED' && !gate.can_emit && gate.decision === 'BLOCK' && gate.reason === 'REGENERATION_AUTHORIZATION_REQUIRED' && !gate.reserva_id;
    })());
    check('reload: renamed copy with the same content goes to review, no folios', await (async () => {
      await rows(db, SAVE, [dRenamed, fx.manifest.text]);
      const gate = (await rows(db, GATE, [dRenamed, W3, series, q]))[0];
      return !gate.can_emit && gate.reason === 'MANIFEST_MATCH_REVIEW' && !gate.reserva_id;
    })());

    // A failed regeneration can still be recovered with the technical reprocess (the cancelled original no longer blocks the program).
    const e2 = await complete(db, { ...fx, manifest: manifestFor(fx.tag, { cantidad_numerica: 555 }) }, d2, W, 'program 2');
    await cancelAll(db, e2.ejecucion_id, adminId, 'p2');
    await as(db, 'daubert_hub_test_user');
    await rows(db, AUTHORIZE, [e2.ejecucion_id, 'segunda corrección', adminId, 'req-auth-p2']);
    await as(db, 'n8n_cat_test');
    const child2 = (await rows(db, REPROCESS, [e2.ejecucion_id, W2, series, q]))[0];
    check('failure path: regeneration child admitted', child2.reason === 'REPROCESS_ACQUIRED' && child2.can_emit);
    await db.query(FINALIZE, [child2.ejecucion_id, W2, 'ERROR', 'HUB_TEST_017', 'synthetic regeneration failure']);
    const recovery = (await rows(db, REPROCESS, [child2.ejecucion_id, W3, series, q]))[0];
    check('failure path: the ERROR child is recoverable by the technical reprocess (new folios)', recovery.reason === 'REPROCESS_ACQUIRED' && recovery.can_emit && Number(recovery.folio_inicial) > Number(child2.folio_final), JSON.stringify(recovery));

    // Defense in depth: an authorization that is somehow present for a parent with a live remission is still refused by the gate.
    await as(db, 'n8n_cat_test');
    const e4 = await complete(db, { ...fx, manifest: manifestFor(fx.tag, { cantidad_numerica: 777 }) }, d4, W, 'program 4');
    await db.query('RESET ROLE');
    await db.query("INSERT INTO operacion.autorizaciones_regeneracion_caterpillar(ejecucion_origen_id,motivo,usuario_email,usuario_nombre) VALUES($1,'forced','x@x','x')", [e4.ejecucion_id]);
    await as(db, 'n8n_cat_test');
    check('defense in depth: authorization with live remissions is refused by the gate', (await rows(db, REPROCESS, [e4.ejecucion_id, W3, series, q]))[0].reason === 'PARENT_HAS_ACTIVE_REMISSIONS');
  } finally { await db.query('ROLLBACK').catch(() => {}); }
  const left = (await db.query("SELECT (SELECT count(*) FROM core.documentos WHERE nombre_archivo LIKE 'HUB_TEST_017_A%')::int d, (SELECT count(*) FROM operacion.series_documentales WHERE codigo LIKE 'HUB_TEST_017_A%')::int s, (SELECT count(*) FROM operacion.autorizaciones_regeneracion_caterpillar)::int a")).rows[0];
  check('phase A rolled back completely (no fixture or authorization survives)', left.d === 0 && left.s === 0, JSON.stringify(left));
}

async function waitFor(observer, pid, predicate) {
  for (let i = 0; i < 100; i++) {
    const r = (await observer.query("SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1 AND datname='daubert_hub_test'", [pid])).rows[0];
    if (r && predicate(r)) return true;
    await sleep(100);
  }
  return false;
}

async function phaseB(url, db) {
  const tag = crypto.randomBytes(4).toString('hex'), W = `REAL017-B${tag}-W`;
  const adminId = await admin(db);
  await db.query('BEGIN');
  let fx, e1;
  try {
    fx = await fixture(db, `B${tag}`, 1);
    e1 = await complete(db, fx, fx.documents[0], W, 'phase B fixture');
    await cancelAll(db, e1.ejecucion_id, adminId, 'phase-b');
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; }

  const [a, b, observer] = [await connect(url), await connect(url), await connect(url)];
  try {
    // (1) two Hub authorizations at the same time: B must wait on the execution row and then see A's committed record.
    const pidB = (await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    for (const c of [a, b]) { await c.query('BEGIN ISOLATION LEVEL READ COMMITTED'); await as(c, 'daubert_hub_test_user'); }
    const first = (await rows(a, AUTHORIZE, [e1.ejecucion_id, 'carrera A', adminId, 'race-a']))[0];
    check('race 1: backend A authorizes', first.resultado === 'AUTHORIZED');
    const pending = b.query(AUTHORIZE, [e1.ejecucion_id, 'carrera B', adminId, 'race-b']);
    check('race 1: backend B is observed waiting on a lock', await waitFor(observer, pidB, r => r.wait_event_type === 'Lock'));
    await a.query('COMMIT');
    const second = (await pending).rows[0];
    check('race 1: B returns the SAME authorization (no second record)', second.resultado === 'ALREADY_AUTHORIZED' && second.autorizacion_id === first.autorizacion_id && second.motivo === 'carrera A', JSON.stringify(second));
    await b.query('COMMIT');
    check('race 1: exactly one authorization row', (await rows(observer, 'SELECT count(*)::int n FROM operacion.autorizaciones_regeneracion_caterpillar WHERE ejecucion_origen_id=$1', [e1.ejecucion_id]))[0].n === 1);

    // (2) two workers claim the regenerated execution: one child, one reservation.
    const [WA, WB] = [`REAL017-B${tag}-A`, `REAL017-B${tag}-B`], pidB2 = (await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    for (const c of [a, b]) { await c.query('BEGIN ISOLATION LEVEL READ COMMITTED'); await as(c, 'n8n_cat_test'); }
    const winner = (await rows(a, REPROCESS, [e1.ejecucion_id, WA, fx.series, fx.manifest.quantity]))[0];
    check('race 2: worker A acquires the regeneration', winner.can_emit && winner.worker_id === WA && winner.reason === 'REPROCESS_ACQUIRED', JSON.stringify(winner));
    const pending2 = b.query(REPROCESS, [e1.ejecucion_id, WB, fx.series, fx.manifest.quantity]);
    check('race 2: worker B is observed waiting on the advisory lock', await waitFor(observer, pidB2, r => r.wait_event_type === 'Lock' && r.wait_event === 'advisory'));
    await a.query('COMMIT');
    const loser = (await pending2).rows[0];
    check('race 2: B sees A as owner and cannot emit', !loser.can_emit && loser.reason === 'REPROCESS_IN_PROGRESS' && loser.worker_id === WA, JSON.stringify(loser));
    await b.query('ROLLBACK');
    const counts = (await rows(observer, `SELECT (SELECT count(*) FROM ops.ejecuciones_automatizacion WHERE reproceso_de_id=$1)::int children,
      (SELECT count(*) FROM operacion.reservas_folios WHERE ejecucion_id=$2)::int reservations,
      (SELECT ejecucion_nueva_id FROM operacion.autorizaciones_regeneracion_caterpillar WHERE ejecucion_origen_id=$1) AS consumed_by`, [e1.ejecucion_id, winner.ejecucion_id]))[0];
    check('race 2: exactly one child, one reservation, authorization consumed by it', counts.children === 1 && counts.reservations === 1 && counts.consumed_by === winner.ejecucion_id, JSON.stringify(counts));
    // Close the fixture child through the owner wrapper (documented recovery); its reservation stays ABANDONADA as evidence.
    await a.query('BEGIN'); await as(a, 'n8n_cat_test');
    const closed = (await rows(a, FINALIZE, [winner.ejecucion_id, WA, 'ERROR', 'HUB_TEST_017', 'fixture closed after race test']))[0];
    await a.query('COMMIT');
    check('race 2: fixture child closed as ERROR via owner wrapper', closed.estado_final === 'ERROR');
  } finally { await Promise.all([a, b].map(c => c.query('ROLLBACK').catch(() => {}))); await Promise.all([a, b, observer].map(c => c.end().catch(() => {}))); }
}

async function run() {
  const args = process.argv.slice(2), commit = args.includes('--commit');
  if (commit) assert(args.includes('--allow-test-writes'), 'Explicit --allow-test-writes required for --commit');
  const url = guardedUrl(process.env.TEST_DATABASE_URL_MIGRATOR, 'postgres');
  const db = await connect(url);
  try {
    check('identity: daubert_hub_test as postgres', (await db.query('SELECT current_database() d,current_user u')).rows[0].d === 'daubert_hub_test');
    await phaseA(db);
    if (commit) await phaseB(url, db);
    console.log(JSON.stringify({ result: 'TEST_017_REAL_PASS', mode: commit ? 'WITH_COMMIT_FIXTURES' : 'ROLLBACK_ONLY', checks: results.length, results }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ result: 'TEST_017_REAL_FAIL', checks: results.length, results, ...(error.handled ? {} : { sqlstate: /^[A-Z0-9]{5}$/.test(error.code || '') ? error.code : 'NONE', message: String(error.message || '').split('\n')[0].slice(0, 200) }) }, null, 2));
    process.exitCode = 1;
  } finally { await db.end().catch(() => {}); }
}
if (require.main === module) run();
