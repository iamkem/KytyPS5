'use strict';
// Opt-in G2 scene measurement. Does not start emulation, change gameplay input,
// mutate saves, touch shader caches, or invoke a GPU profiler.
const fs = require('node:fs');
const path = require('node:path');

const PREFIX='LIVE_MEASURE';
const MAX_INCREMENT=2*1024*1024;
const MAX_SECONDS=30;

function readMeasurement(line,id,expectedLabel=null) {
  if(!line.startsWith(PREFIX+' id='+id+' '))return null;
  const values=Object.create(null);
  for(const field of line.trim().split(/\s+/).slice(1)){
    const at=field.indexOf('=');
    if(at<1)return null;
    const key=field.slice(0,at);
    if(Object.hasOwn(values,key))return null;
    values[key]=field.slice(at+1);
  }
  if(values.id!==String(id)||!values.label||expectedLabel&&values.label!==expectedLabel)return null;
  const keys=['seconds','frames','fps','render_ms','record_ms','render_busy','low1','p99_ms','max_ms','over50','over100'];
  const result={};
  for(const key of keys){
    const raw=values[key];
    if(typeof raw!=='string')return null;
    const value=key==='render_busy'?raw.replace(/%$/,''):raw;
    if(!/^\d+(?:\.\d+)?$/.test(value))return null;
    result[key]=Number(value);
    if(!Number.isFinite(result[key]))return null;
  }
  const ints=['frames','over50','over100'];
  if(ints.some(k=>!Number.isSafeInteger(result[k]))||result.frames<1||
    result.over100>result.over50||result.over50>result.frames||
    result.seconds<=0||result.fps>1000||result.render_busy>100||
    result.p99_ms>result.max_ms)return null;
  return result;
}

function parseLogNotice(text,root,mode) {
  const expected=mode==='experimental'?
    path.join(root,'_Build','shader-feature-trial','run-logs'):path.join(root,'_Build','run-logs');
  // Runner's exact format: "pid 123; logs: _Build\\run-logs\\YYYY....*.log".
  // Accept only a timestamped filename and exactly the expected mode's directory.
  const re=/pid\s+\d+;\s*logs:\s*([^\r\n]*?)(\d{8}-\d{6}-\d{3})\.\*\.log/g;
  for(const match of text.matchAll(re)) {
    const dir=match[1].trim().replace(/[\\/]+$/,'');
    const resolved=path.resolve(root,dir);
    if(path.normalize(resolved).toLowerCase()!==path.normalize(expected).toLowerCase())continue;
    return path.join(expected,match[2]+'.out.log');
  }
  return null;
}

function create(root, mode) {
  if(!['standard','experimental'].includes(mode))throw Error('Invalid benchmark mode.');
  const parent=path.join(root,'_Build','scene-benchmark');
  fs.mkdirSync(parent,{recursive:true});
  const folder=fs.mkdtempSync(path.join(parent,'session-'));
  const commandFile=path.join(folder,'commands.txt');
  // The native polling thread uses the current id to ignore old commands.
  fs.writeFileSync(commandFile,'id 0\n','utf8');
  return {
    mode,folder,commandFile,logPath:null,running:true,ready:false,probing:false,probeFailed:false,capturing:false,number:0,
    startedAt:Date.now(),lastId:0,results:[]
  };
}

function bindLog(session,text,root) {
  if(!session||!session.running)return false;
  const file=parseLogNotice(text,root,session.mode);
  if(!file)return false;
  // Reject a stale log with the same name; create time must correspond
  // to this launcher session. At early startup the file can appear later.
  session.logPath=file;
  return true;
}

function publishCommand(session,id,body='') {
  if(!session.running)throw Error('Benchmark session has ended.');
  const temp=path.join(session.folder,'commands-'+id+'.tmp');
  try{
    fs.writeFileSync(temp,'id '+id+'\n'+body,{encoding:'ascii',flag:'wx'});
    fs.renameSync(temp,session.commandFile);
  }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}

function waitForDone(session,id,{timeoutMs=5000,interval=250}={}) {
  const log=session.logPath;
  const start=Date.now(),initial=fs.statSync(log).size;
  return new Promise((resolve,reject)=>{
    let offset=initial,tail='';
    const timer=setInterval(()=>{
      try{
        if(!session.running||session.logPath!==log)throw Error('Benchmark session ended during readiness probe.');
        if(Date.now()-start>timeoutMs)throw Error('Live-control readiness timed out.');
        const size=fs.statSync(log).size;
        if(size<offset)throw Error('Active run log was truncated.');
        const bytes=Math.min(size-offset,MAX_INCREMENT);
        if(bytes>0){
          const lines=(tail+readNew(log,offset,offset+bytes)).split(/\r?\n/);
          offset+=bytes;tail=lines.pop().slice(-4096);
          if(lines.some(s=>s.trim()==='LIVE_DONE id='+id)){
            clearInterval(timer);resolve(true);
          }
        }
      }catch(error){clearInterval(timer);reject(error);}
    },interval);
  });
}

