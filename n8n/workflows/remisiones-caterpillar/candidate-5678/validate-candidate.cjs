// Offline validation only; no n8n, DB, PowerShell or real Dropbox access.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
const path = require('node:path');
const { manifestArtifact, sourceFile, sourceHash, outputFile, generatedFile, sourceFixtureFile, holdCode, blockExpression, ioNames, hash } = require('./prepare-candidate.cjs');
function validate() {
  const sourceBytes = fs.readFileSync(sourceFile);
  assert.equal(hash(sourceBytes), sourceHash);
  const source = JSON.parse(sourceBytes);
  const fixture=JSON.parse(fs.readFileSync(sourceFixtureFile,'utf8'));
  assert.equal(fixture.sourceSha256,sourceHash);
  assert.deepEqual(fixture.connections,source.connections);
  assert.deepEqual(fixture.nodeStructure,source.nodes.map(n=>[n.id,n.name,n.type]));
  assert.deepEqual(fixture.nodes,source.nodes.filter(n=>['Normalizar datos CAT','Preparar reserva folios PG','Asignar folios PG CAT'].includes(n.name))
    .map(n=>({name:n.name,parameters:n.parameters})));
  const bytes = fs.readFileSync(outputFile);
  const candidate = JSON.parse(bytes);
  assert.equal(fs.readFileSync(generatedFile, 'utf8').replace(/\r/g,''), manifestArtifact().text, 'Generated manifest drift');
  assert.equal(candidate.active, false);
  assert.equal(candidate.id, undefined);
  assert.deepEqual(candidate.pinData, {});
  assert.deepEqual(candidate.connections, source.connections);
  assert.deepEqual(candidate.nodes.map(n => [n.id,n.name,n.type]), source.nodes.map(n => [n.id,n.name,n.type]));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  let holds = 0, parsed = 0;
  const modified = [];
  const allowedTypes = new Set(['code','scheduleTrigger','manualTrigger','webhook','stickyNote','postgres',
    'readWriteFile','executeCommand','extractFromFile','splitInBatches','if','respondToWebhook']);
  for (const node of candidate.nodes) {
    const original = source.nodes.find(n => n.id === node.id);
    assert(allowedTypes.has(node.type.replace('n8n-nodes-base.','')));
    assert.equal(node.credentials, undefined); assert.equal(node.webhookId, undefined);
    if (JSON.stringify(node) !== JSON.stringify(original)) modified.push(node.name);
    if (/\.(scheduleTrigger|manualTrigger|webhook)$/.test(node.type)) { assert.equal(node.disabled,true); continue; }
    assert.notEqual(node.disabled,true);
    let guardedExpression;
    if (node.type.endsWith('.postgres')) {
      assert.equal(node.parameters.query,blockExpression(original.parameters.query));
      assert.deepEqual(node.parameters.options,original.parameters.options);
      guardedExpression=node.parameters.query;
    } else if (node.type.endsWith('.executeCommand')) {
      assert.equal(node.parameters.command,blockExpression(original.parameters.command)); guardedExpression=node.parameters.command;
    } else if (node.type.endsWith('.readWriteFile')) {
      const key=node.parameters.operation==='write'?'fileName':'fileSelector';
      assert.equal(node.parameters[key],blockExpression(original.parameters[key])); guardedExpression=node.parameters[key];
    }
    if (guardedExpression) {
      // Evaluate ONLY our unconditional throwing expression in plain JS, not n8n's engine.
      assert.throws(() => new Function('return ('+guardedExpression.slice(3,-2)+');')(), /CAT_TEST_5678_NOT_APPROVED/);
      holds++;
    }
    if (node.type.endsWith('.code')) {
      const code=node.parameters.jsCode;
      new AsyncFunction('$input','$','$execution','require',code); parsed++;
      if (ioNames.includes(node.name)) {
        assert(code.startsWith('// CAT_TEST_IO_HOLD\n'+holdCode));
        assert(code.indexOf(holdCode)<code.indexOf('require(')); holds++;
        assert(!code.includes('const fs = require("fs");'));
        assert.throws(()=>new Function('require',code)(()=>{throw new Error('No imports allowed');}), /CAT_TEST_5678_NOT_APPROVED/);
        if (['Limpiar HTML temporal por error CAT','Registrar log error CAT','Validar elegibilidad reproceso CAT','Detectar archivo REPROCESS CAT1'].includes(node.name)) {
          const body=code.split('// CAT_TEST_ORIGINAL_IO_BODY\n')[1].replace('const fs = __catTest.fs;','const fs = require("fs");');
          assert.equal(body,original.parameters.jsCode,'Reprocess/error logic changed');
        }
      }
      const ast=ts.createSourceFile('candidate.js',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
      function visit(n) {
        if (ts.isStringLiteral(n) && /^[A-Za-z]:\\/.test(n.text)) {
          const base='C:\\Users\\06\\Documents\\Dropbox\\Pruebas\\REMISIONES CAT';
          const rel=path.win32.relative(base.toLowerCase(),path.win32.normalize(n.text).toLowerCase());
          assert(rel==='' || (rel!=='..'&&!rel.startsWith('..\\')&&!path.win32.isAbsolute(rel)),'External operational path');
        }
        ts.forEachChild(n,visit);
      }
      visit(ast);
      if (!ioNames.includes(node.name)&&!['Normalizar datos CAT','Preparar reserva folios PG','Asignar folios PG CAT'].includes(node.name)) assert.equal(code,original.parameters.jsCode);
    }
  }
  // Strip only our two explicit manifest insertions to prove original normalization/grouping untouched.
  const normalizer=candidate.nodes.find(n=>n.name==='Normalizar datos CAT').parameters.jsCode;
  const originalNormalizer=source.nodes.find(n=>n.name==='Normalizar datos CAT').parameters.jsCode;
  const restored=normalizer.split('// CAT_MANIFEST_DERIVED_END\n')[1]
    .replace('// CAT_MANIFEST_CAPTURE_BEGIN\nconst catOperationalContent = adaptCaterpillarNormalizedItems(salida);\n// CAT_MANIFEST_CAPTURE_END\n','')
    .replace('return salidaFinal.map(item => ({ ...item, json: { ...item.json, cat_operational_content: catOperationalContent } }));','return salidaFinal;');
  assert.equal(restored,originalNormalizer);
  for (const name of ['Detectar archivos CAT1','Detectar archivo REPROCESS CAT1']) {
    const original=source.nodes.find(n=>n.name===name).parameters.jsCode;
    const proposed=candidate.nodes.find(n=>n.name===name).parameters.jsCode;
    const functions=code=>ts.createSourceFile('classifier.js',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).statements
      .filter(n=>ts.isFunctionDeclaration(n)&&/^detectar/.test(n.name?.text||'')).map(n=>n.getText());
    assert.deepEqual(functions(proposed),functions(original),'Classification changed');
  }
  for (const [name,marker] of [['Preparar reserva folios PG','// CAT_RESERVATION_ORIGINAL_BODY\n'],['Asignar folios PG CAT','// CAT_ASSIGNMENT_ORIGINAL_BODY\n']]) {
    const node=candidate.nodes.find(n=>n.name===name);
    let body=node.parameters.jsCode.split(marker)[1];
    body=body.replace('const catControl = readCaterpillarOperationalContent(items);\n','')
      .replace('cantidad: items.length,\n      cat_operational_content: catControl','cantidad: items.length')
      .replace('\nconst catControl = readCaterpillarOperationalContent(remisiones);\nif (JSON.stringify(catControl) !== JSON.stringify(preparacion.cat_operational_content)) throw new Error("CAT_TEST_MANIFEST_TRANSPORT_INVALID");','');
    assert.equal(body,source.nodes.find(n=>n.name===name).parameters.jsCode,'Folio logic changed');
  }
  assert(normalizer.indexOf('const catOperationalContent = adaptCaterpillarNormalizedItems(salida);')>normalizer.indexOf('if (errores.length > 0)'));
  assert(normalizer.indexOf('const catOperationalContent = adaptCaterpillarNormalizedItems(salida);')<normalizer.indexOf('const salidaFinal ='));
  assert(!candidate.nodes.find(n=>n.name==='Renderizar HTML').parameters.jsCode.includes('fs.readdirSync(first.temp_dir)'));
  assert(candidate.nodes.find(n=>n.name==='Detectar archivos CAT1').parameters.jsCode.includes('const RUTAS_REALES = [];'));
  const text=bytes.toString('utf8');
  for(const credential of source.nodes.flatMap(n=>Object.values(n.credentials||{}))) { assert(!text.includes(credential.id)); assert(!text.includes(credential.name)); }
  assert(!/-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s/@:]+:[^\s/@]+@|(?:token|secret|password|authorization)\s*[:=]\s*['"][^'"]+/i.test(text));
  assert.equal(holds,24);
  return {result:'OFFLINE_VALIDATION_PASS',executionStatus:'NO APTO PARA EJECUCION',sha256:hash(bytes),sourceSha256:sourceHash,
    nodes:candidate.nodes.length,connections:59,graphUnchanged:true,normalizationRestoredExactly:true,holds,parsedCodeNodes:parsed,modifiedNodes:modified};
}
if(require.main===module) console.log(JSON.stringify(validate(),null,2));
module.exports={validate};
