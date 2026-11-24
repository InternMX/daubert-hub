const { execFileSync } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const { TextDecoder } = require('node:util');

function parseRawDiff(buffer) {
  const entries = [];
  let offset = 0;
  function field() {
    const end = buffer.indexOf(0, offset);
    if (end === -1 || end === offset) throw new Error('Invalid raw diff field');
    const value = buffer.subarray(offset, end);
    offset = end + 1;
    return value;
  }
  function decodePath(bytes) {
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return null;
    }
  }
  while (offset < buffer.length) {
    const header = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{4,64}) ([0-9a-f]{4,64}) ([A-Z])([0-9]{0,3})$/.exec(field().toString('latin1'));
    if (!header) throw new Error('Invalid raw diff header');
    const [, oldMode, newMode, , , status, score] = header;
    if (score && (!['M', 'R', 'C'].includes(status) || Number(score) > 100)) {
      throw new Error('Invalid raw diff score');
    }
    const paths = [decodePath(field())];
    if (score && (status === 'R' || status === 'C')) paths.push(decodePath(field()));
    entries.push({ oldMode, newMode, status, paths });
  }
  return entries;
}

function classify(entries, { event, parents, base = '', head = '' }) {
  const full = reason => ({ mode: 'full', reason, base, head });
  if (event !== 'pull_request') return full('non-pr-event');
  if (parents !== 2) return full('head-is-not-two-parent-merge');
  if (!entries.length) return full('empty-diff');
  for (const { status, oldMode, newMode, paths } of entries) {
    if (!['A', 'M', 'D'].includes(status)) return full('unsupported-status');
    if (oldMode !== (status === 'A' ? '000000' : '100644') ||
        newMode !== (status === 'D' ? '000000' : '100644')) return full('unsupported-mode');
    for (const file of paths) {
      if (!file || /[\\\p{Cc}]/u.test(file) || file.startsWith('/') || file.split('/').includes('..')) {
        return full('unsafe-path');
      }
      if (file !== 'README.md' && !/^docs\/.+\.md$/.test(file)) return full('outside-docs-allowlist');
    }
  }
  return { mode: 'docs', reason: 'docs-only', base, head };
}

function run(event, env = process.env, git = args => execFileSync('git', args, {
  maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
})) {
  let result;
  if (event !== 'pull_request') {
    const before = env.CI_PUSH_BEFORE;
    const hasBefore = before && !/^0+$/.test(before);
    result = classify([], { event, base: hasBefore ? before : 'HEAD^1', head: hasBefore ? env.GITHUB_SHA : 'HEAD' });
  } else {
    const commit = git(['cat-file', '-p', 'HEAD']).toString('utf8');
    const parents = [...commit.split('\n\n', 1)[0].matchAll(/^parent ([0-9a-f]{40}|[0-9a-f]{64})$/gm)];
    const head = git(['rev-parse', 'HEAD']).toString('utf8').trim();
    const base = parents[0]?.[1] ?? 'HEAD^1';
    const entries = parents.length === 2
      ? parseRawDiff(git(['diff', '--raw', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', 'HEAD^1', 'HEAD']))
      : [];
    result = classify(entries, { event, parents: parents.length, base, head });
  }
  for (const ref of [result.base, result.head]) {
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64}|HEAD(?:\^1)?)$/.test(ref)) throw new Error('Invalid CI commit reference');
  }
  const output = Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join('');
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, output);
  else process.stdout.write(output);
}

if (require.main === module) {
  try {
    if (process.argv[2] !== '--event' || process.argv.length !== 4) throw new Error('Expected --event VALUE');
    run(process.argv[3]);
  } catch {
    console.error('CI scope classification failed');
    process.exitCode = 1;
  }
}

module.exports = { parseRawDiff, classify, run };
