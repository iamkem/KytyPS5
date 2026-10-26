'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {setTimeout:delay}=require('node:timers/promises');
const b=require('../scene-benchmark.cjs');
const logic=require('../logic.cjs');

function fixture(mode='standard'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-bench-fixture-'));
 const s=b.create(root,mode);
 const logDir=mode==='standard'?path.join(root,'_Build','run-logs'):
    path.join(root,'_Build','shader-feature-trial','run-logs');
 fs.mkdirSync(logDir,{recursive:true});
 const stem='20261026-110001-123';
 const logPath=path.join(logDir,stem+'.out.log');
 fs.writeFileSync(logPath,'GPU: NVIDIA\n');
 const announced=path.relative(root,logDir).replaceAll(path.sep,'\\')+'\\'+stem+'.*.log';
 return {root,s,logDir,logPath,announced,done:()=>{b.end(s);fs.rmSync(root,{recursive:true,force:true});}};
}
const line=id=>`LIVE_MEASURE id=${id} label=std1 seconds=15.00 frames=901 fps=60.07 render_ms=5.42 record_ms=4.11 render_busy=32.5% low1=50.44 p99_ms=18.2 max_ms=41.9 over50=0 over100=0\n`;

test('opt-in is default off and survives settings roundtrip without changing graphics preset',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-bench-settings-'));
 try{
  assert.equal(logic.clean({}).scene_benchmark,false);
  assert.equal(logic.clean({scene_benchmark:true}).scene_benchmark,true);
  assert.equal(logic.clean({scene_benchmark:'false'}).scene_benchmark,true,'existing boolean coercion retained');
  const s=logic.saveSettings(root,{scene_benchmark:true,shader_mode:'experimental',ram_diet:false});
  const actual=logic.loadSettings(root);
  assert.equal(actual.scene_benchmark,true);
  assert.equal(actual.shader_mode,'experimental');
  assert.equal(actual.ram_diet,false);
  assert.equal(logic.applyPreset(actual,'Balanced').scene_benchmark,true);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('parses exact runner log announcement, rejecting wrong shader mode and unrelated paths',()=>{
 const f=fixture('experimental');
 try{
  assert.equal(b.parseLogNotice('pid 4321; logs: '+f.announced+'\r\n',f.root,'experimental'),f.logPath);
  assert.equal(b.parseLogNotice('pid 4321; logs: '+f.announced+'\r\n',f.root,'standard'),null);
  assert.equal(b.parseLogNotice('pid 4321; logs: ..\\other\\20261026-110001-123.*.log',f.root,'experimental'),null);
  assert.equal(b.parseLogNotice('logs: '+f.announced,f.root,'experimental'),null);
  assert.equal(b.bindLog(f.s,'noise\npid 4321; logs: '+f.announced,f.root),true);
  assert.equal(f.s.logPath,f.logPath);
 }finally{f.done();}
});

test('parses percent suffix and exact ID, rejects missing, zero frames and NaN',()=>{
 const m=b.readMeasurement(line(102).trim(),102);
 assert.equal(m.fps,60.07);
 assert.equal(m.low1,50.44);
 assert.equal(m.render_busy,32.5);
 assert.equal(b.readMeasurement(line(102).trim(),10),null);
 assert.equal(b.readMeasurement(line(102).replace('frames=901','frames=0').trim(),102),null);
 assert.equal(b.readMeasurement(line(102).replace('fps=60.07','fps=NaN').trim(),102),null);
 assert.equal(b.readMeasurement(line(102).replace('low1=50.44','').trim(),102),null);
 assert.equal(b.readMeasurement(line(102).replace('over50=0','over50=-1').trim(),102),null);
 assert.equal(b.readMeasurement(line(102).replace('frames=901','frames=901.1').trim(),102),null);
 assert.equal(b.readMeasurement(line(102).replace('render_ms=5.42','render_ms=').trim(),102),null);
 assert.equal(b.readMeasurement(line(102).replace('max_ms=41.9','max_ms=5.0').trim(),102),null);
 assert.equal(b.readMeasurement(line(102).replace('fps=60.07','fps=60.07 fps=62').trim(),102),null);
 assert.equal(b.readMeasurement(line(102).trim(),102,'trial1'),null);
 assert.equal(b.readMeasurement(line(102).trim(),102,'std1')?.low1,50.44);
});

test('unique private sessions and fixed command file do not touch a production sentinel',()=>{
 const f=fixture();
 try{
  const sentinel=path.join(f.root,'_PipelineCache','sentinel.features');
  fs.mkdirSync(path.dirname(sentinel),{recursive:true});
  fs.writeFileSync(sentinel,'0 3 stored\n');
  const other=b.create(f.root,'standard');
  try{
   assert.notEqual(other.folder,f.s.folder);
   assert.equal(path.dirname(other.folder),path.dirname(f.s.folder));
   b.publishCommand(f.s,123,'');
   assert.equal(fs.readFileSync(f.s.commandFile,'ascii'),'id 123\n');
   assert.equal(fs.readFileSync(sentinel,'utf8'),'0 3 stored\n');
   assert.equal(fs.readFileSync(other.commandFile,'ascii'),'id 0\n');
  }finally{b.end(other);}
 }finally{f.done();}
});

test('handshake needs native LIVE_DONE and capture reports matched numeric data without game',async()=>{
 const f=fixture();
 try{
  assert.equal(b.bindLog(f.s,'pid 123; logs: '+f.announced,f.root),true);
  const consume=(reply)=>{const text=fs.readFileSync(f.s.commandFile,'ascii');const id=text.match(/^id (\d+)/)?.[1];if(id)fs.appendFileSync(f.logPath,reply(id));};
  const probePromise=b.probe(f.s,{retries:3,delay:700});
  await delay(120);
  consume(id=>'LIVE_DONE id='+id+'\n');
  assert.equal(await probePromise,true);
  assert.equal(f.s.ready,true);
  const measure=b.capture(f.s,{seconds:15,sleep:0,interval:35,timeoutMs:2500});
  await delay(100);
  consume(id=>line(id)+'LIVE_COUNTERS id='+id+' label=std1 sync_reads_render=0.0\nLIVE_DONE id='+id+'\n');
  const x=await measure;
  assert.equal(x.fps,60.07);
  assert.equal(x.low1,50.44);
  assert.match(x.counters,/sync_reads_render=0/);
  const all=fs.readFileSync(path.join(f.s.folder,'results.jsonl'),'utf8').trim().split('\n');
  assert.equal(all.length,1);
  assert.equal(JSON.parse(all[0]).id,x.id);
  assert.equal(f.s.results.length,1);
 }finally{f.done();}
});

test('missing handshake, parallel capture and game exit are safely rejected',async()=>{
 const f=fixture();
 try{
  b.bindLog(f.s,'pid 123; logs: '+f.announced,f.root);
  assert.throws(()=>b.capture(f.s),/handshake/);
  f.s.ready=true;
  const a=b.capture(f.s,{seconds:15,sleep:0,interval:35,timeoutMs:500});
  assert.throws(()=>b.capture(f.s),/already running/);
  b.end(f.s);
  await assert.rejects(a,/session ended/);
  assert.equal(f.s.capturing,false);
  assert.equal(fs.existsSync(path.join(f.s.folder,'results.jsonl')),false);
 }finally{f.done();}
});

test('smoke markup and IPC are connected without auto-running a benchmark',()=>{
 const base=path.join(__dirname,'..');
 const html=fs.readFileSync(path.join(base,'benchmark.html'),'utf8');
 const options=fs.readFileSync(path.join(base,'options.html'),'utf8');
 const main=fs.readFileSync(path.join(base,'main.cjs'),'utf8');
 const preload=fs.readFileSync(path.join(base,'preload.cjs'),'utf8');
 assert.match(html,/id="bench-measure"/);
 assert.match(options,/id="scene-benchmark"/);
 assert.match(main,/sceneBenchmark\.create/);
 assert.match(main,/launcher:benchmark-capture/);
 assert.match(preload,/benchmarkCapture/);
 assert.match(main,/!steam&&cfg\.scene_benchmark/);
 assert.match(main,/KYTY_LIVE_FILE/);
 assert.match(main,/launcher:benchmark-probe/);
 assert.match(main,/index=spec\.args\.indexOf\('-DisableLiveControl'\)/);
});
