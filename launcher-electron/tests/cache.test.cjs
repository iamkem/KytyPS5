'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const cache=require('../cache.cjs');
function makeRoot(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-cache-test-'));
  const make=(name,value='test')=>{
    const full=path.join(root,name);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,value);
  };
  make('_PipelineCache/static/PPSA01341_01.007.000.binaries','compiled');
  make('_PipelineCache/static/PPSA01341_01.007.000.features','gpu');
  make('_PipelineCache/archived-shards/2026-10-22-1226-incomplete/shard0','archived');
  make('_PipelineCache/warmup-v2/test/warmup','warmup');
  make('_SaveData.rar','user archive');
  return {root,make};
}
test('Active and archived shader caches are distinct; no game/save files are included',()=>{
  const {root}=makeRoot();
  try{
    const items=cache.groups(root);
    assert.deepEqual(items.map(x=>x.category).sort(),['active','archive','aux']);
    assert.equal(items.find(x=>x.category==='active').count,2);
    assert.equal(items.find(x=>x.category==='archive').count,1);
    assert.equal(items.some(x=>x.location.includes('_SaveData')),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Cleanup policy clearly labels SAFE, REVIEW and PROTECTED categories',()=>{
  const {root}=makeRoot();
  try{
    const inventory=cache.groups(root);
    const active=inventory.find(x=>x.category==='active');
    const archived=inventory.find(x=>x.category==='archive');
    const aux=inventory.find(x=>x.category==='aux');
    assert.equal(active.cleanupLevel,'protected');
    assert.equal(active.cleanupLabel,'DO NOT DELETE');
    assert.equal(active.deletable,false);
    assert.equal(active.locked,true);
    assert.equal(archived.cleanupLevel,'safe');
    assert.equal(archived.cleanupLabel,'SAFE TO CLEAN');
    assert.equal(archived.deletable,true);
    assert.equal(aux.cleanupLevel,'protected');
    assert.equal(aux.cleanupLabel,'KEEP — PERFORMANCE');
    assert.equal(aux.deletable,false);
    assert.equal(aux.locked,true);
    assert.equal(cache.cleanupPolicy('generation').level,'review');
    assert.equal(cache.cleanupPolicy('generation').deletable,true);
    assert.equal(cache.cleanupPolicy('incompatible').level,'review');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Protected auxiliary caches cannot be removed via direct IPC even if renderer is compromised',async()=>{
  const {root}=makeRoot();const moved=[];
  try{
    const aux=cache.groups(root).find(x=>x.category==='aux');
    await assert.rejects(()=>cache.trashSelected(root,[aux.id],{
      trashItem:async file=>moved.push(file)
    },()=>false),/protected cache is locked/i);
    assert.equal(moved.length,0);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Cache deletion refuses bad IDs and a running emulator',async()=>{
  const {root}=makeRoot();const moved=[];
  const shell={trashItem:async full=>moved.push(full)};
  try{
    await assert.rejects(()=>cache.trashSelected(root,['../_SaveData.rar'],shell,()=>false),/Cache list changed/);
    await assert.rejects(()=>cache.trashSelected(root,['active:PPSA01341_01.007.000'],shell,()=>true),/running/);
    assert.deepEqual(moved,[]);
    const out=await cache.trashSelected(root,['archive:2026-10-22-1226-incomplete'],shell,()=>false);
    assert.equal(out.deletedFiles,1);
    assert.equal(moved.length,1);
    assert.match(moved[0],/archived-shards/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
