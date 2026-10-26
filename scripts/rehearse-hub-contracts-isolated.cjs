#!/usr/bin/env node
'use strict';

// ISOLATED check that the Hub images (previous = production build, candidate = new build) work against the database BEFORE and AFTER migrations 013 -> 016/017.
//   node scripts/rehearse-hub-contracts-isolated.cjs --backup <prod .dump> --old <image tag> --new <image tag> [--new <another image tag>]
// A throw-away PostgreSQL container (own name and port, random passwords) receives the backup of daubert_global; each image's REAL compiled
// CaterpillarExecutionsRepository runs inside that image against it as the production Hub role (daubert_hub_app). Nothing here touches the production
// PostgreSQL (5432), the isolated rehearsal instance (55432), production containers, n8n or Dropbox. At the end it only STOPS its own container.
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BIN = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const MIGRATIONS = path.resolve(__dirname, '..', 'database', 'migrations', 'daubert_global');
const CONTAINER = 'daubert-hub-rbtest-pg2-' + crypto.randomBytes(3).toString('hex');   // unique per run: earlier (stopped) containers are never reused or removed
const PORT = 55434;
const ROLES = [['daubert_backup', 2, true], ['daubert_docs_ro', -1, true], ['daubert_hub_app', -1, true], ['daubert_hub_test_user', -1, true], ['n8n_app', -1, true], ['n8n_app_test', 10, false], ['n8n_cat_test', 5, true]];
const results = [];
const check = (name, ok, detail) => { results.push({ name, pass: Boolean(ok), ...(ok ? {} : { detail: String(detail ?? '').slice(0, 400) }) }); if (!ok) throw Object.assign(new Error('CHECK_FAILED'), { check: name }); };
const arg = flag => { const values = []; process.argv.forEach((v, i) => { if (v === flag) values.push(process.argv[i + 1]); }); return values; };

const superPassword = crypto.randomBytes(12).toString('hex');
const hubPassword = crypto.randomBytes(12).toString('hex');
const workerPassword = crypto.randomBytes(12).toString('hex');
const sh = (command, args, env = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
};
const psql = (args, extraEnv = {}) => sh(path.join(BIN, 'psql.exe'), ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(PORT), '-U', 'postgres', '--no-password', ...args], { PGPASSWORD: superPassword, ...extraEnv });
const sql = (database, text) => psql(['-d', database, '-c', text]);
const file = (name, vars = {}) => {
  const args = ['-d', 'daubert_global'];
  for (const [key, value] of Object.entries(vars)) args.push('-v', `${key}=${value}`);
  args.push('-f', path.join(MIGRATIONS, name));
  return psql(args);
};

// Runs inside the Hub image: the real repository, a pg pool as daubert_hub_app, only the methods that exist in that build.
const PROBE = `
const { Pool } = require('pg');
const crypto = require('node:crypto');
const { CaterpillarExecutionsRepository } = require('/app/apps/api/dist/src/automations/remisiones-caterpillar/caterpillar-executions.repository.js');
const pool = new Pool({ host: 'host.docker.internal', port: Number(process.env.P_PORT), database: 'daubert_global', user: 'daubert_hub_app', password: process.env.P_PASS });
const repo = new CaterpillarExecutionsRepository({ query: async (text, values) => (values ? await pool.query(text, values) : await pool.query(text)).rows, connect: () => pool.connect() });
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
const out = {};
const attempt = async (name, fn) => {
  if (typeof repo[name] !== 'function') { out[name] = { present: false }; return; }
  try { const value = await fn(); out[name] = { present: true, ok: true, digest: digest(value), shape: Array.isArray(value) ? 'array:' + value.length : value === null ? 'null' : typeof value === 'object' ? 'object:' + Object.keys(value).sort().join(',') : typeof value, value: name === 'findRegenerationContext' ? value : undefined }; return value; }
  catch (error) { out[name] = { present: true, ok: false, code: error.code || null, message: String(error.message).split('\\n')[0].slice(0, 160) }; }
};
(async () => {
  const executionId = process.env.P_EXECUTION;
  await attempt('list', () => repo.list(1, 50));
  await attempt('findById', () => repo.findById(executionId));
  const remissions = (await attempt('findRemissionsByExecutionId', () => repo.findRemissionsByExecutionId(executionId))) || [];
  await attempt('findReservationsByExecutionId', () => repo.findReservationsByExecutionId(executionId));
  await attempt('findDetailsByRemisionIds', () => repo.findDetailsByRemisionIds(remissions.map(r => r.remision_id).filter(Boolean)));
  await attempt('findCancellationAuditsByExecutionId', () => repo.findCancellationAuditsByExecutionId(executionId));
  await attempt('findRegenerationContext', () => repo.findRegenerationContext(executionId));
  if (process.env.P_WRITES === '1') {
    await attempt('authorizeRegeneration', () => repo.authorizeRegeneration(executionId, 'rehearsal: expected refusal, remissions are not cancelled', process.env.P_ADMIN, 'rehearsal-' + Date.now()));
    await attempt('cancelRemission', () => repo.cancelRemission(executionId, String((remissions[0] || {}).remision_id || '0'), { expectedRevision: '2000-01-01T00:00:00.000000Z', reason: 'rehearsal: expected conflict' }, process.env.P_ADMIN, 'rehearsal-' + Date.now()));
  }
  await pool.end();
  console.log(JSON.stringify(out));
})().catch(error => { console.log(JSON.stringify({ fatal: String(error.message).slice(0, 200) })); process.exit(1); });
`;

