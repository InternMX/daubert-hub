#!/usr/bin/env node
'use strict';

// Safe local-development launcher.
//
// `npm run dev` (and its explicit alias `npm run dev:test`) must only ever develop against
// daubert_hub_test. The ordinary DB_* values in apps/api/.env exist for other purposes (they
// can legitimately point at daubert_global) and must never decide the development database.
//
// This script is the single source of truth for that decision: it resolves and validates
// TEST_DATABASE_URL, derives DB_* overrides from it, and only then spawns the real dev
// processes (the existing `dev:api`/`dev:web` scripts, run directly — never through a
// publicly callable "run both, unguarded" npm script, so there is no obvious bypass command
// sitting next to `dev`/`dev:test`) with those overrides applied. Because the spawned
// processes inherit this process's env, and dotenv (used by @nestjs/config) never overwrites
// an already-set process.env value, the derived DB_* values win over whatever apps/api/.env
// contains.
//
// Pure, testable logic lives in the exported functions below; scripts/dev-test-only.test.cjs
// covers it directly without spawning anything. The CLI entry point (main()) only runs when
// this file is executed directly.

const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const EXPECTED_DATABASE_NAME = 'daubert_hub_test';
const ROOT_DIR = path.join(__dirname, '..');
const DEFAULT_ENV_FILE = path.join(ROOT_DIR, 'apps', 'api', '.env');
const DEV_SCRIPTS = [
  { label: 'api', npmScript: 'dev:api' },
  { label: 'web', npmScript: 'dev:web' }
];

function loadEnvFileValue(filePath, key) {
  if (!filePath || !fs.existsSync(filePath)) return undefined;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    if (trimmed.slice(0, separator).trim() === key) return trimmed.slice(separator + 1).trim();
  }
  return undefined;
}

// Resolves TEST_DATABASE_URL for local developer convenience: an already-set env var always
// wins; only when it is absent do we fall back to reading it out of apps/api/.env.
function resolveTestDatabaseUrl(env, envFilePath) {
  if (env.TEST_DATABASE_URL) return env.TEST_DATABASE_URL;
  return loadEnvFileValue(envFilePath, 'TEST_DATABASE_URL');
}

// Validates and parses TEST_DATABASE_URL. Throws a plain Error with a `code` and a message
// that never includes the connection string, username, or password — only the parsed
// database name, which is safe to surface.
function parseGuardedTestDatabaseUrl(value) {
  if (!value) {
    throw Object.assign(new Error(
      'TEST_DATABASE_URL is not set.\n' +
      'npm run dev only develops against daubert_hub_test and refuses to guess a database.\n' +
      'Set TEST_DATABASE_URL in your shell, or add it to apps/api/.env (see apps/api/.env.example).'
    ), { code: 'TEST_DATABASE_URL_MISSING' });
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw Object.assign(new Error('TEST_DATABASE_URL must be a valid PostgreSQL connection URL.'), { code: 'TEST_DATABASE_URL_INVALID' });
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(url.pathname).replace(/^\//, '');
  } catch {
    throw Object.assign(new Error('TEST_DATABASE_URL must be a valid PostgreSQL connection URL.'), { code: 'TEST_DATABASE_URL_INVALID' });
  }

  if (databaseName !== EXPECTED_DATABASE_NAME) {
    throw Object.assign(new Error(
      `Refusing to start development against "${databaseName || '(missing)'}". Expected "${EXPECTED_DATABASE_NAME}".\n` +
      'npm run dev only develops against the TEST database.'
    ), { code: 'TEST_DATABASE_URL_WRONG_DATABASE' });
  }

  return { url, databaseName };
}

// Derives the DB_* env overrides + the live-guard signal from an already-validated URL.
// These are what actually reach the spawned API process; they intentionally override any
// conflicting DB_* values apps/api/.env may define.
function deriveDatabaseEnv(url, databaseName) {
  return {
    DB_HOST: url.hostname,
    DB_PORT: url.port || '5432',
    DB_NAME: databaseName,
    DB_USER: decodeURIComponent(url.username),
    DB_PASSWORD: decodeURIComponent(url.password),
    EXPECTED_DATABASE_NAME: databaseName
  };
}

// Release/build metadata for local development (see apps/api/src/config/
// environment.ts's app.version/app.commit and GET /api/health). ROOT_DIR is
// always the actual repo root here (this script itself lives at
// <repo>/scripts/, an unambiguous, fixed location) — unlike reading
// package.json from inside apps/api's compiled output, there is no
// dev-vs-dist path-depth ambiguity to worry about.
//
// Best-effort only: an already-set APP_VERSION/GIT_COMMIT in the
// developer's own shell always wins (see main()), and any failure here
// (unreadable package.json, git not installed, not a git checkout) is
// swallowed — this must never block `npm run dev` from starting, and a
// missing commit is an explicitly accepted local fallback ("unknown").
function readRootVersion() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    return typeof parsed.version === 'string' && parsed.version.trim() ? parsed.version.trim() : undefined;
  } catch {
    return undefined;
  }
}

