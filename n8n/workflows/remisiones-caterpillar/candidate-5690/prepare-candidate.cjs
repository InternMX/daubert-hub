// Offline preparation only. Reads one authorized export; writes ONLY this dedicated folder.
// Does not connect to n8n/PostgreSQL or inspect/create anything in Dropbox.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCatTestPathGuard } = require('./runtime-path-guard.cjs');
const sourceFile = 'C:/Users/06/Downloads/MANUAL TEST REMISIONES CAT.json';
const expectedSourceHash = '273dbd1b94e36be1a698a38558469fd72f60c73489de9b4ee8d115e48a70b517';
const outputFile = path.join(__dirname, 'caterpillar-test-5690.BLOCKED.json');
const blockMessage = 'CAT5690_NOT_APPROVED: execution intentionally blocked pending isolation verification';
const holdCode = `throw new Error(${JSON.stringify(blockMessage)});`;
const blockedExpression = original => `={{ (() => { ${holdCode} return ${JSON.stringify(original)}; })() }}`;
const root = 'C:\\Users\\06\\Documents\\Dropbox\\Pruebas\\REMISIONES CAT';
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const ioCodeNames = [
  'Detectar archivos CAT1', 'Preparar archivo CAT', 'Renderizar HTML',
  'Limpiar HTML temporal por error CAT', 'Registrar log error CAT',
  'Validar elegibilidad reproceso CAT', 'Detectar archivo REPROCESS CAT1',
  'Filtrar solo pruebas locales1'
];
function guardCode(code) {
  const prefix = `// CAT5690: hard hold, independent of disabled triggers/credentials.\n${holdCode}\n` +
    `const __cat5690 = (${createCatTestPathGuard.toString()})(require('fs'), require('path'));\n`;
  // Filesystem methods remain guarded even if the explicit hold is reviewed in a later phase.
  return prefix + '// CAT5690_ORIGINAL_BODY\n' + code.replace(/const fs = require\("fs"\);/, 'const fs = __cat5690.fs;');
}
function prepare(source) {
  const candidate = structuredClone(source);
  candidate.name = 'Caterpillar TEST 5690 — BLOCKED / NO APTO PARA EJECUCIÓN';
  candidate.active = false;
  candidate.pinData = {};
  candidate.tags = [];
  for (const key of ['id', 'versionId', 'activeVersionId', 'versionMetadata', 'meta', 'shared', 'staticData']) delete candidate[key];
  candidate.settings = { executionOrder: 'v1', binaryMode: 'separate', availableInMCP: false };
  for (const node of candidate.nodes) {
    delete node.credentials;
    delete node.webhookId;
    // Never disable action nodes: n8n may bypass a disabled node. Holds must execute and fail.
    if (/\.(scheduleTrigger|manualTrigger|webhook)$/.test(node.type)) {
      node.disabled = true;
      node.notes = 'CAT5690: DO NOT ENABLE. Runtime, database, filesystem and scripts are unverified.';
      if (node.type.endsWith('.webhook')) {
        node.parameters.path = 'cat-5690-candidate-reprocess-NOT-APPROVED';
        node.parameters.authentication = 'headerAuth';
      }
      continue;
    }
    if (node.disabled === true) node.disabled = false;
    if (node.type.endsWith('.stickyNote')) {
      node.parameters.content = '## CAT5690 — NO APTO PARA EJECUCIÓN\nOffline candidate. All I/O is held; see README.md. No operational credentials included.';
      continue;
    }
    if (node.type.endsWith('.postgres')) {
      // Original SQL is preserved verbatim as an unreachable literal. No SQL is executed.
      node.parameters.query = blockedExpression(node.parameters.query);
      node.notes = 'CAT5690 HOLD: no credential assigned. Original SQL retained behind unconditional expression failure.';
      continue;
    }
    if (node.type.endsWith('.readWriteFile')) {
      const key = node.parameters.operation === 'write' ? 'fileName' : 'fileSelector';
      node.parameters[key] = blockedExpression(node.parameters[key]);
      node.notes = 'CAT5690 HOLD: native file access requires reviewed real-path enforcement; no operation allowed.';
      continue;
    }
    if (node.type.endsWith('.executeCommand')) {
      node.parameters.command = blockedExpression(node.parameters.command);
      node.notes = 'CAT5690 HOLD: external converter/cleanup scripts have not been inspected. No command allowed.';
      continue;
    }
    if (ioCodeNames.includes(node.name)) {
      let code = node.parameters.jsCode;
      if (node.name === 'Detectar archivos CAT1') {
        const pattern = /const RUTAS_REALES = \[[\s\S]*?\n\];/;
        if (!pattern.test(code)) throw new Error('Unexpected detector route-table shape');
        code = code.replace(pattern, 'const RUTAS_REALES = []; // No production routes in this candidate.');
        // Remove the commented production fallback too; it must not survive copy/paste.
        code = code.split('\n').filter(line => !(line.trim().startsWith('//') && /[A-Za-z]:\\/.test(line) && !line.includes(JSON.stringify(root).slice(1, -1)))).join('\n');
      }
      if (node.name === 'Preparar archivo CAT') {
        const old = /"06_ARCHIVOS TEMPORALES",\s*"html"/;
        if (!old.test(code)) throw new Error('Unexpected temporary-directory shape');
        code = code.replace(old, '"06_ARCHIVOS TEMPORALES",\n      "cat-5690",\n      __cat5690.executionSegment(String($execution.id))');
      }
      if (node.name === 'Renderizar HTML') {
        const sweep = /for \(const file of fs\.readdirSync\(first\.temp_dir\)\) \{\n  if \(file\.toLowerCase\(\)\.endsWith\("\.html"\)\) \{\n    fs\.unlinkSync\(path\.join\(first\.temp_dir, file\)\);\n  \}\n\}/;
        if (!sweep.test(code)) throw new Error('Unexpected bulk HTML cleanup shape');
        code = code.replace(sweep, '// No bulk cleanup. Only a verified per-execution temporary directory may be used.');
      }
      if (node.name === 'Filtrar solo pruebas locales1') {
        code = code.replace('filePath.startsWith(TEST_DIR)', '__cat5690.assertExisting(item.json.file_path) && filePath.startsWith(TEST_DIR)');
      }
      node.parameters.jsCode = guardCode(code);
      node.notes = 'CAT5690 HOLD + strict existing-path guard. Missing paths, alternate mounts and links fail closed.';
    }
  }
  return candidate;
}
function main() {
  const sourceBytes = fs.readFileSync(sourceFile);
  if (hash(sourceBytes) !== expectedSourceHash) throw new Error('Source export changed; stop for review');
  if (fs.existsSync(outputFile)) throw new Error('Candidate already exists; refusing overwrite');
  const source = JSON.parse(sourceBytes);
  fs.writeFileSync(outputFile, JSON.stringify(prepare(source), null, 2) + '\n', { flag: 'wx' });
  console.log('CANDIDATE_PREPARED_BLOCKED: ' + path.relative(process.cwd(), outputFile));
}
if (require.main === module) main();
module.exports = { prepare, sourceFile, expectedSourceHash, outputFile, blockMessage, holdCode, blockedExpression, ioCodeNames, hash };
