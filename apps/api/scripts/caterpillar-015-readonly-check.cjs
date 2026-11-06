// 5E: READ ONLY compatibility/precheck. No .env, DDL, writes, workflow API or alternate credentials.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { assert, guardedUrl } = require('../test/support/caterpillar-cancellation-test-guards.cjs');
const root = path.resolve(__dirname, '../../..');
const precheckFile = path.join(root, 'database/migrations/daubert_global/20261022_015_caterpillar_atomic_admission_test.precheck.sql');
const precheckHash = 'f0e7413d134a42e73c63e90efeb10d0f5695da5397bf563d8af162878c6d0253';
const signatures = [
  'core.fn_crear_o_resolver_documento(bigint,text,text,text,text,date,text)',
  'ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)',
  'operacion.reservar_folios_para_ejecucion(bigint,text,integer)',
  'operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)',
  'ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)',
  'ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)',
  'ops.fn_resolver_ejecucion_para_reproceso(bigint)'
];
function exportMetadata() {
  const files = ['C:/Users/06/Downloads/MANUAL TEST REMISIONES CAT.json',
    'C:/Users/06/Downloads/Remisiones CAT Produccion PG.json',
    ...['remisiones-caterpillar','remisiones-audi'].flatMap(name => ['test','prod'].map(env => path.join(root,'n8n/workflows',name,env,'workflow.json')))];
  const available = files.filter(file => fs.existsSync(file)).map(file => ({ file, workflow: JSON.parse(fs.readFileSync(file,'utf8')) }));
  const target = available.find(x => path.basename(x.file) === 'MANUAL TEST REMISIONES CAT.json');
  const credentialIds = new Set(target?.workflow.nodes.flatMap(n => Object.entries(n.credentials || {}).filter(([type,c]) => type==='postgres' && c.id).map(([,c]) => c.id)) || []);
  return {
    evidence: 'available local exports only; not the live n8n credential/workflow inventory',
    liveCredentialUserVerified: false, liveCredentialExclusiveVerified: false,
    workflows: available.map(({file,workflow}) => ({ file: path.basename(file), name: workflow.name, id: workflow.id,
      activeInExport: workflow.active, postgresReferences: [...new Map(
        workflow.nodes.flatMap(n => Object.entries(n.credentials || {}).filter(([type]) => type === 'postgres')
          .map(([type,c]) => [c.id,{type,id:c.id,name:c.name}]))
      ).values()],
      usesDownloadedTestCredentialRef: workflow.nodes.some(n => Object.values(n.credentials || {}).some(c => credentialIds.has(c.id))),
      sqlEntryPoints: workflow.nodes.filter(n => n.type === 'n8n-nodes-base.postgres').map(n => ({ node:n.name,
        functions:[...String(n.parameters.query || '').matchAll(/\b(?:FROM|JOIN)\s+((?:core|ops|operacion)\.[a-z_0-9]+)/gi)].map(m=>m[1]) }))
    }))
  };
}
async function run() {
  const report = { readOnly:true, localExports:exportMetadata(),
    available:{ TEST_DATABASE_URL_MIGRATOR:!!process.env.TEST_DATABASE_URL_MIGRATOR, TEST_DATABASE_URL:!!process.env.TEST_DATABASE_URL },
    precheck:{ attempted:false, pass:false }, readyToApply:false };
  const sql = fs.readFileSync(precheckFile,'utf8').replace(/\r/g,'');
  assert(crypto.createHash('sha256').update(sql).digest('hex') === precheckHash,'Reviewed precheck changed; stop');
  if (!Object.values(report.available).every(Boolean)) {
    console.log(JSON.stringify({result:'TEST_015_READONLY_BLOCKED',...report,reason:'MISSING_AUTHORIZED_TEST_CONNECTIONS'},null,2));
    process.exitCode=2; return;
  }
  const urls=[guardedUrl(process.env.TEST_DATABASE_URL_MIGRATOR,'postgres'),guardedUrl(process.env.TEST_DATABASE_URL,'daubert_hub_test_user')];
  assert(urls[0].hostname===urls[1].hostname&&(urls[0].port||'5432')===(urls[1].port||'5432'),'TEST URL server mismatch');
  const pools=urls.map(url=>new Pool({connectionString:url.toString(),connectionTimeoutMillis:5000,max:1}));
  let admin;
  try {
    const identities=[];
    for(let i=0;i<2;i++) {
      const c=await pools[i].connect();
      try {
        await c.query('BEGIN READ ONLY');
        const r=(await c.query('SELECT current_database() AS db,current_user AS role,inet_server_addr()::text AS host,inet_server_port() AS port')).rows[0];
        assert(r.db==='daubert_hub_test'&&r.role===(i?'daubert_hub_test_user':'postgres'),'Live TEST identity mismatch'); identities.push(r);
      } finally { await c.query('ROLLBACK').catch(()=>{}); c.release(); }
    }
    assert(identities[0].host===identities[1].host&&identities[0].port===identities[1].port,'Live TEST server mismatch');
    report.identity={database:'daubert_hub_test',sameServer:true,roles:identities.map(r=>r.role)};
    admin=await pools[0].connect();
    await admin.query("BEGIN READ ONLY; SET LOCAL statement_timeout='20s'");
    report.workerRole=(await admin.query(`SELECT r.rolname,r.rolcanlogin,r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolbypassrls,
      (SELECT jsonb_agg(other.rolname) FROM pg_roles other WHERE other.oid<>r.oid AND (pg_has_role(r.oid,other.oid,'MEMBER') OR pg_has_role(r.oid,other.oid,'SET'))) AS memberships
      FROM pg_roles r WHERE r.rolname='n8n_cat_test'`)).rows;
    report.functions=(await admin.query(`SELECT source.signature,p.oid IS NOT NULL AS available,pg_get_userbyid(p.proowner) AS owner,
      p.prosecdef,pg_get_function_result(p.oid) AS result_contract,p.proconfig,md5(replace(p.prosrc,chr(13),'')) AS body_fingerprint,
      COALESCE(has_function_privilege(worker.oid,p.oid,'EXECUTE'),false) AS worker_effective_execute,
      EXISTS(SELECT 1 FROM aclexplode(p.proacl) acl WHERE acl.grantee=worker.oid AND acl.privilege_type='EXECUTE') AS worker_direct_execute
      FROM unnest($1::text[]) source(signature) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(source.signature)
      LEFT JOIN pg_roles worker ON worker.rolname='n8n_cat_test'`,[signatures])).rows;
    // Every non-system function the worker can execute today (names only): review for anything that could move folios outside the gate.
    report.workerExecutableFunctions=(await admin.query(`SELECT p.oid::regprocedure::text AS signature,pg_get_userbyid(p.proowner) AS owner,p.prosecdef
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles w ON w.rolname='n8n_cat_test'
      WHERE n.nspname IN('core','ops','operacion') AND has_function_privilege(w.oid,p.oid,'EXECUTE') ORDER BY 1`)).rows;
    report.workerTablePrivileges=(await admin.query(`SELECT t.relation,
      has_table_privilege(r.oid,t.relation,'SELECT') AS can_read,
      has_table_privilege(r.oid,t.relation,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') AS direct_mutation,
      has_any_column_privilege(r.oid,t.relation,'INSERT,UPDATE') AS column_mutation
      FROM pg_roles r CROSS JOIN unnest(ARRAY['core.documentos','ops.ejecuciones_automatizacion','operacion.remisiones',
        'operacion.remision_detalle','operacion.reservas_folios','operacion.series_documentales']) t(relation) WHERE r.rolname='n8n_cat_test'`)).rows;
    report.counts=(await admin.query(`SELECT (SELECT count(*)::int FROM core.documentos) AS documents,
      (SELECT count(*)::int FROM core.documentos d WHERE NULLIF(to_jsonb(d)->'caterpillar_admission','null'::jsonb) IS NOT NULL) AS snapshots,
      (SELECT count(*)::int FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id) WHERE a.codigo='REMISIONES_CATERPILLAR') AS executions,
      (SELECT count(DISTINCT d.documento_id)::int FROM core.documentos d JOIN ops.ejecuciones_automatizacion e ON e.documento_origen_id=d.documento_id
        JOIN ops.automatizaciones a USING(automatizacion_id) WHERE a.codigo='REMISIONES_CATERPILLAR' AND NULLIF(to_jsonb(d)->'caterpillar_admission','null'::jsonb) IS NULL) AS legacy_documents`)).rows[0];
    await admin.query('ROLLBACK');
    report.precheck.attempted=true;
    try { await admin.query(sql); report.precheck.pass=true; }
    catch(error) {
      report.precheck.sqlstate=/^[A-Z0-9]{5}$/.test(error.code||'')?error.code:null;
      report.precheck.reason=/^015 [a-zA-Z0-9 /;_-]+$/.test(error.message||'')?error.message:'RAW_ERROR_SUPPRESSED';
    } finally { await admin.query('ROLLBACK').catch(()=>{}); }
    report.remainingBlockers=['live credential mapping/exclusive usage unverified','current TEST direct calls not adapted',
      'manual reprocess and orphan-worker recovery not adapted','real two-backend concurrency proof pending'];
    console.log(JSON.stringify({result:'TEST_015_READONLY_COMPLETE_NOT_READY',...report},null,2));
  } finally {
    if(admin){await admin.query('ROLLBACK').catch(()=>{});admin.release();}
    await Promise.all(pools.map(p=>p.end()));
  }
}
if(require.main===module)run().catch(error=>{console.error('TEST_015_READONLY_FAILED; raw errors suppressed; SQLSTATE='+(/^[A-Z0-9]{5}$/.test(error.code||'')?error.code:'NONE'));process.exitCode=1;});
module.exports={exportMetadata,precheckHash};
