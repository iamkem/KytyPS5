'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const lib=require('../logic.cjs');
const root=process.env.KYTY_TEST_ROOT || path.resolve(__dirname,'..','..');
const localReady=fs.existsSync(lib.findEmulator(root)) && lib.gameValid(lib.loadSettings(root));
test('Latest-only native and shader tool; legacy failed experiments are not selectable',{skip:!localReady},()=>{
  const base={...lib.loadSettings(root),ram_safety:true,ram16_backing:true,framegen:0,fps120:false,fps30:false,dlss_model:'auto'};
  const settings=lib.clean({...base,stage7_ram:true,texture_offload:true,chenxiao_guard:true,upstream_latest:false});
  for(const key of ['stage7_ram','texture_offload','chenxiao_guard','upstream_latest'])
    assert.equal(Object.hasOwn(settings,key),false,'legacy setting '+key+' must be removed');
  assert.equal(lib.clean({}).ram_safety,true);
  const spec=lib.buildPlayArgs(root,settings);
  assert.match(spec.args[spec.args.indexOf('-Exe')+1],/latest.*native-build.*kyty_emulator\.exe$/i);
  const flags=spec.args[spec.args.indexOf('-Set')+1];
  assert.match(flags,/KYTY_ADAPTIVE_RAM=1/);
  assert.match(flags,/KYTY_BACKING_FILE=1/);
  assert.match(flags,/KYTY_TEXTURE_OFFLOAD=0/);
  assert.match(flags,/KYTY_TEXTURE_OFFLOAD_PROBE=0/);
  assert.doesNotMatch(flags,/KYTY_STAGE7_RAM|KYTY_READ_GUARD=1/);
  assert.throws(()=>lib.buildPlayArgs(root,{...base,fps30:true,fps120:true}),/not both/);
  const fsr=lib.buildPlayArgs(root,{...base,upscaler:'fsr',output:'1080p',render_dlss:540,fps30:true,gpu:'RTX 5070'});
  const fsrFlags=fsr.args[fsr.args.indexOf('-Set')+1];
  assert.match(fsrFlags,/KYTY_UPSCALER=fsr/);
  assert.match(fsrFlags,/KYTY_GPU=RTX 5070/);
  assert.match(fsrFlags,/KYTY_FLIP_RATE=1/);
  assert.equal(fsr.args[fsr.args.indexOf('-RenderHeight')+1],'540');
  assert.ok(fsr.args.includes('-HdOutput'));
  assert.ok(!fsr.args.includes('-StreamlineDir'));
  assert.equal(lib.clean({...base,gpu:'RTX 5070;invalid'}).gpu,'');
  const hd=lib.buildPlayArgs(root,{...base,upscaler:'dlss',output:'1440p',render_dlss:1080,dlss_model:'K'});
  assert.match(hd.args[hd.args.indexOf('-Set')+1],/KYTY_OUTPUT_HEIGHT=1440/);
  assert.match(hd.args[hd.args.indexOf('-Set')+1],/KYTY_DLSS_PRESET=K/);
  const pre=lib.buildPrecompileArgs(root,{...base,gpu:'RTX 5070'});
  assert.match(pre.args[pre.args.indexOf('-Exe')+1],/latest.*native-build.*kyty_shader_precompile\.exe$/i);
  assert.equal(pre.args[pre.args.indexOf('-Gpu')+1],'RTX 5070');
  assert.ok(pre.args.includes('-Incremental'));
  assert.ok(!pre.args.includes('-ReplaceCache'));
  const dry=spawnSync(fsr.command,[...fsr.args,'-DryRun'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:45000});
  assert.equal(dry.status,0,dry.stderr||dry.stdout);
  assert.match(dry.stdout,/KYTY_UPSCALER=fsr/);
});

