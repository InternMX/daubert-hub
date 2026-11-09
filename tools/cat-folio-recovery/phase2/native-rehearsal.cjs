'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { Client, Pool } = require('pg');
const guard = require('../../../scripts/dev-test-only.cjs');
const bin = 'C:/Program Files/PostgreSQL/18/bin';
const port = 55441;

function native(name, args, options = {}) {
  const result = spawnSync(path.join(bin, `${name}.exe`), args, { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${name} failed (${result.status}): ${(result.stderr || result.error?.message || '').slice(-1500)}`);
  return result.stdout;
}

async function main() {
  assert.equal(process.argv[2], '--test-env-file');
  assert.equal(process.argv.length, 4);
  const { url } = guard.parseGuardedTestDatabaseUrl(guard.resolveTestDatabaseUrl(process.env, process.argv[3]));
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.equal(decodeURIComponent(url.username), 'daubert_hub_test_user');
  assert.equal(url.search + url.hash, '');
  const source = new Client({ connectionString: url.href, options: '-c default_transaction_read_only=on -c statement_timeout=15000' });
  await source.connect();
  try { assert.equal((await source.query('SELECT current_database() AS db')).rows[0].db, 'daubert_hub_test'); }
  finally { await source.end(); }
  const dump = native('pg_dump', ['-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-d', 'daubert_hub_test',
    '--schema-only', '--schema=core', '--schema=ops', '--schema=operacion', '--schema=security', '--schema=audit',
    '--no-owner', '--no-privileges', '--no-security-labels', '--no-tablespaces', '--no-password'],
  { env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password), PGOPTIONS: '-c default_transaction_read_only=on' } });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode', 'cat-recovery-phase2-'));
  fs.writeFileSync(path.join(root, 'test-schema.sql'), dump, { flag: 'wx' });
  fs.writeFileSync(path.join(root, 'sandbox.json'), JSON.stringify({ isolated: true, port, database: 'daubert_hub_test' }), { flag: 'wx' });
  const data = path.join(root, 'pgdata');
  native('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
  let started = false;
  let pool;
  try {
    native('pg_ctl', ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', `-p ${port} -h 127.0.0.1`, '-w', 'start']);
    started = true;
    native('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', 'daubert_hub_test']);
    native('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'daubert_hub_test', '-f', path.join(root, 'test-schema.sql')]);
    pool = new Pool({ host: '127.0.0.1', port, database: 'daubert_hub_test', user: 'postgres', max: 6 });
    const identity = (await pool.query("SELECT current_database() AS db,current_setting('data_directory') AS dir")).rows[0];
    assert.equal(identity.db, 'daubert_hub_test');
    assert.equal(path.resolve(identity.dir).toLowerCase(), path.resolve(data).toLowerCase());
    console.log('ISOLATED_NATIVE_POSTGRES', root, 'port', port, 'real TEST schemas core/ops/operacion/security/audit restored, zero source data');
    const testPath = path.join(__dirname, 'integration.cjs');
    if (fs.existsSync(testPath)) await require(testPath).run(pool, root);
    else console.log('SCHEMA_RESTORE_PASS');
  } finally {
    if (pool) await pool.end();
    if (started) native('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    console.log('SANDBOX_RETAINED', root, 'server stopped');
  }
}
main().catch(error => { console.error('ISOLATED_REHEARSAL_FAILED', error.message); process.exitCode = 1; });
