// Native PostgreSQL security regressions. Own loopback cluster only; never reads TEST_* or DB_*.
const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const {randomUUID}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {Pool}=require('pg');
const {assert}=require('./support/caterpillar-cancellation-test-guards.cjs');
async function run(){
  const bin=process.argv[process.argv.indexOf('--bin')+1];
  assert(process.argv.includes('--bin')&&bin,'Local --bin required');
  const root=path.resolve(__dirname,'../../../node_modules/.cache');
  fs.mkdirSync(root,{recursive:true});
  const data=path.join(root,`cat-cancel-privileges-${randomUUID()}`);
  const env={};for(const k of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE'])if(process.env[k])env[k]=process.env[k];
  const command=(name,args)=>{const r=spawnSync(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{env,encoding:'utf8',timeout:30000,windowsHide:true});assert(r.status===0,`Isolated ${name} failed (raw output suppressed)`);};
  let started=false,owner,db;
  try{
    command('initdb',['-D',data,'-U','postgres','--auth=trust','--no-locale','--encoding=UTF8']);
    const server=net.createServer();await new Promise((r,j)=>server.once('error',j).listen(0,'127.0.0.1',r));
    const port=server.address().port;await new Promise(r=>server.close(r));
    started=true;command('pg_ctl',['-D',data,'-l',path.join(data,'test.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
    owner=new Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres',connectionTimeoutMillis:3000});
    assert(path.resolve((await owner.query('SHOW data_directory')).rows[0].data_directory)===path.resolve(data),'Not the owned cluster');
    await owner.query('CREATE DATABASE daubert_hub_test');
    db=new Pool({host:'127.0.0.1',port,user:'postgres',database:'daubert_hub_test',max:1});
    await db.query(fs.readFileSync(path.join(__dirname,'fixtures/caterpillar-cancellation-schema.sql'),'utf8'));
    const dir=path.resolve(__dirname,'../../../database/migrations/daubert_global');
    const sql=phase=>fs.readFileSync(path.join(dir,`20261020_013_caterpillar_cancellation.${phase}.sql`),'utf8');
    for(const phase of ['precheck','up','postcheck'])await db.query(sql(phase));
    await db.query('CREATE ROLE daubert_backup LOGIN INHERIT; GRANT pg_read_all_data TO daubert_backup; CREATE ROLE unapproved LOGIN; CREATE ROLE indirect_writer NOLOGIN');
    // Exercise the complete production postcheck envelope with the legitimate backup role.
    await db.query(sql('postcheck'));
    const permissions=(await db.query(`SELECT
      has_table_privilege('daubert_backup','operacion.cancelaciones_remisiones','SELECT') AS ledger_read,
      has_sequence_privilege('daubert_backup','operacion.cancelaciones_remisiones_cancelacion_id_seq','SELECT') AS sequence_read,
      has_sequence_privilege('daubert_backup','operacion.cancelaciones_remisiones_cancelacion_id_seq','USAGE,UPDATE') AS sequence_modify`)).rows[0];
    assert(permissions.ledger_read&&permissions.sequence_read&&!permissions.sequence_modify,'Read-only backup semantics differ');
    // Scenarios use the UNCHANGED SQL body inside an outer transaction so grants/roles roll
    // back after every case. Only BEGIN READ ONLY / COMMIT wrappers are omitted in this harness.
    const body=sql('postcheck').replace(/^BEGIN READ ONLY;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
    const f='operacion.fn_cancelar_remision_caterpillar(bigint,bigint,text,text,bigint,text)';
    const table='operacion.cancelaciones_remisiones';
    const seq='operacion.cancelaciones_remisiones_cancelacion_id_seq';
    const cases=[['legitimate inherited backup read','',null]];
    for(const role of ['daubert_backup','unapproved','n8n_app','n8n_cat_test','PUBLIC'])cases.push([`${role} EXECUTE`,`GRANT EXECUTE ON FUNCTION ${f} TO ${role}`,'privilege']);
    for(const role of ['daubert_backup','unapproved','PUBLIC']){
      for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES'])cases.push([`${role} ledger ${privilege}`,`GRANT ${privilege} ON ${table} TO ${role}`,'privilege']);
      for(const privilege of ['INSERT','UPDATE','REFERENCES'])cases.push([`${role} column ${privilege}`,`GRANT ${privilege}(motivo) ON ${table} TO ${role}`,'privilege']);
      for(const privilege of ['USAGE','UPDATE'])cases.push([`${role} sequence ${privilege}`,`GRANT ${privilege} ON SEQUENCE ${seq} TO ${role}`,'privilege']);
    }
    for(const role of ['unapproved','n8n_app','PUBLIC']){
      cases.push([`${role} ledger SELECT`,`GRANT SELECT ON ${table} TO ${role}`,'privilege']);
      cases.push([`${role} column SELECT`,`GRANT SELECT(motivo) ON ${table} TO ${role}`,'privilege']);
      cases.push([`${role} sequence SELECT`,`GRANT SELECT ON SEQUENCE ${seq} TO ${role}`,'privilege']);
    }
    cases.push(
      ['unapproved inherited read','GRANT pg_read_all_data TO unapproved','privilege'],
      ['backup without read membership','REVOKE pg_read_all_data FROM daubert_backup','backup role policy'],
      ['backup with write membership','GRANT pg_write_all_data TO daubert_backup','backup role policy'],
      ['backup with indirect write','GRANT UPDATE ON operacion.cancelaciones_remisiones TO indirect_writer; GRANT indirect_writer TO daubert_backup','backup role policy'],
      ['backup SET-only membership','GRANT indirect_writer TO daubert_backup WITH INHERIT FALSE','backup role policy'],
      ['backup schema CREATE','GRANT CREATE ON SCHEMA operacion TO daubert_backup','backup role policy'],
      ['backup administrative attribute','ALTER ROLE daubert_backup CREATEROLE','backup role policy'],
      ['backup superuser','ALTER ROLE daubert_backup SUPERUSER','backup role policy'],
      ['backup bypass RLS','ALTER ROLE daubert_backup BYPASSRLS','backup role policy'],
      ['Hub missing EXECUTE',`REVOKE EXECUTE ON FUNCTION ${f} FROM daubert_hub_test_user`,'Hub privilege'],
      ['Hub missing ledger SELECT',`REVOKE SELECT ON ${table} FROM daubert_hub_test_user`,'Hub privilege'],
      ['Hub sequence SELECT',`GRANT SELECT ON SEQUENCE ${seq} TO daubert_hub_test_user`,'privilege'],
      ['Hub column update on remissions','GRANT UPDATE(estatus) ON operacion.remisiones TO daubert_hub_test_user','Hub privilege']
    );
    for(const [name,mutation,expected] of cases){
      await db.query('BEGIN');
      try{
        if(mutation)await db.query(mutation);
        let error;try{await db.query(body);}catch(e){error=e;}
        if(expected)assert(error&&error.code==='P0001'&&error.message.includes(expected),`Expected policy rejection: ${name}`);
        else assert(!error,`Unexpected policy rejection: ${name}`);
      }finally{await db.query('ROLLBACK');}
      console.log(`PRIVILEGE_CASE_PASS ${name}`);
    }
    await db.query(sql('postcheck'));
    console.log(`NATIVE_PRIVILEGE_POLICY_PASS cases=${cases.length} full_postcheck=true no_Daubert_connections=true`);
  }finally{
    for(const p of [db,owner])if(p)await p.end();
    if(started&&fs.existsSync(path.join(data,'postmaster.pid')))command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
    if(fs.existsSync(data))fs.rmSync(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
}
if(require.main===module)run().catch(e=>{console.error('NATIVE_PRIVILEGE_POLICY_FAILED: '+e.message);process.exitCode=1;});
