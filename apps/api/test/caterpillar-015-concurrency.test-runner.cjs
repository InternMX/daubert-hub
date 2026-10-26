// 5E: two-real-backend concurrency proof for the 015 admission gate. REQUIRES 015 ALREADY APPLIED in TEST.
// Never applies DDL. Default mode ROLLS BACK both transactions (no persistent write). --commit keeps worker A's
// acquisition so B must observe PROGRAM_IN_PROGRESS; it needs --allow-test-writes and leaves a PROCESANDO execution
// that must be resolved by the runbook (fixture only). Use an isolated fixture document/series, never operative folios.
//
//   TEST_DATABASE_URL_WORKER   postgres://n8n_cat_test:...@host/daubert_hub_test   (two backends: workers A and B)
//   TEST_DATABASE_URL_MIGRATOR postgres://postgres:...@host/daubert_hub_test       (observer only: pg_stat_activity)
//   node test/caterpillar-015-concurrency.test-runner.cjs --document <id> --series <serie> --quantity <n> [--commit --allow-test-writes]
const { Client } = require('pg');
const { assert, guardedUrl } = require('./support/caterpillar-cancellation-test-guards.cjs');

const GATE = 'SELECT * FROM ops.fn_admitir_reservar_caterpillar_test($1::bigint,$2::text,$3::text,$4::integer)';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function option(args, name) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function connect(url) {
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
  await client.connect();
  return client;
}

async function waitForAdvisoryWait(observer, pid, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await observer.query(
      "SELECT wait_event_type, wait_event FROM pg_stat_activity WHERE pid=$1 AND datname='daubert_hub_test'", [pid]);
    if (rows[0]?.wait_event_type === 'Lock' && rows[0].wait_event === 'advisory') return true;
    await sleep(100);
  }
  return false;
}

async function run(args = process.argv.slice(2), env = process.env) {
  const commit = args.includes('--commit');
  if (commit) assert(args.includes('--allow-test-writes'), 'Explicit --allow-test-writes authorization required for --commit');
  const document = Number(option(args, 'document'));
  const series = option(args, 'series');
  const quantity = Number(option(args, 'quantity'));
  assert(Number.isSafeInteger(document) && document > 0 && series && Number.isSafeInteger(quantity) && quantity > 0,
    'Usage: --document <id> --series <serie> --quantity <n>');
  const workerUrl = guardedUrl(env.TEST_DATABASE_URL_WORKER, 'n8n_cat_test');
  const observerUrl = guardedUrl(env.TEST_DATABASE_URL_MIGRATOR, 'postgres');
  assert(workerUrl.hostname === observerUrl.hostname && (workerUrl.port || '5432') === (observerUrl.port || '5432'), 'TEST URL server mismatch');

  const [a, b, observer] = [await connect(workerUrl), await connect(workerUrl), await connect(observerUrl)];
  const workers = { a: `CONC015-A-${Date.now()}`, b: `CONC015-B-${Date.now()}` };
  const result = { mode: commit ? 'COMMIT_FIXTURE' : 'ROLLBACK_ONLY' };
  try {
    const [pidA, pidB] = [(await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid, (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid];
    assert(pidA !== pidB, 'Two distinct PostgreSQL backends required');
    await a.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await b.query('BEGIN ISOLATION LEVEL READ COMMITTED');

    result.a = (await a.query(GATE, [document, workers.a, series, quantity])).rows[0];
    assert(result.a?.can_emit === true && result.a.worker_id === workers.a && result.a.reserva_id, 'Worker A did not acquire the programming');

    const pendingB = b.query(GATE, [document, workers.b, series, quantity]);
    result.bWaitedOnAdvisoryLock = await waitForAdvisoryWait(observer, pidB);
    assert(result.bWaitedOnAdvisoryLock, 'Worker B was not observed waiting on the advisory lock while A held it');

    if (commit) {
      await a.query('COMMIT');
      result.b = (await pendingB).rows[0];
      assert(result.b.can_emit === false && result.b.reason === 'PROGRAM_IN_PROGRESS' && result.b.worker_id === workers.a, 'B must be blocked by A ownership');
      await b.query('ROLLBACK');
      const { rows } = await observer.query(
        `SELECT (SELECT count(*)::int FROM ops.ejecuciones_automatizacion WHERE documento_origen_id=$1 AND estado='PROCESANDO') AS processing,
                (SELECT count(*)::int FROM operacion.reservas_folios WHERE ejecucion_id=$2) AS reservations`, [document, result.a.ejecucion_id]);
      assert(rows[0].processing === 1 && rows[0].reservations === 1, 'Expected exactly one owner execution and one reservation');
      result.persisted = { ...rows[0], ejecucion_id: result.a.ejecucion_id, note: 'Resolve via runbook; not auto-cleaned' };
    } else {
      await a.query('ROLLBACK');
      result.b = (await pendingB).rows[0];
      assert(result.b.can_emit === true && result.b.worker_id === workers.b, 'B must acquire after A rolled back');
      await b.query('ROLLBACK');
    }
    console.log(JSON.stringify({ result: 'TEST_015_CONCURRENCY_PASS', ...result }, null, 2));
  } finally {
    await Promise.all([a, b].map(c => c.query('ROLLBACK').catch(() => {})));
    await Promise.all([a, b, observer].map(c => c.end().catch(() => {})));
  }
}

if (require.main === module) run().catch(error => {
  console.error('TEST_015_CONCURRENCY_FAILED:', /^[\w .,:;()/=<>'-]{1,160}$/.test(error.message || '') && !/postgres(ql)?:\/\//.test(error.message) ? error.message : 'RAW_ERROR_SUPPRESSED');
  process.exitCode = 1;
});
module.exports = { run, GATE };
