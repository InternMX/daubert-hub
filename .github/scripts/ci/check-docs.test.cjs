const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function check(before, after, verify, base = 'HEAD^1') {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-docs-'));
  const git = (...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  function commit(files) {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(cwd, file);
      if (content === null) {
        fs.unlinkSync(target);
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
      }
    }
    git('add', '-A');
    git('commit', '--allow-empty', '-m', 'fixture');
  }
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Local CI Test');
    git('config', 'user.email', 'ci@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    commit(before);
    commit(after);
    const result = spawnSync(process.execPath, [require.resolve('./check-docs.cjs'), '--base', base, '--head', 'HEAD'],
      { cwd, encoding: 'utf8' });
    verify(result.status, result.stdout + result.stderr);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test('D1: relative links, anchors, duplicate headings, and external URLs', () => {
  check({}, { 'docs/a.md': '[missing](b.md)\n[anchor](#wrong)\n' }, (status, output) => {
    assert.equal(status, 1);
    assert.match(output, /docs\/a.md:1:broken-relative-link/);
    assert.match(output, /docs\/a.md:2:broken-anchor/);
  });
  check({}, { 'docs/a.md': '# Héllo, World!\n## Héllo, World!\n[local](#h%C3%A9llo-world-1)\n' +
    '[link][ref]\n[ref]: #héllo-world\n' +
    '[http](http://example.invalid) [https](https://example.invalid) [mail](mailto:ci@example.invalid)\n' +
    '`[example](missing.md)`\n~~~markdown\n[example](missing.md)\n~~~\n' }, (status, output) => assert.equal(status, 0, output));
});

test('D2: deletion or rename breaks a reference in an unchanged Markdown file', () => {
  const before = { 'docs/a.md': '# A\n', 'elsewhere/b.md': '[a](../docs/a.md#a)\n' };
  for (const after of [{ 'docs/a.md': null }, { 'docs/a.md': null, 'docs/moved.md': '# A\n' }]) {
    check(before, after, (status, output) => {
      assert.equal(status, 1);
      assert.match(output, /elsewhere\/b.md:1:link-to-deleted-path/);
    });
  }
});

test('D3: only added lines are scanned and values never appear in findings', () => {
  const fixtures = [
    ['age-secret-key', 'AGE-SECRET-KEY-1' + 'A'.repeat(58)],
    ['private-key', '-----BEGIN RSA ' + 'PRIVATE KEY-----'],
    ['github-token', 'ghp_' + 'a'.repeat(36)],
    ['github-pat', 'github_pat_' + 'a'.repeat(22)],
    ['aws-access-key', 'AKIA' + 'A'.repeat(16)],
    ['slack-token', 'xoxb-' + '0'.repeat(10)],
  ];
  check({}, { 'examples.txt': fixtures.map(([, value]) => value).join('\n') + '\n' }, (status, output) => {
    assert.equal(status, 1);
    for (const [index, [rule, value]] of fixtures.entries()) {
      assert.ok(output.includes(`examples.txt:${index + 1}:${rule}`));
      assert.ok(!output.includes(value));
    }
  });
  const unchanged = fixtures[0][1] + '\n';
  check({ 'docs/a.md': unchanged }, { 'docs/a.md': unchanged + 'AGE-SECRET-KEY-1...\n' },
    (status, output) => assert.equal(status, 0, output));
});

test('D4: added trailing whitespace fails without echoing line contents', () => {
  check({}, { 'docs/a.md': 'line with trailing space \n' }, (status, output) => {
    assert.equal(status, 1);
    assert.match(output, /git diff --check/);
    assert.doesNotMatch(output, /line with trailing space/);
  });
});

test('D5: unresolvable base fails', () => {
  check({}, {}, (status, output) => {
    assert.equal(status, 1);
    assert.match(output, /commit references/);
  }, 'missing-base');
});
