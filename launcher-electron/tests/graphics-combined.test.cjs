'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const lib=require('../logic.cjs');
const project=path.resolve(__dirname,'..','..');
const win=process.platform==='win32';
const ps=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
function fixture(version='01.007.000',title='PPSA01341'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-graphics-combined-'));
 const game=path.join(root,'game');
 fs.mkdirSync(path.join(game,'sce_sys'),{recursive:true});
 fs.writeFileSync(path.join(game,'eboot.bin'),'no execution');
 fs.writeFileSync(path.join(game,'sce_sys','param.json'),JSON.stringify({titleId:title,contentVersion:version,
  localizedParameters:{defaultLanguage:'en-US','en-US':{titleName:'Fixture'}}}));
 fs.mkdirSync(path.join(root,'_Build','latest','native-build'),{recursive:true});
 fs.writeFileSync(path.join(root,'_Build','latest','native-build','kyty_emulator.exe'),'not executable');
 if(win){
  fs.copyFileSync(path.join(project,'run-windows.ps1'),path.join(root,'run-windows.ps1'));
  fs.copyFileSync(path.join(project,'run-windows.json'),path.join(root,'run-windows.json'));
 }
 return {root,game,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function settings(f,more={}){
 return {...lib.defaults,game:f.game,quality:'lowest',ssr_test:'original',upscaler:'',ram_safety:true,
  ram16_backing:true,distance_tessellation:'early',distance_detail:'aggressive',...more};
}
function variables(args){return args[args.indexOf('-Set')+1].split(/,(?=[A-Za-z_][A-Za-z0-9_]*=)/);}
function dry(f,s,extra=[]){
 const spec=lib.buildPlayArgs(f.root,s);
 const args=[...spec.args];
 // The runner has one -Set parameter; append another environment entry to its list.
 if(extra[0]==='-Set')args[args.indexOf('-Set')+1]+=','+extra[1];
 const proc=spawnSync(ps,[...args,'-DryRun'],{encoding:'utf8',timeout:30000,windowsHide:true});
 assert.equal(proc.status,0,proc.stderr||proc.stdout);
 return proc.stdout;
}
test('Combined opt-in is default-OFF, input bounded, and persists without editing other settings',()=>{
 assert.equal(lib.clean({}).ssr_test,'original');
 for(const invalid of ['Combined','combined;evil=1',false,1,null])assert.equal(lib.clean({ssr_test:invalid}).ssr_test,'original');
 const f=fixture();try{
  const s=lib.clean(settings(f,{ssr_test:'combined',render_dlss:720,ram_safety:true,framegen:0}));
  assert.equal(lib.applyPreset(s,'Quality').ssr_test,'combined');
  assert.equal(lib.applyPreset(s,'Quality').ram_safety,true);
  lib.saveSettings(f.root,s);
  const got=lib.loadSettings(f.root);
  assert.equal(got.ssr_test,'combined');assert.equal(got.distance_tessellation,'early');
  assert.equal(got.render_dlss,720);
 }finally{f.close();}
});
test('Combined launches through existing runner with only one toggle and no destructive options',()=>{
 const f=fixture();try{
  const off=lib.buildPlayArgs(f.root,settings(f));
  const on=lib.buildPlayArgs(f.root,settings(f,{ssr_test:'combined'}));
  const solo=lib.buildPlayArgs(f.root,settings(f,{ssr_test:'iterations64'}));
  assert.ok(variables(off.args).includes('KYTY_SSR_TEST=off'));
  assert.ok(variables(on.args).includes('KYTY_SSR_TEST=combined'));
  assert.ok(variables(solo.args).includes('KYTY_SSR_TEST=ssr64'));
  assert.ok(variables(on.args).includes('KYTY_BACKING_FILE=1'));
  assert.ok(variables(on.args).includes('KYTY_DISTANCE_DETAIL=aggressive'));
  assert.ok(!on.args.some(x=>/^-Precompile$|^-Patch$/.test(x)));
  assert.ok(on.args.includes('-Quality'));
  assert.ok(!variables(on.args).some(x=>x.startsWith('KYTY_GAME_CONVARS=')));
 }finally{f.close();}
});
test('Launcher has one three-way graphics test control and no implicit preset changes',()=>{
 const html=fs.readFileSync(path.join(project,'launcher-electron','options.html'),'utf8');
 const js=fs.readFileSync(path.join(project,'launcher-electron','options.js'),'utf8');
 assert.equal((html.match(/id="ssr-test"/g)||[]).length,1);
 assert.match(html,/value="combined"/);
 assert.match(html,/value="iterations64"/);
 assert.match(js,/'ssr-test':'ssr_test'/);
 assert.doesNotMatch(html,/value="combined".*selected/);
});
test('Actual PowerShell DryRun: one Combined A/B, prior SSR and Quality unaffected', {skip:!win},()=>{
 const f=fixture();try{
  const off=dry(f,settings(f));
  const combined=dry(f,settings(f,{ssr_test:'combined'}));
  const ssrOnly=dry(f,settings(f,{ssr_test:'iterations64'}));
  for(const output of [off,combined,ssrOnly]){
   assert.match(output,/r_forceViewportHeightForPixelSizeCalc=480;sunShadowMaxDistance=60/);
   assert.match(output,/r_enableAmbientShadowing=false;r_enableSpotShadows=false/);
   assert.match(output,/KYTY_DISTANCE_TESSELLATION=early/);
   assert.match(output,/KYTY_ADAPTIVE_RAM=1/);
  }
  assert.doesNotMatch(off,/r_ssrEnableOverrides=true/);
  assert.match(combined,/r_ssrEnableOverrides=true;r_ssrMaxIterations=64;r_ssrMaxRayLength=600\.0;particleRibbonTessDensity=0\.5;r_contactShadowsEnabled=false/);
  assert.match(ssrOnly,/r_ssrEnableOverrides=true;r_ssrMaxIterations=64/);
  assert.doesNotMatch(ssrOnly,/particleRibbonTessDensity=0\.5/);
  assert.doesNotMatch(ssrOnly,/r_contactShadowsEnabled=false/);
 }finally{f.close();}
});
test('Runner rejects foreign versions and honors explicit convar opt-out', {skip:!win},()=>{
 const foreign=fixture('01.005.000','PPSA01341');
 try{
  const out=dry(foreign,settings(foreign,{ssr_test:'combined'}));
  assert.match(out,/KYTY_SSR_TEST=combined/);
  assert.doesNotMatch(out,/r_ssrEnableOverrides=true/);
  assert.doesNotMatch(out,/particleRibbonTessDensity=0\.5/);
 }finally{foreign.close();}
 const f=fixture();try{
  const opts=lib.buildPlayArgs(f.root,settings(f,{ssr_test:'combined'}));
  const raw=dry(f,settings(f,{ssr_test:'combined'}),['-Set','KYTY_GAME_CONVARS=0']);
  assert.match(raw,/KYTY_GAME_CONVARS=0/);
  assert.doesNotMatch(raw,/r_ssrEnableOverrides=true/);
  assert.ok(opts.args.includes('-Quality'));
 }finally{f.close();}
});
