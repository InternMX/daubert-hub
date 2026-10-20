const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { createAuthenticatedTestSession, cleanupAuthenticatedTestSession } = require('./support/test-auth.cjs');

const marker = 'HUB_TEST_FILE_ASSIGNMENTS_V1';
const port = 3117;
const assert = (value, message) => { if (!value) throw new Error(message); };

async function run() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value || decodeURIComponent(new URL(value).pathname).slice(1) !== 'daubert_hub_test') throw new Error('TEST_DATABASE_URL must target daubert_hub_test');
  const url = new URL(value);
  const pool = new Pool({ connectionString: value });
  let api; let auth; let cookie; let startup = '';
  const received = [];
  const fakeN8n = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    received.push(String(JSON.parse(text).correo_id));
    res.writeHead(202, { 'content-type': 'application/json' }); res.end('{}');
  });
  await new Promise((done) => fakeN8n.listen(0, '127.0.0.1', done));
  const fakePort = fakeN8n.address().port;
  async function stop() {
    if (api) { const child = api; api = null; child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), new Promise((done) => setTimeout(done, 3000))]); }
  }
  async function start(enabled) {
    await stop(); startup = '';
    // Check the REAL destination before EACH API launch. No production credential/config loaded.
    assert((await pool.query('SELECT current_database() AS name')).rows[0].name === 'daubert_hub_test', 'Live DB is not TEST');
    console.log(`Verified live daubert_hub_test BEFORE API startup (point feature ${enabled}).`);
    api = spawn(process.execPath, ['dist/src/main.js'], { cwd: process.cwd(), env: { ...process.env,
      DB_HOST: url.hostname, DB_PORT: url.port || '5432', DB_NAME: 'daubert_hub_test', DB_USER: decodeURIComponent(url.username), DB_PASSWORD: decodeURIComponent(url.password),
      EXPECTED_DATABASE_NAME: 'daubert_hub_test', NODE_ENV: 'test', AUTH_COOKIE_SECURE: 'false', API_PORT: String(port),
      PAYMENT_FILE_ASSIGNMENTS_TEST_ENABLED: String(enabled),
      PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL: `http://127.0.0.1:${fakePort}/synthetic-only`, PAYMENT_NOTIFICATIONS_WEBHOOK_TOKEN: 'synthetic-test-only',
      CATERPILLAR_REPROCESS_WEBHOOK_URL: '', CATERPILLAR_REPROCESS_WEBHOOK_TOKEN: '', N8N_HEALTH_WEBHOOK_URL: '', N8N_HEALTH_WEBHOOK_TOKEN: ''
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    api.stdout.on('data', (data) => { startup += data; }); api.stderr.on('data', (data) => { startup += data; });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch { /* starting */ }
      await new Promise((done) => setTimeout(done, 150));
    }
    throw new Error('TEST API did not start');
  }
  async function request(path, method = 'GET', body, extra = {}, authenticated = true) {
    const res = await fetch(`http://127.0.0.1:${port}/api${path}`, { method,
      headers: { ...(authenticated && cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...extra },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json().catch(() => null), requestId: res.headers.get('x-request-id') };
  }
  try {
    assert((await pool.query('SELECT current_database() AS name')).rows[0].name === 'daubert_hub_test', 'Wrong live DB');
    const mailRows = (await pool.query('SELECT correo_id::text AS id, outlook_message_id AS label FROM core.correos_notificacion_pago WHERE outlook_message_id LIKE $1', [`${marker}_%`])).rows;
    assert(mailRows.length === 22, 'Apply the administrative synthetic fixtures before integration');
    const mails = Object.fromEntries(mailRows.map((row) => [row.label.slice(marker.length + 1), row.id]));
    const companies = (await pool.query('SELECT empresa_id::text AS id FROM core.empresas WHERE nombre_comercial LIKE $1 ORDER BY nombre_comercial', [`${marker}_COMPANY_%`])).rows;
    assert(companies.length === 3, 'Synthetic companies missing');
    assert((await pool.query(`SELECT count(*)::int AS n FROM core.asignaciones_archivo_notificacion_pago a JOIN core.archivos_notificacion_pago f USING (archivo_id) WHERE f.correo_id = ANY($1::bigint[])`, [mailRows.map((row) => row.id)])).rows[0].n === 0, 'This fixture set was already used; do not overwrite it automatically');
    const aliasBaseline = (await pool.query('SELECT count(*)::int AS n FROM core.alias_empresa WHERE empresa_id = ANY($1::bigint[])', [companies.map((company) => company.id)])).rows[0].n;
    await start(false);
    auth = await createAuthenticatedTestSession(`http://127.0.0.1:${port}/api`, `HUB_TEST_POINT_${randomUUID().replace(/-/g, '')}`);
    cookie = auth.cookie;
    const detail = async (key) => {
      const res = await request(`/automations/payment-notifications/${mails[key]}`);
      assert(res.status === 200, `Detail failed for ${key}`); return res.body.data;
    };
    const disabled = await detail('SAFE01');
    assert(disabled.fileErrorDetails[0].fileAssignment.enabled === false && disabled.fileErrorDetails[0].fileAssignment.canManage === false, 'Disabled feature exposed an action');
    const fileId = disabled.fileErrorDetails[0].fileAssignment.fileId;
    const route = (key, id) => `/automations/payment-notifications/${mails[key]}/files/${id}/assignment`;
    const assign = (companyId, expectedVersion = 0) => ({ action: 'ASSIGN', companyId, expectedVersion, confirmed: true });
    assert((await request(route('SAFE01', fileId), 'PATCH', assign(companies[0].id))).status === 403, 'Default-disabled backend accepted a mutation');
    await start(true);
    assert((await request(route('SAFE01', fileId), 'PATCH', assign(companies[0].id), {}, false)).status === 401, 'Authentication bypass');
    assert((await request(route('SAFE01', fileId), 'PATCH', assign(companies[0].id), { origin: 'https://untrusted.example.test' })).status === 403, 'CSRF bypass');
    assert((await request(route('SAFE01', fileId), 'PATCH', { ...assign(companies[0].id), fileHash: 'a'.repeat(64) })).status === 400, 'Frontend hash accepted');
    assert((await request(route('SAFE01', fileId), 'PATCH', { ...assign(companies[0].id), confirmed: false })).status === 400, 'Missing confirmation accepted');
    const created = await request(route('SAFE01', fileId), 'PATCH', assign(companies[0].id));
    assert(created.status === 200 && created.body.data.version === 1, 'Point assignment creation failed');
    let reopened = await detail('SAFE01');
    assert(reopened.fileErrorDetails[0].fileAssignment.assignment.companyId === companies[0].id, 'Assignment not persistent');
    assert(reopened.fileErrorDetails[0].errorCode === 'ALIAS_NO_CATALOGADO' && reopened.processingStatus === 'ERROR', 'Historical payment state changed');
    assert(reopened.fileAttentionSummary.total === 2 && reopened.fileAttentionSummary.assignedPending === 1 && reopened.fileAttentionSummary.unassigned === 1 && reopened.fileAttentionSummary.pointPending === 1, 'Persisted attention summary is incorrect');
    assert(reopened.reprocessAvailable === false, 'UI eligibility ignores active point assignments');
    const reprocess = (key) => request(`/automations/payment-notifications/${mails[key]}/reprocess`, 'POST');
    assert((await reprocess('SAFE01')).status === 409 && received.length === 0, 'Premature n8n dispatch');
    const changed = await request(route('SAFE01', fileId), 'PATCH', { action: 'CHANGE', companyId: companies[1].id, expectedVersion: 1, confirmed: true });
    assert(changed.status === 200 && changed.body.data.version === 2, 'Reassignment failed');
    assert((await request(route('SAFE01', fileId), 'PATCH', { action: 'REVOKE', expectedVersion: 1, confirmed: true })).status === 409, 'Stale snapshot accepted');
    const revoked = await request(route('SAFE01', fileId), 'PATCH', { action: 'REVOKE', expectedVersion: 2, confirmed: true });
    assert(revoked.status === 200 && revoked.body.data.status === 'REVOCADA' && revoked.body.data.version === 3, 'Revocation failed');
    assert((await detail('SAFE01')).fileAttentionSummary.unassigned === 2, 'Revoked assignment still counted as active');
    assert((await request(route('SAFE01', fileId), 'PATCH', assign(companies[0].id, 3))).status === 200, 'Controlled reactivation failed');
    const another = await detail('SAFE02');
    const anotherId = another.fileErrorDetails[0].fileAssignment.fileId;
    assert(anotherId !== fileId && another.fileErrorDetails[0].fileHash === reopened.fileErrorDetails[0].fileHash, 'Same bytes across correos collapsed');
    assert((await request(route('SAFE02', fileId), 'PATCH', assign(companies[2].id))).status === 404, 'Cross-correo file ID accepted');
    assert((await request(route('SAFE02', anotherId), 'PATCH', assign(companies[2].id))).status === 200, 'Independent occurrence assignment failed');
    const third = await detail('SAFE03');
    assert((await request(route('SAFE03', third.fileErrorDetails[0].fileAssignment.fileId), 'PATCH', assign('9223372036854775807'))).status === 404, 'Nonexistent company accepted');
    for (const key of ['UNKNOWN','UNVERIFIED','DUPLICATE','CONFLICT','CHANGED_ZIP','RESULT_EFFECT','DRAFT_EFFECT','STARTED','PENDING','LEGACY']) {
      const row = await detail(key);
      const state = row.fileErrorDetails[0].fileAssignment;
      assert(!state.canManage && state.blockedReason, `Unsafe ${key} exposed an action`);
      const id = state.fileId || (await pool.query('SELECT archivo_id::text AS id FROM core.archivos_notificacion_pago WHERE correo_id=$1 ORDER BY archivo_id LIMIT 1', [mails[key]])).rows[0]?.id;
      if (id) assert((await request(route(key, id), 'PATCH', assign(companies[0].id))).status === 409, `Unsafe ${key} mutation accepted`);
    }
    let denied = false;
    try { await pool.query(`SELECT core.fn_registrar_archivo_notificacion_pago($1, 'FORGED', repeat('a',64), 0, repeat('b',64), 'forged.pdf')`, [mails.SAFE03]); }
    catch (error) { denied = error.code === '42501'; }
    assert(denied, 'API database role can manufacture trusted identities');
    const race = await detail('SAFE04'); const raceId = race.fileErrorDetails[0].fileAssignment.fileId;
    const results = await Promise.all([request(route('SAFE04', raceId), 'PATCH', assign(companies[0].id)), request(route('SAFE04', raceId), 'PATCH', assign(companies[1].id))]);
    assert(results.map((r) => r.status).sort().join(',') === '200,409', 'Concurrent assignment has multiple winners');
    const dispatchRace = await detail('SAFE05'); const dispatchId = dispatchRace.fileErrorDetails[0].fileAssignment.fileId;
    const simultaneous = await Promise.all([request(route('SAFE05', dispatchId), 'PATCH', assign(companies[0].id)), reprocess('SAFE05')]);
    const activeRace = (await detail('SAFE05')).fileErrorDetails[0].fileAssignment.assignment?.status === 'ACTIVA';
    assert(!(activeRace && received.includes(mails.SAFE05)), 'Race allowed assignment and dispatch together');
    assert(simultaneous.some((r) => r.status === 409), 'Race did not block the losing operation');
    const audit = (await pool.query(`SELECT tabla, operacion, usuario_id, datos_anteriores, datos_nuevos FROM audit.cambios WHERE request_id = $1`, [changed.requestId])).rows;
    assert(audit.length === 1 && audit[0].tabla === 'asignaciones_archivo_notificacion_pago' && audit[0].operacion === 'UPDATE' && audit[0].usuario_id === auth.userId && String(audit[0].datos_anteriores.empresa_id) === companies[0].id && String(audit[0].datos_nuevos.empresa_id) === companies[1].id, 'Assignment audit lost actor or history');
    assert((await pool.query('SELECT count(*)::int AS n FROM core.alias_empresa WHERE empresa_id = ANY($1::bigint[])', [companies.map((company) => company.id)])).rows[0].n === aliasBaseline, 'Point operations modified permanent aliases');
    const permanent = await request(`/companies/${companies[1].id}/aliases/payment-notifications`, 'POST', { alias: 'SYNTHETIC ALIAS A', confirmPermanent: true });
    assert(permanent.status === 201, 'Permanent alias path regressed');
    assert((await detail('SAFE06')).fileAttentionSummary.assignedPending === 1, 'Summary ignores permanent catalog');
    assert((await reprocess('SAFE06')).status === 202 && received.includes(mails.SAFE06), 'Normal synthetic dispatch to local mock regressed');
    // No real processing occurred: the mock only accepts HTTP and writes no payment results.
    assert((await detail('SAFE06')).processingStatus === 'ERROR', 'Local mock unexpectedly processed a correo');
    const frozen = (await detail('SAFE06')).fileErrorDetails[0].fileAssignment;
    assert(frozen.operationalState === 'REPROCESO_SOLICITADO' && !frozen.canManage, 'Dispatcher did not freeze against late assignment');
    await start(false);
    reopened = await detail('SAFE01');
    assert(reopened.fileErrorDetails[0].fileAssignment.assignment.status === 'ACTIVA' && !reopened.fileErrorDetails[0].fileAssignment.canManage, 'Disabled flag hid current truth or allowed mutations');
    assert((await reprocess('SAFE01')).status === 409 && !received.includes(mails.SAFE01), 'Disabled feature bypassed premature reproccess protection');
    console.log('PASS: identity, ambiguity, persistence/reopen, change/revoke, authorization/CSRF, audit, concurrency, summary and guarded/mock-only dispatch.');
    console.log('Synthetic fixtures retained for visual review; no real n8n/Outlook calls and no prior TEST user cleanup.');
  } catch (error) {
    console.error(`TEST verification failed: ${error.message}`);
    // Startup output contains no credentials; print only fatal categories, not raw config.
    console.error(startup.includes('Nest application successfully started') ? 'TEST API started.' : 'TEST API startup did not complete.');
    throw error;
  } finally {
    await stop(); await new Promise((done) => fakeN8n.close(done));
    await cleanupAuthenticatedTestSession(auth); await pool.end();
  }
}
run().catch(() => { process.exitCode = 1; });
