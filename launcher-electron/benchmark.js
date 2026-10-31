'use strict';
const $=id=>document.getElementById(id);
let current=null,measuring=false;
const kindNames=['Dispatch','Draw','Native XPR','Dispatch phase','GPU wait','Readback wait','Sync download','Graphics programs','Native gather','PM4 QueueRun','SRT interpreter','Command sync','Draw phase','Barrier'];
function censusName(e){
 if(e.kind!==12)return kindNames[e.kind]||'Kind '+e.kind;
 const phase=parseInt(e.b.slice(-2),16);
 const detailed={
  '000000000007ab25':{1:'G2-E setup / mapping epoch',2:'G2-E locate + page checks + prefetch',3:'G2-E dependent NativeXprReader reads',4:'G2-E descriptor / LOD words',5:'G2-E indirect image enumeration'},
  '000000000007ab26':{1:'G2-E packed path (count only)',2:'G2-E fallback operand path (count only)'},
  '000000000007ab20':{1:'TableEvaluate',2:'TableGather'},
  '000000000007ab21':{1:'TablePrepareBda (global)',2:'TableBlocks inclusive',3:'Dispatch indirect args'},
  '000000000007ab22':{1:'CPU-dirty ring candidate',2:'Fallback ObtainBuffer'},
  '000000000007ab23':{1:'TableTry attempt',2:'TableContinue attempt'}
 };
 if(detailed[e.a])return (detailed[e.a][phase]||'G2-C phase '+phase)+(e.b.startsWith('8')?' (async)':'');
 const suffix=e.a==='000000000007ab1e'?'Table draw':e.a==='000000000007ab1f'?'Table dispatch':'Draw phase';
 const phases={0:'inclusive',1:'evaluate + gather',2:'set',3:'BDA / blocks',4:'emission',5:'buffer resolve',6:'range reproof',7:'set validation',9:'arguments + indices',10:'argument miss',11:'index miss'};
 return suffix+' · '+(phases[phase]||'phase '+phase);
}
function metric(v,digits=2){return Number.isFinite(v)?v.toFixed(digits):'—';}
function draw(s){
 current=s;
 const mode=s.mode==='experimental'?'Experimental (0x3)':s.mode==='standard'?'Standard (0x0)':'Not active';
 $('bench-mode').textContent=mode;
 $('bench-folder').textContent=s.folder||'—';
 $('bench-measure').textContent=s.probeFailed&&!s.ready?'Retry connection':'Measure FPS (15s)';
 $('bench-measure').disabled=measuring||s.capturing||(!s.ready&&!s.probeFailed)||!s.active;
 $('bench-census').disabled=measuring||s.capturing||!s.ready||!s.active;
 $('bench-gpu-timeline').disabled=measuring||s.capturing||!s.ready||!s.active;
 $('bench-close').textContent=s.active?'Minimize panel':'Close panel';
 $('bench-state').textContent=!s.active?'Game session has ended. Start a new benchmark-enabled Play for another sample.':
   measuring?'Measuring… switch focus to the game now.':
   s.probeFailed?'Live-control is not responding yet. Click Retry connection when gameplay is ready.':
   !s.ready?'Waiting for the matching game log and native readiness handshake…':
   'Ready. Move to your benchmark scene, then click Measure.';
 const lastTrace=s.gpuTraceResults?.at(-1);
 const gpuBox=$('bench-gpu-result');
 gpuBox.replaceChildren();
 if(lastTrace){
  const p=document.createElement('p');
  p.textContent='Captured '+lastTrace.records.toLocaleString()+' timeline events over '+lastTrace.durationSeconds+' seconds (native GPU/CPU scheduling trace).';
  const loc=document.createElement('p');loc.className='benchmark-census-note';
  loc.textContent='Raw trace: '+lastTrace.tracePath+' (plus .hz). Use tools/local/live-trace.py frames / gpu for offline diagnosis. No FPS gain implied.';
  gpuBox.append(p,loc);
 }else gpuBox.textContent='No GPU timeline for this session.';
 const lastCensus=s.censusResults?.at(-1);
 const censusBox=$('bench-census-result');
 censusBox.replaceChildren();
 if(lastCensus){
  const heading=document.createElement('div');
  heading.textContent=lastCensus.entryCount+' timed scopes · '+lastCensus.frames+' game frames';
  censusBox.append(heading);
  const list=document.createElement('ol');list.className='benchmark-census-list';
  for(const entry of lastCensus.topEntries.slice(0,8)){
   const item=document.createElement('li');
   item.textContent=censusName(entry)+' · '+metric(entry.ms_per_frame,3)+' ms/frame · '+metric(entry.calls_per_frame,1)+' calls/frame';
   list.append(item);
  }
  censusBox.append(list);
  if(lastCensus.focusEntries?.length){
   const head=document.createElement('strong');
   head.textContent='G2-C breakdown (nested; do not add to parent)';
   censusBox.append(head);
   const focus=document.createElement('ol');focus.className='benchmark-census-list';
   for(const entry of lastCensus.focusEntries.slice(0,12)){
    const li=document.createElement('li');
    li.textContent=censusName(entry)+' · '+metric(entry.ms_per_frame,3)+' ms/frame';
    focus.append(li);
   }
   censusBox.append(focus);
  }
  const evaluate=lastCensus.focusEntries?.filter(e=>e.kind===12&&
    (e.a==='000000000007ab25'||e.a==='000000000007ab26'))||[];
  if(evaluate.length){
   const head=document.createElement('strong');head.textContent='G2-E TableEvaluate subphases';
   censusBox.append(head);
   const list=document.createElement('ol');list.className='benchmark-census-list';
   for(const entry of evaluate.sort((a,b)=>a.b.localeCompare(b.b)).slice(0,14)){
    const li=document.createElement('li');
    li.textContent=censusName(entry)+' · '+metric(entry.ms_per_frame,3)+' ms/frame · '+
      metric(entry.calls_per_frame,1)+' calls/frame';
    list.append(li);
   }
   censusBox.append(list);
  }
  const note=document.createElement('p');note.className='benchmark-census-note';
  note.textContent='Inclusive CPU wall timings; nested scopes overlap. See census-*.json for all shader/phase keys.';
  censusBox.append(note);
 }else censusBox.textContent='No CPU census for this session.';
 const last=s.results?.at(-1);
 if(!last){$('bench-result').replaceChildren();$('bench-result').textContent='No FPS samples yet for this session.';return;}
 $('bench-result').replaceChildren();
 const grid=document.createElement('div');grid.className='benchmark-grid';
 for(const [label,value] of [
  ['Average FPS',metric(last.fps)],['1% Low FPS',metric(last.low1)],
  ['P99 frametime',metric(last.p99_ms)+' ms'],['Render CPU',metric(last.render_ms)+' ms/frame'],
  ['Record CPU',metric(last.record_ms)+' ms/frame'],['Render busy',metric(last.render_busy,1)+'%'],
  ['Frames',String(last.frames)],['Frames ≥50 ms',String(last.over50)]
 ]){
  const tile=document.createElement('div');tile.className='benchmark-metric';
  const name=document.createElement('small');name.textContent=label;
  const data=document.createElement('strong');data.textContent=value;
  tile.append(name,data);grid.append(tile);
 }
 $('bench-result').append(grid);
 const foot=document.createElement('p');
 foot.textContent='Sample '+s.results.length+' · '+last.label+
  '. Render/Record are CPU time, not GPU execution time.';
 $('bench-result').append(foot);
}
window.launcher.onBenchmarkStatus(draw);
window.launcher.benchmarkStatus().then(draw).catch(e=>$('bench-state').textContent=e.message);
async function startMeasurement(kind){
 if(measuring)return;
 measuring=true;
 $('bench-measure').disabled=true;$('bench-census').disabled=true;$('bench-gpu-timeline').disabled=true;
 $('bench-state').textContent=kind==='census'?'CPU phase profiling starts in 5 seconds; return to the game for 5 seconds.':kind==='gpu'?'GPU timeline starts in 5 seconds; return to the game for 2 seconds. This is not an FPS benchmark.':'FPS measurement starts in 5 seconds; return to the game for 15 seconds.';
 let errorMessage='';
 try{
  if(current?.probeFailed&&!current?.ready){
    await window.launcher.benchmarkProbe();
  }else{
    if(kind==='gpu')await window.launcher.benchmarkGpuTimeline();
    else if(kind==='census')await window.launcher.benchmarkCensus();
    else await window.launcher.benchmarkCapture();
  }
 }catch(error){errorMessage=error.message;}
 finally{
  measuring=false;
  try{draw(await window.launcher.benchmarkStatus());}
  catch(error){errorMessage=error.message;}
  if(errorMessage)$('bench-state').textContent=errorMessage;
 }
}
$('bench-measure').addEventListener('click',()=>startMeasurement('fps'));
$('bench-census').addEventListener('click',()=>startMeasurement('census'));
$('bench-gpu-timeline').addEventListener('click',()=>startMeasurement('gpu'));
$('bench-close').addEventListener('click',()=>window.close());
