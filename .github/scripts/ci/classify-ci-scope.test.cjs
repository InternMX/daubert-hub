const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { groupForPath } = require('../../../scripts/release/plan-release.cjs');
const { classify, parseRawDiff, run } = require('./classify-ci-scope.cjs');

function record(file, status = 'M', oldMode = status === 'A' ? '000000' : '100644',
  newMode = status === 'D' ? '000000' : '100644') {
  return Buffer.concat([Buffer.from(`:${oldMode} ${newMode} aa11bb2 cc33dd4 ${status}\0`), Buffer.from(file), Buffer.from([0])]);
}

const context = { event: 'pull_request', parents: 2 };
const classifyRecords = (...records) => classify(parseRawDiff(Buffer.concat(records)), context).mode;

test('C1–C3: exact allowlist and mixed changes', () => {
  for (const file of ['docs/a.md', 'README.md']) assert.equal(classifyRecords(record(file)), 'docs');
  for (const file of ['apps/web/README.md', 'Docs/a.md', 'docs', ...['mjs', 'json', 'html', 'svg', 'MD'].map(ext => `docs/a.${ext}`)]) {
    assert.equal(classifyRecords(record(file)), 'full', file);
  }
  for (const file of ['.github/workflows/ci.yml', '.github/scripts/ci/x.cjs', 'package-lock.json']) {
    assert.equal(classifyRecords(record('docs/a.md'), record(file)), 'full', file);
  }
});

test('C4–C8: renames, deletions, unsupported statuses and modes, empty diff', () => {
  for (const [oldFile, newFile, mode] of [
    ['docs/a.md', 'docs/b.md', 'docs'],
    ['docs/a.md', 'scripts/a.md', 'full'],
    ['apps/x.ts', 'docs/x.md', 'full'],
  ]) assert.equal(classifyRecords(record(oldFile, 'D'), record(newFile, 'A')), mode);
  assert.equal(classifyRecords(record('docs/a.md', 'D')), 'docs');
  assert.equal(classifyRecords(record('apps/x.ts', 'D')), 'full');
  for (const status of ['T', 'U', 'X', 'C', 'R', 'B', 'Z']) {
    assert.equal(classifyRecords(record('docs/a.md', status)), 'full');
  }
  for (const mode of ['100755', '120000', '160000', '040000']) {
    assert.equal(classifyRecords(record('docs/a.md', 'M', mode, mode)), 'full');
  }
  assert.equal(classifyRecords(), 'full');
});

function inRepo(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-scope-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Local CI Test');
    git('config', 'user.email', 'ci@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    fs.mkdirSync(path.join(cwd, 'docs'));
    fs.mkdirSync(path.join(cwd, 'scripts'));
    fs.writeFileSync(path.join(cwd, 'docs/a.md'), '# Test\n');
    git('add', '.');
    git('commit', '-m', 'base');
    fn(cwd, git);
  } catch (error) {
    console.error(`Retained failing repository: ${cwd}`);
    throw error;
  }
  fs.rmSync(cwd, { recursive: true, force: true });
}

test('C9: malformed raw diff and CLI failure leave output untouched', () => {
  const valid = record('docs/a.md');
  for (const malformed of [
    valid.subarray(0, 10), valid.subarray(0, -1), Buffer.concat([valid, Buffer.from('extra\0')]),
    Buffer.from(valid.toString().replace('aa11bb2', 'gg11bb2')),
  ]) assert.throws(() => parseRawDiff(malformed));
  inRepo((cwd, git) => {
    git('checkout', '-b', 'feature');
    git('commit', '--allow-empty', '-m', 'feature');
    git('checkout', 'main');
    git('merge', '--no-ff', 'feature', '-m', 'merge');
    const output = path.join(cwd, 'out');
    fs.writeFileSync(output, 'existing=value\n');
    const env = { ...process.env, GITHUB_OUTPUT: output };
    assert.throws(() => run('pull_request', env, args => args[0] === 'diff' ? valid.subarray(0, -1) : Buffer.from(git(...args))));
    const missingBase = path.join(cwd, '.git', 'shallow');
    fs.writeFileSync(missingBase, `${git('rev-parse', 'HEAD')}\n`);
    const result = spawnSync(process.execPath, [require.resolve('./classify-ci-scope.cjs'), '--event', 'pull_request'], { cwd, env });
    assert.equal(result.status, 1);
    assert.equal(fs.readFileSync(output, 'utf8'), 'existing=value\n');
  });
});

test('C10–C13: event short-circuit, unsafe paths, parent count and release grouping', () => {
  inRepo(cwd => {
    const output = path.join(cwd, 'out');
    for (const event of ['push', 'workflow_dispatch', 'schedule', '', 'other']) {
      run(event, { GITHUB_OUTPUT: output }, () => assert.fail('Unexpected git call'));
    }
    assert.deepEqual(fs.readFileSync(output, 'utf8').match(/^mode=.*$/gm), Array(5).fill('mode=full'));
  });
  for (const file of ['docs/../a.md', 'docs/a\\b.md', '/docs/a.md', 'docs/a\nb.md', 'docs/a\tb.md',
    Buffer.concat([Buffer.from('docs/'), Buffer.from([0xff]), Buffer.from('.md')])]) {
    assert.equal(classifyRecords(record(file)), 'full');
  }
  for (const parents of [1, 3]) assert.equal(classify(parseRawDiff(record('docs/a.md')), { ...context, parents }).mode, 'full');
  for (const prefix of ['', 'docs/', 'docs/nested/', 'Docs/', 'apps/', 'scripts/', '.github/']) {
    for (const name of ['README', 'readme', 'CHANGELOG', 'CONTRIBUTING', 'á file', 'a', '..']) {
      for (const extension of ['.md', '.MD', '.html', '.mjs', '']) {
        const file = prefix + name + extension;
        if (classifyRecords(record(file)) === 'docs') assert.equal(groupForPath(file), 'docs', file);
      }
    }
  }
});

for (const [name, expected, change] of [
  ['docs rename', 'docs', (_cwd, git) => git('mv', 'docs/a.md', 'docs/b.md')],
  ['cross-directory rename', 'full', (_cwd, git) => git('mv', 'docs/a.md', 'scripts/a.md')],
  ['executable bit', 'full', (_cwd, git) => git('update-index', '--chmod=+x', 'docs/a.md')],
  ['deletion', 'docs', (_cwd, git) => git('rm', 'docs/a.md')],
  ['symlink', 'full', (cwd, git) => {
    fs.symlinkSync('a.md', path.join(cwd, 'docs/b.md'));
    git('add', 'docs/b.md');
  }],
]) {
  test(`C14: real two-parent merge with ${name}`, {
    skip: name === 'symlink' && process.platform !== 'linux' && 'Symlink fixture runs only on Linux',
  }, () => inRepo((cwd, git) => {
    git('checkout', '-b', 'feature');
    change(cwd, git);
    git('commit', '-m', name);
    git('checkout', 'main');
    git('merge', '--no-ff', 'feature', '-m', 'merge');
    const output = path.join(cwd, 'out');
    const result = spawnSync(process.execPath, [require.resolve('./classify-ci-scope.cjs'), '--event', 'pull_request'], {
      cwd, env: { ...process.env, GITHUB_OUTPUT: output }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const values = fs.readFileSync(output, 'utf8');
    assert.deepEqual(values.match(/^mode=.*$/gm), [`mode=${expected}`]);
    assert.match(values, new RegExp(`^base=${git('rev-parse', 'HEAD^1')}$`, 'm'));
    assert.match(values, new RegExp(`^head=${git('rev-parse', 'HEAD')}$`, 'm'));
  }));
}
