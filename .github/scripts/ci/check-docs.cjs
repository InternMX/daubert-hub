const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { parseRawDiff } = require('./classify-ci-scope.cjs');

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, { encoding, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function markdownLines(contents) {
  let fence;
  return contents.split(/\r?\n/).map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      return '';
    }
    if (marker) {
      fence = marker[1];
      return '';
    }
    return line;
  });
}

function anchors(contents) {
  const used = new Set();
  const lines = markdownLines(contents);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    for (const match of line.matchAll(/<a\b[^>]*\b(?:name|id)=["']([^"']+)["']/gi)) used.add(match[1]);
    const heading = /^ {0,3}#{1,6}(?:\s+|$)(.*)$/.exec(line);
    const setext = line.trim() && /^ {0,3}(?:=+|-+)\s*$/.test(lines[index + 1] ?? '');
    if (!heading && !setext) continue;
    const slug = (heading ? heading[1].replace(/\s+#+\s*$/, '') : line)
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '')
      .trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\p{Zs}_-]/gu, '').replace(/\p{Zs}/gu, '-');
    let unique = slug;
    for (let suffix = 1; used.has(unique); suffix++) unique = `${slug}-${suffix}`;
    used.add(unique);
    if (setext && !heading) index++;
  }
  return used;
}

function* links(contents) {
  const lines = markdownLines(contents);
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/(`+).*?\1/g, '');
    const definition = /^ {0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/.exec(line);
    if (definition) yield [index + 1, definition[1] ?? definition[2]];
    for (const match of line.matchAll(/(?<!\\)\[(?:[^\[\]]|\[[^\]]*\])*\]\(\s*(?:<([^>]+)>|((?:[^\s()]|\([^()]*\))*))(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)/g)) {
      yield [index + 1, match[1] ?? match[2]];
    }
  }
}

function checkLinks(files, read, exists, deleted, report, deletedOnly = false) {
  const anchorCache = new Map();
  for (const file of files) {
    for (const [line, destination] of links(read(file))) {
      if (!destination || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(destination)) continue;
      const [pathname, fragment] = destination.split(/#(.*)/s);
      let target;
      let anchor;
      try {
        target = pathname ? path.posix.normalize(path.posix.join(path.posix.dirname(file), decodeURIComponent(pathname))) : file;
        anchor = fragment && decodeURIComponent(fragment);
      } catch {
        if (!deletedOnly) report(file, line, 'invalid-link-encoding');
        continue;
      }
      if (deleted.has(target)) {
        report(file, line, 'link-to-deleted-path');
      } else if (!deletedOnly) {
        if (!exists(target)) {
          report(file, line, 'broken-relative-link', target);
        } else if (anchor && target.endsWith('.md')) {
          if (!anchorCache.has(target)) anchorCache.set(target, anchors(read(target)));
          if (!anchorCache.get(target).has(anchor)) report(file, line, 'broken-anchor', `${target}#${anchor}`);
        }
      }
    }
  }
}

function baseline() {
  const files = git(['ls-files', '-z', '--', 'docs']).split('\0').filter(file => file.endsWith('.md'));
  let failures = 0;
  checkLinks(files, file => fs.readFileSync(file, 'utf8'), file => fs.existsSync(file), new Set(),
    (file, line, rule, target) => {
      console.log(`${file}:${line}:${rule} ${target ?? ''}`.trimEnd());
      failures++;
    });
  console.log(`Baseline: ${files.length} Markdown files, ${failures} broken links or anchors`);
  return failures ? 1 : 0;
}

const secretPatterns = {
  'age-secret-key': /AGE-SECRET-KEY-1[0-9A-Z]{58}/,
  'private-key': /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  'github-token': /ghp_[A-Za-z0-9]{36}/,
  'github-pat': /github_pat_[A-Za-z0-9_]{22,}/,
  'aws-access-key': /AKIA[0-9A-Z]{16}/,
  'slack-token': /xox[bp]-[A-Za-z0-9-]{10,}/,
};

function scanAddedLines(patch, file, report) {
  let line;
  for (const row of patch.split('\n')) {
    if (row.startsWith('diff --git ')) line = undefined;
    const range = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
    if (range) {
      line = Number(range[1]);
    } else if (line !== undefined && row.startsWith('+')) {
      for (const [rule, pattern] of Object.entries(secretPatterns)) {
        if (pattern.test(row.slice(1))) report(file, line, rule);
      }
      line++;
    } else if (line !== undefined && row.startsWith(' ')) {
      line++;
    }
  }
}

function resolveCommit(ref) {
  const commit = git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)) throw new Error('Invalid commit');
  return commit;
}

function checkDiff(baseRef, headRef) {
  const base = resolveCommit(baseRef);
  const head = resolveCommit(headRef);
  const diff = ['diff', '--no-renames', '--no-ext-diff', '--no-textconv'];
  let failed = false;
  const report = (file, line, rule) => {
    console.error(`${JSON.stringify(file).slice(1, -1)}:${line}:${rule}`);
    failed = true;
  };
  try {
    git([...diff, '--check', base, head]);
  } catch (error) {
    if (error.status !== 2) throw error;
    // Git includes entire offending lines in its output, which can contain secrets.
    console.error('git diff --check found whitespace errors or conflict markers');
    failed = true;
  }
  const entries = parseRawDiff(git([...diff, '--raw', '-z', base, head], 'buffer'));
  const files = git(['ls-tree', '-r', '-t', '--name-only', '-z', head]).split('\0').filter(Boolean);
  const tree = new Set(files);
  tree.add('.');
  const read = file => git(['show', `${head}:${file}`]);
  const deleted = new Set();
  const changedMarkdown = new Set();
  for (const { status, newMode, paths: [file] } of entries) {
    if (file === null) throw new Error('Diff contains an invalid UTF-8 path');
    if (status === 'D') {
      deleted.add(file);
      continue;
    }
    if (file.endsWith('.md') && /^100[0-7]{3}$/.test(newMode)) changedMarkdown.add(file);
    // Force text so added lines in files Git would otherwise mark binary are checked.
    const patch = git([...diff, '--text', '--unified=0', base, head, '--', `:(top,literal)${file}`]);
    scanAddedLines(patch, file, report);
  }
  checkLinks(changedMarkdown, read, file => tree.has(file), deleted, report);
  if (deleted.size) {
    checkLinks(files.filter(file => file.endsWith('.md') && !changedMarkdown.has(file)),
      read, file => tree.has(file), deleted, report, true);
  }
  return failed ? 1 : 0;
}

if (require.main === module) {
  try {
    const [first, base, third, head, ...extra] = process.argv.slice(2);
    if (first === '--all-links' && process.argv.length === 3) process.exitCode = baseline();
    else if (first === '--base' && base && third === '--head' && head && !extra.length) process.exitCode = checkDiff(base, head);
    else throw new Error('Invalid arguments');
  } catch {
    console.error('Documentation checks could not run. Verify that both commit references are available.');
    process.exitCode = 1;
  }
}
