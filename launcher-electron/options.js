'use strict';
let state,runtime,syncing=false,cacheItems=[],inputItems=[];
const $=id=>document.getElementById(id);
const presets={
 'Ultra Performance':{render_dlss:900,quality:'lowest',framegen:0,fsr:false,output:'4k',upscaler:'dlss'},
 Performance:{render_dlss:1080,quality:'lowest',framegen:0,fsr:false,output:'4k',upscaler:'dlss'},
 Balanced:{render_dlss:1152,quality:'low',framegen:0,fsr:false,output:'4k',upscaler:'dlss'},
 Quality:{render_dlss:1440,quality:'standard',framegen:0,fsr:false,output:'4k',upscaler:'dlss'}
};
const languages=['Japanese','English (United States)','French (France)','Spanish (Spain)','German','Italian','Dutch','Portuguese (Portugal)','Russian','Korean','Chinese (Traditional)','Chinese (Simplified)','Finnish','Swedish','Danish','Norwegian','Polish','Portuguese (Brazil)','English (United Kingdom)','Turkish','Spanish (Latin America)','Arabic','French (Canada)','Czech','Hungarian','Greek','Romanian','Thai','Vietnamese','Indonesian'];
const sizes={'16:9':['1280x720','1920x1080','2560x1440','3840x2160'],
 '21:9':['2560x1080','3440x1440','3840x1600','5120x2160'],
 '32:9':['3840x1080','5120x1440','7680x2160']};
const boolKeys={'vsync':'vsync','fps120':'fps120','lowlatency':'lowlatency',
 'fsr':'fsr','ram-diet':'ram_diet','ram16':'ram16_backing','redzone':'redzone','safegpu':'safegpu'};
