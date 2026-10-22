'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cache=require('../cache.cjs');
const versions=require('../cache-generations.cjs');

const GAME='PPSA01341_01.007.000';
function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-versions-'));
 const active=path.join(root,'_PipelineCache','static');
 fs.mkdirSync(active,{recursive:true});
 fs.writeFileSync(path.join(active,GAME+'.binaries'),'OLD_GPU_BINARY');
 fs.writeFileSync(path.join(active,GAME+'.features'),'old features');
 fs.writeFileSync(path.join(active,GAME+'.shaders'),'shader inputs must not be swapped');
 return {root,active,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function binary(folder){
 return fs.readFileSync(path.join(folder,GAME+'.binaries'),'utf8');
}
test('Current active cache cannot be deleted even when IPC supplies its ID',async()=>{
 const fixture=setup(),removed=[];
 try{
  const a=cache.groups(fixture.root).find(x=>x.category==='active');
  assert.ok(a);
  assert.equal(a.locked,true);
  assert.equal(a.switchable,false);
  await assert.rejects(cache.trashSelected(fixture.root,[a.id],{
    trashItem:async f=>removed.push(f)
  },()=>false),/locked/);
  assert.deepEqual(removed,[]);
  assert.equal(binary(fixture.active),'OLD_GPU_BINARY');
 }finally{fixture.close();}
});
test('Snapshot preserves the current cache and creates a selectable saved version',async()=>{
 const fixture=setup();
 try{
  const snap=await versions.snapshot(fixture.root,GAME,()=>{});
  assert.match(snap.id,/^[0-9]{8}-[0-9]{6}-[a-f0-9]{8}$/);
  const saved=cache.groups(fixture.root).find(x=>x.category==='generation');
  assert.ok(saved);assert.equal(saved.switchable,true);
  assert.equal(saved.locked,false);
  assert.equal(binary(fixture.active),'OLD_GPU_BINARY');
  assert.equal(binary(path.join(fixture.root,'_PipelineCache','generations',snap.id)),'OLD_GPU_BINARY');
  assert.ok(fs.existsSync(path.join(fixture.active,GAME+'.shaders')));
 }finally{fixture.close();}
});
test('Switch cache versions changes the real active binary files, keeps old cache as selectable version',async()=>{
 const fixture=setup();
 try{
  const saved=await versions.snapshot(fixture.root,GAME,()=>{});
  fs.writeFileSync(path.join(fixture.active,GAME+'.binaries'),'NEW_GPU_BINARY');
  const result=versions.activate(fixture.root,saved.id,GAME,'unused',{game:'unused'},()=>{},
    ()=>({usable:true,reason:'Compatible'}));
  assert.equal(result.active,saved.id);
  assert.equal(binary(fixture.active),'OLD_GPU_BINARY');
  assert.ok(fs.existsSync(path.join(fixture.active,GAME+'.shaders')));
  const old=path.join(fixture.root,'_PipelineCache','generations',result.previous);
  assert.equal(binary(old),'NEW_GPU_BINARY');
  const inventory=cache.groups(fixture.root);
  assert.equal(inventory.filter(x=>x.category==='active').length,1);
  assert.equal(inventory.filter(x=>x.category==='generation').length,1);
 }finally{fixture.close();}
});
test('A stale/incompatible cache switch rolls back with no lost data',async()=>{
 const fixture=setup();
 try{
  const candidate=await versions.snapshot(fixture.root,GAME,()=>{});
  fs.writeFileSync(path.join(fixture.active,GAME+'.binaries'),'CURRENT_COMPATIBLE');
  assert.throws(()=>versions.activate(fixture.root,candidate.id,GAME,'unused',{game:'unused'},()=>{},
    ()=>({usable:false,reason:'Incompatible GPU/driver'})),/restored/);
  assert.equal(binary(fixture.active),'CURRENT_COMPATIBLE');
  assert.equal(binary(path.join(fixture.root,'_PipelineCache','generations',candidate.id)),'OLD_GPU_BINARY');
  assert.equal(cache.groups(fixture.root).filter(x=>x.category==='generation').length,1);
 }finally{fixture.close();}
});
test('Incomplete archived shards never become selectable cache generations',()=>{
 const fixture=setup();
 try{
  const p=path.join(fixture.root,'_PipelineCache','archived-shards','interrupted');
  fs.mkdirSync(p,{recursive:true});fs.writeFileSync(path.join(p,'shard0of530'),'partial');
  const inventory=cache.groups(fixture.root);
  assert.ok(inventory.some(i=>i.category==='archive'));
  assert.ok(!inventory.some(i=>i.category==='archive'&&i.switchable));
  assert.throws(()=>versions.activate(fixture.root,'interrupted',GAME,'',{},()=>{}),/Invalid generation ID/);
 }finally{fixture.close();}
});
