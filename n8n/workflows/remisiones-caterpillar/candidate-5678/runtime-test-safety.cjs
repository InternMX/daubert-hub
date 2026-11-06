// Pure factory; constructing it does not access the filesystem or a database.
function createCaterpillarWindowsTestSafety(fs, path) {
  const root = 'C:\\Users\\06\\Documents\\Dropbox\\Pruebas\\REMISIONES CAT';
  const hold = () => { throw new Error('CAT_TEST_5678_NOT_APPROVED'); };
  const reject = () => { throw new Error('CAT_TEST_PATH_UNVERIFIED'); };
  function inside(base, candidate) {
    const rel = path.win32.relative(base.toLowerCase(), candidate.toLowerCase());
    return rel === '' || (rel !== '..' && !rel.startsWith('..\\') && !path.win32.isAbsolute(rel));
  }
  function existingPath(value) {
    if (path.sep !== '\\' || typeof value !== 'string' || !value || value.includes('\0')) return reject();
    const input = value.replace(/\//g, '\\');
    if (!/^[A-Za-z]:\\/.test(input) || /[*?]/.test(input) || input.slice(2).includes(':')) return reject();
    if (input.split('\\').some(p => p === '..' || /[. ]$/.test(p) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(p))) return reject();
    const normalized = path.win32.normalize(input);
    if (!inside(root, normalized)) return reject();
    try {
      const physicalRoot = fs.realpathSync(root);
      if (path.win32.normalize(physicalRoot).toLowerCase() !== root.toLowerCase()) return reject();
      let current = root;
      if (fs.lstatSync(current).isSymbolicLink()) return reject();
      for (const component of path.win32.relative(root, normalized).split('\\').filter(Boolean)) {
        current = path.win32.join(current, component);
        if (fs.lstatSync(current).isSymbolicLink() || !inside(physicalRoot, fs.realpathSync(current))) return reject();
      }
      if (!inside(physicalRoot, fs.realpathSync(normalized))) return reject();
      return normalized;
    } catch { return reject(); }
  }
  const reads = new Set(['existsSync', 'statSync', 'lstatSync', 'realpathSync', 'readdirSync', 'readFileSync']);
  // Mutators are ALWAYS blocked, even if someone removes a node's initial hold.
  const guardedFs = new Proxy({}, { get(_target, method) {
    if (!reads.has(method)) return hold;
    return (target, ...args) => fs[method](existingPath(target), ...args);
  } });
  function executionSegment(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) return reject();
    return value;
  }
  // report must come from the prepared read-only SQL, never from a webhook/body.
  // A reviewed policy is operator-owned; data cannot grant itself authorization.
  function verifyIdentity(report, approved) {
    const requiredFunctions = [
      'core.fn_crear_o_resolver_documento(bigint,text,text,text,text,date,text)',
      'ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)',
      'operacion.reservar_folios_para_ejecucion(bigint,text,integer)',
      'operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)',
      'ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)',
      'ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)',
      'ops.fn_resolver_ejecucion_para_reproceso(bigint)'
    ];
    if (!approved || !['user', 'server', 'port', 'companyId', 'series', 'privilegeFingerprint']
      .every(key => approved[key] !== undefined && approved[key] !== null && approved[key] !== '')) return hold();
    if (!Array.isArray(approved.series) || !approved.series.length || new Set(approved.series).size !== approved.series.length) return hold();
    if (!report || report.database !== 'daubert_hub_test' || report.user !== approved.user || report.server !== approved.server ||
      String(report.port) !== String(approved.port) || String(report.companyId) !== String(approved.companyId) ||
      report.companyActive !== true || report.roleAdministrative !== false || report.schemaCreate !== false || report.directBusinessWrites !== false ||
      report.privilegeFingerprint !== approved.privilegeFingerprint || !Array.isArray(report.functions) ||
      requiredFunctions.some(signature => !report.functions.some(f => f.signature === signature && f.available === true && f.executable === true)) || !Array.isArray(report.series) ||
      approved.series.some(code => !report.series.some(s => s.code === code && s.active === true)) ||
      report.reservationsConsistent !== true) return hold();
    return true; // Diagnostic agreement only; NEVER removes operational holds.
  }
  return { root, hold, existingPath, fs: guardedFs, executionSegment, verifyIdentity };
}
module.exports = { createCaterpillarWindowsTestSafety };
