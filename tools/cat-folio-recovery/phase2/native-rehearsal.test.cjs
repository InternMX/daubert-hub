'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),path=require('node:path');
const {spawnSync}=require('node:child_process');

test('rehearsal rejects an operational converter before reading the schema or opening PostgreSQL',()=>{
  const result=spawnSync(process.execPath,[path.join(__dirname,'native-rehearsal.cjs'),
    '--reference-schema','missing-schema-must-not-be-read.sql','--converter-script',
    path.resolve(__dirname,'outside-approved-temp.ps1')],{encoding:'utf8',timeout:10000});
  assert.ifError(result.error);assert.equal(result.status,1);
  assert.match(result.stderr,/ISOLATED_CONVERTER_REQUIRED/);
  assert.doesNotMatch(result.stderr,/ENOENT|ECONNREFUSED/);
});
