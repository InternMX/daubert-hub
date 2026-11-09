'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { prepare } = require('./quarantine.cjs');
const hash = x => createHash('sha256').update(x).digest('hex');
const migration = kind => fs.readFileSync(path.resolve(__dirname, `../../../database/migrations/daubert_global/20261106_025_caterpillar_folio_recovery_test.${kind}.sql`), 'utf8');

exports.run = async (pool, root) => {
  const q = async (sql, values = []) => (await pool.query(sql, values)).rows;
  // This helper truncates synthetic fixtures: refuse a caller supplying the shared TEST pool.
  root=path.resolve(root);
  assert.equal(path.dirname(root).toLowerCase(),path.resolve(os.tmpdir(),'opencode').toLowerCase());
  assert.ok(path.basename(root).startsWith('cat-recovery-phase2-'));
  assert.equal(fs.lstatSync(root).isSymbolicLink(),false);
  assert.equal(path.resolve(fs.realpathSync(root)).toLowerCase(),root.toLowerCase());
  const instance=(await q("SELECT current_database() AS db,current_setting('data_directory') AS dir,inet_server_port() AS port"))[0];
  assert.equal(instance.db,'daubert_hub_test');assert.equal(instance.port,55441);
  assert.equal(path.resolve(instance.dir).toLowerCase(),path.join(root,'pgdata').toLowerCase());
  const role = async (name, sql, values = [], after) => {
    assert.ok(['daubert_hub_test_user','n8n_cat_test','cat_recovery_test_coordinator'].includes(name));
    const c = await pool.connect();
    try { await c.query('BEGIN'); await c.query(`SET LOCAL ROLE ${name}`); const rows = (await c.query(sql, values)).rows; if (after) await after(c, rows); await c.query('COMMIT'); return rows; }
    catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  };
  for (const name of ['daubert_hub_test_user','n8n_cat_test']) await q(`CREATE ROLE ${name} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  const provision=fs.readFileSync(path.join(__dirname,'provision-coordinator.test.sql'),'utf8');
  await q(provision);await q(provision); // Provisioning is idempotent and never promotes an existing role.
  await q('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ops,operacion FROM PUBLIC');
  await q('GRANT USAGE ON SCHEMA core,ops,operacion TO n8n_cat_test,daubert_hub_test_user');
  await q(`GRANT EXECUTE ON FUNCTION ops.fn_admitir_reservar_caterpillar_test(bigint,text,text,integer),
    ops.fn_reprocesar_reservar_caterpillar_test(bigint,text,text,integer),ops.fn_finalizar_caterpillar_test(bigint,text,text,text,text),
    operacion.fn_registrar_remision_caterpillar_test(bigint,text,text,bigint,date,text,jsonb) TO n8n_cat_test`);
  const beforeGate = (await q("SELECT md5(pg_get_functiondef('ops.fn_reprocesar_reservar_caterpillar_test(bigint,text,text,integer)'::regprocedure)) AS md5"))[0].md5;
  for(const signature of ['ops.fn_admitir_reservar_caterpillar_test(bigint,text,text,integer)','ops.fn_reprocesar_reservar_caterpillar_test(bigint,text,text,integer)'])
    console.log('RESTORED_GATE',signature,(await q("SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS raw_md5,md5(replace(pg_get_functiondef(to_regprocedure($1)),chr(13),'')) AS normalized_md5",[signature]))[0]);
  await q('GRANT EXECUTE ON FUNCTION operacion.reservar_folios_para_ejecucion(bigint,text,integer) TO n8n_cat_test');
  await assert.rejects(q(migration('precheck')),/LEGACY_OR_DML_BYPASS/);await q('ROLLBACK');
  await q('REVOKE EXECUTE ON FUNCTION operacion.reservar_folios_para_ejecucion(bigint,text,integer) FROM n8n_cat_test');
  await q('ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO n8n_cat_test');
  await q('ALTER DEFAULT PRIVILEGES GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO n8n_cat_test');
  await q(migration('precheck'));
  await q(migration('up'));await q(migration('postcheck'));
  assert.equal((await q('SELECT enabled FROM cat_recovery_test.settings'))[0].enabled, false);
  await assert.rejects(role('n8n_cat_test','UPDATE cat_recovery_test.settings SET enabled=true'),/permission denied/);
  await q(migration('down'));
  assert.equal((await q("SELECT md5(pg_get_functiondef('ops.fn_reprocesar_reservar_caterpillar_test(bigint,text,text,integer)'::regprocedure)) AS md5"))[0].md5, beforeGate);
  await q(migration('up'));
  console.log('PASS migration up(disabled) -> down(original gate restored) -> up(disabled)');
  await q('UPDATE cat_recovery_test.settings SET enabled=true'); // This pool is ONLY the verified private cluster.
  const { CaterpillarFolioRecoveryService } = require('../../../apps/api/dist/src/automations/remisiones-caterpillar/caterpillar-folio-recovery.service.js');
  const service = new CaterpillarFolioRecoveryService({ query: (sql, values) => role('daubert_hub_test_user',sql,values) },
    { get: key => key === 'database' ? { name: 'daubert_hub_test' } : true });

  async function seed() {
    await q('TRUNCATE core.empresas,security.users,ops.automatizaciones,operacion.series_documentales RESTART IDENTITY CASCADE');
    const sequences = await q("SELECT pg_get_serial_sequence(quote_ident(n.nspname)||'.'||quote_ident(c.relname),a.attname) AS seq FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE a.attidentity<>'' AND n.nspname IN ('core','ops','operacion','security')");
    for (const { seq } of sequences) await q('SELECT setval($1::regclass,10000,false)', [seq]);
    const company = (await q("INSERT INTO core.empresas(tipo_empresa,nombre_comercial) VALUES('CLIENTE','SYNTHETIC CAT') RETURNING empresa_id"))[0].empresa_id;
    const auto = (await q("INSERT INTO ops.automatizaciones(codigo,nombre) VALUES('REMISIONES_CATERPILLAR','Synthetic CAT') RETURNING automatizacion_id"))[0].automatizacion_id;
    const series = (await q("INSERT INTO operacion.series_documentales(codigo,nombre,siguiente_folio) VALUES('SYNTHETIC_CAT','Synthetic P2',111) RETURNING serie_id"))[0].serie_id;
    await q("INSERT INTO ops.automatizacion_series_proceso(automatizacion_id,llave_proceso,serie_id,empresa_cliente_id) VALUES($1,'CATERPILLAR_P2|P2|',$2,$3)", [auto, series, company]);
    const admin = (await q("INSERT INTO security.users(display_name,email,password_hash,role,must_change_password) VALUES('Synthetic ADMIN','synthetic@example.invalid','not-a-login-hash','ADMIN',false) RETURNING user_id"))[0].user_id;
    const sourceSha256 = hash('synthetic Excel source');
    async function document(name, marker) {
      const doc = (await q("INSERT INTO core.documentos(empresa_id,tipo_documento,nombre_archivo,ruta_archivo,hash_archivo) VALUES($1,'PROGRAMACION_ENTREGA',$2,$3,$4) RETURNING documento_id", [company,name,path.join(root,name),sourceSha256]))[0].documento_id;
      const manifest = { version:'CAT_OPERATIONAL_CONTENT_V1',scope:['CATERPILLAR_P2','P2','','CATERPILLAR MEXICO RECIBOS PLANTA 2.','CME940630QM2'],
        deliveryDate:'2026-11-06',grouping:'POR_ARTICULO',documents:Array.from({length:4},(_,i)=>({purchaseOrder:`SYNTH-${marker}-${i}`,lines:[[`${marker}-${i}`,'PART',`SYNTH-${marker}-${i}`,1,'PIEZAS']]})) };
      await q('SELECT ops.fn_guardar_snapshot_caterpillar_test($1,$2)', [doc,JSON.stringify(manifest)]); return doc;
    }
    const doc = await document('SYNTHETIC SOURCE.xlsx','A');
    const original = (await role('n8n_cat_test', "SELECT * FROM ops.fn_admitir_reservar_caterpillar_test($1,'original-worker','SYNTHETIC_CAT',4)", [doc]))[0];
    assert.equal(original.can_emit,true);
    await role('n8n_cat_test', "SELECT * FROM ops.fn_finalizar_caterpillar_test($1,'original-worker','ERROR','synthetic','Synthetic pre-PDF failure')", [original.ejecucion_id]);
    const f = {company,auto,series,admin,doc,original,sourceSha256,requestId:randomUUID(),document};
    f.originalRow = (await q('SELECT to_jsonb(r) AS data FROM operacion.reservas_folios r WHERE reserva_id=$1',[original.reserva_id]))[0].data;
    return f;
  }
  async function request(f) { return (await role('daubert_hub_test_user','SELECT cat_recovery_test.request($1,$2,$3,$4,true) AS result',[f.original.ejecucion_id,f.requestId,f.admin,'Synthetic no-delivery confirmation']))[0].result; }
  async function attest(f, manifest) {
    const proof = manifest || {version:'CAT_QUARANTINE_V1',requestId:f.requestId,reservationId:f.original.reserva_id,
      sourceSha256:f.sourceSha256,custody:'ISOLATED_UNRELEASED',outputClear:true,complete:true,files:[]};
    await role('cat_recovery_test_coordinator','SELECT cat_recovery_test.attest($1,$2,$3)',[f.requestId,JSON.stringify(proof),hash(JSON.stringify(proof))]);
  }
  const start = (f,worker='recovery-worker',after) => role('n8n_cat_test','SELECT cat_recovery_test.start($1,$2) AS result',[f.requestId,worker],after).then(rows=>rows[0].result);
  async function unchanged(f, next=115) {
    assert.deepEqual((await q('SELECT to_jsonb(r) AS data FROM operacion.reservas_folios r WHERE reserva_id=$1',[f.original.reserva_id]))[0].data,f.originalRow);
    assert.equal((await q('SELECT siguiente_folio::text AS n FROM operacion.series_documentales WHERE serie_id=$1',[f.series]))[0].n,String(next));
  }
  async function test(label, body) { const f=await seed(); await body(f); console.log('PASS',label); }
  await test('real gate + idempotent request/start preserves 111-114 and 115', async f => {
    assert.deepEqual(await request(f),await request(f)); await attest(f);
    const a=await start(f); const b=await start(f); assert.equal(a.canEmit,true);assert.equal(b.canEmit,false);assert.equal(a.executionId,b.executionId);
    await unchanged(f);
    const c=await pool.connect();
    try{
      await c.query('BEGIN');await c.query('SET LOCAL ROLE n8n_cat_test');
      await c.query("SELECT set_config('cat.recovery_request_id',$1,true)",[f.requestId]);
      const duplicate=(await c.query("SELECT * FROM ops.fn_reprocesar_reservar_caterpillar_test($1,'recovery-worker','SYNTHETIC_CAT',4)",[f.original.ejecucion_id])).rows[0];
      assert.equal(duplicate.can_emit,false);assert.equal(duplicate.decision,'BLOCK');await c.query('COMMIT');
    }finally{await c.query('ROLLBACK');c.release();}
    await assert.rejects(role('n8n_cat_test',"SELECT * FROM operacion.reservar_folios_para_ejecucion($1,'SYNTHETIC_CAT',4)",[a.executionId]),/permission denied/);
    await assert.rejects(q(migration('down')),/HISTORY_MUST_BE_RETAINED/); await q('ROLLBACK');
  });
  await test('two real concurrent sessions: one child, one emission right', async f => {
    await request(f);await attest(f);
    const blocker=await pool.connect();
    await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM operacion.series_documentales WHERE serie_id=$1 FOR UPDATE',[f.series]);
    const jobs=[start(f,'worker-A'),start(f,'worker-B')];
    try {
      let waiting=0;
      for(let i=0;i<100;i++){waiting=Number((await q("SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%cat_recovery_test.start%'"))[0].n);
        if(waiting>=2)break; await new Promise(r=>setTimeout(r,20));}
      assert.ok(waiting>=2,'Two real sessions must be observed waiting on locks');
      await blocker.query('COMMIT');
      const results=await Promise.all(jobs);assert.equal(results.filter(r=>r.canEmit).length,1);
      assert.equal(results[0].executionId,results[1].executionId);
      assert.equal(Number((await q('SELECT count(*) AS n FROM operacion.reservas_folios'))[0].n),2);await unchanged(f);
    }finally{await blocker.query('ROLLBACK');blocker.release();}
  });
  await test('conventional admission cannot bypass a pending recovery fence', async f => {
    await request(f);await attest(f);const other=await f.document('SYNTHETIC OTHER.xlsx','B');
    const results=await Promise.allSettled([start(f),role('n8n_cat_test',"SELECT * FROM ops.fn_admitir_reservar_caterpillar_test($1,'normal-worker','SYNTHETIC_CAT',4)",[other])]);
    assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.match(results[1].reason.message,/SERIES_FENCED/);await unchanged(f);
  });
  await test('rollback after reservation creation restores READY and leaves no child', async f => {
    await request(f);await attest(f);
    await assert.rejects(start(f,'failed-worker',async()=>{throw new Error('SYNTHETIC_AFTER_RESERVATION');}),/SYNTHETIC_AFTER_RESERVATION/);
    assert.equal(Number((await q('SELECT count(*) AS n FROM ops.ejecuciones_automatizacion WHERE reproceso_de_id=$1',[f.original.ejecucion_id]))[0].n),0);
    assert.equal((await start(f)).canEmit,true);await unchanged(f);
  });
  await test('real quarantine interruption -> reconcile -> SQL readiness -> gate; no premature reservation', async f => {
    await request(f);
    const folder=fs.mkdtempSync(path.join(path.dirname(root),'cat-recovery-phase2-files-'));
    const binding={requestId:f.requestId,reservationId:f.original.reserva_id,sourceSha256:f.sourceSha256,
      expected:Array.from({length:4},(_,i)=>({folio:String(111+i),name:`REM ${111+i} SYNTHETIC.pdf`}))};
    fs.writeFileSync(path.join(folder,'sandbox.json'),JSON.stringify({isolated:true}),{flag:'wx'});
    fs.writeFileSync(path.join(folder,'custody.json'),JSON.stringify({state:'ISOLATED_UNRELEASED',...binding}),{flag:'wx'});
    fs.mkdirSync(path.join(folder,'output'));
    for(const item of binding.expected.slice(0,3))fs.writeFileSync(path.join(folder,'output',item.name),`%PDF-synthetic-${item.folio}`,{flag:'wx'});
    assert.throws(()=>prepare(folder,binding,stage=>{if(stage==='after-copy')throw new Error('SYNTHETIC_QUARANTINE_FAILURE');}),/SYNTHETIC_QUARANTINE_FAILURE/);
    await assert.rejects(start(f),/QUARANTINE_UNPROVEN/);await unchanged(f);
    const prepared=prepare(folder,binding);
    assert.equal(prepared.manifest.files.length,3);
    await attest(f,prepared.manifest);
    assert.equal(Number((await q('SELECT count(*) AS n FROM ops.ejecuciones_automatizacion WHERE reproceso_de_id=$1',[f.original.ejecucion_id]))[0].n),0);
    await unchanged(f);assert.equal((await start(f)).canEmit,true);await unchanged(f);
  });
  await test('new generation failure preserves history; explicit recovery of failed child can retry', async f => {
    await request(f);await attest(f);const a=await start(f);
    await role('n8n_cat_test',"SELECT * FROM ops.fn_finalizar_caterpillar_test($1,'recovery-worker','ERROR','synthetic','Synthetic PDF failure')",[a.executionId]);
    assert.equal((await q('SELECT estatus FROM operacion.reservas_folios WHERE reserva_id=$1',[a.reservationId]))[0].estatus,'ABANDONADA');
    const child={...f,original:{...f.original,ejecucion_id:a.executionId,reserva_id:a.reservationId},requestId:randomUUID()};
    await request(child);await attest(child);assert.equal((await start(child,'retry-worker')).canEmit,true);await unchanged(f);
  });
  await test('later allocation or unknown custody rejects with no silent new range', async f => {
    await request(f);
    await assert.rejects(start(f),/QUARANTINE_UNPROVEN/);
    await attest(f);
    await q("SELECT * FROM operacion.reservar_folios('SYNTHETIC_CAT',1)");
    await assert.rejects(start(f),/RANGE_OR_SOURCE_CHANGED/);await unchanged(f,116);
  });
  await test('compiled NestJS service -> real SQL -> worker admission adapter, without n8n live', async f => {
    const assessment=await service.assess(f.original.ejecucion_id);assert.equal(assessment.databaseEligible,true);assert.equal(assessment.eligible,false);assert.equal(assessment.firstFolio,'111');
    assert.equal((await service.prepare(f.original.ejecucion_id,f.requestId,f.admin,'Synthetic ADMIN API request',true)).state,'PREPARING');
    await attest(f);assert.equal((await service.assess(f.original.ejecucion_id)).eligible,true);
    const call=()=>role('n8n_cat_test','SELECT * FROM cat_recovery_test.worker_admission($1,$2,$3)',[f.requestId,'adapter-worker',f.original.ejecucion_id]);
    const gate=(await call())[0];assert.equal(gate.can_emit,true);assert.equal(gate.decision,'ADMIT');assert.equal(gate.folio_inicial,'111');assert.equal(gate.folio_final,'114');
    const duplicate=(await call())[0];assert.equal(duplicate.can_emit,false);assert.equal(duplicate.ejecucion_id,gate.ejecucion_id);await unchanged(f);
    const html=path.join(root,'synthetic-html'),output=path.join(root,'synthetic-new-pdfs');
    fs.mkdirSync(html);fs.mkdirSync(output);
    for(let folio=111;folio<=114;folio++)fs.writeFileSync(path.join(html,`REM ${folio} SYNTHETIC.html`),
      `<!doctype html><html lang="es"><meta charset="utf-8"><title>TEST sintético ${folio}</title><h1>NO ENTREGAR — TEST AISLADO</h1><p>Folio sintético ${folio}</p></html>`,{flag:'wx'});
    assert.deepEqual(fs.readdirSync(output),[]); // Existing TEST converter may overwrite; never give it a reused destination.
    const converted=spawnSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',
      'C:/Users/06/Documents/Dropbox/Pruebas/REMISIONES CAT/05_ARCHIVOS AUXILIARES/SCRIPTS/convertir-cat-pdf.ps1',
      '-TempDir',html,'-OutDir',output],{encoding:'utf8',timeout:120000});
    fs.writeFileSync(path.join(root,'synthetic-conversion.log'),converted.stdout||'',{flag:'wx'});
    assert.equal(converted.status,0,'Unmodified TEST converter must succeed in the fresh isolated destination');
    const generated=[];
    for(let folio=111;folio<=114;folio++){
      const pdf=path.join(output,`REM ${folio} SYNTHETIC.pdf`);const bytes=fs.readFileSync(pdf);assert.ok(bytes.subarray(0,5).toString()==='%PDF-');
      generated.push({folio,path:pdf,size:bytes.length,sha256:hash(bytes)});
      await role('n8n_cat_test','SELECT * FROM operacion.fn_registrar_remision_caterpillar_test($1,$2,$3,$4,$5,$6,$7::jsonb)',
        [gate.ejecucion_id,'adapter-worker','SYNTHETIC_CAT',folio,'2026-11-06',pdf,JSON.stringify([{codigo_interno:`SYNTHETIC-${folio}`,cantidad_texto:'1 PZA'}])]);
    }
    fs.writeFileSync(path.join(root,'synthetic-generation.json'),JSON.stringify(generated,null,2),{flag:'wx'});
    await role('n8n_cat_test',"SELECT * FROM ops.fn_finalizar_caterpillar_test($1,'adapter-worker','COMPLETADA')",[gate.ejecucion_id]);
    assert.equal((await q('SELECT estatus FROM operacion.reservas_folios WHERE reserva_id=$1',[gate.reserva_id]))[0].estatus,'APLICADA');
    assert.equal(Number((await q('SELECT count(*) AS n FROM operacion.remisiones WHERE ejecucion_id=$1',[gate.ejecucion_id]))[0].n),4);await unchanged(f);
    console.log('ISOLATED_REAL_TEST_CONVERTER_PASS: 4 synthetic PDFs, registered and completed; no live n8n execution');
  });
  console.log('NATIVE_INTEGRATION_PASS (isolated PostgreSQL 18, real restored schema/functions); LIVE_TEST_NOT_MIGRATED; LIVE_N8N_E2E_PENDING');
};