test('Shader interrupted merge cannot mark a completed fingerprint',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','..','precompile-windows.ps1'),'utf8');
  assert.match(source,/\$resumeMarker\s*=/);
  assert.match(source,/\$resumePending\s*=/);
  assert.match(source,/\$Incremental -and !\$resumePending/);
  assert.match(source,/if \(\$stopped\) \{\s*Write-Host 'update: stopped safely;/);
  assert.match(source,/exit 130/);
  const stopped=source.lastIndexOf('if ($stopped) {');
  const fingerprint=source.lastIndexOf('Save-KytyShaderFingerprint $PSScriptRoot $gameId');
  assert.ok(stopped>=0 && fingerprint>stopped,'fingerprint only after resumed full run');
  assert.match(source,/\$mergeArguments \+= '--stamp'/);
  assert.match(source,/Remove-Item -LiteralPath \$resumeMarker/);
});

test('Shader incremental cache fast-path rejects changed seeds and newer hints',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','..','precompile-windows.ps1'),'utf8');
  assert.match(source,/\$inputsChanged = \$canVerifyInputs -and !\$fingerprintMatches/);
  assert.match(source,/if \(!\$inputsChanged -and \(\(\$inspectionText -match 'static cache current'/);
  const check=source.indexOf('$inputsChanged = $canVerifyInputs');
  const accept=source.indexOf("cache:      VALID for current GPU/driver and shaders;");
  assert.ok(check>=0 && accept>check,'check input content before accepting native --status');
  // -RefreshSeeds is explicitly opt-in: ordinary incremental updates do not re-extract game files.
  assert.match(source,/\$remake = \$RefreshSeeds -and \(Test-Path \$Seeds\)/);
});

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
  const base=lib.clean({...lib.loadSettings(root),framegen:0,ram_safety:false});
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
test('chenxiao07 1080p game output works with DLSS and preserves explicit 4K output',{skip:!localReady},()=>{
  const base={...lib.loadSettings(root),ram_safety:false};
  const hd=lib.clean({...base,upscaler:'dlss',output:'1080p',render_dlss:720,framegen:2});
  const args=lib.buildPlayArgs(root,hd).args;
  assert.equal(args[args.indexOf('-RenderHeight')+1],'720');
  assert.equal(args[args.indexOf('-Upscaler')+1],'dlss');
  assert.equal(args[args.indexOf('-FrameGen')+1],'1');
  assert.ok(args.includes('-HdOutput'),'DLSS and HD output may be enabled together');
  assert.match(args[args.indexOf('-Exe')+1],/latest.*native-build.*kyty_emulator\.exe$/i,
    'Experimental HD+DLSS must use the isolated emulator');
  assert.equal(lib.clean({...hd,render_dlss:1440}).render_dlss,1080,'HD output clamps rendering to 1080');
  assert.throws(()=>lib.buildPlayArgs(root,{...hd,ratio:'21:9'}),/16:9 only/);
  const normal=lib.buildPlayArgs(root,{...base,upscaler:'dlss',output:'4k',render_dlss:1152});
  assert.ok(!normal.args.includes('-HdOutput'),'1440p window retains 4K game output by default');
  assert.equal(normal.args[normal.args.indexOf('-RenderHeight')+1],'1152');
  assert.equal(lib.applyPreset({...base,framegen:2},'Ultra Performance').render_dlss,720);
});
test('DLSS-G 2x survives graphics preset and reaches PowerShell as -FrameGen 1',{skip:!localReady},()=>{
  const cfg=lib.applyPreset({...lib.loadSettings(root),framegen:2,ram_safety:false},'Performance');
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
  try{assert.throws(()=>lib.buildPlayArgs(dir,lib.defaults),/Latest Kyty native build is missing/);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Real run-windows.ps1 accepts Electron Play settings in DryRun',{skip:!localReady},()=>{
  const s=lib.applyPreset({...lib.loadSettings(root),ram_safety:false},'Performance');
  const spec=lib.buildPlayArgs(root,s);
  const result=spawnSync(spec.command,[...spec.args,'-DryRun'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:40000});
  assert.equal(result.status,0,result.stderr || result.error?.message || result.stdout);
  assert.match(result.stdout,/KYTY_RAM_DIET=1/);
  assert.match(result.stdout,/KYTY_BACKING_FILE=1/);
  // The user's saved display resolution may be 4K (or another supported size).
  // Assert the explicitly selected output width instead of assuming 2560px.
  const [expectedWidth] = s.resolution.split('x');
  assert.match(result.stdout,new RegExp('--screen-width '+expectedWidth+'(?:\\s|$)'));
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
