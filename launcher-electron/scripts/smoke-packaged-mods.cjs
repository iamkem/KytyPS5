'use strict';
// Executed only as a test with ELECTRON_RUN_AS_NODE=1 inside a packaged launcher.
// Uses synthetic temp files; must not touch the user's real game.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {ModManager}=require('../mod-manager.cjs');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-packaged-mod-'));
 try{
   const game=path.join(root,'synthetic-game'),source=path.join(root,'source-mod');
   fs.mkdirSync(path.join(game,'textures'),{recursive:true});
   fs.mkdirSync(path.join(source,'textures'),{recursive:true});
   fs.writeFileSync(path.join(game,'textures','test.dds'),'original-asset');
   fs.writeFileSync(path.join(source,'textures','test.dds'),'mod-asset');
   const archive=path.join(root,'packed-mod.zip');
   const escaped=p=>"'"+p.replaceAll("'","''")+"'";
   execFileSync('powershell.exe',['-NoProfile','-Command',
    'Compress-Archive -LiteralPath '+escaped(path.join(source,'textures'))+' -DestinationPath '+escaped(archive)+' -Force'],
    {timeout:30000,stdio:'pipe'});
   const manager=new ModManager(root);
   const imported=await manager.importZip(archive,game);
   if(imported.files!==1||manager.status(game).mods[0].enabled)throw Error('Mod import failed');
   manager.setEnabled(imported.id,true,game);
   if(fs.readFileSync(path.join(game,'textures','test.dds'),'utf8')!=='mod-asset')throw Error('Mod enabling failed');
   manager.setEnabled(imported.id,false,game);
   if(fs.readFileSync(path.join(game,'textures','test.dds'),'utf8')!=='original-asset')throw Error('Restore failed');
   console.log('PACKAGED_MODS_ZIP_IMPORT_ENABLE_RESTORE_PASS');
 }finally{fs.rmSync(root,{recursive:true,force:true,maxRetries:2});}
})().catch(e=>{console.error('PACKAGED_MODS_SMOKE_FAIL '+e.stack);process.exitCode=1;});
