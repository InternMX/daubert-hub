// PREPARED ONLY. DO NOT RUN without explicit authorization to write synthetic data in TEST.
// No dotenv loading, production fallback, external API target, n8n request or PDF generation.
const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const {createHash}=require('node:crypto');
const {spawn}=require('node:child_process');
const {Pool}=require('pg');
const {assert,guardedUrl,markerFor,authorize,childEnvironment}=require('./support/caterpillar-cancellation-test-guards.cjs');
const apiDir=path.resolve(__dirname,'..');
const migrations=path.resolve(apiDir,'../../database/migrations/daubert_global');
const prefix='20261020_013_caterpillar_cancellation';
const readSql=phase=>fs.readFileSync(path.join(migrations,`${prefix}.${phase}.sql`),'utf8');
const hash=()=>createHash('sha256').update(readSql('up').replace(/\r/g,'')).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function live(client,role) {
  const r=(await client.query('SELECT current_database() AS db,current_user AS role,inet_server_addr()::text AS host,inet_server_port() AS port')).rows[0];
  assert(r.db==='daubert_hub_test'&&r.role===role,'Live TEST identity mismatch');return r;
}
async function fingerprint(client) {
  const tables=['operacion.series_documentales','operacion.reservas_folios','ops.ejecuciones_automatizacion',
    'core.correos_notificacion_pago','core.resultados_notificacion_pago'];
  const result={};
  for(const table of tables) result[table]=(await client.query(`SELECT md5(COALESCE(string_agg(row_to_json(x)::text,'|' ORDER BY row_to_json(x)::text),'')) AS fp FROM ${table} x`)).rows[0].fp;
  return result;
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function freePort(){const s=net.createServer();await new Promise((r,j)=>s.once('error',j).listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function transaction(db,marker,action){
  await db.query('BEGIN');try{await db.query("SELECT set_config('app.origin','DAUBERT_HUB_TEST',true),set_config('app.request_id',$1,true)",[marker]);
    const value=await action();await db.query('COMMIT');return value;
  }catch(e){await db.query('ROLLBACK');throw e;}
}
async function setup(db,marker){
  return transaction(db,marker,async()=>{
    assert(!(await db.query('SELECT 1 FROM core.empresas WHERE nombre_comercial=$1',[marker])).rowCount,'Run already has fixtures; verify/cleanup first');
    const company=(await db.query("INSERT INTO core.empresas(tipo_empresa,nombre_comercial,estatus) VALUES('OTRO',$1,'ACTIVO') RETURNING empresa_id::text",[marker])).rows[0].empresa_id;
    const series=(await db.query("INSERT INTO operacion.series_documentales(codigo,nombre,siguiente_folio,folio_minimo_ajustable,estatus) VALUES($1,$1,1000000,1,'INACTIVA') RETURNING serie_id::text",[marker])).rows[0].serie_id;
    const cat=(await db.query("SELECT automatizacion_id::text FROM ops.automatizaciones WHERE codigo='REMISIONES_CATERPILLAR'")).rows[0]?.automatizacion_id;
    assert(cat,'Caterpillar catalog row missing');
    const other=(await db.query("INSERT INTO ops.automatizaciones(codigo,nombre,estatus) VALUES($1,$1,'INACTIVA') RETURNING automatizacion_id::text",[marker+'_OTHER'])).rows[0].automatizacion_id;
    const executions=[];
    for(const [i,auto,state] of [[0,cat,'COMPLETADA'],[1,cat,'PROCESANDO'],[2,other,'COMPLETADA']]){
      const doc=(await db.query("INSERT INTO core.documentos(empresa_id,tipo_documento,nombre_archivo,ruta_archivo,origen) VALUES($1,'E2E_CANCELLATION',$2,$2,'OTRO') RETURNING documento_id::text",[company,`${marker}_${i}.synthetic`])).rows[0].documento_id;
      const exec=(await db.query("INSERT INTO ops.ejecuciones_automatizacion(automatizacion_id,documento_origen_id,run_name,estado,finalizada_en) VALUES($1,$2,$3,$4,CASE WHEN $4='PROCESANDO' THEN NULL ELSE now() END) RETURNING ejecucion_id::text",[auto,doc,marker,state])).rows[0].ejecucion_id;
      executions.push(exec);
    }
    const remissions=[];
    for(let i=1;i<=7;i++){
      const exec=executions[i===6?1:i===7?2:0];
      const r=(await db.query("INSERT INTO operacion.remisiones(serie_id,folio,empresa_cliente_id,ejecucion_id,fecha_documento,pdf_path,estatus,motivo_cancelacion) VALUES($1,$2,$3,$4,CURRENT_DATE,$5,$6,$7) RETURNING remision_id::text",[series,i,company,exec,`E2E-NO-FILE/${marker}/${i}.pdf`,i===5?'CANCELADA':'GENERADA',i===5?'Synthetic historical cancellation':null])).rows[0].remision_id;
      await db.query("INSERT INTO operacion.remision_detalle(remision_id,codigo_interno,part_number,descripcion,cantidad_texto) VALUES($1,'E2E','E2E','Synthetic, no document emitted','1 pieza')",[r]);
      remissions.push(r);
    }
    await db.query("INSERT INTO operacion.reservas_folios(ejecucion_id,serie_id,folio_inicial,folio_final,cantidad,estatus,finalizada_en) VALUES($1,$2,1,5,5,'APLICADA',now())",[executions[0],series]);
    return {company,series,executions,remissions};
  });
}
async function verify(db,state){
  const f=state.fixtures;assert(f,'No fixture evidence found');
  assert(same(await fingerprint(db),state.protected),'Protected series/reservations/execution/payment data changed; investigate, NEVER restore blindly');
  const rows=(await db.query('SELECT remision_id::text,estatus,motivo_cancelacion,pdf_path FROM operacion.remisiones WHERE remision_id=ANY($1::bigint[]) ORDER BY folio',[f.remissions])).rows;
  assert(rows.length===7,'Synthetic remissions missing');
  assert(rows[0].estatus==='CANCELADA'&&rows[1].estatus==='GENERADA'&&rows[2].estatus==='GENERADA'&&rows[3].estatus==='CANCELADA','Unexpected cancellation/rollback/sibling state');
  assert(rows.every(r=>r.pdf_path.startsWith(`E2E-NO-FILE/${state.marker}/`)),'Synthetic PDF references changed');
  const audit=(await db.query('SELECT remision_id::text,motivo,usuario_id::text,usuario_email,usuario_nombre,cancelada_en,request_id FROM operacion.cancelaciones_remisiones WHERE remision_id=ANY($1::bigint[])',[f.remissions])).rows;
  assert(audit.length===2&&audit.every(r=>r.usuario_id===state.adminId&&r.usuario_nombre&&r.usuario_email&&r.cancelada_en&&r.request_id),'Audit actor/date/retry mismatch');
  assert((await db.query('SELECT count(*)::int AS n FROM operacion.remision_detalle WHERE remision_id=ANY($1::bigint[])',[f.remissions])).rows[0].n===7,'Document details changed');
}
async function clean(db,marker){
  const token=marker.slice('HUB_CAT_CANCEL_E2E_'.length).toLowerCase();
  // Failpoint names are deterministic, UUID-derived identifiers, never arbitrary user input.
  await db.query(`DROP TRIGGER IF EXISTS cat_cancel_fail_${token} ON operacion.cancelaciones_remisiones`);
  await db.query(`DROP FUNCTION IF EXISTS operacion.fn_cat_cancel_fail_${token}()`);
  await transaction(db,marker,async()=>{
    const rems=(await db.query('SELECT r.remision_id::text FROM operacion.remisiones r JOIN ops.ejecuciones_automatizacion e USING(ejecucion_id) JOIN core.documentos d ON d.documento_id=e.documento_origen_id JOIN core.empresas c ON c.empresa_id=d.empresa_id WHERE e.run_name=$1 AND c.nombre_comercial=$1',[marker])).rows.map(r=>r.remision_id);
    await db.query('DELETE FROM operacion.cancelaciones_remisiones WHERE remision_id=ANY($1::bigint[])',[rems]);
    await db.query('DELETE FROM operacion.remision_detalle WHERE remision_id=ANY($1::bigint[])',[rems]);
    await db.query('DELETE FROM operacion.remisiones WHERE remision_id=ANY($1::bigint[])',[rems]);
    await db.query('DELETE FROM operacion.reservas_folios WHERE ejecucion_id IN (SELECT e.ejecucion_id FROM ops.ejecuciones_automatizacion e JOIN core.documentos d ON d.documento_id=e.documento_origen_id JOIN core.empresas c ON c.empresa_id=d.empresa_id WHERE e.run_name=$1 AND c.nombre_comercial=$1)',[marker]);
    await db.query('DELETE FROM ops.ejecuciones_automatizacion WHERE run_name=$1 AND documento_origen_id IN(SELECT d.documento_id FROM core.documentos d JOIN core.empresas c USING(empresa_id) WHERE c.nombre_comercial=$1)',[marker]);
    await db.query('DELETE FROM core.documentos WHERE empresa_id IN(SELECT empresa_id FROM core.empresas WHERE nombre_comercial=$1) AND tipo_documento=\'E2E_CANCELLATION\'',[marker]);
    await db.query('DELETE FROM operacion.series_documentales WHERE codigo=$1 AND nombre=$1',[marker]);
    await db.query('DELETE FROM ops.automatizaciones WHERE codigo=$1 AND nombre=$1',[marker+'_OTHER']);
    await db.query('DELETE FROM core.empresas WHERE nombre_comercial=$1 AND tipo_empresa=\'OTRO\'',[marker]);
    const users=(await db.query("SELECT user_id::text FROM security.users WHERE left(lower(email),length($1))=lower($1) AND right(lower(email),13)='@example.test'",[marker])).rows.map(r=>r.user_id);
    await db.query('DELETE FROM security.sessions WHERE user_id=ANY($1::bigint[])',[users]);
    await db.query('DELETE FROM security.users WHERE user_id=ANY($1::bigint[])',[users]);
    await db.query("DELETE FROM audit.cambios WHERE request_id=$1 OR (esquema='security' AND tabla='users' AND registro_id=ANY($2::text[]))",[marker,users.map(id=>`user_id=${id}`)]);
  });
  assert(!(await db.query('SELECT 1 FROM core.empresas WHERE nombre_comercial=$1',[marker])).rowCount,'Cleanup incomplete');
  assert(!(await db.query('SELECT 1 FROM ops.ejecuciones_automatizacion WHERE run_name=$1',[marker])).rowCount,'Execution cleanup incomplete');
  assert(!(await db.query('SELECT 1 FROM operacion.series_documentales WHERE codigo=$1',[marker])).rowCount,'Series cleanup incomplete');
  assert(!(await db.query("SELECT 1 FROM security.users WHERE left(lower(email),length($1))=lower($1) AND right(lower(email),13)='@example.test'",[marker])).rowCount,'User cleanup incomplete');
}
async function e2e(db,adminPool,runtimeUrl,state,save){
  state.fixtures=await setup(db,state.marker);save(); // Persistent, credential-free evidence before HTTP.
  state.protected=await fingerprint(db);save();
  const port=await freePort();const base=`http://127.0.0.1:${port}/api`;
  assert(fs.existsSync(path.join(apiDir,'dist/src/main.js')),'Build API first');
  const api=spawn(process.execPath,['dist/src/main.js'],{cwd:apiDir,env:childEnvironment(process.env,runtimeUrl,port),stdio:['ignore','ignore','ignore']});
  let blocker;
  const token=state.runId.replace(/-/g,'');
  const dropFail=()=>db.query(`DROP TRIGGER IF EXISTS cat_cancel_fail_${token} ON operacion.cancelaciones_remisiones; DROP FUNCTION IF EXISTS operacion.fn_cat_cancel_fail_${token}()`);
  try{
    let ready=false;for(let i=0;i<100;i++){assert(api.exitCode===null,'TEST API child exited');try{if((await fetch(base+'/health',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}await sleep(100);}assert(ready,'TEST API startup timed out');
    const {createAuthenticatedTestSession}=require('./support/test-auth.cjs');
    const old=process.env.TEST_DATABASE_ADMIN_URL;process.env.TEST_DATABASE_ADMIN_URL=process.env.TEST_DATABASE_URL_MIGRATOR;
    let admin,general;
    try{admin=await createAuthenticatedTestSession(base,state.marker+'_ADMIN',{role:'ADMIN'});general=await createAuthenticatedTestSession(base,state.marker+'_GENERAL',{role:'GENERAL'});}finally{if(old===undefined)delete process.env.TEST_DATABASE_ADMIN_URL;else process.env.TEST_DATABASE_ADMIN_URL=old;}
    state.adminId=admin.userId;save();
    const request=async(route,cookie,body)=>{const response=await fetch(base+route,{method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});return {status:response.status,body:await response.json()};};
    const f=state.fixtures;
    const detail=()=>request(`/automations/remissions/caterpillar/executions/${f.executions[0]}`,admin.cookie);
    const before=(await detail()).body.data;assert(before?.remittances?.length===5,'Synthetic detail unavailable');
    const revisions=new Map(before.remittances.map(r=>[r.remissionId,r.revision]));
    const route=(exec,rem)=>`/automations/remissions/caterpillar/executions/${exec}/remittances/${rem}/cancel`;
    const cancel=(rem,cookie=admin.cookie,exec=f.executions[0])=>request(route(exec,rem),cookie,{reason:'Synthetic cancellation',expectedRevision:revisions.get(rem)||revisions.get(f.remissions[0])});
    assert((await cancel(f.remissions[0],null)).status===401,'Anonymous request allowed');
    assert((await cancel(f.remissions[0],general.cookie)).status===403,'GENERAL request allowed');
    assert((await request(route(f.executions[0],f.remissions[0]),admin.cookie,{reason:' ',expectedRevision:revisions.get(f.remissions[0])})).status===400,'Blank reason allowed');
    const first=await cancel(f.remissions[0]);assert(first.status===200&&first.body.data.status==='CANCELLED','ADMIN cancellation failed');
    const repeat=await cancel(f.remissions[0]);assert(repeat.body.data.status==='ALREADY_CANCELLED'&&same(repeat.body.data.cancellation,first.body.data.cancellation),'Retry changed history');
    const historical=await cancel(f.remissions[4]);assert(historical.body.data.status==='ALREADY_CANCELLED'&&historical.body.data.cancellation===null,'Historical audit fabricated');
    assert((await cancel(f.remissions[6],admin.cookie,f.executions[2])).status===404,'Foreign automation cancellation allowed');
    assert((await cancel(f.remissions[5])).status===404,'Foreign execution remission allowed');
    assert((await cancel(f.remissions[5],admin.cookie,f.executions[1])).status===409,'PROCESSING cancellation allowed');
    await db.query('UPDATE operacion.remisiones SET motivo_cancelacion=NULL WHERE remision_id=$1',[f.remissions[1]]);
    assert((await cancel(f.remissions[1])).status===409,'Stale revision not detected');
    await db.query(`CREATE FUNCTION operacion.fn_cat_cancel_fail_${token}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END $$;
      CREATE TRIGGER cat_cancel_fail_${token} BEFORE INSERT ON operacion.cancelaciones_remisiones FOR EACH ROW WHEN(NEW.remision_id=${f.remissions[2]}::bigint) EXECUTE FUNCTION operacion.fn_cat_cancel_fail_${token}()`);
    try{assert((await cancel(f.remissions[2])).status===503,'Audit failure did not abort');}finally{await dropFail();}
    // Hold ONLY the synthetic execution with the verified TEST admin connection.
    const latch=await adminPool.connect();blocker=latch;await latch.query('BEGIN');
    await latch.query('SELECT 1 FROM ops.ejecuciones_automatizacion WHERE ejecucion_id=$1 FOR UPDATE',[f.executions[0]]);
    const concurrent=Promise.all([cancel(f.remissions[3]),cancel(f.remissions[3])]);
    let waiting=false;for(let i=0;i<60;i++){const n=(await db.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename='daubert_hub_test_user' AND wait_event_type='Lock' AND query LIKE '%fn_cancelar_remision_caterpillar%'" )).rows[0].n;if(n>=2){waiting=true;break;}await sleep(50);}
    await latch.query('COMMIT');latch.release();blocker=null;
    const outcomes=await concurrent;assert(waiting,'Two real TEST waiters were not observed');assert(outcomes.every(r=>r.status===200)&&outcomes.map(r=>r.body.data.status).sort().join(',')==='ALREADY_CANCELLED,CANCELLED','Concurrent cancellation mismatch');
    for(const endpoint of ['/automations/remissions/audi/executions?page=1&pageSize=1','/automations/payment-notifications?page=1&pageSize=1'])assert((await request(endpoint,general.cookie)).status===200,'Read-only cross-module regression');
    await verify(db,state);state.stage='e2e-passed';save();
  }finally{if(blocker){await blocker.query('ROLLBACK').catch(()=>{});blocker.release();}await dropFail();
    if(api.exitCode===null)await new Promise(resolve=>{api.once('exit',resolve);api.kill();});}
}
async function run(args=process.argv.slice(2)){
  const action=args[0];authorize(action,args);
  const runId=args[args.indexOf('--run-id')+1];const marker=markerFor(args.includes('--run-id')?runId:undefined);
  const adminUrl=guardedUrl(process.env.TEST_DATABASE_URL_MIGRATOR,'postgres');
  const runtimeUrl=guardedUrl(process.env.TEST_DATABASE_URL,'daubert_hub_test_user');
  assert(adminUrl.hostname===runtimeUrl.hostname&&(adminUrl.port||'5432')===(runtimeUrl.port||'5432'),'TEST connections must share server/database');
  const pool=new Pool({connectionString:adminUrl.toString(),connectionTimeoutMillis:5000});
  const runtimePool=new Pool({connectionString:runtimeUrl.toString(),connectionTimeoutMillis:5000});
  const db=await pool.connect();
  const evidence=path.resolve(apiDir,`../../node_modules/.cache/cat-cancel-e2e/${runId}.json`);
  let state=fs.existsSync(evidence)?JSON.parse(fs.readFileSync(evidence,'utf8')):{runId,marker};
  assert(state.runId===runId&&state.marker===marker,'Run evidence identity mismatch');
  const save=()=>{fs.mkdirSync(path.dirname(evidence),{recursive:true});fs.writeFileSync(evidence,JSON.stringify(state,null,2));};
  try{
    const identity=await live(db,'postgres');await live(runtimePool,'daubert_hub_test_user');
    if(state.identity)assert(same(state.identity,identity),'Evidence belongs to another TEST server');
    state.identity=identity;
    await db.query("SET statement_timeout='20s'; SET lock_timeout='5s'");
    const lock=(await db.query("SELECT pg_try_advisory_lock(hashtextextended('CAT_CANCEL_E2E_RUNNER',0)) AS ok")).rows[0].ok;
    assert(lock,'Another E2E run is active');
    if(action==='precheck'){await db.query(readSql('precheck'));state.baseline=await fingerprint(db);state.migrationHash=hash();state.stage='prechecked';save();}
    if(action==='apply'){assert(state.stage==='prechecked'&&state.migrationHash===hash(),'Run precheck for this exact SQL first');assert(same(await fingerprint(db),state.baseline),'Precheck baseline changed');await db.query(readSql('up'));state.stage='applied';save();}
    if(action==='postcheck'){await db.query(readSql('postcheck'));if(state.baseline)assert(same(await fingerprint(db),state.baseline),'DDL changed protected data or background activity occurred');state.stage='postchecked';save();}
    if(action==='e2e'){assert(state.stage==='postchecked','Postcheck required first');await db.query(readSql('postcheck'));await e2e(db,pool,runtimeUrl,state,save);}
    if(action==='verify'){await db.query(readSql('postcheck'));await verify(db,state);}
    if(action==='cleanup'){await clean(db,marker);if(state.baseline)assert(same(await fingerprint(db),state.baseline),'Post-cleanup baseline changed; investigate background activity');state.stage='cleaned';save();}
    console.log(`CATERPILLAR_TEST_${action.toUpperCase()}_PASS run=${runId}`);
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.query("SELECT pg_advisory_unlock(hashtextextended('CAT_CANCEL_E2E_RUNNER',0))").catch(()=>{});db.release();await runtimePool.end();await pool.end();}
}
if(require.main===module)run().catch(error=>{console.error('CATERPILLAR_TEST_FAILED; raw errors suppressed; SQLSTATE='+(/^[A-Z0-9]{5}$/.test(error.code||'')?error.code:'NONE'));process.exitCode=1;});
module.exports={run};
