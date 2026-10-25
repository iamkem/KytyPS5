'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const lib = require('../logic.cjs');
const root = path.resolve(__dirname,'..','..');
const source = p => fs.readFileSync(path.join(root,p),'utf8');
const envVars = args => {
  const index=args.indexOf('-Set');
  return index<0 ? [] : args[index+1].split(/,(?=[A-Za-z_][A-Za-z0-9_]*=)/);
};
function fixture() {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-retired-model-fading-'));
  const game=path.join(home,'game');
  const exe=path.join(home,'_Build','latest','native-build','kyty_emulator.exe');
  fs.mkdirSync(game,{recursive:true});
  fs.mkdirSync(path.dirname(exe),{recursive:true});
  fs.writeFileSync(path.join(game,'eboot.bin'),'test fixture, not executed');
  fs.writeFileSync(exe,'test fixture, not executed');
  return {home,game};
}
test('retired modes absent from launcher schema; old persisted Combined is ignored',()=>{
  assert.ok(!Object.hasOwn(lib.defaults,'model_fading'));
  for (const mode of ['combined','model','instance','original','unexpected']) {
    const cleaned=lib.clean({...lib.defaults,model_fading:mode,distance_tessellation:'early'});
    assert.ok(!Object.hasOwn(cleaned,'model_fading'));
    assert.equal(cleaned.distance_tessellation,'early');
    assert.equal(lib.applyPreset(cleaned,'Performance').distance_tessellation,'early');
  }
});
test('old persisted Combined never reaches PowerShell or native game convars',()=>{
  const f=fixture();
  try {
    lib.saveSettings(f.home,{...lib.defaults,game:f.game,model_fading:'combined',
      distance_detail:'aggressive',distance_tessellation:'early',ram16_backing:true});
    const saved=lib.loadSettings(f.home);
    assert.ok(!Object.hasOwn(saved,'model_fading'));
    const cmd=lib.buildPlayArgs(f.home,saved);
    const vars=envVars(cmd.args);
    assert.ok(!vars.some(x=>x.startsWith('KYTY_MODEL_FADING=')));
    assert.ok(vars.includes('KYTY_DISTANCE_TESSELLATION=early'));
    assert.ok(vars.includes('KYTY_DISTANCE_DETAIL=aggressive'));
    assert.ok(vars.includes('KYTY_BACKING_FILE=1'));
    assert.ok(!cmd.args.includes('-Precompile'));
  } finally {fs.rmSync(f.home,{force:true,recursive:true});}
});
test('native, UI and dormant C++ policy have no way to reenable unsafe probes',()=>{
  const gameArgs=source('src/loader/gameArgs.cpp');
  const ui=source('launcher-electron/options.html');
  const options=source('launcher-electron/options.js');
  const policy=source('src/loader/modelFading.h');
  const logic=source('launcher-electron/logic.cjs');
  assert.doesNotMatch(gameArgs,/KYTY_MODEL_FADING|ModelFading|r_ModelFadeOutStartOverride|r_fadeOutInstanceOverDistance/);
  assert.doesNotMatch(ui,/id="model-fading"/);
  assert.doesNotMatch(options,/'model-fading':'model_fading'/);
  assert.doesNotMatch(logic,/model_fading|KYTY_MODEL_FADING/);
  assert.doesNotMatch(policy,/r_ModelFadeOutStartOverride|r_fadeOutInstanceOverDistance|r_ModelFadeOutOverrideEnable/);
  assert.match(policy,/constexpr std::string_view Convars\(std::string_view\)\s*\{\s*return \{\};/);
  for(const mode of ['model','instance','combined'])
    assert.match(policy,new RegExp('static_assert\\(Convars\\("'+mode+'"\\)\\.empty\\(\\)\\)'));
});
