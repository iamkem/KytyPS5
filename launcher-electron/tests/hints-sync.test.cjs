'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');

const helper=path.resolve(__dirname,'..','..','tools','local','static-precompile','sync-release-hints.ps1');
const game='PPSA01341_01.007.000',name='hints-'+game+'.hints';
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
function response(data,{badSha=false}={}){
 const raw=Buffer.from(data);
 return {name,path:'tools/local/static-precompile/'+name,encoding:'base64',type:'file',
  size:raw.length,sha:badSha?'0'.repeat(40):crypto.createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex'),
  content:raw.toString('base64')};
}
function exercise(root,model,offline=false){
 const responseValue=JSON.stringify(model);
 const code=[
  '. '+quote(helper),
  '$script:mock=ConvertFrom-Json '+quote(responseValue),
  "function Invoke-RestMethod { param($Uri,$TimeoutSec,$ErrorAction,$Headers) "+
   (offline?"throw 'offline'":"return $script:mock")+" }",
  'Sync-KytyReleasedHints '+quote(root)+' '+quote(game)
 ].join('; ');
 const run=spawnSync('powershell.exe',['-NoProfile','-Command',code],{encoding:'utf8',timeout:30000,windowsHide:true});
 assert.equal(run.status,0,run.stderr||run.stdout);
 return run.stdout;
}
test('Update Missing Shaders validates versioned upstream hints, keeps backup and survives offline/tampering',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-hints-sync-'));
 const file=path.join(root,'tools','local','static-precompile',name);
 const old=Buffer.from('Old specialization recipes '.repeat(5));
 const latest=Buffer.from('New specialization recipes '.repeat(5));
 try{
  assert.match(exercise(root,response(old)),/UPDATED/);
  assert.deepEqual(fs.readFileSync(file),old);
  assert.match(exercise(root,response(old)),/already installed/);
  assert.match(exercise(root,response(latest)),/UPDATED/);
  assert.deepEqual(fs.readFileSync(file),latest);
  assert.deepEqual(fs.readFileSync(file+'.backup-before-sync'),old);
  assert.match(exercise(root,response(old,{badSha:true})),/keeping installed hints/);
  assert.deepEqual(fs.readFileSync(file),latest);
  assert.match(exercise(root,response(old),true),/continuing offline/);
  assert.deepEqual(fs.readFileSync(file),latest);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Incremental runner checks remote hints BEFORE native status and never auto-refreshes installed base seeds',()=>{
 const runner=fs.readFileSync(path.resolve(__dirname,'..','..','precompile-windows.ps1'),'utf8');
 assert.ok(runner.indexOf('Sync-KytyReleasedHints $PSScriptRoot $gameId')>=0);
 assert.ok(runner.indexOf('Sync-KytyReleasedHints $PSScriptRoot $gameId')<runner.indexOf('$inspection = @(& $Exe --game'));
 assert.match(runner,/\$remake = \$RefreshSeeds -and \(Test-Path \$Seeds\)/);
});
