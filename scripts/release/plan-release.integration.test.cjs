'use strict';
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function runGit(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('CLI creates report only for an ancestral published baseline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daubert-release-test-'));
  try {
    runGit(dir, 'init', '-q');
    runGit(dir, 'config', 'user.name', 'CI Test');
    runGit(dir, 'config', 'user.email', 'test@example.invalid');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"version":"1.2.3"}\n');
    fs.mkdirSync(path.join(dir, 'apps'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'apps', 'example.txt'), 'original\n');
    runGit(dir, 'add', '.');
    runGit(dir, 'commit', '-qm', 'initial');
    const base = runGit(dir, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(dir, 'apps', 'example.txt'), 'modified\n');
    runGit(dir, 'add', '.');
    runGit(dir, 'commit', '-qm', 'change');
    const head = runGit(dir, 'rev-parse', 'HEAD');
    const outDir = path.join(dir, 'output');
    const script = path.join(__dirname, 'plan-release.cjs');
    const ok = spawnSync(process.execPath, [script, '--base', base, '--head', head, '--out-dir', outDir], { cwd: dir, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'release-manifest.json'), 'utf8'));
    assert.equal(manifest.decision, 'CANDIDATO_SOLO_HUB');
    assert.equal(manifest.version, '1.2.3');
    assert.equal(manifest.baselineCommit, base);
    const invalid = spawnSync(process.execPath, [script, '--base', 'not-a-sha', '--head', head, '--out-dir', outDir], { cwd: dir, encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    const notAncestor = spawnSync(process.execPath, [script, '--base', head, '--head', base, '--out-dir', outDir], { cwd: dir, encoding: 'utf8' });
    assert.equal(notAncestor.status, 1);
    assert.match(notAncestor.stderr, /candidato debe ser el HEAD/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
