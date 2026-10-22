'use strict';
// Demon's Souls asset-file mods. No executable, game module or save modifications.
// Disabled packages live under _Mods, outside the game's directory.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const {execFile}=require('node:child_process');
const execute=promisify(execFile);
const ROOTS=new Set('characters cinematics collision coredata cp11demonssouls globalillumination levels materials misc model models movies particles parts props scripts sky sound test text textures ui virtualgeo weapons workspaces'.split(' '));
const DISALLOWED=new Set(['.exe','.dll','.prx','.elf','.bin','.bat','.cmd','.ps1','.vbs','.js','.py','.lua','.sh','.so','.dylib','.jar','.msi','.lnk','.sys','.com','.scr','.reg','.node']);
const MAX_FILES=4000,MAX_FILE=2*1024**3,MAX_TOTAL=8*1024**3;
function shaFile(file){const h=crypto.createHash('sha256');const fd=fs.openSync(file,'r');try{const chunk=Buffer.allocUnsafe(1024*1024);let n;while((n=fs.readSync(fd,chunk,0,chunk.length,null))>0)h.update(chunk.subarray(0,n));return h.digest('hex');}finally{fs.closeSync(fd);}}
function ensurePlain(file,folder=false){
 const st=fs.lstatSync(file);
 if(st.isSymbolicLink()||!(folder?st.isDirectory():st.isFile()))throw Error('Mod files must be ordinary files/folders: '+file);
 return st;
}
function normalized(rel){
 if(typeof rel!=='string'||!rel||rel.includes('\0')||rel.includes(':')||rel.startsWith('/')||rel.includes('\\'))throw Error('Unsafe mod path');
 const segments=rel.split('/');
 if(segments.some(x=>!x||x==='.'||x==='..'||x.endsWith('.')||x.endsWith(' ')||/[<>|"?*]/.test(x)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(x)))throw Error('Unsafe mod path');
 if(!ROOTS.has(segments[0].toLowerCase())||segments.length<2)throw Error('Mods may only replace game assets, not executables or configuration: '+rel);
 if(DISALLOWED.has(path.extname(rel).toLowerCase()))throw Error('Executable/script content is blocked: '+rel);
 return segments.join('/');
}
function inside(root,rel){const full=path.resolve(root,...rel.split('/'));if(!full.startsWith(path.resolve(root)+path.sep))throw Error('Path escapes installation');return full;}
function ensureGamePath(game,rel){
 const full=inside(game,rel),root=path.resolve(game);ensurePlain(root,true);
 let parent=root;
 for(const segment of rel.split('/').slice(0,-1)){
   parent=path.join(parent,segment);
   if(fs.existsSync(parent))ensurePlain(parent,true);
 }
 if(fs.existsSync(full))ensurePlain(full);
 return full;
}
function enumerate(source){
 const found=[];let size=0;
 const walk=(dir,parts)=>{
   ensurePlain(dir,true);
   for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
     const next=[...parts,entry.name],p=path.join(dir,entry.name);
     if(entry.isSymbolicLink()||(!entry.isFile()&&!entry.isDirectory()))throw Error('Symlink or special mod entry blocked');
     if(entry.isDirectory()){walk(p,next);continue;}
     if(!parts.length&&/^(?:readme|license|changelog|description)(?:[._ -].*)?\.(?:txt|md)$/i.test(entry.name))continue;
     const rel=normalized(next.join('/')),st=ensurePlain(p);
     if(st.size>MAX_FILE)throw Error('Mod file exceeds 2 GiB: '+rel);
     size+=st.size;if(size>MAX_TOTAL||found.length>=MAX_FILES)throw Error('Mod exceeds file count or 8 GiB limit');
     found.push({rel,size:st.size,sha:shaFile(p),source:p});
   }
 };
 walk(source,[]);
 if(!found.length)throw Error('No compatible game asset files found');
 const set=new Set();
 for(const item of found){const key=item.rel.toLowerCase();if(set.has(key))throw Error('Duplicate case-insensitive mod path: '+item.rel);set.add(key);}
 return found.sort((a,b)=>a.rel.localeCompare(b.rel));
}
function locateContent(folder){
 let dir=folder;
 for(let i=0;i<3;i++){
   ensurePlain(dir,true);
   const entries=fs.readdirSync(dir,{withFileTypes:true}).filter(x=>x.name!=='__MACOSX'&&!x.name.startsWith('.'));
   if(entries.some(e=>ROOTS.has(e.name.toLowerCase())&&e.isDirectory()))return dir;
   if(entries.length!==1||!entries[0].isDirectory()||entries[0].isSymbolicLink())break;
   dir=path.join(dir,entries[0].name);
 }
 throw Error('Mod must contain game-root asset folders such as textures/, characters/, or ui/');
}
function saveJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.tmp-'+process.pid;fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});fs.renameSync(temp,file);}
class ModManager{
 constructor(root){this.root=root;this.base=path.join(root,'_Mods');this.registry=path.join(this.base,'registry.json');this.journal=path.join(this.base,'transaction.json');}
 gamePath(game){if(typeof game!=='string'||!fs.existsSync(game))throw Error('Game folder missing');ensurePlain(game,true);return path.resolve(game);}
 load(){if(!fs.existsSync(this.registry))return {version:1,game:'',mods:[],applied:{}};const v=JSON.parse(fs.readFileSync(this.registry,'utf8'));if(v.version!==1||!Array.isArray(v.mods)||!v.applied||typeof v.applied!=='object')throw Error('Unsupported mod registry');return v;}
 assertClear(){if(fs.existsSync(this.journal))throw Error('Unfinished mod operation found. Use Repair in Mods Manager before making changes.');}
 status(game){
   const data=this.load(),target=this.gamePath(game),different=Boolean(data.game&&path.resolve(data.game).toLowerCase()!==target.toLowerCase());
   const issues=[],owner=new Map();
   for(const mod of data.mods.filter(m=>m.enabled)){
     for(const file of mod.files){
       const dest=inside(target,file.rel),key=file.rel.toLowerCase();
       if(owner.has(key))issues.push('Conflict: '+file.rel);
       else owner.set(key,mod.id);
       // Listing and Play must remain responsive even with multi-gigabyte mods.
       // Compare sizes here; disabling a mod performs the full SHA-256 check before restoring.
       try{if(!fs.existsSync(dest)||fs.statSync(dest).size!==file.size)issues.push('Modified/missing: '+file.rel);}catch{issues.push('Unreadable: '+file.rel);}
     }
   }
   return {mods:data.mods.map(({id,name,enabled,files,bytes})=>({id,name,enabled,count:files.length,bytes})),
     appliedCount:Object.keys(data.applied).length,gameChanged:different,needsRepair:fs.existsSync(this.journal),issues:issues.slice(0,12),
     store:this.base};
 }
 // Explicit, read-only inspection. Import acceptance is not proof of in-game compatibility.
 // Integrity is verified here for a human-readable preview and again at application time.
 inspect(id,game){
   this.assertClear();
   const target=this.gamePath(game),data=this.load();
   if(data.game&&path.resolve(data.game).toLowerCase()!==target.toLowerCase())
     throw Error('Mod collection belongs to another game folder');
   const mod=data.mods.find(m=>m.id===id);
   if(!mod)throw Error('Unknown mod');
   const owned=new Set(Object.keys(data.applied).map(rel=>rel.toLowerCase()));
   const summary={replace:0,add:0,identical:0,conflict:0,invalid:0,restore:0,remove:0};
   const files=mod.files.map(f=>{
     let state,detail='';
     try{
       if(normalized(f.rel)!==f.rel)throw Error('Invalid asset path in registry');
       const source=inside(path.join(this.base,'packages',mod.id),f.rel);
       if(ensurePlain(source).size!==f.size||shaFile(source)!==f.sha)
         throw Error('Imported package missing or changed since import');
       const dest=ensureGamePath(target,f.rel);
       const present=fs.existsSync(dest),diskHash=present?shaFile(dest):null;
       if(mod.enabled){
         const record=data.applied[f.rel];
         if(!record||record.modId!==mod.id||diskHash!==f.sha)
           throw Error('Applied asset was modified or is missing');
         if(record.backup){
           const original=inside(this.base,record.backup);
           if(!fs.existsSync(original)||shaFile(original)!==record.originalHash)
             throw Error('Original backup missing or changed');
         }
         state=record.backup?'restore':'remove';
       }else if(owned.has(f.rel.toLowerCase())){
         state='conflict';detail='Another enabled mod owns this path';
       }else if(!present){state='add';}
       else if(diskHash===f.sha){state='identical';detail='Same SHA-256 as installed asset; no content change';}
       else{state='replace';}
     }catch(error){state='invalid';detail=error.message;}
     summary[state]++;
     return {rel:f.rel,size:f.size,state,detail};
   });
   return {id:mod.id,name:mod.name,enabled:mod.enabled,bytes:mod.bytes,
     summary,files,ready:summary.conflict===0&&summary.invalid===0,
     warning:'Only asset paths and SHA-256 were checked. Real game/mod compatibility is unverified.'};
 }
 async importFolder(source,name,game){
   this.assertClear();const root=this.gamePath(game);
   const data=this.load();if(data.game&&data.game.toLowerCase()!==root.toLowerCase()&&data.mods.length)throw Error('Existing mod library belongs to another game installation; remove those mods before switching game folders');
   const sourceRoot=path.resolve(source);
   if(sourceRoot.toLowerCase()===root.toLowerCase()||root.toLowerCase().startsWith(sourceRoot.toLowerCase()+path.sep))
     throw Error('Select a mod package, not the game installation or its parent directory');
   const content=locateContent(source),listing=enumerate(content);
   const id=crypto.randomUUID(),target=path.join(this.base,'packages',id),stage=target+'.staging';
   if(fs.existsSync(stage)||fs.existsSync(target))throw Error('Import staging conflict');
   fs.mkdirSync(stage,{recursive:true});
   try{
     for(const f of listing){const dest=inside(stage,f.rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(f.source,dest);if(shaFile(dest)!==f.sha)throw Error('Mod import checksum mismatch');}
     fs.renameSync(stage,target);
     const mod={id,name:(String(name||path.basename(source)).replace(/[\r\n<>]/g,' ').trim().slice(0,80)||'Unnamed Mod'),enabled:false,
       files:listing.map(({rel,sha,size})=>({rel,sha,size})),bytes:listing.reduce((s,f)=>s+f.size,0)};
     if(data.game&&data.game.toLowerCase()!==root.toLowerCase()){data.mods=[];data.applied={};}
     data.game=root;data.mods.push(mod);
     saveJson(this.registry,data);
     return {id,name:mod.name,files:mod.files.length,bytes:mod.bytes};
   }catch(e){if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});if(fs.existsSync(target)&&!this.load().mods.some(m=>m.id===id))fs.rmSync(target,{recursive:true,force:true});throw e;}
 }
 async importZip(file,game){
   this.assertClear();this.gamePath(game);
   ensurePlain(file);if(path.extname(file).toLowerCase()!=='.zip')throw Error('Only ZIP archives are supported');
   const extract=path.join(this.base,'temp','zip-'+crypto.randomUUID());
   fs.mkdirSync(extract,{recursive:true});
   // PowerShell cannot read a PS1 script inside Electron's app.asar. Materialize only
   // our own bundled extraction script under the private temporary mod directory.
   const script=path.join(extract,'safe-extract.ps1');
   try{
     fs.writeFileSync(script,fs.readFileSync(path.join(__dirname,'scripts','extract-mod-zip.ps1')),{flag:'wx'});
     await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-Archive',file,
       '-Destination',path.join(extract,'contents')],{windowsHide:true,timeout:180000,maxBuffer:512*1024});
     return await this.importFolder(path.join(extract,'contents'),path.basename(file,'.zip'),game);
   }finally{fs.rmSync(extract,{recursive:true,force:true,maxRetries:3});}
 }
 // Atomic per-file updates with preimages in a write-ahead transaction for interrupted/crashed operations.
 transaction(game,mod,enable,data){
   const changes=mod.files.map(f=>{
     const source=inside(path.join(this.base,'packages',mod.id),f.rel);
     if(!fs.existsSync(source)||shaFile(source)!==f.sha)throw Error('Mod package missing or edited: '+f.rel);
     const target=ensureGamePath(game,f.rel);
     const existing=fs.existsSync(target),now=existing?shaFile(target):null;
     if(enable){
       if(Object.keys(data.applied).some(k=>k.toLowerCase()===f.rel.toLowerCase()))throw Error('File conflict with another enabled mod: '+f.rel);
     }else{
       const record=data.applied[f.rel];
       if(!record||record.modId!==mod.id||now!==f.sha)throw Error('Game file edited externally; cannot safely restore: '+f.rel);
       const backup=record.backup?inside(this.base,record.backup):null;
       if(backup&&(!fs.existsSync(backup)||shaFile(backup)!==record.originalHash))throw Error('Original backup missing or changed: '+f.rel);
     }
     return {rel:f.rel,source,target,wasPresent:existing,previousHash:now,modHash:f.sha,
       backup:!enable?data.applied[f.rel].backup:null,
       expectedHash:enable?f.sha:data.applied[f.rel].originalHash};
   });
   const tx=path.join(this.base,'temp','transaction-'+crypto.randomUUID());fs.mkdirSync(tx,{recursive:true});
   try{
     for(let i=0;i<changes.length;i++){
       const c=changes[i];if(c.wasPresent){c.snapshot=path.join(tx,String(i)+'.original');fs.copyFileSync(c.target,c.snapshot);if(shaFile(c.snapshot)!==c.previousHash)throw Error('Concurrent game file change');}
     }
     saveJson(this.journal,{mode:enable?'enable':'disable',modId:mod.id,game,tx,changes:changes.map(c=>({
       rel:c.rel,wasPresent:c.wasPresent,previousHash:c.previousHash,modHash:c.modHash,
       expectedHash:c.expectedHash,snapshot:c.snapshot||null,backup:c.backup||null
     }))});
     let changed=0;
     try{
       for(const c of changes){
         const dataSource=enable?c.source:(c.backup?inside(this.base,c.backup):null);
         if(dataSource){fs.mkdirSync(path.dirname(c.target),{recursive:true});
           const temporary=c.target+'.kyty-mod-'+process.pid;
           try{fs.copyFileSync(dataSource,temporary);fs.renameSync(temporary,c.target);}finally{if(fs.existsSync(temporary))fs.rmSync(temporary,{force:true});}
         }else if(fs.existsSync(c.target))fs.rmSync(c.target);
         changed++;
       }
       for(const c of changes){
         if(enable){
           const backup=c.wasPresent?'originals/'+crypto.createHash('sha256').update(c.rel.toLowerCase()).digest('hex')+'.bak':null;
           if(backup){
             const dest=inside(this.base,backup);fs.mkdirSync(path.dirname(dest),{recursive:true});
             if(fs.existsSync(dest))throw Error('Unmanaged backup already exists; cannot overwrite: '+c.rel);
             fs.copyFileSync(c.snapshot,dest);if(shaFile(dest)!==c.previousHash)throw Error('Original backup mismatch');
           }
           data.applied[c.rel]={modId:mod.id,backup,originalHash:c.previousHash};
         }else delete data.applied[c.rel];
       }
       mod.enabled=enable;saveJson(this.registry,data);
       fs.rmSync(this.journal,{force:true});fs.rmSync(tx,{recursive:true,force:true});
       if(!enable)for(const c of changes){if(c.backup)fs.rmSync(inside(this.base,c.backup),{force:true});}
       return {enabled:enable,changed};
     }catch(e){ // Leave journal and snapshots if rollback cannot be proved safe.
       try{this.repair(game);}catch(rollback){throw Error(e.message+'; rollback blocked: '+rollback.message);}
       throw e;
     }
   }catch(e){if(!fs.existsSync(this.journal)&&fs.existsSync(tx))fs.rmSync(tx,{recursive:true,force:true});throw e;}
 }
 setEnabled(id,enabled,game){
   this.assertClear();const target=this.gamePath(game),data=this.load();
   if(path.resolve(data.game).toLowerCase()!==target.toLowerCase())throw Error('Mod collection belongs to another game folder');
   const mod=data.mods.find(m=>m.id===id);if(!mod)throw Error('Unknown mod');
   if(mod.enabled===enabled)return {enabled,changed:0};
   return this.transaction(target,mod,enabled,data);
 }
 remove(id){
   this.assertClear();const data=this.load(),index=data.mods.findIndex(m=>m.id===id);
   if(index<0)throw Error('Unknown mod');
   if(data.mods[index].enabled)throw Error('Disable the mod before removing it');
   const folder=path.join(this.base,'packages',id);
   data.mods.splice(index,1);saveJson(this.registry,data);
   if(fs.existsSync(folder))fs.rmSync(folder,{recursive:true,force:true});
   return true;
 }
 repair(game){
   const target=this.gamePath(game);
   if(!fs.existsSync(this.journal))return {repaired:0};
   const journal=JSON.parse(fs.readFileSync(this.journal,'utf8'));
   if(path.resolve(journal.game).toLowerCase()!==target.toLowerCase())throw Error('Recovery belongs to a different game');
   const data=this.load(),mod=data.mods.find(m=>m.id===journal.modId);
   if(!mod)throw Error('Recovery mod is absent');
   // A completed manifest and matching files mean only journal cleanup was interrupted.
   if(mod.enabled===(journal.mode==='enable')&&journal.changes.every(c=>{
     const file=ensureGamePath(target,c.rel);
     return c.expectedHash?(fs.existsSync(file)&&shaFile(file)===c.expectedHash):!fs.existsSync(file);
   })){
     fs.rmSync(this.journal,{force:true});fs.rmSync(journal.tx,{recursive:true,force:true});
     if(journal.mode==='disable')for(const c of journal.changes){
       if(c.backup)fs.rmSync(inside(this.base,c.backup),{force:true});
     }
     return {repaired:0};
   }
   for(const c of journal.changes){
     normalized(c.rel);const dest=ensureGamePath(target,c.rel);
     if(fs.existsSync(dest)){
       const current=shaFile(dest);
       // Interrupted disable may already have restored the verified original.
       // Allow that exact expected hash, but never an arbitrary external edit.
       if(current!==c.previousHash&&current!==c.modHash&&current!==c.expectedHash)
         throw Error('Unexpected edits prevent automatic recovery: '+c.rel);
     }
     if(c.wasPresent&&(!c.snapshot||!fs.existsSync(c.snapshot)||shaFile(c.snapshot)!==c.previousHash))throw Error('Recovery snapshot missing: '+c.rel);
   }
   for(const c of journal.changes){
     const dest=ensureGamePath(target,c.rel);
     if(c.wasPresent){fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(c.snapshot,dest);}
     else if(fs.existsSync(dest))fs.rmSync(dest);
   }
   if(journal.mode==='enable'&&!mod.enabled){
     for(const c of journal.changes){
       if(!c.wasPresent)continue;
       const old=inside(this.base,'originals/'+crypto.createHash('sha256').update(c.rel.toLowerCase()).digest('hex')+'.bak');
       if(fs.existsSync(old)&&shaFile(old)===c.previousHash)fs.rmSync(old,{force:true});
     }
   }
   fs.rmSync(this.journal,{force:true});fs.rmSync(journal.tx,{recursive:true,force:true});
   return {repaired:journal.changes.length};
 }
}
module.exports={ModManager,normalized,enumerate,locateContent,ROOTS};
