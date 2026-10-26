#!/usr/bin/env node
'use strict';

// ISOLATED coexistence rehearsal of the Pagos (parent + child) and Caterpillar workflows in a FRESH n8n 2.27.4 container (own SQLite, own throw-away owner, one port on 127.0.0.1, no real
// credential, no Dropbox, no Outlook, no PostgreSQL). The activation/deactivation goes through n8n's own REST API (server-driven webhook registration, like the editor and the Pagos plan);
// workflows are imported with the CLI to keep their ids. NO workflow node is executed. The real n8n (5678), the isolated n8n (5690) and the waiting executions are never touched.
//   node scripts/rehearse-joint-n8n-isolated.cjs --pagos-dir <dir> --cat <candidate.json> --cat-live <live.json> [--port 56790]
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const arg = flag => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; };
const pagosDir = arg('--pagos-dir'), catFile = arg('--cat'), catLiveFile = arg('--cat-live');
const PORT = Number(arg('--port') ?? 56790);
if (!pagosDir || !catFile || !catLiveFile) throw new Error('Usage: --pagos-dir <dir> --cat <file> --cat-live <file>');
if (PORT === 5678 || PORT === 5690) throw new Error('Refusing the production/isolated n8n ports');
const IMAGE = 'docker.n8n.io/n8nio/n8n:2.27.4';
const NAME = `daubert-hub-rbtest-n8n-${crypto.randomBytes(3).toString('hex')}`;
const results = [];
const check = (name, ok, detail) => { results.push({ name, pass: Boolean(ok), ...(detail === undefined ? {} : { detail: String(detail).slice(0, 600) }) }); if (!ok) throw Object.assign(new Error('CHECK_FAILED'), { check: name }); };
const info = (name, detail) => results.push({ name, info: true, detail: String(detail).slice(0, 700) });
const sh = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = `http://127.0.0.1:${PORT}`;
let cookie = '';

