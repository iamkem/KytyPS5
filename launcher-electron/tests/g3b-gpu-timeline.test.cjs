'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const b=require('../scene-benchmark.cjs');
const {setTimeout:delay}=require('node:timers/promises');

function setup(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-g3b-trace-'));
  const session=b.create(root,'standard');
  const logFolder=path.join(root,'_Build','run-logs');
  fs.mkdirSync(logFolder,{recursive:true});
  const log=path.join(logFolder,'20261027-134321-111.out.log');
  fs.writeFileSync(log,'native init\n');
  session.logPath=log;session.ready=true;
  return {root,session,log,close(){
    b.end(session);
    fs.rmSync(root,{recursive:true,force:true});
  }};
}
function command(s){
  const file=fs.readFileSync(s.commandFile,'ascii');
  const id=file.match(/^id (\d+)\n/)?.[1];
  const target=file.match(/\ntrace 2 ([^\s]+)\n/)?.[1];
  return {id,target,text:file};
}
function traceHeader(id,count,hz,target) {
  return 'LIVE_TRACE id='+id+' records='+count+' tsc_hz='+hz+' path='+target+'\n';
}
function traceRecords(count){
  const buffer=Buffer.alloc(count*32);
  for(let i=0;i<count;i++){
    buffer.writeBigUInt64LE(BigInt(1000+i*50),i*32);
    buffer.writeUInt32LE(1234,i*32+8);
    buffer.writeUInt32LE([21,8,11,22,23,20][i%6],i*32+12);
    buffer.writeBigUInt64LE(1n,i*32+16);
    buffer.writeBigUInt64LE(BigInt(i+1),i*32+24);
  }
  return buffer;
}

test('G3-B trace header accepts exact native decimal frequency, id and bounded count',()=>{
  const h=b.parseGpuTraceLine('LIVE_TRACE id=77 records=8 tsc_hz=3187139000 path=C:\\trace\\x.bin','77');
  assert.equal(h.count,8);
  assert.equal(h.hz,3187139000);
  assert.equal(h.path,'C:\\trace\\x.bin');
  for(const line of [
   'LIVE_TRACE id=78 records=8 tsc_hz=3187139000 path=C:\\trace\\x.bin',
   'LIVE_TRACE id=77 records=0 tsc_hz=3187139000 path=x',
   'LIVE_TRACE id=77 records=4194305 tsc_hz=3187139000 path=x',
   'LIVE_TRACE id=77 records=8 tsc_hz=NaN path=x',
   'LIVE_TRACE id=77 records=8 tsc_hz=1 path=x',
   'LIVE_TRACE id=77 records=8 tsc_hz=3187139000 path=',
  ]) assert.equal(b.parseGpuTraceLine(line,'77'),null);
});

test('opt-in trace captures in session, persists raw binary and Hz but no FPS/Census data',async()=>{
  const f=setup();
  try{
    const task=b.gpuTimeline(f.session,{sleep:0,interval:20,timeoutMs:2000});
    const {id,target,text}=command(f.session);
    assert.ok(target.startsWith(f.session.folder));
    assert.match(text,/^id \d+\nsleep 0\ntrace 2 /);
    assert.equal(f.session.capturingKind,'gpu-timeline');
    assert.throws(()=>b.capture(f.session),/Another measurement/);
    assert.throws(()=>b.census(f.session),/Another measurement/);
    assert.throws(()=>b.gpuTimeline(f.session),/Another measurement/);
    await delay(40);
    fs.writeFileSync(target,traceRecords(12));
    fs.appendFileSync(f.log,traceHeader(id,12,3187139000,target)+'LIVE_DONE id='+id+'999\n');
    await delay(45);
    assert.equal(f.session.capturing,true,'wrong id completion is ignored');
    fs.appendFileSync(f.log,'LIVE_DONE id='+id+'\n');
    const result=await task;
    assert.equal(result.id,Number(id));
    assert.equal(result.records,12);
    assert.equal(result.tscHz,3187139000);
    assert.equal(result.type,'gpu-timeline');
    assert.equal(result.tracePath,target);
    assert.equal(result.durationSeconds,2);
    assert.equal(fs.readFileSync(target+'.hz','utf8').trim(),'3187139000');
    assert.equal(fs.statSync(target).size,384);
    assert.equal(f.session.gpuTraceResults.length,1);
    assert.equal(fs.existsSync(path.join(f.session.folder,'results.jsonl')),false);
    assert.equal(fs.existsSync(path.join(f.session.folder,'census-results.jsonl')),false);
    const output=fs.readFileSync(path.join(f.session.folder,'gpu-timeline-results.jsonl'),'utf8').trim().split('\n');
    assert.equal(output.length,1);
    assert.equal(JSON.parse(output[0]).records,12);
    assert.equal(f.session.capturing,false);
  }finally{f.close();}
});

