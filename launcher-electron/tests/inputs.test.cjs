'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const inputs=require('../shader-inputs.cjs');
const root=path.resolve(__dirname,'..','..');
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-inputs-'));
 const files=(name)=>{const full=path.join(dir,'_Build','static-precompile',name);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,name);};
 const game='PPSA01341_01.007.000';
 files('seeds-'+game+'.seeds');
 files('hinted-'+game+'.seeds');
 files('released-'+game+'.seeds');
 files('recorded-play-'+game+'.hints');
 files('seeds-'+game+'.seeds.program');
 files('cache-fingerprint-'+game+'.json');
 files('unrelated.exe');
 const release=path.join(dir,'tools','local','static-precompile');fs.mkdirSync(release,{recursive:true});
 for(const name of ['hints-'+game+'.hints','hints-'+game+'.hints.backup-before-sync',
   'files-'+game+'.files','pass-states.json'])fs.writeFileSync(path.join(release,name),name);
 fs.writeFileSync(path.join(dir,'my-hints-'+game+'.hints'),'user recorded');
 return {dir,game,remove:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('Shader Compilation Inputs are classified and protected independently from GPU cache',()=>{
 const x=fixture();
 try{
  const entries=inputs.inventory(x.dir);
  assert.equal(entries.length,11);
  assert.equal(entries.every(f=>f.locked&&!f.deletable&&f.cleanupLevel==='protected'),true);
  for(const name of ['seeds-'+x.game+'.seeds','hinted-'+x.game+'.seeds',
   'released-'+x.game+'.seeds','recorded-play-'+x.game+'.hints',
   'hints-'+x.game+'.hints','hints-'+x.game+'.hints.backup-before-sync',
   'files-'+x.game+'.files','pass-states.json','my-hints-'+x.game+'.hints'])
    assert.equal(entries.find(f=>f.title===name)?.locked,true,'Must lock '+name);
  assert.equal(entries.find(f=>f.kind==='legacy').locked,true);
  assert.equal(entries.some(f=>f.title==='unrelated.exe'),false);
 }finally{x.remove();}
});
test('Cache Manager cannot delete any game-related seed/hint even via direct backend invocation',async()=>{
 const x=fixture();const moved=[];const shell={trashItem:async file=>moved.push(path.basename(file))};
 try{
  for(const item of inputs.inventory(x.dir))
    await assert.rejects(inputs.remove(x.dir,[item.id],shell,()=>{}),/locked/,item.title);
  await assert.rejects(inputs.remove(x.dir,['unrelated.exe'],shell,()=>{}),/changed/);
  await assert.rejects(inputs.remove(x.dir,['hinted-'+x.game+'.seeds'],shell,()=>{throw Error('Busy');}),/Busy/);
  assert.deepEqual(moved,[]);
 }finally{x.remove();}
});
test('Content fingerprint ignores input timestamps but rejects content changes or replaced GPU cache',()=>{
 const x=fixture();
 try{
  const source=path.join(x.dir,'src','graphics','shader');fs.mkdirSync(source,{recursive:true});
  for(let i=0;i<12;i++)fs.writeFileSync(path.join(source,'translator'+i+'.cpp'),'code-'+i);
  const current=path.join(x.dir,'_PipelineCache','static');fs.mkdirSync(current,{recursive:true});
  fs.writeFileSync(path.join(current,x.game+'.binaries'),'GPU cache bytes');
  const seeds=path.join(x.dir,'_Build','static-precompile','seeds-'+x.game+'.seeds');
  const helper=path.join(root,'tools','local','static-precompile','cache-fingerprint.ps1');
  const ps=(tail)=>{
   const quote=v=>"'"+v.replaceAll("'","''")+"'";
   const code='. '+quote(helper)+'; $r='+quote(x.dir)+'; $game='+quote(x.game)+'; $seeds='+quote(seeds)+
    '; $f=Get-KytyShaderFingerprint $r $seeds $game; '+tail;
   const run=spawnSync('powershell.exe',['-NoProfile','-Command',code],{encoding:'utf8',timeout:40000});
   assert.equal(run.status,0,run.stderr||run.stdout);return run.stdout.trim();
  };
  assert.match(ps('Save-KytyShaderFingerprint $r $game $f; Test-KytyShaderFingerprint $r $game $f'),/True/);
  const time=new Date(Date.now()+40000);
  fs.utimesSync(seeds,time,time);
  assert.match(ps('Test-KytyShaderFingerprint $r $game $f'),/True/);
  fs.appendFileSync(seeds,'changed');
  assert.match(ps('Test-KytyShaderFingerprint $r $game $f'),/False/);
  fs.writeFileSync(seeds,'seeds-'+x.game+'.seeds');
  fs.appendFileSync(path.join(source,'translator1.cpp'),'different');
  assert.match(ps('Test-KytyShaderFingerprint $r $game $f'),/False/);
 }finally{x.remove();}
});
