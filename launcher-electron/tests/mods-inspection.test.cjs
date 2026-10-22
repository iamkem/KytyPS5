'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {ModManager}=require('../mod-manager.cjs');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-mod-inspection-'));
 const game=path.join(root,'PPSA01341-app0'),source=path.join(root,'MyMod');
 fs.mkdirSync(game);fs.mkdirSync(source);
 const asset=(rel,value,folder=source)=>{
  const file=path.join(folder,...rel.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,value);return file;
 };
 return {root,game,source,asset,manager:new ModManager(root),clean:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');

test('Read-only inspection distinguishes replacements, additions and identical assets',async()=>{
 const x=fixture();try{
  x.asset('textures/replace.dds','original',x.game);
  x.asset('ui/identical.ctxr','same',x.game);
  x.asset('textures/replace.dds','replacement');
  x.asset('ui/identical.ctxr','same');
  x.asset('characters/new.dcx','added');
  const mod=await x.manager.importFolder(x.source,'Example',x.game);
  const preview=x.manager.inspect(mod.id,x.game);
  assert.equal(preview.ready,true);
  assert.deepEqual([preview.summary.replace,preview.summary.add,preview.summary.identical],[1,1,1]);
  assert.equal(x.manager.status(x.game).appliedCount,0);
  assert.equal(fs.readFileSync(path.join(x.game,'textures','replace.dds'),'utf8'),'original');
  assert.equal(fs.existsSync(path.join(x.game,'characters','new.dcx')),false);
  x.manager.setEnabled(mod.id,true,x.game);
  const active=x.manager.inspect(mod.id,x.game);
  assert.equal(active.summary.restore,2);
  assert.equal(active.summary.remove,1);
  x.manager.setEnabled(mod.id,false,x.game);
 }finally{x.clean();}
});

test('Read-only inspection flags conflicts and tampered packages before installation',async()=>{
 const x=fixture();try{
  x.asset('text/ds/_cmn/ui.en.ctxt','first');
  const first=await x.manager.importFolder(x.source,'First',x.game);
  const secondDir=path.join(x.root,'Second');fs.mkdirSync(secondDir);
  x.asset('text/ds/_cmn/ui.en.ctxt','second',secondDir);
  const second=await x.manager.importFolder(secondDir,'Second',x.game);
  x.manager.setEnabled(first.id,true,x.game);
  const conflict=x.manager.inspect(second.id,x.game);
  assert.equal(conflict.ready,false);
  assert.equal(conflict.summary.conflict,1);
  assert.equal(fs.readFileSync(path.join(x.game,'text','ds','_cmn','ui.en.ctxt'),'utf8'),'first');
  x.manager.setEnabled(first.id,false,x.game);
  x.asset('text/ds/_cmn/ui.en.ctxt','tampered',path.join(x.root,'_Mods','packages',second.id));
  const tampered=x.manager.inspect(second.id,x.game);
  assert.equal(tampered.ready,false);
  assert.equal(tampered.summary.invalid,1);
  assert.throws(()=>x.manager.setEnabled(second.id,true,x.game),/package missing or edited/i);
  assert.equal(fs.existsSync(path.join(x.game,'text','ds','_cmn','ui.en.ctxt')),false);
 }finally{x.clean();}
});

test('Interrupted disable recovery tolerates already-restored original but refuses external edits',async()=>{
 const x=fixture();try{
  const rel='materials/stone.dds';
  const dest=x.asset(rel,'original',x.game);
  x.asset(rel,'modified');
  const mod=await x.manager.importFolder(x.source,'Stone',x.game);
  x.manager.setEnabled(mod.id,true,x.game);
  const backup=x.manager.load().applied[rel].backup;
  const tx=path.join(x.root,'_Mods','temp','transaction-recovery');
  fs.mkdirSync(tx,{recursive:true});
  const snapshot=path.join(tx,'0.original');
  fs.copyFileSync(dest,snapshot);
  const journal={mode:'disable',modId:mod.id,game:x.game,tx,changes:[{
   rel,wasPresent:true,previousHash:sha('modified'),modHash:sha('modified'),
   expectedHash:sha('original'),snapshot,backup
  }]};
  fs.writeFileSync(x.manager.journal,JSON.stringify(journal));
  x.asset(rel,'original',x.game); // Simulate file already restored before crash.
  assert.equal(x.manager.repair(x.game).repaired,1);
  assert.equal(fs.readFileSync(dest,'utf8'),'modified');
  assert.equal(x.manager.status(x.game).needsRepair,false);
  assert.equal(x.manager.load().mods[0].enabled,true);
  fs.writeFileSync(x.manager.journal,JSON.stringify(journal));
  x.asset(rel,'external-edit',x.game);
  assert.throws(()=>x.manager.repair(x.game),/Unexpected edits/);
  assert.equal(fs.readFileSync(dest,'utf8'),'external-edit');
 }finally{x.clean();}
});
