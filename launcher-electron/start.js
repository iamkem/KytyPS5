'use strict';
const status=document.getElementById('game-status');
window.launcher.load().then(data=>{
  status.textContent=data.valid ? 'Ready to play' : 'Game files not found — open Options';
}).catch(err=>status.textContent=err.message);
document.getElementById('options').addEventListener('click',()=>window.launcher.openOptions());
document.getElementById('quit').addEventListener('click',()=>window.launcher.quit());
window.launcher.onGameExit(()=>{document.getElementById('play').disabled=false;status.textContent='Ready to play';});
document.getElementById('play').addEventListener('click',async()=>{
  const btn=document.getElementById('play');
  btn.disabled=true; status.textContent='Starting game…';
  try{const {settings}=await window.launcher.load();await window.launcher.play(settings);}
  catch(e){status.textContent=e.message;btn.disabled=false;}
});