function readGitCommit() {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return sha || undefined;
  } catch {
    return undefined;
  }
}

function deriveReleaseEnv() {
  const version = readRootVersion();
  const commit = readGitCommit();
  return { ...(version ? { APP_VERSION: version } : {}), ...(commit ? { GIT_COMMIT: commit } : {}) };
}

const isWindows = process.platform === 'win32';

// Kills a spawned child's whole process tree, not just the immediate child. `npm run <script>`
// runs via a shell (needed for cross-platform npm resolution), and on Windows killing that
// shell wrapper does NOT kill the grandchild dev server it started (nest/vite), which would
// leave orphaned processes behind after Ctrl+C. `detached: true` + killing the whole POSIX
// process group (negative pid), or `taskkill /T` on Windows, tears down the full tree instead.
function terminateTree(child, signal) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (isWindows) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* already gone */ } }
  }
}

// Runs one existing `npm run <script>` as a labeled, line-prefixed child process — reimplementing
// just enough of the previous `npm-run-all --parallel --race --print-label` behavior (used by
// main() below) without depending on a separate, publicly callable "run everything" npm script.
function runDevScript(npmScript, label, env) {
  const child = spawn('npm', ['run', npmScript], { cwd: ROOT_DIR, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: !isWindows });
  const prefixLines = (stream, out) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) out.write(`[${label}] ${line}\n`);
    });
    stream.on('close', () => { if (buffer) out.write(`[${label}] ${buffer}\n`); });
  };
  prefixLines(child.stdout, process.stdout);
  prefixLines(child.stderr, process.stderr);
  return child;
}

function main() {
  let guarded;
  try {
    guarded = parseGuardedTestDatabaseUrl(resolveTestDatabaseUrl(process.env, DEFAULT_ENV_FILE));
  } catch (error) {
    console.error(`\n[dev:test-only] ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`[dev:test-only] TEST_DATABASE_URL verified -> database: ${guarded.databaseName}`);
  console.log('[dev:test-only] Starting API + web against the TEST database only.');

  // Order matters: deriveReleaseEnv()'s values go first so an already-set
  // APP_VERSION/GIT_COMMIT in the developer's own shell (process.env) always
  // takes precedence — same override convention as TEST_DATABASE_URL above.
  const env = { ...deriveReleaseEnv(), ...process.env, ...deriveDatabaseEnv(guarded.url, guarded.databaseName) };

  // --race semantics: both start together; if either exits for any reason, tear down the other
  // and stop, exactly like the previous npm-run-all-based behavior.
  const children = DEV_SCRIPTS.map(({ npmScript, label }) => runDevScript(npmScript, label, env));
  let settled = false;

  function shutdown(exitCode, signal) {
    if (settled) return;
    settled = true;
    for (const child of children) terminateTree(child, signal || 'SIGTERM');
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = exitCode ?? 0;
  }

  children.forEach((child, index) => {
    child.on('exit', (code, signal) => {
      const { label } = DEV_SCRIPTS[index];
      console.log(`[dev:test-only] ${label} exited${signal ? ` (signal ${signal})` : ` (code ${code})`}.`);
      shutdown(code, undefined);
    });
  });

  process.on('SIGINT', () => shutdown(0, 'SIGINT'));
  process.on('SIGTERM', () => shutdown(0, 'SIGTERM'));
}

module.exports = { EXPECTED_DATABASE_NAME, loadEnvFileValue, resolveTestDatabaseUrl, parseGuardedTestDatabaseUrl, deriveDatabaseEnv, readRootVersion, readGitCommit, deriveReleaseEnv };

if (require.main === module) main();
