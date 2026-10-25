'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const lib=require('../logic.cjs');const root=path.resolve(__dirname,'../..');
const vars=args=>args[args.indexOf('-Set')+1].split(/,(?=[A-Z_][A-Z0-9_]*=)/);
function fixture() {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-ssr-'));const game=path.join(dir,'game');fs.mkdirSync(path.join(game,'sce_sys'),{recursive:true});fs.writeFileSync(path.join(game,'eboot.bin'),'fixture');fs.mkdirSync(path.join(dir,'_Build/latest/native-build'),{recursive:true});fs.writeFileSync(path.join(dir,'_Build/latest/native-build/kyty_emulator.exe'),'fixture');return {dir,game};}
test('SSR test defaults off, invalid settings fail closed and preset preserves choice',()=>{
 assert.equal(lib.clean({}).ssr_test,'original');
 for(const v of ['ssr64','64',null,5,'iterations64;foo=1']) assert.equal(lib.clean({ssr_test:v}).ssr_test,'original');
 const f=fixture();try{const s=lib.clean({...lib.defaults,ssr_test:'iterations64',game:f.game});assert.equal(lib.applyPreset(s,'Performance').ssr_test,'iterations64');lib.saveSettings(f.dir,s);assert.equal(lib.loadSettings(f.dir).ssr_test,'iterations64');}finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('launcher passes only a gated runner flag and preserves original settings',()=>{
 const f=fixture();try{for(const quality of ['lowest','low','standard']){
 const s={...lib.defaults,game:f.game,quality,ssr_test:'original',upscaler:'',ram_safety:true,distance_tessellation:'early'};
 const off=lib.buildPlayArgs(f.dir,s),on=lib.buildPlayArgs(f.dir,{...s,ssr_test:'iterations64'});
 const offVars=vars(off.args),onVars=vars(on.args);
 assert.ok(offVars.includes('KYTY_SSR_TEST=off'));assert.ok(onVars.includes('KYTY_SSR_TEST=ssr64'));
 assert.ok(!onVars.some(x=>x.startsWith('KYTY_GAME_CONVARS=')));
 assert.equal(on.args.includes('-Quality'),quality!=='standard');
 assert.ok(onVars.includes('KYTY_DISTANCE_TESSELLATION=early'));
 assert.ok(onVars.includes('KYTY_ADAPTIVE_RAM=1'));
 assert.ok(!on.args.includes('-Precompile'));assert.ok(!on.args.includes('-Patch'));
 }}finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('runner verifies title/version, appends after Quality, and respects convar opt-out',()=>{
 const runner=fs.readFileSync(path.join(root,'run-windows.ps1'),'utf8');
 assert.match(runner,/\$environment\['KYTY_SSR_TEST'\] -eq 'ssr64'/);
 assert.match(runner,/\$titleId -eq 'PPSA01341'/);
 assert.match(runner,/01\.007\.000/);
 assert.match(runner,/\$environment\['KYTY_GAME_CONVARS'\], 'r_ssrEnableOverrides=true;r_ssrMaxIterations=64'/);
 assert.match(runner,/\$\(\$environment\['KYTY_GAME_CONVARS'\]\)" -ne '0'/);
 assert.ok(runner.indexOf("$environment['KYTY_SSR_TEST'] -eq 'ssr64'")>runner.indexOf('foreach ($pair in ($Set'));
});
test('options exposes SSR switch exactly once',()=>{
 const html=fs.readFileSync(path.join(root,'launcher-electron/options.html'),'utf8');
 const js=fs.readFileSync(path.join(root,'launcher-electron/options.js'),'utf8');
 assert.equal((html.match(/id="ssr-test"/g)||[]).length,1);
 assert.match(html,/value="iterations64"/);
 assert.match(js,/'ssr-test':'ssr_test'/);
});

test('real Windows runner DryRun appends SSR only for v1.07 without losing Lowest', {skip:process.platform!=='win32'},()=>{
 const {spawnSync}=require('node:child_process');
 const shell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const f=fixture();
 try {
  fs.writeFileSync(path.join(f.game,'sce_sys','param.json'),JSON.stringify({
   titleId:'PPSA01341',contentVersion:'01.007.000',
   localizedParameters:{defaultLanguage:'en-US','en-US':{titleName:'SSR Fixture'}}
  }));
  fs.copyFileSync(path.join(root,'run-windows.ps1'),path.join(f.dir,'run-windows.ps1'));
  fs.copyFileSync(path.join(root,'run-windows.json'),path.join(f.dir,'run-windows.json'));
  for(const mode of ['original','iterations64']){
   const spec=lib.buildPlayArgs(f.dir,{...lib.defaults,game:f.game,quality:'lowest',
    upscaler:'',ssr_test:mode,ram_safety:true,distance_tessellation:'early'});
   const run=spawnSync(shell,[...spec.args,'-DryRun'],{encoding:'utf8',timeout:30000,windowsHide:true});
   assert.equal(run.status,0,run.stderr||run.stdout);
   assert.match(run.stdout,/r_forceViewportHeightForPixelSizeCalc=480;sunShadowMaxDistance=60/);
   assert.match(run.stdout,/r_enableAmbientShadowing=false;r_enableSpotShadows=false/);
   assert.match(run.stdout,/KYTY_DISTANCE_TESSELLATION=early/);
   if(mode==='iterations64') assert.match(run.stdout,/r_ssrEnableOverrides=true;r_ssrMaxIterations=64/);
   else assert.doesNotMatch(run.stdout,/r_ssrEnableOverrides=true;r_ssrMaxIterations=64/);
  }
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
