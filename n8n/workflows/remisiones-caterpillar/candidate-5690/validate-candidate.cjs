// Offline artifact validation. Never runs node code, SQL, shell commands or real Dropbox I/O.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { createCatTestPathGuard } = require('./runtime-path-guard.cjs');
const { sourceFile, expectedSourceHash, outputFile, holdCode, blockedExpression, ioCodeNames, hash } = require('./prepare-candidate.cjs');
const root = 'C:\\Users\\06\\Documents\\Dropbox\\Pruebas\\REMISIONES CAT';
const sourceBytes = fs.readFileSync(sourceFile);
assert.equal(hash(sourceBytes), expectedSourceHash, 'Source changed');
const source = JSON.parse(sourceBytes);
const candidateBytes = fs.readFileSync(outputFile);
const candidate = JSON.parse(candidateBytes);
assert.equal(candidate.active, false);
for (const key of ['id', 'versionId', 'activeVersionId', 'meta', 'staticData']) assert.equal(candidate[key], undefined);
assert.deepEqual(candidate.pinData, {});
assert.deepEqual(candidate.connections, source.connections, 'Graph must remain unchanged');
assert.deepEqual(candidate.nodes.map(n => [n.id, n.name, n.type]), source.nodes.map(n => [n.id, n.name, n.type]));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const modified = [];
let blockedNodes = 0, parsedCodeNodes = 0, unchangedCodeNodes = 0;
const allowedTypes = new Set(['code', 'scheduleTrigger', 'manualTrigger', 'webhook', 'stickyNote',
  'postgres', 'readWriteFile', 'executeCommand', 'extractFromFile', 'splitInBatches', 'if', 'respondToWebhook']);
