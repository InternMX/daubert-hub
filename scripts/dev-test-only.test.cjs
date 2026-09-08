'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseGuardedTestDatabaseUrl, resolveTestDatabaseUrl, deriveDatabaseEnv, EXPECTED_DATABASE_NAME, readRootVersion, readGitCommit, deriveReleaseEnv } = require('./dev-test-only.cjs');

test('EXPECTED_DATABASE_NAME is daubert_hub_test', () => {
  assert.equal(EXPECTED_DATABASE_NAME, 'daubert_hub_test');
});

test('accepts a TEST_DATABASE_URL pointing at daubert_hub_test', () => {
  const result = parseGuardedTestDatabaseUrl('postgresql://user:pass@localhost:5432/daubert_hub_test');
  assert.equal(result.databaseName, 'daubert_hub_test');
});

test('rejects daubert_global', () => {
  assert.throws(
    () => parseGuardedTestDatabaseUrl('postgresql://user:pass@localhost:5432/daubert_global'),
    (error) => error.code === 'TEST_DATABASE_URL_WRONG_DATABASE' && /Expected "daubert_hub_test"/.test(error.message)
  );
});

test('rejects an arbitrary other database name', () => {
  assert.throws(
    () => parseGuardedTestDatabaseUrl('postgresql://user:pass@localhost:5432/some_other_db'),
    (error) => error.code === 'TEST_DATABASE_URL_WRONG_DATABASE'
  );
});

test('rejects a missing TEST_DATABASE_URL', () => {
  assert.throws(
    () => parseGuardedTestDatabaseUrl(undefined),
    (error) => error.code === 'TEST_DATABASE_URL_MISSING' && /TEST_DATABASE_URL is not set/.test(error.message)
  );
});

test('rejects a malformed connection string', () => {
  assert.throws(
    () => parseGuardedTestDatabaseUrl('not-a-valid-url'),
    (error) => error.code === 'TEST_DATABASE_URL_INVALID'
  );
});

test('safely decodes a URL-encoded database name', () => {
  const result = parseGuardedTestDatabaseUrl('postgresql://user:pass@localhost:5432/daubert%5Fhub%5Ftest');
  assert.equal(result.databaseName, 'daubert_hub_test');
});

test('a decoded name that only matches after decoding still resolves to daubert_hub_test, never masking a different real name', () => {
  assert.throws(
    () => parseGuardedTestDatabaseUrl('postgresql://user:pass@localhost:5432/daubert%5Fglobal'),
    (error) => error.code === 'TEST_DATABASE_URL_WRONG_DATABASE' && error.message.includes('daubert_global')
  );
});

test('never includes the connection string or credentials in a rejection message', () => {
  try {
    parseGuardedTestDatabaseUrl('postgresql://secretuser:secretpass@localhost:5432/daubert_global');
    assert.fail('expected to throw');
  } catch (error) {
    assert.doesNotMatch(error.message, /secretuser/);
    assert.doesNotMatch(error.message, /secretpass/);
    assert.doesNotMatch(error.message, /:\/\//);
  }
});

test('resolveTestDatabaseUrl prefers an already-set env var over the .env fallback file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-test-only-'));
  const envFile = path.join(dir, '.env');
  fs.writeFileSync(envFile, 'TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/from_file\n');
  try {
    const resolved = resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'postgresql://user:pass@localhost:5432/from_env' }, envFile);
    assert.equal(resolved, 'postgresql://user:pass@localhost:5432/from_env');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveTestDatabaseUrl falls back to apps/api/.env when the env var is absent, ignoring an unrelated DB_NAME in the same file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-test-only-'));
  const envFile = path.join(dir, '.env');
  fs.writeFileSync(envFile, 'DB_NAME=daubert_global\nTEST_DATABASE_URL=postgresql://user:pass@localhost:5432/daubert_hub_test\n');
  try {
    const resolved = resolveTestDatabaseUrl({}, envFile);
    assert.equal(resolved, 'postgresql://user:pass@localhost:5432/daubert_hub_test');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveTestDatabaseUrl returns undefined when neither the env var nor the file provide a value', () => {
  const resolved = resolveTestDatabaseUrl({}, path.join(os.tmpdir(), 'dev-test-only-does-not-exist', '.env'));
  assert.equal(resolved, undefined);
});

test('deriveDatabaseEnv overrides DB_* and sets EXPECTED_DATABASE_NAME from the validated URL', () => {
  const { url, databaseName } = parseGuardedTestDatabaseUrl('postgresql://daubert_test:local-test-only@localhost:5433/daubert_hub_test');
  const env = deriveDatabaseEnv(url, databaseName);
  assert.deepEqual(env, {
    DB_HOST: 'localhost',
    DB_PORT: '5433',
    DB_NAME: 'daubert_hub_test',
    DB_USER: 'daubert_test',
    DB_PASSWORD: 'local-test-only',
    EXPECTED_DATABASE_NAME: 'daubert_hub_test'
  });
});

test('readRootVersion reads the semantic version straight out of the real root package.json', () => {
  const version = readRootVersion();
  assert.equal(typeof version, 'string');
  assert.match(version, /^\d+\.\d+\.\d+/);
});

test('readRootVersion returns undefined rather than throwing when package.json is missing/unparsable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-test-only-version-'));
  try {
    const originalReadFileSync = fs.readFileSync;
    fs.readFileSync = (target, ...rest) => {
      if (String(target).endsWith('package.json')) throw new Error('ENOENT');
      return originalReadFileSync(target, ...rest);
    };
    try {
      assert.equal(readRootVersion(), undefined);
    } finally {
      fs.readFileSync = originalReadFileSync;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readGitCommit returns a short SHA-shaped string in this real git checkout, or undefined if git is unavailable', () => {
  const commit = readGitCommit();
  assert.ok(commit === undefined || /^[0-9a-f]{4,40}$/i.test(commit));
});

test('deriveReleaseEnv never throws and only includes keys it could actually resolve', () => {
  const env = deriveReleaseEnv();
  const keys = Object.keys(env);
  assert.ok(keys.every((key) => key === 'APP_VERSION' || key === 'GIT_COMMIT'));
  if ('APP_VERSION' in env) assert.equal(typeof env.APP_VERSION, 'string');
  if ('GIT_COMMIT' in env) assert.equal(typeof env.GIT_COMMIT, 'string');
});
