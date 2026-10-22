'use strict';
// Mods Manager UI: all filesystem actions go through validated main-process IPC.
let modsState=null,selectedMod=null,modOperation=false;
const m$=id=>document.getElementById(id);
function modMessage(message){m$('mod-status').textContent=message;}
function modSize(b){return b>=1024**3?(b/1024**3).toFixed(2)+' GiB':(b/1024**2).toFixed(1)+' MiB';}
function modButtons(){
 const mod=modsState?.mods.find(m=>m.id===selectedMod);
 const busy=modOperation||modsState?.needsRepair||modsState?.gameChanged;
 m$('mod-toggle').disabled=busy||!mod;
 m$('mod-remove').disabled=busy||!mod||mod.enabled;
 m$('mod-toggle').textContent=mod?.enabled?'Disable / Restore':'Enable';
 m$('mod-repair').disabled=modOperation||!modsState?.needsRepair;
 m$('mod-import-folder').disabled=busy;
 m$('mod-import-zip').disabled=busy;
 m$('mod-selected').textContent=mod?(mod.enabled?'ACTIVE: ':'DISABLED: ')+mod.name:'No mod selected';
}
function renderMods(){
 const list=m$('mod-list');list.replaceChildren();
 if(!modsState?.mods.length){
   const empty=document.createElement('p');empty.className='mods-empty';
   empty.textContent='No mods imported. Add an extracted asset folder or ZIP archive.';
   list.append(empty);
 }
 for(const mod of modsState?.mods||[]){
   const row=document.createElement('button');row.type='button';
   row.className='mod-item'+(selectedMod===mod.id?' selected':'');
   row.setAttribute('role','listitem');
   row.setAttribute('aria-pressed',String(selectedMod===mod.id));
   const left=document.createElement('span');left.className='mod-item-info';
   const name=document.createElement('strong');name.textContent=mod.name;
   const detail=document.createElement('small');
   detail.textContent=mod.count+' asset file(s) · '+modSize(mod.bytes);
   left.append(name,detail);
   const badge=document.createElement('span');badge.className='mod-badge'+(mod.enabled?' enabled':'');
   badge.textContent=mod.enabled?'ENABLED':'DISABLED';
   row.append(left,badge);
   row.addEventListener('click',()=>{selectedMod=mod.id;renderMods();});
   list.append(row);
 }
 modButtons();
}
async function refreshMods(){
 try{
   modsState=await window.launcher.listMods();
   if(!modsState.mods.some(m=>m.id===selectedMod))selectedMod=null;
   renderMods();
   if(modsState.needsRepair)modMessage('Interrupted mod operation detected. Use Repair before Play or changing mods.');
   else if(modsState.gameChanged)modMessage('This mod library belongs to another game directory; restore the previous game to manage its mods.');
   else if(modsState.issues.length)modMessage('External file changes or conflicts: '+modsState.issues.join(' · '));
   else modMessage(modsState.mods.filter(m=>m.enabled).length+' active mod(s) · '+modsState.appliedCount+' game file(s) managed · originals backed up');
 }catch(error){modsState=null;renderMods();modMessage(error.message);}
}
async function runModAction(label,action){
 if(modOperation)return;
 modOperation=true;modButtons();modMessage(label+'…');
 try{
   const result=await action();
   if(result?.cancelled)modMessage('No changes made');
   else modMessage(label+' completed');
 }catch(error){modMessage(error.message);}
 finally{modOperation=false;await refreshMods();}
}
m$('mod-refresh').addEventListener('click',refreshMods);
m$('mod-import-folder').addEventListener('click',()=>runModAction('Import extracted mod',()=>window.launcher.addModFolder()));
m$('mod-import-zip').addEventListener('click',()=>runModAction('Import ZIP mod',()=>window.launcher.addModZip()));
m$('mod-toggle').addEventListener('click',()=>{
 const mod=modsState?.mods.find(m=>m.id===selectedMod);if(!mod)return;
 runModAction(mod.enabled?'Restore original game assets':'Enable mod',()=>window.launcher.setModEnabled(mod.id,!mod.enabled));
});
m$('mod-remove').addEventListener('click',()=>{
 const mod=modsState?.mods.find(m=>m.id===selectedMod);if(!mod||mod.enabled)return;
 runModAction('Remove imported mod',()=>window.launcher.removeMod(mod.id));
});
m$('mod-repair').addEventListener('click',()=>runModAction('Repair interrupted mod operation',()=>window.launcher.repairMods()));
