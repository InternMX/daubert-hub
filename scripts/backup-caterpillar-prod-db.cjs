#!/usr/bin/env node
'use strict';

// Consistent backup of daubert_global with pg_dump (custom format). READ ONLY on the production database: pg_dump runs in a single REPEATABLE READ,
// READ ONLY transaction snapshot, takes only ACCESS SHARE locks, and never blocks n8n or the Hub. Nothing is written to PostgreSQL.
//   node scripts/backup-caterpillar-prod-db.cjs
// The postgres account already held by the session (TEST_DATABASE_URL_MIGRATOR, same server, localhost:5432) is reused in memory with the database name swapped, exactly like
// the read-only inspection; the password is passed through the child's environment and is never printed, logged or written. The dump goes to a protected local folder
// OUTSIDE the repository and OUTSIDE Dropbox, and is verified by reading its catalog (pg_restore --list). That check does NOT replace a real restore.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const BIN = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const DIR = 'C:\\Users\\06\\Documents\\Daubert\\respaldos-postgres-prod';

function connection() {
  const value = process.env.TEST_DATABASE_URL_MIGRATOR;
  if (!value) throw new Error('TEST_DATABASE_URL_MIGRATOR is not set');
  const url = new URL(value);
  if (decodeURIComponent(url.username) !== 'postgres' || !['localhost', '127.0.0.1'].includes(url.hostname) || (url.port || '5432') !== '5432' || url.search) {
    throw new Error('Only postgres@localhost:5432 without query parameters may be reused');
  }
  return { host: url.hostname, port: '5432', password: decodeURIComponent(url.password) };
}

function run(command, args, env) {
  const result = spawnSync(path.join(BIN, command), args, { env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout || '', stderr: (result.stderr || '').split('\n').slice(0, 3).join(' | ') };
}

function main() {
  const { host, port, password } = connection();
  const env = { PGPASSWORD: password };
  const lower = DIR.toLowerCase();
  if (lower.includes('dropbox') || lower.includes('daubert-hub')) throw new Error('The backup folder must be outside Dropbox and the Git worktrees');
  fs.mkdirSync(DIR, { recursive: true });

  const identity = run('psql.exe', ['-X', '-q', '-t', '-A', '-h', host, '-p', port, '-U', 'postgres', '-d', 'daubert_global', '--no-password', '-c',
    "SELECT current_database()||'|'||current_setting('server_version')||'|'||current_setting('transaction_read_only')||'|'||pg_database_size(current_database())"], env);
  if (identity.status !== 0) throw new Error(`Cannot read daubert_global: ${identity.stderr}`);
  const [database, serverVersion, , bytes] = identity.stdout.trim().split('|');
  if (database !== 'daubert_global') throw new Error('Unexpected database identity');
  const pgDumpVersion = run('pg_dump.exe', ['--version'], env).stdout.trim();
  const free = fs.statfsSync(DIR); // bytes available to this user
  if (Number(free.bavail) * Number(free.bsize) < Number(bytes) * 10) throw new Error('Not enough free disk space for the backup and its restoration');

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  const file = path.join(DIR, `daubert_global_pre_caterpillar_016_${stamp}.dump`);
  if (fs.existsSync(file)) throw new Error('Refusing to overwrite an existing backup');
  // --serializable-deferrable is not needed: pg_dump already reads one consistent snapshot. No --clean/--create: this file is only ever restored into an EMPTY database.
  const dump = run('pg_dump.exe', ['-h', host, '-p', port, '-U', 'postgres', '-d', 'daubert_global', '-Fc', '--no-password', '-f', file], env);
  if (dump.status !== 0) { try { fs.unlinkSync(file); } catch { /* partial file removed */ } throw new Error(`pg_dump failed (${dump.status}): ${dump.stderr}`); }
  const size = fs.statSync(file).size;
  if (size <= 0) throw new Error('Empty backup');
  const list = run('pg_restore.exe', ['--list', file], {});
  if (list.status !== 0) throw new Error('pg_restore --list cannot read the backup');
  const entries = list.stdout.split('\n').filter(line => line && !line.startsWith(';')).length;
  if (!/dbname: daubert_global/.test(list.stdout.split('\n').slice(0, 20).join('\n'))) throw new Error('The archive does not identify daubert_global');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();

  console.log(JSON.stringify({ file, bytes: size, sha256, createdAt: new Date().toISOString(), serverVersion, pgDump: pgDumpVersion, databaseBytes: Number(bytes), catalogEntries: entries,
    note: 'Catalog read only (pg_restore --list); it is NOT a restore test. Restore it only into an EMPTY database of an isolated instance.' }, null, 2));
}

try { main(); } catch (error) { console.error(`BACKUP_FAILED: ${String(error.message).split('\n')[0].slice(0, 200)}`); process.exitCode = 1; }
