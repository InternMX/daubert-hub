#!/usr/bin/env node
'use strict';

// Applies reviewed SQL files to daubert_hub_test ONLY, as postgres, with psql and ON_ERROR_STOP. Never prints the URL or password; refuses any other database.
//   node scripts/apply-caterpillar-sql-test.cjs <file.sql> [<file.sql> ...]
// Files run in the given order and stop at the first failure (each migration file is its own transaction). Used for the TEST-side steps of 017.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const PSQL = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
const value = process.env.TEST_DATABASE_URL_MIGRATOR;
if (!value) { console.error('TEST_DATABASE_URL_MIGRATOR is not set'); process.exit(2); }
const url = new URL(value);
if (decodeURIComponent(url.pathname) !== '/daubert_hub_test' || decodeURIComponent(url.username) !== 'postgres' || url.search) { console.error('Only postgres@daubert_hub_test with no query parameters is allowed'); process.exit(2); }
const files = process.argv.slice(2);
if (!files.length || files.some(file => !fs.existsSync(file))) { console.error('Usage: node scripts/apply-caterpillar-sql-test.cjs <file.sql> ...'); process.exit(2); }

for (const file of files) {
  const run = spawnSync(PSQL, ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', url.hostname, '-p', url.port || '5432', '-U', 'postgres', '-d', 'daubert_hub_test', '--no-password', '-f', file],
    { env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) }, encoding: 'utf8' });
  const output = `${run.stdout || ''}`.trim();
  if (run.status !== 0) { console.error(`FAILED ${file}: ${String(run.stderr || '').trim().split('\n').slice(-3).join(' | ')}`); process.exit(1); }
  console.log(`OK ${file}${output ? ` -> ${output.split('\n').filter(line => /PASS/.test(line)).join(' ')}` : ''}`);
}
