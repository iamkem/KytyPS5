'use strict';
const $=id=>document.getElementById(id);
let current=null,measuring=false;
function metric(v,digits=2){return Number.isFinite(v)?v.toFixed(digits):'—';}
function draw(s){
 current=s;
 const mode=s.mode==='experimental'?'Experimental (0x3)':s.mode==='standard'?'Standard (0x0)':'Not active';
 $('bench-mode').textContent=mode;
 $('bench-folder').textContent=s.folder||'—';
 $('bench-measure').textContent=s.probeFailed&&!s.ready?'Retry connection':'Measure 15 seconds';
 $('bench-measure').disabled=measuring||(!s.ready&&!s.probeFailed)||!s.active;
 $('bench-close').textContent=s.active?'Minimize panel':'Close panel';
 $('bench-state').textContent=!s.active?'Game session has ended. Start a new benchmark-enabled Play for another sample.':
   measuring?'Measuring… switch focus to the game now.':
   s.probeFailed?'Live-control is not responding yet. Click Retry connection when gameplay is ready.':
   !s.ready?'Waiting for the matching game log and native readiness handshake…':
   'Ready. Move to your benchmark scene, then click Measure.';
 const last=s.results?.at(-1);
 if(!last){$('bench-result').replaceChildren();$('bench-result').textContent='No samples yet for this session.';return;}
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
$('bench-measure').addEventListener('click',async()=>{
 if(measuring)return;
 measuring=true;
 $('bench-measure').disabled=true;
 $('bench-state').textContent='Starting in 5 seconds — return focus to the game. Keep camera still for 15 seconds.';
 let errorMessage='';
 try{
  if(current?.probeFailed&&!current?.ready){
    await window.launcher.benchmarkProbe();
  }else{
    await window.launcher.benchmarkCapture();
  }
 }catch(error){errorMessage=error.message;}
 finally{
  measuring=false;
  try{draw(await window.launcher.benchmarkStatus());}
  catch(error){errorMessage=error.message;}
  if(errorMessage)$('bench-state').textContent=errorMessage;
 }
});
$('bench-close').addEventListener('click',()=>window.close());
