// Pure factory: no filesystem access at import/construction. n8n only receives built-in fs/path.
// This is NOT permission to execute the candidate: its independent unconditional holds remain.
function createCatTestPathGuard(fs, path) {
  const root = 'C:\\Users\\06\\Documents\\Dropbox\\Pruebas\\REMISIONES CAT';
  const blocked = () => { throw new Error('CAT5690_NOT_APPROVED: validate runtime, database, paths and scripts before enabling'); };
  const fail = () => { throw new Error('CAT5690_PATH_REJECTED: existing verified Caterpillar TEST path required'); };
  const inside = (base, candidate) => {
    const rel = path.win32.relative(base.toLowerCase(), candidate.toLowerCase());
    return rel === '' || (!rel.startsWith('..\\') && rel !== '..' && !path.win32.isAbsolute(rel));
  };
  function assertExisting(value) {
    // Fail closed on POSIX/container mappings. A reviewed mapping is a separate prerequisite.
    if (path.sep !== '\\' || typeof value !== 'string' || !value || value.includes('\0')) return fail();
    const input = value.replace(/\//g, '\\');
    if (!/^[A-Za-z]:\\/.test(input) || /[*?]/.test(input) || input.slice(2).includes(':') || input.split('\\').includes('..')) return fail();
    const normalized = path.win32.normalize(input);
    if (!inside(root, normalized)) return fail();
    try {
      const actualRoot = fs.realpathSync(root);
      if (path.win32.normalize(actualRoot).toLowerCase() !== root.toLowerCase()) return fail();
      // Reject junction/symlink components even when their final target happens to be inside.
      let current = root;
      if (fs.lstatSync(current).isSymbolicLink()) return fail();
      for (const part of path.win32.relative(root, normalized).split('\\').filter(Boolean)) {
        current = path.win32.join(current, part);
        if (fs.lstatSync(current).isSymbolicLink() || !inside(actualRoot, fs.realpathSync(current))) return fail();
      }
      if (!inside(actualRoot, fs.realpathSync(normalized))) return fail();
      return normalized;
    } catch { return fail(); }
  }
  const allowed = new Set(['existsSync', 'statSync', 'lstatSync', 'realpathSync', 'readdirSync',
    'readFileSync', 'mkdirSync', 'unlinkSync', 'writeFileSync', 'appendFileSync']);
  const guardedFs = new Proxy({}, {
    get(_target, method) {
      if (!allowed.has(method)) return fail();
      return (target, ...args) => fs[method](assertExisting(target), ...args);
    }
  });
  function executionSegment(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) return fail();
    return value;
  }
  return { root, block: blocked, assertExisting, fs: guardedFs, executionSegment };
}
module.exports = { createCatTestPathGuard };
