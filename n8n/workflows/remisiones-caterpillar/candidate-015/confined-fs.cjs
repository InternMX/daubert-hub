// Pure helpers (no I/O on require). Their SOURCE is embedded into n8n nodes by prepare-enabled.cjs, so each function is self-contained.
// Scope: the Caterpillar TEST tree only. Reads: whole root. Writes: ONLY the listed subtrees. Nothing here can name a path outside the root.

function catConfinedPath(value, root, subtrees) {
  const reject = () => { throw new Error('CAT_TEST_PATH_REJECTED'); };
  if (typeof value !== 'string' || !value || /[\u0000-\u001f"*?<>|]/.test(value)) return reject();
  const text = value.replace(/\//g, '\\');
  if (!/^[A-Za-z]:\\/.test(text) || text.slice(2).includes(':')) return reject();
  const parts = text.split('\\').filter((part, index) => index === 0 || part !== '');
  if (parts.some(part => part === '..' || part === '.' || (part !== parts[0] && /[. ]$/.test(part)) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(part))) return reject();
  const expected = root.split('\\');
  const inside = list => list.every((part, index) => parts[index] !== undefined && parts[index].toLowerCase() === part.toLowerCase());
  if (!inside(expected)) return reject();
  if (!subtrees.some(sub => inside(expected.concat(sub ? sub.split('\\') : [])))) return reject();
  return parts.join('\\');
}

// Characters that could change an interpolated PowerShell/cmd command line.
function catCommandArg(value, root, subtrees) {
  const text = catConfinedPath(value, root, subtrees);
  if (/[&;$%^`'(){}\[\],!=]|\s{2,}/.test(text.slice(2))) throw new Error('CAT_TEST_PATH_REJECTED');
  return text;
}

// Wraps the existing read-only guard (createCaterpillarWindowsTestSafety) and re-allows ONLY three mutators, inside the TEST write subtrees.
function createCaterpillarConfinedFs(fs, path, base, confine, writeSubtrees, tempSubtree) {
  const root = base.root;
  function target(value, subtrees) {
    const text = confine(value, root, subtrees);
    let current = root;
    for (const part of path.win32.relative(root, text).split('\\').filter(Boolean)) {
      current = path.win32.join(current, part);
      let stat;
      try { stat = fs.lstatSync(current); } catch { break; }
      if (stat.isSymbolicLink()) throw new Error('CAT_TEST_PATH_REJECTED');
    }
    return text;
  }
  const mutators = {
    mkdirSync: (value, options) => fs.mkdirSync(target(value, writeSubtrees), options),
    writeFileSync: (value, data, options) => fs.writeFileSync(target(value, writeSubtrees), data, options),
    unlinkSync: value => { const file = target(value, [tempSubtree]); if (!/\.html$/i.test(file)) throw new Error('CAT_TEST_PATH_REJECTED'); return fs.unlinkSync(file); }
  };
  return { ...base, fs: new Proxy({}, { get: (_target, method) => (method in mutators ? mutators[method] : base.fs[method]) }) };
}

const WRITE_SUBTREES = ['01_ENTRADA', '02_SALIDAS', '03_LOGS', '04_ERRORES', '06_ARCHIVOS TEMPORALES\\cat-test-5678'];
const TEMP_SUBTREE = '06_ARCHIVOS TEMPORALES\\cat-test-5678';
module.exports = { catConfinedPath, catCommandArg, createCaterpillarConfinedFs, WRITE_SUBTREES, TEMP_SUBTREE };
