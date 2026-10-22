'use strict';
// Manages ONLY well-defined Kyty shader cache groups. No automatic deletion.
// Inventory records are regenerated for every destructive action; IPC callers cannot supply filesystem paths.
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const versioned=require('./cache-generations.cjs');

const KNOWN_FOLDERS=['local','warmup-v2','precompile-as-emulator','files'];
// Single source of truth for the UI AND the deletion endpoint. No renderer-supplied policy is trusted.
const CLEANUP_POLICY=Object.freeze({
  active: Object.freeze({level:'protected',label:'DO NOT DELETE',deletable:false,
    reason:'Currently loaded by KytyPS5. Deletion is permanently disabled while active.'}),
  archive: Object.freeze({level:'safe',label:'SAFE TO CLEAN',deletable:true,
    reason:'Interrupted precompile shards are archived and not used by the active cache. You can remove them if you will not resume that old run.'}),
  generation: Object.freeze({level:'review',label:'BACKUP — REVIEW',deletable:true,
    reason:'Complete saved cache that can be restored. Removing it permanently loses this rollback version (unless recovered from Recycle Bin).'}),
  incompatible: Object.freeze({level:'review',label:'OLD DRIVER — REVIEW',deletable:true,
    reason:'Older driver-specific cache. Keep if you might revert GPU drivers; remove only if no longer needed.'}),
  aux: Object.freeze({level:'protected',label:'KEEP — PERFORMANCE',deletable:false,
    reason:'Driver/warmup/file/precompile working data. Small and potentially reusable; deletion is disabled to prevent stutter or rebuilding.'})
});
function cleanupPolicy(category){
  const p=CLEANUP_POLICY[category];
  if(!p)throw Error('Unknown cache category');
  return p;
}
function walk(folder){
  const files=[];
  if(!fs.existsSync(folder))return files;
  for(const item of fs.readdirSync(folder,{withFileTypes:true})){
    if(item.isSymbolicLink())continue;
    const full=path.join(folder,item.name);
    if(item.isDirectory())files.push(...walk(full));
    else if(item.isFile())files.push(full);
  }
  return files;
}
function summarize(id,title,category,description,files,root){
  if(!files.length)return null;
  let bytes=0,newest=0,oldest=Number.MAX_SAFE_INTEGER;
  for(const f of files){
    const stat=fs.lstatSync(f);
    if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unsafe cache item');
    bytes+=stat.size;
    newest=Math.max(newest,stat.mtimeMs);
    oldest=Math.min(oldest,stat.mtimeMs);
  }
  return {id,title,category,description,bytes,count:files.length,
    oldest:new Date(oldest).toISOString(),newest:new Date(newest).toISOString(),
    // Paths are informational only and are never accepted from the renderer for deletion.
    location:path.relative(root,path.dirname(files[0])).replaceAll('\\','/')};
}
function safePath(root,p){
  const base=fs.realpathSync(root);
  const file=fs.realpathSync(p);
  if(!file.startsWith(base+path.sep))throw Error('Cache path is outside the cache root');
  if(fs.lstatSync(file).isSymbolicLink())throw Error('Symlink is not a cache file');
  return file;
}
function groups(root){
  const base=path.join(root,'_PipelineCache');
  if(!fs.existsSync(base))return [];
  const results=[];
  const staticDir=path.join(base,'static');
  if(fs.existsSync(staticDir)){
    const names=fs.readdirSync(staticDir,{withFileTypes:true})
      .filter(e=>e.isFile()&&!e.isSymbolicLink()).map(e=>e.name);
    const ids=new Set();
    for(const name of names){
      // e.g. PPSA01341_01.007.000.binaries, .features and .shaders
      const m=name.match(/^([A-Z]{4}[0-9]{5}_[0-9.]+)\.(?:binaries|features|shaders|bin|blobs)/);
      if(m)ids.add(m[1]);
    }
    for(const game of ids){
      const files=names.filter(n=>n.startsWith(game+'.'))
        .map(n=>path.join(staticDir,n));
      const s=summarize('active:'+game,game+' — primary shader cache','active',
        'Primary GPU binaries used by the emulator. Keep unless invalid.',files,root);
      if(s){
        s.locked=true;s.switchable=false;s.version='in-use';
        results.push(s);
      }
    }
  }
  // Full, selectable generations. Only completed binary sets are eligible for activation.
  const generationRoot=path.join(base,'generations');
  if(fs.existsSync(generationRoot)){
    for(const entry of fs.readdirSync(generationRoot,{withFileTypes:true})){
      if(!entry.isDirectory()||entry.isSymbolicLink())continue;
      if(!/^[0-9]{8}-[0-9]{6}-[a-f0-9]{8}$/.test(entry.name))continue;
      try{
        const g=versioned.item(root,entry.name);
        const files=g.files.map(name=>path.join(g.dir,name));
        const s=summarize('generation:'+entry.name,g.game+' — '+(g.manifest.label||'Saved version'),
          'generation','Complete compiled shader cache. You may activate this version.',files,root);
        if(s){s.game=g.game;s.switchable=true;s.locked=false;results.push(s);}
      }catch{/* Skip incomplete/corrupt snapshots, never advertise them as switchable. */}
    }
  }
  const archived=path.join(base,'archived-shards');
  if(fs.existsSync(archived)){
    for(const entry of fs.readdirSync(archived,{withFileTypes:true})){
      if(!entry.isDirectory()||entry.isSymbolicLink())continue;
      const files=walk(path.join(archived,entry.name));
      const s=summarize('archive:'+entry.name,entry.name,'archive',
        'Older interrupted precompile shards. Not used by the active cache.',files,root);
      if(s)results.push(s);
    }
  }
  const incompatible=path.join(base,'archived-incompatible');
  if(fs.existsSync(incompatible)){
    for(const entry of fs.readdirSync(incompatible,{withFileTypes:true})){
      if(!entry.isDirectory()||entry.isSymbolicLink())continue;
      const s=summarize('incompatible:'+entry.name,entry.name,'incompatible',
        'Previous GPU/driver format. Kept for backup; not active.',walk(path.join(incompatible,entry.name)),root);
      if(s)results.push(s);
    }
  }
  for(const folder of KNOWN_FOLDERS){
    const dir=path.join(base,folder);
    if(!fs.existsSync(dir))continue;
    // Show each subdirectory separately when possible.
    const children=fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.isSymbolicLink());
    for(const entry of children){
      const s=summarize('aux:'+folder+'/'+entry.name,entry.name,'aux',
        folder+' — recorded/working shader cache, not the primary binary store.',
        walk(path.join(dir,entry.name)),root);
      if(s)results.push(s);
    }
    const loose=fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile()&&!e.isSymbolicLink()).map(e=>path.join(dir,e.name));
    const s=summarize('aux:'+folder,folder+' — loose cache','aux','Non-primary cache files.',loose,root);
    if(s)results.push(s);
  }
  const activeByGame=new Map(results.filter(x=>x.category==='active').map(x=>[x.id.slice(7),Date.parse(x.newest)]));
  for(const row of results){
    if(row.category==='generation'){
      const live=activeByGame.get(row.game);
      row.version=live===undefined?'saved':Date.parse(row.newest)>live?'newer':'older';
    }else if(row.category!=='active'){
      row.version='historical';row.switchable=false;row.locked=false;
    }
  }
  for(const row of results){
    const policy=cleanupPolicy(row.category);
    row.cleanupLevel=policy.level;
    row.cleanupLabel=policy.label;
    row.cleanupReason=policy.reason;
    row.deletable=policy.deletable;
    row.locked=!policy.deletable;
  }
  const rank={active:0,generation:1,archive:2,incompatible:2,aux:3};
  return results.sort((a,b)=>(rank[a.category]??9)-(rank[b.category]??9)||b.newest.localeCompare(a.newest));
}
function filesFor(root,id){
  const base=path.join(root,'_PipelineCache');
  if(id.startsWith('active:')){
    const name=id.slice(7);
    if(!/^[A-Z]{4}[0-9]{5}_[0-9.]+$/.test(name))throw Error('Invalid active cache ID');
    const dir=path.join(base,'static');
    return fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>n.startsWith(name+'.'))
      .map(n=>path.join(dir,n)).filter(f=>fs.existsSync(f)&&fs.lstatSync(f).isFile()):[];
  }
  if(id.startsWith('generation:')){
    const item=versioned.item(root,id.slice(11));
    return [...item.files.map(name=>path.join(item.dir,name)),path.join(item.dir,'manifest.json')];
  }
  const m=id.match(/^(archive|incompatible|aux):(.+)$/);
  if(!m)throw Error('Unknown cache ID');
  const prefix=m[1]==='archive'?'archived-shards':m[1]==='incompatible'?'archived-incompatible':'';
  let rel=m[2];
  if(m[1]==='aux'){
    const [folder,...suffix]=rel.split('/');
    if(!KNOWN_FOLDERS.includes(folder)||suffix.length>1)throw Error('Invalid cache category');
    rel=path.join(folder,...suffix);
  } else if(!/^[a-zA-Z0-9_.-]+$/.test(rel))throw Error('Invalid archive name');
  const full=path.join(base,prefix,rel);
  if(!fs.existsSync(full))return [];
  return fs.statSync(full).isDirectory()?walk(full):[full];
}
function cacheStatus(root,settings,precompiler){
  try{
    const seeds=path.join(root,'_Build','static-precompile',`seeds-PPSA01341_01.007.000.seeds`);
    if(!settings.game||!fs.existsSync(precompiler)||!fs.existsSync(seeds))
      return 'Not checked (no shader tool or seeds)';
    const run=spawnSync(precompiler,['--game',settings.game,'--seeds',seeds,'--status'],{cwd:root,windowsHide:true,encoding:'utf8',timeout:15000});
    const stdout=(run.stdout||'')+' '+(run.stderr||'');
    if(/static cache current/i.test(stdout))return 'Compatible with current GPU/driver';
    if(/static cache outdated/i.test(stdout))return 'Reusable; incremental update available';
    if(/static cache stale/i.test(stdout))return 'Incompatible GPU/driver cache';
    return 'Unknown — manual verification recommended';
  }catch{return 'Unknown — status check failed';}
}
async function trashSelected(root,ids,shell,processActive){
  if(!Array.isArray(ids)||!ids.length||ids.length>12||!ids.every(x=>typeof x==='string'))throw Error('Select valid cache groups');
  if(processActive())throw Error('Emulator or shader precompile is running; close it before deleting caches.');
  const inventory=groups(root);
  const unique=[...new Set(ids)];
  const known=new Map(inventory.map(x=>[x.id,x]));
  if(unique.length!==ids.length||unique.some(id=>!known.has(id)))throw Error('Cache list changed; refresh before deleting.');
  const protectedItem=unique.map(id=>known.get(id)).find(item=>!item.deletable);
  if(protectedItem)throw Error('Protected cache is locked: '+protectedItem.title+'. '+protectedItem.cleanupReason);
  const cacheRoot=path.join(root,'_PipelineCache');
  const chosen=[];
  for(const id of unique){
    const files=filesFor(root,id);
    if(!files.length)throw Error('Cache changed; refresh before deleting.');
    chosen.push(...files.map(f=>safePath(cacheRoot,f)));
  }
  const uniqFiles=[...new Set(chosen)];
  // Recycle Bin instead of rm/rmdir. Never follow symlink targets.
  for(const file of uniqFiles)await shell.trashItem(file);
  return {deletedGroups:unique.length,deletedFiles:uniqFiles.length};
}
module.exports={groups,filesFor,cacheStatus,trashSelected,cleanupPolicy};