test('invalid binary, missing header, spoofed path and wrong ID fail closed',async()=>{
  const cases=[
   (id,p)=>({write:false,log:'LIVE_DONE id='+id+'\n'}),
   (id,p)=>({write:true,bytes:Buffer.alloc(33),log:traceHeader(id,1,3187140000,p)+'LIVE_DONE id='+id+'\n'}),
   (id,p)=>({write:true,bytes:traceRecords(3),log:traceHeader(id,2,3187140000,p)+'LIVE_DONE id='+id+'\n'}),
   (id,p)=>({write:true,bytes:traceRecords(3),log:traceHeader(id,3,3187140000,p+'-other')+'LIVE_DONE id='+id+'\n'}),
   (id,p)=>({write:true,bytes:traceRecords(3),log:traceHeader(id,3,3187140000,p)+'LIVE_ERROR id='+id+' line=trace\nLIVE_DONE id='+id+'\n'}),
   (id,p)=>({write:true,bytes:traceRecords(3),log:traceHeader(Number(id)+1,3,3187140000,p)+'LIVE_DONE id='+id+'\n'})
  ];
  for(const make of cases){
    const f=setup();
    try{
      const task=b.gpuTimeline(f.session,{sleep:0,interval:20,timeoutMs:400});
      const {id,target}=command(f.session);
      const sample=make(id,target);
      if(sample.write)fs.writeFileSync(target,sample.bytes);
      fs.appendFileSync(f.log,sample.log);
      await assert.rejects(task,/trace|GPU|timed out|result|error/i);
      assert.equal(fs.existsSync(path.join(f.session.folder,'gpu-timeline-results.jsonl')),false);
      assert.equal(fs.existsSync(target+'.hz'),false);
      assert.equal(f.session.gpuTraceResults.length,0);
    }finally{f.close();}
  }
});

test('game exit cancels capture without writing a success report',async()=>{
  const f=setup();
  try{
    const task=b.gpuTimeline(f.session,{sleep:0,interval:20,timeoutMs:500});
    const {target}=command(f.session);
    b.end(f.session);
    await assert.rejects(task,/ended/i);
    assert.equal(f.session.capturing,false);
    assert.equal(fs.existsSync(target+'.hz'),false);
  }finally{f.close();}
});

test('GPU timeline is wired to opt-in Launcher IPC and disabled when no game is running',()=>{
 const dir=path.resolve(__dirname,'..');
 const read=f=>fs.readFileSync(path.join(dir,f),'utf8');
 const main=read('main.cjs'),preload=read('preload.cjs'),ui=read('benchmark.js'),html=read('benchmark.html');
 assert.match(main,/launcher:benchmark-gpu-timeline/);
 assert.match(main,/sceneBenchmark\.gpuTimeline\(session\)/);
 assert.match(main,/gpuTraceResults:s\?\.gpuTraceResults/);
 assert.match(preload,/benchmarkGpuTimeline: \(\) => ipcRenderer\.invoke\('launcher:benchmark-gpu-timeline'\)/);
 assert.match(html,/id="bench-gpu-timeline" disabled/);
 assert.match(html,/id="bench-gpu-result"/);
 assert.match(ui,/benchmarkGpuTimeline\(\)/);
 assert.match(ui,/bench-gpu-timeline'\)\.disabled=measuring\|\|s.capturing\|\|!s.ready\|\|!s.active/);
 assert.doesNotMatch(read('scene-benchmark.cjs'),/tracem '+seconds/);
});
