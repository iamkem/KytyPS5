'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const lib=require('../logic.cjs');
const root=path.resolve(__dirname,'..','..');
const source=p=>fs.readFileSync(path.join(root,p),'utf8');
const vars=args=>args[args.indexOf('-Set')+1].split(/,(?=[A-Za-z_][A-Za-z0-9_]*=)/);
function fixture(){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-density-retired-'));
 const game=path.join(home,'game');
 fs.mkdirSync(game,{recursive:true});
 fs.writeFileSync(path.join(game,'eboot.bin'),'fixture only');
 const emulator=path.join(home,'_Build','latest','native-build','kyty_emulator.exe');
 fs.mkdirSync(path.dirname(emulator),{recursive:true});
 fs.writeFileSync(emulator,'fixture only');
 return {home,game};
}
test('retired Density setting is absent from launcher schema and saved configuration',()=>{
 assert.equal(Object.hasOwn(lib.defaults,'graphics_audit_density'),false);
 for(const mode of ['original','ps4base','ps4base;evil=1']){
  const s=lib.clean({...lib.defaults,graphics_audit_density:mode,distance_tessellation:'early'});
  assert.equal(Object.hasOwn(s,'graphics_audit_density'),false);
  assert.equal(s.distance_tessellation,'early');
  assert.equal(lib.applyPreset(s,'Performance').distance_tessellation,'early');
 }
});
test('legacy PS4 Base Density never reaches actual game runner, with Early Fade preserved',()=>{
 const f=fixture();
 try {
  lib.saveSettings(f.home,{...lib.defaults,game:f.game,graphics_audit_density:'ps4base',
   distance_tessellation:'early',distance_detail:'aggressive',ram_safety:true,ram16_backing:true});
  const s=lib.loadSettings(f.home);
  assert.equal(Object.hasOwn(s,'graphics_audit_density'),false);
  const command=lib.buildPlayArgs(f.home,s);
  const values=vars(command.args);
  assert.equal(values.some(v=>v.startsWith('KYTY_GRAPHICS_AUDIT_DENSITY=')),false);
  assert.ok(values.includes('KYTY_DISTANCE_TESSELLATION=early'));
  assert.ok(values.includes('KYTY_DISTANCE_DETAIL=aggressive'));
  assert.ok(values.includes('KYTY_BACKING_FILE=1'));
  assert.equal(command.args.includes('-Precompile'),false);
 } finally {fs.rmSync(f.home,{recursive:true,force:true});}
});
test('native and packaged UI remove injection completely; tombstone rejects PS4Base mode',()=>{
 const native=source('src/loader/gameArgs.cpp');
 const policy=source('src/loader/graphicsAuditDensity.h');
 const html=source('launcher-electron/options.html');
 const client=source('launcher-electron/options.js');
 const logic=source('launcher-electron/logic.cjs');
 assert.doesNotMatch(native,/KYTY_GRAPHICS_AUDIT_DENSITY|GraphicsAuditDensity|graphicsAuditDensity/);
 assert.doesNotMatch(html,/id="graphics-audit-density"/);
 assert.doesNotMatch(client,/'graphics-audit-density':'graphics_audit_density'/);
 assert.doesNotMatch(logic,/graphics_audit_density|KYTY_GRAPHICS_AUDIT_DENSITY/);
 assert.doesNotMatch(policy,/r_tessellationDensity|RewritePerfConfig/);
 assert.match(policy,/Value\(std::string_view\)\s*\{\s*return \{\};\s*\}/);
 assert.match(native,/DistanceTessellation::RewritePerfConfig\(out, "early"\)/);
 assert.match(native,/DemonsSoulsSuperResolution::Active\(\) \|\| TessellationRequested\(\)/);
});
