'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {ModManager,normalized}=require('../mod-manager.cjs');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-mods-'));
 const game=path.join(root,'PPSA01341-app0'),source=path.join(root,'DownloadedMod');
 fs.mkdirSync(game);fs.mkdirSync(source);
 const asset=(place,value,base=source)=>{const p=path.join(base,...place.split('/'));fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,value);return p;};
 return {root,game,source,asset,manager:new ModManager(root),clean:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('Asset path policy rejects traversal, executables, game metadata and modules',()=>{
 for(const rel of ['../../x','textures/../eboot.bin','sce_module/kernel.prx','eboot.bin','characters/a.dll','textures/x.ps1','scripts/evil.lua','textures/tool.py','textures/x\\evil','/textures/a.dds','C:/other/a.dds'])assert.throws(()=>normalized(rel));
 assert.equal(normalized('textures/face.dds'),'textures/face.dds');
 assert.throws(()=>normalized('textures/CON.dds'));
});
test('Import is disabled by default; enabling makes backup, disabling restores original assets',async()=>{
 const x=fixture();try{
  x.asset('textures/original.dds','old',x.game);
  x.asset('textures/original.dds','new');
  x.asset('characters/new_asset.dcx','extra');
  x.asset('readme.txt','Readme only');
  const imp=await x.manager.importFolder(x.source,'Better textures',x.game);
  assert.equal(imp.files,2);
  assert.equal(fs.readFileSync(path.join(x.game,'textures','original.dds'),'utf8'),'old');
  assert.equal(x.manager.status(x.game).mods[0].enabled,false);
  const result=x.manager.setEnabled(imp.id,true,x.game);
  assert.equal(result.changed,2);
  assert.equal(fs.readFileSync(path.join(x.game,'textures','original.dds'),'utf8'),'new');
  assert.equal(fs.readFileSync(path.join(x.game,'characters','new_asset.dcx'),'utf8'),'extra');
  assert.equal(x.manager.status(x.game).appliedCount,2);
  x.manager.setEnabled(imp.id,false,x.game);
  assert.equal(fs.readFileSync(path.join(x.game,'textures','original.dds'),'utf8'),'old');
  assert.equal(fs.existsSync(path.join(x.game,'characters','new_asset.dcx')),false);
  assert.equal(x.manager.status(x.game).appliedCount,0);
  x.manager.remove(imp.id);
  assert.equal(x.manager.status(x.game).mods.length,0);
 }finally{x.clean();}
});
test('Conflicting mods are refused without overwriting the first enabled package',async()=>{
 const x=fixture();try{
  x.asset('ui/hud.dds','first');
  const a=await x.manager.importFolder(x.source,'First',x.game);
  const other=path.join(x.root,'Other');fs.mkdirSync(other);
  x.asset('ui/hud.dds','second',other);
  const b=await x.manager.importFolder(other,'Second',x.game);
  x.manager.setEnabled(a.id,true,x.game);
  assert.throws(()=>x.manager.setEnabled(b.id,true,x.game),/conflict/i);
  assert.equal(fs.readFileSync(path.join(x.game,'ui','hud.dds'),'utf8'),'first');
  x.manager.setEnabled(a.id,false,x.game);
  x.manager.setEnabled(b.id,true,x.game);
  assert.equal(fs.readFileSync(path.join(x.game,'ui','hud.dds'),'utf8'),'second');
 }finally{x.clean();}
});
test('Changes made outside manager block disabling a mod, no user data overwritten',async()=>{
 const x=fixture();try{
  x.asset('weapons/model.dcx','mod');
  const mod=await x.manager.importFolder(x.source,'Weapon mod',x.game);
  x.manager.setEnabled(mod.id,true,x.game);
  x.asset('weapons/model.dcx','external-edit',x.game);
  assert.throws(()=>x.manager.setEnabled(mod.id,false,x.game),/externally/);
  assert.equal(fs.readFileSync(path.join(x.game,'weapons','model.dcx'),'utf8'),'external-edit');
 }finally{x.clean();}
});
test('Metadata-only folders and executable mod content are rejected',async()=>{
 const x=fixture();try{
  x.asset('readme.txt','no content');
  await assert.rejects(x.manager.importFolder(x.source,'Empty',x.game),/must contain|No compatible/);
  x.asset('ui/helper.dll','untrusted binary');
  await assert.rejects(x.manager.importFolder(x.source,'Executable',x.game),/Executable\/script content/);
 }finally{x.clean();}
});
test('ZIP import uses bounded PowerShell ZIP extractor and only stages content',async()=>{
 if(process.platform!=='win32')return;
 const x=fixture();try{
  x.asset('textures/surface.dds','compressed-value');
  const zip=path.join(x.root,'CoolMod.zip');
  const result=spawnSync('powershell.exe',['-NoProfile','-Command',
   'Compress-Archive -LiteralPath '+JSON.stringify(path.join(x.source,'textures'))+' -DestinationPath '+JSON.stringify(zip)+' -Force'],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr||result.stdout);
  const imported=await x.manager.importZip(zip,x.game);
  assert.equal(imported.files,1);
  assert.equal(fs.existsSync(path.join(x.game,'textures','surface.dds')),false);
 }finally{x.clean();}
});
test('Incomplete change requires explicit recovery and uses original snapshots safely',async()=>{
 const x=fixture();try{
  x.asset('materials/stone.dds','pristine',x.game);
  x.asset('materials/stone.dds','mod');
  const m=await x.manager.importFolder(x.source,'Stone',x.game);
  const snap=path.join(x.root,'_Mods','temp','transaction-manual');
  fs.mkdirSync(snap,{recursive:true});
  const copy=path.join(snap,'0.original');
  fs.copyFileSync(path.join(x.game,'materials','stone.dds'),copy);
  const sha=require('node:crypto').createHash('sha256').update('pristine').digest('hex');
  const modhash=require('node:crypto').createHash('sha256').update('mod').digest('hex');
  fs.writeFileSync(x.manager.journal,JSON.stringify({mode:'enable',modId:m.id,game:x.game,tx:snap,changes:[{
    rel:'materials/stone.dds',wasPresent:true,previousHash:sha,modHash:modhash,expectedHash:modhash,snapshot:copy,backup:null
  }]}));
  x.asset('materials/stone.dds','mod',x.game);
  assert.equal(x.manager.status(x.game).needsRepair,true);
  assert.throws(()=>x.manager.setEnabled(m.id,true,x.game),/Unfinished/);
  assert.equal(x.manager.repair(x.game).repaired,1);
  assert.equal(fs.readFileSync(path.join(x.game,'materials','stone.dds'),'utf8'),'pristine');
 }finally{x.clean();}
});