for (const n of candidate.nodes) {
  const original = source.nodes.find(x => x.id === n.id);
  assert(allowedTypes.has(n.type.replace('n8n-nodes-base.', '')), 'Unknown node capability');
  assert.equal(n.credentials, undefined);
  assert.equal(n.webhookId, undefined);
  if (JSON.stringify(n) !== JSON.stringify(original)) modified.push(n.name);
  if (/\.(scheduleTrigger|manualTrigger|webhook)$/.test(n.type)) {
    assert.equal(n.disabled, true);
    if (n.type.endsWith('.webhook')) {
      assert.equal(n.parameters.path, 'cat-5690-candidate-reprocess-NOT-APPROVED');
      assert.equal(n.parameters.authentication, 'headerAuth');
    }
    const expected = structuredClone(original.parameters);
    if (n.type.endsWith('.webhook')) expected.path = 'cat-5690-candidate-reprocess-NOT-APPROVED';
    assert.deepEqual(n.parameters, expected, 'Unexpected trigger change');
    continue;
  } else assert.notEqual(n.disabled, true, 'Action nodes must fail, not be bypassed');
  if (n.type.endsWith('.postgres')) {
    assert.equal(n.parameters.query, blockedExpression(original.parameters.query));
    assert.deepEqual(n.parameters.options, original.parameters.options, 'SQL bindings changed');
    blockedNodes++;
  } else if (n.type.endsWith('.readWriteFile')) {
    const key = n.parameters.operation === 'write' ? 'fileName' : 'fileSelector';
    assert.equal(n.parameters[key], blockedExpression(original.parameters[key]));
    blockedNodes++;
  } else if (n.type.endsWith('.executeCommand')) {
    assert.equal(n.parameters.command, blockedExpression(original.parameters.command));
    blockedNodes++;
  } else if (n.type.endsWith('.code')) {
    const code = n.parameters.jsCode;
    // Compile only. No workflow logic is invoked, including its holds.
    new AsyncFunction('$input', '$', '$execution', 'require', code);
    parsedCodeNodes++;
    if (ioCodeNames.includes(n.name)) {
      assert(code.startsWith('// CAT5690: hard hold'));
      assert(code.indexOf(holdCode) < code.indexOf('require('));
      assert(!code.includes('const fs = require("fs");'), 'Unguarded filesystem import');
      const body = code.split('// CAT5690_ORIGINAL_BODY\n')[1];
      assert(body, 'Missing original-body boundary');
      if (['Limpiar HTML temporal por error CAT', 'Registrar log error CAT',
        'Validar elegibilidad reproceso CAT', 'Detectar archivo REPROCESS CAT1'].includes(n.name)) {
        assert.equal(body.replace('const fs = __cat5690.fs;', 'const fs = require("fs");'), original.parameters.jsCode,
          'Unexpected change to error/reprocess logic');
      }
      blockedNodes++;
    } else {
      assert.equal(code, original.parameters.jsCode, 'Unplanned functional Code change: ' + n.name);
      unchangedCodeNodes++;
    }
    const ast = ts.createSourceFile('candidate.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function inspect(node) {
      if (ts.isStringLiteral(node) && /^[A-Za-z]:\\/.test(node.text)) {
        const rel = path.win32.relative(root.toLowerCase(), path.win32.normalize(node.text).toLowerCase());
        assert(rel === '' || (rel !== '..' && !rel.startsWith('..\\') && !path.win32.isAbsolute(rel)), 'External absolute path');
      }
      ts.forEachChild(node, inspect);
    }
    inspect(ast);
  } else if (!n.type.endsWith('.stickyNote')) {
    assert.deepEqual(n.parameters, original.parameters, 'Unplanned parameters change: ' + n.name);
  }
}
for (const name of ['Normalizar datos CAT', 'Preparar reserva folios PG', 'Asignar folios PG CAT',
  'Propagar ejecución PG', 'Normalizar y validar entrada reproceso CAT', 'Mapear resultado creación reproceso CAT']) {
  assert.deepEqual(candidate.nodes.find(n => n.name === name).parameters, source.nodes.find(n => n.name === name).parameters);
}
const detector = candidate.nodes.find(n => n.name === 'Detectar archivos CAT1').parameters.jsCode;
assert(detector.includes('const RUTAS_REALES = [];'));
assert(detector.includes('const ACTIVAR_RUTAS_REALES = false;'));
assert(!candidate.nodes.find(n => n.name === 'Renderizar HTML').parameters.jsCode.includes('fs.readdirSync(first.temp_dir)'));
assert(candidate.nodes.find(n => n.name === 'Preparar archivo CAT').parameters.jsCode.includes('__cat5690.executionSegment(String($execution.id))'));
const text = candidateBytes.toString('utf8');
for (const credential of source.nodes.flatMap(n => Object.values(n.credentials || {}))) {
  assert(!text.includes(credential.id), 'Original credential reference retained');
  assert(!text.includes(credential.name), 'Original credential name retained');
}
assert(!/-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s/@:]+:[^\s/@]+@|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(text));
assert(!/(?:token|secret|password|authorization)\s*[:=]\s*['"][^'"]+/i.test(text), 'Embedded credential literal');
for (const name of ['runtime-path-guard.cjs', 'prepare-candidate.cjs', 'validate-candidate.cjs',
  'README.md', 'caterpillar-test-5690.BLOCKED.json']) {
  const content = fs.readFileSync(path.join(__dirname, name), 'utf8');
  assert(content.endsWith('\n'), 'Missing final newline: ' + name);
  assert(!/[ \t]+$/m.test(content), 'Trailing whitespace: ' + name);
}

// Exercise only the path-policy factory against a virtual filesystem. No host paths queried.
let virtualCalls = 0;
const rootLower = root.toLowerCase();
const virtualFs = {
  realpathSync(value) {
    virtualCalls++;
    if (value.toLowerCase().includes('missing')) throw new Error('ENOENT');
    if (value.toLowerCase().includes('escape')) return 'C:\\outside';
    return value;
  },
  lstatSync(value) { virtualCalls++; return { isSymbolicLink: () => value.toLowerCase().includes('junction') }; },
  readFileSync(value) { assert(value.toLowerCase().startsWith(rootLower)); return 'virtual'; }
};
const policy = createCatTestPathGuard(virtualFs, { win32: path.win32, sep: '\\' });
assert.equal(policy.assertExisting(root + '\\00_ARCHIVOS A PROCESAR\\PRUEBA.xlsx'), root + '\\00_ARCHIVOS A PROCESAR\\PRUEBA.xlsx');
const rejected = [root + '\\..\\other', root + '_EVIL\\a.xlsx', 'C:\\elsewhere\\Pruebas\\a.xlsx',
  'relative.xlsx', 'D:\\other\\a.xlsx', '\\\\server\\share\\a.xlsx', '\\\\?\\' + root,
  root + '\\a.xlsx:stream', root + '\\*.xlsx', root + '\\missing', root + '\\junction\\a.xlsx', root + '\\escape\\a.xlsx'];
for (const p of rejected) assert.throws(() => policy.assertExisting(p), /CAT5690_PATH_REJECTED/);
assert.throws(() => createCatTestPathGuard(virtualFs, { win32: path.win32, sep: '/' }).assertExisting(root), /CAT5690_PATH_REJECTED/);
assert.throws(() => createCatTestPathGuard({ ...virtualFs, realpathSync: () => 'D:\\redirected' },
  { win32: path.win32, sep: '\\' }).assertExisting(root), /CAT5690_PATH_REJECTED/);
assert.throws(() => policy.block(), /CAT5690_NOT_APPROVED/);
assert.throws(() => policy.executionSegment('../other'), /CAT5690_PATH_REJECTED/);
assert.equal(policy.fs.readFileSync(root + '\\existing.xlsx'), 'virtual');
assert.throws(() => policy.fs.writeFileSync(root + '\\missing.pdf', 'x'), /CAT5690_PATH_REJECTED/);
console.log(JSON.stringify({
  result: 'OFFLINE_VALIDATION_PASS', executionStatus: 'NO APTO PARA EJECUCION',
  sourceSha256: expectedSourceHash, candidateSha256: hash(candidateBytes), nodes: candidate.nodes.length,
  graphUnchanged: true, connections: Object.values(candidate.connections).reduce((total, types) =>
    total + Object.values(types).reduce((n, groups) => n + groups.reduce((k, group) => k + group.length, 0), 0), 0),
  triggersDisabled: true, credentialsRemoved: true, blockedActionNodes: blockedNodes,
  parsedCodeNodes, unchangedCodeNodes, sourceAndDropBoxUntouched: true,
  virtualPathRejections: rejected.length + 4, virtualFilesystemCalls: virtualCalls,
  requiresLive5690IdentityAndMountVerification: true, changedNodeNames: modified
}, null, 2));
