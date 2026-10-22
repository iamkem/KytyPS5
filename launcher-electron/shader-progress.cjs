'use strict';
// Runs one shader update at a time, streams meaningful progress and keeps a per-run log.
// The GUI never mutates shader binary files; PowerShell owns the incremental merge.
const {spawn} = require('node:child_process');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function parseLine(state, raw){
  const line=String(raw).replace(/\x1b\[[\d;]*m/g,'').trim();
  if(!line)return state;
  state.lines.push(line);
  if(state.lines.length>170)state.lines.splice(0,state.lines.length-170);
  const progress=line.match(/shards:\s*(\d+)\s+done,\s*(\d+)\s+running,\s*(\d+)\s+waiting/i);
  if(progress){
    const done=Number(progress[1]),running=Number(progress[2]),waiting=Number(progress[3]);
    state.shards={done,running,waiting,total:done+running+waiting};
    state.phase='Compiling missing pipelines';
    state.percent=state.shards.total>0?Math.min(95,Math.floor(95*done/state.shards.total)):null;
  } else if(/cache:\s+VALID|nothing to precompile/i.test(line)){
    state.phase='Already up to date';state.percent=100;
  } else if(/cache:\s+REUSABLE/i.test(line))state.phase='Existing cache reusable — checking missing pipelines';
  else if(/listing the game's shaders|make-seeds/i.test(line))state.phase='Analyzing game shader seeds';
  else if(/stage:\s*planning/i.test(line))state.phase='Planning missing shader work';
  else if(/stage:\s*merging|ready to play|merge-recorded/i.test(line))state.phase='Merging completed shader shards';
  else if(/stage:\s*refreshing inputs|wrote _PipelineCache.*\.shaders/i.test(line))state.phase='Refreshing shader inputs';
  else if(/update:\s*stop requested/i.test(line))state.phase='Stopping safely — finishing running shards';
  else if(/update:\s*stopped/i.test(line))state.phase='Stopped — completed shards merged';
  else if(/^done in\s/i.test(line))state.phase='Finalizing cache';
  else if(/\b(precompile failed|failed; logs:|cannot keep its pipelines)\b/i.test(line))state.phase='Update failed — inspect log';
  return state;
}
function stateCopy(s){return {...s,shards:s.shards?{...s.shards}:null,lines:[...s.lines]};}
class ShaderProgress extends EventEmitter{
  constructor(root){
    super();this.root=root;this.child=null;this.stopFile=null;
    this.logDir=path.join(root,'_Build','run-logs','launcher-shader-updates');
    this.state={status:'idle',phase:'Not started',percent:null,shards:null,startedAt:null,finishedAt:null,
      pid:null,stopRequested:false,exitCode:null,logFile:null,lines:[]};
    const stateFile=path.join(this.logDir,'last-state.json');
    if(fs.existsSync(stateFile)){
      try{
        const saved=JSON.parse(fs.readFileSync(stateFile,'utf8'));
        if(saved && ['completed','failed','stopped','up-to-date','interrupted'].includes(saved.status)){
          this.state={...this.state,...saved,lines:Array.isArray(saved.lines)?saved.lines.slice(-170):[]};
        }else if(saved && saved.startedAt){
          this.state={...this.state,...saved,status:'interrupted',
            phase:'Previous launcher session ended; inspect the log to confirm the update',lines:(saved.lines||[]).slice(-170)};
        }
      }catch{}
    }
  }
  snapshot(){return stateCopy(this.state);}
  persist(){
    fs.mkdirSync(this.logDir,{recursive:true});
    const tmp=path.join(this.logDir,'last-state.tmp');
    fs.writeFileSync(tmp,JSON.stringify(this.snapshot(),null,2));
    fs.renameSync(tmp,path.join(this.logDir,'last-state.json'));
  }
  emitUpdate(){this.emit('update',this.snapshot());}
  run(spec){
    if(this.state.status==='running'||this.state.status==='stopping')
      throw Error('A shader update is already running. Watch its progress in Shader Cache.');
    if(!spec || typeof spec.command!=='string'||!Array.isArray(spec.args))
      throw Error('Invalid shader update command');
    fs.mkdirSync(this.logDir,{recursive:true});
    const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex');
    const logFile=path.join(this.logDir,'shader-update-'+id+'.log');
    const stopFile=path.join(this.logDir,'shader-update-'+id+'.stop');
    const runSpec={...spec,args:[...spec.args,'-StopSignal',stopFile]};
    const child=spawn(runSpec.command,runSpec.args,{cwd:this.root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    this.child=child;this.stopFile=stopFile;
    this.state={status:'running',phase:'Starting shader update',percent:null,shards:null,
      startedAt:new Date().toISOString(),finishedAt:null,pid:child.pid||null,stopRequested:false,
      exitCode:null,logFile,lines:[]};
    const file=fs.createWriteStream(logFile,{flags:'a'});
    const buffers={stdout:'',stderr:''};
    let changed=0;
    const consume=(channel,data)=>{
      let chunk=buffers[channel]+data.toString('utf8');
      const parts=chunk.split(/\r\n|\r|\n/);
      buffers[channel]=parts.pop().slice(-12000);
      for(const text of parts){
        file.write('['+channel+'] '+text+'\n');
        parseLine(this.state,text);
        changed++;
        if(changed%12===0)this.persist();
      }
      this.emitUpdate();
    };
    child.stdout.on('data',b=>consume('stdout',b));
    child.stderr.on('data',b=>consume('stderr',b));
    let final=false;
    const finish=(code,signal,error)=>{
      if(final)return;final=true;
      for(const [channel,value] of Object.entries(buffers)){
        if(value){file.write('['+channel+'] '+value+'\n');parseLine(this.state,value);}
      }
      if(error){file.write('[error] '+error.message+'\n');parseLine(this.state,error.message);}
      file.end();
      this.state.exitCode=code;
      this.state.finishedAt=new Date().toISOString();
      if(this.state.stopRequested && code===130)this.state.status='stopped';
      else if(code===0)this.state.status=this.state.phase==='Already up to date'?'up-to-date':'completed';
      else this.state.status='failed';
      if(error)this.state.phase='Cannot start shader update: '+error.message;
      else if(this.state.status==='completed'){this.state.phase='Completed — shader cache updated';this.state.percent=100;}
      else if(this.state.status==='stopped')this.state.phase='Stopped safely — existing cache retained';
      else if(this.state.status==='failed')this.state.phase='Failed — see log for details (exit code '+code+')';
      this.child=null;this.stopFile=null;
      try{if(fs.existsSync(stopFile))fs.unlinkSync(stopFile);}catch{}
      this.persist();this.emitUpdate();
    };
    child.on('error',err=>finish(null,null,err));
    child.on('close',(code,signal)=>finish(code,signal));
    this.persist();this.emitUpdate();
    return this.snapshot();
  }
  stop(){
    if(this.state.status!=='running')throw Error('No update is currently running.');
    if(this.state.stopRequested)return this.snapshot();
    if(!this.stopFile)throw Error('Update has no safe stop signal; do not terminate it during merge.');
    fs.writeFileSync(this.stopFile,'stop after active shards\n',{flag:'wx'});
    this.state.status='stopping';this.state.stopRequested=true;
    this.state.phase='Stop requested — waiting for running shards to finish and merge';
    this.persist();this.emitUpdate();return this.snapshot();
  }
}
module.exports={ShaderProgress,parseLine};
