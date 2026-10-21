// OFFLINE preparation only. No n8n connection, SQL, Dropbox or external processes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { createCaterpillarManifestV1 } = require('../candidate-5678/manifest-v1.generated.cjs');
const root = path.resolve(__dirname, '../../../..');
const workflowFile = path.join(__dirname, 'caterpillar-manifest-smoke-5678.INACTIVE.json');
const expectedFile = path.join(__dirname, 'expected-results.json');
const sourceDir = path.join(root, 'apps/api/src/automations/remisiones-caterpillar');
const sha256 = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// Portable SHA-256/UTF-8. Embedded in Code; NO crypto, Buffer, TextEncoder or imports required.
// This fingerprints diagnostic content only; it does not establish delivery identity.
function sha256Utf8(text) {
  const bytes = [];
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp >= 0xd800 && cp <= 0xdfff) throw new Error('Invalid UTF-8 input');
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >>> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >>> 12), 0x80 | ((cp >>> 6) & 63), 0x80 | (cp & 63));
    else bytes.push(0xf0 | (cp >>> 18), 0x80 | ((cp >>> 12) & 63), 0x80 | ((cp >>> 6) & 63), 0x80 | (cp & 63));
  }
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000), low = bitLength >>> 0;
  for (const word of [high, low]) for (let shift = 24; shift >= 0; shift -= 8) bytes.push((word >>> shift) & 255);
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  let state = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const rotate = (x,n) => (x >>> n) | (x << (32-n));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const w = Array(64).fill(0);
    for (let i = 0; i < 16; i++) {
      const p = offset + i*4;
      w[i] = ((bytes[p]<<24)|(bytes[p+1]<<16)|(bytes[p+2]<<8)|bytes[p+3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotate(w[i-15],7)^rotate(w[i-15],18)^(w[i-15]>>>3);
      const s1 = rotate(w[i-2],17)^rotate(w[i-2],19)^(w[i-2]>>>10);
      w[i] = (w[i-16]+s0+w[i-7]+s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = state;
    for (let i = 0; i < 64; i++) {
      const s1 = rotate(e,6)^rotate(e,11)^rotate(e,25);
      const t1 = (h+s1+((e&f)^(~e&g))+k[i]+w[i]) >>> 0;
      const s0 = rotate(a,2)^rotate(a,13)^rotate(a,22);
      const t2 = (s0+((a&b)^(a&c)^(b&c))) >>> 0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    const work = [a,b,c,d,e,f,g,h];
    state = state.map((v,i) => (v+work[i]) >>> 0);
  }
  return state.map(v => v.toString(16).padStart(8,'0')).join('');
}

function syntheticCases() {
  const standard = { cliente_grupo: 'CAT_P3_P4_P5_P6', planta_codigo: 'P5', subplanta_codigo: '',
    cliente: 'Cliente sintetico TEST', rfc: 'RFC-TEST', fecha_entrega: '21/10/2026', codigo: 'SYN-A',
    numero_parte: '0007-A', orden_compra: '000042', cantidad_numerica: 1.25, unidad_remision: 'PIEZAS' };
  const torreon = { ...standard, cliente_grupo: 'CAT_TORREON', planta_codigo: 'TORREON', subplanta_codigo: 'PLANTA_2',
    cliente: 'Cliente Torreon sintetico TEST', rfc: '', codigo: 'TOR-SYN-A', numero_parte: '0001-A', cantidad_numerica: 1.234567 };
  return [
    { caseId: 'STANDARD_SYNTHETIC', items: [standard, { ...standard, codigo: 'SYN-B', numero_parte: '0008', cantidad_numerica: 2.5, unidad_remision: 'ROLLOS' }, { ...standard }] },
    { caseId: 'TORREON_SYNTHETIC', items: [torreon, { ...torreon, codigo: 'TOR-SYN-B', numero_parte: '0002-B', cantidad_numerica: 2.5, unidad_remision: 'PAQUETES' }, { ...torreon }] }
  ];
}

function referenceFromTypeScript() {
  // Independent reference: compile/load the TWO ORIGINAL modules separately, not the portable bundle.
  const names = ['caterpillar-operational-manifest.ts','caterpillar-operational-manifest.adapter.ts'];
  const sources = names.map(name => fs.readFileSync(path.join(sourceDir,name),'utf8').replace(/\r/g,''));
  const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const manifestExports = {}, adapterExports = {};
  new Function('exports','require',compile(sources[0]))(manifestExports, () => { throw new Error('Unexpected reference dependency'); });
  new Function('exports','require',compile(sources[1]))(adapterExports, name => {
    assert.equal(name,'./caterpillar-operational-manifest'); return manifestExports;
  });
  return { adapt: adapterExports.adaptCaterpillarNormalizedItems,
    sourceSha256: Object.fromEntries(names.map((name,i) => [name,sha256(sources[i])])) };
}

function buildSmoke() {
  const reference = referenceFromTypeScript();
  const portable = createCaterpillarManifestV1();
  const cases = syntheticCases().map(sample => {
    const items = sample.items.map(json => ({json}));
    const result = reference.adapt(items);
    assert.deepEqual(portable.adaptCaterpillarNormalizedItems(items),result,'Portable V1 differs from sources');
    const canonicalJson = JSON.stringify(result.manifest);
    const expectedSha256 = sha256(canonicalJson);
    assert.equal(sha256Utf8(canonicalJson),expectedSha256,'Portable hash differs from Node crypto');
    return { ...sample, expected: { manifestVersion: result.manifest.version, lineCount: sample.items.length,
      manifestDocumentCount: result.manifest.documents.length, canonicalJson, sha256: expectedSha256 } };
  });
  const code = `// Synthetic diagnostic ONLY. No input, credentials, filesystem, DB or external effects.\n` +
    `const manifestV1 = (${createCaterpillarManifestV1.toString().replace(/\r/g,'')})();\n` +
    `const sha256Utf8 = ${sha256Utf8.toString().replace(/\r/g,'')};\n` +
    `const cases = ${JSON.stringify(cases)};\n` +
    `return cases.map(sample => {\n` +
    `  let manifestVersion = sample.expected.manifestVersion, contentSha256 = null, manifestDocumentCount = null;\n` +
    `  let canonicalMatches = false, sha256Matches = false, versionMatches = false, identityUnconfirmed = false;\n` +
    `  try {\n` +
    `    const result = manifestV1.adaptCaterpillarNormalizedItems(sample.items.map(json => ({json})));\n` +
    `    manifestVersion = result.manifest.version;\n` +
    `    manifestDocumentCount = result.manifest.documents.length;\n` +
    `    const canonical = JSON.stringify(result.manifest);\n` +
    `    contentSha256 = sha256Utf8(canonical);\n` +
    `    canonicalMatches = canonical === sample.expected.canonicalJson;\n` +
    `    sha256Matches = contentSha256 === sample.expected.sha256;\n` +
    `    versionMatches = manifestVersion === sample.expected.manifestVersion;\n` +
    `    identityUnconfirmed = result.deliveryIdentity === 'UNCONFIRMED';\n` +
    `  } catch { /* Report FAIL without leaking runtime/internal errors or source data. */ }\n` +
    `  const pass = canonicalMatches && sha256Matches && versionMatches && identityUnconfirmed\n` +
    `    && sample.items.length === sample.expected.lineCount && manifestDocumentCount === sample.expected.manifestDocumentCount;\n` +
    `  return { json: { caseId: sample.caseId, manifestVersion, lineCount: sample.items.length, manifestDocumentCount,\n` +
    `    contentSha256, expectedSha256: sample.expected.sha256,\n` +
    `    comparison: { canonicalMatches, sha256Matches, versionMatches, identityUnconfirmed },\n` +
    `    deliveryIdentity: 'UNCONFIRMED', status: pass ? 'PASS' : 'FAIL' } };\n` +
    `});\n`;
  const workflow = {
    name: 'Caterpillar Manifest V1 Smoke 5678 — SYNTHETIC ONLY',
    nodes: [
      { parameters: {}, type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0,0], id: 'd1057230-a616-4efe-a16a-a31b96a20f7d', name: 'Manual Trigger' },
      { parameters: { mode: 'runOnceForAllItems', jsCode: code }, type: 'n8n-nodes-base.code', typeVersion: 2,
        position: [260,0], id: '47692fa6-1028-4a94-8f09-a2f04a4c5824', name: 'Manifest V1 synthetic diagnostic' }
    ],
    connections: { 'Manual Trigger': { main: [[{ node: 'Manifest V1 synthetic diagnostic', type: 'main', index: 0 }]] } },
    active: false, settings: { executionOrder: 'v1', availableInMCP: false }, pinData: {}, tags: []
  };
  const expected = { description: 'Synthetic golden values from separately compiled ORIGINAL V1/adaptor sources; SHA-256 via Node crypto. No delivery identity claim.',
    sourceSha256: reference.sourceSha256, cases: cases.map(sample => ({caseId:sample.caseId,...sample.expected})) };
  return { workflow, expected };
}

function main() {
  assert(!fs.existsSync(workflowFile)&&!fs.existsSync(expectedFile),'Refusing to overwrite smoke artifacts');
  const {workflow,expected} = buildSmoke();
  fs.writeFileSync(workflowFile,JSON.stringify(workflow,null,2)+'\n',{flag:'wx'});
  fs.writeFileSync(expectedFile,JSON.stringify(expected,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({workflow: path.relative(root,workflowFile), nodes:workflow.nodes.length,active:workflow.active,
    expected:expected.cases.map(({caseId,lineCount,manifestDocumentCount,sha256})=>({caseId,lineCount,manifestDocumentCount,sha256}))},null,2));
}
if(require.main===module)main();
module.exports={buildSmoke,sha256Utf8,sha256,workflowFile,expectedFile};
