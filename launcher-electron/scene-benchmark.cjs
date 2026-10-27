'use strict';
// Opt-in G2 scene measurement. Does not start emulation, change gameplay input,
// mutate saves, touch shader caches, or invoke a GPU profiler.
const fs = require('node:fs');
const path = require('node:path');

const PREFIX='LIVE_MEASURE';
const MAX_INCREMENT=2*1024*1024;
const MAX_SECONDS=30;
const TRACE_SECONDS=2;
const TRACE_RECORD_BYTES=32;
const TRACE_MAX_RECORDS=1<<22;
const TRACE_MAX_BYTES=TRACE_MAX_RECORDS*TRACE_RECORD_BYTES;

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

// LIVE_CENSUS emits one header followed by per-key inclusive timings and LIVE_DONE.
// Preserve hexadecimal keys to let offline analysis decode Table XPR's synthetic phases.
function parseCensusHeader(line,id){
  const m=line.match(/^LIVE_CENSUS id=(\d+) frames=(\d+) base=([0-9a-fA-F]{1,16}) exe=(.+)$/);
  if(!m||m[1]!==String(id))return null;
  const frames=Number(m[2]);
  if(!Number.isSafeInteger(frames)||frames<1||!m[4].trim())return null;
  return {frames,base:m[3].toLowerCase(),exe:m[4].trim()};
}
function parseCensusEntry(line,id){
  const m=line.match(/^LIVE_CENSUS_ENTRY id=(\d+) kind=(\d+) a=([0-9a-fA-F]{16}) b=([0-9a-fA-F]{16}) calls_per_frame=(\d+(?:\.\d+)?) ms_per_frame=(\d+(?:\.\d+)?)$/);
  if(!m||m[1]!==String(id))return null;
  const kind=Number(m[2]),calls=Number(m[5]),ms=Number(m[6]);
  if(!Number.isInteger(kind)||kind<0||kind>13||!Number.isFinite(calls)||!Number.isFinite(ms)||
    calls<0||ms<0||calls>1e8||ms>1e5)return null;
  return {kind,a:m[3].toLowerCase(),b:m[4].toLowerCase(),calls_per_frame:calls,ms_per_frame:ms};
}

function parseGpuTraceLine(line,id){
  const m=line.match(/^LIVE_TRACE id=(\d+) records=(\d+) tsc_hz=(\d+(?:\.\d+)?) path=(.+)$/);
  if(!m||m[1]!==String(id))return null;
  const count=Number(m[2]),hz=Number(m[3]);
  if(!Number.isSafeInteger(count)||count<1||count>TRACE_MAX_RECORDS||
    !Number.isFinite(hz)||hz<1e6||hz>1e11||!m[4].trim())return null;
  return {count,hz,path:m[4]};
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
    startedAt:Date.now(),lastId:0,results:[],censusResults:[],gpuTraceResults:[],capturingKind:null
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
  if(!session||!session.logPath||!session.running||session.probing||session.capturing)return false;
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
  if(session.capturing||session.probing)throw Error('Another measurement or readiness handshake is running.');
  if(!session.ready||!session.logPath||!fs.existsSync(session.logPath))throw Error('Native live-control handshake is not ready yet.');
  if(seconds<1||seconds>MAX_SECONDS||sleep<0||sleep>10)throw Error('Unsupported benchmark duration.');
  if(session.mode!=='standard'&&session.mode!=='experimental')throw Error('Invalid session mode.');
  session.capturing=true;session.capturingKind='measure';
  session.number++;
  const label=session.mode==='experimental'?'trial'+session.number:'std'+session.number;
  const id=Math.max(Date.now(),session.lastId+1);
  session.lastId=id;
  const log=session.logPath;
  let initial;
  try{initial=fs.statSync(log).size;}
  catch(error){session.capturing=false;session.capturingKind=null;throw error;}
  const data='sleep '+sleep+'\nmeasure '+seconds+' '+label+'\n';
  // The only writable side effect outside the report is the session-local
  // native command file; commands cannot modify game state.
  try{publishCommand(session,id,data);}
  catch(error){session.capturing=false;session.capturingKind=null;throw error;}
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
              done=true;clearInterval(timer);session.capturing=false;session.capturingKind=null;
              resolve(result);
              return;
            }
          }
        }
        // Drain completed output even if the process already exited.
        if(!session.running||session.logPath!==log)throw Error('Game session ended before completing a sample.');
      }catch(error){
        if(session.running){session.ready=false;session.probeFailed=true;}
        done=true;clearInterval(timer);session.capturing=false;session.capturingKind=null;reject(error);
      }
    },interval);
  });
}

