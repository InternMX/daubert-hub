#!/usr/bin/env node
'use strict';

// READ ONLY inspection of daubert_global for the Caterpillar 016 cutover (also reusable AFTER the cutover to compare state).
//   $env:PROD_DATABASE_URL_READONLY = '<postgres://<read-only-user>:...@localhost:5432/daubert_global>'   (supplied by the operator; never read from files)
//   node apps/api/scripts/caterpillar-016-prod-inspect.cjs > prod-inspection-before.json
// Guarantees: the session is BEGIN READ ONLY, every statement is a SELECT from the reviewed SQL file (checked statically below), statement/lock timeouts are
// short, nothing is written, no business function is invoked, no query text of other sessions is read, and no secret is printed.
//   --self-test runs the same file against daubert_hub_test with TEST_DATABASE_URL_MIGRATOR, only to prove the queries execute.

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const SQL_FILE = path.join(__dirname, '..', '..', '..', 'database', 'migrations', 'daubert_global', '20261024_016_caterpillar_prod_inspection.readonly.sql');
const FORBIDDEN = /\b(insert|update|delete|alter|create|drop|grant|revoke|truncate|lock|copy|vacuum|reindex|call|do|execute|set|reset|listen|notify|comment)\b/i;

function parseBlocks(text) {
  const blocks = [];
  let current = null;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const header = /^-- @([a-z_]+)\s*$/.exec(line);
    if (header) { current = { name: header[1], sql: '' }; blocks.push(current); continue; }
    if (current && !line.startsWith('--')) current.sql += `${line}\n`;
  }
  return blocks.map(block => ({ ...block, sql: block.sql.trim().replace(/;$/, '') }));
}

// Static proof that the file can only read: every block starts with SELECT/WITH and contains no write/DDL/lock keyword (string literals excluded).
function assertReadOnly(blocks) {
  for (const block of blocks) {
    const stripped = block.sql.replace(/'(?:[^']|'')*'/g, "''");
    if (!/^(select|with)\b/i.test(stripped) || FORBIDDEN.test(stripped.replace(/\bfor\b/gi, ''))) throw new Error(`Block ${block.name} is not a pure read`);
    if (stripped.includes(';')) throw new Error(`Block ${block.name} contains multiple statements`);
  }
}

function connectionTarget(selfTest) {
  const variable = selfTest ? 'TEST_DATABASE_URL_MIGRATOR' : 'PROD_DATABASE_URL_READONLY';
  const value = process.env[variable];
  if (!value) throw new Error(`${variable} is not set`);
  const url = new URL(value);
  const database = decodeURIComponent(url.pathname).slice(1);
  const expected = selfTest ? 'daubert_hub_test' : 'daubert_global';
  if (database !== expected) throw new Error(`${variable} must point to ${expected}, not ${database || '(none)'}`);
  if (!selfTest && process.env.TEST_DATABASE_URL_MIGRATOR && process.env.TEST_DATABASE_URL_MIGRATOR === value) throw new Error('PROD and TEST connection strings must differ');
  return url.toString();
}

async function main() {
  const selfTest = process.argv.includes('--self-test');
  const blocks = parseBlocks(fs.readFileSync(SQL_FILE, 'utf8'));
  assertReadOnly(blocks);
  const client = new Client({ connectionString: connectionTarget(selfTest), connectionTimeoutMillis: 5000, application_name: 'cat016-readonly-inspect' });
  await client.connect();
  const out = { mode: selfTest ? 'SELF_TEST_ON_TEST_DATABASE' : 'PRODUCTION_READ_ONLY', generatedAt: new Date().toISOString(), blocks: {} };
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL lock_timeout = '1s'");
    for (const block of blocks) {
      await client.query('SAVEPOINT inspect_block');
      try {
        out.blocks[block.name] = { rows: (await client.query(block.sql)).rows };
        await client.query('RELEASE SAVEPOINT inspect_block');
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT inspect_block');
        out.blocks[block.name] = { error: `SQLSTATE ${/^[A-Z0-9]{5}$/.test(error.code || '') ? error.code : 'NONE'}: ${String(error.message).split('\n')[0].slice(0, 160)}` };
      }
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
  console.log(JSON.stringify(out, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
}

module.exports = { parseBlocks, assertReadOnly, SQL_FILE };
if (require.main === module) main().catch(error => {
  console.error(`CAT016_INSPECT_FAILED: ${String(error.message).split('\n')[0].slice(0, 200)}`);
  process.exitCode = 1;
});
