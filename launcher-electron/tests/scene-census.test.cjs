'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {setTimeout:delay}=require('node:timers/promises');
const b=require('../scene-benchmark.cjs');

function setup(mode='standard'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-census-'));
 const session=b.create(root,mode);
 const dir=mode==='experimental'?path.join(root,'_Build','shader-feature-trial','run-logs'):
  path.join(root,'_Build','run-logs');
 fs.mkdirSync(dir,{recursive:true});
 const log=path.join(dir,'20261026-220000-001.out.log');
 fs.writeFileSync(log,'native log\n');
 session.logPath=log;session.ready=true;
 return {root,session,log,close(){b.end(session);fs.rmSync(root,{recursive:true,force:true});}};
}
const hdr=id=>`LIVE_CENSUS id=${id} frames=220 base=00007ff600000000 exe=C:\\Program Files\\KytyPS5\\kyty_emulator.exe\n`;
const entry=(id,kind=12,a='000000000007ab1e',b='0000000000000003',ms='1.2345')=>
 `LIVE_CENSUS_ENTRY id=${id} kind=${kind} a=${a} b=${b} calls_per_frame=100.00 ms_per_frame=${ms}\n`;
function cmdId(s){return fs.readFileSync(s.commandFile,'utf8').match(/^id (\d+)/)?.[1];}

test('Native census header and entries parse exact 64-bit IDs, shader phase and exe with spaces',()=>{
 const id='1792989999999';
 assert.deepEqual(b.parseCensusHeader(hdr(id).trim(),id),{
  frames:220,base:'00007ff600000000',exe:'C:\\Program Files\\KytyPS5\\kyty_emulator.exe'});
 assert.equal(b.parseCensusHeader(hdr(id).trim(),'12'),null);
 const e=b.parseCensusEntry(entry(id,12,'000000000007ab1e','8000000000000003').trim(),id);
 assert.equal(e.b,'8000000000000003');
 assert.equal(e.a,'000000000007ab1e');
 assert.equal(e.ms_per_frame,1.2345);
 assert.equal(e.calls_per_frame,100);
 assert.equal(b.parseCensusEntry(entry(id).trim(),id.slice(0,3)),null);
 assert.equal(b.parseCensusEntry(entry(id,14).trim(),id),null);
 assert.equal(b.parseCensusEntry(entry(id,12,'000000000007ab1e','0000000000000003','NaN').trim(),id),null);
});

test('census is explicit, serialized with FPS measurement, emits report with raw entries but does not touch frame results',async()=>{
 const f=setup('experimental');
 try{
  const prior=b.capture;assert.equal(typeof prior,'function');
  f.session.results.push({id:901,fps:44});
  const task=b.census(f.session,{sleep:0,seconds:5,interval:30,timeoutMs:3000});
  const id=cmdId(f.session);
  assert.match(fs.readFileSync(f.session.commandFile,'ascii'),new RegExp('^id '+id+'\\nsleep 0\\ncensus 5\\n$'));
  assert.throws(()=>b.capture(f.session),/Another measurement/);
  assert.throws(()=>b.census(f.session),/Another measurement/);
  assert.equal(f.session.capturingKind,'census');
  await delay(75);
  fs.appendFileSync(f.log,entry('11')+hdr(id)+entry(id)+entry(id,9,'0000000000000000','0000000000000000','2.4567')+
   'LIVE_DONE id='+id+'999\n');
  await delay(75);
  assert.equal(f.session.capturing,true,'wrong-id completion is not valid');
  fs.appendFileSync(f.log,'LIVE_DONE id='+id+'\n');
  const result=await task;
  assert.equal(result.mode,'experimental');
  assert.equal(result.entryCount,2);
  assert.equal(result.pairedMeasurementId,901);
  assert.equal(result.topEntries[0].kind,9);
  assert.equal(result.type,'census');
  assert.equal(f.session.capturing,false);
  assert.equal(f.session.censusResults.length,1);
  assert.equal(f.session.results.length,1,'original FPS measurements are unmodified');
  assert.equal(fs.existsSync(path.join(f.session.folder,'results.jsonl')),false);
  const raw=JSON.parse(fs.readFileSync(path.join(f.session.folder,'census-'+id+'.json'),'utf8'));
  assert.equal(raw.entries.length,2);
  assert.equal(fs.readFileSync(path.join(f.session.folder,'census-results.jsonl'),'utf8').trim().split('\n').length,1);
 }finally{f.close();}
});

test('invalid or duplicate census output fails closed and creates no successful report',async()=>{
 const scenarios=[
  id=>'LIVE_DONE id='+id+'\n',
  id=>hdr(id)+entry(id)+entry(id)+'LIVE_DONE id='+id+'\n',
  id=>hdr(id)+'LIVE_CENSUS_ENTRY id='+id+' kind=12 a=invalid b=0000000000000003 calls_per_frame=1.00 ms_per_frame=0.2\nLIVE_DONE id='+id+'\n',
  id=>hdr(id).replace('frames=220','frames=1')+entry(id)+'LIVE_DONE id='+id+'\n',
  id=>hdr(id)+'LIVE_ERROR id='+id+' line=census\nLIVE_DONE id='+id+'\n',
 ];
 for(const scenario of scenarios){
  const f=setup();
  try{
   const task=b.census(f.session,{sleep:0,seconds:5,interval:20,timeoutMs:900});
   const id=cmdId(f.session);
   fs.appendFileSync(f.log,scenario(id));
   await assert.rejects(task,/census|instrumented|invalid|Duplicate|timed out/i);
   assert.equal(fs.existsSync(path.join(f.session.folder,'census-results.jsonl')),false);
  }finally{f.close();}
 }
});

test('game exit during incomplete census rejects and releases measurement state',async()=>{
 const f=setup();
 try{
  const task=b.census(f.session,{sleep:0,seconds:5,interval:20,timeoutMs:900});
  b.end(f.session);
  await assert.rejects(task,/Game session ended/);
  assert.equal(f.session.capturing,false);
  assert.equal(f.session.capturingKind,null);
 }finally{f.close();}
});

test('GUI and privileged IPC expose fixed CPU census without arbitrary commands',()=>{
 const root=path.join(__dirname,'..');
 const main=fs.readFileSync(path.join(root,'main.cjs'),'utf8');
 const html=fs.readFileSync(path.join(root,'benchmark.html'),'utf8');
 const js=fs.readFileSync(path.join(root,'benchmark.js'),'utf8');
 const preload=fs.readFileSync(path.join(root,'preload.cjs'),'utf8');
 assert.match(main,/launcher:benchmark-census/);
 assert.match(main,/event.sender!==benchmarkWindow.webContents/);
 assert.match(preload,/benchmarkCensus: \(\) => ipcRenderer.invoke/);
 assert.match(html,/id="bench-census"/);
 assert.match(js,/startMeasurement\('census'\)/);
});