function census(session,{seconds=5,sleep=5,interval=400,timeoutMs=32000}={}){
  if(!session||!session.running)throw Error('Game is not active.');
  if(session.capturing||session.probing)throw Error('Another measurement or readiness handshake is running.');
  if(!session.ready||!session.logPath||!fs.existsSync(session.logPath))
    throw Error('Native live-control handshake is not ready yet.');
  if(seconds!==5||sleep<0||sleep>10)throw Error('Only bounded 5-second CPU census is supported.');
  session.capturing=true;session.capturingKind='census';
  const id=Math.max(Date.now(),session.lastId+1);
  session.lastId=id;
  const log=session.logPath;
  let initial;
  try{initial=fs.statSync(log).size;}
  catch(error){session.capturing=false;session.capturingKind=null;throw error;}
  try{publishCommand(session,id,'sleep '+sleep+'\ncensus '+seconds+'\n');}
  catch(error){session.capturing=false;session.capturingKind=null;throw error;}
  return new Promise((resolve,reject)=>{
    let offset=initial,tail='',header=null,entries=[],done=false;
    const keys=new Set();
    const started=Date.now();
    const timer=setInterval(()=>{
      try{
        if(done)return;
        if(Date.now()-started>timeoutMs)throw Error('CPU census timed out.');
        const size=fs.statSync(log).size;
        if(size<offset)throw Error('Game log changed while profiling.');
        const bytes=Math.min(size-offset,MAX_INCREMENT);
        if(bytes){
          const lines=(tail+readNew(log,offset,offset+bytes)).split(/\r?\n/);
          offset+=bytes;tail=lines.pop().slice(-4096);
          for(const line of lines){
            if(line.startsWith('LIVE_ERROR id='+id+' '))throw Error('Native CPU census reported an error.');
            if(line.startsWith('LIVE_CENSUS id='+id+' ')){
              if(header)throw Error('Duplicate CPU census header.');
              header=parseCensusHeader(line,id);
              if(!header)throw Error('Invalid CPU census header.');
            }
            if(line.startsWith('LIVE_CENSUS_ENTRY id='+id+' ')){
              if(!header||entries.length>=32768)throw Error('Invalid CPU census entry count.');
              const entry=parseCensusEntry(line,id);
              if(!entry)throw Error('Invalid CPU census entry.');
              const key=entry.kind+':'+entry.a+':'+entry.b;
              if(keys.has(key))throw Error('Duplicate CPU census key.');
              keys.add(key);
              entries.push(entry);
            }
            if(line.trim()==='LIVE_DONE id='+id){
              if(!header||header.frames<2||entries.length===0)throw Error('CPU census completed without usable instrumented frames.');
              const focusKeys=new Set(['000000000007ab20','000000000007ab21','000000000007ab22','000000000007ab23','000000000007ab24','000000000007ab25','000000000007ab26','000000000007ab27','000000000007ab28','000000000007ab29','000000000007ab2a','000000000007ab2b']);
              const report={schemaVersion:1,type:'census',id,mode:session.mode,label:session.mode==='experimental'?'trial-census':'std-census',
                durationSeconds:seconds,pairedMeasurementId:session.results.at(-1)?.id??null,
                at:new Date().toISOString(),
                frames:header.frames,base:header.base,exe:header.exe,entryCount:entries.length,
                logPath:log,topEntries:[...entries].sort((a,b)=>b.ms_per_frame-a.ms_per_frame).slice(0,12),
                focusEntries:entries.filter(x=>focusKeys.has(x.a)).sort((a,b)=>b.ms_per_frame-a.ms_per_frame)};
              // Raw entries are retained for accurate per-shader offline research.
              fs.writeFileSync(path.join(session.folder,'census-'+id+'.json'),
                JSON.stringify({...report,entries},null,2)+'\n','utf8');
              fs.appendFileSync(path.join(session.folder,'census-results.jsonl'),JSON.stringify(report)+'\n','utf8');
              session.censusResults.push(report);
              done=true;clearInterval(timer);session.capturing=false;session.capturingKind=null;
              resolve(report);return;
            }
          }
        }
        if(!session.running||session.logPath!==log)throw Error('Game session ended before CPU census completed.');
      }catch(error){
        if(session.running){session.ready=false;session.probeFailed=true;}
        done=true;clearInterval(timer);session.capturing=false;session.capturingKind=null;reject(error);
      }
    },interval);
  });
}

