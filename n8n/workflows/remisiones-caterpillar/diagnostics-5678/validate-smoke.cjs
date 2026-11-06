// OFFLINE only: local pure calculation, never imports/runs a workflow in n8n.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const ts=require('typescript');
const {buildSmoke,sha256Utf8,sha256,workflowFile,expectedFile}=require('./prepare-smoke.cjs');
const workflow=JSON.parse(fs.readFileSync(workflowFile,'utf8'));
const expected=JSON.parse(fs.readFileSync(expectedFile,'utf8'));
const rebuilt=buildSmoke();
assert.deepEqual(workflow,rebuilt.workflow,'Smoke artifact drift');
assert.deepEqual(expected,rebuilt.expected,'Golden values differ from current original V1 sources');
assert.equal(workflow.nodes.length,2);
assert.equal(workflow.active,false);
assert.equal(workflow.id,undefined);
assert.deepEqual(workflow.pinData,{});
assert.deepEqual(workflow.nodes.map(n=>n.type),['n8n-nodes-base.manualTrigger','n8n-nodes-base.code']);
assert.deepEqual(workflow.connections,{'Manual Trigger':{main:[[{node:'Manifest V1 synthetic diagnostic',type:'main',index:0}]]}});
for(const node of workflow.nodes){assert.equal(node.credentials,undefined);assert.equal(node.webhookId,undefined);}
const code=workflow.nodes[1].parameters.jsCode;
const ast=ts.createSourceFile('synthetic-smoke.js',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const forbidden=new Set(['require','module','process','global','globalThis','Buffer','fetch','XMLHttpRequest',
  '$input','$execution','$env','$getWorkflowStaticData','$','eval','Function','setTimeout','setInterval']);
function inspect(node){
  if(ts.isIdentifier(node))assert(!forbidden.has(node.text),'Forbidden external capability: '+node.text);
  assert(!ts.isImportDeclaration(node)&&!ts.isImportEqualsDeclaration(node),'Runtime import forbidden');
  if(ts.isStringLiteral(node))assert(!/^[A-Za-z]:[\\/]|^https?:\/\//i.test(node.text),'External path/endpoint forbidden');
  ts.forEachChild(node,inspect);
}
inspect(ast);
for(const input of ['', 'abc', 'a'.repeat(1000), 'á漢🙂'])assert.equal(sha256Utf8(input),sha256(input));
// Pure Code-body simulation in local Node. No n8n runtime or external capabilities provided.
const output=new Function(code)();
assert.equal(output.length,2);
for(let i=0;i<output.length;i++){
  const result=output[i].json,golden=expected.cases[i];
  assert.equal(result.caseId,golden.caseId);assert.equal(result.status,'PASS');
  assert.equal(result.manifestVersion,'CAT_OPERATIONAL_CONTENT_V1');
  assert.equal(result.lineCount,3);assert.equal(result.contentSha256,golden.sha256);
  assert.equal(result.deliveryIdentity,'UNCONFIRMED');
  assert(Object.values(result.comparison).every(v=>v===true));
  assert.deepEqual(Object.keys(result).sort(),['caseId','manifestVersion','lineCount','manifestDocumentCount','contentSha256','expectedSha256','comparison','deliveryIdentity','status'].sort());
}
const needle='"cantidad_numerica":1.25';
assert(code.includes(needle));
const tampered=code.replace(needle,'"cantidad_numerica":1.5');
const mismatch=new Function(tampered)();
assert.equal(mismatch[0].json.status,'FAIL','Changed quantity must detect source/runtime mismatch');
assert.equal(mismatch[1].json.status,'PASS');
assert.equal(mismatch[0].json.comparison.canonicalMatches,false);
assert.equal(mismatch[0].json.comparison.sha256Matches,false);
const serialized=JSON.stringify(workflow);
assert(!/-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(?:ql)?:\/\/|(?:token|secret|password|authorization)\s*[:=]\s*['"][^'"]+/i.test(serialized));
console.log(JSON.stringify({result:'SMOKE_OFFLINE_PASS',liveRuntimeTested:false,nodes:2,connections:1,active:false,
  noExternalCapabilities:true,portableHashVectors:4,quantityMismatchDetected:true,
  fileSha256:sha256(fs.readFileSync(workflowFile,'utf8')),diagnostics:output.map(item=>item.json)},null,2));