function probe(image, { writes = false, adminId = '', executionId }) {
  const probeFile = path.join(os.tmpdir(), `hub-probe-${crypto.randomBytes(4).toString('hex')}.cjs`);
  fs.writeFileSync(probeFile, PROBE);
  try {
    const run = sh('docker', ['run', '--rm', '--add-host', 'host.docker.internal:host-gateway', '-e', `P_PORT=${PORT}`, '-e', `P_PASS=${hubPassword}`, '-e', `P_EXECUTION=${executionId}`,
      '-e', `P_WRITES=${writes ? 1 : 0}`, '-e', `P_ADMIN=${adminId}`, '-v', `${probeFile}:/app/rb-probe.cjs:ro`, image, 'node', '/app/rb-probe.cjs']);
    const line = run.stdout.trim().split('\n').pop() || '';
    try { return JSON.parse(line); } catch { return { fatal: `no JSON (exit ${run.status}): ${run.stderr.slice(0, 200)}` }; }
  } finally { fs.unlinkSync(probeFile); }
}

(async () => {
  const backup = arg('--backup')[0], oldImage = arg('--old')[0], newImages = arg('--new');
  if (!backup || !oldImage || !newImages.length) throw new Error('Usage: --backup <dump> --old <tag> --new <tag> [--new <tag>]');
  if (!fs.existsSync(backup)) throw new Error('Backup not found');
  for (const image of [oldImage, ...newImages]) if (sh('docker', ['image', 'inspect', image]).status !== 0) throw new Error(`Image not found: ${image}`);
  if (sh('docker', ['image', 'inspect', 'postgres:18-alpine']).status !== 0) throw new Error('postgres:18-alpine image not found locally');

  // 1. Throw-away database server.
  const started = sh('docker', ['run', '-d', '--name', CONTAINER, '-e', `POSTGRES_PASSWORD=${superPassword}`, '-p', `${PORT}:5432`, 'postgres:18-alpine']);
  check('throw-away PostgreSQL container started', started.status === 0, started.stderr);
  for (let i = 0; i < 40 && sql('postgres', 'SELECT 1').stdout.trim() !== '1'; i++) await new Promise(r => setTimeout(r, 2000));
  for (const [role, limit, inherit] of ROLES) {
    const r = sql('postgres', `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS ${inherit ? 'INHERIT' : 'NOINHERIT'} CONNECTION LIMIT ${limit}${role === 'daubert_hub_app' ? ` PASSWORD '${hubPassword}'` : ''}`);
    check(`role ${role}`, r.status === 0, r.stderr);
  }
  check('daubert_backup membership', sql('postgres', 'GRANT pg_read_all_data TO daubert_backup').status === 0);
  check('database daubert_global created', sql('postgres', 'CREATE DATABASE daubert_global TEMPLATE template0 ENCODING \'UTF8\'').status === 0);
  const restore = sh(path.join(BIN, 'pg_restore.exe'), ['-h', '127.0.0.1', '-p', String(PORT), '-U', 'postgres', '-d', 'daubert_global', '--no-password', '--exit-on-error', backup], { PGPASSWORD: superPassword });
  check('backup restored (owners and ACLs preserved)', restore.status === 0, restore.stderr);
  const target = sql('daubert_global', "SELECT (SELECT ejecucion_id FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id) WHERE a.codigo='REMISIONES_CATERPILLAR' AND e.estado='COMPLETADA' AND EXISTS(SELECT 1 FROM operacion.remisiones r WHERE r.ejecucion_id=e.ejecucion_id) ORDER BY e.ejecucion_id DESC LIMIT 1)||'|'||(SELECT user_id FROM security.users WHERE role='ADMIN' AND status='ACTIVE' AND NOT must_change_password ORDER BY user_id LIMIT 1)").stdout.trim().split('|');
  const [executionId, adminId] = target;
  check('probe targets found (a COMPLETADA execution with remissions, an ADMIN user)', executionId && adminId, target.join('|'));

  // 2. State S0 = production as backed up (no 013, no 016).
  const oldS0 = probe(oldImage, { executionId });
  check('previous Hub image runs its repository against S0', !oldS0.fatal && oldS0.list?.ok && oldS0.findById?.ok && oldS0.findRemissionsByExecutionId?.ok, JSON.stringify(oldS0));
  const newS0 = newImages.map(image => [image, probe(image, { executionId })]);
  for (const [image, p] of newS0) {
    check(`${image}: against S0 (no 013/016) reads keep working and degrade gracefully`, !p.fatal && p.list?.ok && p.findById?.ok && p.findCancellationAuditsByExecutionId?.shape === 'array:0' && p.findRegenerationContext?.value?.available === false, JSON.stringify(p));
  }
  const newS0Writes = newImages.map(image => [image, probe(image, { executionId, writes: true, adminId })]);
  for (const [image, p] of newS0Writes) check(`${image}: cancel/regenerate against S0 fail (migrations missing) and nothing else`, p.authorizeRegeneration?.ok === false && p.cancelRemission?.ok === false, JSON.stringify({ a: p.authorizeRegeneration, c: p.cancelRemission }));

  // 3. Migrations exactly as the cutover applies them: 013 -> role -> 016 (which includes 017).
  for (const kind of ['precheck', 'up', 'postcheck']) { const r = file(`20261020_013_caterpillar_cancellation.${kind}.sql`); check(`013 ${kind}`, r.status === 0, r.stderr); }
  const role = file('20261024_016_caterpillar_worker_role_prod.template.sql', { worker_password: workerPassword }); check('worker role template', role.status === 0, role.stderr);
  for (const kind of ['precheck', 'up', 'postcheck']) { const r = file(`20261024_016_caterpillar_atomic_admission_prod.${kind}.sql`); check(`016/017 ${kind}`, r.status === 0, r.stderr); }

  // 4. State S1 = after 013 and 016/017.
  const oldS1 = probe(oldImage, { executionId });
  const keys = ['list', 'findById', 'findRemissionsByExecutionId', 'findReservationsByExecutionId', 'findDetailsByRemisionIds'];
  check('ROLLBACK COMPATIBILITY: the previous Hub reads exactly the same data after 013 and 016/017 (same digests, no errors)',
    !oldS1.fatal && keys.every(k => oldS1[k]?.ok && oldS0[k]?.ok && oldS1[k].digest === oldS0[k].digest), JSON.stringify({ s0: oldS0, s1: oldS1 }));
  for (const image of newImages) {
    const p = probe(image, { executionId });
    check(`${image}: against S1 every read works and the new contracts are available`, !p.fatal && keys.every(k => p[k]?.ok) && p.findCancellationAuditsByExecutionId?.ok && p.findRegenerationContext?.value?.available === true, JSON.stringify(p));
    const w = probe(image, { executionId, writes: true, adminId });
    const a = w.authorizeRegeneration, c = w.cancelRemission;
    check(`${image}: against S1 the protected functions answer with their own domain errors (no 'function does not exist')`,
      a && c && !/does not exist|no existe/i.test(`${a.message} ${c.message}`) && (a.ok === false || a.ok === true) && (c.ok === false || c.ok === true), JSON.stringify({ a, c }));
  }
  const grants = sql('daubert_global', "SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE has_function_privilege('daubert_hub_app', p.oid, 'EXECUTE') AND p.proname IN ('fn_cancelar_remision_caterpillar','fn_autorizar_regeneracion_caterpillar')").stdout.trim();
  check('the Hub role can execute exactly the two new Hub functions', grants === 'fn_autorizar_regeneracion_caterpillar,fn_cancelar_remision_caterpillar', grants);
  const noDirectWrites = sql('daubert_global', "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee='daubert_hub_app' AND table_schema='operacion' AND table_name IN ('cancelaciones_remisiones','autorizaciones_regeneracion_caterpillar') AND privilege_type <> 'SELECT'").stdout.trim();
  check('the Hub role has no write privilege on the new tables', noDirectWrites === '0', noDirectWrites);

  sh('docker', ['stop', CONTAINER]);
  console.log(JSON.stringify({ result: 'HUB_CONTRACTS_REHEARSAL_PASS', checks: results.length, executionProbe: executionId, images: { old: oldImage, new: newImages } }, null, 2));
})().catch(error => {
  sh('docker', ['stop', CONTAINER]);
  console.log(JSON.stringify({ result: 'HUB_CONTRACTS_REHEARSAL_FAIL', failedCheck: error.check ?? null, message: String(error.message).slice(0, 300), failures: results.filter(r => !r.pass) }, null, 2));
  process.exitCode = 1;
});
