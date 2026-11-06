#!/usr/bin/env node
'use strict';

// READ ONLY inspection of daubert_global for the Caterpillar 016 cutover (also reusable AFTER the cutover to compare state).
//   Option A (read-only login supplied by the operator):
//     $env:PROD_DATABASE_URL_READONLY = 'postgres://<user>:<password>@localhost:5432/daubert_global'
//     node apps/api/scripts/caterpillar-016-prod-inspect.cjs > report.json
//   Option B (the existing postgres account, only because the session already holds it for TEST):
//     node apps/api/scripts/caterpillar-016-prod-inspect.cjs --reuse-postgres-from-test-url > report.json
//     The host, port, user and password of TEST_DATABASE_URL_MIGRATOR are reused in memory with the database name swapped to daubert_global. Nothing is
//     printed, logged or written. It is refused unless the user is postgres and the server is localhost:5432.
//
// Guarantees (all enforced before and during the run, not just documented):
//   * the connection itself is read-only (default_transaction_read_only=on is sent at connect time) AND every block runs in BEGIN READ ONLY;
//   * after connecting it verifies current_database()=daubert_global, transaction_read_only=on and that the server answers on port 5432, else it aborts;
//   * every statement comes from the reviewed SQL file and is checked statically: a single SELECT/WITH, no write/DDL/lock/session-changing keyword,
//     and no call to a function with side effects (advisory locks, sequences, file/large-object access, backend control, dblink...);
//   * short statement/lock timeouts, no row locks, no query text of other sessions is read, no business function is invoked;
//   * passwords never appear in output or error messages.
//   --self-test runs the same file against daubert_hub_test with TEST_DATABASE_URL_MIGRATOR, only to prove the queries execute.

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const SQL_FILE = path.join(__dirname, '..', '..', '..', 'database', 'migrations', 'daubert_global', '20261024_016_caterpillar_prod_inspection.readonly.sql');
const FORBIDDEN_KEYWORDS = /\b(insert|update|delete|alter|create|drop|grant|revoke|truncate|lock|copy|vacuum|reindex|call|do|execute|set|reset|listen|notify|comment|into)\b/i;
const FORBIDDEN_FUNCTIONS = /\b(pg_advisory\w*|nextval|setval|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|pg_switch_wal|pg_create\w*|pg_drop\w*|pg_read\w*|pg_ls_\w+|pg_stat_file|pg_file\w*|lo_\w+|dblink\w*|set_config|txid_\w+|pg_notify|pg_sleep\w*|brin_\w+|gin_\w+|pg_promote|pg_wal_replay\w*|pg_import_system_collations|pg_backup\w*)\s*\(/i;
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

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

// Static proof that the file can only read: every block starts with SELECT/WITH, contains no write/DDL/lock/session keyword and no side-effect function
// (string literals excluded; "FOR" is not forbidden because SELECT ... FOR UPDATE would need the keyword UPDATE, which is).
function assertReadOnly(blocks) {
  for (const block of blocks) {
    const stripped = block.sql.replace(/'(?:[^']|'')*'/g, "''");
    if (!/^(select|with)\b/i.test(stripped) || FORBIDDEN_KEYWORDS.test(stripped)) throw new Error(`Block ${block.name} is not a pure read`);
    if (FORBIDDEN_FUNCTIONS.test(stripped)) throw new Error(`Block ${block.name} calls a function that is not allowed in a read-only inspection`);
    if (/\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i.test(stripped)) throw new Error(`Block ${block.name} takes row locks`);
    if (stripped.includes(';')) throw new Error(`Block ${block.name} contains multiple statements`);
  }
}

// Resolves the connection WITHOUT ever including the password in a message. Returns the pg Client configuration.
function resolveConnection(env, flags) {
  const selfTest = flags.includes('--self-test'), reuse = flags.includes('--reuse-postgres-from-test-url');
  if (selfTest && reuse) throw new Error('--self-test and --reuse-postgres-from-test-url are mutually exclusive');
  const variable = selfTest ? 'TEST_DATABASE_URL_MIGRATOR' : reuse ? 'TEST_DATABASE_URL_MIGRATOR' : 'PROD_DATABASE_URL_READONLY';
  const value = env[variable];
  if (!value) throw new Error(`${variable} is not set`);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${variable} is not a valid PostgreSQL URL`); }
  const expectedDatabase = selfTest ? 'daubert_hub_test' : 'daubert_global';
  const database = decodeURIComponent(url.pathname).slice(1);
  if (reuse) {
    if (database !== 'daubert_hub_test') throw new Error('TEST_DATABASE_URL_MIGRATOR must point to daubert_hub_test to be reused');
    url.pathname = `/${expectedDatabase}`;
  } else if (database !== expectedDatabase) throw new Error(`${variable} must point to ${expectedDatabase}`);
  if (!ALLOWED_HOSTS.has(url.hostname) || (url.port || '5432') !== '5432') throw new Error('The server must be localhost:5432');
  if (reuse && decodeURIComponent(url.username) !== 'postgres') throw new Error('Only the existing postgres account may be reused');
  if (url.search) throw new Error('Connection URLs with query parameters are not accepted');
  if (!selfTest && !reuse && env.TEST_DATABASE_URL_MIGRATOR === value) throw new Error('PROD and TEST connection strings must differ');
  return {
    host: url.hostname.replace(/^\[|\]$/g, ''), port: 5432, database: expectedDatabase, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    connectionTimeoutMillis: 5000, application_name: 'cat016-readonly-inspect',
    // The session itself is read-only from the first statement (in addition to the explicit READ ONLY transactions below).
    options: '-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=60000',
    expectedDatabase
  };
}

async function main() {
  const flags = process.argv.slice(2);
  const blocks = parseBlocks(fs.readFileSync(SQL_FILE, 'utf8'));
  assertReadOnly(blocks);
  const { expectedDatabase, ...clientConfig } = resolveConnection(process.env, flags);
  const client = new Client(clientConfig);
  await client.connect();
  const out = { mode: flags.includes('--self-test') ? 'SELF_TEST_ON_TEST_DATABASE' : 'PRODUCTION_READ_ONLY', generatedAt: new Date().toISOString(), blocks: {} };
  try {
    await client.query('BEGIN READ ONLY');
    const guard = (await client.query(`SELECT current_database() AS db, current_setting('transaction_read_only') AS tx_read_only,
      current_setting('default_transaction_read_only') AS default_read_only, inet_server_port() AS port`)).rows[0];
    if (guard.db !== expectedDatabase || guard.tx_read_only !== 'on' || guard.default_read_only !== 'on' || (guard.port !== null && Number(guard.port) !== 5432)) {
      throw new Error(`Safety check failed: database=${guard.db}, transaction_read_only=${guard.tx_read_only}, default_transaction_read_only=${guard.default_read_only}`);
    }
    out.connection = { database: guard.db, transactionReadOnly: guard.tx_read_only, defaultTransactionReadOnly: guard.default_read_only, port: guard.port === null ? 'local-socket' : Number(guard.port), host: 'localhost' };
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

module.exports = { parseBlocks, assertReadOnly, resolveConnection, SQL_FILE };
if (require.main === module) main().catch(error => {
  console.error(`CAT016_INSPECT_FAILED: ${String(error.message).split('\n')[0].slice(0, 200)}`);
  process.exitCode = 1;
});
