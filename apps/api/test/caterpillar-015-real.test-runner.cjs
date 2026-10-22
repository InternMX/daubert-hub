// REAL PostgreSQL TEST validation of 015 (snapshot capture, atomic admission, reprocess, wrappers, bypass, two-backend concurrency).
// Uses ONLY TEST_DATABASE_URL_MIGRATOR (postgres@daubert_hub_test) and impersonates the worker with SET LOCAL ROLE n8n_cat_test, so no worker password is needed.
//   Phase A  : one transaction with throw-away fixtures and EVERY scenario, ALWAYS rolled back (no row, folio or counter survives).
//   Phase B  : two real backends. Fixtures (identifiable HUB_TEST_015_* document/series/route) are COMMITTED; the contention itself is rolled back.
//   Phase C  : only with --commit --allow-test-writes: the winner COMMITs so the loser must see PROGRAM_IN_PROGRESS; the fixture execution is then closed as ERROR through the owner wrapper.
const { Client } = require('pg');
const crypto = require('node:crypto');
const path = require('node:path');
const { assert, guardedUrl } = require('./support/caterpillar-cancellation-test-guards.cjs');
const { createCaterpillarManifestV1 } = require('../../../n8n/workflows/remisiones-caterpillar/candidate-5678/manifest-v1.generated.cjs');
const items = require('./fixtures/caterpillar-normalized-items.json').normal;
const { adaptCaterpillarNormalizedItems } = createCaterpillarManifestV1();

const GATE = 'SELECT * FROM ops.fn_admitir_reservar_caterpillar_test($1::bigint,$2::text,$3::text,$4::integer)';
const REPROCESS = 'SELECT * FROM ops.fn_reprocesar_reservar_caterpillar_test($1::bigint,$2::text,$3::text,$4::integer)';
const SAVE = 'SELECT ops.fn_guardar_snapshot_caterpillar_test($1::bigint,$2::text) AS s';
const results = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, ok, detail) => { results.push({ name, pass: Boolean(ok), ...(ok ? {} : { detail: String(detail ?? '').slice(0, 300) }) }); if (!ok) throw Object.assign(new Error('CHECK_FAILED'), { handled: true }); };

async function connect(url) { const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 }); await client.connect(); return client; }
const as = (client, role) => client.query(`RESET ROLE; SET LOCAL ROLE ${role}`);
async function failing(client, sql, params, pattern) {           // expects an error and keeps the transaction usable
  await client.query('SAVEPOINT expected');
  try { await client.query(sql, params); await client.query('ROLLBACK TO SAVEPOINT expected'); return false; }
  catch (error) { await client.query('ROLLBACK TO SAVEPOINT expected'); return pattern.test(`${error.code} ${error.message}`); }
}
function manifestFor(tag, change = {}) {
  const normalized = items.map(item => ({ json: { ...item.json, cliente_grupo: `HUB_TEST_015_${tag}`, planta_codigo: 'FIX', subplanta_codigo: 'A', ...change } }));
  const { manifest } = adaptCaterpillarNormalizedItems(normalized);
  return { text: JSON.stringify(manifest), quantity: manifest.documents.length, processKey: manifest.scope.slice(0, 3).join('|') }; // exactly what the gate derives from the stored manifest
}
// Identifiable fixtures only: HUB_TEST_015_<tag> document, series and route. Caller decides whether the surrounding transaction is committed.
async function fixture(client, tag, documentCount = 1) {
  const base = (await client.query(`SELECT (SELECT automatizacion_id FROM ops.automatizaciones WHERE codigo='REMISIONES_CATERPILLAR') AS automation,
    (SELECT empresa_id FROM core.documentos WHERE documento_id=214) AS company,
    (SELECT empresa_cliente_id FROM ops.automatizacion_series_proceso ORDER BY ruta_id LIMIT 1) AS client`)).rows[0];
  assert(base.automation && base.company && base.client, 'Fixture prerequisites missing in TEST');
  const m = manifestFor(tag);
  const series = `HUB_TEST_015_${tag}`.toUpperCase();
  const serieId = (await client.query("INSERT INTO operacion.series_documentales(codigo,nombre,siguiente_folio,estatus) VALUES($1,$2,900000,'ACTIVA') RETURNING serie_id", [series, `HUB TEST 015 ${tag}`])).rows[0].serie_id;
  await client.query("INSERT INTO ops.automatizacion_series_proceso(automatizacion_id,llave_proceso,serie_id,empresa_cliente_id,estatus) VALUES($1,$2,$3,$4,'ACTIVA')", [base.automation, m.processKey, serieId, base.client]);
  const documents = [];
  for (let n = 1; n <= documentCount; n++) {
    documents.push((await client.query("INSERT INTO core.documentos(empresa_id,tipo_documento,nombre_archivo,ruta_archivo,hash_archivo,origen,estatus) VALUES($1,'PROGRAMACION_ENTREGA',$2,'HUB_TEST_015/NO_FILE',$3,'OTRO','ACTIVO') RETURNING documento_id",
      [base.company, `HUB_TEST_015_${tag}_${n}.xlsx`, crypto.randomBytes(16).toString('hex')])).rows[0].documento_id);
  }
  return { documents, series, manifest: m, serieId };
}
async function seq(fns) { const out = []; for (const fn of fns) out.push(await fn()); return out.every(Boolean); }
const rows = async (client, sql, params) => (await client.query(sql, params)).rows;

