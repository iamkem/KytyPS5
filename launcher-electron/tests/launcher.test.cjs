'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const lib=require('../logic.cjs');
const root=path.resolve(__dirname,'..','..');
const localReady=fs.existsSync(lib.findEmulator(root)) && lib.gameValid(lib.loadSettings(root));
test('Presets are actual graphics settings and preserve RAM16',()=>{
  const base={...lib.defaults,ram16_backing:true,ram_diet:true,lowlatency:true};
  for(const [name,p] of Object.entries(lib.presets)){
    const next=lib.applyPreset(base,name);
    for(const key of Object.keys(p))assert.equal(next[key],p[key],name+':'+key);
    assert.equal(next.ram16_backing,true);
    assert.equal(next.ram_diet,true);
    assert.equal(lib.activePreset(next),name);
    const fg=lib.applyPreset({...base,framegen:2},name);
    assert.equal(fg.framegen,2,'Selecting '+name+' must not turn off frame generation');
    assert.equal(lib.activePreset(fg),name);
  }
  assert.equal(lib.activePreset({...base,upscaler:'dlss',framegen:3}),lib.activePreset({...base,upscaler:'dlss'}));
});
test('Settings migrate from PowerShell JSON and round-trip without touching real config',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-electron-test-'));
  try{
    const s=lib.clean({...lib.defaults,game:'C:\\Games\\DMSR',ram16_backing:true,ram_diet:true,render_dlss:1152});
    lib.saveSettings(dir,s);
    assert.deepEqual(lib.loadSettings(dir),s);
    fs.writeFileSync(path.join(dir,'launcher-settings.json'),'\uFEFF'+JSON.stringify(s));
    assert.deepEqual(lib.loadSettings(dir),s);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Four resolution-based presets change the actual emulator command',{skip:!localReady},()=>{
  // Validate the graphics presets independently of the player's saved Frame Generation mode.
  // A real user can have framegen=2 (DLSS-G 2x); preset selection must not silently disable it.
  const base=lib.clean({...lib.loadSettings(root),framegen:0});
  for(const [name,p] of Object.entries(lib.presets)){
    const s=lib.applyPreset(base,name);
    const cmd=lib.buildPlayArgs(root,s);
    const a=cmd.args;
    assert.equal(a[a.indexOf('-RenderHeight')+1],String(p.render_dlss),name);
    assert.ok(a.includes('-Upscaler'),name+' DLSS');
    if(name==='Performance'||name==='Ultra Performance') {
      assert.equal(a[a.indexOf('-Quality')+1],'lowest');
      assert.equal(a[a.indexOf('-TextureReduce')+1],'2');
    } else if(name==='Balanced') {
      assert.equal(a[a.indexOf('-Quality')+1],'low');
      assert.equal(a[a.indexOf('-TextureReduce')+1],'1');
    } else {
      assert.equal(a.includes('-Quality'),false);
      assert.equal(a.includes('-TextureReduce'),false);
    }
    assert.equal(a.includes('-FrameGen'),false,name);
    assert.equal(a.includes('-Fsr'),false,name);
    assert.match(a[a.indexOf('-Set')+1],/KYTY_BACKING_FILE=1/);
    assert.match(a[a.indexOf('-Set')+1],/KYTY_RAM_DIET=1/);
    assert.match(cmd.command.toLowerCase(),/powershell\.exe$/);
    assert.ok(a.includes('-Follow'));
  }
});
test('DLSS-G 2x survives graphics preset and reaches PowerShell as -FrameGen 1',{skip:!localReady},()=>{
  const cfg=lib.applyPreset({...lib.loadSettings(root),framegen:2},'Performance');
  const spec=lib.buildPlayArgs(root,cfg);
  assert.equal(spec.args[spec.args.indexOf('-FrameGen')+1],'1');
  assert.equal(spec.args[spec.args.indexOf('-Upscaler')+1],'dlss');
  assert.equal(spec.args[spec.args.indexOf('-RenderHeight')+1],'1080');
  assert.ok(spec.args.includes('-StreamlineDir'));
  const result=spawnSync(spec.command,[...spec.args,'-DryRun'],{cwd:root,encoding:'utf8',timeout:40000,windowsHide:true});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/KYTY_FRAMEGEN=1/);
  assert.match(result.stdout,/KYTY_UPSCALER=dlss/);
  assert.match(result.stdout,/KYTY_STREAMLINE_DIR=/);
});
test('Missing emulator or missing game does not falsely report success',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kyty-noexe-'));
  try{assert.throws(()=>lib.buildPlayArgs(dir,lib.defaults),/executable not found/);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Real run-windows.ps1 accepts Electron Play settings in DryRun',{skip:!localReady},()=>{
  const s=lib.applyPreset(lib.loadSettings(root),'Performance');
  const spec=lib.buildPlayArgs(root,s);
  const result=spawnSync(spec.command,[...spec.args,'-DryRun'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:40000});
  assert.equal(result.status,0,result.stderr || result.error?.message || result.stdout);
  assert.match(result.stdout,/KYTY_RAM_DIET=1/);
  assert.match(result.stdout,/KYTY_BACKING_FILE=1/);
  assert.match(result.stdout,/--screen-width 2560/);
  assert.match(result.stdout,/KYTY_RENDER_HEIGHT=1080/);
  assert.match(result.stdout,/KYTY_UPSCALER=dlss/);
  assert.match(result.stdout,/KYTY_TEXTURE_REDUCE=2/);
});
test('Shader updater is explicitly incremental and reuses the existing utility',{skip:!localReady},()=>{
  const s=lib.loadSettings(root);
  const {args}=lib.buildPrecompileArgs(root,s);
  assert.ok(args.includes('-Incremental'));
  assert.ok(args.includes('-Exe'));
  assert.equal(args.includes('-ReplaceCache'),false);
  assert.equal(args.includes('-RefreshSeeds'),false);
});
