'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const lib = require('../logic.cjs');
const project = path.resolve(__dirname, '..', '..');

function makeFixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kyty-distance-detail-'));
  const game = path.join(home, 'game');
  const exe = path.join(home, '_Build', 'latest', 'native-build', 'kyty_emulator.exe');
  fs.mkdirSync(path.join(game, 'sce_sys'), {recursive:true});
  fs.mkdirSync(path.dirname(exe), {recursive:true});
  fs.writeFileSync(path.join(game, 'eboot.bin'), 'fixture only');
  fs.writeFileSync(path.join(game, 'sce_sys', 'param.json'), JSON.stringify({
    titleId: 'PPSA01341', contentVersion: '01.007.000',
    localizedParameters: {defaultLanguage: 'en-US', 'en-US': {titleName: 'Test Fixture'}}
  }));
  fs.writeFileSync(exe, 'fixture only, never executed');
  // Copy runner and launch config to this disposable fixture: PowerShell's
  // historical -Game path saver must not touch the user's actual checkout.
  const runnerRoot = process.env.KYTY_MAIN_RUNNER_ROOT || project;
  fs.copyFileSync(path.join(runnerRoot,'run-windows.ps1'),path.join(home,'run-windows.ps1'));
  fs.copyFileSync(path.join(runnerRoot,'run-windows.json'),path.join(home,'run-windows.json'));
  return {home,game,exe};
}

const envVars=(args)=>{
  const i=args.indexOf('-Set');
  return i>=0 ? args[i+1].split(/,(?=[A-Za-z_][A-Za-z0-9_]*=)/) : [];
};

test('Original is backwards compatible; settings and graphics presets remain independent',()=>{
  assert.equal(lib.clean({}).distance_detail,'original');
  for(const invalid of ['INVALID;KEY=1', 'Balanced', '', null, 99])
    assert.equal(lib.clean({distance_detail:invalid}).distance_detail,'original');
  for(const mode of ['original','balanced','performance','aggressive']) {
    assert.equal(lib.clean({distance_detail:mode}).distance_detail,mode);
    const after=lib.applyPreset({...lib.defaults,distance_detail:mode,ram16_backing:true},'Performance');
    assert.equal(after.distance_detail,mode);
    assert.equal(after.ram16_backing,true);
    assert.equal(lib.activePreset(after),'Performance');
  }
  const f=makeFixture();
  try {
    const base={...lib.defaults,game:f.game,upscaler:'',framegen:0,ram_safety:false,quality:'lowest'};
    const original=lib.buildPlayArgs(f.home,base).args;
    assert.deepEqual(lib.buildPlayArgs(f.home,{...base,distance_detail:'original'}).args,original);
    assert.equal(original.includes('-DistanceDetail'),false);
    assert.ok(envVars(original).includes('KYTY_DISTANCE_DETAIL=original'),
      'Original must clear stale mode from inherited environment or runner config');
    assert.equal(original[original.indexOf('-Quality')+1],'lowest');
    assert.equal(original[original.indexOf('-TextureReduce')+1],'2');
    for(const mode of ['balanced','performance','aggressive']) {
      const args=lib.buildPlayArgs(f.home,{...base,distance_detail:mode}).args;
      assert.equal(args.includes('-DistanceDetail'),false,'works with unchanged main run-windows.ps1');
      assert.ok(envVars(args).includes('KYTY_DISTANCE_DETAIL='+mode));
      assert.equal(args[args.indexOf('-Quality')+1],'lowest','nearby lighting retains Graphics Detail setting');
      assert.equal(args[args.indexOf('-TextureReduce')+1],'2','retain texture/VRAM budget');
      assert.equal(args[args.indexOf('-RenderHeight')+1],original[original.indexOf('-RenderHeight')+1]);
      assert.ok(envVars(args).includes('KYTY_TEXTURE_OFFLOAD=0'));
    }
  } finally {fs.rmSync(f.home,{recursive:true,force:true});}
});