async function phaseA(admin) {
  const tag = crypto.randomBytes(4).toString('hex'), W = 'REAL015-WA', W2 = 'REAL015-WB', W3 = 'REAL015-WC';
  await admin.query('BEGIN');
  try {
    const fx = await fixture(admin, `A${tag}`, 3);
    const [d1, d2, d3] = fx.documents, m = fx.manifest, series = fx.series, m2 = manifestFor(`A${tag}`, { cantidad_numerica: 123 });
    await as(admin, 'n8n_cat_test');
    check('snapshot: initial capture', (await rows(admin, SAVE, [d1, m.text]))[0].s === 'STORED');
    check('snapshot: repeated capture is idempotent', (await rows(admin, SAVE, [d1, m.text]))[0].s === 'ALREADY_STORED');
    check('snapshot: different manifest is rejected without overwrite', (await rows(admin, SAVE, [d1, manifestFor(`A${tag}`, { cantidad_numerica: 987 }).text]))[0].s === 'CONFLICT');
    check('snapshot: nonexistent document rejected', await failing(admin, SAVE, [999999999, m.text], /SOURCE_NOT_FOUND|P0002/));
    check('snapshot: malformed manifest rejected', await failing(admin, SAVE, [d2, 'not json'], /SNAPSHOT_INVALID/));
    const historical = (await rows(admin, 'SELECT ops.fn_guardar_snapshot_caterpillar_test(214,$1) AS s', [m.text]))[0].s;
    check('snapshot: historical document 214 stays protected', historical === 'HISTORICAL_LOCKED', historical);
    check('gate: without snapshot nothing is admitted or reserved', (await rows(admin, GATE, [d2, W, series, m.quantity]))[0].reason === 'HISTORY_UNAVAILABLE');
    check('snapshot: second document captured', (await rows(admin, SAVE, [d2, m2.text]))[0].s === 'STORED');
    const first = (await rows(admin, GATE, [d1, W, series, m.quantity]))[0];
    check('gate: first emission admitted with owner and range', first.decision === 'ADMIT' && first.reason === 'ACQUIRED' && first.can_emit && first.worker_id === W && first.cantidad === m.quantity, JSON.stringify(first));
    check('gate: same worker retry returns the same execution/reservation', (await rows(admin, GATE, [d1, W, series, m.quantity]))[0].reserva_id === first.reserva_id);
    const other = (await rows(admin, GATE, [d1, W2, series, m.quantity]))[0];
    check('gate: second worker has no right to emit', !other.can_emit && other.reason === 'PROGRAM_IN_PROGRESS');
    check('gate: quantity mismatch rejected atomically', await failing(admin, GATE, [d2, W, series, m.quantity + 1], /QUANTITY_MISMATCH/));
    check('gate: unrelated series rejected', await failing(admin, GATE, [d2, W, 'HUB_TEST_015_NO_SUCH', m.quantity], /ROUTE_NOT_ALLOWED/));
    check('wrapper: foreign worker cannot register', await failing(admin, 'SELECT * FROM operacion.fn_registrar_remision_caterpillar_test($1,$2,$3,$4,$5,$6,$7::jsonb)', [first.ejecucion_id, W2, series, first.folio_inicial, '2026-10-22', 'HUB_TEST_015/NO_FILE/x.pdf', '[]'], /NOT_OWNER|42501/));
    for (let n = 0; n < m.quantity; n++) await admin.query('SELECT * FROM operacion.fn_registrar_remision_caterpillar_test($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [first.ejecucion_id, W, series, Number(first.folio_inicial) + n, '2026-10-22', `HUB_TEST_015/NO_FILE/${n}.pdf`, '[{"codigo_interno":"FIX","cantidad_texto":"1 pieza"}]']);
    const repeat = (await rows(admin, 'SELECT * FROM operacion.fn_registrar_remision_caterpillar_test($1,$2,$3,$4,$5,$6,$7::jsonb)', [first.ejecucion_id, W, series, first.folio_inicial, '2026-10-22', 'HUB_TEST_015/NO_FILE/0.pdf', '[{"codigo_interno":"FIX","cantidad_texto":"1 pieza"}]']))[0];
    check('wrapper: repeated registration is idempotent', repeat.ya_existia === true);
    check('wrapper: foreign worker cannot finalize', await failing(admin, 'SELECT * FROM ops.fn_finalizar_caterpillar_test($1,$2,$3)', [first.ejecucion_id, W2, 'COMPLETADA'], /NOT_OWNER|42501/));
    const done = (await rows(admin, 'SELECT * FROM ops.fn_finalizar_caterpillar_test($1,$2,$3)', [first.ejecucion_id, W, 'COMPLETADA']))[0];
    check('wrapper: finalization COMPLETADA applies the reservation', done.estado_final === 'COMPLETADA' && done.reservas_aplicadas === 1, JSON.stringify(done));
    check('gate: emitted program is not emitted again', (await rows(admin, GATE, [d1, W3, series, m.quantity]))[0].reason === 'PROGRAM_ALREADY_EMITTED');
    check('reprocess: COMPLETADA parent rejected', (await rows(admin, REPROCESS, [first.ejecucion_id, W3, series, m.quantity]))[0].reason === 'PARENT_NOT_REPROCESSABLE');
    check('snapshot: renamed copy with equivalent content captured', (await rows(admin, SAVE, [d3, m.text]))[0].s === 'STORED');
    const renamed = (await rows(admin, GATE, [d3, W3, series, m.quantity]))[0];
    check('gate: different name with identical V1 content goes to review without folios', !renamed.can_emit && renamed.reason === 'MANIFEST_MATCH_REVIEW' && !renamed.reserva_id, JSON.stringify(renamed));
    const second = (await rows(admin, GATE, [d2, W, series, m.quantity]))[0];
    check('gate: new name with different content is admitted', second.can_emit && second.reason === 'ACQUIRED', JSON.stringify(second));
    await admin.query('SELECT * FROM ops.fn_finalizar_caterpillar_test($1,$2,$3,$4,$5)', [second.ejecucion_id, W, 'ERROR', 'HUB_TEST_015', 'synthetic fixture failure']);
    const child = (await rows(admin, REPROCESS, [second.ejecucion_id, W2, series, m.quantity]))[0];
    check('reprocess: ERROR parent creates one child with NEW folios and owner', child.reason === 'REPROCESS_ACQUIRED' && child.can_emit && child.worker_id === W2 && Number(child.folio_inicial) > Number(second.folio_final), JSON.stringify(child));
    check('reprocess: repeated request by another worker is not an emission', (await rows(admin, REPROCESS, [second.ejecucion_id, W3, series, m.quantity]))[0].reason === 'REPROCESS_IN_PROGRESS');
    check('reprocess: same worker retry reuses the reservation', (await rows(admin, REPROCESS, [second.ejecucion_id, W2, series, m.quantity]))[0].reserva_id === child.reserva_id);
    check('reprocess: historical parent without snapshot refused', (await rows(admin, REPROCESS, [117, W2, series, m.quantity]))[0].reason === 'REPROCESS_SNAPSHOT_REQUIRED');
    check('bypass: worker cannot call any legacy function', await seq([
      () => failing(admin, "SELECT * FROM ops.fn_crear_ejecucion_automatizacion('REMISIONES_CATERPILLAR',$1,'X',NULL,NULL)", [d3], /42501|permission denied/),
      () => failing(admin, "SELECT * FROM operacion.reservar_folios_para_ejecucion(1,'X',1)", [], /42501|permission denied/),
      () => failing(admin, "SELECT * FROM operacion.fn_registrar_remision_generada(1,'X',1,CURRENT_DATE,'x','[]'::jsonb)", [], /42501|permission denied/),
      () => failing(admin, "SELECT * FROM ops.fn_finalizar_ejecucion_automatizacion(1,'ERROR',NULL,NULL)", [], /42501|permission denied/),
      () => failing(admin, "SELECT * FROM ops.fn_registrar_fallo_ejecucion(1,'X','n','e')", [], /42501|permission denied/)]));
    check('bypass: worker has no direct DML on documents or folios', await seq([
      () => failing(admin, "UPDATE core.documentos SET caterpillar_admission='{}'::jsonb WHERE documento_id=$1", [d3], /42501|permission denied/),
      () => failing(admin, 'UPDATE operacion.series_documentales SET siguiente_folio=1 WHERE serie_id=$1', [fx.serieId], /42501|permission denied/),
      () => failing(admin, 'DELETE FROM operacion.remisiones', [], /42501|permission denied/)]));
    await as(admin, 'daubert_hub_test_user');
    check('bypass: Hub role cannot capture, admit or reprocess', await seq([
      () => () => failing(admin, SAVE, [d3, m.text], /42501|permission denied/), () => failing(admin, GATE, [d3, 'api', series, m.quantity], /42501|permission denied/),
      () => failing(admin, REPROCESS, [second.ejecucion_id, 'api', series, m.quantity], /42501|permission denied/)]));
  } finally { await admin.query('ROLLBACK').catch(() => {}); }
  const left = (await admin.query("SELECT (SELECT count(*) FROM core.documentos WHERE nombre_archivo LIKE 'HUB_TEST_015_A%')::int d, (SELECT count(*) FROM operacion.series_documentales WHERE codigo LIKE 'HUB_TEST_015_A%')::int s")).rows[0];
  check('phase A rolled back completely (no fixture survives)', left.d === 0 && left.s === 0, JSON.stringify(left));
}

async function committedFixture(admin, tag) {
  await admin.query('BEGIN');
  try {
    const fx = await fixture(admin, tag, 1);
    await as(admin, 'n8n_cat_test');
    check(`phase B fixture ${tag}: snapshot stored`, (await rows(admin, SAVE, [fx.documents[0], fx.manifest.text]))[0].s === 'STORED');
    await admin.query('COMMIT');
    return fx;
  } catch (error) { await admin.query('ROLLBACK').catch(() => {}); throw error; }
}
async function waitAdvisory(observer, pid) {
  for (let i = 0; i < 100; i++) {
    const r = (await observer.query("SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1 AND datname='daubert_hub_test'", [pid])).rows[0];
    if (r?.wait_event_type === 'Lock' && r.wait_event === 'advisory') return true;
    await sleep(100);
  }
  return false;
}
async function contention(url, fx, label, commit) {
  const [a, b, observer] = [await connect(url), await connect(url), await connect(url)];
  const [WA, WB] = [`REAL015-${label}-A`, `REAL015-${label}-B`], doc = fx.documents[0], q = fx.manifest.quantity;
  try {
    const pidB = (await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    for (const c of [a, b]) { await c.query('BEGIN ISOLATION LEVEL READ COMMITTED'); await as(c, 'n8n_cat_test'); }
    const winner = (await a.query(GATE, [doc, WA, fx.series, q])).rows[0];
    check(`${label}: backend A acquires`, winner.can_emit && winner.worker_id === WA);
    const pending = b.query(GATE, [doc, WB, fx.series, q]);
    check(`${label}: backend B is observed waiting on the advisory lock`, await waitAdvisory(observer, pidB));
    await a.query(commit ? 'COMMIT' : 'ROLLBACK');
    const loser = (await pending).rows[0];
    if (commit) {
      check(`${label}: B sees A's ownership and cannot emit`, !loser.can_emit && loser.reason === 'PROGRAM_IN_PROGRESS' && loser.worker_id === WA, JSON.stringify(loser));
      await b.query('ROLLBACK');
      const counts = (await observer.query("SELECT (SELECT count(*) FROM ops.ejecuciones_automatizacion WHERE documento_origen_id=$1)::int e,(SELECT count(*) FROM operacion.reservas_folios WHERE ejecucion_id=$2)::int r", [doc, winner.ejecucion_id])).rows[0];
      check(`${label}: exactly one execution and one reservation persisted`, counts.e === 1 && counts.r === 1, JSON.stringify(counts));
      // Close the fixture execution through the owner wrapper (documented recovery); the reservation is kept as ABANDONADA evidence.
      await a.query('BEGIN'); await as(a, 'n8n_cat_test');
      const closed = (await a.query('SELECT * FROM ops.fn_finalizar_caterpillar_test($1,$2,$3,$4,$5)', [winner.ejecucion_id, WA, 'ERROR', 'HUB_TEST_015', 'fixture closed after contention test'])).rows[0];
      await a.query('COMMIT');
      check(`${label}: fixture execution closed as ERROR via owner wrapper`, closed.estado_final === 'ERROR', JSON.stringify(closed));
    } else {
      check(`${label}: after A rolled back, B acquires (no stale ownership)`, loser.can_emit && loser.worker_id === WB, JSON.stringify(loser));
      await b.query('ROLLBACK');
      const none = (await observer.query('SELECT count(*)::int n FROM ops.ejecuciones_automatizacion WHERE documento_origen_id=$1', [doc])).rows[0].n;
      check(`${label}: nothing persisted`, none === 0, none);
    }
  } finally { await Promise.all([a, b].map(c => c.query('ROLLBACK').catch(() => {}))); await Promise.all([a, b, observer].map(c => c.end().catch(() => {}))); }
}

async function run() {
  const args = process.argv.slice(2), commit = args.includes('--commit');
  if (commit) assert(args.includes('--allow-test-writes'), 'Explicit --allow-test-writes required for --commit');
  const url = guardedUrl(process.env.TEST_DATABASE_URL_MIGRATOR, 'postgres');
  const admin = await connect(url);
  try {
    check('identity: daubert_hub_test as postgres', (await admin.query('SELECT current_database() d,current_user u')).rows[0].d === 'daubert_hub_test');
    await phaseA(admin);
    const tag = crypto.randomBytes(4).toString('hex');
    const fxRollback = await committedFixture(admin, `B${tag}`);
    await contention(url, fxRollback, 'rollback-contention', false);
    if (commit) { const fxCommit = await committedFixture(admin, `C${tag}`); await contention(url, fxCommit, 'commit-contention', true); }
    console.log(JSON.stringify({ result: 'TEST_015_REAL_PASS', mode: commit ? 'WITH_COMMIT_FIXTURES' : 'ROLLBACK_CONTENTION', checks: results.length, results }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ result: 'TEST_015_REAL_FAIL', checks: results.length, results, ...(error.handled ? {} : { sqlstate: /^[A-Z0-9]{5}$/.test(error.code || '') ? error.code : 'NONE', message: /^[\w .,:;()/=<>'-]{1,200}$/.test(error.message || '') ? error.message : 'RAW_ERROR_SUPPRESSED' }) }, null, 2));
    process.exitCode = 1;
  } finally { await admin.end().catch(() => {}); }
}
if (require.main === module) run();
module.exports = { manifestFor };