// G3-B opt-in native timeline capture. Native trace timestamps existing Vulkan
// command buffers and records ordered submit/readback/idle events. No new GPU
// fence, shader rebuild, screenshot, guest control or high-cost per-draw marks.
function gpuTimeline(session,{seconds=TRACE_SECONDS,sleep=5,interval=250,timeoutMs=35000}={}){
  if(!session||!session.running)throw Error('Game is not active.');
  if(session.capturing||session.probing)throw Error('Another measurement or readiness handshake is running.');
  if(!session.ready||!session.logPath||!fs.existsSync(session.logPath))
    throw Error('Native live-control handshake is not ready yet.');
  if(seconds!==TRACE_SECONDS||sleep<0||sleep>10)throw Error('Only a bounded two-second plain GPU timeline is supported.');
  session.capturing=true;session.capturingKind='gpu-timeline';
  const id=Math.max(Date.now(),session.lastId+1);
  session.lastId=id;
  const trace=path.join(session.folder,'gpu-trace-'+id+'.bin');
  const log=session.logPath;
  let initial;
  try{
    // Native LIVE command parsing is whitespace-delimited with 255-byte paths.
    if(/[\s\r\n]/.test(trace)||trace.length>240)throw Error('Trace path must have no spaces and fit the native path limit.');
    if(fs.existsSync(trace))throw Error('Timeline capture path already exists.');
    initial=fs.statSync(log).size;
    publishCommand(session,id,'sleep '+sleep+'\ntrace '+seconds+' '+trace+'\n');
  }catch(error){session.capturing=false;session.capturingKind=null;throw error;}
  return new Promise((resolve,reject)=>{
    let offset=initial,tail='',header=null,done=false;
    const started=Date.now();
    const timer=setInterval(()=>{
      try{
        if(done)return;
        if(Date.now()-started>timeoutMs)throw Error('GPU timeline timed out.');
        const size=fs.statSync(log).size;
        if(size<offset)throw Error('Game log changed during GPU timeline.');
        const bytes=Math.min(size-offset,MAX_INCREMENT);
        if(bytes){
          const lines=(tail+readNew(log,offset,offset+bytes)).split(/\r?\n/);
          offset+=bytes;tail=lines.pop().slice(-4096);
          for(const line of lines){
            if(line.startsWith('LIVE_ERROR id='+id+' '))throw Error('Native GPU timeline reported an error.');
            if(line.startsWith('LIVE_TRACE id='+id+' ')){
              if(header)throw Error('Duplicate GPU timeline header.');
              header=parseGpuTraceLine(line,id);
              if(!header)throw Error('Invalid GPU timeline header.');
            }
            if(line.trim()==='LIVE_DONE id='+id){
              if(!header)throw Error('Native completed without a GPU timeline result.');
              if(path.normalize(header.path).toLowerCase()!==path.normalize(trace).toLowerCase())
                throw Error('GPU trace file path does not match the active session.');
              const info=fs.statSync(trace);
              if(!info.isFile()||info.size<TRACE_RECORD_BYTES||info.size>TRACE_MAX_BYTES||
                info.size%TRACE_RECORD_BYTES!==0||info.size/TRACE_RECORD_BYTES!==header.count)
                throw Error('GPU trace binary size/count mismatch.');
              const report={schemaVersion:1,type:'gpu-timeline',id,at:new Date().toISOString(),mode:session.mode,
                durationSeconds:seconds,records:header.count,tscHz:header.hz,tracePath:trace,logPath:log,
                pairedMeasurementId:session.results.at(-1)?.id??null};
              // The native .hz companion is required for correct offline TSC
              // conversion by tools/local/live-trace.py; do not guess CPU Hz.
              fs.writeFileSync(trace+'.hz',String(header.hz)+'\n','utf8');
              fs.appendFileSync(path.join(session.folder,'gpu-timeline-results.jsonl'),JSON.stringify(report)+'\n','utf8');
              session.gpuTraceResults.push(report);
              done=true;clearInterval(timer);session.capturing=false;session.capturingKind=null;
              resolve(report);return;
            }
          }
        }
        if(!session.running||session.logPath!==log)throw Error('Game session ended before GPU trace completed.');
      }catch(error){
        if(session.running){session.ready=false;session.probeFailed=true;}
        done=true;clearInterval(timer);session.capturing=false;session.capturingKind=null;reject(error);
      }
    },interval);
  });
}

function end(session) {
  if(session)session.running=false;
}

module.exports={create,bindLog,parseLogNotice,readMeasurement,parseCensusHeader,parseCensusEntry,parseGpuTraceLine,publishCommand,probe,capture,census,gpuTimeline,end};
