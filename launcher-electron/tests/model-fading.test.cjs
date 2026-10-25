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
  const index = args.indexOf('-Set');
  return index < 0 ? [] : args[index+1].split(/,(?=[A-Za-z_][A-Za-z0-9_]*=)/);
};
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(),'kyty-model-fading-'));
  const game = path.join(home,'game');
  const exe = path.join(home,'_Build','latest','native-build','kyty_emulator.exe');
  fs.mkdirSync(game,{recursive:true});
  fs.mkdirSync(path.dirname(exe),{recursive:true});
  fs.writeFileSync(path.join(game,'eboot.bin'),'fixture not executable');
  fs.writeFileSync(exe,'fixture not executable');
  return {home,game};
}
test('Original is default, unknown/unsafe model fading strings fail closed',()=>{
  assert.equal(lib.clean({}).model_fading,'original');
  for(const invalid of ['', 'Model','combined;something=1',null,1,'0','true','MODEL'])
    assert.equal(lib.clean({model_fading:invalid}).model_fading,'original');
  for(const mode of ['original','model','instance','combined'])
    assert.equal(lib.clean({model_fading:mode}).model_fading,mode);
});
test('modes survive JSON roundtrip and presets; affect only -Set and never launch a game',()=>{
  const f = fixture();
  try {
    for(const mode of ['original','model','instance','combined']) {
      const current=lib.clean({...lib.defaults,game:f.game,model_fading:mode,
        distance_tessellation:'early',distance_detail:'aggressive',ram16_backing:true,
        ram_safety:true,quality:'lowest'});
      const preset=lib.applyPreset(current,'Performance');
      assert.equal(preset.model_fading,mode);
      assert.equal(preset.distance_tessellation,'early');
      assert.equal(preset.distance_detail,'aggressive');
      assert.equal(preset.ram_safety,true);
      lib.saveSettings(f.home,preset);
      assert.equal(lib.loadSettings(f.home).model_fading,mode);
      const spec = lib.buildPlayArgs(f.home,preset);
      assert.ok(envVars(spec.args).includes('KYTY_MODEL_FADING='+mode));
      assert.ok(envVars(spec.args).includes('KYTY_DISTANCE_TESSELLATION=early'));
      assert.ok(envVars(spec.args).includes('KYTY_DISTANCE_DETAIL=aggressive'));
      assert.ok(envVars(spec.args).includes('KYTY_BACKING_FILE=1'));
      assert.ok(!spec.args.includes('-Precompile'));
    }
  } finally {fs.rmSync(f.home,{force:true,recursive:true});}
});
test('only audited game version is admitted; no host-side culling or file patching',()=>{
  const native=source('src/loader/gameArgs.cpp');
  const policy=source('src/loader/modelFading.h');
  const view=source('launcher-electron/options.html');
  const ui=source('launcher-electron/options.js');
  assert.match(native,/std::getenv\("KYTY_MODEL_FADING"\)/);
  assert.match(native,/ModelFading::Convars\(model_fading\)/);
  assert.match(native,/ModelFading::BuildAdmitted\(title, version\)/);
  assert.match(native,/SystemContentParamSfoGetString\("APP_VER", &version\)/);
  assert.ok(native.indexOf('if (value != nullptr) add(value);') < native.indexOf('std::getenv("KYTY_MODEL_FADING")'));
  assert.match(policy,/title == "PPSA01341" && version == "01.007.000"/);
  assert.match(policy,/r_ModelFadeOutOverrideEnable=true;r_ModelFadeOutStartOverride=100\.0/);
  assert.match(policy,/r_fadeOutInstanceOverDistance=0\.75/);
  assert.match(policy,/return \{\};/);
  assert.match(view,/id="model-fading"/);
  assert.match(ui,/'model-fading':'model_fading'/);
  assert.doesNotMatch(native,/(?:std::ofstream|memcpy|DiscardVirtualMemory).*eboot\.bin/);
});
