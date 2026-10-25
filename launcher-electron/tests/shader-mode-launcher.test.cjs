'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const logic = require('../logic.cjs');
const trial = require('../shader-trial.cjs');

const GAME_ID = 'PPSA01341_01.007.000';
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kyty-shader-mode-'));
  const game = path.join(root, 'game');
  const staticDir = path.join(root,'_Build','shader-feature-trial','_PipelineCache','static');
  const binary = path.join(staticDir, GAME_ID+'.binaries');
  const ready = path.join(staticDir,GAME_ID+'.trial-ready');
  const features = path.join(staticDir,GAME_ID+'.features');
  const exe = logic.findEmulator(root);
  fs.mkdirSync(path.join(game,'sce_sys'), {recursive:true});
  fs.mkdirSync(staticDir,{recursive:true});
  fs.mkdirSync(path.dirname(exe),{recursive:true});
  fs.writeFileSync(path.join(game,'sce_sys','param.json'),JSON.stringify({titleId:'PPSA01341',contentVersion:'01.007.000'}));
  fs.writeFileSync(path.join(game,'eboot.bin'),'fixture');
  fs.writeFileSync(exe,'fixture not executable');
  fs.writeFileSync(logic.findPrecompiler(root),'fixture not executable');
  fs.writeFileSync(ready,'KytyShaderFeatureTrial1 3\n');
  fs.writeFileSync(features,'3 3 e83d291c179fb692\n');
  fs.writeFileSync(binary,Buffer.alloc(8192));
  return {root,game,staticDir,binary,ready,features,exe,
    cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function snapshot(f) {
  return [f.binary,f.ready,f.features].map(p=>({
    file:path.relative(f.root,p),data:fs.readFileSync(p).toString('base64'),
    modified:fs.statSync(p).mtimeMs
  }));
}

test('mode defaults Standard and persisted Experimental survives reload without altering unrelated settings',()=>{
  const f=fixture();
  try{
    const legacy=logic.clean({quality:'low',ram16_backing:false});
    assert.equal(legacy.shader_mode,'standard');
    assert.equal(logic.clean({shader_mode:'invalid'}).shader_mode,'standard');
    const original=snapshot(f);
    const saved=logic.saveSettings(f.root,{...legacy,shader_mode:'experimental'});
    assert.equal(saved.shader_mode,'experimental');
    assert.equal(logic.loadSettings(f.root).shader_mode,'experimental');
    assert.equal(logic.loadSettings(f.root).ram16_backing,false);
    assert.equal(logic.applyPreset(saved,'Performance').shader_mode,'experimental');
    logic.saveSettings(f.root,{...saved,shader_mode:'standard'});
    assert.equal(logic.loadSettings(f.root).shader_mode,'standard');
    assert.deepEqual(snapshot(f),original,'mode changes must not modify either shader payload or its stamp');
  } finally {f.cleanup();}
});

test('trial readiness uses only isolated 0x3 metadata and an explicit capability handshake',()=>{
  const f=fixture();let calls=0;
  try{
    const probe=exe=>{calls++;assert.equal(exe,f.exe);return true;};
    assert.equal(trial.inspect(f.root,f.game,f.exe,{probe}).ready,true);
    assert.equal(calls,1);
    const snapshotBefore=snapshot(f);
    assert.deepEqual(snapshot(f),snapshotBefore,'metadata inspection is read-only');
    fs.writeFileSync(f.features,'0 3 e83d291c179fb692\n');
    assert.match(trial.inspect(f.root,f.game,f.exe,{probe}).reason,/stamp|marker/i);
    assert.equal(calls,1,'invalid metadata must stop before probing executable');
    fs.writeFileSync(f.features,'3 3 e83d291c179fb692\n');
    fs.writeFileSync(f.ready,'incomplete\n');
    assert.equal(trial.inspect(f.root,f.game,f.exe,{probe}).ready,false);
    fs.writeFileSync(f.ready,'KytyShaderFeatureTrial1 3\n');
    fs.writeFileSync(path.join(f.staticDir,GAME_ID+'.resume-required'),'pending');
    assert.equal(trial.inspect(f.root,f.game,f.exe,{probe}).ready,false);
    fs.unlinkSync(path.join(f.staticDir,GAME_ID+'.resume-required'));
    assert.equal(trial.inspect(f.root,f.game,f.exe,{probe:()=>false}).ready,false);
    assert.equal(trial.inspect(f.root,f.game,f.exe,{probe}).ready,true);
    fs.rmSync(f.binary);
    assert.equal(trial.inspect(f.root,f.game,f.exe,{probe}).ready,false);
  }finally{f.cleanup();}
});

test('Play arguments use -ShaderFeatureTrial once only for a ready experimental generation',()=>{
  const f=fixture();
  try{
    const base={...logic.defaults,game:f.game,upscaler:'',quality:'standard',shader_mode:'standard'};
    const regular=logic.buildPlayArgs(f.root,base);
    assert.equal(regular.args.includes('-ShaderFeatureTrial'),false);
    const experimental=logic.buildPlayArgs(f.root,{...base,shader_mode:'experimental'},{
      inspectTrial:()=>({ready:true})
    });
    assert.equal(experimental.args.filter(x=>x==='-ShaderFeatureTrial').length,1);
    const vars=experimental.args[experimental.args.indexOf('-Set')+1];
    assert.doesNotMatch(vars,/KYTY_SHADER_FEATURE_TRIAL/);
    assert.equal(experimental.args[experimental.args.indexOf('-Exe')+1],f.exe);
    assert.equal(experimental.args[experimental.args.indexOf('-Game')+1],f.game);
    assert.throws(()=>logic.buildPlayArgs(f.root,{...base,shader_mode:'experimental'},
      {inspectTrial:()=>({ready:false,reason:'not prepared'})}), error=>
      error.code==='SHADER_TRIAL_NOT_READY' && /not prepared/.test(error.message));
    assert.equal(logic.buildPlayArgs(f.root,{...base,shader_mode:'unknown'}).args.includes('-ShaderFeatureTrial'),false);
    assert.equal(logic.buildPrecompileArgs(f.root,{...base,shader_mode:'experimental'}).args.includes('-Incremental'),true);
  }finally{f.cleanup();}
});

test('UI is wired and normal shader updates are blocked while experimental is selected',()=>{
 const html=fs.readFileSync(path.join(__dirname,'..','options.html'),'utf8');
 const js=fs.readFileSync(path.join(__dirname,'..','options.js'),'utf8');
 const main=fs.readFileSync(path.join(__dirname,'..','main.cjs'),'utf8');
 const preload=fs.readFileSync(path.join(__dirname,'..','preload.cjs'),'utf8');
 assert.match(html,/<select id="shader-mode"/);
 assert.match(html,/id="shader-mode-restore"/);
 assert.match(js,/'shader-mode':'shader_mode'/);
 assert.match(js,/state\.shader_mode='standard'/);
 assert.match(js,/window\.launcher\.shaderTrialStatus/);
 assert.match(main,/launcher:shader-trial-status/);
 assert.match(preload,/shaderTrialStatus/);
 assert.match(main,/buttons:\['Use Standard & Play','Cancel'\]/);
 assert.match(main,/Update Missing Shaders updates Standard only/);
});