test('Distance Detail JSON round-trips with unrelated RAM/shader settings intact',()=>{
  const f=makeFixture();
  try {
    const before=lib.clean({...lib.defaults,ram_diet:true,ram16_backing:true,ram_safety:false,
      quality:'lowest',render_dlss:1080,framegen:2,discord_presence:true,distance_detail:'balanced'});
    lib.saveSettings(f.home,before);
    assert.deepEqual(lib.loadSettings(f.home),before);
    assert.equal(lib.loadSettings(f.home).distance_detail,'balanced');
  } finally {fs.rmSync(f.home,{recursive:true,force:true});}
});

test('Existing PowerShell runner accepts Distance Detail via -Set and preserves quality convars', {skip:process.platform!=='win32'},()=>{
  const f=makeFixture();
  const powershell=path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  try {
    // A stale environment entry from the runner must lose to the launcher's
    // explicit Original choice; mutate only the disposable copied config.
    const config=path.join(f.home,'run-windows.json');
    const launch=JSON.parse(fs.readFileSync(config,'utf8'));
    launch.environment.KYTY_DISTANCE_DETAIL='aggressive';
    fs.writeFileSync(config,JSON.stringify(launch));
    for(const mode of ['original','balanced','performance','aggressive']) {
      const settings={...lib.defaults,game:f.game,upscaler:'',framegen:0,quality:'lowest',distance_detail:mode};
      const spec=lib.buildPlayArgs(f.home,settings);
      const result=spawnSync(powershell,[...spec.args,'-DryRun'],{encoding:'utf8',timeout:30000,windowsHide:true});
      assert.equal(result.status,0,`PowerShell DryRun ${mode}: ${result.stderr||result.error?.message||result.stdout}`);
      assert.match(result.stdout,/KYTY_GAME_CONVARS=.*r_forceViewportHeightForPixelSizeCalc=480;sunShadowMaxDistance=60/);
      assert.match(result.stdout,/r_enableAmbientShadowing=false;r_enableSpotShadows=false/);
      assert.match(result.stdout,new RegExp('KYTY_DISTANCE_DETAIL='+mode+'(?:\\r?\\n|$)'),
        'latest explicit selection must replace a stale runner config');
    }
  } finally {fs.rmSync(f.home,{recursive:true,force:true});}
});

test('Native applies distance convars after other settings for Demons Souls only',()=>{
  const native=fs.readFileSync(path.join(project,'src','loader','gameArgs.cpp'),'utf8');
  const policy=fs.readFileSync(path.join(project,'src','loader','distanceDetail.h'),'utf8');
  const runner=fs.readFileSync(path.join(project,'run-windows.ps1'),'utf8');
  const view=fs.readFileSync(path.join(project,'launcher-electron','options.html'),'utf8');
  const renderer=fs.readFileSync(path.join(project,'launcher-electron','options.js'),'utf8');
  assert.match(native,/std::getenv\("KYTY_DISTANCE_DETAIL"\)/);
  assert.match(native,/Libs::Graphics::DemonsSouls::IsSupportedGame\(\)/);
  assert.match(native,/DistanceConvars\(distance\)/);
  assert.match(policy,/mode == "balanced"\) return "r_forceViewportHeightForPixelSizeCalc=1080;sunShadowMaxDistance=200"/);
  assert.match(policy,/mode == "performance"\) return "r_forceViewportHeightForPixelSizeCalc=720;sunShadowMaxDistance=125"/);
  assert.match(policy,/mode == "aggressive"\) return "r_forceViewportHeightForPixelSizeCalc=480;sunShadowMaxDistance=60"/);
  assert.ok(native.indexOf('if (value != nullptr) add(value);') < native.indexOf('std::getenv("KYTY_DISTANCE_DETAIL")'));
  assert.match(native,/std::erase_if\(entries,.*held\.first == name/);
  assert.match(native,/if \(value != nullptr && std::string_view\(value\) == "0"\) return std::string\(\);/,
    'explicit KYTY_GAME_CONVARS=0 suppresses every injected game convar');
  assert.doesNotMatch(runner,/\[string\]\$DistanceDetail/,'preserve main runner compatibility');
  assert.match(view,/id="distance-detail"/);
  assert.match(renderer,/'distance-detail':'distance_detail'/);
});