async function probe(session,{retries=24,delay=2500}={}) {
  if(!session||!session.logPath||!session.running||session.probing)return false;
  session.probing=true;session.probeFailed=false;
  try{
  for(let i=0;i<retries&&session.running;i++){
    const id=Math.max(Date.now(),session.lastId+1);session.lastId=id;
    // A no-op ID is acknowledged by LIVE_DONE only after the native polling
    // thread is fully running. Early IDs skipped at startup are retried.
    const waiter=waitForDone(session,id,{timeoutMs:delay});
    // Attach a rejection handler even if rename fails before the await.
    waiter.catch(()=>{});
    try{publishCommand(session,id);await waiter;session.ready=true;return true;}catch(error){
      if(!session.running)return false;
    }
  }
  session.ready=false;session.probeFailed=session.running;
  return false;
  }finally{session.probing=false;}
}

function readNew(file,start,end) {
  const handle=fs.openSync(file,'r');
  try{
    const size=end-start, buffer=Buffer.alloc(size);
    const amount=fs.readSync(handle,buffer,0,size,start);
    return buffer.toString('utf8',0,amount);
  }finally{fs.closeSync(handle);}
}

function capture(session, {seconds=15, sleep=5, interval=400, timeoutMs=44000}={}) {
  if(!session||!session.running)throw Error('Game is not active.');
  if(session.capturing)throw Error('A frame measurement is already running.');
  if(!session.ready||!session.logPath||!fs.existsSync(session.logPath))throw Error('Native live-control handshake is not ready yet.');
  if(seconds<1||seconds>MAX_SECONDS||sleep<0||sleep>10)throw Error('Unsupported benchmark duration.');
  if(session.mode!=='standard'&&session.mode!=='experimental')throw Error('Invalid session mode.');
  session.capturing=true;
  session.number++;
  const label=session.mode==='experimental'?'trial'+session.number:'std'+session.number;
  const id=Math.max(Date.now(),session.lastId+1);
  session.lastId=id;
  const log=session.logPath;
  const initial=fs.statSync(log).size;
  const data='sleep '+sleep+'\nmeasure '+seconds+' '+label+'\n';
  // The only writable side effect outside the report is the session-local
  // native command file; commands cannot modify game state.
  try{publishCommand(session,id,data);}
  catch(error){session.capturing=false;throw error;}
  return new Promise((resolve,reject)=>{
    let offset=initial, tail='', measure=null, counters=null;
    let done=false;
    const started=Date.now();
    const timer=setInterval(()=>{
      try{
        if(done)return;
        if(Date.now()-started>timeoutMs)throw Error('Timed out waiting for LIVE_MEASURE. Check game focus and logs.');
        const size=fs.statSync(log).size;
        if(size<offset)throw Error('Game log was replaced while measuring.');
        const toRead=Math.min(size-offset,MAX_INCREMENT);
        if(toRead>0){
          const chunk=readNew(log,offset,offset+toRead);
          offset+=toRead;
          const lines=(tail+chunk).split(/\r?\n/);
          tail=lines.pop().slice(-4096);
          for(const line of lines){
            if(line.startsWith('LIVE_MEASURE id='+id+' '))measure=readMeasurement(line,id,label);
            if(line.startsWith('LIVE_COUNTERS id='+id+' '))counters=line;
            if(line.trim()==='LIVE_DONE id='+id){
              if(!measure)throw Error('Native completed but no valid LIVE_MEASURE was emitted.');
              const result={id,mode:session.mode,label,at:new Date().toISOString(),...measure,
                counters:counters||'',logPath:log};
              const report=path.join(session.folder,'results.jsonl');
              fs.appendFileSync(report,JSON.stringify(result)+'\n','utf8');
              session.results.push(result);
              done=true;clearInterval(timer);session.capturing=false;
              resolve(result);
              return;
            }
          }
        }
        // Drain completed output even if the process already exited.
        if(!session.running||session.logPath!==log)throw Error('Game session ended before completing a sample.');
      }catch(error){
        if(session.running){session.ready=false;session.probeFailed=true;}
        done=true;clearInterval(timer);session.capturing=false;reject(error);
      }
    },interval);
  });
}

function end(session) {
  if(session)session.running=false;
}

module.exports={create,bindLog,parseLogNotice,readMeasurement,publishCommand,probe,capture,end};
