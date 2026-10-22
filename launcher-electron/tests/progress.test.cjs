'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {ShaderProgress,parseLine}=require('../shader-progress.cjs');
function sample(){return {lines:[],phase:'Starting',shards:null,percent:null};}
function temp(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-shader-progress-'));return {dir,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};}
function waitFinish(manager){return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Shader progress test timed out')),15000);
  const change=state=>{if(!['running','stopping'].includes(state.status)){
    clearTimeout(timer);manager.off('update',change);resolve(state);
  }};
  manager.on('update',change);
});}
test('Progress parser detects shard counts, realistic percentage and phases',()=>{
  const s=sample();
  parseLine(s,'precompile: 530 shards, 4 at a time');
  parseLine(s,'  00:03:10 shards: 58 done, 4 running, 468 waiting (0 split)');
  assert.deepEqual(s.shards,{done:58,running:4,waiting:468,total:530});
  assert.equal(s.percent,10);
  parseLine(s,'stage: merging completed shader shards into existing cache');
  assert.equal(s.phase,'Merging completed shader shards');
  parseLine(s,'cache:      VALID for current GPU/driver and shaders; nothing to precompile.');
  assert.equal(s.percent,100);
});
test('Progress supervisor streams logs and records successful completion',async()=>{
  const {dir,cleanup}=temp();
  try{
    const manager=new ShaderProgress(dir);
    const done=waitFinish(manager);
    const code="console.log('stage: planning shader work');console.log('  00:00:03 shards: 3 done, 2 running, 5 waiting (0 split)');console.log('stage: merging completed shader shards into existing cache');console.log('done in 00:00:12: cache updated')";
    manager.run({command:process.execPath,args:['-e',code,'--']});
    const result=await done;
    assert.equal(result.status,'completed');
    assert.equal(result.percent,100);
    assert.ok(result.lines.some(x=>x.includes('3 done')));
    assert.match(fs.readFileSync(result.logFile,'utf8'),/merging completed/);
    assert.equal(new ShaderProgress(dir).snapshot().status,'completed');
  }finally{cleanup();}
});
test('Stop request writes a signal and waits for cooperative completion, never kills process',async()=>{
  const {dir,cleanup}=temp();
  try{
    const manager=new ShaderProgress(dir);
    const done=waitFinish(manager);
    const script="const fs=require('fs');const f=process.argv[process.argv.length-1];const i=setInterval(()=>{if(fs.existsSync(f)){console.log('update: stopped safely; completed shards merged');clearInterval(i);process.exit(130)}},60)";
    manager.run({command:process.execPath,args:['-e',script,'--']});
    assert.throws(()=>manager.run({command:process.execPath,args:[]}),/already running/);
    const stopping=manager.stop();
    assert.equal(stopping.status,'stopping');
    const result=await done;
    assert.equal(result.status,'stopped');
    assert.equal(result.exitCode,130);
    assert.equal(fs.existsSync(result.logFile),true);
  }finally{cleanup();}
});
