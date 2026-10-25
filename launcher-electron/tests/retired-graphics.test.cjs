'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const lib=require('../logic.cjs');
const project=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(project,p),'utf8');
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-retired-graphics-'));
  const game=path.join(root,'game');
  fs.mkdirSync(path.join(game,'sce_sys'),{recursive:true});
  fs.writeFileSync(path.join(game,'eboot.bin'),'fixture never executed');
  fs.writeFileSync(path.join(game,'sce_sys','param.json'),JSON.stringify({titleId:'PPSA01341',contentVersion:'01.007.000'}));
  fs.mkdirSync(path.join(root,'_Build/latest/native-build'),{recursive:true});
  fs.writeFileSync(path.join(root,'_Build/latest/native-build/kyty_emulator.exe'),'fixture never executed');
  fs.copyFileSync(path.join(project,'run-windows.ps1'),path.join(root,'run-windows.ps1'));
  fs.copyFileSync(path.join(project,'run-windows.json'),path.join(root,'run-windows.json'));
  return {root,game,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('retired SSR, Combined, Density and Model/Instance fields are rejected on load/save',()=>{
 const f=fixture();
 try{
  const input={...lib.defaults,game:f.game,quality:'lowest',distance_tessellation:'early',
    ram_safety:true,ram16_backing:true,ssr_test:'combined',model_fading:'combined',
    graphics_audit_density:'ps4base',engine_culling:'combined',occlusion_audit:true};
  const cleaned=lib.clean(input);
  for(const k of ['ssr_test','model_fading','graphics_audit_density','engine_culling','occlusion_audit'])assert.equal(Object.hasOwn(cleaned,k),false,k);
  lib.saveSettings(f.root,input);
  const saved=fs.readFileSync(path.join(f.root,'launcher-settings.json'),'utf8');
  for(const k of ['ssr_test','model_fading','graphics_audit_density','engine_culling','occlusion_audit'])assert.doesNotMatch(saved,new RegExp(k),k);
  const cmd=lib.buildPlayArgs(f.root,lib.loadSettings(f.root));
  const vars=cmd.args[cmd.args.indexOf('-Set')+1];
  assert.doesNotMatch(vars,/KYTY_SSR_TEST|KYTY_MODEL_FADING|KYTY_GRAPHICS_AUDIT_DENSITY|KYTY_ENGINE_CULLING|KYTY_OCCLUSION_AUDIT/);
  assert.match(vars,/KYTY_ADAPTIVE_RAM=1/);
  assert.match(vars,/KYTY_DISTANCE_TESSELLATION=early/);
  assert.ok(cmd.args.includes('-Quality'));
 } finally {f.close();}
});
test('no graphics probe switch remains in launcher or game runner',()=>{
 const ui=read('launcher-electron/options.html'),client=read('launcher-electron/options.js');
 const logic=read('launcher-electron/logic.cjs'),runner=read('run-windows.ps1'),native=read('src/loader/gameArgs.cpp');
 assert.doesNotMatch(ui,/id="ssr-test"|Graphics Performance Test|SSR Iterations|graphics-audit-density|model-fading/);
 assert.doesNotMatch(client,/ssr_test|ssr-test|model_fading|graphics_audit_density/);
 assert.doesNotMatch(logic,/ssr_test|KYTY_SSR_TEST|model_fading|KYTY_MODEL_FADING|graphics_audit_density/);
 assert.doesNotMatch(runner,/KYTY_SSR_TEST|particleRibbonTessDensity|r_ssrMaxRayLength|r_ssrMaxIterations/);
 assert.doesNotMatch(native,/KYTY_GRAPHICS_AUDIT_DENSITY|KYTY_MODEL_FADING|KYTY_ENGINE_CULLING/);
});
test('real runner DryRun ignores even stale inherited SSR_TEST environment without running a game', {skip:process.platform!=='win32'},()=>{
 const f=fixture();
 try{
  const cfg={...lib.defaults,game:f.game,quality:'lowest',distance_tessellation:'early',
    upscaler:'',ram_safety:true,ram16_backing:true,ssr_test:'combined'};
  const cmd=lib.buildPlayArgs(f.root,cfg);
  const shell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const run=spawnSync(shell,[...cmd.args,'-DryRun'],{encoding:'utf8',timeout:30000,windowsHide:true,
   env:{...process.env,KYTY_SSR_TEST:'combined'}});
  assert.equal(run.status,0,run.stderr||run.stdout);
  assert.match(run.stdout,/r_forceViewportHeightForPixelSizeCalc=480;sunShadowMaxDistance=60/);
  assert.match(run.stdout,/KYTY_DISTANCE_TESSELLATION=early/);
  assert.doesNotMatch(run.stdout,/r_ssrEnableOverrides=true|r_ssrMaxIterations=64|particleRibbonTessDensity=0\.5|r_contactShadowsEnabled=false/);
 } finally {f.close();}
});
