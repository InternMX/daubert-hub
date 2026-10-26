// Offline generator. Functional base is ONLY the original downloaded TEST export, not 5690.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const { createCaterpillarWindowsTestSafety } = require('./runtime-test-safety.cjs');
const { readCaterpillarOperationalContent } = require('./manifest-transport.cjs');
const root = path.resolve(__dirname, '../../../..');
const sourceFile = 'C:/Users/06/Downloads/MANUAL TEST REMISIONES CAT.json';
const sourceHash = '273dbd1b94e36be1a698a38558469fd72f60c73489de9b4ee8d115e48a70b517';
const outputFile = path.join(__dirname, 'caterpillar-test-5678.PROPOSED.BLOCKED.json');
const generatedFile = path.join(__dirname, 'manifest-v1.generated.cjs');
const sourceFixtureFile = path.join(__dirname, 'normalization-source.fixture.json');
const sourceDir = path.join(root, 'apps/api/src/automations/remisiones-caterpillar');
const holdCode = "throw new Error('CAT_TEST_5678_NOT_APPROVED');";
const blockExpression = original => `={{ (() => { ${holdCode} return ${JSON.stringify(original)}; })() }}`;
const ioNames = ['Filtrar solo pruebas locales1', 'Detectar archivos CAT1', 'Preparar archivo CAT', 'Renderizar HTML',
  'Limpiar HTML temporal por error CAT', 'Registrar log error CAT', 'Validar elegibilidad reproceso CAT', 'Detectar archivo REPROCESS CAT1'];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function manifestArtifact() {
  const files = ['caterpillar-operational-manifest.ts', 'caterpillar-operational-manifest.adapter.ts'];
  const sources = files.map(file => fs.readFileSync(path.join(sourceDir, file), 'utf8').replace(/\r/g, ''));
  const adapter = sources[1].replace(/^import .* from '\.\/caterpillar-operational-manifest';\s*/m, '');
  if (adapter === sources[1]) throw new Error('Adapter import shape changed');
  const result = ts.transpileModule(sources[0] + '\n' + adapter, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, removeComments: false }, reportDiagnostics: true
  });
  if (result.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw new Error('Transpilation failed');
  const factory = `function createCaterpillarManifestV1() {\nconst exports = {};\n${result.outputText}\nreturn exports;\n}`;
  const metadata = Object.fromEntries(files.map((name, i) => [name, hash(sources[i])]));
  return { factory, text: `// GENERATED from unchanged V1 TypeScript sources. Do not edit by hand.\n// Source SHA-256: ${JSON.stringify(metadata)}\n${factory}\nmodule.exports = { createCaterpillarManifestV1 };\n`, metadata };
}
function replaceOnce(code, search, replacement) {
  if (code.split(search).length !== 2) throw new Error('Unexpected source shape for guarded integration');
  return code.replace(search, replacement);
}
function prepare(source, factory = manifestArtifact().factory) {
  const candidate = structuredClone(source);
  candidate.name = 'Caterpillar TEST Windows 5678 — PROPOSED / BLOCKED';
  candidate.active = false; candidate.pinData = {}; candidate.tags = [];
  for (const key of ['id', 'versionId', 'activeVersionId', 'versionMetadata', 'meta', 'shared', 'staticData']) delete candidate[key];
  for (const node of candidate.nodes) {
    delete node.credentials; delete node.webhookId;
    if (/\.(scheduleTrigger|manualTrigger|webhook)$/.test(node.type)) {
      node.disabled = true;
      node.notes = 'NO APTO PARA EJECUCION. Do not enable or publish.';
      if (node.type.endsWith('.webhook')) node.parameters.path = 'cat-test-5678-manifest-proposed-BLOCKED';
      continue;
    }
    if (node.disabled === true) node.disabled = false; // Never bypass holds through disabled action nodes.
    if (node.type.endsWith('.stickyNote')) { node.parameters.content = '## Caterpillar TEST Windows — NO APTO PARA EJECUCIÓN\nOffline manifest integration; all operational I/O remains blocked.'; continue; }
    if (node.type.endsWith('.postgres')) { node.parameters.query = blockExpression(node.parameters.query); node.notes = 'SQL HOLD, including document/execution writes BEFORE folio reservation. Identity preflight is not approval.'; continue; }
    if (node.type.endsWith('.executeCommand')) { node.parameters.command = blockExpression(node.parameters.command); node.notes = 'HOLD: TEST PowerShell/tool dependencies not verified.'; continue; }
    if (node.type.endsWith('.readWriteFile')) { const key = node.parameters.operation === 'write' ? 'fileName' : 'fileSelector'; node.parameters[key] = blockExpression(node.parameters[key]); node.notes = 'HOLD: no native filesystem operation authorized.'; continue; }
    if (node.name === 'Normalizar datos CAT') {
      let code = node.parameters.jsCode;
      code = replaceOnce(code, 'const salidaFinal =', '// CAT_MANIFEST_CAPTURE_BEGIN\nconst catOperationalContent = adaptCaterpillarNormalizedItems(salida);\n// CAT_MANIFEST_CAPTURE_END\nconst salidaFinal =');
      code = replaceOnce(code, 'return salidaFinal;', 'return salidaFinal.map(item => ({ ...item, json: { ...item.json, cat_operational_content: catOperationalContent } }));');
      node.parameters.jsCode = `// CAT_MANIFEST_DERIVED_BEGIN\nconst { adaptCaterpillarNormalizedItems } = (${factory})();\n// CAT_MANIFEST_DERIVED_END\n` + code;
      node.notes = 'Manifest captured after normalization errors and BEFORE Torreon grouping. No new items, sorting or deduplication.';
    }
    if (node.name === 'Preparar reserva folios PG') {
      let code = replaceOnce(node.parameters.jsCode, 'return [', 'const catControl = readCaterpillarOperationalContent(items);\nreturn [');
      code = replaceOnce(code, 'cantidad: items.length', 'cantidad: items.length,\n      cat_operational_content: catControl');
      node.parameters.jsCode = `const readCaterpillarOperationalContent = ${readCaterpillarOperationalContent.toString()};\n// CAT_RESERVATION_ORIGINAL_BODY\n` + code;
    }
    if (node.name === 'Asignar folios PG CAT') {
      const search = 'const preparacion = $("Preparar reserva folios PG").first()?.json || {};';
      const code = replaceOnce(node.parameters.jsCode, search, search + '\nconst catControl = readCaterpillarOperationalContent(remisiones);\nif (JSON.stringify(catControl) !== JSON.stringify(preparacion.cat_operational_content)) throw new Error("CAT_TEST_MANIFEST_TRANSPORT_INVALID");');
      node.parameters.jsCode = `const readCaterpillarOperationalContent = ${readCaterpillarOperationalContent.toString()};\n// CAT_ASSIGNMENT_ORIGINAL_BODY\n` + code;
    }
    if (ioNames.includes(node.name)) {
      let code = node.parameters.jsCode;
      if (node.name === 'Detectar archivos CAT1') {
        if (!/const RUTAS_REALES = \[[\s\S]*?\n\];/.test(code)) throw new Error('Unexpected route table');
        code = code.replace(/const RUTAS_REALES = \[[\s\S]*?\n\];/, 'const RUTAS_REALES = []; // Removed production locations.');
        code = code.split('\n').filter(line => !(line.trim().startsWith('//') && /[A-Za-z]:\\/.test(line) && !line.includes('Pruebas'))).join('\n');
      }
      if (node.name === 'Preparar archivo CAT') {
        if (!/"06_ARCHIVOS TEMPORALES",\s*"html"/.test(code)) throw new Error('Unexpected temp directory');
        code = code.replace(/"06_ARCHIVOS TEMPORALES",\s*"html"/, '"06_ARCHIVOS TEMPORALES",\n    "cat-test-5678",\n    __catTest.executionSegment(String($execution.id))');
      }
      if (node.name === 'Renderizar HTML') {
        const sweep = /for \(const file of fs\.readdirSync\(first\.temp_dir\)\) \{\n  if \(file\.toLowerCase\(\)\.endsWith\("\.html"\)\) \{\n    fs\.unlinkSync\(path\.join\(first\.temp_dir, file\)\);\n  \}\n\}/;
        if (!sweep.test(code)) throw new Error('Unexpected HTML sweep');
        code = code.replace(sweep, '// No directory sweep; cleanup remains blocked pending per-execution ownership verification.');
      }
      if (node.name === 'Filtrar solo pruebas locales1') code = replaceOnce(code, 'filePath.startsWith(TEST_DIR)', '__catTest.existingPath(item.json.file_path) && filePath.startsWith(TEST_DIR)');
      code = code.replace('const fs = require("fs");', 'const fs = __catTest.fs;');
      node.parameters.jsCode = `// CAT_TEST_IO_HOLD\n${holdCode}\nconst __catTest = (${createCaterpillarWindowsTestSafety.toString()})(require('fs'), require('path'));\n// CAT_TEST_ORIGINAL_IO_BODY\n` + code;
      node.notes = 'Unconditional I/O HOLD; existing-path checks; ALL filesystem mutations separately denied. No new-path approval.';
    }
  }
  return candidate;
}
function main() {
  const bytes = fs.readFileSync(sourceFile);
  if (hash(bytes) !== sourceHash) throw new Error('TEST export changed; review required');
  const artifact = manifestArtifact();
  const source = JSON.parse(bytes);
  // Portable unit-test evidence: only pure node bodies, topology and technical metadata, no credentials or I/O scripts.
  const fixture = { description: 'Pure original node bodies from the reviewed TEST export; synthetic tests only.',
    sourceSha256: sourceHash, connections: source.connections, nodeStructure: source.nodes.map(n => [n.id,n.name,n.type]),
    nodes: source.nodes.filter(n => ['Normalizar datos CAT','Preparar reserva folios PG','Asignar folios PG CAT'].includes(n.name))
      .map(n => ({ name: n.name, parameters: n.parameters })) };
  fs.writeFileSync(sourceFixtureFile, JSON.stringify(fixture, null, 2) + '\n');
  fs.writeFileSync(generatedFile, artifact.text);
  fs.writeFileSync(outputFile, JSON.stringify(prepare(source, artifact.factory), null, 2) + '\n');
  console.log(JSON.stringify({ candidate: path.relative(root, outputFile), sha256: hash(fs.readFileSync(outputFile)), sourceSha256: sourceHash, manifestSources: artifact.metadata }));
}
if (require.main === module) main();
module.exports = { prepare, manifestArtifact, sourceFile, sourceHash, outputFile, generatedFile, sourceFixtureFile, holdCode, blockExpression, ioNames, hash, root };
