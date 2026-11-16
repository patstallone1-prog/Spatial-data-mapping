import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const prepare=fileURLToPath(new URL('../tools/business-assets/prepare.mjs',import.meta.url));
const build=fileURLToPath(new URL('../tools/build_business_studio.mjs',import.meta.url));
test('preparation rejects duplicate, unlicensed and nonsensically scaled input before loading optional SDKs',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kerbside-asset-contract-'));try{
  const input=path.join(dir,'input.gltf'),jobs=path.join(dir,'jobs.json');fs.writeFileSync(input,'{}');
  const job={id:'chair-a',role:'dining_chair',license:'CC0-1.0',source:'https://kenney.nl/assets/furniture-kit',longest_m:1,input};
  const run=list=>{fs.writeFileSync(jobs,JSON.stringify(list));return spawnSync(process.execPath,[prepare,'--validate-jobs',jobs],{encoding:'utf8'});};
  assert.equal(run([job]).status,0);assert.notEqual(run([job,job]).status,0);assert.notEqual(run([{...job,license:'unknown'}]).status,0);assert.notEqual(run([{...job,longest_m:-1}]).status,0);assert.notEqual(run([{...job,id:'../escape'}]).status,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('practice builder writes selected valid commercial programs to an isolated output folder',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kerbside-business-build-'));try{
  const result=spawnSync(process.execPath,[build,'--out',dir,'--kinds','clinic,restaurant,grocery,office'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));assert.equal(manifest.houses.length,4);
  for(const row of manifest.houses){const h=JSON.parse(fs.readFileSync(path.join(dir,row.file)));assert.equal(h.validation.passed,true);assert.ok(h.storeys[0].objects.length>5);assert.equal(h.measured,false);}
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
