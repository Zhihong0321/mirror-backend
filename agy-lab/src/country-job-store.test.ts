import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const appDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('country job and CSV survive a broker process restart',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'country-store-test-'));
  const env={...process.env,COUNTRY_JOB_STORE_DIR:dir};
  try {
    const first=spawnSync(process.execPath,['--input-type=module','-e',`import * as jobs from './src/jobs.ts'; const j=jobs.create('country.industry',{country:'Malaysia',industry:'advertising'}); await jobs.take('pc',{types:['country.industry'],waitMs:0}); jobs.finish(j.id,true,{csv:'name,email\\nExample,hello@example.com\\n'},null); console.log(j.id);`],{cwd:appDir,env,encoding:'utf8'});
    assert.equal(first.status,0,first.stderr); const id=first.stdout.trim().split('\n').at(-1);
    const second=spawnSync(process.execPath,['--input-type=module','-e',`import * as jobs from './src/jobs.ts'; const j=jobs.get(${JSON.stringify(id)}); console.log(JSON.stringify({status:j?.status,csv:j?.result?.csv}));`],{cwd:appDir,env,encoding:'utf8'});
    assert.equal(second.status,0,second.stderr);assert.deepEqual(JSON.parse(second.stdout.trim().split('\n').at(-1)!),{status:'done',csv:'name,email\nExample,hello@example.com\n'});
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('an in-flight country job keeps its owner after hub restart',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'country-live-test-'));const env={...process.env,COUNTRY_JOB_STORE_DIR:dir};
  try{
    const first=spawnSync(process.execPath,['--input-type=module','-e',`import * as jobs from './src/jobs.ts'; const j=jobs.create('country.industry',{country:'Malaysia',industry:'advertising'}); await jobs.take('pc',{types:['country.industry'],waitMs:0}); console.log(j.id);`],{cwd:appDir,env,encoding:'utf8'});
    assert.equal(first.status,0,first.stderr);const id=first.stdout.trim().split('\n').at(-1);
    const second=spawnSync(process.execPath,['--input-type=module','-e',`import * as jobs from './src/jobs.ts'; const j=jobs.get(${JSON.stringify(id)}); console.log(JSON.stringify({status:j?.status,worker:j?.worker}));`],{cwd:appDir,env,encoding:'utf8'});
    assert.equal(second.status,0,second.stderr);assert.deepEqual(JSON.parse(second.stdout.trim().split('\n').at(-1)!),{status:'running',worker:'pc'});
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
