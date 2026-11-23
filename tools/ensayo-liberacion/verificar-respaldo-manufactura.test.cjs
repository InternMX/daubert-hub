const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(`${__dirname}/verificar-respaldo-manufactura.cjs`, 'utf8');

function runVerifier(restoreStatus, withRoles) {
  const output = [];
  const calls = [];
  let exitCode;
  const argv = ['node', 'verifier', '--dump', 'fixture.dump', '--restaurar',
    '--previo', '--tablas-esperadas', '1'];
  if (withRoles) argv.push('--roles', 'fixture.sql');

  const fakeFs = {
    existsSync: (file) => file === 'fixture.dump',
    statSync: () => ({ size: 200_001 }),
    readFileSync: (file) => {
      assert.equal(file, 'fixture.sql');
      return 'CREATE ROLE fixture;';
    },
    writeFileSync: () => {},
  };

  function spawnSync(executable, args) {
    calls.push(args);
    if (executable === 'pg_restore') {
      assert.deepEqual(Array.from(args), ['-l', 'fixture.dump']);
      return { status: 0, stdout: '1 TABLE DATA public fixture\n', stderr: '' };
    }
    assert.equal(executable, 'docker');
    return args.includes('pg_restore')
      ? { status: restoreStatus, stdout: '', stderr: restoreStatus ? 'restore failed' : '' }
      : { status: 0, stdout: '', stderr: '' };
  }

  const modules = new Map([
    ['node:fs', fakeFs],
    ['node:child_process', { spawnSync }],
    ['node:path', require('node:path')],
    ['node:os', { tmpdir: () => 'fixture-tmp' }],
  ]);
  vm.runInNewContext(source, {
    require: (name) => {
      assert.ok(modules.has(name), name);
      return modules.get(name);
    },
    process: { argv, env: {}, exit: (code) => { exitCode = code; } },
    console: { log: (line) => output.push(line) },
    Atomics: { wait: () => {} },
  });

  assert.equal(calls.filter((args) => args.includes('/tmp/r.dump') && args[0] === 'exec').length, 1);
  assert.equal(calls.some((args) => args.includes('/tmp/roles.sql')), withRoles);
  assert.equal(calls.at(-1)[0], 'rm');
  return { exitCode, output: output.join('\n') };
}

test('acepta una restauración exitosa con roles', () => {
  const result = runVerifier(0, true);
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /^PASS restauración de prueba del respaldo$/m);
});

test('rechaza una restauración fallida con --roles', () => {
  const result = runVerifier(1, true);
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /^FAIL restauración de prueba del respaldo :: restore failed$/m);
});

test('rechaza una restauración fallida sin --roles', () => {
  const result = runVerifier(1, false);
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /^FAIL restauración de prueba del respaldo :: restore failed$/m);
});
