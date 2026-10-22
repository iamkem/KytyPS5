'use strict';
// Versioned, selectable shader binaries. An active cache lives in _PipelineCache/static.
// Saved generations are complete binary sets, NEVER partial precompile shards.
// Only this module changes the active binary files. All operations forbid running Kyty processes.
const fs=require('node:fs');
const fsp=fs.promises;
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');

const GAME=/^[A-Z]{4}[0-9]{5}_[0-9.]+$/;
const SLOT=/^[0-9]{8}-[0-9]{6}-[a-f0-9]{8}$/;
const COMPILED=['binaries','blobs','bin'];
const EXTRAS=['features']; // Shader inputs are separate, not part of a GPU binary generation.
const activeDir=root=>path.join(root,'_PipelineCache','static');
const generationsDir=root=>path.join(root,'_PipelineCache','generations');
const stems=(game)=>[...COMPILED,...EXTRAS].map(ext=>game+'.'+ext);
function ensureGame(game){if(!GAME.test(game))throw Error('Invalid game ID');return game;}
function ensureSlot(slot){if(!SLOT.test(slot))throw Error('Invalid generation ID');return slot;}
function slotId(){const d=new Date();return d.toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15)+'-'+randomUUID().slice(0,8);}
function filesAt(dir,game){
  ensureGame(game);
  const a=stems(game).filter(name=>fs.existsSync(path.join(dir,name)));
  // A standalone complete binary cache is required; no shard can be used as a generation.
  return a.some(n=>COMPILED.some(ext=>n===game+'.'+ext))?a:[];
}
function item(root,slot){
  ensureSlot(slot);
  const dir=path.join(generationsDir(root),slot);
  if(!fs.existsSync(dir)||fs.lstatSync(dir).isSymbolicLink()||!fs.statSync(dir).isDirectory())throw Error('Generation no longer exists');
  const manifestFile=path.join(dir,'manifest.json');
  const m=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  const game=ensureGame(m.game);
  const files=filesAt(dir,game);
  if(!files.length)throw Error('Generation has no usable compiled GPU binary');
  return {dir,manifest:m,game,files};
}
async function snapshot(root,game,assertIdle){
  ensureGame(game);
  assertIdle();
  const origin=activeDir(root),files=filesAt(origin,game);
  if(!files.length)throw Error('No complete active shader cache to save');
  const id=slotId();
  const parent=generationsDir(root);
  fs.mkdirSync(parent,{recursive:true});
  const staging=path.join(parent,'.creating-'+id);
  const destination=path.join(parent,id);
  fs.mkdirSync(staging);
  try{
    for(const name of files){
      assertIdle();
      const src=path.join(origin,name),out=path.join(staging,name);
      if(fs.lstatSync(src).isSymbolicLink())throw Error('Cannot snapshot a symlink');
      await fsp.copyFile(src,out);
      const s=fs.statSync(src);
      await fsp.utimes(out,s.atime,s.mtime);
    }
    const manifest={schema:1,game,created:new Date().toISOString(),label:'Saved shader cache',origin:'snapshot'};
    fs.writeFileSync(path.join(staging,'manifest.json'),JSON.stringify(manifest,null,2));
    assertIdle();
    fs.renameSync(staging,destination);
    return {id,files:files.length};
  }catch(e){await fsp.rm(staging,{recursive:true,force:true});throw e;}
}
function checkBinary(root,game,precompiler,settings){
  if(!fs.existsSync(precompiler)||!settings?.game)return {usable:false,reason:'Shader precompiler or game is missing'};
  const seeds=path.join(root,'_Build','static-precompile','seeds-'+game+'.seeds');
  if(!fs.existsSync(seeds))return {usable:false,reason:'No compatible shader seeds to verify this generation'};
  const probe=spawnSync(precompiler,['--game',settings.game,'--seeds',seeds,'--status'],{
    cwd:root,windowsHide:true,encoding:'utf8',timeout:22000
  });
  const output=(probe.stdout||'')+'\n'+(probe.stderr||'');
  if(probe.error||probe.status!==0)return {usable:false,reason:'GPU compatibility check failed'};
  if(/static cache (current|outdated)/i.test(output))
    return {usable:true,reason:/static cache current/i.test(output)?'Compatible':'Compatible, incremental update available'};
  return {usable:false,reason:'Binary cache is not compatible with the current GPU/driver'};
}
function moveSet(from,to,files){
  fs.mkdirSync(to,{recursive:true});
  const done=[];
  try{
    for(const name of files){fs.renameSync(path.join(from,name),path.join(to,name));done.push(name);}
    return done;
  }catch(error){
    for(const name of done.reverse())fs.renameSync(path.join(to,name),path.join(from,name));
    throw error;
  }
}
function activate(root,slot,expectedGame,precompiler,settings,assertIdle,verify=checkBinary){
  assertIdle();
  const {dir,game,files}=item(root,slot);
  if(game!==ensureGame(expectedGame))throw Error('Selected cache belongs to a different game/version');
  const active=activeDir(root);
  const current=filesAt(active,game);
  if(!current.length)throw Error('Current active cache is missing; no safe rollback target');
  const newSlot=slotId();
  const previous=path.join(generationsDir(root),'.switch-'+newSlot);
  const savedPath=path.join(generationsDir(root),newSlot);
  fs.mkdirSync(previous);
  let parked=false,installed=false;
  try{
    assertIdle();
    moveSet(active,previous,current);
    parked=true;
    moveSet(dir,active,files);
    installed=true;
    const check=verify(root,game,precompiler,settings);
    if(!check.usable)throw Error(check.reason+'; original cache restored');
    assertIdle();
    const metadata={schema:1,game,created:new Date().toISOString(),label:'Previously active cache',origin:'switched'};
    fs.writeFileSync(path.join(previous,'manifest.json'),JSON.stringify(metadata,null,2));
    fs.renameSync(previous,savedPath);
    fs.rmSync(dir,{recursive:true});
    return {active:slot,previous:newSlot,compatibility:check.reason};
  }catch(error){
    if(installed)moveSet(active,dir,files);
    if(parked)moveSet(previous,active,current);
    try{fs.rmSync(previous,{recursive:true});}catch{}
    throw error;
  }
}
module.exports={filesAt,item,snapshot,activate,checkBinary,slotId,ensureSlot};
