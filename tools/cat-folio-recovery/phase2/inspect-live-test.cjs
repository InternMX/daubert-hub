'use strict';
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Client } = require('pg');
const guard = require('../../../scripts/dev-test-only.cjs');

async function main() {
  if (process.argv[2] !== '--test-env-file' || process.argv.length !== 4) throw new Error('--test-env-file <path> required');
  const { url } = guard.parseGuardedTestDatabaseUrl(guard.resolveTestDatabaseUrl(process.env, process.argv[3]));
  if (url.search || url.hash || !['localhost','127.0.0.1'].includes(url.hostname)
    || decodeURIComponent(url.username) !== 'daubert_hub_test_user') throw new Error('Local TEST Hub credentials required');
  const client = new Client({ connectionString: url.href, options: '-c default_transaction_read_only=on -c statement_timeout=10000' });
  try {
    await client.connect();
    if ((await client.query('SELECT current_database() AS db')).rows[0].db !== 'daubert_hub_test') throw new Error('TEST mismatch');
    for (const signature of ['ops.fn_admitir_reservar_caterpillar_test(bigint,text,text,integer)','ops.fn_reprocesar_reservar_caterpillar_test(bigint,text,text,integer)']) {
      console.log('LIVE_TEST_GATE',signature,(await client.query("SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS raw_md5,md5(replace(pg_get_functiondef(to_regprocedure($1)),chr(13),'')) AS normalized_md5",[signature])).rows[0]);
    }
    console.log('LIVE_TEST_025_INSTALLED',(await client.query("SELECT to_regnamespace('cat_recovery_test') IS NOT NULL AS installed")).rows[0].installed);
  } finally { await client.end(); }
  const db = new DatabaseSync(path.join(process.env.USERPROFILE,'.n8n','database.sqlite'), { readOnly: true });
  try {
    const row = db.prepare('SELECT id,name,active,activeVersionId,nodes FROM workflow_entity WHERE id=? AND name=?')
      .get('AgWvTRatRujP9VfW','Caterpillar TEST 015 — FULL (INACTIVE, staged)');
    if (!row) throw new Error('Expected TEST workflow not found');
    let nodes = row.nodes;
    if (row.activeVersionId) {
      const published = db.prepare('SELECT nodes FROM workflow_history WHERE versionId=?').get(row.activeVersionId);
      if (!published) throw new Error('Published TEST version unavailable'); nodes = published.nodes;
    }
    const selected = JSON.parse(nodes).filter(n => ['Reservar folios PG','Convertir PDF CAT','Detectar archivos CAT1','Detectar archivo REPROCESS CAT1'].includes(n.name));
    console.log('LIVE_TEST_WORKFLOW',JSON.stringify({id:row.id,name:row.name,active:row.active,activeVersionId:row.activeVersionId,
      nodeCount:JSON.parse(nodes).length,nodes:selected.map(n=>({name:n.name,sha256:createHash('sha256').update(JSON.stringify(n.parameters)).digest('hex'),
        ioHold:JSON.stringify(n.parameters).includes('CAT_TEST_IO_HOLD'),usesAtomicGate:JSON.stringify(n.parameters).includes('fn_reprocesar_reservar_caterpillar_test')}))}));
  } finally { db.close(); }
}
main().catch(error => {console.error('TEST_INSPECTION_FAILED',error.code || error.message);process.exitCode=1;});
