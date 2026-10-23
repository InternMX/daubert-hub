// TEST only: real PostgreSQL + API + isolated n8n, with synthetic PDFs and Outlook/Dropbox stubs.
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { Pool } = require('pg');
const { createAuthenticatedTestSession } = require('./support/test-auth.cjs');
const { build } = require('../../../scripts/n8n/build-payment-recovery-test.cjs');

const marker = `HUB_TEST_RECOVERY_${randomUUID().replaceAll('-', '')}`;
const sha = value => createHash('sha256').update(value).digest('hex');
const guarded = name => {
  const value = process.env[name];
  assert(value, `${name} required`);
  assert.equal(new URL(value).pathname, '/daubert_hub_test', 'TEST database required');
  return value;
};
const hub = new Pool({ connectionString: guarded('TEST_DATABASE_URL') });
const n8n = new Pool({ connectionString: guarded('TEST_DATABASE_URL_N8N_APP') });
let api;
let checks = 0;
function ok(message) { checks++; console.log(`PASS ${message}`); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  for (const pool of [hub, n8n]) assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, 'daubert_hub_test');
  assert.equal((await hub.query("SELECT to_regclass('core.recuperaciones_notificacion_pago') IS NOT NULL AS ready")).rows[0].ready, true, 'Apply migration 018 first');
  const aliasesBefore = (await hub.query('SELECT count(*)::int AS n FROM core.alias_empresa')).rows[0].n;
  const companies = [];
  for (let i = 0; i < 13; i++) {
    const name = `RECOVERY ${marker.replace(/\d/g, d => String.fromCharCode(65 + Number(d)))} COMPANY ${String.fromCharCode(65 + i)}`;
    const row = (await hub.query("INSERT INTO core.empresas(tipo_empresa,nombre_comercial,estatus,ruta_dropbox) VALUES ('PROVEEDOR',$1,'ACTIVO',$2) RETURNING empresa_id::text AS id", [name, `PROVEEDORES/${marker}_${i}`])).rows[0];
    await hub.query("INSERT INTO core.empresa_roles(empresa_id,rol,estatus) VALUES ($1,'PROVEEDOR','ACTIVO')", [row.id]);
    await hub.query("INSERT INTO core.empresas_notificacion_pago(empresa_id,procesa_comprobantes_pago,notificaciones_activas,ruta_destino) VALUES ($1,true,true,$2)", [row.id, `PROVEEDORES/${marker}_${i}/PAGOS/{ANIO}/{MES_NUM}`]);
    const contact = (await hub.query("INSERT INTO core.contactos(empresa_id,tipo_contacto,nombre,estatus) VALUES ($1,'PERSONA','Synthetic Recovery','ACTIVO') RETURNING contacto_id", [row.id])).rows[0];
    await hub.query("INSERT INTO core.medios_contacto(contacto_id,tipo_medio,valor,estatus,recibe_notificacion_pago,tipo_destinatario_pago) VALUES ($1,'CORREO','recovery@example.test','ACTIVO',true,'PARA')", [contact.contacto_id]);
    companies.push({ ...row, name });
  }
  async function mail(tag) {
    return (await hub.query("INSERT INTO core.correos_notificacion_pago(outlook_message_id,asunto,estado) VALUES ($1,$2,'PENDIENTE') RETURNING correo_id::text AS id", [`${marker}_${tag}`, 'SYNTHETIC PAGO PROVEEDORES S43'])).rows[0].id;
  }
  async function register(cid, index, hash = sha(`PDF${index}`), zip = sha('ZIP'), name = '11.-LUA TANY.pdf') {
    return (await n8n.query("SELECT core.fn_registrar_archivo_notificacion_pago($1,'SYNTHETIC_ATTACHMENT',$2,$3,$4,$5,'LUA TANY','ALIAS_NO_CATALOGADO',true,true)::text AS id", [cid, zip, index, hash, name])).rows[0].id;
  }
  const safe = async (cid, fid) => (await hub.query('SELECT core.fn_archivo_notificacion_asignable($1,$2,false) AS safe', [fid, cid])).rows[0].safe;
  const evidence = (fid, hash = sha('PDF0'), zip = sha('ZIP'), index = 0, name = '11.-LUA TANY.pdf') => ({ archivo_id: fid, tomado: false,
    adjunto_origen_id: 'SYNTHETIC_ATTACHMENT', zip_sha256: zip, entrada_indice: index,
    file_sha256: hash, nombre_archivo: name, codigo_error: 'ALIAS_NO_CATALOGADO' });
  const observe = (cid, run, files) => n8n.query('SELECT core.fn_observar_archivos_pago_sin_efectos($1,$2,$3::jsonb)', [cid, run, JSON.stringify(files)]);
  const start = async (cid, run) => (await n8n.query('SELECT core.fn_iniciar_recuperacion_pago($1,$2) AS accepted', [cid, run])).rows[0].accepted;
  const finish = (cid, run) => n8n.query('SELECT core.fn_finalizar_recuperacion_pago($1,$2) AS recovered', [cid, run]);
  const terminal = cid => hub.query("UPDATE core.correos_notificacion_pago SET estado='ERROR',detalle_error=$2 WHERE correo_id=$1", [cid, `11.-LUA TANY.pdf: ALIAS_NO_CATALOGADO - LUA TANY | HASH=${sha('PDF0')}`]);

  const cid = await mail('PARTIAL'); const fid = await register(cid, 0);
  const peers = [];
  for (let i = 0; i < 12; i++) {
    const peer = await register(cid, i + 1, sha(`peer${i}`), sha('ZIP'), `peer-${i}.pdf`);
    await n8n.query("SELECT * FROM core.fn_consultar_archivo_notificacion_pago($1,$2,'SYNTHETIC_ATTACHMENT',$3,$4,$5,true,false,NULL)", [peer, cid, sha('ZIP'), i + 1, sha(`peer${i}`)]);
    await hub.query("INSERT INTO core.resultados_notificacion_pago(correo_id,empresa_id,estado) VALUES ($1,$2,'LISTO')", [cid, companies[i].id]);
    await hub.query("INSERT INTO core.borradores_notificacion_pago(correo_id,empresa_id,estado,outlook_draft_id) VALUES ($1,$2,'CREADO',$3)", [cid, companies[i].id, `SYNTHETIC_DRAFT_${i}`]);
    peers.push(peer);
  }
  const snapshot = async () => JSON.stringify((await hub.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.empresa_id) FROM core.resultados_notificacion_pago r WHERE correo_id=$1 AND empresa_id=ANY($2::bigint[])) AS results,
    (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.empresa_id) FROM core.borradores_notificacion_pago b WHERE correo_id=$1 AND empresa_id=ANY($2::bigint[])) AS drafts,
    (SELECT jsonb_agg(to_jsonb(f) ORDER BY f.archivo_id) FROM core.archivos_notificacion_pago f WHERE archivo_id=ANY($3::bigint[])) AS files`, [cid, companies.slice(0, 12).map(c => c.id), peers])).rows[0]);
  const before = await snapshot();
  await terminal(cid);
  assert.equal(await safe(cid, fid), false); ok('Partial legacy mail remains blocked without positive per-file evidence');
  await hub.query('SELECT core.fn_bloquear_archivos_reproceso_pago($1)', [cid]);
  assert.equal(await start(cid, 'synthetic-owner'), true);
  await terminal(cid); // An early ERROR must not be mistaken for a finished n8n execution.
  assert.equal(await start(cid, 'competing-owner'), false);
  assert.equal(await safe(cid, fid), false);
  await assert.rejects(hub.query('SELECT core.fn_bloquear_archivos_reproceso_pago($1)', [cid]), { code: 'P4091' });
  ok('Early terminal ERROR does not release ownership; concurrent dispatch is rejected');
  await assert.rejects(observe(cid, 'wrong-owner', [evidence(fid)]));
  await assert.rejects(observe(cid, 'synthetic-owner', [evidence(fid, sha('changed PDF'))]));
  await assert.rejects(observe(cid, 'synthetic-owner', [{ ...evidence(fid), tomado: null }]));
  await assert.rejects(observe(cid, 'synthetic-owner', [{ ...evidence(fid), zip_sha256: sha('changed ZIP') }]));
  await assert.rejects(observe(cid, 'synthetic-owner', [{ ...evidence(fid), entrada_indice: 99 }]));
  ok('Unknown owner, PDF hash, ZIP hash, entry index and missing no-claim attestation fail closed');
  await observe(cid, 'synthetic-owner', [evidence(fid)]);
  await hub.query("UPDATE core.correos_notificacion_pago SET estado='PENDIENTE' WHERE correo_id=$1", [cid]);
  await assert.rejects(finish(cid, 'synthetic-owner')); await terminal(cid);
  assert.equal((await finish(cid, 'synthetic-owner')).rows[0].recovered, 1);
  assert.equal((await finish(cid, 'synthetic-owner')).rows[0].recovered, 0);
  assert.equal(await start(cid, 'synthetic-owner'), false);
  assert.equal(await safe(cid, fid), true);
  assert.equal(await snapshot(), before);
  ok('Controlled completion rehabilitates only the unclaimed file; completion is idempotent; 12 results/drafts/files unchanged');

  const ownMail = await mail('OWN_EFFECTS'); const ownFile = await register(ownMail, 0); await terminal(ownMail);
  assert.equal(await start(ownMail, 'own-effect-run'), true);
  await observe(ownMail, 'own-effect-run', [evidence(ownFile)]);
  await n8n.query("SELECT * FROM core.fn_consultar_archivo_notificacion_pago($1,$2,'SYNTHETIC_ATTACHMENT',$3,0,$4,true,true,NULL)", [ownFile, ownMail, sha('ZIP'), sha('PDF0')]);
  await assert.rejects(finish(ownMail, 'own-effect-run'));
  assert.equal(await safe(ownMail, ownFile), false);
  ok('A file claimed after observation remains blocked; no stale evidence can reset its own effects');
  await assert.rejects(hub.query('SELECT core.fn_finalizar_recuperacion_pago($1,$2)', [cid, 'synthetic-owner']), { code: '42501' });
  await assert.rejects(hub.query("UPDATE core.recuperaciones_notificacion_pago SET estado='FINALIZADO' WHERE correo_id=$1", [cid]), { code: '42501' });
  ok('Hub cannot manufacture completion evidence or modify run ownership');
  const raceMail = await mail('RACE'); await register(raceMail, 0); await terminal(raceMail);
  assert.equal((await Promise.all([start(raceMail, 'race-a'), start(raceMail, 'race-b')])).filter(Boolean).length, 1);
  ok('Two concurrent n8n claims have exactly one winner');
  const absentMail = await mail('NO_EVIDENCE'); const absentFile = await register(absentMail, 0); await terminal(absentMail);
  await hub.query('SELECT core.fn_bloquear_archivos_reproceso_pago($1)', [absentMail]);
  assert.equal(await start(absentMail, 'no-evidence'), true);
  assert.equal((await finish(absentMail, 'no-evidence')).rows[0].recovered, 0);
  assert.equal(await safe(absentMail, absentFile), false);
  ok('A completed run without file evidence does not reopen a frozen file');

  const url = new URL(process.env.TEST_DATABASE_URL); const port = 3127;
  api = spawn(process.execPath, ['dist/src/main.js'], { cwd: process.cwd(), env: { ...process.env,
    DB_HOST: url.hostname, DB_PORT: url.port || '5432', DB_NAME: 'daubert_hub_test', DB_USER: decodeURIComponent(url.username), DB_PASSWORD: decodeURIComponent(url.password),
    NODE_ENV: 'test', EXPECTED_DATABASE_NAME: 'daubert_hub_test', API_PORT: String(port), AUTH_COOKIE_SECURE: 'false',
    PAYMENT_FILE_ASSIGNMENTS_TEST_ENABLED: 'true', PAYMENT_FILE_ASSIGNMENTS_N8N_READY: 'false',
    PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL: '', PAYMENT_NOTIFICATIONS_WEBHOOK_TOKEN: '',
    CATERPILLAR_REPROCESS_WEBHOOK_URL: '', CATERPILLAR_REPROCESS_WEBHOOK_TOKEN: '', N8N_HEALTH_WEBHOOK_URL: '', N8N_HEALTH_WEBHOOK_TOKEN: ''
  }, stdio: 'ignore' });
  let healthy = false;
  for (let i = 0; i < 100 && !healthy; i++) { try { healthy = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch { /* booting */ } if (!healthy) await pause(100); }
  assert(healthy, 'TEST API failed to start');
  const auth = await createAuthenticatedTestSession(`http://127.0.0.1:${port}/api`, marker);
  const request = async (route, body) => {
    const r = await fetch(`http://127.0.0.1:${port}/api${route}`, { method: body ? 'PATCH' : 'GET', headers: { cookie: auth.cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json() };
  };
  const detail = await request(`/automations/payment-notifications/${cid}`);
  assert.equal(detail.body.data.fileErrorDetails[0].fileAssignment.canManage, true);
  const assignmentRoute = `/automations/payment-notifications/${cid}/files/${fid}/assignment`;
  const assignment = { action: 'ASSIGN', expectedVersion: 0, confirmed: true, companyId: companies[0].id };
  const conflict = await request(assignmentRoute, assignment);
  assert.equal(conflict.status, 409); assert.equal(conflict.body.code, 'POINT_DESTINATION_HAS_EFFECTS');
  const assigned = await request(assignmentRoute, { ...assignment, companyId: companies[12].id });
  assert.equal(assigned.status, 200); assert.equal(assigned.body.data.companyId, companies[12].id);
  assert.equal((await request(assignmentRoute, { ...assignment, companyId: companies[12].id })).status, 409);
  assert.equal(await snapshot(), before);
  assert.equal((await hub.query('SELECT count(*)::int AS n FROM core.alias_empresa')).rows[0].n, aliasesBefore);
  assert((await hub.query("SELECT 1 FROM audit.cambios WHERE tabla='archivos_notificacion_pago' AND registro_id=$1 AND datos_anteriores->>'estado_operativo'='REPROCESO_SOLICITADO' AND datos_nuevos->>'estado_operativo'='SIN_EFECTOS'", [`archivo_id=${fid}`])).rowCount > 0);
  ok('Real API canManage/assignment, destination conflict, optimistic version, audit and unchanged permanent aliases');

  if (process.env.RUN_N8N_PAYMENT_RECOVERY === 'true') await workflowTest({ mail, register, companies, request });
  console.log(`PASS ${checks} groups; synthetic fixture retained: correo=${cid}, archivo=${fid}. No production access.`);
}

async function workflowTest({ mail, register, companies, request }) {
  const home = process.env.N8N_TEST_HOME; assert(home, 'N8N_TEST_HOME required');
  assert(fs.statSync(path.join(home, 'data')).isDirectory());
  const folder = `payment-recovery-${randomUUID()}`;
  const root = path.join(home, 'data', folder); fs.mkdirSync(root);
  const sandbox = path.join(root, 'dropbox', 'NOTIFICACIONES DE PAGO');
  fs.mkdirSync(sandbox, { recursive: true });
  for (let i = 0; i < companies.length; i++) fs.mkdirSync(path.join(sandbox, 'PROVEEDORES', `${marker}_${i}`), { recursive: true });
  const signature = path.join(sandbox, '05_ARCHIVOS AUXILIARES', 'FIRMA'); fs.mkdirSync(signature, { recursive: true });
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex');
  for (const name of ['logo', 'linkedin', 'google', 'facebook', 'twitter']) fs.writeFileSync(path.join(signature, `${name}.png`), png);
  const source = JSON.parse(fs.readFileSync(path.join(home, 'wf/out/harness_reproceso.json'), 'utf8').replaceAll('/data/', `/data/${folder}/`));
  const names = [...companies.slice(0, 12).map((c, i) => `${i + 1}.-${c.name}.pdf`), '11.-LUA TANY.pdf'];
  const zip = spawnSync('python', ['-c', `import io,json,sys,zipfile
names=json.load(sys.stdin);out=io.BytesIO()
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
 for i,name in enumerate(names):
  text='BT /F1 12 Tf 50 700 Td (Fecha de aplicaci'+chr(243)+'n: 23/10/2026 SYNTHETIC '+str(i)+') Tj ET'
  objects=['<</Type/Catalog/Pages 2 0 R>>','<</Type/Pages/Kids[3 0 R]/Count 1>>','<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>','<</Length '+str(len(text))+'>>\\nstream\\n'+text+'\\nendstream','<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>']
  pdf=b'%PDF-1.4\\n';offsets=[]
  for j,obj in enumerate(objects,1):offsets.append(len(pdf));pdf+=(str(j)+' 0 obj\\n'+obj+'\\nendobj\\n').encode('latin-1')
  x=len(pdf);pdf+=('xref\\n0 6\\n0000000000 65535 f \\n'+''.join(f'{o:010d} 00000 n \\n' for o in offsets)+f'trailer<</Size 6/Root 1 0 R>>\\nstartxref\\n{x}\\n%%EOF').encode();z.writestr(name,pdf)
sys.stdout.buffer.write(out.getvalue())`], { input: JSON.stringify(names) });
  assert.equal(zip.status, 0, zip.stderr.toString());
  const cid = await mail('N8N'); const zipHash = sha(zip.stdout);
  const unzip = spawnSync('python', ['-c', "import io,sys,zipfile,json,hashlib;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));print(json.dumps([hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()]))"], { input: zip.stdout });
  assert.equal(unzip.status, 0); const hashes = JSON.parse(unzip.stdout);
  const files = [];
  for (let i = 0; i < 13; i++) {
    files.push(await register(cid, i, hashes[i], zipHash, names[i]));
  }
  const fid = files[12];
  for (let i = 0; i < 12; i++) {
    await n8n.query("SELECT * FROM core.fn_consultar_archivo_notificacion_pago($1,$2,'SYNTHETIC_ATTACHMENT',$3,$4,$5,true,false,NULL)", [files[i], cid, zipHash, i, hashes[i]]);
    await hub.query("INSERT INTO core.resultados_notificacion_pago(correo_id,empresa_id,estado) VALUES ($1,$2,'LISTO')", [cid, companies[i].id]);
    await hub.query("INSERT INTO core.borradores_notificacion_pago(correo_id,empresa_id,estado,outlook_draft_id) VALUES ($1,$2,'CREADO',$3)", [cid, companies[i].id, `SYNTHETIC_N8N_${i}`]);
  }
  await hub.query("UPDATE core.correos_notificacion_pago SET estado='ERROR',detalle_error=$2 WHERE correo_id=$1", [cid, `11.-LUA TANY.pdf: ALIAS_NO_CATALOGADO - LUA TANY | HASH=${hashes[12]}`]);
  await hub.query('SELECT core.fn_bloquear_archivos_reproceso_pago($1)', [cid]);
  fs.mkdirSync(path.join(root, 'scenario')); fs.mkdirSync(path.join(root, 'zips'));
  fs.writeFileSync(path.join(root, 'zips', 'synthetic.zip'), zip.stdout);
  fs.writeFileSync(path.join(root, 'scenario', 'messages.json'), JSON.stringify([{ id: `${marker}_N8N`, subject: 'SYNTHETIC PAGO PROVEEDORES S43', attachments: [{ id: 'SYNTHETIC_ATTACHMENT', name: 'synthetic.zip', zip: 'synthetic.zip' }] }]));
  const workflows = build(source, cid);
  for (const [name, workflow] of Object.entries(workflows)) {
    const file = path.join(root, `${name}.json`); fs.writeFileSync(file, JSON.stringify(workflow));
    let r = spawnSync('docker', ['cp', file, `n8n-test-aislado:/tmp/payment-recovery-${name}.json`], { encoding: 'utf8' }); assert.equal(r.status, 0);
    r = spawnSync('docker', ['exec', 'n8n-test-aislado', 'n8n', 'import:workflow', `--input=/tmp/payment-recovery-${name}.json`], { encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 0, 'Isolated workflow import failed');
    if (name === 'body') {
      r = spawnSync('docker', ['exec', 'n8n-test-aislado', 'n8n', 'publish:workflow', `--id=${workflow.id}`], { encoding: 'utf8', timeout: 30000 });
      assert.equal(r.status, 0, 'Isolated processing subworkflow publication failed');
    }
  }
  const result = spawnSync('docker', ['exec', '-e', 'N8N_RUNNERS_BROKER_PORT=5688', '-e', 'N8N_PORT=5687', 'n8n-test-aislado', 'n8n', 'execute', `--id=${workflows.wrapper.id}`], { encoding: 'utf8', timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
  assert.equal(result.status, 0, `Isolated n8n failed: ${(result.stdout + result.stderr).slice(-1500)}`);
  const state = (await hub.query('SELECT estado_operativo,sin_efectos_ejecucion,core.fn_archivo_notificacion_asignable(archivo_id,correo_id,false) AS safe FROM core.archivos_notificacion_pago WHERE archivo_id=$1', [fid])).rows[0];
  assert.equal(state.estado_operativo, 'SIN_EFECTOS'); assert(state.sin_efectos_ejecucion); assert.equal(state.safe, true);
  const counts = (await hub.query('SELECT (SELECT count(*)::int FROM core.resultados_notificacion_pago WHERE correo_id=$1) AS results,(SELECT count(*)::int FROM core.borradores_notificacion_pago WHERE correo_id=$1) AS drafts', [cid])).rows[0];
  assert.deepEqual(counts, { results: 12, drafts: 12 });
  ok(`Native n8n parent waits for the complete stubbed child and rehabilitates only the unknown PDF (correo ${cid}, archivo ${fid})`);
  const peerSnapshot = async () => JSON.stringify((await hub.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY empresa_id) FROM core.resultados_notificacion_pago r WHERE correo_id=$1 AND empresa_id=ANY($2::bigint[])) AS results,
    (SELECT jsonb_agg(to_jsonb(b) ORDER BY empresa_id) FROM core.borradores_notificacion_pago b WHERE correo_id=$1 AND empresa_id=ANY($2::bigint[])) AS drafts,
    (SELECT jsonb_agg(to_jsonb(f) ORDER BY archivo_id) FROM core.archivos_notificacion_pago f WHERE archivo_id=ANY($3::bigint[])) AS files`, [cid, companies.slice(0, 12).map(c => c.id), files.slice(0, 12)])).rows[0]);
  const peersBefore = await peerSnapshot();
  const assign = await request(`/automations/payment-notifications/${cid}/files/${fid}/assignment`, { action: 'ASSIGN', companyId: companies[12].id, confirmed: true, expectedVersion: 0 });
  assert.equal(assign.status, 200);
  await hub.query('SELECT core.fn_bloquear_archivos_reproceso_pago($1)', [cid]);
  const execute = broker => new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-e', `N8N_RUNNERS_BROKER_PORT=${broker}`, '-e', `N8N_PORT=${broker + 100}`, 'n8n-test-aislado', 'n8n', 'execute', `--id=${workflows.wrapper.id}`]);
    let tail = ''; child.stdout.on('data', d => { tail = (tail + d).slice(-2000); }); child.stderr.on('data', d => { tail = (tail + d).slice(-2000); });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Isolated concurrent workflow failed: ${tail}`)));
  });
  await Promise.all([execute(5688), execute(5689)]);
  const after = (await hub.query('SELECT (SELECT count(*)::int FROM core.resultados_notificacion_pago WHERE correo_id=$1 AND empresa_id=$2) AS results,(SELECT count(*)::int FROM core.borradores_notificacion_pago WHERE correo_id=$1 AND empresa_id=$2) AS drafts', [cid, companies[12].id])).rows[0];
  assert.deepEqual(after, { results: 1, drafts: 1 });
  assert.equal((await hub.query('SELECT estado_operativo FROM core.archivos_notificacion_pago WHERE archivo_id=$1', [fid])).rows[0].estado_operativo, 'INICIADO');
  assert.equal(await peerSnapshot(), peersBefore);
  const events = fs.readFileSync(path.join(root, 'outlook_stub', 'eventos.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(events.filter(e => e.tipo === 'crear_borrador').length, 1);
  assert.equal(events.filter(e => e.tipo === 'adjuntar_comprobante').length, 1);
  ok('Recovered file processed by isolated n8n with two concurrent invocations: one draft, one attachment, one result; peers unchanged');
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (api) { api.kill('SIGTERM'); await pause(300); }
  await hub.end(); await n8n.end();
});