async function api(method, route, body, attempt = 0) {
  // n8n can drop the very first connections while it finishes starting; only a network-level failure is retried (never an HTTP answer).
  try { return await apiOnce(method, route, body); } catch (error) { if (attempt >= 8) throw error; await sleep(3000); return api(method, route, body, attempt + 1); }
}
async function apiOnce(method, route, body) {
  const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map(c => c.split(';')[0]).join('; ');
  const text = await response.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, json, text: text.slice(0, 300) };
}
// 404 = nothing registered at that path; anything else (403 with its Header Auth credential, 500 here because the isolated instance has no credential) = registered.
const webhookState = async route => { const status = (await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status; return status === 404 ? '404' : 'registered'; };
const copyIn = (file, name) => { const r = sh('docker', ['cp', file, `${NAME}:/tmp/${name}`]); if (r.status !== 0) throw new Error(`docker cp failed: ${r.stderr}`); return `/tmp/${name}`; };
const logs = () => { const r = sh('docker', ['logs', NAME]); return r.stdout + r.stderr; };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daubert-n8n-rehearsal-'));
  const load = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const files = { pagosSource: path.join(pagosDir, 'payment-production-source.json'), pagosParent: path.join(pagosDir, 'payment-recovery-prod-parent.json'), pagosChild: path.join(pagosDir, 'payment-recovery-prod-child.json'), catLive: catLiveFile };
  // The candidate ships with Schedule and Webhook disabled and WITHOUT workflow id or webhookId (the editor import assigns them). The cutover enables the triggers (steps 13-14).
  const candidate = load(catFile); for (const n of candidate.nodes) if (/\.(scheduleTrigger|webhook)$/.test(n.type)) delete n.disabled;
  // n8n refuses to publish a workflow whose nodes have no credential assigned ("Credential not configured"): in the window that is cutover steps 8-9 (credential created and assigned to the 7 Postgres
  // nodes). The rehearsal assigns a fake id to the same credential NAME, which is what the editor does.
  const variantOf = (id, name, webhookId) => { const copy = JSON.parse(JSON.stringify(candidate)); copy.id = id; copy.name = name;
    for (const n of copy.nodes) if (n.credentials?.postgres && !n.credentials.postgres.id) n.credentials.postgres = { id: 'rbtestCatCred01', name: n.credentials.postgres.name };
    if (webhookId) for (const n of copy.nodes) if (n.type.endsWith('.webhook')) n.webhookId = webhookId; return copy; };
  files.cand1 = path.join(tmp, 'cand1.json'); fs.writeFileSync(files.cand1, JSON.stringify(variantOf('catCandRehearsal01', 'Remisiones CAT Produccion PG 016 (rehearsal: as generated, no webhookId)')));
  files.cand2 = path.join(tmp, 'cand2.json'); fs.writeFileSync(files.cand2, JSON.stringify(variantOf('catCandRehearsal02', 'Remisiones CAT Produccion PG 016 (rehearsal: fixed new webhookId)', '0b6f3c7e-52a4-4d0e-9d6b-7a5c1f2e8b91')));

  try {
    const run = sh('docker', ['run', '-d', '--name', NAME, '-p', `127.0.0.1:${PORT}:5678`, '-e', `N8N_ENCRYPTION_KEY=${crypto.randomBytes(16).toString('hex')}`, '-e', 'N8N_SECURE_COOKIE=false', '-e', 'N8N_DIAGNOSTICS_ENABLED=false',
      '-e', 'N8N_VERSION_NOTIFICATIONS_ENABLED=false', '-e', 'N8N_PERSONALIZATION_ENABLED=false', '-e', 'N8N_HIRING_BANNER_ENABLED=false',
      // Same node/Code configuration as the production n8n user environment: executeCommand enabled, Code nodes may use fs/path/crypto and fflate.
      '-e', 'NODES_EXCLUDE=[]', '-e', 'NODE_FUNCTION_ALLOW_BUILTIN=fs,path,crypto', '-e', 'NODE_FUNCTION_ALLOW_EXTERNAL=fflate', IMAGE]);
    check('fresh n8n 2.27.4 container started (own SQLite, no real credential)', run.status === 0, run.stderr);
    for (let i = 0; i < 60; i++) { try { const r = await fetch(base + '/rest/settings'); if ((await r.text()).startsWith('{')) break; } catch { /* starting */ } await sleep(3000); }   // /healthz answers 200 before the REST API is ready
    const version = sh('docker', ['exec', NAME, 'n8n', '--version']).stdout.trim();
    check('n8n version is 2.27.4 (same as production)', version === '2.27.4', version);
    const password = `Rehearsal-${crypto.randomBytes(6).toString('hex')}9A`;
    const setup = await api('POST', '/rest/owner/setup', { email: 'rehearsal@example.invalid', firstName: 'Rehearsal', lastName: 'Owner', password });
    check('throw-away owner created in the isolated instance', setup.status === 200 && setup.json?.data?.id, setup.text);
    const login = await api('POST', '/rest/login', { emailOrLdapLoginId: 'rehearsal@example.invalid', password });
    check('login to the isolated instance', login.status === 200 && cookie, login.text);
    const personal = await api('GET', '/rest/projects/personal');
    const projectId = personal.json?.data?.id;
    check('personal project of the owner found (the Pagos plan imports with --projectId)', Boolean(projectId), personal.text);

    const importFile = (file, name) => sh('docker', ['exec', NAME, 'n8n', 'import:workflow', `--input=${copyIn(file, name)}`, `--projectId=${projectId}`, '--activeState=false']);
    const get = async id => (await api('GET', `/rest/workflows/${id}`)).json?.data;
    const activate = async id => { const w = await get(id); const r = await api('POST', `/rest/workflows/${id}/activate`, { versionId: w.versionId }); const after = await get(id); return { status: r.status, active: Boolean(after?.active), message: (r.text || '').slice(0, 220) }; };
    const deactivate = async id => { const r = await api('POST', `/rest/workflows/${id}/deactivate`, {}); const after = await get(id); return { status: r.status, active: Boolean(after?.active) }; };
    const activeIds = async () => ((await api('GET', '/rest/workflows')).json?.data ?? []).filter(w => w.active).map(w => w.id).sort();
    const pagosSource = load(files.pagosSource), catLive = load(files.catLive);
    const hooks = async () => [await webhookState('/webhook/cat-reprocess'), await webhookState('/webhook/daubert-hub/notificaciones-pago/reprocesar'), await webhookState('/webhook/does-not-exist')];

    // ---- 1. Baseline = production today: Pagos source (pagosProdAsignaciones01) and the live Caterpillar workflow (9Ngnrpi16b6GtOAX), both active
    for (const [key, name] of [['pagosSource', 'pagos-source.json'], ['catLive', 'cat-live.json']]) { const r = importFile(files[key], name); check(`import baseline ${key}`, r.status === 0, r.stdout + r.stderr); }
    const b1 = await activate(pagosSource.id), b2 = await activate(catLive.id);
    check('BASELINE: both production-like workflows activate', b1.active && b2.active, JSON.stringify([b1, b2]));
    check('BASELINE: both webhooks are registered; an unknown path is 404', (await hooks()).join(',') === 'registered,registered,404', (await hooks()).join(','));

    // ---- 2. The candidate AS GENERATED has no webhookId: n8n gives such a webhook the workflow-qualified path, not /webhook/cat-reprocess
    const r1 = importFile(files.cand1, 'cand1.json'); check('import the Caterpillar candidate as generated today (no id, no webhookId; the CLI needs an id, the editor assigns one)', r1.status === 0, r1.stdout + r1.stderr);
    const c1 = await activate('catCandRehearsal01');
    check('the candidate (credential assigned) is accepted by n8n while the live workflow is still active', c1.active === true, JSON.stringify(c1));
    const qualifiedPath = `/webhook/catCandRehearsal01/${encodeURIComponent('webhook reproceso cat (prod)')}/cat-reprocess`;
    info('candidate WITHOUT webhookId, live still active: the candidate answers on its workflow-qualified path, the Hub URL /webhook/cat-reprocess still belongs to the live workflow', `qualified=${await webhookState(qualifiedPath)} plain=${await webhookState('/webhook/cat-reprocess')}`);
    await deactivate('catCandRehearsal01');
    const dLive0 = await deactivate(catLive.id);
    const c1b = await activate('catCandRehearsal01');
    const plain1 = await webhookState('/webhook/cat-reprocess'), qualified1 = await webhookState(qualifiedPath);
    info('FINDING: candidate WITHOUT webhookId imported through the CLI, live workflow deactivated', `activates=${c1b.active} plain(/webhook/cat-reprocess, the URL the Hub calls)=${plain1} workflow-qualified=${qualified1}`);
    await deactivate('catCandRehearsal01'); await activate(catLive.id);

    // ---- 3. Collision control with a webhookId: the candidate variant (fixed NEW webhookId) shares the plain path with the live workflow
    const r2 = importFile(files.cand2, 'cand2.json'); check('import the candidate variant with a fixed new webhookId', r2.status === 0, r2.stdout + r2.stderr);
    const collision = await activate('catCandRehearsal02');
    check('COLLISION CONTROL: with a webhookId, n8n REFUSES to activate the candidate while the live workflow owns /webhook/cat-reprocess (it is left inactive)', collision.active === false && collision.status === 409, JSON.stringify(collision));
    // ---- 4. Ordered cutover as documented: deactivate the live workflow first, then activate the candidate
    const d = await deactivate(catLive.id);
    check('live Caterpillar workflow deactivated (step 1 of the window); its webhook registration is gone', d.active === false && (await webhookState('/webhook/cat-reprocess')) === '404', JSON.stringify(d));
    const c2 = await activate('catCandRehearsal02');
    check('CUTOVER: the candidate variant activates once the live workflow is out', c2.active === true, JSON.stringify(c2));
    check('CUTOVER: the Hub URL /webhook/cat-reprocess is registered for the candidate and Pagos is unaffected', (await hooks()).join(',') === 'registered,registered,404', (await hooks()).join(','));

    // ---- 5. Pagos promotion in the documented order: child first (new id), then the parent over its existing id
    const rc = importFile(files.pagosChild, 'pagos-child.json'); check('import Pagos child (id pagosProdRecuperacion01, 106 nodes)', rc.status === 0, rc.stdout + rc.stderr);
    const pc = await activate('pagosProdRecuperacion01'); check('Pagos child activates (Execute Workflow Trigger only)', pc.active === true, JSON.stringify(pc));
    const pd = await deactivate(pagosSource.id); check('Pagos parent deactivated before importing the new version (Pagos plan)', pd.active === false && (await webhookState('/webhook/daubert-hub/notificaciones-pago/reprocesar')) === '404', JSON.stringify(pd));
    const rp = importFile(files.pagosParent, 'pagos-parent.json'); check('import the Pagos parent over the existing id (111 nodes)', rp.status === 0, rp.stdout + rp.stderr);
    const parentNow = await get(pagosSource.id);
    check('the parent has 111 nodes and keeps its id', parentNow.nodes.length === 111 && parentNow.id === pagosSource.id, `${parentNow.nodes.length} ${parentNow.id}`);
    const pp = await activate(pagosSource.id); check('Pagos parent activates', pp.active === true, JSON.stringify(pp));

    // ---- 6. Final state
    const finalActive = await activeIds();
    check('FINAL: the three workflows are active at the same time (Pagos parent, Pagos child, Caterpillar candidate) and the old live Caterpillar workflow is not', finalActive.includes(pagosSource.id) && finalActive.includes('pagosProdRecuperacion01') && finalActive.includes('catCandRehearsal02') && !finalActive.includes(catLive.id), finalActive.join(' '));
    check('FINAL: both webhooks are registered independently; an unknown path is 404', (await hooks()).join(',') === 'registered,registered,404', (await hooks()).join(','));
    const text = logs();
    const collisions = text.split('\n').filter(l => /already taken|already (in use|registered)|conflict/i.test(l));
    info('server-log lines about taken paths (expected only from the deliberate COLLISION CONTROL attempt)', `${collisions.length}: ${collisions.slice(0, 2).join(' || ')}`);
    const afterFinal = await Promise.all([webhookState('/webhook/cat-reprocess'), webhookState('/webhook/daubert-hub/notificaciones-pago/reprocesar')]);
    check('no Pagos webhook was disturbed by the Caterpillar changes (still registered after all steps)', afterFinal[1] === 'registered', afterFinal.join(','));
    sh('docker', ['stop', NAME]);
    console.log(JSON.stringify({ result: 'JOINT_N8N_COEXISTENCE_PASS', checks: results.filter(r => r.pass).length, container: NAME, results }, null, 2));
  } catch (error) {
    sh('docker', ['stop', NAME]);
    console.log(JSON.stringify({ result: 'JOINT_N8N_COEXISTENCE_FAIL', failedCheck: error.check ?? null, message: String(error.message).slice(0, 400), container: NAME, results }, null, 2));
    process.exitCode = 1;
  } finally { console.error(`temporary folder kept for the Phase F inventory: ${tmp}`); }
})();
