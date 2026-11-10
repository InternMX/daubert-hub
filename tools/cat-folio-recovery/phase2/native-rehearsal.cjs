'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Client, Pool } = require('pg');
const {native,TemporaryPostgres,deadline}=require('../temporary-postgres.cjs');
const guard = require('../../../scripts/dev-test-only.cjs');
const phase3 = process.argv[2] === '--phase3-reference-schema';
const port = phase3 ? 55442 : 55441;

async function main() {
  assert.equal(process.argv.length, 4);
  let dump;
  if (phase3) {
    const bytes=fs.readFileSync(process.argv[3]);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),'d11f301535753b5872bb68cd0b798c11e3183bd5e37ba2b230806b4809f31eeb','Frozen TEST schema changed');
    dump=bytes.toString('utf8');
  } else {
  assert.equal(process.argv[2], '--test-env-file');
  const { url } = guard.parseGuardedTestDatabaseUrl(guard.resolveTestDatabaseUrl(process.env, process.argv[3]));
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(decodeURIComponent(url.username), 'daubert_hub_test_user');
  assert.equal(url.search + url.hash, '');
  const source = new Client({ connectionString: url.href, options: '-c default_transaction_read_only=on -c statement_timeout=15000' });
  await source.connect();
  try { assert.equal((await source.query('SELECT current_database() AS db')).rows[0].db, 'daubert_hub_test'); }
  finally { await source.end(); }
  dump = native('pg_dump', ['-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-d', 'daubert_hub_test',
    '--schema-only', '--schema=core', '--schema=ops', '--schema=operacion', '--schema=security', '--schema=audit',
    '--no-owner', '--no-privileges', '--no-security-labels', '--no-tablespaces', '--no-password'],
  { env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password), PGOPTIONS: '-c default_transaction_read_only=on' } });
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode', phase3 ? 'cat-recovery-phase3-' : 'cat-recovery-phase2-'));
  fs.writeFileSync(path.join(root, 'test-schema.sql'), dump, { flag: 'wx' });
  fs.writeFileSync(path.join(root, 'sandbox.json'), JSON.stringify({ isolated: true, port, database: 'daubert_hub_test' }), { flag: 'wx' });
  const server=new TemporaryPostgres(root,port),data=server.spec.data;
  let pool;
  try {
    server.init();server.start();
    native('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', 'daubert_hub_test']);
    native('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'daubert_hub_test', '-f', path.join(root, 'test-schema.sql')]);
    pool = new Pool({ host: '127.0.0.1', port, database: 'daubert_hub_test', user: 'postgres', max: 6,
      connectionTimeoutMillis:5000,query_timeout:10000,options:'-c statement_timeout=10000 -c idle_in_transaction_session_timeout=15000' });
    pool.on('error',error=>console.error('TEMP_POOL_ERROR',error.code||'connection closed'));
    const identity = (await pool.query("SELECT current_database() AS db,current_setting('data_directory') AS dir")).rows[0];
    assert.equal(identity.db, 'daubert_hub_test');
    assert.equal(path.resolve(identity.dir).toLowerCase(), path.resolve(data).toLowerCase());
    console.log('ISOLATED_NATIVE_POSTGRES', root, 'port', port, 'real TEST schemas core/ops/operacion/security/audit restored, zero source data');
    const testPath = path.join(__dirname, phase3 ? '../phase3/rehearse.cjs' : 'integration.cjs');
    if (fs.existsSync(testPath)) await require(testPath).run(pool, root);
    else console.log('SCHEMA_RESTORE_PASS');
  } finally {
    let closeError;
    try{if(pool)await deadline(pool.end(),5000,'temporary pool close');}catch(error){closeError=error;}
    const stopped=server.stop('runner-finally');
    console.log('SANDBOX_RETAINED',root,'server stopped VERIFIED',JSON.stringify(stopped));
    if(closeError)throw closeError;
  }
}
module.exports={native};
if(require.main===module)main().catch(error => { console.error('ISOLATED_REHEARSAL_FAILED', error.message); process.exitCode = 1; });
