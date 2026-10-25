'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const lib = require('../logic.cjs');
const project = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(project,p), 'utf8');
const vars = args => args[args.indexOf('-Set')+1].split(/,(?=[A-Za-z_][A-Za-z0-9_]*=)/);

function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(), 'kyty-distance-tess-'));
  const game=path.join(root,'game');
  fs.mkdirSync(path.join(game,'sce_sys'),{recursive:true});
  fs.writeFileSync(path.join(game,'eboot.bin'),'not executed');
  fs.mkdirSync(path.join(root,'_Build','latest','native-build'),{recursive:true});
  fs.writeFileSync(path.join(root,'_Build','latest','native-build','kyty_emulator.exe'),'not executed');
  return {root,game};
}

test('distance tessellation defaults to Original and invalid values fail closed', () => {
  assert.equal(lib.clean({}).distance_tessellation, 'original');
  for (const value of ['', 'Early', 'aggressive', 'early;ANY=1', 1, null]) {
    assert.equal(lib.clean({distance_tessellation:value}).distance_tessellation, 'original');
  }
  assert.equal(lib.clean({distance_tessellation:'early'}).distance_tessellation, 'early');
});
test('distance tessellation persists independently of graphics presets and memory settings', () => {
  const f=fixture();
  try {
    for (const selected of ['original', 'early']) {
      const settings=lib.clean({...lib.defaults, game:f.game, distance_detail:'aggressive',
        distance_tessellation:selected,ram_safety:true,ram16_backing:true,quality:'lowest'});
      const applied=lib.applyPreset(settings,'Performance');
      assert.equal(applied.distance_tessellation,selected);
      assert.equal(applied.distance_detail,'aggressive');
      assert.equal(applied.ram16_backing,true);
      lib.saveSettings(f.root,applied);
      assert.equal(lib.loadSettings(f.root).distance_tessellation,selected);
      const cmd=lib.buildPlayArgs(f.root,applied);
      assert.ok(vars(cmd.args).includes('KYTY_DISTANCE_TESSELLATION='+selected));
      assert.ok(vars(cmd.args).includes('KYTY_DISTANCE_DETAIL=aggressive'));
      assert.ok(vars(cmd.args).includes('KYTY_BACKING_FILE=1'));
      assert.ok(!cmd.args.includes('-Precompile'));
    }
  } finally {fs.rmSync(f.root,{recursive:true,force:true});}
});
test('native intercept is opt-in, exact-version, exact-line, no game writes or shader changes', () => {
  const src=read('src/loader/gameArgs.cpp');
  const policy=read('src/loader/distanceTessellation.h');
  const ui=read('launcher-electron/options.html');
  const options=read('launcher-electron/options.js');
  assert.match(src,/std::getenv\("KYTY_DISTANCE_TESSELLATION"\)/);
  assert.match(src,/SystemContentParamSfoGetString\("APP_VER", &version\)/);
  assert.match(src,/DistanceTessellation::BuildAdmitted\(title, version\)/);
  assert.match(src,/DistanceTessellation::RewritePerfConfig\(out, "early"\)/);
  assert.match(src,/DemonsSoulsSuperResolution::Active\(\) \|\| TessellationRequested\(\)/);
  assert.match(src,/std::string out = text/);
  assert.match(policy,/original\.find\(variable, start \+ variable\.size\(\)\)/);
  assert.match(policy,/if \(line != key\) return std::nullopt/);
  assert.match(ui,/id="distance-tessellation"/);
  assert.match(options,/'distance-tessellation':'distance_tessellation'/);
  assert.doesNotMatch(src,/\bopen\([^)]*eboot\.bin/);
});
