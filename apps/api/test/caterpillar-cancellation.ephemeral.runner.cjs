// SAFE standalone native PostgreSQL concurrency test. Never reads any DB_* or TEST_* credentials.
// Creates its OWN cluster under this worktree's node_modules cache; no Docker/services touched.
const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const {randomUUID}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {Pool}=require('pg');
const {assert}=require('./support/caterpillar-cancellation-test-guards.cjs');
async function freePort() { const s=net.createServer(); await new Promise((r,j)=>s.once('error',j).listen(0,'127.0.0.1',r)); const p=s.address().port; await new Promise(r=>s.close(r)); return p; }
async function run() {
  const bin=process.argv[process.argv.indexOf('--bin')+1];
  assert(process.argv.includes('--bin') && bin,'--bin with local PostgreSQL binaries required');
  const suffix=process.platform==='win32'?'.exe':'';
  const root=path.resolve(__dirname,'../../../node_modules/.cache');
  const data=path.join(root,`cat-cancel-native-${randomUUID()}`);
  fs.mkdirSync(root,{recursive:true});
  const command=(name,args)=>{const r=spawnSync(path.join(bin,name+suffix),args,{encoding:'utf8',timeout:30000,windowsHide:true}); assert(r.status===0,`Ephemeral ${name} failed (output suppressed)`);};
  const files=path.resolve(__dirname,'../../../database/migrations/daubert_global');
  let started=false, owner, admin, runtime, a, b;
  try {
    command('initdb',['-D',data,'-U','postgres','--auth=trust','--no-locale','--encoding=UTF8']);
    const port=await freePort();
    started=true;
    command('pg_ctl',['-D',data,'-l',path.join(data,'test.log'),'-o',`-h 127.0.0.1 -p ${port} -c fsync=off`,'-w','start']);
    owner=new Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',connectionTimeoutMillis:3000});
    const setting=(await owner.query('SHOW data_directory')).rows[0].data_directory;
    assert(path.resolve(setting)===path.resolve(data),'Server is NOT the owned ephemeral cluster');
    await owner.query('CREATE DATABASE daubert_hub_test');
    admin=new Pool({host:'127.0.0.1',port,user:'postgres',database:'daubert_hub_test'});
    await admin.query(fs.readFileSync(path.join(__dirname,'fixtures/caterpillar-cancellation-schema.sql'),'utf8'));
    for(const phase of ['precheck','up','postcheck']) await admin.query(fs.readFileSync(path.join(files,`20261020_013_caterpillar_cancellation.${phase}.sql`),'utf8'));
    await admin.query(`INSERT INTO ops.ejecuciones_automatizacion VALUES (90001,1,'COMPLETADA');
      INSERT INTO operacion.remisiones VALUES (91001,90001,5,1,'GENERADA',null,'synthetic.pdf','2026-01-01T00:00:00.123456Z');`);
    runtime=new Pool({host:'127.0.0.1',port,user:'daubert_hub_test_user',database:'daubert_hub_test'});
    a=await runtime.connect(); b=await runtime.connect();
    const pid=(await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const sql='SELECT * FROM operacion.fn_cancelar_remision_caterpillar($1,$2,$3,$4,$5,$6)';
    const args=['90001','91001','2026-01-01T00:00:00.123456Z','Native concurrency',1,'native-test'];
    await a.query('BEGIN');
    assert((await a.query(sql,args)).rows[0].resultado==='CANCELLED','First cancellation failed');
    let finished=false;
    const pending=b.query(sql,args).then(r=>{finished=true;return r;});
    let waiting=false;
    for(let i=0;i<100;i++) { const row=(await admin.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0];
      if(row?.wait_event_type==='Lock'){waiting=true;break;} await new Promise(r=>setTimeout(r,20)); }
    assert(waiting&&!finished,'Did not observe a real second backend waiting for a lock');
    await a.query('COMMIT');
    assert((await pending).rows[0].resultado==='ALREADY_CANCELLED','Concurrent retry failed');
    assert((await admin.query('SELECT count(*)::int AS n FROM operacion.cancelaciones_remisiones')).rows[0].n===1,'Duplicate audit');
    console.log('NATIVE_CONCURRENCY_PASS: two real PostgreSQL backends; lock wait observed; one audit; idempotent retry.');
  } finally {
    if(a){await a.query('ROLLBACK').catch(()=>{});a.release();} if(b)b.release();
    for(const pool of [runtime,admin,owner]) if(pool)await pool.end();
    if(started && fs.existsSync(path.join(data,'postmaster.pid')))command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
    if(fs.existsSync(data))fs.rmSync(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
}
if(require.main===module)run().catch(()=>{console.error('EPHEMERAL_TEST_FAILED (no Daubert connection used)');process.exitCode=1;});
