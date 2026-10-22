'use strict';
const el=id=>document.getElementById(id);
let state={status:'idle',phase:'Not started',startedAt:null,shards:null,percent:null,lines:[],logFile:null};
function elapsed(start,end){
  if(!start)return 'Elapsed —';
  const seconds=Math.max(0,Math.floor((new Date(end||Date.now())-new Date(start))/1000));
  const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
  return 'Elapsed '+[h,m,s].map(x=>String(x).padStart(2,'0')).join(':');
}
function draw(){
  const active=['running','stopping'].includes(state.status);
  const statuses={idle:'NOT STARTED',running:'UPDATING',stopping:'STOP REQUESTED',
    completed:'COMPLETED','up-to-date':'ALREADY CURRENT',failed:'FAILED',stopped:'STOPPED',interrupted:'INTERRUPTED'};
  el('shader-state').textContent=statuses[state.status]||state.status.toUpperCase();
  el('shader-state').dataset.status=state.status;
  el('shader-phase').textContent=state.phase||'Checking shader cache';
  el('shader-elapsed').textContent=elapsed(state.startedAt,state.finishedAt);
  el('shader-shards').textContent=state.shards?
    state.shards.done+' done · '+state.shards.running+' running · '+state.shards.waiting+' waiting':
    'Waiting for shard plan';
  const bar=el('shader-bar');
  const pct=Number.isFinite(state.percent)?state.percent:null;
  bar.classList.toggle('indeterminate',active&&pct===null);
  bar.style.width=pct!==null?pct+'%':active?'28%':'0%';
  el('shader-percentage').textContent=active?(pct===null?
    'Planning / compiling — measuring progress…':
    pct+'% of estimated shard work (merge pending)'):
    state.status==='completed'||state.status==='up-to-date'?'Shader update finished':state.status==='failed'?
    'Update failed — inspect log':'';
  const output=el('shader-output');
  const atBottom=output.scrollTop+output.clientHeight>=output.scrollHeight-80;
  const next=(state.lines||[]).join('\n');
  if(output.textContent!==next){output.textContent=next||'No log output yet.';if(atBottom)output.scrollTop=output.scrollHeight;}
  el('shader-stop').disabled=state.status!=='running'||!!state.stopRequested;
  el('shader-open-log').disabled=!state.logFile;
  el('shader-result').textContent=state.status==='failed'?'See log for error details':
    state.status==='stopping'?'Finishing active shaders safely…':
    state.status==='stopped'?'Completed shards kept':'';
}
window.launcher.onShaderProgress(next=>{state=next;draw();});
window.launcher.shaderStatus().then(next=>{state=next;draw();})
 .catch(e=>{el('shader-phase').textContent=e.message;});
setInterval(()=>{if(state.startedAt)el('shader-elapsed').textContent=elapsed(state.startedAt,state.finishedAt);},1000);
el('shader-open-log').addEventListener('click',async()=>{try{await window.launcher.openShaderLog();}
  catch(e){el('shader-result').textContent=e.message;}});
el('shader-stop').addEventListener('click',async()=>{
 if(!confirm('Stop after running shards finish? Completed results will be merged; the update may take time to stop.'))return;
 try{state=await window.launcher.stopShaderUpdate();draw();}
 catch(e){el('shader-result').textContent=e.message;}
});
el('shader-close').addEventListener('click',()=>window.close());
