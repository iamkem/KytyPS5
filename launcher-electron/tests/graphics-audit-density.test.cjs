'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const lib=require('../logic.cjs');
const root=path.resolve(__dirname,'..','..');
const file=p=>fs.readFileSync(path.join(root,p),'utf8');
const vars=args=>args[args.indexOf('-Set')+1].split(/,(?=[A-Za-z_][A-Za-z0-9_]*=)/);
function fixture() {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-graphics-audit-'));
  const game=path.join(home,'game');
  fs.mkdirSync(game,{recursive:true});
  fs.writeFileSync(path.join(game,'eboot.bin'),'fixture only; game not started');
  const emulator=path.join(home,'_Build','latest','native-build','kyty_emulator.exe');
  fs.mkdirSync(path.dirname(emulator),{recursive:true});
  fs.writeFileSync(emulator,'not executable');
  return {home,game};
}

test('graphics density defaults Original, invalid and injected modes fail closed',()=>{
  assert.equal(lib.clean({}).graphics_audit_density,'original');
  for(const bad of [null,0,'', 'PS4Base','7','ps4base;EVIL=1','combined','model'])
    assert.equal(lib.clean({graphics_audit_density:bad}).graphics_audit_density,'original');
  assert.equal(lib.clean({graphics_audit_density:'ps4base'}).graphics_audit_density,'ps4base');
});
test('density persists separately from Early Fade, quality, RAM, and shaders',()=>{
  const f=fixture();
  try {
    for(const mode of ['original','ps4base']){
      const settings=lib.applyPreset(lib.clean({...lib.defaults,game:f.game,graphics_audit_density:mode,
        distance_tessellation:'early',distance_detail:'aggressive',ram16_backing:true,
        ram_safety:true, quality:'lowest'}),'Performance');
      assert.equal(settings.graphics_audit_density,mode);
      assert.equal(settings.distance_tessellation,'early');
      lib.saveSettings(f.home,settings);
      const saved=lib.loadSettings(f.home);
      assert.equal(saved.graphics_audit_density,mode);
      assert.equal(saved.ram16_backing,true);
      const command=lib.buildPlayArgs(f.home,saved);
      assert.ok(vars(command.args).includes('KYTY_GRAPHICS_AUDIT_DENSITY='+mode));
      assert.ok(vars(command.args).includes('KYTY_DISTANCE_TESSELLATION=early'));
      assert.ok(vars(command.args).includes('KYTY_DISTANCE_DETAIL=aggressive'));
      assert.ok(vars(command.args).includes('KYTY_BACKING_FILE=1'));
      assert.ok(!command.args.includes('-Precompile'));
    }
  } finally {fs.rmSync(f.home,{recursive:true,force:true});}
});
test('density live path restricted to exact guest and one-line virtual Perf config',()=>{
  const native=file('src/loader/gameArgs.cpp');
  const policy=file('src/loader/graphicsAuditDensity.h');
  const ui=file('launcher-electron/options.html');
  const client=file('launcher-electron/options.js');
  assert.match(native,/std::getenv\("KYTY_GRAPHICS_AUDIT_DENSITY"\)/);
  assert.match(native,/SystemContentParamSfoGetString\("APP_VER", &version\)/);
  assert.match(native,/GraphicsAuditDensity::BuildAdmitted\(title, version\)/);
  assert.match(native,/GraphicsAuditDensity::RewritePerfConfig\(out, "ps4base"\)/);
  assert.match(native,/TessellationRequested\(\) \|\| GraphicsAuditDensityRequested\(\)/);
  assert.match(native,/std::string out = text/);
  assert.match(policy,/original\.find\(name, match \+ name\.size\(\)\)/);
  assert.match(policy,/if \(line != baseline\) return std::nullopt/);
  assert.match(ui,/id="graphics-audit-density"/);
  assert.match(client,/'graphics-audit-density':'graphics_audit_density'/);
});
