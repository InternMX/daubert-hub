'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { prepare, digest } = require('./quarantine.cjs');

function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'opencode','cat-recovery-phase2-files-'));
  const binding={requestId:randomUUID(),reservationId:'10000',sourceSha256:digest('synthetic source'),
    expected:Array.from({length:4},(_,i)=>({folio:String(111+i),name:`REM ${111+i} SYNTHETIC.pdf`}))};
  fs.writeFileSync(path.join(root,'sandbox.json'),JSON.stringify({isolated:true}),{flag:'wx'});
  fs.writeFileSync(path.join(root,'custody.json'),JSON.stringify({state:'ISOLATED_UNRELEASED',...binding}),{flag:'wx'});
  fs.mkdirSync(path.join(root,'output'));
  for(const item of binding.expected.slice(0,3)) fs.writeFileSync(path.join(root,'output',item.name),`%PDF-synthetic-${item.folio}`,{flag:'wx'});
  return {root,binding};
}
module.exports.fixture=fixture;

test('partial PDFs: complete quarantine, names/paths/sizes/hashes and idempotent reconciliation',()=>{
  const {root,binding}=fixture();const result=prepare(root,binding);
  assert.equal(result.manifest.files.length,3);assert.deepEqual(fs.readdirSync(path.join(root,'output')),[]);
  for(const f of result.manifest.files){assert.equal(digest(fs.readFileSync(f.quarantinePath)),f.sha256);assert.equal(fs.statSync(f.quarantinePath).size,f.size);assert.equal(fs.existsSync(f.originalPath),false);}
  assert.equal(prepare(root,binding).sha256,result.sha256);
});
for(const stage of ['after-copy','after-move','after-manifest'])test(`interruption ${stage}: preserve evidence and reconcile`,()=>{
  const {root,binding}=fixture();let once=true;
  assert.throws(()=>prepare(root,binding,current=>{if(current===stage&&once){once=false;throw new Error('SYNTHETIC_INTERRUPTION');}}),/SYNTHETIC_INTERRUPTION/);
  const result=prepare(root,binding);assert.equal(result.manifest.complete,true);assert.equal(result.manifest.files.length,3);
});
test('delivered/unknown custody is never accepted as no delivery',()=>{
  for(const state of ['DELIVERED','UNKNOWN']){const {root,binding}=fixture();fs.writeFileSync(path.join(root,'custody.json'),JSON.stringify({state,...binding}));assert.throws(()=>prepare(root,binding),/DELIVERY_OR_CUSTODY_UNPROVEN/);}
});
test('preexisting destination is preserved, never overwritten',()=>{
  const {root,binding}=fixture();const folder=path.join(root,`quarantine-${binding.requestId}`);fs.mkdirSync(folder);
  const target=path.join(folder,binding.expected[0].name);fs.writeFileSync(target,'EXISTING EVIDENCE');
  assert.throws(()=>prepare(root,binding),/QUARANTINE_DESTINATION_EXISTS/);assert.equal(fs.readFileSync(target,'utf8'),'EXISTING EVIDENCE');
});
test('changed source after interrupted copy: reject and retain both versions',()=>{
  const {root,binding}=fixture();assert.throws(()=>prepare(root,binding,stage=>{if(stage==='after-copy')throw new Error('INTERRUPT');}),/INTERRUPT/);
  const source=path.join(root,'output',binding.expected[0].name);fs.writeFileSync(source,'CHANGED');
  assert.throws(()=>prepare(root,binding),/SOURCE_CHANGED/);assert.equal(fs.readFileSync(source,'utf8'),'CHANGED');
});
test('unattributed PDF and changed binding block readiness',()=>{
  const {root,binding}=fixture();fs.writeFileSync(path.join(root,'output','UNKNOWN.pdf'),'UNKNOWN');
  assert.throws(()=>prepare(root,binding),/UNATTRIBUTED_OUTPUT_FILE/);
  assert.throws(()=>prepare(root,{...binding,reservationId:'10001'}),/CUSTODY_RESERVATION_MISMATCH/);
});
test('hard-linked source is rejected and both references are retained',()=>{
  const {root,binding}=fixture();const source=path.join(root,'output',binding.expected[0].name);
  const link=path.join(root,'external-reference.pdf');fs.linkSync(source,link);
  assert.throws(()=>prepare(root,binding),/INVALID_OR_LINKED_PDF_FILE/);
  assert.equal(fs.existsSync(source),true);assert.equal(fs.existsSync(link),true);
});
