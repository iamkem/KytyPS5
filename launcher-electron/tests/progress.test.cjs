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

test('Interrupted legacy shader run forces resume and exit 130 never means complete',async()=>{
  const {dir,cleanup}=temp();
  try{
    const logDir=path.join(dir,'_Build','run-logs','launcher-shader-updates');
    fs.mkdirSync(logDir,{recursive:true});
    fs.writeFileSync(path.join(logDir,'last-state.json'),JSON.stringify({status:'interrupted',startedAt:new Date().toISOString(),lines:[]}));
    fs.writeFileSync(path.join(dir,'precompile-windows.ps1'),'[switch]$ForceResume');
    const manager=new ShaderProgress(dir);
    assert.equal(manager.snapshot().status,'interrupted');
    const done=waitFinish(manager);
    const code="console.log(process.argv.includes('-ForceResume')?'FORCE_RESUME_PRESENT':'FORCE_RESUME_MISSING');console.log('update: stopped safely');process.exit(130)";
    manager.run({command:process.execPath,args:['-e',code,'--','-Incremental']});
    const result=await done;
    assert.equal(result.status,'stopped');
    assert.equal(result.percent,null);
    assert.match(fs.readFileSync(result.logFile,'utf8'),/FORCE_RESUME_PRESENT/);
    assert.equal(new ShaderProgress(dir).snapshot().status,'stopped');
  }finally{cleanup();}
});

test('Older precompile runners get a durable resume marker instead of an unsupported flag',async()=>{
  const {dir,cleanup}=temp();
  try{
    const logDir=path.join(dir,'_Build','run-logs','launcher-shader-updates');
    const game=path.join(dir,'installed-game');
    fs.mkdirSync(logDir,{recursive:true});
    fs.mkdirSync(path.join(game,'sce_sys'),{recursive:true});
    fs.writeFileSync(path.join(game,'sce_sys','param.json'),JSON.stringify({titleId:'PPSA01341',contentVersion:'01.007.000'}));
    fs.writeFileSync(path.join(logDir,'last-state.json'),JSON.stringify({status:'stopped',startedAt:new Date().toISOString(),lines:[]}));
    fs.writeFileSync(path.join(dir,'precompile-windows.ps1'),'param([switch]$Incremental)');
    const manager=new ShaderProgress(dir);
    const done=waitFinish(manager);
    const code="console.log(process.argv.includes('-ForceResume')?'UNSUPPORTED_FLAG':'RESUME_MARKER');process.exit(130)";
    manager.run({command:process.execPath,args:['-e',code,'--','-Incremental','-Game',game]});
    const result=await done;
    assert.equal(result.status,'stopped');
    assert.match(fs.readFileSync(result.logFile,'utf8'),/RESUME_MARKER/);
    const marker=path.join(dir,'_PipelineCache','static','PPSA01341_01.007.000.resume-required');
    assert.equal(fs.existsSync(marker),true);
    assert.match(fs.readFileSync(marker,'utf8'),/resume pending/);
  }finally{cleanup();}
});

test('Recover interrupted old shader precompile despite subsequent false up-to-date probes',()=>{
  const {dir,cleanup}=temp();
  try{
    const logDir=path.join(dir,'_Build','run-logs','launcher-shader-updates');
    fs.mkdirSync(logDir,{recursive:true});
    fs.writeFileSync(path.join(logDir,'shader-update-2026-10-23T14-46-13-365Z-old.log'),
      '[stdout] 01:12:50 shards: 438 done, 4 running, 601 waiting (0 split)\n'+
      '[stdout] update: stop requested; finishing active shards\n'+
      '[stdout] done in 01:13:26: partially merged binaries\n'+
      '[stdout] update: stopped safely; previously completed shards merged\n');
    fs.writeFileSync(path.join(logDir,'shader-update-2026-10-23T17-24-03-808Z-probe.log'),
      '[stdout] cache: VALID for current GPU/driver and shaders; nothing to precompile.\n');
    fs.writeFileSync(path.join(logDir,'last-state.json'),
      JSON.stringify({status:'up-to-date',phase:'Already up to date',percent:100,lines:[]}));
    const recovered=new ShaderProgress(dir).snapshot();
    assert.equal(recovered.status,'interrupted');
    assert.equal(recovered.percent,null);
    assert.match(recovered.phase,/resume required/i);

    // A real full completion supersedes the old interrupted job.
    fs.writeFileSync(path.join(logDir,'shader-update-2026-10-23T18-40-00-000Z-done.log'),
      '[stdout] stage: merging completed shader shards\n[stdout] done in 00:28:00: cache updated\n');
    assert.equal(new ShaderProgress(dir).snapshot().status,'up-to-date');

    // A durable resume-required marker overrides cached success.
    fs.mkdirSync(path.join(dir,'_PipelineCache','static'),{recursive:true});
    fs.writeFileSync(path.join(dir,'_PipelineCache','static','PPSA01341_01.007.000.resume-required'),'incomplete\n');
    assert.equal(new ShaderProgress(dir).snapshot().status,'interrupted');
  }finally{cleanup();}
});