const numberKeys={'framegen':'framegen','hud':'hud','vram':'vram_budget_mb','language':'language'};
const plainKeys={'ratio':'ratio','resolution':'resolution','upscaler':'upscaler','output':'output','quality':'quality'};
function set(id,value){const el=$(id);if(el.type==='checkbox')el.checked=Boolean(value);else el.value=String(value);}
function showMessage(t){$('message').textContent=t;}
function activePreset(s=state){return Object.entries(presets).find(([,p])=>Object.keys(p).every(k=>s[k]===p[k]))?.[0]||'Custom';}
function optionsOf(select,arr,wanted){
 select.replaceChildren();
 for(const val of arr){const option=document.createElement('option');option.value=val;option.textContent=val;select.append(option);}
 select.value=arr.includes(wanted)?wanted:arr[0];
}
function fill(){
 syncing=true;
 try{
  const s=state;
  set('window-mode',s.fullscreen?'fullscreen':'windowed');set('ratio',s.ratio);
  optionsOf($('resolution'),sizes[s.ratio]||sizes['16:9'],s.resolution);
  for(const [id,key] of Object.entries(boolKeys))set(id,s[key]);
  for(const [id,key] of Object.entries(numberKeys))set(id,s[key]);
  for(const [id,key] of Object.entries(plainKeys))set(id,s[key]);
  set('hdr',s.hdr);set('cheats',s.cheats);
  set('render-height',s.upscaler==='dlss'?s.render_dlss:s.render);
  set('game-path',s.game);set('sdk-path',s.streamline);
  set('discord-presence',s.discord_presence);set('discord-app-id',s.discord_app_id);set('discord-image',s.discord_large_image);
  discordHint();
  set('preset',activePreset(s));
  $('preset-summary').textContent=activePreset(s)+' · '+(s.upscaler==='dlss'?'DLSS':'Game TAA')+' '+(s.upscaler==='dlss'?s.render_dlss:s.render)+'p · '+(s.quality==='standard'?'Standard (PS5)':s.quality);
  $('output').disabled=s.upscaler==='dlss';
 }finally{syncing=false;}
}
function discordHint(){
 const hint=$('discord-config-hint');
 const enabled=$('discord-presence').checked;
 const id=$('discord-app-id').value.trim();
 const img=$('discord-image').value.trim();
 if(!enabled)hint.textContent='Disabled. The game will run normally without Discord Presence.';
 else if(!/^\d{17,20}$/.test(id))hint.textContent='Enter the Application ID from Discord Developer Portal (17–20 digits).';
 else if(img&&!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(img))hint.textContent='Image asset key can contain letters, digits, underscores and hyphens only.';
 else hint.textContent='Ready. Presence will appear when the game launches and Discord desktop is running.';
}
function update(id){
 if(syncing)return;
 const val=$(id).value;
 if(id in boolKeys)state[boolKeys[id]]=val==='true';
 else if(id in numberKeys)state[numberKeys[id]]=Number(val);
 else if(id in plainKeys)state[plainKeys[id]]=val;
 else if(id==='render-height')state[state.upscaler==='dlss'?'render_dlss':'render']=Number(val);
 else if(id==='window-mode')state.fullscreen=val==='fullscreen';
 else if(id==='hdr')state.hdr=$('hdr').checked;
 else if(id==='cheats')state.cheats=$('cheats').checked;
 if(id==='ratio'&&!sizes[val].includes(state.resolution))state.resolution=sizes[val][0];
 fill();
}
for(const id of [...Object.keys(boolKeys),...Object.keys(numberKeys),...Object.keys(plainKeys),'render-height','window-mode','hdr','cheats']){
 $(id).addEventListener('change',()=>update(id));
}
$('preset').addEventListener('change',async()=>{
 if(syncing||$('preset').value==='Custom')return;
 const name=$('preset').value;
 if(!runtime.sdk){showMessage('Choose a Streamline SDK folder before using DLSS presets.');fill();return;}
 Object.assign(state,presets[name]);
 fill();
 try{state=await window.launcher.save(state);showMessage(name+' applied');}
 catch(e){showMessage(e.message);}
});
document.querySelectorAll('.tab-strip button').forEach(button=>button.addEventListener('click',()=>{
 for(const tab of document.querySelectorAll('.tab-strip button')){
  const active=tab===button;tab.classList.toggle('current',active);tab.setAttribute('aria-selected',String(active));
 }
 for(const panel of document.querySelectorAll('.tab-panel'))panel.classList.toggle('active',panel.id==='tab-'+button.dataset.tab);
 if(button.dataset.tab==='cache')refreshCache();
}));
$('browse-game').addEventListener('click',async()=>{const p=await window.launcher.chooseGame();if(p){state.game=p;fill();}});
$('browse-sdk').addEventListener('click',async()=>{const p=await window.launcher.chooseStreamline();if(p){state.streamline=p;fill();showMessage('Runtime folder selected');}});
$('shader-update').addEventListener('click',async()=>{
 try{await window.launcher.save(state);const next=await window.launcher.shaderUpdate();shaderSummary(next);showMessage('Shader progress window opened');}catch(e){showMessage(e.message);}
});
$('export-hints').addEventListener('click',async()=>{
 try{await window.launcher.save(state);await window.launcher.exportHints();showMessage('Diagnostics export started');}catch(e){showMessage(e.message);}
});
$('shader-view-progress').addEventListener('click',()=>window.launcher.showShaderProgress());
$('cache-update-view').addEventListener('click',()=>window.launcher.showShaderProgress());
function shaderSummary(s){
 if(!s)return;
 const running=['running','stopping'].includes(s.status);
 const count=s.shards?(s.shards.done+'/'+s.shards.total+' shards done'):'';
 $('cache-update-status').textContent='Shader update: '+(s.phase||s.status)+(count?' · '+count:'');
 $('shader-update').disabled=running;
}
window.launcher.onShaderProgress(shaderSummary);
window.launcher.shaderStatus().then(shaderSummary).catch(()=>{});
$('logs').addEventListener('click',()=>window.launcher.openLogs());
$('discord-dev-portal').addEventListener('click',()=>window.launcher.openDiscordDevelopers());
$('discord-presence').addEventListener('change',()=>{
 state.discord_presence=$('discord-presence').checked;discordHint();
});
for(const [id,key] of [['discord-app-id','discord_app_id'],['discord-image','discord_large_image']]){
 $(id).addEventListener('input',()=>{state[key]=$(id).value.trim();discordHint();});
}
function discordValidated(){
 if(!state.discord_presence)return true;
 if(!/^\d{17,20}$/.test(state.discord_app_id)){
  showMessage('Discord: set a valid 17–20 digit Application ID first.');
  document.querySelector('[data-tab=discord]').click();return false;
 }
 if(state.discord_large_image&&!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(state.discord_large_image)){
  showMessage('Discord: invalid image asset key.');
  document.querySelector('[data-tab=discord]').click();return false;
 }
 return true;
}
$('reset').addEventListener('click',()=>{Object.assign(state,presets.Performance);fill();showMessage('1080p Performance selected — press OK');});
$('cancel').addEventListener('click',()=>window.launcher.closeOptions(false));
$('ok').addEventListener('click',async()=>{if(!discordValidated())return;try{await window.launcher.save(state);await window.launcher.closeOptions(true);}catch(e){showMessage(e.message);}});
const friendlyBytes=b=>b>=1024**3?(b/1024**3).toFixed(2)+' GiB':(b/1024**2).toFixed(0)+' MiB';
function cacheSelection(){
 const selected=[...document.querySelectorAll('.cache-check:checked')].map(el=>el.dataset.id);
 $('cache-selected').textContent=selected.length?selected.length+' cache group(s) selected':'No cache selected';
 $('cache-delete').disabled=!selected.length;
 return selected;
}
function renderCache(){
 const list=$('cache-list');list.replaceChildren();
 if(!cacheItems.length){const p=document.createElement('p');p.textContent='No compiled shader caches found.';list.append(p);return;}
 const sections=[
  {title:'IN USE · LOCKED',category:'active'},
  {title:'SAVED VERSIONS · CAN BE USED',category:'generation'},
  {title:'OLDER CACHE · FINISHED OR INTERRUPTED',category:'history'},
  {title:'PERFORMANCE / WORKING CACHE · KEEP',category:'aux'}
 ];
 for(const section of sections){
  const items=cacheItems.filter(item=>section.category==='history'?
    ['archive','incompatible'].includes(item.category):item.category===section.category);
  if(!items.length&&section.category!=='generation')continue;
  const header=document.createElement('div');header.className='cache-group-heading';
  header.textContent=section.title;list.append(header);
  if(!items.length){
   const empty=document.createElement('p');empty.className='cache-empty';
   empty.textContent='No saved versions yet. Use “Save Current Version” to create one before updating shaders.';
   list.append(empty);continue;
  }
  for(const item of items){
   const row=document.createElement('div');
   row.className='cache-entry '+(item.locked?'cache-locked':'')+' cache-'+item.cleanupLevel;
   const text=document.createElement('div');text.className='cache-entry-text';
   const heading=document.createElement('strong');heading.textContent=item.title;
   const detail=document.createElement('span');
   let kind=item.category==='active'?'ACTIVE · PROTECTED':
     item.category==='generation'?(item.version==='newer'?'NEWER SAVED VERSION':item.version==='older'?'OLDER SAVED VERSION':'SAVED COMPLETE VERSION'):
     item.category==='archive'?'OLD · INCOMPLETE SHARDS':
     item.category==='incompatible'?'OLD · GPU/DRIVER INCOMPATIBLE':'WORKING / RECORDED DATA';
   detail.textContent=kind+' · '+friendlyBytes(item.bytes)+' · '+item.count+' file(s) · '+new Date(item.newest).toLocaleString();
   const badge=document.createElement('span');
   badge.className='cache-policy cache-policy-'+item.cleanupLevel;
   badge.textContent=item.cleanupLabel;
   const titleLine=document.createElement('div');titleLine.className='cache-title-line';
   titleLine.append(heading,badge);
   const note=document.createElement('small');note.textContent=item.cleanupReason;
   text.append(titleLine,detail,note);
   if(item.deletable){
    const box=document.createElement('input');box.type='checkbox';box.className='cache-check';
    box.dataset.id=item.id;box.title=item.cleanupReason+' Select for removal to Recycle Bin.';
    box.addEventListener('change',cacheSelection);
    row.append(box);
   }else{
    const lock=document.createElement('span');lock.className='cache-lock';lock.textContent=item.category==='active'?'IN USE':'KEEP';
    row.append(lock);
   }
   row.append(text);
   if(item.switchable){
    const use=document.createElement('button');use.type='button';use.className='cache-use';
    use.textContent='Use this version';use.addEventListener('click',async()=>{
      use.disabled=true;showMessage('Verifying selected cache…');
      try{
        const result=await window.launcher.useCacheVersion(item.id);
        showMessage(result.cancelled?'No changes made':'Cache changed. Previous version saved.');
      }catch(e){showMessage(e.message);}
      await refreshCache();
    });row.append(use);
   }
   list.append(row);
  }
 }
 if(inputItems.length){
  const heading=document.createElement('div');heading.className='cache-group-heading';
  heading.textContent='SHADER COMPILATION INPUTS · _BUILD/STATIC-PRECOMPILE';
  list.append(heading);
  for(const item of inputItems){
   const row=document.createElement('div');
   row.className='cache-entry cache-'+item.cleanupLevel+(item.locked?' cache-locked':'');
   const description=document.createElement('div');description.className='cache-entry-text';
   const line=document.createElement('div');line.className='cache-title-line';
   const name=document.createElement('strong');name.textContent=item.title;
   const badge=document.createElement('span');
   badge.className='cache-policy cache-policy-'+item.cleanupLevel;
   badge.textContent=item.cleanupLabel;
   line.append(name,badge);
   const details=document.createElement('span');
   details.textContent=friendlyBytes(item.bytes)+' · '+new Date(item.newest).toLocaleString();
   const reason=document.createElement('small');reason.textContent=item.cleanupReason;
   description.append(line,details,reason);
   if(item.deletable){
    const select=document.createElement('input');select.type='checkbox';select.className='input-check';
    select.dataset.id=item.id;select.title='Select compilation input for safe removal';
    select.addEventListener('change',inputSelection);row.append(select);
   }else{
    const locked=document.createElement('span');locked.className='cache-lock';locked.textContent='KEEP';
    row.append(locked);
   }
   row.append(description);list.append(row);
  }
 }
 cacheSelection();inputSelection();
}
function inputSelection(){
 const ids=[...document.querySelectorAll('.input-check:checked')].map(e=>e.dataset.id);
 $('inputs-remove').disabled=!ids.length;
 return ids;
}
$('inputs-remove').addEventListener('click',async()=>{
 const ids=inputSelection();if(!ids.length)return;
 $('inputs-remove').disabled=true;
 try{
  const result=await window.launcher.deleteShaderInputs(ids);
  showMessage(result.cancelled?'No compilation inputs removed':'Moved '+result.deletedFiles+' input file(s) to Recycle Bin');
 }catch(e){showMessage(e.message);}
 await refreshCache();
});
async function refreshCache(){
 $('cache-status').textContent='Checking shader caches…';
 try{
  const result=await window.launcher.listCaches();
  cacheItems=result.items;
  inputItems=result.inputs||[];
  $('cache-status').textContent='Main cache: '+result.compatibility+'.';
  renderCache();
 }catch(e){$('cache-status').textContent=e.message;}
}
$('cache-refresh').addEventListener('click',refreshCache);
$('cache-snapshot').addEventListener('click',async()=>{
 const button=$('cache-snapshot');button.disabled=true;showMessage('Saving current shader cache version…');
 try{
  const result=await window.launcher.saveCacheVersion();
  showMessage(result.cancelled?'Snapshot cancelled':'Saved complete cache version successfully.');
 }catch(e){showMessage(e.message);}
 finally{button.disabled=false;await refreshCache();}
});
$('cache-delete').addEventListener('click',async()=>{
 const ids=cacheSelection();
 if(!ids.length)return;
 $('cache-delete').disabled=true;
 try{
  const result=await window.launcher.deleteCaches(ids);
  if(result.cancelled)showMessage('Cache deletion cancelled');
  else showMessage('Moved '+result.deletedFiles+' file(s) to Recycle Bin');
  await refreshCache();
 }catch(e){showMessage(e.message);await refreshCache();}
});
window.launcher.load().then(result=>{
 runtime=result;state=structuredClone(result.settings);
 const list=$('language');
 for(let i=0;i<languages.length;i++){const option=document.createElement('option');option.value=String(i);option.textContent=languages[i];list.append(option);}
 fill();
 if(!result.sdk)showMessage('Streamline runtime not detected');
}).catch(e=>showMessage(e.message));
