'use strict';
const status=document.getElementById('game-status');
const modeLabel=settings=>settings?.shader_mode==='experimental'?'Experimental 0x3 selected':'Ready to play · Standard 0x0';
window.launcher.load().then(data=>{status.textContent=data.valid?modeLabel(data.settings):'Game files not found — open Options';}).catch(err=>status.textContent=err.message);
window.launcher.onSettingsChanged(settings=>{if(!document.getElementById('play').disabled)status.textContent=modeLabel(settings);});
document.getElementById('options').addEventListener('click',()=>window.launcher.openOptions());
document.getElementById('quit').addEventListener('click',()=>window.launcher.quit());
window.launcher.onGameExit(result=>{document.getElementById('play').disabled=false;if(result?.exitCode!=null&&result.exitCode!==0){status.textContent=result.shaderMode==='experimental'?'Experimental launch failed (exit '+result.exitCode+'). Restore Standard in Options.':'Game ended with exit code '+result.exitCode;}else{window.launcher.load().then(d=>status.textContent=modeLabel(d.settings)).catch(()=>status.textContent='Ready to play');}});
document.getElementById('play').addEventListener('click',async()=>{
  const btn=document.getElementById('play');
  btn.disabled=true; status.textContent='Starting game…';
  try{const {settings}=await window.launcher.load();const started=await window.launcher.play(settings);if(!started){status.textContent='Launch cancelled — settings unchanged';btn.disabled=false;}}
  catch(e){status.textContent=e.message;btn.disabled=false;}
});
